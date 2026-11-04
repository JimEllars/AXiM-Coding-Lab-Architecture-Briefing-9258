import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';

// The routing tests must never reach the LLM proxy or GitHub, so the pipeline
// entrypoints are stubbed while `ingress.ts` itself stays real.
const executeCodingPipeline = vi.fn(async () => {});
const executeAutonomousCodingTask = vi.fn(async () => {});
vi.mock('../src/code_generator', () => ({
  executeCodingPipeline: (...args: unknown[]) => executeCodingPipeline(...(args as [])),
  executeAutonomousCodingTask: (...args: unknown[]) => executeAutonomousCodingTask(...(args as []))
}));

import worker, { screenHostileUrl, decodeForScreening } from '../src/ingress';
import {
  createMockCtx,
  createMockEnv,
  installFetchStub,
  makeRequest,
  signedHeadersLegacy,
  signedHeadersV2,
  TEST_INTERNAL_KEY,
  type MockWorkerEnv
} from './mock_worker_env';
import { verifyInternalSignature } from '../src/utils/crypto';

let env: MockWorkerEnv;
let fetchStub: { calls: { url: string; method: string; headers: Record<string, string>; body?: string }[]; restore: () => void };

beforeEach(() => {
  env = createMockEnv();
  fetchStub = installFetchStub();
  executeCodingPipeline.mockClear();
  executeAutonomousCodingTask.mockClear();
});

afterEach(() => {
  fetchStub.restore();
});

async function dispatch(request: Request, context = createMockCtx()) {
  const response = await worker.fetch(request, env as never, context as never);
  return { response, context };
}

describe('PHP2Shell / CGI ingress defense (real worker)', () => {
  const hostileUrls = [
    '/index.php?-d+auto_prepend_file%3Dphp://input',
    '/api/v1/tasks/dispatch?auto_prepend_file=http://malicious.test/shell.txt',
    '/api/v1/tasks/dispatch?auto_append_file=/tmp/x',
    '/api/v1/tasks/dispatch?allow_url_include=1',
    '/api/v1/tasks/dispatch?disable_functions=exec',
    '/api/v1/tasks/dispatch?safe_mode=1',
    '/wp-admin/setup-config.php',
    '/wp-login.php',
    '/xmlrpc.php',
    // Local-file-inclusion traversal survives URL normalization only in the query
    // string, which is exactly how an LFI probe reaches a PHP host.
    '/api/v1/tasks/dispatch?file=../../etc/passwd',
    // Sprint 1.6: spellings the original literal rules missed.
    '/api/v1/tasks/dispatch?%2Dd+allow_url_include%3D1', // percent-encoded dash
    '/api/v1/tasks/dispatch?file=..%5c..%5cwindows%5cwin.ini', // backslash traversal
    '/api/v1/tasks/dispatch?file=shell%00.jpg', // null-byte truncation
    '/api/v1/tasks/dispatch?file=php%3A%2F%2Ffilter%2Fconvert', // stream wrapper
    '/api/v1/tasks/dispatch?file=phar://payload.phar',
    '/cgi-bin/php.cgi',
    '/.env',
    '/.git/config',
    '/api/v1/tasks/dispatch?file=/etc/passwd',
    '/api/v1/tasks/dispatch?f=%252e%252e%252fetc', // double-encoded traversal
    '/api/v1/tasks/dispatch?php_value=auto_prepend_file=1'
  ];

  for (const hostileUrl of hostileUrls) {
    test(`rejects ${hostileUrl}`, async () => {
      const { response } = await dispatch(makeRequest(hostileUrl, { method: 'POST', body: '{}' }));
      expect(response.status).toBe(403);
      const body: any = await response.json();
      expect(String(body.error)).toMatch(/Forbidden/);
    });
  }

  // The dashboard's own routes carry dots, dashes and slashes; screening must
  // stay signature-driven instead of refusing the traffic the fleet sends.
  const benignUrls = [
    '/api/v1/tasks/dispatch',
    '/api/v1/github/tree?owner=JimEllars&repo=axim-core-v1.2',
    '/api/telemetry/stats?limit=50&agentId=AXIM-CODER-01',
    '/api/v1/dlq/stats?prefix=dlq%3A',
    '/api/v1/health/integrations',
    '/healthz'
  ];

  for (const benignUrl of benignUrls) {
    test(`allows ${benignUrl}`, async () => {
      const request = makeRequest(benignUrl, { method: 'POST', body: '{}' });
      expect(screenHostileUrl(new URL(request.url), request)).toBeNull();
    });
  }

  test('decodes percent-encoding twice without throwing on malformed sequences', () => {
    expect(decodeForScreening('%2Dd')).toBe('-d');
    expect(decodeForScreening('%252e%252e')).toBe('..');
    expect(decodeForScreening('?f=100%')).toBe('?f=100%');
    expect(decodeForScreening('')).toBe('');
  });

  test('screening runs before env validation, so probes never learn about config', async () => {
    const brokenEnv = createMockEnv({ AXIM_INTERNAL_KEY: '' });
    const response = await worker.fetch(
      makeRequest('/?auto_prepend_file=1', { method: 'POST', body: '{}' }),
      brokenEnv as never,
      createMockCtx() as never
    );
    expect(response.status).toBe(403);
  });

  test('allows a normal API path through the screen', () => {
    const request = makeRequest('/api/v1/tasks/dispatch');
    expect(screenHostileUrl(new URL(request.url), request)).toBeNull();
  });
});

