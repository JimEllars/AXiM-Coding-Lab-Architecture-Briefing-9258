import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { labService } from '../services/labService';
import SafeIcon from '@/common/SafeIcon';

const SecOps = () => {
  const [incidents, setIncidents] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    labService.getSecurityIncidents().then(setIncidents);
  }, []);

  const handleAutoPatch = (incident) => {
    navigate('/', { state: { 
      repoId: incident.target, 
      filePath: incident.path,
      autoPrompt: `Critical ${incident.type} detected at ${incident.path}. Implement high-priority remediation immediately.`
    }});
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">SecOps Command Center</h1>
          <p className="text-sm text-gray-400 mt-1">Real-time threat detection and autonomous remediation</p>
        </div>
        <div className="flex gap-4">
          <div className="px-4 py-2 bg-orange-500/10 border border-orange-500/20 rounded-lg text-orange-400 text-xs font-mono flex items-center gap-2">
            <SafeIcon name="Shield" className="animate-pulse" />
            ASGUARD_WAF_CONNECTED
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <SeverityCard label="CRITICAL" count={1} color="red" />
        <SeverityCard label="HIGH" count={1} color="orange" />
        <SeverityCard label="TOTAL_RESOLVED" count={142} color="green" />
      </div>

      <div className="bg-[#0a0f1c] border border-gray-800 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-gray-800 bg-[#0d1323] flex items-center justify-between">
          <h3 className="text-xs font-bold text-white font-mono uppercase tracking-widest">Active_Threat_Feed</h3>
        </div>
        <div className="divide-y divide-gray-800">
          {incidents.length === 0 ? (
            <div className="p-12 flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mb-4">
                <SafeIcon name="ShieldCheck" className="text-2xl text-green-400" />
              </div>
              <h3 className="text-sm font-bold text-white mb-2">Secure</h3>
              <p className="text-xs text-gray-500 font-mono">No active security threat vectors detected</p>
            </div>
          ) : incidents.map((inc, idx) => (
            <motion.div 
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.1 }}
              key={inc.id} 
              className="p-6 flex items-center justify-between hover:bg-gray-800/10 transition-all"
            >
              <div className="flex items-center gap-6">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center border ${
                  inc.severity === 'CRITICAL' ? 'bg-red-500/10 border-red-500/30 text-red-400' : 'bg-orange-500/10 border-orange-500/30 text-orange-400'
                }`}>
                  <SafeIcon name="AlertTriangle" className="text-xl" />
                </div>
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-sm font-bold text-white">{inc.type}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      inc.severity === 'CRITICAL' ? 'bg-red-500 text-white' : 'bg-orange-500 text-white'
                    }`}>{inc.severity}</span>
                  </div>
                  <p className="text-xs text-gray-500 font-mono">
                    TARGET: <span className="text-gray-300">{inc.target}</span> • PATH: <span className="text-blue-400">{inc.path}</span>
                  </p>
                </div>
              </div>
              
              <div className="flex items-center gap-6">
                <div className="text-right">
                  <p className="text-xs text-white font-mono">{inc.time}</p>
                  <p className="text-[10px] text-gray-500 uppercase tracking-tighter">{inc.status}</p>
                </div>
                <button 
                  onClick={() => handleAutoPatch(inc)}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-all shadow-lg shadow-blue-600/20"
                >
                  Trigger Swarm
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
};

const SeverityCard = ({ label, count, color }) => (
  <div className={`bg-[#0a0f1c] border border-gray-800 rounded-xl p-5 relative overflow-hidden`}>
    <div className={`absolute top-0 right-0 w-24 h-24 bg-${color}-500/5 blur-3xl rounded-full`}></div>
    <p className="text-[10px] text-gray-500 font-mono mb-2 uppercase tracking-widest">{label}</p>
    <p className={`text-3xl font-bold text-${color}-400`}>{count}</p>
  </div>
);

export default SecOps;