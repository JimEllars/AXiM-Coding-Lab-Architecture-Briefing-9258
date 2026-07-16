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
  GITHUB_PAT: string;
  SUPABASE_URL: string;
  SUPABASE_LLM_PROXY_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}


const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
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
        GITHUB_PAT: !!env.GITHUB_PAT
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
              'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
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
                  'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                  'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
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
               'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
               'apikey': env.SUPABASE_SERVICE_ROLE_KEY
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
                   'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
                   'apikey': env.SUPABASE_SERVICE_ROLE_KEY
                 },
                 body: JSON.stringify(errorBody)
               });

               // Transition task status to FAILED in the database
               await fetch(`${env.SUPABASE_URL}/rest/v1/coding_tasks?task_id=eq.${taskIdentifier}`, {
                method: 'PATCH',
                headers: {
                  'Content-Type': 'application/json',
                  'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
                  'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
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
  }
};

/**
 * Executes sub-millisecond HMAC verification at the Cloudflare Edge.
 */
async function verifyHmacSignature(payload: string, signature: string, secret: string): Promise<boolean> {
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