describe('CORS and liveness', () => {
  test('answers preflight with no body and CORS headers', async () => {
    const { response } = await dispatch(
      makeRequest('/api/v1/tasks/dispatch', {
        method: 'OPTIONS',
        headers: { Origin: 'https://axim-coding-lab-dashboard.pages.dev' }
      })
    );
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://axim-coding-lab-dashboard.pages.dev'
    );
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('X-Axim-Timestamp');
  });

  test('reports healthy with binding status', async () => {
    const { response } = await dispatch(makeRequest('/healthz'));
    expect(response.status).toBe(200);
    const body: any = await response.json();
    expect(body.status).toBe('healthy');
    expect(body.bindings.SUPABASE_URL).toBe(true);
  });

  test('stamps telemetry headers on every response', async () => {
    const { response } = await dispatch(makeRequest('/healthz'));
    expect(response.headers.get('X-Edge-Ray-Id')).toBeTruthy();
    expect(response.headers.get('X-Response-Time-Ms')).toBeTruthy();
  });
});

describe('Zero-trust envelope enforcement', () => {
  test('missing signature is rejected with 401', async () => {
    const { response } = await dispatch(makeRequest('/api/v1/force-unlock', { method: 'POST', body: '{}' }));
    expect(response.status).toBe(401);
  });

  test('tampered body is rejected with 403', async () => {
    const body = JSON.stringify({ task_id: 'task-1' });
    const headers = await signedHeadersV2(body);
    const { response } = await dispatch(
      makeRequest('/api/v1/force-unlock', {
        method: 'POST',
        body: JSON.stringify({ task_id: 'task-2' }),
        headers
      })
    );
    expect(response.status).toBe(403);
  });

  test('stale v2 timestamp is rejected with 403', async () => {
    const body = JSON.stringify({ task_id: 'task-1' });
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    const headers = await signedHeadersV2(body, tenMinutesAgo);
    const { response } = await dispatch(
      makeRequest('/api/v1/force-unlock', { method: 'POST', body, headers })
    );
    expect(response.status).toBe(403);
  });

  test('accepts a fresh v2 envelope and evicts the lock', async () => {
    await env.TASK_LOCKS.put('lock:task-42', 'in_progress');
    const body = JSON.stringify({ task_id: 'task-42' });
    const headers = await signedHeadersV2(body);
    const { response } = await dispatch(
      makeRequest('/api/v1/force-unlock', { method: 'POST', body, headers })
    );

    expect(response.status).toBe(200);
    expect(await env.TASK_LOCKS.get('lock:task-42')).toBeNull();
  });

  test('still accepts the legacy v1 body-only signature during the migration window', async () => {
    await env.TASK_LOCKS.put('lock:task-7', 'in_progress');
    const body = JSON.stringify({ task_id: 'task-7' });
    const headers = await signedHeadersLegacy(body);
    const { response } = await dispatch(
      makeRequest('/api/v1/force-unlock', { method: 'POST', body, headers })
    );

    expect(response.status).toBe(200);
    expect(await env.TASK_LOCKS.get('lock:task-7')).toBeNull();
  });

  test('rejects a v1 signature produced with the wrong key', async () => {
    const body = JSON.stringify({ task_id: 'task-9' });
    const headers = await signedHeadersLegacy(body, 'not-the-key');
    const { response } = await dispatch(
      makeRequest('/api/v1/force-unlock', { method: 'POST', body, headers })
    );
    expect(response.status).toBe(403);
  });

  test('internal key as bearer is accepted where an operator session is required', async () => {
    const body = JSON.stringify({ taskId: 'task-internal', instruction_prompt: 'noop' });
    const headers = {
      ...(await signedHeadersV2(body)),
      Authorization: `Bearer ${TEST_INTERNAL_KEY}`,
      'Content-Type': 'application/json'
    };
    const { response } = await dispatch(
      makeRequest('/api/v1/tasks', { method: 'POST', body, headers })
    );
    expect(response.status).toBe(202);
  });
});

