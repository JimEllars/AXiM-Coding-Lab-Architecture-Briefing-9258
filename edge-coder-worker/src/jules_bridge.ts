import { Env } from './ingress';

export async function dispatchToJulesAgent(payload: { repoOwner: string, repoName: string, prompt: string, taskId: string }, env: Env) {
  if (!env.JULES_API_KEY) {
    throw new Error('JULES_API_KEY is missing from environment variables');
  }

  const endpoint = 'https://jules.googleapis.com/v1alpha/sessions';

    const fetchWithRetry = async (url: string, options: any, maxRetries = 3) => {
    let retries = 0;
    while (retries < maxRetries) {
      try {
        const response = await fetch(url, options);
        if (response.ok) return response;
        if (response.status === 429 || response.status >= 500) {
          const delay = Math.pow(2, retries) * 1000;
          await new Promise(res => setTimeout(res, delay));
          retries++;
          continue;
        }
        return response;
      } catch (err) {
        if (retries === maxRetries - 1) throw err;
        const delay = Math.pow(2, retries) * 1000;
        await new Promise(res => setTimeout(res, delay));
        retries++;
      }
    }
    throw new Error('Max retries reached');
  };

  const defaultPrompt = "Review full app. We need to move this web app towards full functionality. Review app and make a plan for continued development.";
  const activePrompt = payload.prompt || defaultPrompt;

  const response = await fetchWithRetry(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': env.JULES_API_KEY
    },
    body: JSON.stringify({
      source: `sources/github/${payload.repoOwner}/${payload.repoName}`,
      prompt: activePrompt,
      automationMode: 'AUTO_CREATE_PR'
    })
  });

  if (!response.ok) {
    let errorData = {};
    try {
      errorData = await response.json();
    } catch(e) {}
    console.error('Jules API Error:', response.status, JSON.stringify(errorData));

    // Log error to telemetry
    try {
      await fetch(`${env.SUPABASE_URL}/rest/v1/coding_tasks_errors`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.SUPABASE_SECRET_KEY}`,
          'apikey': env.SUPABASE_SECRET_KEY
        },
        body: JSON.stringify({
          task_id: payload.taskId,
          component: 'jules-bridge',
          error_message: `Jules API Error [HTTP ${response.status}]: Failed to delegate to Jules agent`,
          stack_trace: JSON.stringify(errorData),
          status: 'FAILED',
          created_at: new Date().toISOString()
        })
      });
    } catch (telemetryErr) {
       console.error("Failed to push to telemetry:", telemetryErr);
    }

    throw new Error(JSON.stringify({ error: `Jules API Error [HTTP ${response.status}]: Failed to delegate to Jules agent`, details: errorData }));
  }

  const data = await response.json() as any;
  const sessionId = data.name || data.id || 'unknown';

  // Log the delegation telemetry to Supabase `coding_tasks`
  try {
    const supabaseResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/coding_tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        id: payload.taskId,
        repository: payload.repoName,
        directive: payload.prompt,
        status: 'DELEGATED_TO_EXTERNAL',
        execution_engine: 'Jules_External_Agent',
        context: {
          session_id: sessionId,
          repoOwner: payload.repoOwner
        }
      })
    });

    if (!supabaseResponse.ok) {
        console.error('Failed to log Jules delegation to Supabase', await supabaseResponse.text());
    }
  } catch (err) {
    console.error('Exception logging to Supabase', err);
  }

  return data;
}
