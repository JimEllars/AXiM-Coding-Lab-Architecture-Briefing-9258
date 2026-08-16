import { Env } from './ingress';
import { fetchCurrentFileState, createTaskBranch, commitGeneratedCode, openPullRequest, fetchRepositoryDependencies } from './github_bridge';

export interface CodingTaskPayload {
  task_id: string;
  repository_owner: string;
  repository_name: string;
  target_file_path: string;
  base_branch?: string;
  instruction_prompt: string;
  origin_source: 'Asguard_WAF' | 'Onyx_Support_Triage' | 'Manual_Dev_Cockpit';
  cf_ray?: string;
  runtime_env?: string;
}


function prepareContextWindow(content: string, threshold: number = 32000): { content: string, truncated: boolean } {
  if (content.length <= threshold) {
    return { content, truncated: false };
  }
  const half = Math.floor(threshold / 2);
  const start = content.slice(0, half);
  const end = content.slice(-half);
  return {
    content: `${start}\n...[TRUNCATED FOR CONTEXT LIMITS]...\n${end}`,
    truncated: true
  };
}

export async function executeCodingPipeline(payload: CodingTaskPayload, env: Env): Promise<void> {
  const {
    task_id,
    repository_owner: owner,
    repository_name: repo,
    target_file_path: path,
    base_branch = 'main',
    instruction_prompt,
    origin_source,
    cf_ray,
    runtime_env = 'Node.js Edge'
  } = payload;

  const branchName = `axim-bot/hotfix-${task_id.substring(0, 8)}-${Date.now().toString().slice(-4)}`;
  const githubCtx = { owner, repo, path, baseBranch: base_branch };

  try {
    console.log(`[CODING_LAB] [${task_id}] Fetching current file state for: ${path}`);
    const currentFile = await fetchCurrentFileState(githubCtx, env);

    const { content: safeContent, truncated } = prepareContextWindow(currentFile.content);

    console.log(`[CODING_LAB] [${task_id}] Fetching repository dependencies`);
    let rawDependenciesContext = await fetchRepositoryDependencies(githubCtx, env);
    const dependenciesContext = rawDependenciesContext.slice(0, 2000);

    console.log(`[CODING_LAB] [${task_id}] Dispatching structural payload to llm-proxy gateway (Truncated: ${truncated})`);
    const modifiedCode = await requestCognitiveCodeGeneration(safeContent, instruction_prompt, runtime_env, dependenciesContext, env);

    console.log(`[CODING_LAB] [${task_id}] Validating structural syntax for ${runtime_env}`);
    const isValid = await validateSyntax(modifiedCode, runtime_env);
    if (!isValid) {
      throw new Error('[AST_FAULT] The generated code failed structural syntax validation. Aborting commit.');
    }

    console.log(`[CODING_LAB] [${task_id}] Code generated cleanly. Provisioning task branch: ${branchName}`);
    await createTaskBranch(githubCtx, branchName, env);

    console.log(`[CODING_LAB] [${task_id}] Committing syntax modifications to Git tree`);
    const commitMessage = `fix(${origin_source.toLowerCase()}): auto-remediation patch for task #${task_id}`;
    await commitGeneratedCode(githubCtx, branchName, modifiedCode, currentFile.sha, commitMessage, env);

    console.log(`[CODING_LAB] [${task_id}] Opening Pull Request for engineering review`);
    const prTitle = `🤖 [ONYX BOT HOTFIX] Autonomous Remediation for Task #${task_id}`;
    const prBody = `## Autonomous Engineering Report\n\n**Origin Source:** ${origin_source}\n**Target File Asset:** \`${path}\`\n\n### Modifications Applied\n- Compiled structural patch based on ecosystem telemetry vectors.\n- Executed edge sanitization validation pass.\n\n*Review the diff maps in the tab above and press Merge to deploy.*`;
    
    const pullRequestUrl = await openPullRequest(githubCtx, branchName, prTitle, prBody, env);
    console.log(`[CODING_LAB] [${task_id}] Pipeline completed successfully. PR open at: ${pullRequestUrl}`);

    await reportLabExecutionTelemetry(task_id, origin_source, pullRequestUrl, env, cf_ray, truncated, runtime_env);

  } catch (error: any) {
    console.error(`[CODING_LAB_CRITICAL_FAULT] Task #${task_id} failed:`, error.message);
    await env.TASK_LOCKS.delete(`lock:${task_id}`);
    await logLabFaultToCore(task_id, error, env);
  }
}

