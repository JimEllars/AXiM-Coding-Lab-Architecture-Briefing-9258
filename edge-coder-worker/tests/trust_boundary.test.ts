import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';

// The pipeline must never run for real in this suite; everything else in
// `ingress.ts` is the real module under test.
const executeCodingPipeline = vi.fn(async () => {});
const executeAutonomousCodingTask = vi.fn(async () => {});
vi.mock('../src/code_generator', () => ({
  executeCodingPipeline: (...args: unknown[]) => executeCodingPipeline(...(args as [])),
  executeAutonomousCodingTask: (...args: unknown[]) => executeAutonomousCodingTask(...(args as []))
}));

import worker, { mintApprovalToken, enqueueSwarmTask, consumeSwarmQueue, SWARM_QUEUE_MAX_MESSAGE_BYTES } from '../src/ingress';
import { acquireTaskLock, recordOpenPullRequest, clearTaskState } from '../src/locks';
import {
  createMockCtx,
  createMockEnv,
  installFetchStub,
  makeRequest,
  signedHeadersV2,
  TEST_INTERNAL_KEY,
  type MockWorkerEnv
} from './mock_worker_env';

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

function approvalFormBody(token: string, decision: string): { body: string; headers: Record<string, string> } {
  return {
    body: new URLSearchParams({ token, decision }).toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  };
}

describe('HITL pull request gate — authentication (P0)', () => {
  test('rejects an approval token that was never minted', async () => {
    const { response } = await dispatch(
      makeRequest('/api/v1/pr/action?token=forged-token&decision=merge', { method: 'GET' })
    );

    expect(response.status).toBe(403);
    // Nothing reached GitHub.
    expect(fetchStub.calls.some((call) => call.url.includes('/merge'))).toBe(false);
  });

  test('a forged token cannot name its own merge target through query params', async () => {
    const { response } = await dispatch(
      makeRequest(
        '/api/v1/pr/action?token=forged&decision=merge&owner=evil-org&repo=axim-core-v1.2&pr=1',
        { method: 'GET' }
      )
    );

    expect(response.status).toBe(403);
    expect(fetchStub.calls.some((call) => call.url.includes('pulls/1/merge'))).toBe(false);
  });

  test('a GET on a valid token renders a confirmation page and merges nothing', async () => {
    const token = await mintApprovalToken(env.TASK_LOCKS, {
      owner: 'JimEllars',
      repo: 'axim-core-v1.2',
      pr: 77,
      title: 'Test patch'
    });

    const { response } = await dispatch(
      makeRequest(`/api/v1/pr/action?token=${token}&decision=merge`, { method: 'GET' })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const html = await response.text();
    expect(html).toContain('Confirm: Approve');
    expect(html).toContain(`value="${token}"`);
    // The core property: a link prefetch cannot merge a pull request.
    expect(fetchStub.calls.some((call) => call.url.includes('/merge'))).toBe(false);
  });

  test('a POST on a valid token merges the stored coordinates only once', async () => {
    const token = await mintApprovalToken(env.TASK_LOCKS, {
      owner: 'JimEllars',
      repo: 'axim-core-v1.2',
      pr: 78,
      taskId: 'task-78'
    });
    const form = approvalFormBody(token, 'merge');

    const first = await dispatch(makeRequest('/api/v1/pr/action', { method: 'POST', ...form }));
    expect(first.response.status).toBe(200);
    const mergeCall = fetchStub.calls.find((call) => call.url.endsWith('/repos/JimEllars/axim-core-v1.2/pulls/78/merge'));
    expect(mergeCall?.method).toBe('PUT');

    // Single use: replaying the same form must not merge again.
    const mergeCallsBefore = fetchStub.calls.filter((call) => call.url.includes('/merge')).length;
    const second = await dispatch(makeRequest('/api/v1/pr/action', { method: 'POST', ...form }));
    expect(second.response.status).toBe(409);
    expect(fetchStub.calls.filter((call) => call.url.includes('/merge')).length).toBe(mergeCallsBefore);
  });

  test('a stored non-canonical owner is pinned back to JimEllars', async () => {
    const token = await mintApprovalToken(env.TASK_LOCKS, {
      owner: 'axim-organization',
      repo: 'axim-core-v1.2',
      pr: 79
    });
    const form = approvalFormBody(token, 'merge');

    await dispatch(makeRequest('/api/v1/pr/action', { method: 'POST', ...form }));

    const mergeCall = fetchStub.calls.find((call) => call.url.includes('/merge'));
    expect(mergeCall?.url).toContain('/repos/JimEllars/axim-core-v1.2/pulls/79/merge');
  });

  test('an operator session is not required, but a token with no bound PR is refused', async () => {
    await env.TASK_LOCKS.put('pr_token_legacy', 'active');
    const form = approvalFormBody('legacy', 'merge');

    const { response } = await dispatch(makeRequest('/api/v1/pr/action', { method: 'POST', ...form }));
    expect(response.status).toBe(409);
    expect(fetchStub.calls.some((call) => call.url.includes('/merge'))).toBe(false);
  });
});

describe('DLQ sweep authentication (P0)', () => {
  test('accepts a v2-signed relay envelope', async () => {
    await env.CODER_DLQ_KV.put('dlq:ticket-callback:ticket-1', JSON.stringify({ ticketId: 'ticket-1' }));
    const body = JSON.stringify({ sweep: true });
    const headers = { ...(await signedHeadersV2(body)), 'Content-Type': 'application/json' };

    const { response } = await dispatch(
      makeRequest('/api/v1/dlq/sweep', { method: 'POST', body, headers })
    );

    expect(response.status).toBe(200);
    const payload: any = await response.json();
    expect(payload.status).toBe('success');
    // The callback was replayed to the one route the Support System exposes.
    expect(fetchStub.calls.some((call) => call.url.endsWith('/api/v1/tickets/ticket-1/resolve-from-coder'))).toBe(true);
  });

  test('rejects an unsigned sweep with 401', async () => {
    const { response } = await dispatch(
      makeRequest('/api/v1/dlq/sweep', { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } })
    );
    expect(response.status).toBe(401);
  });

  test('rejects a sweep signed with the wrong key', async () => {
    const body = JSON.stringify({ sweep: true });
    const headers = { ...(await signedHeadersV2(body, Date.now(), 'wrong-key')), 'Content-Type': 'application/json' };
    const { response } = await dispatch(
      makeRequest('/api/v1/dlq/sweep', { method: 'POST', body, headers })
    );
    expect(response.status).toBe(401);
  });
});