describe('Support interlock: POST /api/v1/tasks/dispatch', () => {
  test('accepts an HMAC-signed task from the Support System', async () => {
    const body = JSON.stringify({
      ticketId: 'ticket-9001',
      instructions: 'Patch the invoice rounding bug.',
      repository_name: 'JimEllars/AXiM-Support-System-1.1-4538',
      source: 'axim-support-system'
    });
    const headers = { ...(await signedHeadersV2(body)), 'Content-Type': 'application/json' };

    const { response, context } = await dispatch(
      makeRequest('/api/v1/tasks/dispatch', { method: 'POST', body, headers })
    );

    expect(response.status).toBe(202);
    const payload: any = await response.json();
    expect(payload.success).toBe(true);
    expect(payload.taskId).toBe('ticket-9001');
    // Exactly one pipeline handoff: the redundant second signature check is gone.
    expect(context.pending).toHaveLength(1);
    expect(executeAutonomousCodingTask).toHaveBeenCalledTimes(1);
    expect(await env.TASK_LOCKS.get('lock:ticket-9001')).toBe('in_progress');
  });

  test('a replayed dispatch for a locked ticket is a no-op, not a second pipeline run', async () => {
    await env.TASK_LOCKS.put('lock:ticket-9002', 'in_progress');
    const body = JSON.stringify({ ticketId: 'ticket-9002', instructions: 'x' });
    const headers = { ...(await signedHeadersV2(body)), 'Content-Type': 'application/json' };

    const { response, context } = await dispatch(
      makeRequest('/api/v1/tasks/dispatch', { method: 'POST', body, headers })
    );

    expect(response.status).toBe(202);
    const payload: any = await response.json();
    expect(payload.status).toBe('ignored');
    expect(context.pending).toHaveLength(0);
    expect(executeAutonomousCodingTask).not.toHaveBeenCalled();
  });

  test('rejects a dispatch with no task identifier', async () => {
    const body = JSON.stringify({ instructions: 'no id here' });
    const headers = { ...(await signedHeadersV2(body)), 'Content-Type': 'application/json' };
    const { response } = await dispatch(
      makeRequest('/api/v1/tasks/dispatch', { method: 'POST', body, headers })
    );
    expect(response.status).toBe(400);
  });
});

