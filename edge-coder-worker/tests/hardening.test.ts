import { describe, it, expect, vi, afterEach } from 'vitest';
import worker from '../src/ingress';
import { cleanSanitizedCodeBlob } from '../src/code_generator';
import { generateHmacSignature } from '../src/utils/crypto';

function makeEnv(kvHit: boolean) {
  return {
    AXIM_INTERNAL_KEY: 'internal-key',
    GITHUB_TOKEN: 'gh',
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_SECRET_KEY: 'secret',
    TASK_LOCKS: {
      get: vi.fn().mockResolvedValue(kvHit ? 'processed' : null),
      put: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    },
  } as any;
}

async function makeRequest(key: string, body: any) {
  const raw = JSON.stringify(body);
  return new Request('https://worker.test/api/v1/ingress', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer internal-key',
      'Idempotency-Key': key,
      'X-Axim-Signature': await generateHmacSignature(raw, 'internal-key'),
    },
    body: raw,
  });
}

describe('Idempotency collision telemetry', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns 202 ignored and logs the collision to api_usage_logs', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const waits: Promise<any>[] = [];
    const ctx = { waitUntil: (p: Promise<any>) => waits.push(p) } as any;

    const res = await worker.fetch(await makeRequest('abc-123', { origin_source: 'GITHUB' }), makeEnv(true), ctx);
    await Promise.all(waits);

    expect(res.status).toBe(202);
    expect((await res.json() as any).status).toBe('ignored');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://supabase.test/rest/v1/api_usage_logs');
    const row = JSON.parse(init.body)[0];
    expect(row.endpoint).toBe('/api/v1/ingress');
    expect(row.metadata).toEqual({ event: 'IDEMPOTENCY_COLLISION_BLOCKED', key: 'abc-123', source: 'GITHUB' });
  });

  it('still returns 202 when the telemetry call fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const waits: Promise<any>[] = [];
    const ctx = { waitUntil: (p: Promise<any>) => waits.push(p) } as any;
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await worker.fetch(await makeRequest('abc-456', {}), makeEnv(true), ctx);
    await expect(Promise.all(waits)).resolves.toBeDefined();
    expect(res.status).toBe(202);
  });
});

describe('cleanSanitizedCodeBlob', () => {
  it('strips fences with trailing spaces/tabs after the language tag', () => {
    expect(cleanSanitizedCodeBlob('```ts \t \nconst a = 1;\n```')).toBe('const a = 1;');
  });
  it('strips fences without a language tag', () => {
    expect(cleanSanitizedCodeBlob('```\nx\n```')).toBe('x');
  });
  it('leaves plain code untouched', () => {
    expect(cleanSanitizedCodeBlob('const a = 1;')).toBe('const a = 1;');
  });
});


