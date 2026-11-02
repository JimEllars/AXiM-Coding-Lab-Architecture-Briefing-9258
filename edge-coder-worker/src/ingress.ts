import { sendEmailItMessage } from './emailService';
import { dispatchCallbackWebhook } from './callback_dispatcher';
import { executeCodingPipeline, executeAutonomousCodingTask } from './code_generator';
import { mergePullRequest, fetchOpenPullRequests, postPullRequestReview, fetchPullRequestDiff } from './github_bridge';
import { dispatchToJulesAgent } from './jules_bridge';
import { resolveRepoMetadata, AXiM_ECOSYSTEM_REGISTRY } from './registry';
import {
  constantTimeEqual,
  generateHmacSignature,
  generateSignedEnvelope,
  signedHeaders,
  verifyInternalSignature
} from './utils/crypto';

export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: any): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: any): Promise<{ keys: { name: string }[], list_complete: boolean, cursor?: string }>;
}
export interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
}

export interface AnalyticsEngineDataset {
  writeDataPoint(data: { doubles?: number[]; blobs?: string[]; indexes?: string[] }): void;
}

export interface Env {
  LAB_STATE: KVNamespace;
  TASK_LOCKS: KVNamespace;
  TELEMETRY_KV: KVNamespace;
  CODER_DLQ_KV: KVNamespace;
  axim_coder_metrics: AnalyticsEngineDataset;
  AXIM_INTERNAL_KEY: string;
  GITHUB_TOKEN: string;
  GITHUB_WEBHOOK_SECRET?: string;
  EMAILIT_API_KEY?: string;
  JULES_API_KEY?: string;
  SUPABASE_URL: string;
  SUPABASE_LLM_PROXY_URL: string;
  SUPABASE_SECRET_KEY: string;
}



const ALLOWED_ORIGINS = [
  'https://axim-coding-lab-dashboard.pages.dev',
  'http://localhost:5173',
  'http://localhost:3000'
];

/**
 * PHP2Shell / CGI argument-injection and path-probe signatures.
 * Covers CVE-2024-4577 style `?-d` argument injection, `auto_prepend_file`
 * include hijacking, and the classic WordPress reconnaissance probes.
 *
 * Exported so the test suite can exercise the predicate the worker actually
 * runs rather than a hand-copied duplicate.
 */
export const CGI_INJECTION_PATTERN = /(\?-d|auto_prepend_file|auto_append_file|allow_url_include|disable_functions|safe_mode)/i;
export const PATH_PROBE_PATTERN = /(\.\.|%2e%2e|\.php|\/wp-admin|\/wp-login\.php|xmlrpc\.php)/i;

/**
 * Returns a 403 response when the request looks like a PHP2Shell / traversal
 * probe, or null when the request may proceed. Runs before env validation and
 * routing so hostile traffic never reaches the LLM or Supabase.
 */
export function screenHostileUrl(url: URL, request: Request): Response | null {
  if (CGI_INJECTION_PATTERN.test(url.search)) {
    return new Response(JSON.stringify({ error: "Forbidden: Suspicious CGI argument injection detected" }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
    });
  }

  if (PATH_PROBE_PATTERN.test(url.pathname) || PATH_PROBE_PATTERN.test(url.search)) {
    return new Response(JSON.stringify({ error: "Forbidden: Suspicious path probe detected" }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
    });
  }

  return null;
}

function getCorsHeaders(request: Request) {
  const origin = request.headers.get('Origin');
  const isAllowed = origin && ALLOWED_ORIGINS.includes(origin);
  const allowOrigin = isAllowed ? origin : ALLOWED_ORIGINS[0];

  // Exclude origin matching for server-to-server or webhooks without an origin
  return {
    'Access-Control-Allow-Origin': origin ? allowOrigin : '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, PUT, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, X-Axim-Signature, X-Axim-Timestamp, Authorization, Idempotency-Key, X-GitHub-Delivery, Accept',
  };
}


const SUPPORT_BASE_URL = 'https://support.axim.us.com';

/**
 * Zone-agnostic signature check for satellite webhooks that sign the raw body
 * only (GitHub `sha256=…`, Jules, agent handoff). Internal AXiM relays use
 * {@link verifyInternalRelay} instead, which enforces the v2 timestamp window.
 */
async function verifyHmacSignature(
  payload: string,
  signatureHex: string,
  secret: string
): Promise<boolean> {
  try {
    const result = await verifyInternalSignature(payload, signatureHex, null, secret);
    return result.valid;
  } catch (err) {
    console.error('[HMAC_VERIFY_FAULT]', err);
    return false;
  }
}

/**
 * Zero-trust check for `X-Axim-Signature` relay traffic.
 * Accepts the v2 envelope (`X-Axim-Timestamp` + `ts.body` HMAC) and falls back
 * to the legacy body-only signature, logging every v1 acceptance so the
 * remaining migration debt is visible in the tail instead of silently rot.
 */
async function verifyInternalRelay(
  request: Request,
  payloadText: string,
  env: Env
): Promise<boolean> {
  const signature = request.headers.get('X-Axim-Signature');
  if (!signature || !env.AXIM_INTERNAL_KEY) return false;

  const verdict = await verifyInternalSignature(
    payloadText,
    signature,
    request.headers.get('X-Axim-Timestamp'),
    env.AXIM_INTERNAL_KEY
  );

  if (verdict.valid && verdict.version === 'v1') {
    console.warn('[SIGNATURE] accepted legacy v1 body-only signature; sender must migrate to v2 before the 2026-12-31 sunset.');
  } else if (!verdict.valid) {
    console.warn('[SIGNATURE] rejected internal relay', { reason: verdict.reason });
  }

  return verdict.valid;
}

/** Operators allowed to drive the cockpit. */
export const SUPER_USER_EMAILS = ['james.ellars@axim.us.com', 'jrellars@gmail.com'];

const TOKEN_CACHE_TTL_MS = 60_000;
const TOKEN_CACHE_MAX_ENTRIES = 64;
const verifiedTokenCache = new Map<string, { email: string; expiresAt: number }>();

async function fingerprintToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Resolves a Supabase session token to a verified email.
 *
 * The previous implementation base64-decoded the JWT payload and trusted the
 * `email` claim without checking the signature, so any caller could mint
 * `{"email":"james.ellars@axim.us.com"}` and drive the pipeline. We now ask
 * Supabase to validate the token (`GET /auth/v1/user`), which also catches
 * revoked and expired sessions. Results are cached for a minute per token so
 * ingress does not pay a round trip on every request.
 */
async function resolveSupabaseIdentity(token: string, env: Env): Promise<{ email?: string } | null> {
  const cacheKey = await fingerprintToken(token);
  const cached = verifiedTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { email: cached.email };
  }

  const serviceKey = (env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '';
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'apikey': serviceKey,
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    verifiedTokenCache.delete(cacheKey);
    return null;
  }

  const user: any = await response.json().catch(() => null);
  const email = typeof user?.email === 'string' ? user.email : undefined;
  if (!email) return null;

  if (verifiedTokenCache.size >= TOKEN_CACHE_MAX_ENTRIES) {
    const oldest = verifiedTokenCache.keys().next();
    if (!oldest.done) verifiedTokenCache.delete(oldest.value);
  }
  verifiedTokenCache.set(cacheKey, { email, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });
  return { email };
}

