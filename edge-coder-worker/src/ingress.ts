import { executeCodingPipeline } from './code_generator';

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
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }
    // 1. Protocol Restriction
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { 
        status: 405, headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
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

    // 3. Payload Extraction & Idempotency Lock
    try {
      const payload = await request.json();
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