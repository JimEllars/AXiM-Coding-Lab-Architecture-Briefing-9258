import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { resolveRepoMetadata } from '../src/registry';
import { generateHmacSignature } from '../src/utils/crypto';
import { processJulesWebhook } from '../src/jules_bridge';

// Setup basic global mock for crypto if needed
if (typeof crypto === 'undefined') {
  global.crypto = require('crypto').webcrypto;
}

describe('Worker Unit Tests', () => {

  describe('resolveRepoMetadata', () => {
    it('should resolve CORE correctly', () => {
      const res = resolveRepoMetadata('CORE');
      expect(res.owner).toBe('JimEllars');
      expect(res.repo).toBe('axim-core-v1.2');
    });

    it('should resolve SUPPORT correctly', () => {
      const res = resolveRepoMetadata('SUPPORT');
      expect(res.repo).toBe('AXiM-Support-System-1.1-4538');
    });

    it('should resolve SPEEDREPORT correctly', () => {
      const res = resolveRepoMetadata('SPEEDREPORT');
      expect(res.repo).toBe('SpeedReport.org-Speed-Test-App-9642');
    });

    it('should resolve ONYX correctly', () => {
      const res = resolveRepoMetadata('ONYX');
      expect(res.repo).toBe('onyx_mk3');
    });

    it('should resolve ELLARS correctly', () => {
      const res = resolveRepoMetadata('ELLARS');
      expect(res.repo).toBe('ELLARS.us.com-Frontend-Site-1.1-1974');
    });

    it('should resolve DEMAND_LETTER correctly', () => {
      const res = resolveRepoMetadata('DEMAND_LETTER');
      expect(res.repo).toBe('Decentralized-Demand-Letter-Generator-Development-8155');
    });

    it('should resolve fallback correctly', () => {
      const res = resolveRepoMetadata('UNKNOWN', 'my-fallback-repo');
      expect(res.owner).toBe('JimEllars');
      expect(res.repo).toBe('my-fallback-repo');
    });
  });

  describe('generateHmacSignature', () => {
    it('should generate valid signature', async () => {
      const payload = "test payload";
      const secret = "supersecret";
      const sig = await generateHmacSignature(payload, secret);
      expect(sig).toBeTruthy();
      expect(sig).toHaveLength(64); // SHA-256 hex is 64 chars
    });

    it('should have different signatures for different payloads', async () => {
       const sig1 = await generateHmacSignature("payload1", "secret");
       const sig2 = await generateHmacSignature("payload2", "secret");
       expect(sig1).not.toBe(sig2);
    });
  });

  describe('processJulesWebhook', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('should do nothing if session_id is missing', async () => {
      const env = { SUPABASE_URL: 'http://test', SUPABASE_SECRET_KEY: 'key' } as any;
      await processJulesWebhook({}, env);
      expect(fetch).not.toHaveBeenCalled();
    });

    it('should handle FAILED status correctly and create error log', async () => {
      const env = { SUPABASE_URL: 'http://test', SUPABASE_SECRET_KEY: 'key' } as any;
      const mockFetch = vi.mocked(fetch);

      mockFetch.mockImplementation(async (url) => {
        if (url.toString().includes('coding_tasks?context')) {
            return { ok: true, json: async () => [{ id: 'task-123' }] } as any;
        }
        return { ok: true, json: async () => ({}) } as any;
      });

      await processJulesWebhook({ session_id: 'sess_1', status: 'FAILED', error_message: 'err' }, env);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('coding_tasks_errors'),
        expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('err')
        })
      );

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('coding_tasks?id=eq.task-123'),
        expect.objectContaining({
            method: 'PATCH',
            body: expect.stringContaining('"status":"FAILED"')
        })
      );
    });

    it('should handle pr_url correctly and set status to Review Gate', async () => {
        const env = { SUPABASE_URL: 'http://test', SUPABASE_SECRET_KEY: 'key' } as any;
        const mockFetch = vi.mocked(fetch);

        mockFetch.mockImplementation(async (url) => {
          if (url.toString().includes('coding_tasks?context')) {
              return { ok: true, json: async () => [{ id: 'task-123' }] } as any;
          }
          return { ok: true, json: async () => ({}) } as any;
        });

        await processJulesWebhook({ session_id: 'sess_1', status: 'SUCCESS', pr_url: 'http://pr' }, env);

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('coding_tasks?id=eq.task-123'),
          expect.objectContaining({
              method: 'PATCH',
              body: expect.stringContaining('"status":"Review Gate"')
          })
        );
      });
  });

});
