const fs = require('fs');

let content = fs.readFileSync('src/services/labService.js', 'utf8');

// Replace duplicate fetchIntegrationHealth declaration by leaving only the first one
const duplicateStr = `  fetchIntegrationHealth: async () => {
    try {
      const workerUrl = import.meta.env.VITE_INGRESS_URL ? import.meta.env.VITE_INGRESS_URL.replace('/api/v1/ingress', '') : '';
      if (!workerUrl) return { github: null, llm: null };

      const res = await fetch(\`\${workerUrl}/api/v1/health/integrations\`);
      if (res.ok) {
        return await res.json();
      }
      return { github: null, llm: null };
    } catch (e) {
      console.warn('Failed to fetch integration health:', e);
      return { github: null, llm: null };
    }
  },`;

const firstIndex = content.indexOf(duplicateStr);
if (firstIndex !== -1) {
  const secondIndex = content.indexOf(duplicateStr, firstIndex + duplicateStr.length);
  if (secondIndex !== -1) {
    content = content.slice(0, secondIndex) + content.slice(secondIndex + duplicateStr.length);
    fs.writeFileSync('src/services/labService.js', content);
    console.log('Removed duplicate fetchIntegrationHealth');
  } else {
    console.log('No duplicate fetchIntegrationHealth found.');
  }
}
