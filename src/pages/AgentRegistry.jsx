import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { labService } from '../services/labService';
import SafeIcon from '@/common/SafeIcon';

const AgentRegistry = () => {
  const [agents, setAgents] = useState([]);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    labService.getAgents().then(setAgents);
    labService.getOrgStats().then(setStats);
  }, []);

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Swarm Personnel</h1>
          <p className="text-sm text-gray-400 mt-1">Status and performance of specialized autonomous agents</p>
        </div>
        <div className="flex gap-4">
          <MetricSmall label="ACTIVE_SWARM" value={stats?.activeSwarmSize || 0} />
          <MetricSmall label="SUCCESS_RATE" value={stats?.prSuccessRate || '0%'} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {agents.map((agent, idx) => (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            key={agent.id}
            className="bg-[#0a0f1c] border border-gray-800 rounded-2xl p-6 relative overflow-hidden group hover:border-blue-500/30 transition-all"
          >
            <div className={`absolute top-0 right-0 w-32 h-32 ${agent.status === 'Active' ? 'bg-green-500/5' : 'bg-blue-500/5'} blur-3xl rounded-full`}></div>
            
            <div className="flex items-center justify-between mb-6 relative z-10">
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${
                  agent.status === 'Active' ? 'bg-green-500/10 border-green-500/30' : 'bg-blue-500/10 border-blue-500/30'
                }`}>
                  <SafeIcon name="Cpu" className={agent.status === 'Active' ? 'text-green-400 animate-pulse' : 'text-blue-400'} />
                </div>
                <div>
                  <h3 className="text-white font-bold group-hover:text-blue-400 transition-colors uppercase tracking-tight">{agent.name}</h3>
                  <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">{agent.role}</p>
                </div>
              </div>
              <div className={`w-2 h-2 rounded-full ${agent.status === 'Active' ? 'bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.5)]' : 'bg-gray-600'}`}></div>
            </div>

            <div className="space-y-4 relative z-10">
              <div className="grid grid-cols-2 gap-4">
                <AgentStat label="UPTIME" value={agent.uptime} />
                <AgentStat label="TASKS" value={agent.tasks_completed} />
              </div>
              
              <div className="pt-4 border-t border-gray-800">
                <p className="text-[10px] text-gray-500 font-mono uppercase mb-3 tracking-widest">Cognitive Stack</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-[11px] font-mono">
                    <span className="text-gray-600">MODEL</span>
                    <span className="text-gray-300">{agent.model}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-2">
                    {agent.capabilities.map(cap => (
                      <span key={cap} className="px-2 py-1 bg-gray-800/50 text-gray-400 text-[9px] rounded font-mono border border-gray-800 group-hover:border-gray-700 transition-colors">
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <button className="w-full py-2.5 bg-gray-900 hover:bg-blue-600 hover:text-white text-gray-400 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border border-gray-800 mt-2">
                View Mission Logs
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

const MetricSmall = ({ label, value }) => (
  <div className="bg-[#0a0f1c] border border-gray-800 rounded-lg px-4 py-2 text-center">
    <p className="text-[9px] text-gray-500 font-mono uppercase tracking-widest mb-0.5">{label}</p>
    <p className="text-lg font-bold text-white">{value}</p>
  </div>
);

const AgentStat = ({ label, value }) => (
  <div className="bg-gray-900/50 rounded-lg p-3 border border-gray-800/50">
    <p className="text-[9px] text-gray-500 font-mono uppercase tracking-tighter mb-1">{label}</p>
    <p className="text-sm font-bold text-gray-200">{value}</p>
  </div>
);

export default AgentRegistry;