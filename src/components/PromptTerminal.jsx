import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import SafeIcon from '@/common/SafeIcon';
import { labService } from '../services/labService';

const PromptTerminal = ({ initialRepo, initialPrompt, initialFile }) => {
  const [prompt, setPrompt] = useState(initialPrompt || '');
  const [isGenerating, setIsGenerating] = useState(false);
  const [targetRepo, setTargetRepo] = useState(initialRepo || 'axim-core-api');
  const [targetFile, setTargetFile] = useState(initialFile || '');
  const [knowledge, setKnowledge] = useState([]);
  const [selectedContext, setSelectedContext] = useState([]);

  useEffect(() => {
    labService.getKnowledge().then(setKnowledge);
    if (initialRepo) setTargetRepo(initialRepo);
    if (initialPrompt) setPrompt(initialPrompt);
    if (initialFile) setTargetFile(initialFile);
  }, [initialRepo, initialPrompt, initialFile]);

  const handleDeploy = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    try {
      await labService.triggerTask({
        instruction_prompt: prompt,
        repository_name: targetRepo,
        target_file_path: targetFile,
        origin_source: 'Manual_Dev_Cockpit',
        contextIds: selectedContext,
        task_id: `MANUAL-${Math.random().toString(36).substring(7).toUpperCase()}`
      });
      setPrompt('');
      setTargetFile('');
      setSelectedContext([]);
    } catch (error) {
      console.error('Failed to trigger task:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleContext = (id) => {
    setSelectedContext(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-[#0a0f1c] border border-gray-800 rounded-2xl overflow-hidden flex flex-col h-[500px] shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
    >
      <div className="h-12 border-b border-gray-800 bg-[#0d1323] flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/20 border border-red-500/40"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20 border border-yellow-500/40"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/20 border border-green-500/40"></div>
          </div>
          <div className="h-4 w-[1px] bg-gray-800 mx-2"></div>
          <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">Cognitive_Ingress_v3.2</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-[10px] text-blue-400 font-mono">
            <SafeIcon name="Cpu" className="animate-pulse" />
            ONYX_ORCHESTRATOR_ONLINE
          </div>
        </div>
      </div>
      
      <div className="flex-1 flex overflow-hidden">
        {/* Workspace */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 relative">
            <div className="absolute top-4 left-4 pointer-events-none opacity-20">
              <SafeIcon name="Terminal" className="text-6xl text-blue-500" />
            </div>
            <textarea 
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="// Task: Describe the architectural modification or remediation..." 
              className="w-full h-full bg-transparent text-gray-200 font-mono text-sm p-6 resize-none focus:outline-none placeholder-gray-700 terminal-scroll relative z-10"
              spellCheck="false"
            />
          </div>

          <div className="p-4 border-t border-gray-800 bg-[#0d1323]/30 flex items-center justify-between shrink-0">
            <div className="flex gap-4">
              <div className="space-y-1">
                <span className="text-[9px] text-gray-600 font-mono uppercase tracking-tighter">Target Repository</span>
                <select 
                  value={targetRepo}
                  onChange={(e) => setTargetRepo(e.target.value)}
                  className="block w-40 bg-[#111827] border border-gray-700 text-xs text-gray-300 rounded-lg px-3 py-1.5 focus:outline-none font-mono hover:border-gray-600 transition-colors"
                >
                  <option value="axim-core-api">axim-core-api</option>
                  <option value="frontend-dashboard">frontend-dashboard</option>
                  <option value="shared-styles">shared-styles</option>
                </select>
              </div>
              <div className="space-y-1">
                <span className="text-[9px] text-gray-600 font-mono uppercase tracking-tighter">File Path</span>
                <input 
                  value={targetFile}
                  onChange={(e) => setTargetFile(e.target.value)}
                  placeholder="src/routes/auth.ts" 
                  className="block w-48 bg-[#111827] border border-gray-700 text-xs text-gray-300 rounded-lg px-3 py-1.5 focus:outline-none font-mono hover:border-gray-600 transition-colors"
                />
              </div>
            </div>
            <button 
              onClick={handleDeploy}
              disabled={isGenerating || !prompt.trim()}
              className={`px-8 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-3 ${
                isGenerating 
                  ? 'bg-blue-600/10 text-blue-400 border border-blue-500/30' 
                  : 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_30px_rgba(37,99,235,0.3)]'
              }`}
            >
              {isGenerating ? <SafeIcon name="Loader" className="animate-spin text-sm" /> : <SafeIcon name="Zap" className="text-sm" />}
              {isGenerating ? 'INITIATING SWARM...' : 'DEPLOY AGENTS'}
            </button>
          </div>
        </div>

        {/* Brain Context Sidebar */}
        <div className="w-72 bg-[#0d1323]/50 border-l border-gray-800 flex flex-col shrink-0">
          <div className="p-4 border-b border-gray-800 bg-[#0a0f1c]/50">
            <h4 className="text-[10px] text-gray-400 font-mono font-bold uppercase tracking-[0.2em] flex items-center gap-2">
              <SafeIcon name="Book" className="text-blue-500" /> Organizational Brain
            </h4>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 terminal-scroll">
            {knowledge.map(item => (
              <button 
                key={item.id}
                onClick={() => toggleContext(item.id)}
                className={`w-full text-left p-3 rounded-xl border transition-all group ${
                  selectedContext.includes(item.id) 
                    ? 'bg-blue-600/10 border-blue-500/40 text-blue-400 shadow-[inset_0_0_15px_rgba(37,99,235,0.05)]' 
                    : 'bg-[#111827]/50 border-gray-800 text-gray-500 hover:border-gray-700 hover:bg-[#111827]'
                }`}
              >
                <div className="flex justify-between items-start mb-1">
                  <p className={`text-[11px] font-bold truncate ${selectedContext.includes(item.id) ? 'text-blue-400' : 'text-gray-400'}`}>
                    {item.title}
                  </p>
                  {selectedContext.includes(item.id) && <SafeIcon name="Check" className="text-[10px]" />}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[8px] font-mono px-1 rounded ${
                    selectedContext.includes(item.id) ? 'bg-blue-500/20 text-blue-400' : 'bg-gray-800 text-gray-600'
                  }`}>
                    {item.category.toUpperCase()}
                  </span>
                </div>
              </button>
            ))}
          </div>
          <div className="p-3 border-t border-gray-800 bg-[#0a0f1c]/80">
            <p className="text-[9px] text-gray-600 font-mono text-center">
              {selectedContext.length} Context Nodes Selected
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default PromptTerminal;