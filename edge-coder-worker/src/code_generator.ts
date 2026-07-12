import { Env } from './ingress';
import { fetchCurrentFileState, createTaskBranch, commitGeneratedCode, openPullRequest } from './github_bridge';

export interface CodingTaskPayload {
  task_id: string;
  repository_owner: string;
  repository_name: string;
  target_file_path: string;
  base_branch?: string;
  instruction_prompt: string;
  origin_source: 'Asguard_WAF' | 'Onyx_Support_Triage' | 'Manual_Dev_Cockpit';
}

export async function executeCodingPipeline(payload: CodingTaskPayload, env: Env): Promise<void> {
  const {
    task_id,
    repository_owner: owner,
    repository_name: repo,
    target_file_path: path,
    base_branch = 'main',
    instruction_prompt,
    origin_source
  } = payload;

  const branchName = `axim-bot/hotfix-${task_id.substring(0, 8)}-${Date.now().toString().slice(-4)}`;
  const githubCtx = { owner, repo, path, baseBranch: base_branch };

  try {
    console.log(`[CODING_LAB] [${task_id}] Fetching current file state for: ${path}`);
    const currentFile = await fetchCurrentFileState(githubCtx, env);

    console.log(`[CODING_LAB] [${task_id}] Dispatching structural payload to llm-proxy gateway`);
    const modifiedCode = await requestCognitiveCodeGeneration(currentFile.content, instruction_prompt, env);

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

    await reportLabExecutionTelemetry(task_id, origin_source, pullRequestUrl, env);

  } catch (error: any) {
    console.error(`[CODING_LAB_CRITICAL_FAULT] Task #${task_id} failed:`, error.message);
    await env.TASK_LOCKS.delete(`lock:${task_id}`);
    await logLabFaultToCore(task_id, error, env);
  }
}

async function requestCognitiveCodeGeneration(currentCode: string, instructions: string, env: Env): Promise<string> {
  const systemInstructions = `You are an expert full-stack systems engineer specializing in edge-native cloud systems. Your task is to modify the provided source code according to the given instructions. You MUST output ONLY the absolute raw source code. Do NOT wrap your output in markdown code fences (\`\`\`rust or \`\`\`typescript), and do NOT include any introductory or conversational explanations. Your output must be instantly parseable by a compiler.`;
  
  const promptBody = `### Original Source Code:\n${currentCode}\n\n### Modification Directives:\n${instructions}`;

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
  if (clean.startsWith('```')) {
    const lines = clean.split('\n');
    if (lines[0].startsWith('```')) lines.shift();
    if (lines[lines.length - 1] === '```') lines.pop();
    clean = lines.join('\n').trim();
  }
  return clean;
}

async function reportLabExecutionTelemetry(taskId: string, source: string, prUrl: string, env: Env): Promise<void> {
  const telemetryBody = [{
    app_id: 'axim-coding-lab',
    endpoint: '/v1/gitops/pr-creation',
    method: 'POST',
    status_code: 200,
    error_message: null,
    metadata: { task_id: taskId, trigger_origin: source, pull_request_target: prUrl }
  }];

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