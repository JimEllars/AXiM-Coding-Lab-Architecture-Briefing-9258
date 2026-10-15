import { Env } from './ingress';
import { fetchCurrentFileState, fetchRepositoryDependencies, createTaskBranch, commitGeneratedCode, openPullRequest, GithubContext } from './github_bridge';
import { dispatchCallbackWebhook } from './callback_dispatcher';
import { reportGreenMachineTelemetry } from './telemetry';

let step_count = 0;
let tokens_consumed = 0;
let exit_code = 0;

function cleanSanitizedCodeBlob(rawText: string): string {
  let clean = rawText.trim();

  // Strip leading/trailing code fences strictly
  clean = clean.replace(/^\s*```[a-zA-Z]*\s*\n/g, '');
  clean = clean.replace(/\n\s*```\s*$/g, '');

  const codeBlockRegex = /^```[a-z]*\n([\s\S]*?)\n```$/i;
  const match = clean.match(codeBlockRegex);
  if (match) {
    clean = match[1].trim();
  }

  if (clean.startsWith('```')) {
    const lines = clean.split('\n');
    if (lines[0].startsWith('```')) lines.shift();
    if (lines[lines.length - 1].trim() === '```') lines.pop();
    clean = lines.join('\n').trim();
  }

  // Remove any remaining code fences at the start or end
  clean = clean.replace(/^\s*```[a-zA-Z]*\s*\n/m, '');
  clean = clean.replace(/\n\s*```\s*$/m, '');

  return clean.trim();
}

async function requestCognitiveCodeGeneration(
  currentCode: string,
  instructions: string,
  runtime_env: string,
  dependenciesContext: string,
  env: Env,
  assigned_model?: string
): Promise<{ code: string; providerUsed: "deepseek" | "anthropic"; failoverTriggered: boolean }> {
  const systemInstructions = `You are an expert full-stack systems engineer specializing in ${runtime_env} architecture. Output ONLY raw source code without markdown code fences.`;
  const promptBody = `### Workspace Dependencies:\n${dependenciesContext}\n\n### Original Source:\n${currentCode}\n\n### Directives:\n${instructions}`;

  // Attempt A: DeepSeek Primary
  try {
    const deepseekPayload = {
      provider: "deepseek",
      prompt: promptBody,
      options: { model: assigned_model || "deepseek-coder", temperature: 0.2, system: systemInstructions }
    };

    const response = await fetch(env.SUPABASE_LLM_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.SUPABASE_SECRET_KEY}` },
      body: JSON.stringify(deepseekPayload),
      signal: AbortSignal.timeout(12000)
    });

    if (!response.ok) throw new Error(`DeepSeek Error HTTP ${response.status}: ${await response.text()}`);
    const result: any = await response.json();
    if (result.error) throw new Error(`DeepSeek Error: ${result.error}`);

    return { code: cleanSanitizedCodeBlob(result.content || ""), providerUsed: "deepseek", failoverTriggered: false };
  } catch (err: any) {
    console.warn(`[LLM_CASCADE] DeepSeek primary failed (${err.message}). Failing over to Anthropic Claude 3.5 Sonnet.`);

    // Attempt B: Anthropic Claude 3.5 Fallback
    const anthropicPayload = {
      provider: "anthropic",
      prompt: promptBody,
      options: { model: "claude-3-5-sonnet-20241022", temperature: 0.2, system: systemInstructions }
    };

    const fallbackRes = await fetch(env.SUPABASE_LLM_PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.SUPABASE_SECRET_KEY}` },
      body: JSON.stringify(anthropicPayload),
      signal: AbortSignal.timeout(15000)
    });

    if (!fallbackRes.ok) throw new Error(`Anthropic Fallback Error HTTP ${fallbackRes.status}: ${await fallbackRes.text()}`);
    const fallbackResult: any = await fallbackRes.json();
    if (fallbackResult.error) throw new Error(`Anthropic Fallback Error: ${fallbackResult.error}`);

    return { code: cleanSanitizedCodeBlob(fallbackResult.content || ""), providerUsed: "anthropic", failoverTriggered: true };
  }
}





