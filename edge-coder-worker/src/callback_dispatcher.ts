/**
 * Coder → satellite readiness/resolution callbacks.
 *
 * Three defects made every one of these notifications a silent no-op, and all
 * three were verified against the receiving systems rather than guessed at:
 *
 * 1. **Routes.** The Support System exposes `POST /api/v1/tickets/callback`
 *    (patch-ready, flips the ticket to `Review-Patch-Pending`) and
 *    `POST /api/v1/tickets/:id/resolve-from-coder` (terminal resolution). This
 *    module posted patch-ready notices to `/api/v1/tickets/:id/patch-status`,
 *    which has never existed upstream — so every task run produced a 404 that
 *    was logged and discarded. Asguard publishes no coder-facing resolution
 *    route at all; see {@link buildSatelliteRequest}.
 * 2. **Signing.** The body-only (v1) signature cannot be replayed safely and
 *    the Support System rejects it outright after `AXIM_SIG_LEGACY_UNTIL`
 *    (default 2026-12-31). These callbacks now carry the v2 envelope
 *    (`X-Axim-Timestamp` + HMAC over `${ts}.${body}`), the same contract every
 *    other satellite relay in the lab already speaks.
 * 3. **Delivery.** Failures were logged and dropped, so a 404/401/outage lost
 *    the ticket update with nothing to retry. Failures are now parked in
 *    `CODER_DLQ_KV` under a key the DLQ sweeper can replay with a fresh
 *    envelope, and the caller gets a structured result instead of `void`.
 *
 * Payload keys are normalised because the pipeline's call sites predate this
 * contract and speak snake_case (`ticket_id`, `pr_url`, `commit_sha`) while the
 * satellites read camelCase.
 */

import type { Env } from './ingress';
import { generateSignedEnvelope, signedHeaders } from './utils/crypto';

export type SatelliteSystem = 'support' | 'asguard';

/** Anything a call site may pass. Both spellings are accepted. */
export interface SatelliteCallbackPayload {
  ticketId?: string;
  ticket_id?: string;
  incidentHash?: string;
  incident_hash?: string;
  status?: string;
  prUrl?: string;
  pr_url?: string;
  branch?: string;
  commitSha?: string | null;
  commit_sha?: string | null;
  patchDetails?: string | null;
  resolutionNotes?: string | null;
}

export interface CallbackResult {
  ok: boolean;
  system: SatelliteSystem;
  /** `null` when the satellite publishes no route for this notification. */
  endpoint: string | null;
  status?: number;
  error?: string;
  /** Set when the payload was parked for the DLQ sweeper. */
  dlqKey?: string;
}

/**
 * A parked callback. The wire body is stored verbatim (not rebuilt on replay)
 * so a redelivery carries the original `completedAt`/`commitSha` rather than
 * restamping the ticket with the replay time.
 */
export interface ParkedSatelliteCallback {
  system: SatelliteSystem;
  endpoint: string;
  body: unknown;
  parkedAt: string;
  attempts: number;
  lastError?: string;
}

export const SUPPORT_BASE_URL = 'https://support.axim.us.com';

/** Upstream hosts are internal relays; a hung one must not hold the request. */
const CALLBACK_TIMEOUT_MS = 10_000;

let asguardGapWarned = false;

interface BuiltRequest {
  endpoint: string;
  body: Record<string, unknown>;
}

interface UnsupportedRequest {
  unsupported: string;
}

function firstString(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return null;
}

/**
 * Accepts a commit id, rejects a description of one.
 *
 * The pipeline used to send `"pending"` and the merge gate `"merged"` in the
 * `commitSha` slot, and the Support System rendered both back to the operator as
 * a commit id. Anything that is not 7–40 hex characters is not a commit.
 */
function realCommitSha(...values: (string | null | undefined)[]): string | null {
  const candidate = firstString(...values);
  return candidate && /^[0-9a-f]{7,40}$/i.test(candidate) ? candidate : null;
}