describe('Routing hygiene', () => {
  test('unknown signed route returns 404 rather than parsing as a task payload', async () => {
    const body = JSON.stringify({ anything: true });
    const headers = { ...(await signedHeadersV2(body)), 'Content-Type': 'application/json' };
    const { response } = await dispatch(
      makeRequest('/api/v1/does-not-exist', { method: 'POST', body, headers })
    );
    expect(response.status).toBe(404);
    const payload: any = await response.json();
    expect(payload.error).toBe('Not Found');
  });

  test('non-POST traffic to the relay surface is refused with 405, never parsed', async () => {
    const headers = await signedHeadersV2('');
    const { response } = await dispatch(makeRequest('/api/v1/unknown', { method: 'GET', headers }));
    expect(response.status).toBe(405);
  });
});

describe('Telemetry beacon', () => {
  test('accepts an unsigned edge telemetry event', async () => {
    const body = JSON.stringify({ level: 'info', event: 'TEST_BEACON', agentId: 'unit-test' });
    const { response } = await dispatch(
      makeRequest('/api/telemetry/event', {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json' }
      })
    );
    expect(response.status).toBe(200);
    const payload: any = await response.json();
    expect(payload.status).toBe('logged');
  });
});

describe('Support resolution callback (deploy-action interlock)', () => {
  test('merges the PR then posts a v2-signed resolution to /resolve-from-coder', async () => {
    const body = JSON.stringify({
      task_id: 'ticket-5551',
      pr_number: 41,
      repository_owner: 'JimEllars',
      repository_name: 'AXiM-Support-System-1.1-4538',
      action: 'APPROVED',
      source: 'axim-support-system',
      ticketId: 'ticket-5551'
    });
    const headers = {
      ...(await signedHeadersV2(body)),
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TEST_INTERNAL_KEY}`
    };

    const { response } = await dispatch(
      makeRequest('/api/v1/deploy-action', { method: 'POST', body, headers })
    );
    expect(response.status).toBe(200);

    // PR merge hit GitHub with the squash method.
    const mergeCall = fetchStub.calls.find((call) => call.url.endsWith('/pulls/41/merge'));
    expect(mergeCall?.method).toBe('PUT');

    // Resolution callback hit the one route the Support System actually exposes.
    const callback = fetchStub.calls.find((call) =>
      call.url.endsWith('/api/v1/tickets/ticket-5551/resolve-from-coder')
    );
    expect(callback).toBeDefined();
    expect(callback?.headers['X-Axim-Signature']).toMatch(/^[0-9a-f]{64}$/);
    expect(callback?.headers['X-Axim-Timestamp']).toBeTruthy();

    // The envelope on the wire is really v2: it verifies over `${ts}.${body}`.
    const verdict = await verifyInternalSignature(
      String(callback?.body),
      callback?.headers['X-Axim-Signature'] ?? null,
      callback?.headers['X-Axim-Timestamp'] ?? null,
      TEST_INTERNAL_KEY
    );
    expect(verdict).toEqual({ valid: true, version: 'v2' });

    // And the payload carries the fields the Support System reads.
    const payload = JSON.parse(String(callback?.body));
    expect(payload.status).toBe('resolved');
    expect(payload.resolutionNotes).toContain('pull/41');
    expect(typeof payload.completedAt).toBe('string');
  });

  test('a failing resolution callback is parked in the DLQ with the ticket id in the key', async () => {
    fetchStub.restore();
    fetchStub = installFetchStub((call) => {
      if (call.url.includes('resolve-from-coder')) {
        return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
      }
      return new Response(JSON.stringify({ merged: true }), { status: 200 });
    });

    const body = JSON.stringify({
      task_id: 'ticket-5560',
      pr_number: 42,
      repository_owner: 'JimEllars',
      repository_name: 'AXiM-Support-System-1.1-4538',
      source: 'axim-support-system',
      ticketId: 'ticket-5560'
    });
    const headers = {
      ...(await signedHeadersV2(body)),
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TEST_INTERNAL_KEY}`
    };

    await dispatch(makeRequest('/api/v1/deploy-action', { method: 'POST', body, headers }));

    const parked = await env.CODER_DLQ_KV.get('dlq:ticket-callback:ticket-5560');
    expect(parked).toBeTruthy();
    expect(JSON.parse(String(parked)).status).toBe('resolved');
  });
});
