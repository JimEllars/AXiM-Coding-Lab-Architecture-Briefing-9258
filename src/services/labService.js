/**
 * AXiM Coding Lab - Enterprise Service Layer (V3)
 * Orchestrates the "Organizational Brain", Multi-Agent Swarms, and Knowledge Injection.
 */
import { supabase } from './supabaseClient';
import { generateHmacSignature } from '../utils/crypto';

const listeners = new Set();
const broadcast = (event) => listeners.forEach(l => l(event));

// Store local system logs
let SYSTEM_LOGS = [];
const addSystemLog = (log) => {
  SYSTEM_LOGS.push(log);
  if (SYSTEM_LOGS.length > 150) {
    SYSTEM_LOGS = SYSTEM_LOGS.slice(-150);
  }
};

let AGENTS = [
  { id: 'ONYX-01', name: 'Onyx Architect', role: 'System Design', status: 'Idle', model: 'DeepSeek-V2-Chat', capabilities: ['AST Parsing', 'Dependency Mapping'], uptime: '99.9%', tasks_completed: 142 },
  { id: 'ASGUARD-01', name: 'Asguard Sentry', role: 'SecOps Patching', status: 'Active', model: 'GPT-4o', capabilities: ['Vulnerability Scan', 'Sanitization'], uptime: '100%', tasks_completed: 89 },
  { id: 'KRONOS-01', name: 'Kronos DevOps', role: 'CI/CD Automation', status: 'Idle', model: 'Claude-3.5', capabilities: ['Wrangler Deploy', 'Workflow Gen'], uptime: '99.8%', tasks_completed: 215 }
];

// Initialize Realtime Sync
let channel;
let reconnectTimeout = null;
let backoffDelay = 2000;

const connectChannel = () => {
  if (channel) {
    supabase.removeChannel(channel);
  }

  channel = supabase.channel('coding-lab-swarm');

  channel
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'coding_tasks' },
      async () => {
        const { data } = await supabase.from('coding_tasks').select('*').order('created_at', { ascending: false });
        broadcast({ type: 'TASKS_UPDATED', tasks: data || [] });
      }
    )
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        backoffDelay = 2000; // reset on success
      } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR') {
        if (!reconnectTimeout) {
          const log = {
            id: Date.now() + Math.random(),
            text: `[SYSTEM] Connection ${status}. Reconnecting in ${backoffDelay/1000}s...`,
            type: 'system',
            time: new Date().toLocaleTimeString([], { hour12: false })
          };
          SYSTEM_LOGS.push(log);
          broadcast({ type: 'LOG_ADDED', log });

          reconnectTimeout = setTimeout(() => {
            reconnectTimeout = null;
            backoffDelay = Math.min(backoffDelay * 2, 16000);
            connectChannel();
          }, backoffDelay);
        }
      }
    });

  return channel;
};

const initializeRealtime = () => {
  return connectChannel();
};

// Initial setup call
initializeRealtime();