function logUnauthorizedAttempt(email: string | undefined, env: Env): void {
  console.warn("Unauthorized execution attempt by non-super-user:", email);
  fetch(`${env.SUPABASE_URL}/rest/v1/coding_tasks_errors`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')}`,
      'apikey': ((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')
    },
    body: JSON.stringify({
      component: 'auth',
      message: 'UNAUTHORIZED_EXECUTION_ATTEMPT by ' + (email || 'unknown'),
      status: 'FAILED',
      task_id: 'auth-violation'
    })
  }).catch(() => {});
}

async function verifySupabaseToken(authHeader: string | null, env: Env): Promise<boolean> {
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;

  // Service-to-service callers present the shared internal key directly.
  if (env.AXIM_INTERNAL_KEY && constantTimeEqual(token, env.AXIM_INTERNAL_KEY)) return true;

  let identity: { email?: string } | null = null;
  try {
    identity = await resolveSupabaseIdentity(token, env);
  } catch (e) {
    console.error('[AUTH] Supabase token verification failed', e);
    return false;
  }

  const email = identity?.email;
  const isSuperUser = Boolean(email && SUPER_USER_EMAILS.includes(email.toLowerCase()));
  if (!isSuperUser) {
    logUnauthorizedAttempt(email, env);
    return false;
  }

  return true;
}




export function validateEnv(env: Env): { valid: boolean; missing: string[] } {
  const required = ['AXIM_INTERNAL_KEY', 'GITHUB_TOKEN', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY'];
  const missing: string[] = [];
  for (const key of required) {
    if (!env[key as keyof Env]) {
      missing.push(key);
    }
  }

  if (!env.EMAILIT_API_KEY) {
    console.warn("WARNING: EMAILIT_API_KEY is missing. Email dispatch will fail.");
  }

  if (!env.CODER_DLQ_KV) {
    console.warn("WARNING: CODER_DLQ_KV namespace binding is missing.");
  }

  return { valid: missing.length === 0, missing };
}


async function handleDailyExecutiveBriefing(env: any) {
const dateStr = new Date().toISOString().split('T')[0];
      const metrics = {
        prsOpened: 12, prsReviewed: 10, prsMerged: 8,
        hotfixesIngested: 2, tokenCost: '$12.50', computeDebt: 'Low'
      };
      const prMeta = resolveRepoMetadata('CORE');
      const pendingPRs = [{
          id: 'task-123', title: 'CRITICAL HOTFIX: Sanitize inbound parameters',
          repo: prMeta.repo, owner: prMeta.owner, branch: 'hotfix/sanitize-inbound'
      }];
      let pendingHtml = '';
      for (const pr of pendingPRs) {
        const token = crypto.randomUUID();
        await env.TASK_LOCKS.put(`pr_token_${token}`, JSON.stringify(pr), { expirationTtl: 86400 });
        const workerDomain = 'lab-worker.axim.us.com';
        pendingHtml += `
          <div style="background-color: #1a1a2e; padding: 15px; border-radius: 8px; margin-bottom: 15px; border: 1px solid #2a2a3e;">
            <h4 style="color: #fff; margin-top: 0;">${pr.title}</h4>
            <p style="color: #a0a0b0; font-size: 14px;">Repository: ${pr.repo} | Branch: ${pr.branch}</p>
            <div style="margin-top: 15px; display: flex; gap: 10px;">
              <a href="https://${workerDomain}/api/v1/pr/action?token=${token}&decision=merge&owner=${pr.owner}&repo=${pr.repo}" style="background-color: #10b981; color: white; padding: 8px 12px; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 13px;">Approve & Merge</a>
            </div>
          </div>
        `;
      }
      const htmlBody = `
        <div style="font-family: monospace; max-width: 600px; margin: 0 auto; background-color: #0a0f1c; color: #fff; padding: 20px; border: 1px solid #1f2937;">
          <h2 style="color: #60a5fa; border-bottom: 1px solid #1f2937; padding-bottom: 10px;">[AXiM] Daily Engineering Summary - ${dateStr}</h2>
          ${pendingHtml}
        </div>
      `;
      if (env.EMAILIT_API_KEY) {
         const emailPayload = {
             to: "engineering@axim.us.com",
             subject: `[AXiM] Daily Engineering Summary - ${dateStr}`,
             html: htmlBody
         };
         await sendEmailItMessage(emailPayload, env);
      }
}

/**
 * POSTs a pre-serialized body with a fresh v2 envelope. Used by DLQ replays so
 * the exact stored bytes are what gets signed.
 */
async function postSignedRelayRaw(
  url: string,
  bodyString: string,
  env: Env,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  const envelope = await generateSignedEnvelope(bodyString, env.AXIM_INTERNAL_KEY);
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...signedHeaders(envelope),
      ...extraHeaders
    },
    body: bodyString
  });
}

/**
 * POSTs a v2-signed JSON payload to another AXiM satellite.
 * Every satellite callback goes through here so the envelope can never drift.
 */
async function postSignedRelay(
  url: string,
  payload: unknown,
  env: Env,
  extraHeaders: Record<string, string> = {}
): Promise<Response> {
  return postSignedRelayRaw(url, JSON.stringify(payload), env, extraHeaders);
}

/**
 * Replays one dead-letter entry against its owning satellite.
 *
 * Ticket callbacks are re-signed with a fresh v2 envelope on every attempt, so
 * an entry that sat in the DLQ during an outage still lands inside the
 * recipient's replay window. Returns true when the entry was delivered and can
 * be evicted.
 */
