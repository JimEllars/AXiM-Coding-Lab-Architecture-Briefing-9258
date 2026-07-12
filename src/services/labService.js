/**
 * AXiM Coding Lab - Enterprise Service Layer
 * Orchestrates global state, knowledge base, agents, and task lifecycle.
 */

const listeners = new Set();
const broadcast = (event) => listeners.forEach(l => l(event));

let MOCK_TASKS = [
  { 
    id: 'HOTFIX-8A92F1', 
    origin: 'Asguard_WAF', 
    status: 'Review Gate', 
    file: 'middleware/auth.ts', 
    repository: 'axim-core-api',
    time: '2m ago',
    tokens: 14200,
    cost: 0.28,
    branch: 'axim-bot/hotfix-8a92f1',
    comments: [],
    diff: `@@ -12,5 +12,8 @@\n export function processPayload(data) {\n   if (!data) return null;\n-  const parsed = JSON.parse(data);\n-  return parsed.items;\n+  try {\n+    const parsed = typeof data === 'string' ? JSON.parse(data) : data;\n+    return parsed?.items || [];\n+  } catch (e) {\n+    return [];\n+  }`
  }
];

let SYSTEM_LOGS = [
  { id: 'L1', text: '[SYSTEM] Lab Node ATL-01 Initialized.', type: 'system', time: '10:00:00' },
  { id: 'L2', text: '[KNOWLEDGE] Vector Store indexed 142 internal documents.', type: 'knowledge', time: '10:00:05' }
];

let KNOWLEDGE_BASE = [
  { id: 'KB-1', title: 'Authentication Standards', content: 'All API routes must use the custom AXiM-Auth header. JWT tokens expire in 1h.', category: 'Security', lastUpdated: '2d ago', author: 'SRE_Team' },
  { id: 'KB-2', title: 'Database Migration Policy', content: 'Never use DROP TABLE. Use migrations with rollback capability.', category: 'Infrastructure', lastUpdated: '5d ago', author: 'DBA_Team' },
  { id: 'KB-3', title: 'React Component Guidelines', content: 'Use functional components with Tailwind CSS. Max file size 150 lines.', category: 'Frontend', lastUpdated: '1d ago', author: 'UI_Guild' }
];

let AGENTS = [
  { id: 'ONYX-01', name: 'Onyx Architect', role: 'System Design', status: 'Idle', model: 'DeepSeek-V2-Chat', capabilities: ['AST Parsing', 'Dependency Mapping'] },
  { id: 'ASGUARD-01', name: 'Asguard Sentry', role: 'SecOps Patching', status: 'Active', model: 'GPT-4o', capabilities: ['Vulnerability Scan', 'Sanitization'] },
  { id: 'KRONOS-01', name: 'Kronos DevOps', role: 'CI/CD Automation', status: 'Idle', model: 'Claude-3.5', capabilities: ['Wrangler Deploy', 'Workflow Gen'] }
];

export const labService = {
  subscribe: (l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  getTasks: () => Promise.resolve([...MOCK_TASKS]),
  getSystemLogs: () => [...SYSTEM_LOGS],
  getKnowledge: () => Promise.resolve([...KNOWLEDGE_BASE]),
  getAgents: () => Promise.resolve([...AGENTS]),

  addNote: async (note) => {
    const newNote = { ...note, id: `KB-${Date.now()}`, lastUpdated: 'Just now' };
    KNOWLEDGE_BASE = [newNote, ...KNOWLEDGE_BASE];
    broadcast({ type: 'KNOWLEDGE_UPDATED', knowledge: KNOWLEDGE_BASE });
    return Promise.resolve(newNote);
  },

  getRepositories: () => Promise.resolve([
    { id: 'R1', name: 'axim-core-api', health: 98, activeSwarm: true, lastPatch: '2h ago', language: 'TypeScript', coverage: '94%', files: 142, dependencies: ['R3', 'R4'] },
    { id: 'R2', name: 'frontend-dashboard', health: 92, activeSwarm: false, lastPatch: '1d ago', language: 'React', coverage: '88%', files: 85, dependencies: ['R1'] },
  ]),

  triggerTask: async (payload) => {
    const taskId = payload.task_id || `TASK-${Math.random().toString(36).substring(7).toUpperCase()}`;
    broadcast({ type: 'REASONING_START', taskId, prompt: payload.instruction_prompt });

    // Simulation logic
    setTimeout(() => {
      const newTask = {
        id: taskId,
        origin: payload.origin_source,
        status: 'Review Gate',
        file: payload.target_file_path || 'src/main.ts',
        repository: payload.repository_name,
        time: 'Just now',
        tokens: 4500,
        cost: 0.05,
        branch: `axim-bot/${taskId.toLowerCase()}`,
        comments: [],
        diff: `+ // Autonomous generation started with context: ${payload.contextIds?.join(', ') || 'Global'}\n+ export const run = () => { console.log("AXiM Node Active"); };`
      };
      MOCK_TASKS = [newTask, ...MOCK_TASKS];
      broadcast({ type: 'TASKS_UPDATED', tasks: MOCK_TASKS });
      broadcast({ type: 'REASONING_END', taskId });
    }, 4500);

    return Promise.resolve(taskId);
  },

  getSecurityIncidents: () => Promise.resolve([
    { id: 'SEC-102', severity: 'CRITICAL', type: 'SQL Injection', target: 'axim-core-api', path: '/v1/auth/login', status: 'UNRESOLVED', time: '12m ago' }
  ]),

  getTelemetryData: () => Promise.resolve({
    tokenUsage: [120, 150, 180, 220, 190, 240, 210],
    nodeHealth: [{ name: 'LLM Proxy', value: 99, status: 'Operational' }],
    roiMetrics: { hoursSaved: 142, efficiencyGain: '84%', totalCost: '$142.50', estimatedSavings: '$11,360' }
  }),

  getAuditLogs: () => Promise.resolve([
    { id: 'AL-1', timestamp: '2026-07-11 14:20:01', actor: 'Asguard_WAF', action: 'DEPLOY_SWARM', target: 'axim-core-api', status: 'SUCCESS' }
  ]),

  mergePR: async (taskId) => {
    MOCK_TASKS = MOCK_TASKS.filter(t => t.id !== taskId);
    broadcast({ type: 'TASKS_UPDATED', tasks: MOCK_TASKS });
    return Promise.resolve();
  }
};