export const labService = {
  subscribe: (l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  getTasks: async () => {
    const { data, error } = await supabase.from('coding_tasks').select('*').order('created_at', { ascending: false });
    if (error) console.error('Error fetching tasks:', error);
    return data || [];
  },

  getSystemLogs: () => [...SYSTEM_LOGS],

  getKnowledge: async () => {
    const { data, error } = await supabase.from('knowledge_nodes').select('*').order('created_at', { ascending: false });
    if (error) console.error('Error fetching knowledge:', error);
    return data || [];
  },

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
      lastUpdated: 'Just now', 
      author: 'Admin_Ellars',
      tags: note.tags || []
    };

    const { data, error } = await supabase.from('knowledge_nodes').insert([newNote]).select().single();

    if (error) {
      console.error('Error adding knowledge node:', error);
      return null;
    }
    
    // Auto-log the brain update
    const log = { id: Date.now(), text: `[BRAIN] New knowledge node added: ${newNote.title}`, type: 'knowledge', time: new Date().toLocaleTimeString() };
    SYSTEM_LOGS.push(log);
    broadcast({ type: 'LOG_ADDED', log });
    
    const allKnowledge = await labService.getKnowledge();
    broadcast({ type: 'KNOWLEDGE_UPDATED', knowledge: allKnowledge });

    return data;
  },

  triggerTask: async (payload) => {
    const taskId = payload.task_id || `TASK-${Math.random().toString(36).substring(7).toUpperCase()}`;
    broadcast({ type: 'REASONING_START', taskId, prompt: payload.instruction_prompt });

    const agent = AGENTS[Math.floor(Math.random() * AGENTS.length)];
    
    const steps = [
      { t: `[INGRESS] Transmitting payload to edge router...`, delay: 100 },
      { t: `[BRAIN] Injecting organizational context: ${payload.contextIds?.length || 0} nodes.`, delay: 800 },
      { t: `[AGENT] Assigning ${agent.name} to task.`, delay: 1500 }
    ];

    steps.forEach(step => {
      setTimeout(() => {
        const log = { id: Date.now() + Math.random(), text: step.t, time: new Date().toLocaleTimeString([], { hour12: false }) };
        SYSTEM_LOGS.push(log);
        broadcast({ type: 'LOG_ADDED', log });
      }, step.delay);
    });

    try {
      const ingressUrl = import.meta.env.VITE_INGRESS_URL || '/api/v1/ingress';

      // We wrap the fetch request to our Worker Router
      const payloadBody = JSON.stringify({
          task_id: taskId,
          repository_owner: 'axim-organization',
          repository_name: payload.repository_name,
          target_file_path: payload.target_file_path,
          instruction_prompt: payload.instruction_prompt,
          origin_source: payload.origin_source || 'Manual_Dev_Cockpit',
          contextIds: payload.contextIds
        });

      const internalKey = import.meta.env.VITE_AXIM_INTERNAL_KEY || 'development-key';
      const signature = await generateHmacSignature(payloadBody, internalKey);

      const response = await fetch(ingressUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Axim-Signature': signature
        },
        body: payloadBody
      });

      if (!response.ok) {
         throw new Error(`Ingress Error: ${response.statusText}`);
      }

      const responseData = await response.json();

      setTimeout(() => {
        const log = { id: Date.now() + Math.random(), text: `[SYSTEM] Edge Swarm Task accepted: ${responseData.status}`, type: 'system', time: new Date().toLocaleTimeString([], { hour12: false }) };
        SYSTEM_LOGS.push(log);
        broadcast({ type: 'LOG_ADDED', log });
      }, 2500);

    } catch (err) {
      console.error('Trigger Task Error:', err);
      setTimeout(() => {
        const log = { id: Date.now() + Math.random(), text: `[CRITICAL] Edge Swarm Task Failed: ${err.message}`, type: 'system', time: new Date().toLocaleTimeString([], { hour12: false }) };
        SYSTEM_LOGS.push(log);
        broadcast({ type: 'LOG_ADDED', log });
      }, 2500);
    }

    setTimeout(() => {
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

  getTelemetryData: async () => {
    // Basic analytical grouping query over api_usage_logs
    const { data: logs, error } = await supabase
      .from('api_usage_logs')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Error fetching telemetry:', error);
      return {
        tokenUsage: [0, 0, 0, 0, 0, 0, 0],
        nodeHealth: [{ name: 'LLM Proxy', value: 99, status: 'Operational' }],
        roiMetrics: { hoursSaved: 0, efficiencyGain: '0%', totalCost: '$0.00', estimatedSavings: '$0.00' },
        logs: []
      };
    }

    const tokenUsageMap = new Map();
    let totalTokens = 0;
    let totalRequests = 0;

    const currentData = [0, 0, 0, 0, 0, 0, 0];

    if (logs && logs.length > 0) {
      logs.forEach(log => {
         totalRequests++;

         // Extract token expenditures from metadata
         const tokenCount = log.metadata?.tokens || 0;
         totalTokens += tokenCount;

         if (log.created_at) {
             const date = new Date(log.created_at);
             const dayIndex = (date.getDay() - 1 + 7) % 7; // Monday = 0
             currentData[dayIndex] += tokenCount;
         }
      });
    }

    const hoursSaved = totalRequests;
    const totalCost = (totalTokens / 1000) * 0.01;
    const estimatedSavings = (hoursSaved * 80) - totalCost;
    const efficiencyGain = hoursSaved > 0 ? '84%' : '0%';

    return {
      tokenUsage: currentData,
      nodeHealth: [{ name: 'LLM Proxy', value: 99, status: 'Operational' }],
      roiMetrics: {
        hoursSaved,
        efficiencyGain,
        totalCost: `${totalCost.toFixed(2)}`,
        estimatedSavings: `${Math.max(0, estimatedSavings).toFixed(2)}`
      },
      logs: logs || []
    };
  },

  getAuditLogs: () => Promise.resolve([
    { id: 'AL-1', timestamp: '2026-07-11 14:20:01', actor: 'Asguard_WAF', action: 'DEPLOY_SWARM', target: 'axim-core-api', status: 'SUCCESS' }
  ]),

  mergePR: async (taskId) => {
    const { error } = await supabase.from('coding_tasks').delete().eq('id', taskId);
    if(error) console.error("Error merging PR / deleting task", error);

    const tasks = await labService.getTasks();
    broadcast({ type: 'TASKS_UPDATED', tasks });
    return Promise.resolve();
  },

  addComment: async (taskId, text) => {
    // Mocked for compatibility, depends on schema if tasks store comments
    return Promise.resolve();
  }
};