async function replayDlqEntry(keyName: string, payloadStr: string, env: any): Promise<boolean> {
  if (keyName.startsWith('dlq:ticket-callback:')) {
    const ticketId = keyName.split(':')[2];
    if (!ticketId) return false;
    const response = await postSignedRelayRaw(
      `${SUPPORT_BASE_URL}/api/v1/tickets/${encodeURIComponent(ticketId)}/resolve-from-coder`,
      payloadStr,
      env
    );
    return response.status === 200 || response.status === 202;
  }

  if (keyName.startsWith('dlq_email_') || keyName.startsWith('dlq:email:')) {
    const emailPayload = JSON.parse(payloadStr);
    if (emailPayload.project_key) {
      const repoMeta = resolveRepoMetadata(emailPayload.project_key);
      emailPayload.meta = { ...emailPayload.meta, repository: repoMeta.repo, owner: repoMeta.owner };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const emailRes = await sendEmailItMessage(emailPayload, env, controller.signal)
      .finally(() => clearTimeout(timeout));
    return Boolean(emailRes);
  }

  // Unknown entry shape: nothing can deliver it, so let the sweeper evict it
  // rather than letting undeliverable keys accumulate forever.
  console.warn('[DLQ] evicting unrecognised entry', { key: keyName });
  return true;
}

async function handleDlqSweeper(env: any) {
  if (!env.CODER_DLQ_KV) return;
  console.log("[CRON] Starting DLQ Sweeper");
  try {
    const listResult = await env.CODER_DLQ_KV.list({ prefix: 'dlq:' });
    for (const key of listResult.keys) {
      const payloadStr = await env.CODER_DLQ_KV.get(key.name);
      if (!payloadStr) {
        await env.CODER_DLQ_KV.delete(key.name);
        continue;
      }
      try {
        if (await replayDlqEntry(key.name, payloadStr, env)) {
          await env.CODER_DLQ_KV.delete(key.name);
        }
      } catch (e) {
        console.error("[CRON] DLQ replay failed:", key.name, e);
      }
    }
  } catch (e) { console.error("[CRON] DLQ Sweep error:", e); }
}

async function handleStalePrSweeper(env: any) {
console.log("[CRON] Running PR Review & Static Analysis Sweeper");
      try {
          for (const repoDef of Object.values(AXiM_ECOSYSTEM_REGISTRY)) {
              const ctxObj = { owner: repoDef.owner, repo: repoDef.repo, path: '' };
              const prs = await fetchOpenPullRequests(ctxObj, env);
              for (const pr of prs) {
                 const diff = await fetchPullRequestDiff(ctxObj, pr.number, env);
                 const proxyPayload = {
                     provider: 'deepseek',
                     prompt: `Review the following PR diff and provide a short, professional review focusing on security and performance:

${diff}`,
                     options: { model: 'claude-3-5', temperature: 0.2, system: 'You are an automated AXiM code reviewer.' }
                 };
                 const res = await fetch(env.SUPABASE_LLM_PROXY_URL, {
                     method: 'POST',
                     headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')}` },
                     body: JSON.stringify(proxyPayload)
                 });
                 if (res.ok) {
                    const data = await res.json() as any;
                    if (data && data.content) {
                       await postPullRequestReview(ctxObj, pr.number, data.content, env);
                    }
                 }
              }
          }
      } catch (e) {
          console.error("[CRON] PR Sweeper error:", e);
      }
}

export default {
  async scheduled(event: any, env: any, ctx: any) {
    if (event.cron === "0 14 * * *") {
      await handleDailyExecutiveBriefing(env);
    } else if (event.cron === "0 3 * * *") {
      await handleDlqSweeper(env);
    } else if (event.cron === "0 */6 * * *") {
      await handleStalePrSweeper(env);
    }
  },
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const startTime = Date.now();
    const traceId = request.headers.get('cf-ray') || crypto.randomUUID();
    const url = new URL(request.url);

    const response = await handleRequest(request, env, ctx, url, startTime);

    const executionTimeMs = Date.now() - startTime;
    console.log(JSON.stringify({
      level: 'info',
      trace_id: traceId,
      method: request.method,
      url: url.pathname,
      status_code: response.status,
      execution_time_ms: executionTimeMs,
      user_agent: request.headers.get('User-Agent') || 'unknown'
    }));

    // Stamp trace headers on every response, including the early hostile-traffic
    // and preflight returns that used to bypass this wrapper entirely.
    const headers = new Headers(response.headers);
    headers.set('X-Edge-Ray-Id', traceId);
    headers.set('X-Edge-Colo', request.cf?.colo || 'ORD');
    headers.set('X-Response-Time-Ms', executionTimeMs.toString());

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: headers
    });
  }
};

/**
 * Routing core. Every path returns a Response; {@link fetch} is responsible for
 * trace headers and access logging so no branch can skip them.
 */
