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

async function requestCognitiveCodeGeneration(currentCode: string, instructions: string, runtime_env: string, dependenciesContext: string, env: Env, assigned_model: string = "deepseek-coder"): Promise<string> {
  const systemInstructions = `You are an expert full-stack systems engineer specializing in ${runtime_env} architecture and scalable execution environments. Your task is to modify the provided source code according to the given instructions. You MUST output ONLY the absolute raw source code. Do NOT wrap your output in markdown code fences (\`\`\`rust, \`\`\`typescript, or \`\`\`python), and do NOT include any introductory or conversational explanations. Ensure any environment scripts and execution handlers are robust, dependency-aware, and properly sandboxed. Your output must be instantly parseable by a compiler or interpreter. When generating Python code, you must ensure strict PEP-8 indentation and AST-valid logic. Do not return markdown explanations outside of the code block. Your output must be transport-ready for a sandboxed execution environment.`;
  
  const promptBody = `### Active Workspace Dependencies:\n${dependenciesContext}\n\n### Original Source Code:\n${currentCode}\n\n### Modification Directives:\n${instructions}`;


  // Economic model routing
  let active_model = assigned_model;
  const isComplex = instructions.toLowerCase().includes('refactor') || instructions.toLowerCase().includes('security') || instructions.length > 300;
  if (!active_model || active_model === 'auto') {
      active_model = isComplex ? 'claude-3-5' : 'deepseek-coder';
  }
  const proxyPayload = {
    provider: 'deepseek',
    prompt: promptBody,
    options: {
      model: active_model,
      temperature: 0.2,
      system: systemInstructions
    }
  };

  const startCompute = Date.now();
  const response = await fetch(env.SUPABASE_LLM_PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.SUPABASE_SECRET_KEY}`
    },
    body: JSON.stringify(proxyPayload)
  });

  if (!response.ok) {
    throw new Error(`Core LLM Proxy Gateway rejected compilation handshake: ${response.statusText}`);
  }

  const result: any = await response.json();
  
  if (result.error) {
    throw new Error(`Upstream LLM Generation Error: ${result.error}`);
  }

  return cleanSanitizedCodeBlob(result.content || '');
}

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

export function validateCodeSyntax(code: string, filePath: string): { valid: boolean; error?: string } {
  const isPython = filePath.endsWith('.py');
  const isJS = filePath.endsWith('.js') || filePath.endsWith('.ts') || filePath.endsWith('.jsx') || filePath.endsWith('.tsx');

  if (isJS) {
    const openBraces = (code.match(/\{/g) || []).length;
    const closeBraces = (code.match(/\}/g) || []).length;
    const openParens = (code.match(/\(/g) || []).length;
    const closeParens = (code.match(/\)/g) || []).length;

    if (openBraces !== closeBraces) {
      return { valid: false, error: `Mismatched curly braces: ${openBraces} open vs ${closeBraces} close.` };
    }
    if (openParens !== closeParens) {
      return { valid: false, error: `Mismatched parentheses: ${openParens} open vs ${closeParens} close.` };
    }

    // Check for orphaned template literals (odd number of backticks, naive check)
    const backticks = (code.match(/`/g) || []).length;
    if (backticks % 2 !== 0) {
      return { valid: false, error: `Unclosed template literal (backticks).` };
    }

    // Broken import statements check (e.g. "import from 'xxx'" missing variable)
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
  }

  return { valid: true };
}


export async function executeAutonomousCodingTask(task: any, env: Env): Promise<void> {
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
    const currentFile = await fetchCurrentFileState(githubCtx, env);
    const depsContext = await fetchRepositoryDependencies(githubCtx, env);

    const promptBody = `### Task: ${task.title}\n\n### Instructions:\n${task.instructions}\n\n### Code:\n${currentFile.content}`;

    const proxyPayload = {
      provider: 'deepseek',
      prompt: promptBody,
      options: {
        model: (task.priority === 'high' || (task.instructions && (task.instructions.toLowerCase().includes('refactor') || task.instructions.toLowerCase().includes('security')))) ? 'claude-3-5' : 'deepseek-coder',
        temperature: 0.2,
        system: `You are AXiM Coder Core. Modify the code as requested. Output ONLY raw source code.`
      }
    };

    const response = await fetch(env.SUPABASE_LLM_PROXY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.SUPABASE_SECRET_KEY}` },
      body: JSON.stringify(proxyPayload)
    });

    if (!response.ok) throw new Error(`LLM Error: ${response.statusText}`);
    const result: any = await response.json();
    let modifiedCode = cleanSanitizedCodeBlob(result.content || '');

    const syntaxCheck = validateCodeSyntax(modifiedCode, path);
    if (!syntaxCheck.valid) {
      console.warn(`[AUTONOMOUS_CODER] Syntax Error Detected: ${syntaxCheck.error}. Triggering 1-shot retry.`);
      const retryPrompt = `${promptBody}\n\nThe generated code had a syntax error: ${syntaxCheck.error}\nPlease provide the fixed raw source code without markdown.`;
      const retryPayload = { ...proxyPayload, prompt: retryPrompt };

      const retryResponse = await fetch(env.SUPABASE_LLM_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.SUPABASE_SECRET_KEY}` },
        body: JSON.stringify(retryPayload)
      });
      if (!retryResponse.ok) throw new Error(`LLM Retry Error: ${retryResponse.statusText}`);
      const retryResult: any = await retryResponse.json();
      modifiedCode = cleanSanitizedCodeBlob(retryResult.content || '');
    }

    const branchName = `axim-bot/ticket-${taskId.substring(0,8)}`;
    step_count++;
    await createTaskBranch(githubCtx, branchName, env);

    const commitMessage = `fix(auto-remediation): resolve task #${taskId} via coding lab`;
    await commitGeneratedCode(githubCtx, branchName, modifiedCode, currentFile.sha, commitMessage, env);

    const prTitle = `[AXiM Coder] ${task.title}`;
    const prBody = `## Autonomous Engineering Task: ${taskId}\n\n**Requested By:** ${task.requestedBy || 'System'}\n**Priority:** ${task.priority || 'Normal'}\n\n### Instructions\n${task.instructions}\n\n*Review diff and merge.*`;
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

    // Green Machine Telemetry (public.api_usage_logs)
    await fetch(`${env.SUPABASE_URL}/rest/v1/api_usage_logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.SUPABASE_SECRET_KEY}`,
        "apikey": env.SUPABASE_SECRET_KEY
      },
      body: JSON.stringify([{
        app_id: "axim-coding-lab",
        endpoint: "/api/v1/tasks/dispatch",
        method: "POST",
        status_code: 200,
        metadata: {
          task_id: taskId,
          pr_url: prUrl,
          model: "claude-3-5", // or parsed model
          tokens_used: tokens_consumed || 0
        }
      }])
    }).catch(e => console.error('Failed to log Green Machine telemetry:', e));
  } catch (error: any) {
    throw error;
  }
}
