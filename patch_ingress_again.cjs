const fs = require('fs');

const content = fs.readFileSync('edge-coder-worker/src/ingress.ts', 'utf8');

const routePattern = /if \(request\.method === 'GET' && url\.pathname === '\/api\/v1\/health'\) \{/;
const routeIndex = content.search(routePattern);

if (routeIndex !== -1) {
  const integrationHealthRoute = `
            if (request.method === 'GET' && url.pathname === '/api/v1/health/integrations') {
              const startGithub = Date.now();
              const startLlm = Date.now();

              const results = await Promise.allSettled([
                fetch('https://api.github.com/zen', { headers: { 'User-Agent': 'AXiM-Labs', 'Authorization': \`Bearer \${env.GITHUB_TOKEN}\` } }),
                fetch(env.SUPABASE_LLM_PROXY_URL, { method: 'OPTIONS' })
              ]);

              const githubLatency = Date.now() - startGithub;
              const llmLatency = Date.now() - startLlm;

              const githubRes = results[0];
              const llmRes = results[1];

              const githubStatus = githubRes.status === 'fulfilled' && githubRes.value.ok ? 'Nominal' : 'Degraded';
              const llmStatus = llmRes.status === 'fulfilled' && llmRes.value.ok ? 'Nominal' : 'Degraded';

              return new Response(JSON.stringify({
                github: { status: githubStatus, latencyMs: githubLatency },
                llm: { status: llmStatus, latencyMs: llmLatency }
              }), {
                status: 200,
                headers: { 'Content-Type': 'application/json', ...getCorsHeaders(request) }
              });
            }

            `;

  const newContent = content.slice(0, routeIndex) + integrationHealthRoute + content.slice(routeIndex);
  fs.writeFileSync('edge-coder-worker/src/ingress.ts', newContent);
  console.log('patched ingress');
} else {
  console.log('pattern not found in ingress');
}
