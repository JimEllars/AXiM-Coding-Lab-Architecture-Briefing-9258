import { Env } from './ingress';

export async function dispatchToJulesAgent(payload: { repoOwner: string, repoName: string, prompt: string, taskId: string }, env: Env) {
  if (!env.JULES_API_KEY) {
    throw new Error('JULES_API_KEY is missing from environment variables');
  }

  const endpoint = 'https://jules.googleapis.com/v1alpha/sessions';

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': env.JULES_API_KEY
    },
    body: JSON.stringify({
      source: `sources/github/${payload.repoOwner}/${payload.repoName}`,
      prompt: payload.prompt,
      automationMode: 'AUTO_CREATE_PR'
    })
  });

  if (!response.ok) {
    let errorData = {};
    try {
      errorData = await response.json();
    } catch(e) {}
    console.error('Jules API Error:', response.status, JSON.stringify(errorData));
    throw new Error(`Jules API Error [HTTP ${response.status}]: Failed to delegate to Jules agent`);
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
