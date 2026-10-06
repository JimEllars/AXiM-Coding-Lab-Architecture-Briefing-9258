import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import SafeIcon from '@/common/SafeIcon';
import { labService } from '../services/labService';
import { dispatchSupportTask } from '../services/supportGateway';

const StatusBadge = ({ status }) => {
  const styles = {
    'INGESTED': 'text-gray-400 bg-gray-500/10 border-gray-500/20',
    'ANALYZING': 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    'BRANCH_CREATED': 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20',
    'PATCHING': 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    'SYNTAX_VALIDATING': 'text-[#FDD023] bg-[#FDD023]/10 border-[#FDD023]/20',
    'PR_OPENED': 'text-green-400 bg-green-500/10 border-green-500/20',
    'MERGED': 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
  };
  const icon = {
    'INGESTED': 'Download',
    'ANALYZING': 'Search',
    'BRANCH_CREATED': 'GitBranch',
    'PATCHING': 'Edit',
    'SYNTAX_VALIDATING': 'Shield',
    'PR_OPENED': 'GitPullRequest',
    'MERGED': 'GitMerge'
  };
  return (
    <span className={`flex items-center gap-1.5 px-2 py-1 rounded text-[9px] font-bold font-mono border ${styles[status]}`}>
      <SafeIcon name={icon[status] || 'Activity'} className="text-[11px]" />
      {status.toUpperCase()}
    </span>
  );
};


const OriginBadge = ({ origin_source }) => {
  const source = origin_source || 'Manual_Dev_Cockpit';
  if (source === 'Asguard_WAF') {
    return (
      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[9px] font-bold font-mono border text-amber-400 bg-amber-500/10 border-amber-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
        ASGUARD WAF
      </span>
    );
  }
  if (source === 'Onyx_Support_Triage') {
    return (
      <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[9px] font-bold font-mono border text-violet-400 bg-violet-500/10 border-violet-500/20">
        <SafeIcon name="Shield" className="text-[10px]" />
        ONYX SUPPORT
      </span>
    );
  }
  // Default: Manual_Dev_Cockpit
  return (
    <span className="flex items-center gap-1.5 px-2 py-0.5 rounded text-[9px] font-bold font-mono border text-emerald-400 bg-emerald-500/10 border-emerald-500/20">
      <SafeIcon name="Terminal" className="text-[10px]" />
      MANUAL COCKPIT
    </span>
  );
};

