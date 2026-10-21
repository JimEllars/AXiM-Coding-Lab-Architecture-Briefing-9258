import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./supabaseClient', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } }
}));

import { dispatchSupportTask } from './supportGateway';

describe('dispatchSupportTask timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('localStorage', { getItem: () => null });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('waits 8s before aborting and failing over to direct ingress', async () => {
    const fetchMock = vi.fn((url, init) => {
      if (String(url).includes('/api/v1/tasks/dispatch')) {
        return new Promise((_, reject) => {
          init.signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ via: 'ingress' }) });
    });
    vi.stubGlobal('fetch', fetchMock);

    const promise = dispatchSupportTask({ assigned_model: 'x' });

    await vi.advanceTimersByTimeAsync(7999);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(promise).resolves.toEqual({ via: 'ingress' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
