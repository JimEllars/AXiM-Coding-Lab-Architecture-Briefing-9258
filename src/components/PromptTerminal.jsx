import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
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
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-[#0a0f1c] border border-gray-800 rounded-xl overflow-hidden flex flex-col h-[450px]"
    >
      <div className="h-12 border-b border-gray-800 bg-[#0d1323] flex items-center justify-between px-4">
        <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
          <SafeIcon name="Terminal" className="text-blue-400" />
          <span>Cognitive Engineering Ingress</span>
        </div>
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500/40"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/40"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-green-500/40"></div>
        </div>
      </div>
      
      <div className="flex-1 flex overflow-hidden">
        {/* Main Input */}
        <div className="flex-1 p-4 flex flex-col border-r border-gray-800">
          <textarea 
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="// Describe the feature or remediation required..." 
            className="flex-1 w-full bg-transparent text-gray-200 font-mono text-sm resize-none focus:outline-none placeholder-gray-600 terminal-scroll"
            spellCheck="false"
          />
          <div className="flex items-center justify-between mt-4">
            <div className="flex gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-[9px] text-gray-500 font-mono uppercase">Repository</span>
                <select 
                  value={targetRepo}
                  onChange={(e) => setTargetRepo(e.target.value)}
                  className="bg-[#111827] border border-gray-700 text-xs text-gray-300 rounded px-2 py-1 focus:outline-none font-mono"
                >
                  <option value="axim-core-api">axim-core-api</option>
                  <option value="frontend-dashboard">frontend-dashboard</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[9px] text-gray-500 font-mono uppercase">Target File</span>
                <input 
                  value={targetFile}
                  onChange={(e) => setTargetFile(e.target.value)}
                  placeholder="src/api/..." 
                  className="bg-[#111827] border border-gray-700 text-xs text-gray-300 rounded px-2 py-1 focus:outline-none font-mono w-32"
                />
              </div>
            </div>
            <button 
              onClick={handleDeploy}
              disabled={isGenerating || !prompt.trim()}
              className={`px-6 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${
                isGenerating ? 'bg-blue-600/20 text-blue-400' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20'
              }`}
            >
              {isGenerating ? <SafeIcon name="Loader" className="animate-spin" /> : <SafeIcon name="Zap" />}
              {isGenerating ? 'Orchestrating...' : 'Deploy Swarm'}
            </button>
          </div>
        </div>

        {/* Knowledge Context Sidebar */}
        <div className="w-64 bg-[#0d1323]/50 p-4 overflow-y-auto terminal-scroll">
          <h4 className="text-[10px] text-gray-500 font-mono uppercase tracking-widest mb-4">Inject Knowledge Context</h4>
          <div className="space-y-2">
            {knowledge.map(item => (
              <button 
                key={item.id}
                onClick={() => toggleContext(item.id)}
                className={`w-full text-left p-2 rounded border transition-all ${
                  selectedContext.includes(item.id) 
                    ? 'bg-blue-600/10 border-blue-500/40 text-blue-400' 
                    : 'bg-[#111827] border-gray-800 text-gray-500 hover:border-gray-700'
                }`}
              >
                <p className="text-[10px] font-bold truncate">{item.title}</p>
                <p className="text-[8px] font-mono mt-1 opacity-60">{item.category}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default PromptTerminal;