/** Ticket id (support) or incident hash (asguard), whichever the payload has. */
export function satelliteSubjectId(system: SatelliteSystem, payload: SatelliteCallbackPayload): string | null {
  if (system === 'support') {
    return firstString(payload.ticketId, payload.ticket_id);
  }
  return firstString(payload.incidentHash, payload.incident_hash, payload.ticketId, payload.ticket_id);
}

/**
 * Maps a callback onto the route and body the receiving satellite actually
 * implements.
 *
 * Asguard returns `unsupported` on purpose. The SOC publishes
 * `/api/v1/triage/dispatch` (a mitigation order: `threatId`/`action`/
 * `targetValue`) and nothing that accepts a coder rule-PR notice, so the old
 * `POST /api/v1/triage/resolution` was a guaranteed 404 on every run. Posting
 * into a route that does not exist is not "attempting" a notification — the
 * interlock stays open in `DEBUGGING_NOTES.md` until asguard ships the endpoint.
 */
export function buildSatelliteRequest(
  system: SatelliteSystem,
  payload: SatelliteCallbackPayload
): BuiltRequest | UnsupportedRequest {
  const subjectId = satelliteSubjectId(system, payload);

  if (system === 'asguard') {
    return {
      unsupported: subjectId
        ? 'asguard publishes no coder-facing resolution route; notification not attempted'
        : 'missing incident identifier'
    };
  }

  if (!subjectId) {
    return { unsupported: 'missing ticket identifier' };
  }

  const isResolution = payload.status === 'resolved' || payload.status === 'closed' || Boolean(payload.resolutionNotes);

  if (isResolution) {
    return {
      endpoint: `${SUPPORT_BASE_URL}/api/v1/tickets/${encodeURIComponent(subjectId)}/resolve-from-coder`,
      body: {
        status: payload.status === 'closed' ? 'closed' : 'resolved',
        resolutionNotes: firstString(payload.resolutionNotes) ?? 'Resolved by the AXiM Coding Lab.',
        completedAt: new Date().toISOString()
      }
    };
  }

  return {
    endpoint: `${SUPPORT_BASE_URL}/api/v1/tickets/callback`,
    body: {
      ticketId: subjectId,
      patchDetails: firstString(payload.patchDetails) ?? null,
      // A real SHA or nothing. The previous code sent the literal string
      // "merged"/"pending", which the Support System rendered back to the
      // operator as a commit id.
      commitSha: realCommitSha(payload.commitSha, payload.commit_sha),
      prUrl: firstString(payload.prUrl, payload.pr_url)
    }
  };
}

/** DLQ key for a parked notification. Ticket id is in the key so the sweeper can name it. */
export function satelliteDlqKey(system: SatelliteSystem, subjectId: string): string {
  return `dlq:satellite-callback:${system}:${subjectId}`;
}

/** The Support System resolution route, which the DLQ sweeper replays directly. */
export function isResolutionRequest(endpoint: string): boolean {
  return endpoint.endsWith('/resolve-from-coder');
}

async function postSignedCallback(endpoint: string, body: unknown, env: Env): Promise<Response> {
  const bodyString = JSON.stringify(body);
  const envelope = await generateSignedEnvelope(bodyString, env.AXIM_INTERNAL_KEY);
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...signedHeaders(envelope)
    },
    body: bodyString,
    signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS)
  });
}

async function park(
  env: Env,
  key: string,
  parked: ParkedSatelliteCallback | Record<string, unknown>
): Promise<string | undefined> {
  const dlq = (env as any).CODER_DLQ_KV;
  if (!dlq) return undefined;
  try {
    await dlq.put(key, JSON.stringify(parked));
    return key;
  } catch (e: any) {
    console.error('[CALLBACK] could not park failed callback in the DLQ', e?.message);
    return undefined;
  }
}

/**
 * Parks a failed callback so the DLQ sweeper can retry it.
 *
 * Resolution callbacks keep the historical `dlq:ticket-callback:<id>` key and
 * raw-body shape: entries already parked in production must keep replaying
 * through the sweeper's existing branch, and the endpoint is derivable from the
 * ticket id in the key. New patch-ready notices have no such derivation, so
 * they are parked as a full envelope under the satellite-callback namespace.
 */
