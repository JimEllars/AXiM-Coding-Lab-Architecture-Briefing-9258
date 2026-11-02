/**
 * AXiM internal relay cryptography.
 *
 * The ecosystem moved to *v2* internal signatures: the HMAC covers
 * `${unix_seconds}.${raw_body}` and travels with an `X-Axim-Timestamp` header.
 * A body-only (v1) signature can be replayed forever, so satellites are
 * migrating. The Support System rejects v1 outright after its sunset
 * (`AXIM_SIG_LEGACY_UNTIL`, default 2026-12-31), which is what produced the
 * 404/401 DLQ growth in the coder→support resolution callback.
 *
 * This module is the single place that signs and verifies internal relay
 * traffic so a satellite can never drift from the contract again.
 */

/** Replay window for v2 signatures, in seconds. Mirrors the Support System. */
export const INTERNAL_SIGNATURE_MAX_SKEW_SECONDS = 300;

const HMAC_SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export interface SignedEnvelope {
  signature: string;
  timestamp: string;
}

/** Lowercase hex HMAC-SHA256 over the exact bytes given. */
export async function generateHmacSignature(payload: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Builds a v2 envelope: signature over `${timestamp}.${payload}` plus the
 * timestamp that produced it. `nowMs` is injectable for deterministic tests.
 */
export async function generateSignedEnvelope(
  payload: string,
  secret: string,
  nowMs: number = Date.now()
): Promise<SignedEnvelope> {
  const timestamp = Math.floor(nowMs / 1000).toString();
  const signature = await generateHmacSignature(`${timestamp}.${payload}`, secret);
  return { signature, timestamp };
}

/** Headers that carry a v2 envelope on the wire. */
export function signedHeaders(envelope: SignedEnvelope): Record<string, string> {
  return {
    'X-Axim-Signature': envelope.signature,
    'X-Axim-Timestamp': envelope.timestamp
  };
}

export function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.trim().toLowerCase().replace(/^sha256=/, '');
  if (!HMAC_SHA256_HEX_RE.test(clean)) return null;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function verifyHex(payload: string, signatureHex: string, secret: string): Promise<boolean> {
  const sigBytes = hexToBytes(signatureHex);
  if (!sigBytes) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  return crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(payload));
}

export interface SignatureVerification {
  valid: boolean;
  /** `v2` when a timestamp header was present and fresh, `v1` for legacy. */
  version?: 'v1' | 'v2';
  reason?: 'missing_signature' | 'bad_hex' | 'bad_signature' | 'stale_timestamp' | 'invalid_timestamp';
}

/**
 * Verifies an inbound internal relay request body.
 *
 * - v2 (preferred): `X-Axim-Timestamp` present → HMAC over `${ts}.${body}`,
 *   `ts` within {@link INTERNAL_SIGNATURE_MAX_SKEW_SECONDS}.
 * - v1 (legacy): no timestamp header → HMAC over the body only. Honoured so
 *   satellite senders that have not shipped the v2 signer yet keep working
 *   during the migration window; callers should log every v1 acceptance.
 */
export async function verifyInternalSignature(
  rawBody: string,
  signatureHex: string | null,
  timestampHeader: string | null,
  secret: string,
  nowMs: number = Date.now()
): Promise<SignatureVerification> {
  if (!signatureHex) return { valid: false, reason: 'missing_signature' };
  if (!hexToBytes(signatureHex)) return { valid: false, reason: 'bad_hex' };

  const seenTimestamp = (timestampHeader || '').trim();
  if (seenTimestamp) {
    const ts = Number(seenTimestamp);
    if (!Number.isFinite(ts) || !Number.isInteger(ts)) {
      return { valid: false, reason: 'invalid_timestamp' };
    }
    const skew = Math.abs(Math.floor(nowMs / 1000) - ts);
    if (skew > INTERNAL_SIGNATURE_MAX_SKEW_SECONDS) {
      return { valid: false, reason: 'stale_timestamp' };
    }
    const ok = await verifyHex(`${seenTimestamp}.${rawBody}`, signatureHex, secret);
    return ok ? { valid: true, version: 'v2' } : { valid: false, reason: 'bad_signature' };
  }

  const legacyOk = await verifyHex(rawBody, signatureHex, secret);
  return legacyOk ? { valid: true, version: 'v1' } : { valid: false, reason: 'bad_signature' };
}

/**
 * Length-independent constant-time string comparison for shared secrets.
 * `===` short-circuits on the first differing byte, which leaks a prefix match
 * to any caller that can time the comparison.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  let diff = aBytes.length ^ bBytes.length;
  const length = Math.max(aBytes.length, bBytes.length);
  for (let i = 0; i < length; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}
