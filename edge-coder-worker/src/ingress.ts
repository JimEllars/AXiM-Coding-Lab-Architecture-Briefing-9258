import { sendEmailItMessage } from './emailService';
import { dispatchCallbackWebhook, replayParkedSatelliteCallback } from './callback_dispatcher';
import { executeCodingPipeline, executeAutonomousCodingTask } from './code_generator';
import { mergePullRequest, fetchOpenPullRequests, postPullRequestReview, fetchPullRequestDiff } from './github_bridge';
import { dispatchToJulesAgent } from './jules_bridge';
import { resolveRepoMetadata, AXiM_ECOSYSTEM_REGISTRY } from './registry';
import {
  acquireTaskLock,
  clearTaskState,
  readOpenPullRequest,
  releaseTaskLock
} from './locks';
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

export interface MessageQueue {
  send(message: unknown, options?: { contentType?: string }): Promise<void>;
}

export interface Env {
  LAB_STATE: KVNamespace;
  TASK_LOCKS: KVNamespace;
  TELEMETRY_KV: KVNamespace;
  CODER_DLQ_KV: KVNamespace;
  axim_coder_metrics: AnalyticsEngineDataset;
  /** Optional: when unbound, multi-file tasks run inline instead of queueing. */
  SWARM_QUEUE?: MessageQueue;
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
 *
 * Sprint 1.6 widened the table. The old rules matched the literal string `?-d`
 * and `%2e%2e` only, so `?%2Dd` (percent-encoded dash), `..%5C` (backslash
 * traversal) and `php://filter` wrappers walked straight past; every rule is now
 * evaluated against the raw target *and* two URL-decoded passes (see
 * {@link decodeForScreening}).
 */
export const CGI_INJECTION_PATTERN = /(?:[?&;]-[a-z]|auto_prepend_file|auto_append_file|allow_url_include|disable_functions|safe_mode|php_value|php_admin_value|env_path_info|open_basedir)/i;
export const PATH_PROBE_PATTERN = /(\.\.|%2e%2e|%5c|%00|\.php|\/wp-admin|\/wp-login\.php|xmlrpc\.php|cgi-bin|\/etc\/passwd|\/proc\/self\/environ|\/\.env|\/\.git\/)/i;
export const PHP_STREAM_WRAPPER_PATTERN = /(php:\/\/|phar:\/\/|data:\/\/|expect:\/\/|zip:\/\/|glob:\/\/)/i;

/**
 * Percent-decodes a request target for screening, twice, guarding against the
 * malformed sequences that make `decodeURIComponent` throw (`?f=100%` is a
 * legitimate query string).
 *
 * Decoding is screening-only: the worker never routes on the decoded value, it
 * just refuses to be evaded by `%2D` / `%252e%252e` spellings.
 */
export function decodeForScreening(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < 2; pass++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

/**
 * Returns a 403 response when the request looks like a PHP2Shell / traversal
 * probe, or null when the request may proceed. Runs before env validation and
 * routing so hostile traffic never reaches the LLM or Supabase.
 */
export function screenHostileUrl(url: URL, request: Request): Response | null {
  const targets = [
    url.search,
    decodeForScreening(url.search),
    url.pathname,
    decodeForScreening(url.pathname)
  ];

  if (CGI_INJECTION_PATTERN.test(url.search) || CGI_INJECTION_PATTERN.test(targets[1])) {
    return new Response(JSON.stringify({ error: "Forbidden: Suspicious CGI argument injection detected" }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
    });
  }

  if (PHP_STREAM_WRAPPER_PATTERN.test(url.search) || PHP_STREAM_WRAPPER_PATTERN.test(targets[1])) {
    return new Response(JSON.stringify({ error: "Forbidden: Suspicious PHP stream wrapper detected" }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
    });
  }

  if (targets.some((target) => PATH_PROBE_PATTERN.test(target))) {
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

const APPROVAL_TOKEN_PREFIX = 'pr_token_';
const APPROVAL_TOKEN_TTL_SECONDS = 86_400;

/**
 * What a human-approval link is allowed to merge. The merge coordinates are
 * stored server-side at mint time; the URL carries only the opaque token.
 */
export interface PrApprovalRecord {
  owner: string;
  repo: string;
  pr: number;
  taskId?: string;
  title?: string;
  branch?: string;
}

/** Mints a single-use HITL approval token for one pull request. */
export async function mintApprovalToken(
  taskLocks: KVNamespace,
  record: PrApprovalRecord
): Promise<string> {
  const token = crypto.randomUUID();
  await taskLocks.put(`${APPROVAL_TOKEN_PREFIX}${token}`, JSON.stringify(record), {
    expirationTtl: APPROVAL_TOKEN_TTL_SECONDS
  });
  return token;
}

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

interface GatePageOptions {
  heading: string;
  detail?: string;
  status: number;
  /** Present only when the visitor may still confirm the action. */
  confirmAction?: string;
  token?: string;
  decision?: string;
}

/**
 * Renders the human-gate page. GET only ever renders; the merge is a POST.
 * Mail clients and link scanners prefetch GET links, and this endpoint used to
 * merge a pull request on that prefetch.
 */
function renderGatePage({ heading, detail, status, confirmAction, token, decision }: GatePageOptions): Response {
  const form = confirmAction && token
    ? `<form method="POST" action="${escapeHtml(confirmAction)}">
    <input type="hidden" name="token" value="${escapeHtml(token)}" />
    <input type="hidden" name="decision" value="${escapeHtml(decision ?? 'merge')}" />
    <button type="submit" class="approve">${decision === 'revise' ? 'Confirm: Request Revision' : 'Confirm: Approve &amp; Merge'}</button>
  </form>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${escapeHtml(heading)}</title>
  <style>
    body { background-color: #0f172a; color: #f8fafc; font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
    .card { background-color: #1e293b; padding: 2rem; border-radius: 0.5rem; border: 1px solid #334155; text-align: center; max-width: 32rem; }
    h1 { margin-top: 0; font-size: 1.35rem; color: #38bdf8; }
    p { color: #94a3b8; font-size: 0.9rem; line-height: 1.5; }
    button { background-color: #10b981; color: #06231a; border: 0; padding: 0.75rem 1.25rem; border-radius: 0.375rem; font-weight: 700; font-size: 0.85rem; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(heading)}</h1>
    ${detail ? `<p>${escapeHtml(detail)}</p>` : ''}
    ${form}
  </div>
</body>
</html>`;

  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow'
    }
  });
}

/**
 * Reads and validates a minted approval token.
 *
 * The previous handler treated *any* token that was not literally the string
 * `consumed` as authorised — including tokens that were never minted — and then
 * took the merge target from the query string, so
 * `?token=x&decision=merge&owner=…&repo=…&pr=N` merged an arbitrary pull
 * request in an arbitrary repository with the worker's GitHub token.
 */
async function readApprovalRecord(
  taskLocks: KVNamespace,
  token: string | null
): Promise<{ record: PrApprovalRecord } | { error: string; status: number }> {
  if (!token) {
    return { error: 'Missing approval token.', status: 400 };
  }

  const raw = await taskLocks.get(`${APPROVAL_TOKEN_PREFIX}${token}`);
  if (raw === null) {
    return { error: 'Unknown or expired approval token.', status: 403 };
  }
  if (raw === 'consumed') {
    return { error: 'This approval link has already been used.', status: 409 };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'Approval token is not actionable.', status: 409 };
  }

