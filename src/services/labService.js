/**
 * AXiM Coding Lab - Centralized Service Layer
 * Manages task states, telemetry, and bridge communication.
 */

const MOCK_TASKS = [
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
    pr_url: 'https://github.com/axim/core/pull/124'
  },
  { 
    id: 'FEAT-2B49D8', 
    origin: 'Manual_Cockpit', 
    status: 'Committing', 
    file: 'components/Button.jsx', 
    repository: 'frontend-dashboard',
    time: '45s ago',
    tokens: 8500,
    cost: 0.17,
    branch: 'axim-bot/feat-2b49d8',
    pr_url: null
  },
  { 
    id: 'BUG-7C11E3', 
    origin: 'Onyx_Support', 
    status: 'Generating', 
    file: 'utils/parser.js', 
    repository: 'axim-core-api',
    time: '12s ago',
    tokens: 0,
    cost: 0,
    branch: 'axim-bot/bug-7c11e3',
    pr_url: null
  },
];

export const labService = {
  getTasks: () => Promise.resolve(MOCK_TASKS),
  
  getTelemetryData: () => Promise.resolve({
    tokenUsage: [120, 150, 180, 220, 190, 240, 210],
    roiMetrics: {
      hoursSaved: 142,
      efficiencyGain: '84%',
      totalCost: '$142.50',
      estimatedSavings: '$11,360'
    }
  }),

  triggerTask: async (payload) => {
    console.log('[LAB_SERVICE] Triggering autonomous swarm:', payload);
    // In a real environment, this would call the Cloudflare Worker Ingress
    return new Promise(resolve => setTimeout(resolve, 1500));
  },

  mergePR: async (taskId) => {
    console.log(`[LAB_SERVICE] Merging PR for task: ${taskId}`);
    return new Promise(resolve => setTimeout(resolve, 2000));
  }
};