async function reportLabExecutionTelemetry(taskId: string, source: string, prUrl: string, env: Env, cfRay?: string, truncated: boolean = false, runtimeEnv: string = 'Node.js Edge', assigned_model?: string): Promise<void> {
  const telemetryBody = [{
    app_id: 'axim-coding-lab',
    endpoint: '/v1/gitops/pr-creation',
    method: 'POST',
    status_code: 200,
    error_message: null,
    metadata: { task_id: taskId, trigger_origin: source, pull_request_target: prUrl, cf_ray: cfRay || 'unknown' }
  }];

  // Update the payload sent back to public.coding_tasks upon a successful generation
  await fetch(`${env.SUPABASE_URL}/rest/v1/coding_tasks?task_id=eq.${taskId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.SUPABASE_SECRET_KEY}`,
      'apikey': env.SUPABASE_SECRET_KEY
    },
    body: JSON.stringify({
      context: {
        truncated: truncated,
        execution_target: 'Python/Node',
        runtime_env: runtimeEnv,
        assigned_model: assigned_model
      }
    })
  });

  await fetch(`${env.SUPABASE_URL}/rest/v1/api_usage_logs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.SUPABASE_SECRET_KEY}`,
      'apikey': env.SUPABASE_SECRET_KEY
    },
    body: JSON.stringify(telemetryBody)
  });
}