  const pr = Number(parsed?.pr);
  const repo = typeof parsed?.repo === 'string' ? parsed.repo : '';
  if (!repo || !Number.isInteger(pr) || pr <= 0) {
    return { error: 'Approval token is not bound to a pull request.', status: 409 };
  }

  const owner = resolveRepoMetadata(parsed.owner ? `${parsed.owner}/${repo}` : repo).owner;
  return { record: { ...parsed, owner, repo, pr } };
}

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
      error_message: 'UNAUTHORIZED_EXECUTION_ATTEMPT by ' + (email || 'unknown'),
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


/** Public host the approval links in the briefing email point at. */
const BRIEFING_WORKER_DOMAIN = 'lab-worker.axim.us.com';

interface BriefingPullRequest {
  owner: string;
  repo: string;
  pr: number;
  title: string;
  branch: string;
}

/**
 * Counts rows matching a PostgREST filter, or returns `null` when the query
 * cannot be answered. `null` is rendered as "n/a" in the briefing: an
 * unavailable number is not the same thing as a flattering number.
 */
async function countSupabaseRows(env: any, table: string, query: string): Promise<number | null> {
  const serviceKey = (env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '';
  if (!env.SUPABASE_URL || !serviceKey) return null;
  try {
    const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${query}&select=id`, {
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
    });
    if (!response.ok) return null;
    const rows = await response.json();
    return Array.isArray(rows) ? rows.length : null;
  } catch {
    return null;
  }
}

/**
 * Collects the pull requests actually awaiting a human, across the registry.
 * The briefing used to render one hard-coded "CRITICAL HOTFIX" row against
 * `CORE` every single day, with an approve link that merged nothing real.
 */
async function collectOpenPullRequests(env: any, limit = 5): Promise<BriefingPullRequest[]> {
  const collected: BriefingPullRequest[] = [];
  for (const repoDef of Object.values(AXiM_ECOSYSTEM_REGISTRY)) {
    if (collected.length >= limit) break;
    try {
      const prs = await fetchOpenPullRequests({ owner: repoDef.owner, repo: repoDef.repo, path: '' }, env);
      for (const pr of prs) {
        if (collected.length >= limit) break;
        if (pr?.draft) continue;
        collected.push({
          owner: repoDef.owner,
          repo: repoDef.repo,
          pr: Number(pr.number),
          title: String(pr.title ?? '(untitled)'),
          branch: String(pr.head?.ref ?? 'unknown')
        });
      }
    } catch (e) {
      console.warn(`[BRIEFING] could not list pull requests for ${repoDef.repo}`, e);
    }
  }
  return collected.filter((pr) => Number.isInteger(pr.pr) && pr.pr > 0);
}

async function handleDailyExecutiveBriefing(env: any) {
  const generatedAt = new Date();
  const dateStr = generatedAt.toISOString().split('T')[0];
  const since = new Date(generatedAt.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const pendingPRs = await collectOpenPullRequests(env);

  let dlqDepth: number | null = null;
  try {
    if (env.CODER_DLQ_KV) {
      const list = await env.CODER_DLQ_KV.list({ prefix: 'dlq:' });
      dlqDepth = list.keys.length;
    }
  } catch (e) {
    console.warn('[BRIEFING] DLQ depth unavailable', e);
  }

  const tasks24h = await countSupabaseRows(env, 'coding_tasks', `created_at=gte.${encodeURIComponent(since)}`);
  const errors24h = await countSupabaseRows(env, 'coding_tasks_errors', `created_at=gte.${encodeURIComponent(since)}`);

  const metric = (value: number | null) => (value === null ? 'n/a' : String(value));
  const metricRows: [string, string][] = [
    ['Tasks created (24h)', metric(tasks24h)],
    ['Failures logged (24h)', metric(errors24h)],
    ['Pull requests awaiting approval', String(pendingPRs.length)],
    ['Dead-letter queue depth', metric(dlqDepth)]
  ];

  let pendingHtml = '';
  for (const pr of pendingPRs) {
    const token = await mintApprovalToken(env.TASK_LOCKS, {
      owner: pr.owner,
      repo: pr.repo,
      pr: pr.pr,
      title: pr.title,
      branch: pr.branch
    });
    pendingHtml += `
      <div style="background-color: #1a1a2e; padding: 15px; border-radius: 8px; margin-bottom: 15px; border: 1px solid #2a2a3e;">
        <h4 style="color: #fff; margin-top: 0;">${escapeHtml(pr.title)}</h4>
        <p style="color: #a0a0b0; font-size: 14px;">${escapeHtml(pr.owner)}/${escapeHtml(pr.repo)} #${pr.pr} | Branch: ${escapeHtml(pr.branch)}</p>
        <div style="margin-top: 15px;">
          <a href="https://${BRIEFING_WORKER_DOMAIN}/api/v1/pr/action?token=${token}&decision=merge" style="background-color: #10b981; color: white; padding: 8px 12px; text-decoration: none; border-radius: 4px; font-weight: bold; font-size: 13px;">Review &amp; Approve</a>
        </div>
      </div>
    `;
  }
  if (!pendingHtml) {
    pendingHtml = '<p style="color: #a0a0b0; font-size: 14px;">No pull requests are awaiting approval.</p>';
  }

  const metricsHtml = metricRows
    .map(([label, value]) => `<tr><td style="color: #a0a0b0; padding: 4px 12px 4px 0;">${escapeHtml(label)}</td><td style="color: #fff;">${escapeHtml(value)}</td></tr>`)
    .join('');

  const htmlBody = `
    <div style="font-family: monospace; max-width: 640px; margin: 0 auto; background-color: #0a0f1c; color: #fff; padding: 20px; border: 1px solid #1f2937;">
      <h2 style="color: #60a5fa; border-bottom: 1px solid #1f2937; padding-bottom: 10px;">[AXiM] Daily Engineering Summary - ${dateStr}</h2>
      <table style="border-collapse: collapse; font-size: 13px; margin-bottom: 20px;">${metricsHtml}</table>
      <p style="color: #64748b; font-size: 11px;">Measured at ${escapeHtml(generatedAt.toISOString())}. Values shown as n/a could not be read at generation time.</p>
      <h3 style="color: #94a3b8; font-size: 14px; margin-top: 24px;">Awaiting human approval</h3>
      ${pendingHtml}
    </div>
  `;

  if (env.EMAILIT_API_KEY) {
    await sendEmailItMessage({
      to: 'james.ellars@axim.us.com',
      bcc: 'jrellars@gmail.com',
      subject: `[AXiM] Daily Engineering Summary - ${dateStr}`,
      html: htmlBody
    }, env);
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
 * Replays one dead-letter entry against its owning satellite.
 *
 * Ticket callbacks are re-signed with a fresh v2 envelope on every attempt, so
 * an entry that sat in the DLQ during an outage still lands inside the
 * recipient's replay window. Returns true when the entry was delivered and can
 * be evicted.
 */
/** Cloudflare Queues caps a single message at 128 KiB. */
export const SWARM_QUEUE_MAX_MESSAGE_BYTES = 128 * 1024;

/**
 * Hands a multi-file task to the swarm queue.
 *
 * Returns `false` whenever the task could not be enqueued — no binding, an
 * oversized payload, or a `send()` that throws — so the caller can run the
 * pipeline inline. The previous code awaited `SWARM_QUEUE.send()` unguarded
 * after claiming the task lease: a failed send escaped to the route's catch
 * block as a 500 while the lease stayed held for an hour, so the caller's retry
 * was answered with "already processing" and the task was never run at all.
 */
export async function enqueueSwarmTask(env: any, payload: any, taskIdentifier: string): Promise<boolean> {
  const queue = env.SWARM_QUEUE;
  if (!queue || typeof queue.send !== 'function') {
    return false;
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch (e) {
    console.error('[SWARM_QUEUE] payload is not serializable; running inline', taskIdentifier, e);
    return false;
  }

  if (new TextEncoder().encode(serialized).length > SWARM_QUEUE_MAX_MESSAGE_BYTES) {
    console.warn('[SWARM_QUEUE] payload exceeds the 128 KiB message limit; running inline', taskIdentifier);
    return false;
  }

  try {
    await queue.send(payload);
    return true;
  } catch (e) {
    console.error('[SWARM_QUEUE] send failed; falling back to inline pipeline', taskIdentifier, e);
    return false;
  }
}

/**
 * Queue consumer for `[[queues.consumers]]`.
 *
 * A producer binding with no consumer is a black hole: the task is acked at the
 * edge, the lease expires an hour later and nothing was ever generated. When
 * the `swarm-queue` binding is enabled in `wrangler.toml`, this handler is what
 * drains it.
 */
export async function consumeSwarmQueue(
  batch: { messages: { body: any; ack?: () => void; retry?: () => void }[] },
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  for (const message of batch.messages) {
    const payload = message.body;
    const taskIdentifier =
      payload?.task_id || payload?.incident_hash || payload?.ticketId || payload?.taskId || 'unknown';
    try {
      await executeCodingPipeline(payload, env, undefined, ctx);
      message.ack?.();
    } catch (e) {
      // `executeAutonomousCodingTask` releases the lease in its own finally, so
      // a retry starts from a clean state instead of being refused as busy.
      console.error('[SWARM_QUEUE] consumer failed', taskIdentifier, e);
      message.retry?.();
    }
  }
}

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

  // Patch-ready notices carry their own endpoint, because the route cannot be
  // derived from the key the way the ticket resolution route can.
  if (keyName.startsWith('dlq:satellite-callback:')) {
    return replayParkedSatelliteCallback(payloadStr, env);
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

/** Credential check shared by the read-only console endpoints. */
async function authoriseConsoleRequest(request: Request, env: Env, payloadText: string): Promise<boolean> {
  const authHeader = request.headers.get('Authorization');
  if (authHeader && await verifySupabaseToken(authHeader, env)) return true;
  if (request.headers.get('X-Axim-Signature')) {
    return verifyInternalRelay(request, payloadText, env);
  }
  return false;
}

/**
 * GET /api/v1/github/tree — repository tree for the dashboard file browser.
 *
 * This handler used to sit *after* the `request.method !== 'POST'` guard, so a
 * GET could never reach it and the file browser always received 405. It now
 * runs before that guard and authenticates with the operator session.
 */
export async function handleGithubTreeRequest(request: Request, env: Env, payloadText: string): Promise<Response> {
  const cors = { 'Content-Type': 'application/json', ...getCorsHeaders(request) };
  if (!(await authoriseConsoleRequest(request, env, payloadText))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors });
  }

  const url = new URL(request.url);
  const owner = url.searchParams.get('owner');
  const repo = url.searchParams.get('repo');
  if (!owner || !repo) {
    return new Response(JSON.stringify({ error: 'Missing owner or repo' }), { status: 400, headers: cors });
  }

  // Pin the owner. The worker reads and merges with its own GitHub token, so it
  // must never be pointed outside the canonical fleet.
  const resolved = resolveRepoMetadata(`${owner}/${repo}`);
  const githubHeaders = {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'User-Agent': 'AXiM-Coding-Lab',
    'Accept': 'application/vnd.github.v3+json'
  };

  try {
    const metaResp = await fetch(`https://api.github.com/repos/${resolved.owner}/${resolved.repo}`, { headers: githubHeaders });
    if (!metaResp.ok) {
      return new Response(JSON.stringify({ error: 'GitHub API error', status: metaResp.status }), { status: 502, headers: cors });
    }
    const metaData: any = await metaResp.json();
    const defaultBranch = metaData.default_branch || 'main';

    const ghResponse = await fetch(
      `https://api.github.com/repos/${resolved.owner}/${resolved.repo}/git/trees/${defaultBranch}?recursive=1`,
      { headers: githubHeaders }
    );
    const ghData: any = await ghResponse.json();
    if (!ghResponse.ok) {
      return new Response(JSON.stringify({ error: 'GitHub API error', details: ghData }), { status: ghResponse.status, headers: cors });
    }
    return new Response(JSON.stringify(ghData), { status: 200, headers: cors });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
  }
}

/**
 * GET /api/v1/dlq/stats — dead-letter queue depth for the cockpit.
 * Same dead-code story: it was defined behind the POST-only guard, so the
 * dashboard read a 405 and rendered zero.
 */
export async function handleDlqStatsRequest(request: Request, env: Env, payloadText: string): Promise<Response> {
  const cors = { 'Content-Type': 'application/json', ...getCorsHeaders(request) };
  if (!(await authoriseConsoleRequest(request, env, payloadText))) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors });
  }

  let dlqPendingCount = 0;
  try {
    if (env.CODER_DLQ_KV) {
      dlqPendingCount = (await env.CODER_DLQ_KV.list({ prefix: 'dlq:' })).keys.length;
    } else if (env.LAB_STATE) {
      dlqPendingCount = (await env.LAB_STATE.list({ prefix: 'dlq:' })).keys.length;
    }
  } catch (e) {
    console.error('Failed to fetch DLQ stats', e);
  }

  return new Response(JSON.stringify({
    status: 'success',
    pending_count: dlqPendingCount,
    timestamp: new Date().toISOString()
  }), { status: 200, headers: cors });
}