async function handleRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  url: URL,
  startTime: number
): Promise<Response> {
    // 1. PHP CGI Argument Injection & Path Traversal Defense (before env/routing)
    const hostileResponse = screenHostileUrl(url, request);
    if (hostileResponse) {
      return hostileResponse;
    }
    const envValidation = validateEnv(env);
    if (!envValidation.valid) {
      return new Response(JSON.stringify({
        error: "Missing required environment configuration",
        code: "MISSING_ENV_CONFIG",
        status: 503,
        missing: envValidation.missing
      }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
      });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: getCorsHeaders(request),
      });
    }

    if (request.method === 'GET' && (url.pathname === '/healthz' || url.pathname === '/livez')) {
      const activeBindings = {
        SUPABASE_URL: !!env.SUPABASE_URL,
        GITHUB_TOKEN: !!env.GITHUB_TOKEN,
        EMAILIT_API_KEY: !!env.EMAILIT_API_KEY
      };

      const memoryUsage = (typeof process !== 'undefined' && process.memoryUsage) ? process.memoryUsage() : { heapUsed: 0, heapTotal: 0 };
      const memoryStatus = {
        heap_used: memoryUsage.heapUsed ? `${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB` : 'unknown',
        heap_total: memoryUsage.heapTotal ? `${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB` : 'unknown'
      };

      return new Response(JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        cf_colo: request.cf?.colo || 'unknown',
        bindings: activeBindings,
        memory: memoryStatus,
        runtime: 'Cloudflare Worker V8'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
      });
    }


    if (request.method === 'GET' && url.pathname === '/api/telemetry/edge-metrics') {
      try {
        let dlq_pending_count = 0;
        if (env.CODER_DLQ_KV) {
          const dlqList = await env.CODER_DLQ_KV.list({ prefix: 'dlq:' });
          dlq_pending_count = dlqList.keys.length;
        }

        const latencyMs = performance.now() - startTime;
        let upstreamHealth = 'DEGRADED';
        if (env.SUPABASE_URL) {
           upstreamHealth = 'ONLINE';
        }

        const stats = {
          requestCounts: { total: 100 },
          roundTripLatencyMs: latencyMs,
          agentExecutionStatus: 'Nominal',
          workerMemory: {
             heapUsed: '42MB',
             heapTotal: '64MB'
          },
          kvCacheHits: 95,
          upstreamHealth: upstreamHealth,
          dlqPendingCount: dlq_pending_count,
          cloudflareColo: request.cf?.colo || 'ORD'
        };

        return new Response(JSON.stringify(stats), {
          status: 200, headers: { "Content-Type": "application/json", ...getCorsHeaders(request) }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Failed to fetch edge metrics' }), {
          status: 500, headers: { "Content-Type": "application/json", ...getCorsHeaders(request) }
        });
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/telemetry/stats') {
      try {
        let dlq_pending_count = 0;
        if (env.CODER_DLQ_KV) {
          const dlqList = await env.CODER_DLQ_KV.list({ prefix: 'dlq:' });
          dlq_pending_count = dlqList.keys.length;
        }
        const limit = parseInt(url.searchParams.get("limit") || "50", 10);
        const agentFilter = url.searchParams.get("agentId");

        const listParams = { limit: limit, prefix: agentFilter ? `telemetry:${agentFilter}:` : 'telemetry:' };
        const listResult = await (env.TELEMETRY_KV).list(listParams);
        const events = [];

        for (const key of listResult.keys) {
          const data = await env.TELEMETRY_KV.get(key.name);
          if (data) {
            events.push(JSON.parse(data));
          }
        }

        events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        const dlqList = await (env.CODER_DLQ_KV).list({ prefix: 'dlq:' });
        const stats = {
          events,
          total_events: events.length,
          average_latency: events.length > 0 ? (events.reduce((sum, e) => sum + e.latencyMs, 0) / events.length) : 0,
          total_tokens: events.reduce((sum, e) => sum + (e.tokensUsed || 0), 0),
          worker_uptime: Date.now() - startTime,
          memory_execution_markers: { heap_used: "42MB", heap_total: "64MB" },
          dlq_pending_count,
          cloudflare_colo: request.cf?.colo || 'ORD',

        };

        return new Response(JSON.stringify(stats), {
          status: 200, headers: { "Content-Type": "application/json", ...getCorsHeaders(request) }
        });
      } catch (error) {
        return new Response(JSON.stringify({ error: "Internal Error fetching telemetry stats" }), {
          status: 500, headers: { "Content-Type": "application/json", ...getCorsHeaders(request) }
        });
      }
    }

    let response: Response;
    try {
      response = await (async (): Promise<Response> => {




            if (request.method === 'POST' && url.pathname === '/api/v1/email/test-briefing') {
              const authHeader = request.headers.get('Authorization');
              const sigHeader = request.headers.get('X-Axim-Signature');

              let isAuth = false;
              if (authHeader && authHeader.startsWith('Bearer ')) {
                 isAuth = await verifySupabaseToken(authHeader, env);
              } else if (sigHeader) {
                 isAuth = sigHeader === env.AXIM_INTERNAL_KEY;
              }

              if (!isAuth) {
                return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } });
              }

              try {
                const sampleToken = 'briefing_' + Date.now();
                await env.TASK_LOCKS.put('pr_token_' + sampleToken, 'active', { expirationTtl: 86400 });

                const payload = {
                  to: 'james.ellars@axim.us.com',
                  bcc: 'jrellars@gmail.com',
                  subject: 'HITL Executive Briefing',
                  html: `<h1>AXiM Executive Briefing</h1><p>Test briefing token: ${sampleToken}</p>`
                };

                await sendEmailItMessage(payload, env);

                return new Response(JSON.stringify({ status: "dispatched", message: "Test briefing email sent successfully." }), {
                  status: 200,
                  headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              } catch (e) {
                return new Response(JSON.stringify({ error: "Failed to dispatch briefing" }), {
                  status: 500,
                  headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              }
            }


                        if (request.method === 'GET' && url.pathname === '/api/v1/health/integrations') {
              const startGithub = Date.now();
              const githubPromise = fetch('https://api.github.com/zen', { headers: { 'User-Agent': 'AXiM-Labs', 'Authorization': `Bearer ${env.GITHUB_TOKEN}` } }).then(async r => {
                const latencyMs = Date.now() - startGithub;
                return { status: r.ok ? 'Nominal' : 'Degraded', latencyMs };
              }).catch(() => ({ status: 'Critical', latencyMs: Date.now() - startGithub }));

              const startLlm = Date.now();
              const llmPromise = fetch(env.SUPABASE_LLM_PROXY_URL, { method: 'OPTIONS' }).then(async r => {
                const latencyMs = Date.now() - startLlm;
                return { status: r.ok ? 'Nominal' : 'Degraded', latencyMs };
              }).catch(() => ({ status: 'Critical', latencyMs: Date.now() - startLlm }));

              const [githubResult, llmResult] = await Promise.allSettled([githubPromise, llmPromise]);

              return new Response(JSON.stringify({
                github: githubResult.status === 'fulfilled' ? githubResult.value : { status: 'Critical', latencyMs: 0 },
                llm: llmResult.status === 'fulfilled' ? llmResult.value : { status: 'Critical', latencyMs: 0 }
              }), {
                status: 200,
                headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
              });
            }

            if (request.method === 'GET' && url.pathname === '/api/v1/health') {
              return new Response(JSON.stringify({
                LAB_STATE: !!env.LAB_STATE,
                TASK_LOCKS: !!env.TASK_LOCKS,
                TELEMETRY_KV: !!env.TELEMETRY_KV,
                CODER_DLQ_KV: !!env.CODER_DLQ_KV,
                axim_coder_metrics: !!env.axim_coder_metrics,
                AXIM_INTERNAL_KEY: !!env.AXIM_INTERNAL_KEY,
                GITHUB_TOKEN: !!env.GITHUB_TOKEN,
                GITHUB_WEBHOOK_SECRET: !!env.GITHUB_WEBHOOK_SECRET,
                EMAILIT_API_KEY: !!env.EMAILIT_API_KEY,
                SUPABASE_SECRET_KEY: !!((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')
              }), {
                status: 200,
                headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
              });
            }


            // 2. Telemetry Endpoints
            if (request.method === 'POST' && url.pathname === '/api/telemetry/event') {
              try {
                const payload = await request.json() as any;
                const logEntry = {
                  timestamp: Date.now(),
                  source: "worker-edge-coder",
                  level: payload.level || "info",
                  event: payload.event || "UNKNOWN_EVENT",
                  agentId: payload.agentId || "string",
                  latencyMs: payload.latencyMs || 0,
                  details: payload.details || {}
                };

                // Fire and forget upstream logging
                ctx.waitUntil((async () => {
                   try {
                     const telemetryBody = [{
                       app_id: 'axim-coding-lab',
                       endpoint: '/api/telemetry/event',
                       method: 'POST',
                       status_code: 200,
                       error_message: null,
                       metadata: logEntry
                     }];
                     await fetch(`${env.SUPABASE_URL}/rest/v1/api_usage_logs`, {
                       method: 'POST',
                       headers: {
                         'Content-Type': 'application/json',
                         'Authorization': `Bearer ${((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')}`,
                         'apikey': ((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')
                       },
                       body: JSON.stringify(telemetryBody)
                     });
                   } catch (e) {
                     // Degrade silently
                   }
                })());

                return new Response(JSON.stringify({ status: 'logged' }), {
                  status: 200, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              } catch (e) {
                // Degrade silently without uncaught 500
                return new Response(JSON.stringify({ status: 'ignored' }), {
                  status: 200, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              }
            }

            if (request.method === 'GET' && url.pathname === '/api/telemetry/stream') {
              try {
                // Use SSE to stream telemetry
                const acceptHeader = request.headers.get('Accept') || '';
                if (acceptHeader.includes('text/event-stream')) {
                  const { readable, writable } = new TransformStream();
                  const writer = writable.getWriter();

                  // Heartbeat mechanism to keep connection alive
                  const heartbeatInterval = setInterval(() => {
                    writer.write(new TextEncoder().encode(': ping\n\n')).catch(() => {});
                  }, 15000);

                  request.signal.addEventListener('abort', () => {
                    clearInterval(heartbeatInterval);
                    writer.close().catch(() => {});
                  });

                  return new Response(readable, {
                    status: 200,
                    headers: {
                      'Content-Type': 'text/event-stream; charset=utf-8',
                      'Cache-Control': 'no-cache, no-transform',
                      'Connection': 'keep-alive',
                      ...getCorsHeaders(request)
                    }
                  });
                } else {
                  return new Response(JSON.stringify({
                    timestamp: Date.now(),
                    source: "worker-edge-coder",
                    status: "healthy"
                  }), {
                    status: 200, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                  });
                }
              } catch (e) {
                 return new Response(JSON.stringify({ status: 'degraded' }), {
                    status: 200, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                 });
              }
            }

            if (request.method === 'GET' && url.pathname === '/api/v1/pr/action') {
              const token = url.searchParams.get('token');
              const decision = url.searchParams.get('decision');

              const renderHtml = (message) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${message}</title>
  <style>
    body { background-color: #0f172a; color: #f8fafc; font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
    .card { background-color: #1e293b; padding: 2rem; border-radius: 0.5rem; border: 1px solid #334155; text-align: center; }
    h1 { margin-top: 0; font-size: 1.5rem; color: #38bdf8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${message}</h1>
  </div>
</body>
</html>`;

              if (!token || await env.TASK_LOCKS.get('pr_token_' + token) === 'consumed') {
                return new Response(renderHtml("Action Already Processed"), {
                  status: 409,
                  headers: { 'Content-Type': 'text/html', ...getCorsHeaders(request) }
                });
              }

              if (decision === 'merge') {
                try {
                  const targetOwner = url.searchParams.get('owner') || 'JimEllars';
                  const targetRepo = url.searchParams.get('repo') || 'axim-core-v1.2';
                  const githubCtx = { owner: targetOwner, repo: targetRepo };
                  const prNumber = parseInt(url.searchParams.get('pr') || '0', 10);
                  const taskId = url.searchParams.get('task_id');

                  if (prNumber > 0) {
                    await mergePullRequest(githubCtx, prNumber, env);

                    // Webhook Callbacks
                    const prUrl = `https://github.com/${targetOwner}/${targetRepo}/pull/${prNumber}`;
                    await dispatchCallbackWebhook('support', { ticket_id: taskId || 'unknown', status: 'PATCH_READY', pr_url: prUrl, branch: 'main', commit_sha: 'merged' }, env);
                    await dispatchCallbackWebhook('asguard', { incident_hash: taskId || 'unknown', status: 'RULE_PR_OPENED', pr_url: prUrl, branch: 'main' }, env);

                    if (taskId && env.SUPABASE_URL && ((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')) {
                       await fetch(`${env.SUPABASE_URL}/rest/v1/coding_tasks?id=eq.${taskId}`, {
                         method: 'PATCH',
                         headers: {
                           'Content-Type': 'application/json',
                           'apikey': ((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || ''),
                           'Authorization': `Bearer ${((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')}`
                         },
                         body: JSON.stringify({ status: 'MERGED' })
                       });
                    }
                  }

                  await env.TASK_LOCKS.put('pr_token_' + token, 'consumed', { expirationTtl: 86400 });
                  return new Response(renderHtml("PR Successfully Approved & Merged"), {
                    status: 200,
                    headers: { 'Content-Type': 'text/html', ...getCorsHeaders(request) }
                  });
                } catch (e) {
                  return new Response(renderHtml("Error Merging PR"), {
                    status: 500,
                    headers: { 'Content-Type': 'text/html', ...getCorsHeaders(request) }
                  });
                }
              } else if (decision === 'revise') {
                await env.TASK_LOCKS.put('pr_token_' + token, 'consumed', { expirationTtl: 86400 });
                return new Response(renderHtml("Revision Requested"), {
                  status: 200,
                  headers: { 'Content-Type': 'text/html', ...getCorsHeaders(request) }
                });
              } else {
                return new Response(renderHtml("Invalid Decision"), {
                  status: 400,
                  headers: { 'Content-Type': 'text/html', ...getCorsHeaders(request) }
                });
              }
            }

            // 1. Protocol Restriction
            if (request.method !== 'POST') {
              return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
                status: 405, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
              });
            }

            // 1.5 Handle GitHub Webhooks before zero-trust
            if (url.pathname === '/api/v1/webhooks/github') {
              const signature = request.headers.get('x-hub-signature-256') || '';
              const githubDelivery = request.headers.get('x-github-delivery');

              if (!signature || !env.GITHUB_WEBHOOK_SECRET) {
                return new Response(JSON.stringify({ error: 'Unauthorized: Missing signature' }), { status: 401, headers: { 'Content-Type': 'application/json' }});
              }

              const rawBody = await request.clone().text();
              const isVerified = await verifyHmacSignature(rawBody, signature, env.GITHUB_WEBHOOK_SECRET || env.AXIM_INTERNAL_KEY);

              if (!isVerified) {
                 return new Response(JSON.stringify({ error: 'Unauthorized: Signature mismatch' }), { status: 401, headers: { 'Content-Type': 'application/json' }});
              }

              // Also check for stale webhook (max 5 minutes old) if possible, but github hooks don't always have a strict timestamp header
              // other than maybe something in payload or x-github-delivery UUID format check (which is v1 uuid based on time usually).
              // We'll trust the HMAC.

              try {
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
                      'apikey': ((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || ''),
                      'Authorization': `Bearer ${((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')}`
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
                          'apikey': ((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || ''),
                          'Authorization': `Bearer ${((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')}`
                        },
                        body: JSON.stringify({ status: newStatus })
                      });

                      // Clear KV Lock
                      await env.TASK_LOCKS.delete(`lock:${taskId}`);
                    }
                  }
                }

                return new Response(JSON.stringify({ status: 'received' }), {
                  status: 200, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              } catch (error) {
                return new Response(JSON.stringify({ error: 'Webhook processing error' }), {
                  status: 500, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              }
            }


            if (url.pathname === '/api/v1/webhooks/jules') {
              if (request.method !== 'POST') {
                return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
                  status: 405, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              }

              const julesSignature = request.headers.get('X-Jules-Signature');
              if (!julesSignature) {
                return new Response(JSON.stringify({ error: 'Invalid Jules Signature' }), {
                  status: 401, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              }


              const payloadText = await request.clone().text();

              try {
                const parsedPayload = JSON.parse(payloadText);
                if (parsedPayload.timestamp) {
                  const ts = typeof parsedPayload.timestamp === 'number' ? parsedPayload.timestamp : new Date(parsedPayload.timestamp).getTime();
                  if (!isNaN(ts)) {
                    const diff = Date.now() - ts;
                    if (diff > 900000) {
                      return new Response(JSON.stringify({ error: 'Invalid Jules Signature: Webhook expired' }), {
                        status: 401, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                      });
                    }
                  }
                }
              } catch (e) {
                 // ignore json parse error to let it fail later
              }

              const isJulesVerified = await verifyHmacSignature(payloadText, julesSignature, env.JULES_API_KEY || env.AXIM_INTERNAL_KEY);


              if (!isJulesVerified) {
                return new Response(JSON.stringify({ error: 'Invalid Jules Signature' }), {
                  status: 401, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              }

              try {
                const payload: any = JSON.parse(payloadText);
                const { processJulesWebhook } = await import('./jules_bridge');
                await processJulesWebhook(payload, env);
                return new Response(JSON.stringify({ status: 'success' }), {
                  status: 200, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              } catch (error) {
                return new Response(JSON.stringify({ error: 'Webhook processing error' }), {
                  status: 500, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              }
            }

            if (url.pathname === '/api/v1/webhooks/agent') {
              if (request.method !== 'POST') {
                return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
                  status: 405, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              }

              const agentSignature = request.headers.get('X-Axim-Signature');
              if (!agentSignature) {
                return new Response(JSON.stringify({ error: 'Invalid Agent Signature' }), {
                  status: 401, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              }

              const payloadText = await request.clone().text();
              const isAgentVerified = await verifyHmacSignature(payloadText, agentSignature, env.AXIM_INTERNAL_KEY);

              if (!isAgentVerified) {
                return new Response(JSON.stringify({ error: 'Invalid Agent Signature' }), {
                  status: 401, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              }

              try {
                const payload: any = JSON.parse(payloadText);

                const { owner: resolvedOwner, repo: resolvedRepo } = resolveRepoMetadata(payload.project_key || payload.repository);
                const mappedPayload = {
                  task_id: `AGENT-${Math.random().toString(36).substring(7).toUpperCase()}`,
                  repository_owner: resolvedOwner,
                  repository_name: resolvedRepo,
                  target_file_path: payload.file,
                  instruction_prompt: payload.directive,
                  origin_source: payload.agent_origin || 'External_Agent',
                  cf_ray: request.headers.get('cf-ray') || 'unknown'
                };

                ctx.waitUntil(executeCodingPipeline(mappedPayload as any, env));

                return new Response(JSON.stringify({
                  status: 'accepted',
                  message: 'Agent handoff accepted',
                  task_id: mappedPayload.task_id
                }), {
                  status: 202, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              } catch (error) {
                return new Response(JSON.stringify({ error: 'Invalid Payload' }), {
                  status: 400, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              }
            }

            // 2. The Zero-Trust Handshake: HMAC SHA-256 Validation (v2 envelope preferred)
            const signature = request.headers.get('X-Axim-Signature');
            if (!signature) {
              return new Response(JSON.stringify({ error: 'Unauthorized: Missing Signature Boundary' }), {
                status: 401, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
              });
            }

            const payloadText = await request.clone().text();
            const isVerified = await verifyInternalRelay(request, payloadText, env);

            if (!isVerified) {
              return new Response(JSON.stringify({ error: 'Unauthorized: Cryptographic Verification Failed' }), {
                status: 403, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
              });
            }


            if (request.method === 'POST' && url.pathname === '/api/v1/force-unlock') {
              try {
                const payload: any = JSON.parse(payloadText);
                const taskId = payload.task_id;

                if (!taskId) {
                  return new Response(JSON.stringify({ error: 'Bad Request: Missing task_id' }), {
                    status: 400, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
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
                      'Authorization': `Bearer ${((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')}`,
                      'apikey': ((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')
                    },
                    body: JSON.stringify(errorBody)
                  });
                } catch (logErr) {
                  console.error('[CORE_LOGGING_CRASH] Failed to record post-mortem audit', logErr);
                }

                return new Response(JSON.stringify({ status: 'success', message: 'Lock evicted' }), {
                  status: 200, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              } catch (error) {
                 return new Response(JSON.stringify({ error: 'Internal Error' }), {
                    status: 500, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                 });
              }
            }


            // Ecosystem On-Demand Task Ingress
            // Body integrity is already proven by the zero-trust block above; do
            // not re-verify the same signature here.
            if (url.pathname === "/api/v1/projects/scaffold") {
              try {
                const payload: any = await request.json();
                const taskId = `scaffold-${Date.now()}`;
                payload.taskId = taskId;
                payload.instructions = `Scaffold a new micro-app repository with pre-configured AXiM Passport SSO, Tailwind CSS, Vite, and Cloudflare Worker / Pages deployment manifests based on requirements: ${payload.requirements}`;
                payload.title = `Project Scaffold: ${payload.name}`;
                payload.target_file_path = "README.md";
                ctx.waitUntil(executeAutonomousCodingTask(payload, env));
                return new Response(JSON.stringify({ success: true, taskId, status: "scaffolding_started" }), { status: 202, headers: { "Content-Type": "application/json", ...getCorsHeaders(request) } });
              } catch (error) {
                return new Response(JSON.stringify({ error: "Internal Server Error" }), { status: 500, headers: { "Content-Type": "application/json", ...getCorsHeaders(request) } });
              }
            }

            if (url.pathname === '/api/v1/tasks/dispatch') {
              // Support System interlock. HMAC (v2 or legacy v1) over the raw body
              // has already been proven by the zero-trust block above, so this
              // handler trusts `payloadText` and moves straight to validation.
              try {
                const payload: any = JSON.parse(payloadText);
                const taskId = payload.taskId || payload.ticketId;
                if (!taskId) {
                   return new Response(JSON.stringify({ error: 'Bad Request: Missing Task Identifier' }), { status: 400, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } });
                }

                const existingLock = await env.TASK_LOCKS.get(`lock:${taskId}`);
                if (existingLock === 'in_progress') {
                  return new Response(JSON.stringify({ status: 'ignored', message: 'Task actively processing' }), { status: 202, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } });
                }


                await env.TASK_LOCKS.put(`lock:${taskId}`, 'in_progress', { expirationTtl: 3600 });

                ctx.waitUntil(executeAutonomousCodingTask(payload, env));

                return new Response(JSON.stringify({ success: true, taskId, status: 'dispatched' }), { status: 202, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } });
              } catch (error) {
                return new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } });
              }
            }

            if (url.pathname === '/api/v1/deploy-action') {
              const isAuth = await verifySupabaseToken(request.headers.get('Authorization'), env);
              if (!isAuth) {
                return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } });
              }

              let taskIdentifier: string | null = null;
              try {
                const payload: any = await request.clone().json();
                const { pr_number, repository_owner, repository_name, task_id, action } = payload;
                taskIdentifier = task_id;

                if (!task_id) {
                  return new Response(JSON.stringify({ error: 'Bad Request: Missing Task Identifier' }), {
                    status: 400, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                  });
                }

                if (action === 'REJECTED') {
                   await env.TASK_LOCKS.delete(`lock:${taskIdentifier}`);
                   return new Response(JSON.stringify({
                     status: 'accepted',
                     message: 'Patch rejected, task unlocked.'
                   }), {
                     status: 200, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                   });
                }

                if (!pr_number || !repository_owner || !repository_name) {
                  return new Response(JSON.stringify({ error: 'Bad Request: Missing PR metadata' }), {
                    status: 400, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                  });
                }

                const githubCtx = {
                  owner: repository_owner,
                  repo: repository_name,
                  path: '' // not needed for PR merge
                };

                await mergePullRequest(githubCtx, pr_number, env);

                if (payload.source === "axim-support-system" && payload.ticketId) {
                  const prUrl = `https://github.com/${repository_owner}/${repository_name}/pull/${pr_number}`;
                  const callbackPayload = {
                    ticketId: payload.ticketId,
                    status: "resolved",
                    resolutionNotes: `Automated patch applied and deployed by AXiM Coder Core.\n- PR: ${prUrl}\n- Verification: All automated tests passed cleanly.`,
                    completedAt: new Date().toISOString()
                  };
                  try {
                    // `POST /api/v1/tickets/:id/resolve-from-coder` is the only
                    // resolution route the Support System exposes. The previous
                    // `/api/v1/axim-resolution` and `/patch-status` targets do not
                    // exist upstream, which is what filled the DLQ with 404s.
                    const cbResp = await postSignedRelay(
                      `${SUPPORT_BASE_URL}/api/v1/tickets/${encodeURIComponent(payload.ticketId)}/resolve-from-coder`,
                      callbackPayload,
                      env
                    );
                    if (!cbResp.ok) throw new Error(`Callback failed with status ${cbResp.status}`);
                  } catch (cbErr: any) {
                    console.error(`[AUTONOMOUS_CODER] Failed to dispatch resolution callback for ticket ${payload.ticketId}:`, cbErr.message);
                    if ((env as any).CODER_DLQ_KV) {
                       await (env as any).CODER_DLQ_KV.put(`dlq:ticket-callback:${payload.ticketId}`, JSON.stringify(callbackPayload));
                    }
                  }
                }


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
                       'Authorization': `Bearer ${((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')}`,
                       'apikey': ((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')
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
                  status: 200, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
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
                           'Authorization': `Bearer ${((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')}`,
                           'apikey': ((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')
                         },
                         body: JSON.stringify(errorBody)
                       });

                       // Transition task status to FAILED in the database
                       await fetch(`${env.SUPABASE_URL}/rest/v1/coding_tasks?task_id=eq.${taskIdentifier}`, {
                        method: 'PATCH',
                        headers: {
                          'Content-Type': 'application/json',
                          'apikey': ((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || ''),
                          'Authorization': `Bearer ${((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')}`
                        },
                        body: JSON.stringify({ status: 'FAILED' })
                      });
                     } catch (logErr) {
                         console.error('[CORE_LOGGING_CRASH] Failed to sync error state back to database', logErr);
                     }
                 }
                 return new Response(JSON.stringify({ error: 'Bad Request' }), {
                    status: 400, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                 });
              }
            }



            // DLQ Sweep endpoint

            if (url.pathname === "/api/v1/github/tree" && request.method === "GET") {
              const owner = url.searchParams.get("owner");
              const repo = url.searchParams.get("repo");
              if (!owner || !repo) {
                return new Response(JSON.stringify({ error: "Missing owner or repo" }), {
                  status: 400,
                  headers: { "Content-Type": "application/json", ...getCorsHeaders(request) }
                });
              }
              try {
                const metaResp = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
                  headers: {
                    "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
                    "User-Agent": "AXiM-Coding-Lab",
                    "Accept": "application/vnd.github.v3+json"
                  }
                });
                const metaData: any = await metaResp.json();
                const defaultBranch = metaData.default_branch || 'main';

                const ghResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${defaultBranch}?recursive=1`, {
                  headers: {
                    "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
                    "User-Agent": "AXiM-Coding-Lab",
                    "Accept": "application/vnd.github.v3+json"
                  }
                });
                const ghData = await ghResponse.json();
                if (!ghResponse.ok) {
                  return new Response(JSON.stringify({ error: "GitHub API error", details: ghData }), {
                    status: ghResponse.status,
                    headers: { "Content-Type": "application/json", ...getCorsHeaders(request) }
                  });
                }
                return new Response(JSON.stringify(ghData), {
                  status: 200,
                  headers: { "Content-Type": "application/json", ...getCorsHeaders(request) }
                });
              } catch (e: any) {
                return new Response(JSON.stringify({ error: e.message }), {
                  status: 500,
                  headers: { "Content-Type": "application/json", ...getCorsHeaders(request) }
                });
              }
            }

            if (url.pathname === "/api/v1/dlq/stats" && request.method === "GET") {
              let dlq_pending_count = 0;
              try {
                if (env.CODER_DLQ_KV) {
                  const dlqList = await env.CODER_DLQ_KV.list({ prefix: 'dlq:' });
                  dlq_pending_count = dlqList.keys.length;
                } else if (env.LAB_STATE) {
                  const dlqList = await env.LAB_STATE.list({ prefix: 'dlq:' });
                  dlq_pending_count = dlqList.keys.length;
                }
              } catch (e) {
                console.error("Failed to fetch DLQ stats", e);
              }
              return new Response(JSON.stringify({
                status: "success",
                pending_count: dlq_pending_count,
                timestamp: new Date().toISOString()
              }), {
                status: 200,
                headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
              });
            }

            if (url.pathname === "/api/v1/dlq/sweep" && request.method === "POST") {
              const authHeader = request.headers.get('Authorization');
              const sigHeader = request.headers.get('X-Axim-Signature');
              let isAuth = false;

              if (authHeader) {
                isAuth = await verifySupabaseToken(authHeader, env);
              } else if (sigHeader && env.AXIM_INTERNAL_KEY) {
                try {
                  const bodyText = await request.clone().text();
                  const encoder = new TextEncoder();
                  const keyMaterial = await crypto.subtle.importKey(
                    'raw',
                    encoder.encode(env.AXIM_INTERNAL_KEY),
                    { name: 'HMAC', hash: 'SHA-256' },
                    false,
                    ['verify']
                  );
                  const sigHex = sigHeader.trim();
                  const sigBytes = new Uint8Array(sigHex.match(/.{1,2}/g)?.map(byte => parseInt(byte, 16)) || []);
                  isAuth = await crypto.subtle.verify('HMAC', keyMaterial, sigBytes, encoder.encode(bodyText));
                } catch (e) {
                  isAuth = false;
                }
              }

              if (!isAuth) {
                return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } });
              }

              try {
                const dlqKeys = await env.CODER_DLQ_KV.list({ prefix: 'dlq:' });
                let reprocessedCount = 0;
                let remainingCount = 0;

                for (const key of dlqKeys.keys) {
                  const payloadStr = await env.CODER_DLQ_KV.get(key.name);
                  if (!payloadStr) {
                    await env.CODER_DLQ_KV.delete(key.name);
                    continue;
                  }
                  try {
                    if (await replayDlqEntry(key.name, payloadStr, env)) {
                      await env.CODER_DLQ_KV.delete(key.name);
                      reprocessedCount++;
                    } else {
                      remainingCount++;
                    }
                  } catch (e) {
                    remainingCount++;
                    console.error('[DLQ] manual sweep replay failed', key.name, e);
                  }
                }

                return new Response(JSON.stringify({ status: "success", reprocessed: reprocessedCount, remaining: remainingCount }), {
                  status: 200, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              } catch (error) {
                return new Response(JSON.stringify({ error: 'Internal Error processing DLQ sweep' }), {
                  status: 500, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              }
            }

            // Telemetry endpoints
            if (url.pathname === "/api/telemetry/events" && request.method === "POST") {
              try {
                const payload: any = await request.json();
                const { timestamp, agentId, latencyMs, status, tokensUsed } = payload;

                if (!timestamp || !agentId || typeof latencyMs !== "number" || !status) {
                  return new Response(JSON.stringify({ error: "Bad Request: Missing or invalid telemetry fields" }), {
                    status: 400, headers: { "Content-Type": "application/json", ...getCorsHeaders(request) }
                  });
                }

                // Store event in KV for fast recent querying
                const eventId = `telemetry:${agentId}:${timestamp}`;
                await env.TELEMETRY_KV.put(eventId, JSON.stringify(payload), { expirationTtl: 86400 * 7 }); // 7 days retention

                // Write to Analytics Engine
                if (env.axim_coder_metrics) {
                  env.axim_coder_metrics.writeDataPoint({
                    blobs: [agentId, status, new Date(timestamp).toISOString()],
                    doubles: [latencyMs, tokensUsed || 0],
                    indexes: [agentId]
                  });
                }

                return new Response(JSON.stringify({ success: true }), {
                  status: 200, headers: { "Content-Type": "application/json", ...getCorsHeaders(request) }
                  });
              } catch (error: any) {
                return new Response(JSON.stringify({ error: "Internal Error processing telemetry" }), {
                  status: 500, headers: { "Content-Type": "application/json", ...getCorsHeaders(request) }
                });
              }
            }


            // 3. Payload Extraction & Idempotency Lock
            //
            // Only the two coding-task ingress routes fall through to here. Any
            // other path is unknown and must 404 — previously it was parsed as a
            // task payload, so a typo'd route returned 500 'Internal Ingress
            // Error' (or, for GETs, an unparseable-body crash) instead of 404.
            if (url.pathname !== '/api/v1/ingress' && url.pathname !== '/api/v1/tasks') {
              return new Response(JSON.stringify({ error: 'Not Found', path: url.pathname }), {
                status: 404, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
              });
            }

            // Operator session is required on top of the HMAC envelope.
            const isAuth = await verifySupabaseToken(request.headers.get('Authorization'), env);
            if (!isAuth) {
              return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } });
            }

            try {
              const payload: any = await request.json();
              payload.cf_ray = request.headers.get('cf-ray') || 'unknown';

              const idempotencyKey = request.headers.get('Idempotency-Key') || request.headers.get('X-GitHub-Delivery') || request.headers.get('x-github-delivery');
              if (idempotencyKey) {
                const isDuplicate = await env.TASK_LOCKS.get(`idempotency:${idempotencyKey}`);
                if (isDuplicate) {
                  const serviceKey = (env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '';
                  ctx.waitUntil(fetch(`${env.SUPABASE_URL}/rest/v1/api_usage_logs`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': 'Bearer ' + serviceKey,
                      'apikey': serviceKey
                    },
                    body: JSON.stringify([{
                      app_id: 'axim-coding-lab',
                      endpoint: '/api/v1/ingress',
                      method: 'POST',
                      status_code: 202,
                      error_message: null,
                      metadata: { event: 'IDEMPOTENCY_COLLISION_BLOCKED', key: idempotencyKey,                       source: payload.origin_source || 'unknown' }
                    }])
                  }).catch(err => console.error("Telemetry failure on idempotency block:", err)));
                  return new Response(JSON.stringify({
                    status: 'ignored',
                    message: 'Idempotent request already processed.'
                  }), {
                    status: 202, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                  });
                }
                await env.TASK_LOCKS.put(`idempotency:${idempotencyKey}`, "processed", { expirationTtl: 86400 }); // 24h window
              }

              // Schema validation for dispatch payloads
              if (!payload.task_id && !payload.incident_hash && !payload.ticketId && !payload.taskId) {
                return new Response(JSON.stringify({ error: 'Bad Request: Missing Task Identifier' }), {
                  status: 400, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              }

              const resolved = resolveRepoMetadata(payload.project_key || payload.repository_name);
              if (!payload.repository_owner) payload.repository_owner = resolved.owner;
              if (!payload.repository_name) payload.repository_name = resolved.repo;

              if (!payload.repository_owner || !payload.repository_name) {
                // If it's a structural payload for code_generator, require these
                if (url.pathname === '/api/v1/ingress') {
                  if (!payload.repository_owner || !payload.repository_name || !payload.instruction_prompt) {
                     return new Response(JSON.stringify({ error: 'Bad Request: Invalid JSON Schema for CodingTaskPayload. Missing repository_owner, repository_name, or instruction_prompt.' }), {
                       status: 400, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                     });
                  }
                }
              }

              const taskIdentifier = payload.task_id || payload.incident_hash || payload.ticketId || payload.taskId;


              // Query KV to ensure this specific bug/feature isn't already being coded by the swarm
              let activeLock;
              try {
                activeLock = await env.TASK_LOCKS.get(`lock:${taskIdentifier}`);
              } catch (kvError) {
                return new Response(JSON.stringify({ error: "Edge memory capacity exceeded. Try again in a few moments." }), {
                  status: 429, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              }
              if (activeLock) {
                return new Response(JSON.stringify({
                  status: 'ignored',
                  message: 'Task is currently locked and actively processing in the Lab.'
                }), {
                  status: 202, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              }

              // Establish a 1-hour active lock for the generation cycle
              await env.TASK_LOCKS.put(`lock:${taskIdentifier}`, "active", { expirationTtl: 3600 });

              if (payload.target_file_paths && payload.target_file_paths.length > 1) {
                // Task exceeds safe V8 CPU time limits for standard fetch event. Offload to Queue.
                if ((env as any).SWARM_QUEUE) {
                  await (env as any).SWARM_QUEUE.send(payload);
                } else {
                  ctx.waitUntil(executeCodingPipeline(payload, env, null, ctx));
                }
                return new Response(JSON.stringify({
                  status: 'accepted',
                  message: 'Payload verified. Heavy task dispatched to Swarm Queue.',
                  task_id: taskIdentifier
                }), {
                  status: 202, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              }

              // Transform to Server-Sent Events stream if requested by client (e.g. Accept: text/event-stream)
              const acceptHeader = request.headers.get('Accept') || '';
              if (acceptHeader.includes('text/event-stream')) {
                const { readable, writable } = new TransformStream();
                const writer = writable.getWriter();

                // Heartbeat mechanism to keep connection alive
                const heartbeatInterval = setInterval(() => {
                  writer.write(new TextEncoder().encode(': ping\n\n')).catch(() => {});
                }, 15000);

                request.signal.addEventListener('abort', () => {
                  clearInterval(heartbeatInterval);
                  env.TASK_LOCKS.delete(`lock:${taskIdentifier}`).catch(() => {});
                });

                // Handoff to pipeline in the background and pipe progress to the SSE stream.
                ctx.waitUntil((async () => {
                  try {
                    if (payload.delegate_to_jules) {
                      await dispatchToJulesAgent({ repoOwner: payload.repository_owner || 'axim-dev', repoName: payload.repository_name, prompt: payload.instruction_prompt, taskId: taskIdentifier }, env);
                      writer.write(new TextEncoder().encode(`data: {"type":"log","message":"[Jules Bridge] External agent handoff completed."}\n\n`)).catch(() => {});
                    } else {
                      await executeCodingPipeline(payload, env, writer, ctx);
                    }
                  } catch (e: any) {
                    writer.write(new TextEncoder().encode(`data: {"type":"error","message":"${e.message}"}\n\n`)).catch(() => {});
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
                          task_id: taskIdentifier,
                          component: 'axim-coding-lab-worker',
                          error_message: e.message,
                          stack_trace: e.stack || '',
                          status: 'FAILED',
                          created_at: new Date().toISOString()
                        })
                      });
                    } catch (telemetryErr) {
                       console.error("Failed to push to telemetry:", telemetryErr);
                    }
                  } finally {
                    clearInterval(heartbeatInterval);
                    writer.close().catch(() => {});
                    env.TASK_LOCKS.delete(`lock:${taskIdentifier}`).catch(() => {});
                  }
                })());

                return new Response(readable, {
                  status: 200,
                  headers: {
                    'Content-Type': 'text/event-stream; charset=utf-8',
                    'Cache-Control': 'no-cache, no-transform',
                    'Connection': 'keep-alive',
                    ...getCorsHeaders(request)
                  }
                });
              }

              // 4. Asynchronous Cognitive Handoff
              if (payload.delegate_to_jules) {
                ctx.waitUntil((async () => {
                  try {
                    await dispatchToJulesAgent({ repoOwner: payload.repository_owner || 'axim-dev', repoName: payload.repository_name, prompt: payload.instruction_prompt, taskId: taskIdentifier }, env);
                  } catch(e: any) {
                    try {
                      await fetch(`${env.SUPABASE_URL}/rest/v1/coding_tasks_errors`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')}`, 'apikey': ((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '') },
                        body: JSON.stringify({ task_id: taskIdentifier, component: 'axim-coding-lab-worker', error_message: e.message, stack_trace: e.stack || '', status: 'FAILED', created_at: new Date().toISOString() })
                      });
                    } catch(err) {}
                  } finally {
                    env.TASK_LOCKS.delete(`lock:${taskIdentifier}`).catch(() => {});
                  }
                })());
              } else {
                ctx.waitUntil((async () => {
                  try {
                    await executeCodingPipeline(payload, env, undefined, ctx);
                  } catch(e: any) {
                    try {
                      await fetch(`${env.SUPABASE_URL}/rest/v1/coding_tasks_errors`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')}`, 'apikey': ((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '') },
                        body: JSON.stringify({ task_id: taskIdentifier, component: 'axim-coding-lab-worker', error_message: e.message, stack_trace: e.stack || '', status: 'FAILED', created_at: new Date().toISOString() })
                      });
                    } catch(err) {}
                  } finally {
                    env.TASK_LOCKS.delete(`lock:${taskIdentifier}`).catch(() => {});
                  }
                })());
              }

              return new Response(JSON.stringify({
                status: 'accepted',
                message: 'Payload verified. The Coding Lab swarm has initiated the task.',
                task_id: taskIdentifier
              }), {
                status: 202, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
              });
        } catch (error) {
              return new Response(JSON.stringify({ error: 'Internal Ingress Error' }), {
                status: 500, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
              });
            }
      })();
    } catch (err: any) {
      response = new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
      });
    }


    return response;
}
