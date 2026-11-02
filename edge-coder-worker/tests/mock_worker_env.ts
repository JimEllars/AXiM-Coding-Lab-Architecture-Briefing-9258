/**
 * Shared test scaffolding for the edge-coder-worker suites.
 *
 * The worker is exercised through its real `fetch` handler and real
 * `KVNamespace` semantics — no hand-copied duplicates of the routing logic, so
 * a regression in `ingress.ts` fails the suite instead of sailing through.
 */
import type { Env, KVNamespace } from '../src/ingress';
import { generateHmacSignature, generateSignedEnvelope } from '../src/utils/crypto';

export class MockKV implements KVNamespace {
  store = new Map<string, { value: string; ttl?: number }>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key)?.value ?? null;
  }

  async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
    this.store.set(key, { value, ttl: options?.expirationTtl });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options?: { prefix?: string }): Promise<{ keys: { name: string }[]; list_complete: boolean }> {
    const prefix = options?.prefix ?? '';
    const keys = [...this.store.keys()]
      .filter((name) => name.startsWith(prefix))
      .map((name) => ({ name }));
    return { keys, list_complete: true };
  }
}

export const TEST_INTERNAL_KEY = 'test-internal-key-0123456789abcdef';

export interface MockWorkerEnv extends Env {
  SUPABASE_ACCESS_TOKEN?: string;
}

export function createMockEnv(overrides: Partial<Env> = {}): MockWorkerEnv {
  return {
    LAB_STATE: new MockKV(),
    TASK_LOCKS: new MockKV(),
    TELEMETRY_KV: new MockKV(),
    CODER_DLQ_KV: new MockKV(),
    axim_coder_metrics: { writeDataPoint: () => {} },
    AXIM_INTERNAL_KEY: TEST_INTERNAL_KEY,
    GITHUB_TOKEN: 'test-github-token',
    GITHUB_WEBHOOK_SECRET: 'test-webhook-secret',
    EMAILIT_API_KEY: 'test-email-key',
    JULES_API_KEY: 'test-jules-key',
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_LLM_PROXY_URL: 'https://supabase.test/functions/v1/llm-proxy',
    SUPABASE_SECRET_KEY: 'test-service-key',
    ...overrides
  } as MockWorkerEnv;
}

/**
 * Execution context that collects `waitUntil` work without running it, so a
 * dispatch test never reaches the LLM proxy or GitHub.
 */
export function createMockCtx() {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    waitUntil(promise: Promise<unknown>) {
      // Swallow rejections exactly like the platform does at the edge.
      pending.push(Promise.resolve(promise).catch(() => {}));
    }
  };
}

/** v2 envelope headers over the exact body bytes. */
export async function signedHeadersV2(
  body: string,
  nowMs: number = Date.now(),
  secret: string = TEST_INTERNAL_KEY
): Promise<Record<string, string>> {
  const envelope = await generateSignedEnvelope(body, secret, nowMs);
  return {
    'X-Axim-Signature': envelope.signature,
    'X-Axim-Timestamp': envelope.timestamp
  };
}

/** Legacy v1 body-only signature, for migration-parity assertions. */
export async function signedHeadersLegacy(
  body: string,
  secret: string = TEST_INTERNAL_KEY
): Promise<Record<string, string>> {
  return { 'X-Axim-Signature': await generateHmacSignature(body, secret) };
}

/** Minimal Request factory with sane defaults for edge ingress tests. */
export function makeRequest(
  path: string,
  init: { method?: string; body?: string; headers?: Record<string, string> } = {}
): Request {
  const { method = 'GET', body, headers = {} } = init;
  const requestInit: RequestInit = { method, headers };
  if (body !== undefined) {
    requestInit.body = body;
  }
  return new Request(`https://lab-worker.axim.us.com${path}`, requestInit);
}

export interface RecordedFetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/**
 * Replaces the global `fetch` so suites are hermetic and outbound envelopes can
 * be asserted. Supabase and GitHub calls succeed with minimal bodies; anything
 * unmatched succeeds with `{}`.
 */
export function installFetchStub(
  responder?: (call: RecordedFetchCall) => Response
): { calls: RecordedFetchCall[]; restore: () => void } {
  const calls: RecordedFetchCall[] = [];
  // Vitest's own module runner resolves `@vite/env` through this same global, so
  // anything that is not an absolute HTTP(S) URL has to reach the real fetch.
  const original = globalThis.fetch;

  const stub = async (input: any, init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input);
    if (!/^https?:\/\//i.test(url)) {
      return original(input, init);
    }
    const rawHeaders = (init.headers ?? {}) as Record<string, string>;
    const call: RecordedFetchCall = {
      url,
      method: (init.method ?? 'GET').toUpperCase(),
      headers: rawHeaders,
      body: typeof init.body === 'string' ? init.body : undefined
    };
    calls.push(call);

    if (responder) return responder(call);
    if (url.includes('/rest/v1/')) return new Response('[]', { status: 201 });
    if (url.includes('/auth/v1/user')) return new Response(JSON.stringify({ email: 'james.ellars@axim.us.com' }), { status: 200 });
    return new Response(JSON.stringify({ merged: true }), { status: 200 });
  };

  globalThis.fetch = stub as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    }
  };
}
