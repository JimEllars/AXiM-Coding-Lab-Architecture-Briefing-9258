import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { labService } from '../services/labService';
import SafeIcon from '@/common/SafeIcon';

const AgentRegistry = () => {
  const [agents, setAgents] = useState([]);

  useEffect(() => {
    labService.getAgents().then(setAgents);
  }, []);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white tracking-tight">Agent Registry</h1>
        <p className="text-sm text-gray-400 mt-1">Status and capabilities of the autonomous swarm members</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {agents.map((agent, idx) => (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            key={agent.id}
            className="bg-[#0a0f1c] border border-gray-800 rounded-2xl p-6 relative overflow-hidden"
          >
            <div className={`absolute top-0 right-0 w-32 h-32 ${agent.status === 'Active' ? 'bg-green-500/5' : 'bg-blue-500/5'} blur-3xl rounded-full`}></div>
            
            <div className="flex items-center gap-4 mb-6 relative z-10">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${
                agent.status === 'Active' ? 'bg-green-500/10 border-green-500/30' : 'bg-blue-500/10 border-blue-500/30'
              }`}>
                <SafeIcon name="Cpu" className={agent.status === 'Active' ? 'text-green-400 animate-pulse' : 'text-blue-400'} />
              </div>
              <div>
                <h3 className="text-white font-bold">{agent.name}</h3>
                <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">{agent.role}</p>
              </div>
            </div>

            <div className="space-y-4 relative z-10">
              <div className="flex justify-between text-[11px] font-mono">
                <span className="text-gray-500 uppercase">Status</span>
                <span className={agent.status === 'Active' ? 'text-green-400' : 'text-blue-400'}>{agent.status}</span>
              </div>
              <div className="flex justify-between text-[11px] font-mono">
                <span className="text-gray-500 uppercase">Model</span>
                <span className="text-gray-300">{agent.model}</span>
              </div>
              
              <div className="pt-4 border-t border-gray-800">
                <p className="text-[10px] text-gray-500 font-mono uppercase mb-2">Capabilities</p>
                <div className="flex flex-wrap gap-2">
                  {agent.capabilities.map(cap => (
                    <span key={cap} className="px-2 py-1 bg-gray-800 text-gray-300 text-[9px] rounded font-mono border border-gray-700">
                      {cap}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default AgentRegistry;