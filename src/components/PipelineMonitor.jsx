import React from 'react';
import { motion } from 'framer-motion';
import SafeIcon from '@/common/SafeIcon';

const tasks = [
  { id: 'HOTFIX-8A92F1', origin: 'Asguard_WAF', status: 'Generating', file: 'middleware/auth.ts', time: '12s ago' },
  { id: 'FEAT-2B49D8', origin: 'Manual_Cockpit', status: 'Committing', file: 'components/Button.jsx', time: '45s ago' },
  { id: 'BUG-7C11E3', origin: 'Onyx_Support', status: 'Review Gate', file: 'utils/parser.js', time: '2m ago' },
];

const StatusBadge = ({ status }) => {
  const styles = {
    'Generating': 'text-purple-400 bg-purple-500/10 border-purple-500/20',
    'Committing': 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    'Review Gate': 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  };
  
  const icon = {
    'Generating': 'Cpu',
    'Committing': 'GitCommit',
    'Review Gate': 'Eye',
  };

  return (
    <span className={`flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-mono border ${styles[status]}`}>
      <SafeIcon name={icon[status]} className="text-[12px]" />
      {status.toUpperCase()}
    </span>
  );
};

const PipelineMonitor = () => {
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.5 }}
      className="bg-[#0a0f1c] border border-gray-800 rounded-xl overflow-hidden h-[400px] flex flex-col"
    >
      <div className="h-12 border-b border-gray-800 px-4 flex items-center justify-between">
        <h3 className="text-sm font-medium text-white flex items-center gap-2">
          <SafeIcon name="Activity" className="text-green-400" />
          Active Pipeline Monitor
        </h3>
        <span className="text-xs text-gray-500 font-mono">3 TASKS LOCKED</span>
      </div>
      
      <div className="flex-1 overflow-y-auto p-2 space-y-2 terminal-scroll">
        {tasks.map((task, idx) => (
          <motion.div 
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.6 + (idx * 0.1) }}
            key={task.id} 
            className="bg-[#111827] border border-gray-800 rounded-lg p-3 hover:border-gray-700 transition-colors"
          >
            <div className="flex justify-between items-start mb-2">
              <span className="text-xs font-mono text-gray-300">{task.id}</span>
              <StatusBadge status={task.status} />
            </div>
            <div className="text-sm text-gray-400 mb-1 truncate">
              Target: <span className="text-blue-400 font-mono text-xs">{task.file}</span>
            </div>
            <div className="flex justify-between items-center text-[10px] text-gray-500 font-mono mt-3">
              <span>SRC: {task.origin}</span>
              <span>{task.time}</span>
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
};

export default PipelineMonitor;