/**
 * POST /api/v1/dlq/sweep — replay everything parked in the dead-letter queue.
 *
 * Authorised by either an operator session (Supabase-verified bearer) or a
 * signed relay envelope. It runs *before* the blanket zero-trust block because
 * the operator console must be able to sweep without holding
 * `AXIM_INTERNAL_KEY`: `VITE_*` values are compiled into the public bundle, so
 * signing in the browser either fails (no key configured) or ships the shared
 * secret to every visitor.
 */
export async function handleDlqSweepRequest(request: Request, env: Env, payloadText: string): Promise<Response> {
  const cors = { 'Content-Type': 'application/json', ...getCorsHeaders(request) };

  const authHeader = request.headers.get('Authorization');
  const isOperator = authHeader ? await verifySupabaseToken(authHeader, env) : false;
  const isRelay = !isOperator && request.headers.get('X-Axim-Signature')
    ? await verifyInternalRelay(request, payloadText, env)
    : false;

  if (!isOperator && !isRelay) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors });
  }

  if (!env.CODER_DLQ_KV) {
    return new Response(JSON.stringify({
      status: 'skipped',
      reprocessed: 0,
      remaining: 0,
      reason: 'CODER_DLQ_KV binding is not configured'
    }), { status: 200, headers: cors });
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

    return new Response(JSON.stringify({ status: 'success', reprocessed: reprocessedCount, remaining: remainingCount }), {
      status: 200, headers: cors
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Internal Error processing DLQ sweep' }), {
      status: 500, headers: cors
    });
  }
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
  async queue(batch: { messages: { body: any; ack?: () => void; retry?: () => void }[] }, env: Env, ctx: ExecutionContext) {
    await consumeSwarmQueue(batch, env, ctx);
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
        // Every value below is measured or explicitly `null`. This endpoint used
        // to answer `requestCounts.total: 100`, `kvCacheHits: 95` and a 42MB
        // heap no worker ever reported, which the dashboard rendered as live
        // telemetry. `startTime` is epoch millis, so it is paired with
        // `Date.now()` — mixing in `performance.now()` produced a large
        // negative latency.
        let dlqPendingCount: number | null = null;
        try {
          if (env.CODER_DLQ_KV) {
            dlqPendingCount = (await env.CODER_DLQ_KV.list({ prefix: 'dlq:' })).keys.length;
          }
        } catch (e) {
          console.warn('[TELEMETRY] DLQ depth unavailable', e);
        }

        let telemetryEventCount: number | null = null;
        try {
          if (env.TELEMETRY_KV) {
            telemetryEventCount = (await env.TELEMETRY_KV.list({ prefix: 'telemetry:' })).keys.length;
          }
        } catch (e) {
          console.warn('[TELEMETRY] event count unavailable', e);
        }

        const upstreamHealth = env.SUPABASE_URL ? 'ONLINE' : 'DEGRADED';

        const stats = {
          roundTripLatencyMs: Date.now() - startTime,
          requestCount: null,
          telemetryEventCount,
          kvCacheHits: null,
          workerMemory: null,
          agentExecutionStatus: 'Nominal',
          upstreamHealth,
          dlqPendingCount,
          cloudflareColo: request.cf?.colo || 'ORD',
          metricsSource: 'edge-worker',
          sampledAt: new Date().toISOString()
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
        // Bindings are optional in `wrangler.toml`; reading them unguarded turned
        // a missing namespace into a 500 instead of an empty series.
        let dlqPendingCount: number | null = null;
        try {
          if (env.CODER_DLQ_KV) {
            dlqPendingCount = (await env.CODER_DLQ_KV.list({ prefix: 'dlq:' })).keys.length;
          }
        } catch (e) {
          console.warn('[TELEMETRY] DLQ depth unavailable', e);
        }

        const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 500);
        const agentFilter = url.searchParams.get("agentId");

        const events: any[] = [];
        if (env.TELEMETRY_KV) {
          const listParams = { limit: limit, prefix: agentFilter ? `telemetry:${agentFilter}:` : 'telemetry:' };
          const listResult = await env.TELEMETRY_KV.list(listParams);

          for (const key of listResult.keys) {
            const data = await env.TELEMETRY_KV.get(key.name);
            if (data) {
              events.push(JSON.parse(data));
            }
          }
        }

        events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        const latencies = events
          .map((event) => Number(event?.latencyMs))
          .filter((value) => Number.isFinite(value));

        const stats = {
          events,
          total_events: events.length,
          average_latency: latencies.length > 0
            ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length
            : null,
          total_tokens: events.reduce((sum, event) => sum + (Number(event?.tokensUsed) || 0), 0),
          worker_uptime: null,
          memory_execution_markers: null,
          dlq_pending_count: dlqPendingCount,
          cloudflare_colo: request.cf?.colo || 'ORD',
          sampledAt: new Date().toISOString()
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

            // Human-in-the-loop pull request gate.
            //
            // GET renders a confirmation page and never mutates anything: mail
            // clients and link scanners prefetch GET links, and this endpoint
            // used to merge a pull request on that prefetch. POST performs the
            // decision, and the merge coordinates come from the server-side
            // token record — never from the query string.
            if (url.pathname === '/api/v1/pr/action') {
              // A POST carries the decision in a form body; a GET may only ever
              // ask for the confirmation page, so its decision stays advisory.
              const form = request.method === 'POST'
                ? await request.clone().formData().catch(() => null)
                : null;

              const formDecision = form?.get('decision');
              const rawDecision = typeof formDecision === 'string' && formDecision.length > 0
                ? formDecision
                : url.searchParams.get('decision');
              const decision = rawDecision ?? 'merge';

              if (decision !== 'merge' && decision !== 'revise') {
                return renderGatePage({ heading: 'Invalid Decision', status: 400 });
              }

              const formToken = form?.get('token');
              const token = typeof formToken === 'string' && formToken.length > 0
                ? formToken
                : url.searchParams.get('token');

              const resolvedToken = await readApprovalRecord(env.TASK_LOCKS, token);
              if ('error' in resolvedToken) {
                return renderGatePage({ heading: 'Approval Rejected', detail: resolvedToken.error, status: resolvedToken.status });
              }
              const { record } = resolvedToken;
              const prUrl = `https://github.com/${record.owner}/${record.repo}/pull/${record.pr}`;

              if (request.method !== 'POST') {
                return renderGatePage({
                  heading: decision === 'revise' ? 'Request Revision' : 'Approve & Merge',
                  detail: `${record.title ? record.title + ' — ' : ''}${record.owner}/${record.repo}#${record.pr}. Nothing has been merged yet; confirm below.`,
                  status: 200,
                  confirmAction: '/api/v1/pr/action',
                  token: token as string,
                  decision
                });
              }

              // Single-use: consume before the side effect so a double submit
              // (or a retried POST) cannot merge twice.
              await env.TASK_LOCKS.put(`${APPROVAL_TOKEN_PREFIX}${token}`, 'consumed', {
                expirationTtl: APPROVAL_TOKEN_TTL_SECONDS
              });

              if (decision === 'revise') {
                if (record.taskId) {
                  await releaseTaskLock(env.TASK_LOCKS, record.taskId);
                }
                return renderGatePage({ heading: 'Revision Requested', detail: `#${record.pr} was not merged. The task lease was released.`, status: 200 });
              }

              let mergeSha: string | null = null;
              try {
                const merge = await mergePullRequest({ owner: record.owner, repo: record.repo, path: '' }, record.pr, env);
                mergeSha = merge.sha;
              } catch (e: any) {
                // GitHub refused the merge (conflict, failing checks, transient
                // 5xx). Give the approval link back so the operator can retry
                // once the branch is healthy instead of waiting for tomorrow's
                // briefing to mint a new one.
                await env.TASK_LOCKS.put(`${APPROVAL_TOKEN_PREFIX}${token}`, JSON.stringify(record), {
                  expirationTtl: APPROVAL_TOKEN_TTL_SECONDS
                });
                return renderGatePage({ heading: 'Error Merging PR', detail: e?.message ?? 'GitHub rejected the merge.', status: 502 });
              }

              // A merged PR is the terminal event for the ticket. The gate used
              // to send a `PATCH_READY` notice — to a route the Support System
              // does not publish — and never resolved the ticket, so every
              // operator-approved merge left it parked in `Review-Patch-Pending`
              // until someone closed it by hand. The notice also carried
              // `commit_sha: "merged"`, a value the Support System echoed to the
              // operator as a commit id.
              if (record.taskId) {
                const resolution = await dispatchCallbackWebhook('support', {
                  ticketId: record.taskId,
                  status: 'resolved',
                  prUrl,
                  commitSha: mergeSha,
                  resolutionNotes: [
                    `Merged ${prUrl} into ${record.owner}/${record.repo} after operator approval in the Coding Lab gate.`,
                    mergeSha ? `Merge commit: ${mergeSha}.` : 'Merge commit: not reported by GitHub.',
                    'CI results for the merged commit are on the pull request.'
                  ].join('\n')
                }, env);
                if (!resolution.ok) {
                  console.warn('[HITL] ticket resolution callback not delivered', record.taskId, resolution.error, resolution.dlqKey ?? 'no-dlq-key');
                }
              }

              if (record.taskId) {
                await clearTaskState(env.TASK_LOCKS, record.taskId);
                try {
                  await fetch(`${env.SUPABASE_URL}/rest/v1/coding_tasks?id=eq.${encodeURIComponent(record.taskId)}`, {
                    method: 'PATCH',
                    headers: {
                      'Content-Type': 'application/json',
                      'apikey': ((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || ''),
                      'Authorization': `Bearer ${((env as any).SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY || '')}`
                    },
                    body: JSON.stringify({ status: 'MERGED' })
                  });
                } catch (e) {
                  console.error('[HITL] failed to mark task MERGED', record.taskId, e);
                }
              }

              return renderGatePage({ heading: 'PR Successfully Approved & Merged', detail: prUrl, status: 200 });
            }

            // 0. Read-only console routes.
            //
            // These are GETs, so they have to be matched before the POST-only
            // protocol restriction below. Both handlers authenticate with the
            // operator session (or a relay signature).
            if (url.pathname === '/api/v1/dlq/stats' || url.pathname === '/api/v1/github/tree') {
              if (request.method !== 'GET') {
                return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
                  status: 405, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              }
              return url.pathname === '/api/v1/dlq/stats'
                ? await handleDlqStatsRequest(request, env, '')
                : await handleGithubTreeRequest(request, env, '');
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

                      // Clear the run lease and the open-PR marker: the pull
                      // request is closed, so the task is no longer in flight.
                      await clearTaskState(env.TASK_LOCKS, taskId);
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

            // Operator- or relay-authorised maintenance routes. These verify
            // their own credentials, so they must run before the blanket
            // zero-trust block below.
            if (request.method === 'POST' && url.pathname === '/api/v1/dlq/sweep') {
              return await handleDlqSweepRequest(request, env, await request.clone().text());
            }


            // 2. The Zero-Trust Handshake
            //
            // Two accepted proofs of identity:
            //
            //   * a satellite relay signature — v2 `timestamp.body` HMAC, with a
            //     logged fallback to the legacy body-only form; or
            //   * a verified Supabase operator session.
            //
            // A session-verified operator has to be enough on its own. The
            // dashboard used to sign every task dispatch in the browser with
            // `import.meta.env.VITE_AXIM_INTERNAL_KEY`, which Vite inlines into
            // the public bundle: either no key was configured and the signature
            // was garbage (403 on every dispatch), or the shared internal key
            // shipped to every visitor. `README.md` forbids the latter, so the
            // session is the operator's proof and the HMAC stays the service
            // credential.
            //
            // A signature that is *present* is always verified and never
            // downgraded to the session path — a tampered body must fail.
            const signature = request.headers.get('X-Axim-Signature');
            const payloadText = await request.clone().text();

            if (signature) {
              const isVerified = await verifyInternalRelay(request, payloadText, env);

              if (!isVerified) {
                return new Response(JSON.stringify({ error: 'Unauthorized: Cryptographic Verification Failed' }), {
                  status: 403, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              }
            } else {
              const hasOperatorSession = await verifySupabaseToken(request.headers.get('Authorization'), env);

              if (!hasOperatorSession) {
                return new Response(JSON.stringify({ error: 'Unauthorized: Missing Signature Boundary' }), {
                  status: 401, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              }

              console.log('[AUTH] relay request authorised by operator session', { path: url.pathname });
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

                // Evict the run lease. The open-PR marker is deliberately kept:
                // dropping it would let the same ticket produce a second pull
                // request. Pass `clear_pr: true` when the operator really does
                // want the ticket regenerated from scratch.
                const openPrUrl = await readOpenPullRequest(env.TASK_LOCKS, taskId);
                if (payload.clear_pr === true) {
                  await clearTaskState(env.TASK_LOCKS, taskId);
                } else {
                  await releaseTaskLock(env.TASK_LOCKS, taskId);
                }

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

                return new Response(JSON.stringify({
                  status: 'success',
                  message: 'Lock evicted',
                  open_pull_request: openPrUrl,
                  cleared_pull_request_marker: payload.clear_pr === true
                }), {
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

                const lease = await acquireTaskLock(env.TASK_LOCKS, taskId);
                if (!lease.acquired) {
                  return new Response(JSON.stringify({
                    status: 'ignored',
                    message: lease.reason === 'pr-open'
                      ? 'This ticket already has an open pull request awaiting review.'
                      : 'Task actively processing',
                    reason: lease.reason,
                    ...(lease.reason === 'pr-open' ? { pr_url: lease.prUrl } : {})
                  }), { status: 202, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) } });
                }

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
                   // A rejection means "generate again": drop both the lease and the
                   // open-PR marker, otherwise the next dispatch is refused as a
                   // duplicate of the patch that was just rejected.
                   await clearTaskState(env.TASK_LOCKS, taskIdentifier);
                   return new Response(JSON.stringify({
                     status: 'accepted',
                     message: 'Patch rejected, task unlocked and pull request marker cleared.'
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

                const merge = await mergePullRequest(githubCtx, pr_number, env);

                if (payload.source === "axim-support-system" && payload.ticketId) {
                  const prUrl = `https://github.com/${repository_owner}/${repository_name}/pull/${pr_number}`;
                  // One delivery path for every satellite callback: v2 envelope,
                  // the merge SHA GitHub actually reported, and DLQ parking when
                  // the relay fails. This block used to re-implement the relay
                  // inline, with a v2 signature, its own DLQ write, and a
                  // resolution note claiming "All automated tests passed
                  // cleanly" — a verification this service never ran.
                  const resolution = await dispatchCallbackWebhook('support', {
                    ticketId: payload.ticketId,
                    status: 'resolved',
                    prUrl,
                    commitSha: merge.sha,
                    resolutionNotes: [
                      `Automated patch merged by the AXiM Coding Lab.\n- PR: ${prUrl}`,
                      merge.sha ? `- Merge commit: ${merge.sha}` : '- Merge commit: not reported by GitHub.',
                      '- CI results for the merged commit are on the pull request.'
                    ].join('\n')
                  }, env);
                  if (!resolution.ok) {
                    console.error(`[AUTONOMOUS_CODER] resolution callback for ticket ${payload.ticketId} not delivered:`, resolution.error, resolution.dlqKey ?? 'no-dlq-key');
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
                if (env.TELEMETRY_KV) {
                  await env.TELEMETRY_KV.put(eventId, JSON.stringify(payload), { expirationTtl: 86400 * 7 }); // 7 days retention
                }

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

            // The relay handshake above admits either a satellite signature or a
            // verified operator session; these task routes additionally require
            // the operator session, so a signature alone cannot drive generation.
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


              // Claim the run lease. Any value already at `lock:<id>` means the
              // task is busy — see `locks.ts` for why this used to differ
              // between the two ingress routes.
              let lease: Awaited<ReturnType<typeof acquireTaskLock>>;
              try {
                lease = await acquireTaskLock(env.TASK_LOCKS, taskIdentifier);
              } catch (kvError) {
                return new Response(JSON.stringify({ error: "Edge memory capacity exceeded. Try again in a few moments." }), {
                  status: 429, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              }
              if (!lease.acquired) {
                return new Response(JSON.stringify({
                  status: 'ignored',
                  message: lease.reason === 'pr-open'
                    ? 'This task already has an open pull request awaiting review.'
                    : 'Task is currently locked and actively processing in the Lab.',
                  reason: lease.reason,
                  ...(lease.reason === 'pr-open' ? { pr_url: lease.prUrl } : {})
                }), {
                  status: 202, headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
                });
              }

              if (payload.target_file_paths && payload.target_file_paths.length > 1) {
                // Task exceeds safe V8 CPU time limits for standard fetch event. Offload to Queue.
                const enqueued = await enqueueSwarmTask(env, payload, taskIdentifier);
                if (!enqueued) {
                  // The lease was already claimed; hand the work to waitUntil so
                  // the caller still gets a 202 instead of a 500 over a queue
                  // binding that is absent, misconfigured or full.
                  ctx.waitUntil(executeCodingPipeline(payload, env, null, ctx));
                }
                return new Response(JSON.stringify({
                  status: 'accepted',
                  message: enqueued
                    ? 'Payload verified. Heavy task dispatched to Swarm Queue.'
                    : 'Payload verified. Swarm queue unavailable; running the task inline.',
                  task_id: taskIdentifier,
                  transport: enqueued ? 'queue' : 'inline'
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
