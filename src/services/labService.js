/**
 * AXiM Coding Lab - Enterprise Service Layer (V3)
 * Orchestrates the "Organizational Brain", Multi-Agent Swarms, and Knowledge Injection.
 */
import { supabase } from './supabaseClient';
import { generateHmacSignature } from '../utils/crypto';

const listeners = new Set();
const broadcast = (event) => listeners.forEach(l => l(event));

// Store local system logs
let SYSTEM_LOGS = JSON.parse(sessionStorage.getItem('axim_system_logs') || '[]');
const addSystemLog = (log) => {
  if (SYSTEM_LOGS.length === 0) SYSTEM_LOGS = JSON.parse(sessionStorage.getItem('axim_system_logs') || '[]');
  SYSTEM_LOGS.push(log);
  if (SYSTEM_LOGS.length > 150) {
    SYSTEM_LOGS = SYSTEM_LOGS.slice(-150);
  }
  sessionStorage.setItem('axim_system_logs', JSON.stringify(SYSTEM_LOGS));
};

let AGENTS = [
  { id: 'AXIM-CODER-01', name: 'AXiM Coder Core', role: 'Internal Autonomous Engineer', status: 'Active', model: 'Multi-Model (Claude/DeepSeek)', capabilities: ['Ecosystem Tasks', 'PR Sweeping', 'Edge Generation'], uptime: '100%', tasks_completed: 450, isPrimary: true },
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
          addSystemLog(log);
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

const disconnectRealtime = () => {
  if (channel) {
    supabase.removeChannel(channel);
    channel = null;
  }
  if (reconnectTimeout) {
    clearTimeout(reconnectTimeout);
    reconnectTimeout = null;
  }
};

// Initial setup call
initializeRealtime();

let isRefreshing = false;
let refreshSubscribers = [];

const subscribeTokenRefresh = (cb) => {
  refreshSubscribers.push(cb);
};

const onTokenRefreshed = (err, token) => {
  refreshSubscribers.forEach(cb => cb(err, token));
  refreshSubscribers = [];
};

const getValidToken = async () => {
  const session = await supabase.auth.getSession();
  const expiresAt = session?.data?.session?.expires_at;
  const now = Math.floor(Date.now() / 1000);

  // Buffer if token expires in less than 60s
  if (expiresAt && (expiresAt - now) < 60) {
     if (!isRefreshing) {
        isRefreshing = true;
        try {
           const { data, error } = await supabase.auth.refreshSession();
           isRefreshing = false;
           if (error) throw error;
           onTokenRefreshed(null, data.session.access_token);
           return data.session.access_token;
        } catch (e) {
           isRefreshing = false;
           onTokenRefreshed(e, null);
           return null;
        }
     } else {
        return new Promise((resolve) => {
           subscribeTokenRefresh((err, token) => {
              resolve(token);
           });
        });
     }
  }

  return session?.data?.session?.access_token || localStorage.getItem('axim_internal_key');
};


  let pipelineMetricsCache = {
    dateLabels: [],
    tokenUsage: [],
    nodeHealth: [
      { name: 'Core LLM Proxy', status: 'Unknown', latency: '-', color: 'blue' },
      { name: 'GitHub API Bridge', status: 'Unknown', latency: '-', color: 'blue' },
      { name: 'Asguard SOC Ingress', status: 'Unknown', latency: '-', color: 'blue' },
      { name: 'Worker Task Locks', status: 'Unknown', latency: '-', color: 'blue' }
    ],
    roiMetrics: { hoursSaved: 0, efficiencyGain: '0%', totalCost: '$0.00', estimatedSavings: '$0.00' },
    logs: []
  };

export const labService = {

  subscribeToTelemetry: (callback) => {
    let reconnectTimeout = null;
    let telemetryChannel = null;

    const connect = () => {
      if (telemetryChannel) {
        supabase.removeChannel(telemetryChannel);
      }

      telemetryChannel = supabase.channel('schema-db-changes');
      telemetryChannel
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'audit_logs' },
          () => {
             // Dispatch new metrics when audit logs change (or trigger refresh)
             callback('ONLINE / REALTIME');
          }
        )
        .subscribe((status) => {
           if (status === 'SUBSCRIBED') {
             callback('ONLINE / REALTIME');
           } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
             callback('Live sync reconnecting...');
             if (!reconnectTimeout) {
               reconnectTimeout = setTimeout(connect, 3000);
             }
           }
        });
    };

    connect();

    return () => {
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (telemetryChannel) supabase.removeChannel(telemetryChannel);
    };
  },

  fetchTelemetryStats: async () => {
    const cacheKey = 'axim_telemetry_stats_cache';
    const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
    const workerUrl = import.meta.env.VITE_INGRESS_URL ? import.meta.env.VITE_INGRESS_URL.replace('/api/v1/ingress', '/api/telemetry/stats') : '/api/telemetry/stats';

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(workerUrl, { signal: controller.signal });
      clearTimeout(timeout);

      if (!res.ok) throw new Error('Failed to fetch telemetry stats');
      const stats = await res.json();

      // Cache successful response
      sessionStorage.setItem(cacheKey, JSON.stringify(stats));
      return stats;
    } catch (error) {
      console.warn('Telemetry fetch failed, using local cached averages:', error);
      return cached || { total_events: 0, average_latency: 0, total_tokens: 0, events: [] };
    }
  },

  subscribeToPipelineMetrics: (callback, intervalMs = 3000) => {
    let pollingInterval;
    let eventSource;
    let fallbackMode = false;
    let lastHealthyState = JSON.parse(sessionStorage.getItem('axim_telemetry_cache') || 'null');

    if (lastHealthyState) {
       pipelineMetricsCache = lastHealthyState;
       callback(pipelineMetricsCache, 'LOCAL CACHE');
    }

    const workerUrl = import.meta.env.VITE_INGRESS_URL ? import.meta.env.VITE_INGRESS_URL.replace('/api/v1/ingress', '/api/telemetry/stream') : '/api/telemetry/stream';

    const startStream = () => {
      try {
        eventSource = new EventSource(workerUrl);
        eventSource.onmessage = (event) => {
          fallbackMode = false;
          // In real implementation we would merge this data, here we just invoke the callback
          callback(pipelineMetricsCache, 'ONLINE / REALTIME');
        };
        eventSource.onerror = () => {
          eventSource.close();
          fallbackMode = true;
          startPolling();
        };
      } catch (err) {
         fallbackMode = true;
         startPolling();
      }
    };

    const startPolling = () => {
      if (pollingInterval) clearInterval(pollingInterval);
      pollingInterval = setInterval(async () => {
        try {
           const metrics = await labService.getTelemetryData();
           pipelineMetricsCache = metrics;
           sessionStorage.setItem('axim_telemetry_cache', JSON.stringify(metrics));
           callback(metrics, 'DEGRADED / FALLBACK');
        } catch (e) {
           callback(pipelineMetricsCache, 'CACHED / OFFLINE');
        }
      }, intervalMs);
    };

    startStream();

    return () => {
      if (eventSource) eventSource.close();
      if (pollingInterval) clearInterval(pollingInterval);
    };
  },

  getValidToken,
  logToConsole(log) {
    addSystemLog(log);
    broadcast({ type: 'LOG_ADDED', log });
  },

  async executeSafely(operation) {
    try {
      const result = await operation();
      return { success: true, data: result || [], error: null };
    } catch (err) {
      console.error('[labService] Operation failed:', err);
      return { success: false, data: null, error: { code: 'NETWORK_ERROR', message: err.message || 'Unknown error' } };
    }
  },


  logAuditEvent: (auditData) => {
    // Non-blocking fire-and-forget telemetry push
    supabase.from('coding_tasks_errors').insert({
      component: auditData.component || 'UI Telemetry',
      message: auditData.action || 'Unknown Action',
      status: auditData.status || 'LOG',
      context: { actor: auditData.actor || 'System', target: auditData.target || 'N/A' },
      task_id: auditData.taskId || null
    }).then(({ error }) => {
      if (error) console.warn('[Telemetry] Failed to dispatch audit log:', error);
    }).catch(() => {});
  },

  disconnectRealtime,
  subscribe: (l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },

  getTasks: async () => {
    try {
      const { data, error } = await supabase.from('coding_tasks').select('*').order('created_at', { ascending: false });
      if (error) console.error('Error fetching tasks:', error);
      return data || [];
    } catch (err) {
      console.error('Exception fetching tasks:', err);
      return [];
    }
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
    addSystemLog(log);
    broadcast({ type: 'LOG_ADDED', log });
    
    const allKnowledge = await labService.getKnowledge();
    broadcast({ type: 'KNOWLEDGE_UPDATED', knowledge: allKnowledge });

    return data;
  },

  logIncident: async (message) => {
    const log = { id: Date.now() + Math.random(), text: `[CRITICAL] ${message}`, type: 'system', time: new Date().toLocaleTimeString([], { hour12: false }) };
    addSystemLog(log);
    broadcast({ type: 'LOG_ADDED', log });

    try {
      await supabase.from('coding_tasks_errors').insert([
        {
          status: 'FAILED',
          message: message,
          context: { actor: 'Asguard_WAF', target: 'axim-core-api' }
        }
      ]);
    } catch (err) {
      console.error('Failed to write incident to database:', err);
    }
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
        addSystemLog(log);
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
          contextIds: payload.contextIds,
          runtime_env: payload.runtime_env
        });

      const internalKey = import.meta.env.VITE_AXIM_INTERNAL_KEY || 'development-key';
      const signature = await generateHmacSignature(payloadBody, internalKey);

      const { data: sessionData } = await supabase.auth.getSession();
      const session = sessionData?.session;
      const token = session?.access_token || '';

      const fetchWithRetry = async (url, options, maxAttempts = 3) => {
        let attempt = 0;
        let delay = 1000;
        while (attempt < maxAttempts) {
          try {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 8000);
            const res = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(id);
            if (res.ok) return res;
            if (res.status >= 400 && res.status < 500) return res;
            throw new Error(`HTTP ${res.status}`);
          } catch (err) {
            attempt++;
            if (attempt >= maxAttempts) throw err;
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2;
          }
        }
      };

      const response = await fetchWithRetry(ingressUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Axim-Signature': signature,
          'Accept': 'text/event-stream',
          'Authorization': `Bearer ${token}`
        },
        body: payloadBody
      });

      if (!response.ok) {
         throw new Error(`Ingress Error: ${response.statusText}`);
      }

      if (response.headers.get('content-type')?.includes('text/event-stream')) {
         const reader = response.body.getReader();
         const decoder = new TextDecoder();
         let done = false;

         const processStream = async () => {
             try {
                 while (!done) {
                     const { value, done: doneReading } = await reader.read();
                     done = doneReading;
                     if (value) {
                         const chunk = decoder.decode(value, { stream: true });
                         const lines = chunk.split('\n');
                         for (const line of lines) {
                             if (line.startsWith('data: ')) {
                                 const dataStr = line.replace('data: ', '').trim();
                                 if (dataStr && !dataStr.startsWith('{": ping"}') && dataStr !== 'ping' && dataStr !== ': ping') {
                                     try {
                                         const ev = JSON.parse(dataStr);
                                         const log = { id: Date.now() + Math.random(), text: ev.type === 'error' ? `[CRITICAL] ${ev.message}` : `[SYSTEM] ${ev.message}`, type: ev.type, time: new Date().toLocaleTimeString([], { hour12: false }) };
                                         addSystemLog(log);
                                         broadcast({ type: 'LOG_ADDED', log });
                                     } catch (e) {
                                        // Ignore parse errors on stream
                                     }
                                 }
                             }
                         }
                     }
                 }
             } finally {
                 broadcast({ type: 'REASONING_END', taskId });
             }
         };
         processStream();
      } else {
          const responseData = await response.json();
          setTimeout(() => {
            const log = { id: Date.now() + Math.random(), text: `[SYSTEM] Edge Swarm Task accepted: ${responseData.status}`, type: 'system', time: new Date().toLocaleTimeString([], { hour12: false }) };
            addSystemLog(log);
            broadcast({ type: 'LOG_ADDED', log });
          }, 2500);
      }

    } catch (err) {
      console.error('Trigger Task Error:', err);
      setTimeout(() => {
        const log = { id: Date.now() + Math.random(), text: `[CRITICAL] Edge Swarm Task Failed: ${err.message}`, type: 'system', time: new Date().toLocaleTimeString([], { hour12: false }) };
        addSystemLog(log);
        broadcast({ type: 'LOG_ADDED', log });
        broadcast({ type: 'REASONING_END', taskId });
      }, 2500);
    }

    return Promise.resolve(taskId);
  },

  getRepositories: async () => {
    try {
      const { data, error } = await supabase.from('coding_tasks').select('repository_name, status, created_at').order('created_at', { ascending: false });
      if (error) {
        console.error('Error fetching repositories:', error);
        return [];
      }

      const repoMap = new Map();
      data.forEach(task => {
        if (!repoMap.has(task.repository_name)) {
          repoMap.set(task.repository_name, {
            id: `R-${task.repository_name}`,
            name: task.repository_name,
            health: 100,
            activeSwarm: task.status === 'IN_PROGRESS',
            lastPatch: new Date(task.created_at).toLocaleDateString(),
            language: 'Unknown',
            coverage: 'N/A',
            files: 0,
            branches: 0,
            dependencies: []
          });
        }
      });

      return Array.from(repoMap.values());
    } catch (err) {
      console.error('Exception fetching repositories:', err);
      return [];
    }
  },

  getSecurityIncidents: async () => {
    try {
      const { data, error } = await supabase
        .from('coding_tasks_errors')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching security incidents:', error);
        return [];
      }

      const incidents = data.filter(row => row.context?.actor === 'Asguard_WAF' || row.message?.includes('security'));

      return incidents.map(row => ({
        id: row.id,
        severity: 'CRITICAL',
        type: row.message || 'Security Incident',
        target: row.context?.target || 'axim-core-api',
        path: row.context?.path || 'N/A',
        status: row.status || 'UNRESOLVED',
        time: new Date(row.created_at).toLocaleString(),
        task_id: row.id,
        error_message: row.message,
        created_at: row.created_at
      }));
    } catch (err) {
      console.error('Exception fetching security incidents:', err);
      return [];
    }
  },

  getTelemetryData: async () => {
    try {
      // Basic analytical grouping query over api_usage_logs
      const { data: logs, error } = await supabase
        .from('api_usage_logs')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching telemetry:', error);
        return {
          dateLabels: [],
          tokenUsage: [],
          nodeHealth: [
            { name: 'Core LLM Proxy', status: 'Unknown', latency: '-', color: 'blue' },
            { name: 'GitHub API Bridge', status: 'Unknown', latency: '-', color: 'blue' },
            { name: 'Asguard SOC Ingress', status: 'Unknown', latency: '-', color: 'blue' },
            { name: 'Worker Task Locks', status: 'Unknown', latency: '-', color: 'blue' }
          ],
          roiMetrics: { hoursSaved: 0, efficiencyGain: '0%', totalCost: '$0.00', estimatedSavings: '$0.00' },
          logs: []
        };
      }

    const tokenUsageMap = new Map();
    let totalTokens = 0;
    let totalRequests = 0;
    let totalCost = 0;

    if (logs && logs.length > 0) {
      logs.forEach(log => {
         totalRequests++;

         // Extract token expenditures from metadata
         const tokenCount = log.metadata?.tokens || 0;
         const model = log.metadata?.model;

         if (model === 'deepseek-coder') {
           const inputTokens = log.metadata?.input_tokens || (tokenCount * 0.5);
           const outputTokens = log.metadata?.output_tokens || (tokenCount * 0.5);
           totalCost += (inputTokens / 1000000) * 0.14 + (outputTokens / 1000000) * 0.28;
         } else if (model === 'claude-3-5') {
           const inputTokens = log.metadata?.input_tokens || (tokenCount * 0.5);
           const outputTokens = log.metadata?.output_tokens || (tokenCount * 0.5);
           totalCost += (inputTokens / 1000000) * 3.00 + (outputTokens / 1000000) * 15.00;
         } else {
           totalCost += (tokenCount / 1000) * 0.01;
         }
         totalTokens += tokenCount;

         if (log.created_at) {
             const date = new Date(log.created_at);
             const mm = String(date.getMonth() + 1).padStart(2, '0');
             const dd = String(date.getDate()).padStart(2, '0');
             const dateLabel = `${mm}/${dd}`;

             if (tokenUsageMap.has(dateLabel)) {
                 tokenUsageMap.set(dateLabel, tokenUsageMap.get(dateLabel) + tokenCount);
             } else {
                 tokenUsageMap.set(dateLabel, tokenCount);
             }
         }
      });
    }

    const dateLabels = Array.from(tokenUsageMap.keys());
    const tokenUsage = Array.from(tokenUsageMap.values());

    const hoursSaved = totalRequests;
      const estimatedSavings = (hoursSaved * 80) - totalCost;
      const efficiencyGain = hoursSaved > 0 ? '84%' : '0%';

      return {
        dateLabels,
        tokenUsage,
        nodeHealth: [
          { name: 'Core LLM Proxy', status: 'Operational', latency: 'N/A', color: 'green' },
          { name: 'GitHub API Bridge', status: 'Nominal', latency: 'N/A', color: 'green' },
          { name: 'Asguard SOC Ingress', status: 'Active', latency: 'N/A', color: 'green' },
          { name: 'Worker Analytics (Edge)', status: 'Active', latency: 'N/A', color: 'green' }
        ],
        roiMetrics: {
          hoursSaved,
          efficiencyGain,
          totalCost: `${totalCost.toFixed(2)}`,
          estimatedSavings: `${Math.max(0, estimatedSavings).toFixed(2)}`
        },
        logs: logs || []
      };
    } catch (err) {
      console.error('Exception fetching telemetry:', err);
      return {
        dateLabels: [],
        tokenUsage: [],
        nodeHealth: [
          { name: 'Core LLM Proxy', status: 'Unknown', latency: '-', color: 'blue' },
          { name: 'GitHub API Bridge', status: 'Unknown', latency: '-', color: 'blue' },
          { name: 'Asguard SOC Ingress', status: 'Unknown', latency: '-', color: 'blue' },
          { name: 'Worker Analytics (Edge)', status: 'Unknown', latency: '-', color: 'blue' }
        ],
        roiMetrics: { hoursSaved: 0, efficiencyGain: '0%', totalCost: '$0.00', estimatedSavings: '$0.00' },
        logs: []
      };
    }
  },

  getAuditLogs: async () => {
    try {
      const { data, error } = await supabase.from('coding_tasks_errors').select('*').order('created_at', { ascending: false });
      if (error) {
        console.error('Error fetching audit logs:', error);
        return [];
      }
      return data.map(row => ({
        id: row.id,
        timestamp: new Date(row.created_at).toLocaleString(),
        actor: row.context?.actor || row.component || 'System Engine',
        action: row.message || 'DEPLOY_SWARM',
        target: row.context?.target || 'axim-core-api',
        status: row.status || 'SUCCESS'
      }));
    } catch (err) {
      console.error('Exception fetching audit logs:', err);
      return [];
    }
  },

  mergePR: async (taskId) => {
    try {
      const { error: insertError } = await supabase.from('coding_tasks_errors').insert({
        component: 'Human Operator',
        error_type: 'PR_MERGED',
        message: `Operator merged pull request for task lock ${taskId}`,
        task_id: taskId,
        status: 'SUCCESS'
      });
      if (insertError) {
        console.error("Error appending PR merge trace log", insertError);
      }
    } catch (e) {
      console.error("Exception appending PR merge trace log", e);
    }

    const { error } = await supabase.from('coding_tasks').delete().eq('id', taskId);
    if(error) console.error("Error merging PR / deleting task", error);

    const tasks = await labService.getTasks();
    broadcast({ type: 'TASKS_UPDATED', tasks });
    return Promise.resolve();
  },

  addComment: async (taskId, text) => {
    try {
      const { data: taskData, error: fetchError } = await supabase
        .from('coding_tasks')
        .select('context')
        .eq('id', taskId)
        .single();

      if (fetchError) {
        console.error('Error fetching task for comment:', fetchError);
        return;
      }

      const currentContext = taskData.context || {};
      const comments = currentContext.comments || [];

      const newComment = {
        id: Date.now().toString(),
        text,
        author: 'Human Operator',
        time: new Date().toLocaleTimeString([], { hour12: false })
      };

      const updatedContext = {
        ...currentContext,
        comments: [...comments, newComment]
      };

      const { error: updateError } = await supabase
        .from('coding_tasks')
        .update({ context: updatedContext })
        .eq('id', taskId);

      if (updateError) {
        console.error('Error updating task with comment:', updateError);
        return;
      }

      const tasks = await labService.getTasks();
      broadcast({ type: 'TASKS_UPDATED', tasks });
    } catch (err) {
      console.error('Exception adding comment:', err);
    }
  }
};