async function logLabFaultToCore(taskId: string, error: any, env: Env): Promise<void> {
  try {
    step_count++;
    const errorBody = {
      task_id: taskId,
      component: 'axim-coding-lab-generator',
      error_message: error.message,
      stack_trace: error.stack || '',
      status: 'FAILED',
      created_at: new Date().toISOString()
    };

    await fetch(`${env.SUPABASE_URL}/rest/v1/coding_tasks_errors`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${env.SUPABASE_SECRET_KEY}`,
        'apikey': env.SUPABASE_SECRET_KEY
      },
      body: JSON.stringify(errorBody)
    });
  } catch (e) {
    console.error('[CORE_LOGGING_CRASH] Failed to sync error state back to database:', e);
  }
}


export function sanitizeVulnerabilityVectors(code: string): { safe: boolean; error?: string } {
  // Regex check for obvious raw unescaped variable concatenations often injected by LLMs into SQL template strings
  // Example: `SELECT * FROM users WHERE id = ${id}`
  // We check for `.*SELECT.*\$\{.*\}.*` inside backticks or similar patterns for basic SQL injection vectors
  const sqlInjectionPattern = /`\s*(SELECT|INSERT|UPDATE|DELETE).+?\$\{.+?\}.*?`/i;

  if (sqlInjectionPattern.test(code)) {
    return { safe: false, error: 'Detected potential SQL injection vector: Unescaped variable concatenation in template string.' };
  }

  // Generic concatenated SQL pattern: "SELECT * FROM " + var
  const stringConcatInjection = /["']\s*(SELECT|INSERT|UPDATE|DELETE).+?["']\s*\+/i;
  if (stringConcatInjection.test(code)) {
     return { safe: false, error: 'Detected potential SQL injection vector: String concatenation in SQL query.' };
  }

  return { safe: true };
}

export function validateCodeSyntax(code: string, filePath: string): { valid: boolean; error?: string } {
  const isPython = filePath.endsWith('.py');
  const isJS = filePath.endsWith('.js') || filePath.endsWith('.ts') || filePath.endsWith('.jsx') || filePath.endsWith('.tsx');
  const isJSON = filePath.endsWith('.json');
  const isYamlOrToml = filePath.endsWith('.toml') || filePath.endsWith('.yaml') || filePath.endsWith('.yml');

  if (isJS) {
    const openBraces = (code.match(/\{/g) || []).length;
    const closeBraces = (code.match(/\}/g) || []).length;
    const openParens = (code.match(/\(/g) || []).length;
    const closeParens = (code.match(/\)/g) || []).length;

    if (openBraces !== closeBraces) {
      return { valid: false, error: `Mismatched curly braces: ${openBraces} open vs${closeBraces} close.` };
    }
    if (openParens !== closeParens) {
      return { valid: false, error: `Mismatched parentheses: ${openParens} open vs${closeParens} close.` };
    }

    const backticks = (code.match(/`/g) || []).length;
    if (backticks % 2 !== 0) {
      return { valid: false, error: `Unclosed template literal (backticks).` };
    }

    if (code.match(/^\s*import\s+from\s+['"]/m)) {
      return { valid: false, error: `Broken import statement missing imported bindings.` };
    }
  } else if (isPython) {
    const hasTabs = /^\t+/m.test(code);
    const hasSpaces = /^ +/m.test(code);
    if (hasTabs && hasSpaces) {
      return { valid: false, error: 'Mixed indentation (tabs and spaces).' };
    }

    const blockDefs = code.match(/^(?:\s*)(?:def|class|if|elif|else|for|while|try|except|finally|with)\b.*$/gm);
    if (blockDefs) {
      for (const def of blockDefs) {
        const cleanDef = def.replace(/#.*$/, '').trim();
        if (!cleanDef.endsWith(':')) {
          return { valid: false, error: `Block definition missing colon: ${cleanDef}` };
        }
      }
    }
  } else if (isJSON) {
    try {
      JSON.parse(code);
    } catch (err: any) {
      return { valid: false, error: `Invalid JSON structure: ${err.message}` };
    }
  } else if (isYamlOrToml) {
    const openBrackets = (code.match(/\[/g) || []).length;
    const closeBrackets = (code.match(/\]/g) || []).length;
    const openBraces = (code.match(/\{/g) || []).length;
    const closeBraces = (code.match(/\}/g) || []).length;

    if (openBrackets !== closeBrackets || openBraces !== closeBraces) {
      return { valid: false, error: 'Malformed configuration file syntax (mismatched brackets or braces).' };
    }

    const doubleQuotes = (code.match(/(?<!\\)"/g) || []).length;
    const singleQuotes = (code.match(/(?<!\\)'/g) || []).length;
    if (doubleQuotes % 2 !== 0 || singleQuotes % 2 !== 0) {
      return { valid: false, error: 'Malformed configuration file syntax (unclosed quotes).' };
    }
  }

  return { valid: true };
}


export function prepareContextWindow(content: string, threshold: number = 32000): { content: string, truncated: boolean } {
  if (content.length > threshold) {
    return {
      content: content.substring(0, threshold),
      truncated: true
    };
  }
  return {
    content: content,
    truncated: false
  };
}

export async function executeAutonomousCodingTask(task: any, env: Env, writer?: any): Promise<void> {
  const startTime = Date.now();

  const sendEvent = async (type: string, message: string) => {
    if (writer) {
      await writer.write(new TextEncoder().encode(`data: ${JSON.stringify({ type, message })}\n\n`)).catch(() => {});
    }
  };
  const taskId = task.taskId || `auto-${Date.now()}`;
  const owner = 'axim';
  const repo = task.repo || 'AXiM-Coding-Lab';
  // Attempt to parse instructions for file path if not provided
  let path = task.target_file_path;
  if (!path) {
    const match = task.instructions?.match(/(?:in|at|on) `?([a-zA-Z0-9_/-]+\.[a-zA-Z0-9]+)`?/);
    path = match ? match[1] : 'README.md';
  }
  const githubCtx = { owner, repo, path };

  let pipelineSucceeded = false;
  try {
    step_count++;
    console.log(`[AUTONOMOUS_CODER] Task ${taskId} started for ${path}`);
    await sendEvent('reasoning_step', JSON.stringify({ step: 1, title: '[INGRESS]', content: 'Transmitting payload to edge router and fetching current file state...', status: 'complete' }));
    const currentFile = await fetchCurrentFileState(githubCtx, env);
    const { content: contextContent, truncated } = prepareContextWindow(currentFile.content);
    await sendEvent('reasoning_step', JSON.stringify({ step: 2, title: '[BRAIN]', content: 'Injecting organizational context and fetching dependencies...', status: 'complete' }));
    const depsContext = await fetchRepositoryDependencies(githubCtx, env);

    let organizationalContext = "";
    if (task.contextIds && task.contextIds.length > 0) {
      const idsQuery = task.contextIds.map((id: any) => `"${id}"`).join(',');
      const knowledgeRes = await fetch(`${env.SUPABASE_URL}/rest/v1/knowledge_nodes?id=in.(${idsQuery})`, {
        headers: {
          'apikey': env.SUPABASE_SECRET_KEY,
          'Authorization': `Bearer ${env.SUPABASE_SECRET_KEY}`
        }
      });
      if (knowledgeRes.ok) {
        const nodes: any = await knowledgeRes.json();
        organizationalContext = nodes.map((n: any) => `[Org Rule: ${n.title}] ${n.content}`).join('\n');
      }
    }

    const promptBody = `### Organizational Knowledge / Rules:\n${organizationalContext}\n\n### Task: ${task.title}\n\n### Instructions:\n${task.instructions}\n\n### Code:\n${contextContent}`;

    const active_model = (task.priority === 'high' || (task.instructions && (task.instructions.toLowerCase().includes('refactor') || task.instructions.toLowerCase().includes('security')))) ? 'claude-3-5' : 'deepseek-coder';
    await sendEvent('reasoning_step', JSON.stringify({ step: 3, title: '[ANALYSIS]', content: 'Generating patch via ' + active_model + '...', status: 'complete' }));
    const { code: generatedCode, providerUsed } = await requestCognitiveCodeGeneration(
      contextContent,
      task.instructions,
      'Node.js Edge',
      depsContext,
      env,
      active_model
    );
    let modifiedCode = generatedCode;

    const currentLock = await env.TASK_LOCKS.get(`lock:${taskId}`);
    if (!currentLock) {
      await sendEvent('log', '[ABORT] Task lock evicted by administrator. Halting pipeline before Git commit.');
      throw new Error('Task was forcefully evicted. Pipeline aborted.');
    }

    await sendEvent('reasoning_step', JSON.stringify({ step: 4, title: '[AST_CHECK]', content: 'Validating structural syntax of the generated code...', status: 'complete' }));
    const syntaxCheck = validateCodeSyntax(modifiedCode, path);
    if (!syntaxCheck.valid) {
      console.warn(`[AUTONOMOUS_CODER] Syntax Error Detected: ${syntaxCheck.error}. Triggering 1-shot retry.`);
      const retryPrompt = `${task.instructions}\n\nThe generated code had a syntax error: ${syntaxCheck.error}\nPlease provide the fixed raw source code without markdown.`;
      const retryResult = await requestCognitiveCodeGeneration(
        contextContent,
        retryPrompt,
        'Node.js Edge',
        depsContext,
        env,
        active_model
      );
      modifiedCode = retryResult.code;
    }


    if (task.origin_source === 'Asguard_WAF') {
      await sendEvent('reasoning_step', JSON.stringify({ step: 4.5, title: '[SEC_SWEEP]', content: 'Executing pre-commit vulnerability sanitization...', status: 'complete' }));
      const secCheck = sanitizeVulnerabilityVectors(modifiedCode);
      if (!secCheck.safe) {
        console.warn(`[AUTONOMOUS_CODER] Security vulnerability detected in generated code: ${secCheck.error}`);
        throw new Error(`Pre-commit security validation failed: ${secCheck.error}`);
      }
    }

    const branchName = `axim-bot/ticket-${taskId.substring(0,8)}`;
    await sendEvent('reasoning_step', JSON.stringify({ step: 5, title: '[PATCH_GEN]', content: 'Provisioning branch and committing generated patch...', status: 'complete' }));
    step_count++;
    await createTaskBranch(githubCtx, branchName, env);

    const commitMessage = `fix(auto-remediation): resolve task #${taskId} via coding lab`;
    await commitGeneratedCode(githubCtx, branchName, modifiedCode, currentFile.sha, commitMessage, env);

    const prTitle = `[AXiM Coder] ${task.title}`;
    let prBody = `## Autonomous Engineering Task: ${taskId}\n\n**Requested By:** ${task.requestedBy || 'System'}\n**Priority:** ${task.priority || 'Normal'}\n\n### Instructions\n${task.instructions}\n\n*Review diff and merge.*`;
    if (truncated) {
      prBody += `\n\n> ⚠️ **Notice:** The original file exceeded maximum context limits (32k tokens). The prompt context was automatically truncated before LLM generation. Please carefully review the patch for missing external dependencies.`;
    }
    const prUrl = await openPullRequest(githubCtx, branchName, prTitle, prBody, env);

    // Webhook Callbacks
    await dispatchCallbackWebhook('support', { ticket_id: taskId || 'unknown', status: 'PATCH_READY', pr_url: prUrl, branch: branchName, commit_sha: 'pending' }, env);
    await dispatchCallbackWebhook('asguard', { incident_hash: taskId || 'unknown', status: 'RULE_PR_OPENED', pr_url: prUrl, branch: branchName }, env);

    console.log(`[AUTONOMOUS_CODER] Task ${taskId} PR opened at ${prUrl}`);
    step_count++;
    tokens_consumed += 1500; // Approximated tokens
    exit_code = 0;
    await reportLabExecutionTelemetry(taskId, task.requestedBy || 'Autonomous', prUrl, env, undefined, undefined, 'Node.js Edge', 'auto');
    pipelineSucceeded = true;

    const computeDurationMs = Date.now() - startTime;
    await reportGreenMachineTelemetry(
      taskId,
      providerUsed,
      task.repo || 'axim-core-v1.2',
      prUrl,
      1000, // prompt tokens
      500,  // completion tokens
      computeDurationMs,
      env
    );
  } catch (error: any) {
    throw error;
  } finally {
    if (!pipelineSucceeded) {
      await env.TASK_LOCKS.delete(`lock:${taskId}`).catch(() => {});
    }
  }
}

export async function executeCodingPipeline(payload: any, env: Env, writer?: any, ctx?: any): Promise<void> {
    await executeAutonomousCodingTask(payload, env, writer);
}