describe('Unified task lock semantics (P1)', () => {
  test('a lease written by the ingress route blocks a Support dispatch', async () => {
    // `/api/v1/ingress` used to write "active" while dispatch only respected
    // "in_progress", so a retried ticket started a second pipeline.
    await acquireTaskLock(env.TASK_LOCKS, 'ticket-4242');

    const body = JSON.stringify({ ticketId: 'ticket-4242', instructions: 'x' });
    const headers = { ...(await signedHeadersV2(body)), 'Content-Type': 'application/json' };
    const { response, context } = await dispatch(
      makeRequest('/api/v1/tasks/dispatch', { method: 'POST', body, headers })
    );

    expect(response.status).toBe(202);
    const payload: any = await response.json();
    expect(payload.status).toBe('ignored');
    expect(payload.reason).toBe('locked');
    expect(context.pending).toHaveLength(0);
    expect(executeAutonomousCodingTask).not.toHaveBeenCalled();
  });

  test('a task with an open PR is refused and reports the PR URL', async () => {
    await recordOpenPullRequest(env.TASK_LOCKS, 'ticket-4243', 'https://github.com/JimEllars/axim-core-v1.2/pull/9');

    const body = JSON.stringify({ ticketId: 'ticket-4243', instructions: 'x' });
    const headers = { ...(await signedHeadersV2(body)), 'Content-Type': 'application/json' };
    const { response } = await dispatch(
      makeRequest('/api/v1/tasks/dispatch', { method: 'POST', body, headers })
    );

    expect(response.status).toBe(202);
    const payload: any = await response.json();
    expect(payload.reason).toBe('pr-open');
    expect(payload.pr_url).toContain('/pull/9');
    expect(executeAutonomousCodingTask).not.toHaveBeenCalled();
  });

  test('recording a PR releases the run lease', async () => {
    await acquireTaskLock(env.TASK_LOCKS, 'ticket-1');
    expect(await env.TASK_LOCKS.get('lock:ticket-1')).toBe('in_progress');

    await recordOpenPullRequest(env.TASK_LOCKS, 'ticket-1', 'https://github.com/JimEllars/axim-core-v1.2/pull/1');

    expect(await env.TASK_LOCKS.get('lock:ticket-1')).toBeNull();
    expect(await env.TASK_LOCKS.get('pr-open:ticket-1')).toContain('/pull/1');
  });

  test('force-unlock keeps the open-PR marker unless clear_pr is set', async () => {
    await recordOpenPullRequest(env.TASK_LOCKS, 'ticket-2', 'https://github.com/JimEllars/axim-core-v1.2/pull/2');

    const keepBody = JSON.stringify({ task_id: 'ticket-2' });
    const keepHeaders = await signedHeadersV2(keepBody);
    const first = await dispatch(
      makeRequest('/api/v1/force-unlock', { method: 'POST', body: keepBody, headers: keepHeaders })
    );
    expect(first.response.status).toBe(200);
    const firstPayload: any = await first.response.json();
    expect(firstPayload.open_pull_request).toContain('/pull/2');
    expect(await env.TASK_LOCKS.get('pr-open:ticket-2')).not.toBeNull();

    const clearBody = JSON.stringify({ task_id: 'ticket-2', clear_pr: true });
    const clearHeaders = await signedHeadersV2(clearBody);
    await dispatch(
      makeRequest('/api/v1/force-unlock', { method: 'POST', body: clearBody, headers: clearHeaders })
    );
    expect(await env.TASK_LOCKS.get('pr-open:ticket-2')).toBeNull();
  });

  test('clearTaskState removes both keys', async () => {
    await acquireTaskLock(env.TASK_LOCKS, 'ticket-3');
    await recordOpenPullRequest(env.TASK_LOCKS, 'ticket-3', 'https://example.test/pull/3');
    await clearTaskState(env.TASK_LOCKS, 'ticket-3');
    expect(await env.TASK_LOCKS.get('lock:ticket-3')).toBeNull();
    expect(await env.TASK_LOCKS.get('pr-open:ticket-3')).toBeNull();
  });
});

