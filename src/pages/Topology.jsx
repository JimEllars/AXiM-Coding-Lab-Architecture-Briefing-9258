import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { labService } from '../services/labService';
import SafeIcon from '@/common/SafeIcon';

const Topology = () => {
  const [repos, setRepos] = useState([]);
  const [selectedNode, setSelectedNode] = useState(null);

  useEffect(() => {
    labService.getRepositories().then(setRepos);
  }, []);

  return (
    <div className="max-w-7xl mx-auto space-y-6 h-[calc(100vh-140px)] flex flex-col">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-white tracking-tight">Ecosystem Topology</h1>
        <p className="text-sm text-gray-400 mt-1">Real-time dependency mapping and swarm distribution</p>
      </div>

      <div className="flex-1 bg-[#0a0f1c] border border-gray-800 rounded-2xl relative overflow-hidden flex">
        {/* Grid Background */}
        <div className="absolute inset-0 opacity-10 pointer-events-none" 
             style={{ backgroundImage: 'radial-gradient(#3b82f6 1px, transparent 1px)', backgroundSize: '30px 30px' }}></div>
        
        {/* Topology View (Simplified SVG Map) */}
        <div className="flex-1 relative flex items-center justify-center">
          <svg className="absolute inset-0 w-full h-full pointer-events-none">
            {repos.map(repo => 
              repo.dependencies.map(depId => {
                const dep = repos.find(r => r.id === depId);
                if (!dep) return null;
                return (
                  <Connection key={`${repo.id}-${depId}`} from={repo.id} to={depId} />
                );
              })
            )}
          </svg>

          <div className="relative z-10 grid grid-cols-2 gap-32">
            {repos.map((repo, idx) => (
              <Node 
                key={repo.id} 
                repo={repo} 
                isSelected={selectedNode?.id === repo.id}
                onClick={() => setSelectedNode(repo)}
              />
            ))}
          </div>
        </div>

        {/* Info Panel */}
        <div className="w-80 border-l border-gray-800 bg-[#0d1323]/50 backdrop-blur-md p-6 overflow-y-auto z-20">
          {selectedNode ? (
            <div className="space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-gray-800 flex items-center justify-center">
                  <SafeIcon name="Database" className="text-blue-400" />
                </div>
                <div>
                  <h3 className="text-white font-bold">{selectedNode.name}</h3>
                  <p className="text-[10px] text-gray-500 font-mono">ID: {selectedNode.id}</p>
                </div>
              </div>

              <div className="space-y-4">
                <Stat label="HEALTH" value={`${selectedNode.health}%`} color="green" />
                <Stat label="SWARM_STATUS" value={selectedNode.activeSwarm ? 'ACTIVE' : 'STANDBY'} color={selectedNode.activeSwarm ? 'blue' : 'gray'} />
                
                <div className="pt-4 border-t border-gray-800">
                  <p className="text-[10px] text-gray-400 font-mono uppercase mb-2">Dependencies</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedNode.dependencies.length > 0 ? selectedNode.dependencies.map(d => (
                      <span key={d} className="px-2 py-1 bg-gray-800 text-gray-300 text-[10px] rounded border border-gray-700">
                        {repos.find(r => r.id === d)?.name}
                      </span>
                    )) : <span className="text-[10px] text-gray-600 italic">None</span>}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-4">
              <SafeIcon name="Target" className="text-4xl text-gray-800" />
              <p className="text-xs text-gray-500 font-mono">SELECT A NODE TO VIEW TOPOLOGY METRICS</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const Node = ({ repo, isSelected, onClick }) => (
  <motion.button
    whileHover={{ scale: 1.05 }}
    onClick={onClick}
    className={`w-48 p-4 rounded-xl border transition-all flex flex-col items-center gap-3 relative z-20 ${
      isSelected ? 'bg-blue-600/10 border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.2)]' : 'bg-[#111827] border-gray-800'
    }`}
  >
    <div className={`w-12 h-12 rounded-full flex items-center justify-center border-2 ${
      repo.activeSwarm ? 'border-blue-500 animate-pulse bg-blue-500/10' : 'border-gray-700 bg-gray-800'
    }`}>
      <SafeIcon name={repo.activeSwarm ? 'Cpu' : 'Database'} className={repo.activeSwarm ? 'text-blue-400' : 'text-gray-500'} />
    </div>
    <span className="text-xs font-bold text-white">{repo.name}</span>
    <div className="w-full h-1 bg-gray-800 rounded-full overflow-hidden">
      <div className={`h-full ${repo.health > 90 ? 'bg-green-500' : 'bg-yellow-500'}`} style={{ width: `${repo.health}%` }}></div>
    </div>
  </motion.button>
);

const Connection = ({ from, to }) => {
  // Mock SVG lines - in a real app these would use ref coordinates
  return (
    <line x1="20%" y1="30%" x2="80%" y2="70%" stroke="#1e293b" strokeWidth="1" strokeDasharray="4" />
  );
};

const Stat = ({ label, value, color }) => (
  <div className="bg-[#111827] p-3 rounded-lg border border-gray-800">
    <p className="text-[9px] text-gray-500 font-mono mb-1 uppercase tracking-widest">{label}</p>
    <p className={`text-sm font-bold text-${color}-400`}>{value}</p>
  </div>
);

export default Topology;