async function parkFailedCallback(
  env: Env,
  system: SatelliteSystem,
  subjectId: string,
  request: BuiltRequest,
  lastError: string
): Promise<string | undefined> {
  if (isResolutionRequest(request.endpoint)) {
    return park(env, `dlq:ticket-callback:${subjectId}`, request.body);
  }
  return park(env, satelliteDlqKey(system, subjectId), {
    system,
    endpoint: request.endpoint,
    body: request.body,
    parkedAt: new Date().toISOString(),
    attempts: 1,
    lastError
  } satisfies ParkedSatelliteCallback);
}

/**
 * Sends one satellite notification.
 *
 * Never throws: a callback failure must not fail the merge or the pipeline that
 * triggered it. The result tells the caller what happened so it can log
 * accurately instead of assuming delivery.
 */
export async function dispatchCallbackWebhook(
  system: SatelliteSystem,
  payload: SatelliteCallbackPayload,
  env: Env
): Promise<CallbackResult> {
  if (!env.AXIM_INTERNAL_KEY) {
    console.error('[CALLBACK] Failed: Missing AXIM_INTERNAL_KEY');
    return { ok: false, system, endpoint: null, error: 'missing AXIM_INTERNAL_KEY' };
  }

  const request = buildSatelliteRequest(system, payload);

  if ('unsupported' in request) {
    if (system === 'asguard' && !asguardGapWarned) {
      asguardGapWarned = true;
      console.warn(`[CALLBACK] ${request.unsupported} — tracked as open interlock debt in DEBUGGING_NOTES.md`);
    }
    return { ok: false, system, endpoint: null, error: request.unsupported };
  }

  const subjectId = satelliteSubjectId(system, payload) as string;

  try {
    const response = await postSignedCallback(request.endpoint, request.body, env);
    if (response.ok) {
      return { ok: true, system, endpoint: request.endpoint, status: response.status };
    }

    const lastError = `HTTP ${response.status}`;
    console.error(`[CALLBACK] ${system} callback rejected: ${lastError} ${request.endpoint}`);
    const dlqKey = await parkFailedCallback(env, system, subjectId, request, lastError);
    return { ok: false, system, endpoint: request.endpoint, status: response.status, error: lastError, dlqKey };
  } catch (err: any) {
    const lastError = err?.message || String(err);
    console.error(`[CALLBACK] ${system} callback transport failure: ${lastError}`);
    const dlqKey = await parkFailedCallback(env, system, subjectId, request, lastError);
    return { ok: false, system, endpoint: request.endpoint, error: lastError, dlqKey };
  }
}

/**
 * Replays a parked callback with a fresh v2 envelope.
 *
 * Returns `true` when the entry is settled and may be evicted: delivered, or
 * undeliverable because the persisted shape predates this module (there is
 * nothing to rebuild a request from, and retrying forever only grows the DLQ).
 */
export async function replayParkedSatelliteCallback(parkedJson: string, env: Env): Promise<boolean> {
  let parked: ParkedSatelliteCallback;
  try {
    parked = JSON.parse(parkedJson);
  } catch {
    console.warn('[DLQ] evicting unparseable satellite callback entry');
    return true;
  }

  if (!parked?.endpoint || !parked?.body || !parked?.system) {
    console.warn('[DLQ] evicting satellite callback entry with no replayable request');
    return true;
  }

  if (!env.AXIM_INTERNAL_KEY) return false;

  try {
    const response = await postSignedCallback(parked.endpoint, parked.body, env);
    if (response.ok) return true;
    console.warn(`[DLQ] satellite callback replay rejected: HTTP ${response.status} ${parked.endpoint}`);
    return false;
  } catch (err: any) {
    console.warn(`[DLQ] satellite callback replay failed: ${err?.message || err}`);
    return false;
  }
}
