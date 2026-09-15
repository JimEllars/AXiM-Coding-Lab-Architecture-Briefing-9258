import { executeCodingPipeline } from './code_generator';
import { mergePullRequest } from './github_bridge';

export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: any): Promise<void>;
  delete(key: string): Promise<void>;
}
export interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
}
export interface Env {
  LAB_STATE: KVNamespace;
  TASK_LOCKS: KVNamespace;
  AXIM_INTERNAL_KEY: string;
  GITHUB_TOKEN: string;
  SUPABASE_URL: string;
  SUPABASE_LLM_PROXY_URL: string;
  SUPABASE_SECRET_KEY: string;
  EMAILIT_API_KEY: string;
}


const corsHeaders = {
  'Access-Control-Allow-Origin': 'https://axim-coding-lab-dashboard.pages.dev',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Axim-Signature',
};

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }


    if (request.method === 'GET' && url.pathname === '/api/v1/health') {
      return new Response(JSON.stringify({
        LAB_STATE: !!env.LAB_STATE,
        TASK_LOCKS: !!env.TASK_LOCKS,
        AXIM_INTERNAL_KEY: !!env.AXIM_INTERNAL_KEY,
        GITHUB_TOKEN: !!env.GITHUB_TOKEN,
        SUPABASE_URL: !!env.SUPABASE_URL,
        SUPABASE_LLM_PROXY_URL: !!env.SUPABASE_LLM_PROXY_URL,
        SUPABASE_SECRET_KEY: !!env.SUPABASE_SECRET_KEY,
        EMAILIT_API_KEY: !!env.EMAILIT_API_KEY
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // 1. Protocol Restriction
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { 
        status: 405, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    // 1.5 Handle GitHub Webhooks before zero-trust
    if (url.pathname === '/api/v1/webhooks/github') {
      try {
        const signature = request.headers.get('X-Hub-Signature-256');
        if (!signature) {
          return new Response(JSON.stringify({ error: 'Unauthorized: Missing GitHub Signature' }), {
            status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const payloadText = await request.clone().text();
        const cleanSignature = signature.replace(/^sha256=/, '');
        const isVerified = await verifyHmacSignature(payloadText, cleanSignature, env.AXIM_INTERNAL_KEY);

        if (!isVerified) {
          return new Response(JSON.stringify({ error: 'Unauthorized: Invalid GitHub Signature' }), {
            status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const payload: any = await request.clone().json();

        // Handle pull request event
        if (payload.pull_request && payload.action === 'closed') {
          const prUrl = payload.pull_request.html_url;
          const isMerged = payload.pull_request.merged;
          const newStatus = isMerged ? 'COMPLETED' : 'CLOSED';

          // Query Supabase for the task using pull_request_url
          const encodedPrUrl = encodeURIComponent(prUrl);
          const selectResponse = await fetch(`${env.SUPABASE_URL}/rest/v1/coding_tasks?pull_request_url=eq.${encodedPrUrl}&select=task_id`, {
            headers: {
              'apikey': env.SUPABASE_SECRET_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SECRET_KEY}`,
            }
          });

          if (selectResponse.ok) {
            const tasks: any = await selectResponse.json();
            if (tasks && tasks.length > 0) {
              const taskId = tasks[0].task_id;

              // Update task status
              await fetch(`${env.SUPABASE_URL}/rest/v1/coding_tasks?task_id=eq.${taskId}`, {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': env.SUPABASE_SECRET_KEY,
                  'Authorization': `Bearer ${env.SUPABASE_SECRET_KEY}`,
                },
                body: JSON.stringify({ status: newStatus })
              });

              // Clear KV Lock
              await env.TASK_LOCKS.delete(`lock:${taskId}`);
            }
          }
        }

        return new Response(JSON.stringify({ status: 'received' }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Webhook processing error' }), {
          status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }
    }

    // 2. The Zero-Trust Handshake: HMAC SHA-256 Validation
    const signature = request.headers.get('X-Axim-Signature');
    if (!signature) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Missing Signature Boundary' }), { 
        status: 401, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }

    const payloadText = await request.clone().text();
    const isVerified = await verifyHmacSignature(payloadText, signature, env.AXIM_INTERNAL_KEY);
    
    if (!isVerified) {
      return new Response(JSON.stringify({ error: 'Unauthorized: Cryptographic Verification Failed' }), { 
        status: 403, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }


    if (request.method === 'POST' && url.pathname === '/api/v1/force-unlock') {
      try {
        const payload: any = JSON.parse(payloadText);
        const taskId = payload.task_id;

        if (!taskId) {
          return new Response(JSON.stringify({ error: 'Bad Request: Missing task_id' }), {
            status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        // Evict lock
        await env.TASK_LOCKS.delete("lock:" + taskId);

        // Log eviction metrics
        try {
          const errorBody = {
            task_id: taskId,
            component: 'axim-coding-lab-override',
            error_message: 'Task lock forcefully evicted via manual cockpit operator override hook.',
            status: 'FORCE_UNLOCKED',
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
        } catch (logErr) {
          console.error('[CORE_LOGGING_CRASH] Failed to record post-mortem audit', logErr);
        }

        return new Response(JSON.stringify({ status: 'success', message: 'Lock evicted' }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (error) {
         return new Response(JSON.stringify({ error: 'Internal Error' }), {
            status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
         });
      }
    }

    if (url.pathname === '/api/v1/deploy-action') {
      let taskIdentifier: string | null = null;
      try {
        const payload: any = await request.clone().json();
        const { pr_number, repository_owner, repository_name, task_id, action } = payload;
        taskIdentifier = task_id;

        if (!task_id) {
          return new Response(JSON.stringify({ error: 'Bad Request: Missing Task Identifier' }), {
            status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        if (action === 'REJECTED') {
           await env.TASK_LOCKS.delete(`lock:${taskIdentifier}`);
           return new Response(JSON.stringify({
             status: 'accepted',
             message: 'Patch rejected, task unlocked.'
           }), {
             status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
           });
        }

        if (!pr_number || !repository_owner || !repository_name) {
          return new Response(JSON.stringify({ error: 'Bad Request: Missing PR metadata' }), {
            status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const githubCtx = {
          owner: repository_owner,
          repo: repository_name,
          path: '' // not needed for PR merge
        };

        await mergePullRequest(githubCtx, pr_number, env);

        // Ensure to dispose lock on success
        if (taskIdentifier) {
           await env.TASK_LOCKS.delete(`lock:${taskIdentifier}`);
        }

        // Telemetry push to deploy action
        try {
           const prUrl = `https://github.com/${repository_owner}/${repository_name}/pull/${pr_number}`;
           const cfRay = request.headers.get('cf-ray') || 'unknown';
           const telemetryBody = [{
             app_id: 'axim-coding-lab',
             endpoint: '/api/v1/deploy-action',
             method: 'POST',
             status_code: 200,
             error_message: null,
             metadata: { task_id: taskIdentifier, trigger_origin: 'Manual_Dev_Cockpit', pull_request_target: prUrl, cf_ray: cfRay }
           }];

           await fetch(`${env.SUPABASE_URL}/rest/v1/api_usage_logs`, {
             method: 'POST',
             headers: {
               'Content-Type': 'application/json',
               'Authorization': `Bearer ${env.SUPABASE_SECRET_KEY}`,
               'apikey': env.SUPABASE_SECRET_KEY
             },
             body: JSON.stringify(telemetryBody)
           });
        } catch (telemetryErr) {
           console.error('[CORE_LOGGING_CRASH] Failed to record deployment telemetry', telemetryErr);
        }

        return new Response(JSON.stringify({
          status: 'accepted',
          message: 'Deployment action initiated'
        }), {
          status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      } catch (error: any) {
         if (taskIdentifier) {
             await env.TASK_LOCKS.delete(`lock:${taskIdentifier}`);

             // Dispatch to coding_tasks_errors
             try {
               const errorBody = {
                 task_id: taskIdentifier,
                 component: 'axim-coding-lab-deploy',
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

               // Transition task status to FAILED in the database
               await fetch(`${env.SUPABASE_URL}/rest/v1/coding_tasks?task_id=eq.${taskIdentifier}`, {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': env.SUPABASE_SECRET_KEY,
                  'Authorization': `Bearer ${env.SUPABASE_SECRET_KEY}`,
                },
                body: JSON.stringify({ status: 'FAILED' })
              });
             } catch (logErr) {
                 console.error('[CORE_LOGGING_CRASH] Failed to sync error state back to database', logErr);
             }
         }
         return new Response(JSON.stringify({ error: 'Bad Request' }), {
            status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
         });
      }
    }

    // 3. Payload Extraction & Idempotency Lock
    try {
      const payload: any = await request.json();
      payload.cf_ray = request.headers.get('cf-ray') || 'unknown';
      const taskIdentifier = payload.task_id || payload.incident_hash;

      if (!taskIdentifier) {
        return new Response(JSON.stringify({ error: 'Bad Request: Missing Task Identifier' }), { 
          status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // Query KV to ensure this specific bug/feature isn't already being coded by the swarm
      const activeLock = await env.TASK_LOCKS.get(`lock:${taskIdentifier}`);
      if (activeLock) {
        return new Response(JSON.stringify({ 
          status: 'ignored', 
          message: 'Task is currently locked and actively processing in the Lab.' 
        }), {
          status: 202, headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // Establish a 1-hour active lock for the generation cycle
      await env.TASK_LOCKS.put(`lock:${taskIdentifier}`, "active", { expirationTtl: 3600 });

      // 4. Asynchronous Cognitive Handoff
      ctx.waitUntil(executeCodingPipeline(payload, env));

      return new Response(JSON.stringify({ 
        status: 'accepted', 
        message: 'Payload verified. The Coding Lab swarm has initiated the task.',
        task_id: taskIdentifier 
      }), {
        status: 202, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

    } catch (error) {
      return new Response(JSON.stringify({ error: 'Internal Ingress Error' }), { 
        status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(sendDailyExecutiveSummary(env));
  }
};

/**
 * Executes sub-millisecond HMAC verification at the Cloudflare Edge.
 */
async function verifyHmacSignature(payload: string, signature: string, secret: string): Promise<boolean> {
  if (!secret || !/^[\da-f]{64}$/i.test(signature)) {
    return false;
  }

  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  
  const signatureBuffer = hexStringToBuffer(signature);
  return await crypto.subtle.verify('HMAC', cryptoKey, signatureBuffer, encoder.encode(payload));
}

/**
 * Utility: Converts hex signature headers into ArrayBuffers for Web Crypto API.
 */
function hexStringToBuffer(hexString: string): ArrayBuffer {
  const matchedPairs = hexString.match(/[\da-f]{2}/gi) || [];
  const typedArray = new Uint8Array(matchedPairs.map((h) => parseInt(h, 16)));
  return typedArray.buffer;
}

async function sendDailyExecutiveSummary(env: Env): Promise<void> {
  if (!env.EMAILIT_API_KEY) {
    throw new Error('EMAILIT_API_KEY is required for the daily executive summary.');
  }

  const startOfDay = new Date();
  startOfDay.setUTCHours(9, 0, 0, 0);
  startOfDay.setUTCDate(startOfDay.getUTCDate() - 1);
  const since = encodeURIComponent(startOfDay.toISOString());
  const headers = {
    apikey: env.SUPABASE_SECRET_KEY,
    Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`,
  };

  const [tasksResponse, telemetryResponse] = await Promise.all([
    fetch(`${env.SUPABASE_URL}/rest/v1/coding_tasks?created_at=gte.${since}&select=status`, { headers }),
    fetch(`${env.SUPABASE_URL}/rest/v1/api_usage_logs?created_at=gte.${since}&select=metadata`, { headers }),
  ]);

  if (!tasksResponse.ok || !telemetryResponse.ok) {
    throw new Error(`Unable to create daily summary: tasks=${tasksResponse.status}, telemetry=${telemetryResponse.status}.`);
  }

  const tasks: Array<{ status: string | null }> = await tasksResponse.json();
  const telemetry: Array<{ metadata: { tokens?: number } | null }> = await telemetryResponse.json();
  const statusCounts = tasks.reduce<Record<string, number>>((counts, task) => {
    const status = task.status || 'UNKNOWN';
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const tokenCount = telemetry.reduce((total, record) => total + (record.metadata?.tokens || 0), 0);
  const period = `${startOfDay.toISOString().slice(0, 10)} 04:00 EST through ${new Date().toISOString().slice(0, 10)} 04:00 EST`;
  const statusSummary = Object.entries(statusCounts)
    .map(([status, count]) => `${status}: ${count}`)
    .join(', ') || 'No tasks';
  const text = [
    'AXiM Coding Lab daily executive summary',
    `Period: ${period}`,
    `Tasks received: ${tasks.length}`,
    `Task statuses: ${statusSummary}`,
    `Recorded token usage: ${tokenCount.toLocaleString()}`,
    'Human review is required before merging any autonomous remediation pull request.',
  ].join('\n');

  const response = await fetch('https://api.emailit.com/v2/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.EMAILIT_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'AXiM Coding Lab <coding-lab@axim.us.com>',
      to: ['james.ellars@axim.us.com'],
      bcc: ['jrellars@gmail.com'],
      subject: `AXiM Coding Lab executive summary - ${new Date().toISOString().slice(0, 10)}`,
      text,
      html: `<h1>AXiM Coding Lab daily executive summary</h1><p><strong>Period:</strong> ${period}</p><ul><li>Tasks received: ${tasks.length}</li><li>Task statuses: ${statusSummary}</li><li>Recorded token usage: ${tokenCount.toLocaleString()}</li></ul><p>Human review is required before merging any autonomous remediation pull request.</p>`,
    }),
  });

  if (!response.ok) {
    throw new Error(`EmailIt rejected daily summary delivery: ${response.status}.`);
  }
}