async function requestCognitiveCodeGeneration(currentCode: string, instructions: string, runtime_env: string, dependenciesContext: string, env: Env): Promise<string> {
  const systemInstructions = `You are an expert full-stack systems engineer specializing in ${runtime_env} architecture and scalable execution environments. Your task is to modify the provided source code according to the given instructions. You MUST output ONLY the absolute raw source code. Do NOT wrap your output in markdown code fences (\`\`\`rust, \`\`\`typescript, or \`\`\`python), and do NOT include any introductory or conversational explanations. Ensure any environment scripts and execution handlers are robust, dependency-aware, and properly sandboxed. Your output must be instantly parseable by a compiler or interpreter. When generating Python code, you must ensure strict PEP-8 indentation and AST-valid logic. Do not return markdown explanations outside of the code block. Your output must be transport-ready for a sandboxed execution environment.`;
  
  const promptBody = `### Active Workspace Dependencies:\n${dependenciesContext}\n\n### Original Source Code:\n${currentCode}\n\n### Modification Directives:\n${instructions}`;

  const proxyPayload = {
    provider: 'deepseek',
    prompt: promptBody,
    options: {
      model: 'deepseek-coder',
      temperature: 0.2,
      system: systemInstructions
    }
  };

  const response = await fetch(env.SUPABASE_LLM_PROXY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
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

  // Extract content if it's wrapped in a code block, ignoring surrounding conversational text.
  const codeBlockRegex = /```[a-z]*\n([\s\S]*?)\n```/i;
  const match = clean.match(codeBlockRegex);
  if (match) {
    return match[1].trim();
  }

  if (clean.startsWith('```')) {
    const lines = clean.split('\n');
    if (lines[0].startsWith('```')) lines.shift();
    if (lines[lines.length - 1].trim() === '```') lines.pop();
    clean = lines.join('\n').trim();
  }

  return clean;
}

async function reportLabExecutionTelemetry(taskId: string, source: string, prUrl: string, env: Env, cfRay?: string, truncated: boolean = false, runtimeEnv: string = 'Node.js Edge'): Promise<void> {
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
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'apikey': env.SUPABASE_SERVICE_ROLE_KEY
    },
    body: JSON.stringify({
      context: {
        truncated: truncated,
        execution_target: 'Python/Node',
        runtime_env: runtimeEnv
      }
    })
  });

  await fetch(`${env.SUPABASE_URL}/rest/v1/api_usage_logs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'apikey': env.SUPABASE_SERVICE_ROLE_KEY
    },
    body: JSON.stringify(telemetryBody)
  });
}

async function logLabFaultToCore(taskId: string, error: any, env: Env): Promise<void> {
  try {
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
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY
      },
      body: JSON.stringify(errorBody)
    });
  } catch (e) {
    console.error('[CORE_LOGGING_CRASH] Failed to sync error state back to database:', e);
  }
}

export async function validateSyntax(code: string, runtimeEnv: string): Promise<boolean> {
  if (runtimeEnv === 'Node.js Edge') {
    // Structural regex to check for mismatched curly braces {} and parentheses ()
    const openBraces = (code.match(/\{/g) || []).length;
    const closeBraces = (code.match(/\}/g) || []).length;
    const openParens = (code.match(/\(/g) || []).length;
    const closeParens = (code.match(/\)/g) || []).length;

    if (openBraces !== closeBraces || openParens !== closeParens) {
      return false;
    }
    return true;
  } else if (runtimeEnv === 'Python Sandbox') {
    // Check for mixed indentation (tabs vs. spaces)
    const hasTabs = /^\t+/m.test(code);
    const hasSpaces = /^ +/m.test(code);
    if (hasTabs && hasSpaces) {
      return false;
    }

    // Ensure basic block definitions end with a colon
    const blockDefs = code.match(/^(?:\s*)(?:def|class|if|elif|else|for|while|try|except|finally|with)\b.*$/gm);
    if (blockDefs) {
      for (const def of blockDefs) {
        // Strip comments and trailing whitespace
        const cleanDef = def.replace(/#.*$/, '').trim();
        if (!cleanDef.endsWith(':')) {
          return false;
        }
      }
    }
    return true;
  }
  return true;
}
