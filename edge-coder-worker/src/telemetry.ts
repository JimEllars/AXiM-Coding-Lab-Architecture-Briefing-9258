export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SECRET_KEY: string;
}

export async function reportGreenMachineTelemetry(
  taskId: string,
  model: string,
  targetRepo: string,
  prUrl: string,
  promptTokens: number,
  completionTokens: number,
  computeDurationMs: number,
  env: Env,
  ctx?: any
): Promise<void> {
  const isDeepSeek = model.toLowerCase().includes('deepseek');
  const inputRate = isDeepSeek ? 0.14 : 3.00; // per million
  const outputRate = isDeepSeek ? 0.28 : 15.00; // per million

  const cost = (promptTokens / 1_000_000) * inputRate + (completionTokens / 1_000_000) * outputRate;

  const payload = {
    app_id: 'axim-coding-lab',
    endpoint: '/v1/gitops/pr-creation',
    method: 'POST',
    status_code: 200,
    metadata: {
      task_id: taskId,
      target_repo: targetRepo,
      model_used: model,
      tokens_total: promptTokens + completionTokens,
      cost_usd: parseFloat(cost.toFixed(4)),
      dev_hours_saved: 2.0,
      pr_url: prUrl,
      duration_ms: computeDurationMs
    }
  };

  const doFetch = fetch(`${env.SUPABASE_URL}/rest/v1/api_usage_logs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.SUPABASE_SECRET_KEY}`,
      'apikey': env.SUPABASE_SECRET_KEY
    },
    body: JSON.stringify([payload])
  }).catch(e => console.error('Failed to log Green Machine telemetry:', e));

  if (ctx && ctx.waitUntil) {
    ctx.waitUntil(doFetch);
  } else {
    await doFetch;
  }
}
