import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import SafeIcon from '@/common/SafeIcon';
import { labService } from '../services/labService';

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
    <span className={`flex items-center gap-1.5 px-2 py-1 rounded text-[9px] font-bold font-mono border ${styles[status]}`}>
      <SafeIcon name={icon[status] || 'Activity'} className="text-[11px]" />
      {status.toUpperCase()}
    </span>
  );
};

const PipelineMonitor = () => {
  const [tasks, setTasks] = useState([]);

  useEffect(() => {
    labService.getTasks().then(setTasks);
    return labService.subscribe(event => {
      if (event.type === 'TASKS_UPDATED') setTasks(event.tasks);
    });
  }, []);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.5 }}
      className="bg-[#0a0f1c] border border-gray-800 rounded-xl overflow-hidden h-full flex flex-col"
    >
      <div className="h-12 border-b border-gray-800 px-4 flex items-center justify-between bg-[#0d1323]">
        <h3 className="text-xs font-bold text-white flex items-center gap-2 uppercase tracking-widest">
          <SafeIcon name="Activity" className="text-green-500" />
          Task Pipeline
        </h3>
        <span className="text-[10px] text-gray-500 font-mono">{tasks.length} ACTIVE LOCKS</span>
      </div>
      
      <div className="flex-1 overflow-y-auto p-3 space-y-3 terminal-scroll">
        <AnimatePresence initial={false}>
          {tasks.map((task, idx) => (
            <motion.div
              layout
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              key={task.id}
              className="bg-[#111827] border border-gray-800 rounded-lg p-3 hover:border-blue-500/30 transition-all group relative overflow-hidden"
            >
              {task.status === 'Generating' && (
                <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-purple-500 to-transparent animate-shimmer"></div>
              )}
              <div className="flex justify-between items-start mb-2">
                <span className="text-[11px] font-mono text-blue-400 group-hover:text-blue-300 transition-colors">{task.id}</span>
                <StatusBadge status={task.status} />
              </div>
              <div className="text-[12px] text-gray-300 font-medium truncate mb-1">
                {task.file}
              </div>
              <div className="flex justify-between items-center text-[9px] text-gray-500 font-mono mt-4 uppercase tracking-tighter">
                <span>SOURCE: {task.origin}</span>
                <span>{task.time}</span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};

export default PipelineMonitor;