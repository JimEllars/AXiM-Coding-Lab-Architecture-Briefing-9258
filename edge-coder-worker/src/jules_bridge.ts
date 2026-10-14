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
  const JULES_SYSTEM_DIRECTIVES = [
    "OPERATIONAL DIRECTIVES FOR JULES RUNNER:",
    "1. DO NOT call any external MCP servers (do NOT attempt to connect to Supabase or Chatbase).",
    "2. DO NOT run 'git checkout -b' or switch branches. Stay on the current working branch.",
    "3. DO NOT run 'git push' in the terminal. Let the Jules platform submit the PR automatically.",
    "4. Run local tests and linters, commit changes locally ('git commit -m \"...\"'), and complete via your native UI completion tool.",
    "----------------------------------------"
  ].join('\n');
  const activePrompt = `${JULES_SYSTEM_DIRECTIVES}\n\n${payload.prompt || defaultPrompt}`;

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
          'Authorization': `Bearer ${((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')}`,
          'apikey': ((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')
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
        'apikey': ((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || ''),
        'Authorization': `Bearer ${((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')}`,
        'Prefer': 'return=representation'
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
    } else {
        // Publish to realtime
        await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/broadcast_task_update`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': ((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || ''),
                'Authorization': `Bearer ${((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')}`
            },
            body: JSON.stringify({ payload: { id: payload.taskId, status: 'DELEGATED_TO_EXTERNAL', session_id: sessionId }})
        }).catch(() => {});
    }

  } catch (err: any) {
    console.error('Exception logging to Supabase', err);
    // Graceful degradation: Fail the task in the database so it doesn't hang indefinitely
    try {
      await fetch(`${env.SUPABASE_URL}/rest/v1/coding_tasks?id=eq.${payload.taskId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'apikey': ((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || ''),
          'Authorization': `Bearer ${((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')}`
        },
        body: JSON.stringify({
          status: 'FAILED',
          context: {
             note: 'External Jules API failure (outage). Agent delegation aborted.'
          }
        })
      });
    } catch (patchErr) {
       console.error('Failed to gracefully degrade Jules API outage to task failure', patchErr);
    }
  }


  return data;
}

// Function to handle webhook callbacks from Jules
export async function processJulesWebhook(payload: any, env: Env) {
  const { session_id, status, diff, pr_url, error_message } = payload;

  if (!session_id) return;

  try {
    // 1. Fetch task ID based on session_id
    const taskRes = await fetch(`${env.SUPABASE_URL}/rest/v1/coding_tasks?context->>session_id=eq.${session_id}&select=id`, {
        headers: {
          'apikey': ((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || ''),
          'Authorization': `Bearer ${((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')}`
        }
    });

    if (!taskRes.ok) {
        console.error("Failed to find task for session", session_id);
        return;
    }
    const tasks = await taskRes.json() as any[];
    if (!tasks || tasks.length === 0) return;

    const taskId = tasks[0].id;

    let dbStatus = 'Review Gate'; // Default to Review Gate if diff is provided
    let dbDiff = diff;
    let metadataUpdate: any = null;

    if (status === 'FAILED') {
        dbStatus = 'FAILED';
        // log error
        await fetch(`${env.SUPABASE_URL}/rest/v1/coding_tasks_errors`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')}`,
              'apikey': ((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')
            },
            body: JSON.stringify({
              task_id: taskId,
              component: 'jules-agent',
              error_message: error_message || 'Jules Agent failed execution',
              status: 'FAILED',
              created_at: new Date().toISOString()
            })
        }).catch(() => {});
    } else if (status === 'COMPLETED' && pr_url) {
        dbStatus = 'PR_OPENED';
        metadataUpdate = { pr_url };
    } else if (pr_url) {
        dbStatus = 'Review Gate'; // Require human review
        metadataUpdate = { pr_url };
    }

    // Fetch existing context to merge metadata if needed, but per instructions update 'metadata' JSON object directly or 'context'
    // Task instructions say: "updating the metadata JSON object with the pr_url."
    // Let's assume there is a `metadata` column in `coding_tasks` based on instruction, or we just patch `metadata`.
    // We will do a PATCH with `status`, `diff`, and `metadata`.

    // Update task in DB
    const patchBody: any = {
        status: dbStatus,
        diff: dbDiff
    };
    if (metadataUpdate) {
        patchBody.metadata = metadataUpdate;
    }

    const updateRes = await fetch(`${env.SUPABASE_URL}/rest/v1/coding_tasks?id=eq.${taskId}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'apikey': ((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || ''),
            'Authorization': `Bearer ${((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')}`
        },
        body: JSON.stringify(patchBody)
    });

    if (updateRes.ok) {
         // Publish update
         await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/broadcast_task_update`, {
             method: 'POST',
             headers: {
                 'Content-Type': 'application/json',
                 'apikey': ((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || ''),
                 'Authorization': `Bearer ${((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')}`
             },
             body: JSON.stringify({ payload: { id: taskId, status: dbStatus, diff: dbDiff, pr_url }})
         }).catch(() => {});

         if (status === 'COMPLETED' && pr_url) {
             try {
                // Dispatch the X-Axim-Signature ecosystem callback webhook to the AXiM Support system
                const supportApiUrl = (env as any).SUPPORT_API_URL || 'https://support.axim.us.com';
                const callbackUrl = `${supportApiUrl.replace(/\/$/, '')}/api/v1/tasks/dispatch`;
                const payloadBody = JSON.stringify({ task_id: taskId, status: 'PATCH_READY', pr_url });

                // We need to sign this. Crypto operations in edge worker.
                // For simplicity, we can do a quick HMAC if we have the secret,
                // or just send it if generateHmacSignature isn't easily available here.
                // The instructions say "Dispatch the X-Axim-Signature ecosystem callback webhook to the AXiM Support system with status: 'PATCH_READY'."

                const cryptoKey = await crypto.subtle.importKey(
                    'raw',
                    new TextEncoder().encode((env as any).AXIM_INTERNAL_KEY || 'development-key'),
                    { name: 'HMAC', hash: 'SHA-256' },
                    false,
                    ['sign']
                );
                const signatureBuffer = await crypto.subtle.sign(
                    'HMAC',
                    cryptoKey,
                    new TextEncoder().encode(payloadBody)
                );
                const signatureArray = Array.from(new Uint8Array(signatureBuffer));
                const signatureHex = signatureArray.map(b => b.toString(16).padStart(2, '0')).join('');

                await fetch(callbackUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Axim-Signature': signatureHex
                    },
                    body: payloadBody
                }).catch(e => console.error("Error dispatching to support API", e));
             } catch (e) {
                console.error("Error signing/dispatching to support API", e);
             }
         }
    }
  } catch (err) {
      console.error("Error processing Jules webhook", err);
  }
}
