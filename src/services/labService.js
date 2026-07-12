/**
 * AXiM Coding Lab - Enterprise Service Layer (V3)
 * Orchestrates the "Organizational Brain", Multi-Agent Swarms, and Knowledge Injection.
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
    comments: [
      { id: 1, author: 'Onyx_Architect', text: 'Structural integrity verified. Knowledge Node KB-1 (Auth Standards) was used for context.', time: '5m ago' }
    ],
    diff: `@@ -12,5 +12,8 @@\n export function processPayload(data) {\n   if (!data) return null;\n-  const parsed = JSON.parse(data);\n-  return parsed.items;\n+  try {\n+    const parsed = typeof data === 'string' ? JSON.parse(data) : data;\n+    return parsed?.items || [];\n+  } catch (e) {\n+    return [];\n+  }`
  }
];

let SYSTEM_LOGS = [
  { id: 'L1', text: '[BRAIN] Synced 42 new organizational notes to vector store.', type: 'knowledge', time: '09:42:01' },
  { id: 'L2', text: '[AGENT] Onyx_Architect optimized AST for 4 repositories.', type: 'agent', time: '10:15:22' },
  { id: 'L3', text: '[SWARM] Initiating periodic security audit across edge nodes.', type: 'system', time: '10:30:00' }
];

let KNOWLEDGE_BASE = [
  { id: 'KB-1', title: 'Authentication Standards', content: 'All API routes must use the custom AXiM-Auth header. JWT tokens expire in 1h.', category: 'Security', lastUpdated: '2d ago', author: 'SRE_Team', tags: ['Auth', 'Security', 'API'] },
  { id: 'KB-2', title: 'Database Migration Policy', content: 'Never use DROP TABLE. Use migrations with rollback capability.', category: 'Infrastructure', lastUpdated: '5d ago', author: 'DBA_Team', tags: ['DB', 'SQL'] },
  { id: 'KB-3', title: 'React Component Guidelines', content: 'Use functional components with Tailwind CSS. Max file size 150 lines.', category: 'Frontend', lastUpdated: '1d ago', author: 'UI_Guild', tags: ['React', 'CSS'] }
];

let AGENTS = [
  { id: 'ONYX-01', name: 'Onyx Architect', role: 'System Design', status: 'Idle', model: 'DeepSeek-V2-Chat', capabilities: ['AST Parsing', 'Dependency Mapping'], uptime: '99.9%', tasks_completed: 142 },
  { id: 'ASGUARD-01', name: 'Asguard Sentry', role: 'SecOps Patching', status: 'Active', model: 'GPT-4o', capabilities: ['Vulnerability Scan', 'Sanitization'], uptime: '100%', tasks_completed: 89 },
  { id: 'KRONOS-01', name: 'Kronos DevOps', role: 'CI/CD Automation', status: 'Idle', model: 'Claude-3.5', capabilities: ['Wrangler Deploy', 'Workflow Gen'], uptime: '99.8%', tasks_completed: 215 }
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
  
  getOrgStats: () => Promise.resolve({
    totalNodes: 142,
    activeSwarmSize: 12,
    prSuccessRate: '94.2%',
    knowledgeSyncFreq: '5m'
  }),

  addNote: async (note) => {
    const newNote = { 
      ...note, 
      id: `KB-${Date.now()}`, 
      lastUpdated: 'Just now', 
      author: 'Admin_Ellars',
      tags: note.tags || []
    };
    KNOWLEDGE_BASE = [newNote, ...KNOWLEDGE_BASE];
    broadcast({ type: 'KNOWLEDGE_UPDATED', knowledge: KNOWLEDGE_BASE });
    
    // Auto-log the brain update
    const log = { id: Date.now(), text: `[BRAIN] New knowledge node added: ${newNote.title}`, type: 'knowledge', time: new Date().toLocaleTimeString() };
    SYSTEM_LOGS.push(log);
    broadcast({ type: 'LOG_ADDED', log });
    
    return Promise.resolve(newNote);
  },

  triggerTask: async (payload) => {
    const taskId = payload.task_id || `TASK-${Math.random().toString(36).substring(7).toUpperCase()}`;
    broadcast({ type: 'REASONING_START', taskId, prompt: payload.instruction_prompt });

    const agent = AGENTS[Math.floor(Math.random() * AGENTS.length)];
    
    const steps = [
      { t: `[INGRESS] Received manual orchestrator command.`, delay: 100 },
      { t: `[BRAIN] Injecting organizational context: ${payload.contextIds?.length || 0} nodes.`, delay: 800 },
      { t: `[AGENT] Assigning ${agent.name} to task.`, delay: 1500 },
      { t: `[LLM] Reasoning through architectural constraints...`, delay: 2500 },
      { t: `[GITOPS] Generating patch for ${payload.target_file_path || 'src/main.ts'}`, delay: 3500 },
      { t: `[SYSTEM] Task complete. PR generated.`, delay: 4500 }
    ];

    steps.forEach(step => {
      setTimeout(() => {
        const log = { id: Date.now() + Math.random(), text: step.t, time: new Date().toLocaleTimeString([], { hour12: false }) };
        SYSTEM_LOGS.push(log);
        broadcast({ type: 'LOG_ADDED', log });
      }, step.delay);
    });

    setTimeout(() => {
      const newTask = {
        id: taskId,
        origin: payload.origin_source,
        status: 'Review Gate',
        file: payload.target_file_path || 'src/main.ts',
        repository: payload.repository_name,
        time: 'Just now',
        tokens: Math.floor(Math.random() * 20000),
        cost: (Math.random() * 0.5).toFixed(2),
        branch: `axim-bot/${taskId.toLowerCase()}`,
        comments: [
          { id: Date.now(), author: agent.name, text: 'Implementation finalized according to provided knowledge context.', time: 'Just now' }
        ],
        diff: `+ // Autonomous generation by ${agent.name}\n+ export const run = () => { /* Optimized logic */ };`
      };
      MOCK_TASKS = [newTask, ...MOCK_TASKS];
      broadcast({ type: 'TASKS_UPDATED', tasks: MOCK_TASKS });
      broadcast({ type: 'REASONING_END', taskId });
    }, 4800);

    return Promise.resolve(taskId);
  },

  getRepositories: () => Promise.resolve([
    { id: 'R1', name: 'axim-core-api', health: 98, activeSwarm: true, lastPatch: '2h ago', language: 'TypeScript', coverage: '94%', files: 142, branches: 12, dependencies: ['R3', 'R4'] },
    { id: 'R2', name: 'frontend-dashboard', health: 92, activeSwarm: false, lastPatch: '1d ago', language: 'React', coverage: '88%', files: 85, branches: 4, dependencies: ['R1'] },
  ]),

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
  },

  addComment: async (taskId, text) => {
    const task = MOCK_TASKS.find(t => t.id === taskId);
    if (task) {
      task.comments.push({ id: Date.now(), author: 'Admin_Ellars', text, time: 'Just now' });
      broadcast({ type: 'TASKS_UPDATED', tasks: MOCK_TASKS });
    }
    return Promise.resolve();
  }
};