describe('Swarm queue safety (P1)', () => {
  test('falls back to the inline pipeline when there is no queue binding', async () => {
    const accepted = await enqueueSwarmTask({}, { task_id: 'q1' }, 'q1');
    expect(accepted).toBe(false);
  });

  test('a throwing queue send is a fallback, not a 500', async () => {
    const send = vi.fn(async () => {
      throw new Error('queue unavailable');
    });
    const queuedEnv = createMockEnv({ SWARM_QUEUE: { send } });

    const body = JSON.stringify({
      task_id: 'ticket-queue-1',
      instruction_prompt: 'touch two files',
      repository_name: 'JimEllars/axim-core-v1.2',
      target_file_paths: ['src/a.ts', 'src/b.ts']
    });
    const headers = {
      ...(await signedHeadersV2(body)),
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TEST_INTERNAL_KEY}`
    };

    const response = await worker.fetch(
      makeRequest('/api/v1/ingress', { method: 'POST', body, headers }),
      queuedEnv as never,
      createMockCtx() as never
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(202);
    const payload: any = await response.json();
    expect(payload.transport).toBe('inline');
    expect(executeCodingPipeline).toHaveBeenCalledTimes(1);
  });

  test('an oversized payload is never handed to the queue', async () => {
    const send = vi.fn(async () => {});
    const queuedEnv = createMockEnv({ SWARM_QUEUE: { send } });
    const huge = 'x'.repeat(SWARM_QUEUE_MAX_MESSAGE_BYTES + 1);

    const accepted = await enqueueSwarmTask(queuedEnv, { task_id: 'q2', blob: huge }, 'q2');
    expect(accepted).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  test('the queue consumer runs the pipeline and acks', async () => {
    const ack = vi.fn();
    await consumeSwarmQueue(
      { messages: [{ body: { task_id: 'q3' }, ack }] },
      env as never,
      createMockCtx() as never
    );
    expect(executeCodingPipeline).toHaveBeenCalledTimes(1);
    expect(ack).toHaveBeenCalledTimes(1);
  });

  test('the queue consumer retries instead of acking a failed task', async () => {
    executeCodingPipeline.mockRejectedValueOnce(new Error('llm unavailable'));
    const ack = vi.fn();
    const retry = vi.fn();
    await consumeSwarmQueue(
      { messages: [{ body: { task_id: 'q4' }, ack, retry }] },
      env as never,
      createMockCtx() as never
    );
    expect(retry).toHaveBeenCalledTimes(1);
    expect(ack).not.toHaveBeenCalled();
  });
});

describe('Telemetry authenticity (P1)', () => {
  test('edge metrics report measured values, not placeholders', async () => {
    await env.CODER_DLQ_KV.put('dlq:ticket-callback:t-1', '{}');
    await env.TELEMETRY_KV.put('telemetry:agent-a:1', JSON.stringify({ agentId: 'agent-a' }));

    const { response } = await dispatch(makeRequest('/api/telemetry/edge-metrics'));
    expect(response.status).toBe(200);
    const stats: any = await response.json();

    expect(stats.metricsSource).toBe('edge-worker');
    expect(stats.dlqPendingCount).toBe(1);
    expect(stats.telemetryEventCount).toBe(1);
    // Previously a hard-coded 100 requests and 95 cache hits.
    expect(stats.requestCount).toBeNull();
    expect(stats.kvCacheHits).toBeNull();
    expect(stats.workerMemory).toBeNull();
    expect(typeof stats.sampledAt).toBe('string');
  });

  test('round-trip latency is a non-negative duration', async () => {
    const { response } = await dispatch(makeRequest('/api/telemetry/edge-metrics'));
    const stats: any = await response.json();
    // `performance.now() - Date.now()` used to produce ~ -1.7e12.
    expect(stats.roundTripLatencyMs).toBeGreaterThanOrEqual(0);
    expect(stats.roundTripLatencyMs).toBeLessThan(60_000);
  });

  test('telemetry stats survive missing KV bindings and never return NaN latency', async () => {
    const bareEnv = createMockEnv({ TELEMETRY_KV: undefined as never, CODER_DLQ_KV: undefined as never });
    const response = await worker.fetch(
      makeRequest('/api/telemetry/stats'),
      bareEnv as never,
      createMockCtx() as never
    );

    expect(response.status).toBe(200);
    const stats: any = await response.json();
    expect(stats.total_events).toBe(0);
    expect(stats.average_latency).toBeNull();
    expect(stats.dlq_pending_count).toBeNull();
  });
});

describe('Operator session as the relay credential (P1)', () => {
  test('a session-authorised dispatch needs no browser-held HMAC key', async () => {
    const body = JSON.stringify({
      taskId: 'session-task-1',
      instruction_prompt: 'rotate the changelog',
      repository_name: 'JimEllars/axim-core-v1.2'
    });

    const { response } = await dispatch(
      makeRequest('/api/v1/tasks', {
        method: 'POST',
        body,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer operator-session-token' }
      })
    );

    expect(response.status).toBe(202);
    expect(fetchStub.calls.some((call) => call.url.includes('/auth/v1/user'))).toBe(true);
    expect(executeCodingPipeline).toHaveBeenCalledTimes(1);
  });

  test('no signature and no session is still 401', async () => {
    const body = JSON.stringify({ taskId: 'anonymous-1', instruction_prompt: 'x' });
    const { response } = await dispatch(
      makeRequest('/api/v1/tasks', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } })
    );

    expect(response.status).toBe(401);
    expect(executeCodingPipeline).not.toHaveBeenCalled();
  });

  test('a present but invalid signature is never downgraded to the session path', async () => {
    const body = JSON.stringify({ taskId: 'tamper-1', instruction_prompt: 'x' });
    const { response } = await dispatch(
      makeRequest('/api/v1/tasks', {
        method: 'POST',
        body,
        headers: {
          'Content-Type': 'application/json',
          'X-Axim-Signature': 'deadbeef',
          Authorization: 'Bearer operator-session-token'
        }
      })
    );

    expect(response.status).toBe(403);
    expect(executeCodingPipeline).not.toHaveBeenCalled();
  });

  test('a session-only DLQ sweep is authorised without the internal key', async () => {
    await env.CODER_DLQ_KV.put('dlq:ticket-callback:ticket-77', JSON.stringify({ ticketId: 'ticket-77' }));

    const { response } = await dispatch(
      makeRequest('/api/v1/dlq/sweep', {
        method: 'POST',
        body: JSON.stringify({ action: 'sweep' }),
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer operator-session-token' }
      })
    );

    expect(response.status).toBe(200);
    const payload: any = await response.json();
    expect(payload.reprocessed).toBe(1);
  });
});

describe('Console read endpoints reachable again (P1)', () => {
  test('GET /api/v1/dlq/stats answers with the session and counts the queue', async () => {
    await env.CODER_DLQ_KV.put('dlq:a', '{}');
    await env.CODER_DLQ_KV.put('dlq:b', '{}');

    const { response } = await dispatch(
      makeRequest('/api/v1/dlq/stats', {
        method: 'GET',
        headers: { Authorization: 'Bearer operator-session-token' }
      })
    );

    // Previously 405: the handler sat behind the POST-only protocol guard.
    expect(response.status).toBe(200);
    const payload: any = await response.json();
    expect(payload.pending_count).toBe(2);
  });

  test('GET /api/v1/dlq/stats without credentials is 401', async () => {
    const { response } = await dispatch(makeRequest('/api/v1/dlq/stats', { method: 'GET' }));
    expect(response.status).toBe(401);
  });

  test('GET /api/v1/github/tree answers with the session and pins the owner', async () => {
    fetchStub.restore();
    fetchStub = installFetchStub((call) => {
      if (call.url.endsWith('/repos/JimEllars/axim-core-v1.2')) {
        return new Response(JSON.stringify({ default_branch: 'main' }), { status: 200 });
      }
      return new Response(JSON.stringify({ tree: [{ path: 'src/App.jsx' }] }), { status: 200 });
    });

    const { response } = await dispatch(
      makeRequest('/api/v1/github/tree?owner=axim-organization&repo=axim-core-v1.2', {
        method: 'GET',
        headers: { Authorization: 'Bearer operator-session-token' }
      })
    );

    expect(response.status).toBe(200);
    const treeCalls = fetchStub.calls.filter((call) => call.url.includes('/git/trees/'));
    expect(treeCalls).toHaveLength(1);
    expect(treeCalls[0].url).toContain('/repos/JimEllars/axim-core-v1.2/git/trees/main');
  });

  test('GET /api/v1/github/tree never reaches GitHub without credentials', async () => {
    const { response } = await dispatch(
      makeRequest('/api/v1/github/tree?owner=JimEllars&repo=axim-core-v1.2', { method: 'GET' })
    );
    expect(response.status).toBe(401);
    expect(fetchStub.calls.some((call) => call.url.includes('api.github.com'))).toBe(false);
  });
});

describe('Telemetry ingest degrades without a KV binding', () => {
  test('accepts an event and still writes the analytics data point', async () => {
    const writeDataPoint = vi.fn();
    const bareEnv = createMockEnv({
      TELEMETRY_KV: undefined as never,
      axim_coder_metrics: { writeDataPoint }
    });

    const body = JSON.stringify({ timestamp: Date.now(), agentId: 'agent-b', latencyMs: 42, status: 'ok', tokensUsed: 10 });
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${TEST_INTERNAL_KEY}` };

    const response = await worker.fetch(
      makeRequest('/api/telemetry/events', { method: 'POST', body, headers }),
      bareEnv as never,
      createMockCtx() as never
    );

    expect(response.status).toBe(200);
    expect(writeDataPoint).toHaveBeenCalledTimes(1);
  });
});