const PipelineMonitor = () => {
  const [tasks, setTasks] = useState([]);
  const [filterTab, setFilterTab] = useState('ALL');
  const fleets = ['ALL', 'CORE', 'SUPPORT', 'SPEEDREPORT', 'ONYX', 'ELLARS', 'DEMAND_LETTER'];
  const [activePipeline, setActivePipeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmingEviction, setConfirmingEviction] = useState({});

  const handleEvictLock = async (taskId) => {
    if (!confirmingEviction[taskId]) {
      setConfirmingEviction(prev => ({ ...prev, [taskId]: true }));
      setTimeout(() => {
        setConfirmingEviction(prev => {
          if (!prev[taskId]) return prev;
          const next = { ...prev };
          delete next[taskId];
          return next;
        });
      }, 4000);
      return;
    }

    setConfirmingEviction(prev => {
      const next = { ...prev };
      delete next[taskId];
      return next;
    });

    try {
      await dispatchSupportTask({ operation: 'FORCE_UNLOCK', task_id: taskId });
      setTasks((prevTasks) => prevTasks.filter((t) => t.id !== taskId));
    } catch (err) {
      console.error('Error evicting lock:', err);
    }
  };

  useEffect(() => {
    const processTasks = (newTasks) => {
      setTasks(newTasks);
      const active = newTasks
        .filter(t => ['INGESTED', 'ANALYZING', 'BRANCH_CREATED', 'PATCHING', 'SYNTAX_VALIDATING', 'PR_OPENED'].includes(t.status))
        .slice(0, 4);
      setActivePipeline(active);
      setLoading(false);
    };

    labService.getTasks().then(processTasks);


    let batchTimeout;
    return labService.subscribe(event => {
      if (event.type === 'TASKS_UPDATED') {
         if (batchTimeout) clearTimeout(batchTimeout);
         batchTimeout = setTimeout(() => {
            processTasks(event.tasks);
         }, 250);
      }
    });

  }, []);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.5 }}
      className="bg-[#111827] border border-[#1F2937] rounded-xl overflow-hidden h-full flex flex-col"
    >
      <div className="h-12 border-b border-[#1F2937] px-4 flex items-center justify-between bg-[#0B0F19]">
        <h3 className="text-xs font-bold text-white flex items-center gap-2 uppercase tracking-widest">
          <SafeIcon name="Activity" className="text-green-500" />
          Task Pipeline
        </h3>
        <span className="text-[10px] text-gray-500 font-mono">{activePipeline.length} ACTIVE LOCKS</span>
      </div>
      <div className="flex border-b border-[#1F2937] overflow-x-auto scrollbar-hide">
        {fleets.map(f => (
          <button
            key={f}
            onClick={() => setFilterTab(f)}
            className={`px-3 py-2 text-[10px] font-mono whitespace-nowrap transition-colors ${filterTab === f ? 'text-[#FDD023] border-b-2 border-[#FDD023]' : 'text-gray-500 hover:text-gray-300'}`}
          >
            {f}
          </button>
        ))}
      </div>
      
      <div className="flex-1 overflow-y-auto p-3 space-y-3 terminal-scroll">
        {loading ? (
          <div className="space-y-3">
             {[1,2,3].map(i => (
                <div key={i} className="bg-[#111827] border border-[#1F2937] rounded-lg p-3 h-[90px] animate-pulse">
                   <div className="flex justify-between items-start mb-2">
                     <div className="h-4 bg-slate-800/50 rounded w-20"></div>
                     <div className="h-5 bg-slate-800/50 rounded w-24"></div>
                   </div>
                   <div className="h-4 bg-slate-800/50 rounded w-48 mb-1"></div>
                   <div className="flex justify-between items-center mt-4">
                     <div className="h-4 bg-slate-800/50 rounded w-24"></div>
                     <div className="h-3 bg-slate-800/50 rounded w-12"></div>
                   </div>
                </div>
             ))}
          </div>
        ) : (
          <AnimatePresence initial={false}>
          {activePipeline.length === 0 ? (
            <div className="p-4 text-center text-gray-500 text-xs font-mono">NO ACTIVE OPERATIONS IN PIPELINE</div>
          ) : (
            activePipeline.filter(task => {
              if (filterTab === 'ALL') return true;
              if (!task.repo) return false;
              const repo = task.repo.toUpperCase();
              if (filterTab === 'CORE' && repo.includes('CORE')) return true;
              if (filterTab === 'SUPPORT' && repo.includes('SUPPORT')) return true;
              if (filterTab === 'SPEEDREPORT' && repo.includes('SPEEDREPORT')) return true;
              if (filterTab === 'ONYX' && repo.includes('ONYX')) return true;
              if (filterTab === 'ELLARS' && repo.includes('ELLARS')) return true;
              if (filterTab === 'DEMAND_LETTER' && repo.includes('DEMAND-LETTER')) return true;
              return false;
            }).map((task, idx) => (
            <motion.div
              layout
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              key={task.id}
              className="bg-[#111827] border border-[#1F2937] rounded-lg p-3 hover:border-[#FDD023]/30 transition-all group relative overflow-hidden"
            >
              {['PATCHING', 'ANALYZING', 'SYNTAX_VALIDATING'].includes(task.status) && (
                <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-purple-500 to-transparent animate-shimmer"></div>
              )}
              <div className="flex justify-between items-start mb-2">
                <span className="text-[11px] font-mono text-[#FDD023] group-hover:text-blue-300 transition-colors">{task.id}</span>
                <StatusBadge status={task.status} />
              </div>
              <div className="text-[12px] text-gray-300 font-medium truncate mb-1">
                {task.file}
              </div>
              <div className="flex justify-between items-center text-[9px] text-gray-500 font-mono mt-4 uppercase tracking-tighter">
                <OriginBadge origin_source={task.origin_source || task.origin} />
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleEvictLock(task.id)}
                    className={
                      confirmingEviction[task.id]
                        ? "text-orange-400 hover:text-orange-300 font-bold transition-colors border border-orange-500/50 rounded px-1.5 py-0.5"
                        : "text-red-500/80 hover:text-red-400 font-bold transition-colors"
                    }
                  >
                    {confirmingEviction[task.id] ? "Confirm Eviction?" : "Evict Lock"}
                  </button>
                  <span className="opacity-80 flex items-center gap-1"><SafeIcon name="Clock" className="text-[10px]" /> {task.time || new Date().toLocaleTimeString([], { hour12: false })}</span>
                </div>
              </div>
            </motion.div>
          )))}
        </AnimatePresence>
        )}
      </div>
    </motion.div>
  );
};

export default PipelineMonitor;