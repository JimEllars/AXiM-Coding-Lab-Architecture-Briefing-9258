import React, { useState } from 'react';
import { motion } from 'framer-motion';
import SafeIcon from '@/common/SafeIcon';
import { labService } from '../services/labService';

const PromptTerminal = () => {
  const [prompt, setPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [targetRepo, setTargetRepo] = useState('axim-core-api');

  const handleDeploy = async () => {
    if (!prompt.trim()) return;
    setIsGenerating(true);
    
    try {
      await labService.triggerTask({
        instruction_prompt: prompt,
        repository_name: targetRepo,
        origin_source: 'Manual_Dev_Cockpit',
        task_id: `MANUAL-${Math.random().toString(36).substring(7).toUpperCase()}`
      });
      setPrompt('');
    } catch (error) {
      console.error('Failed to trigger task:', error);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.4 }}
      className="bg-[#0a0f1c] border border-gray-800 rounded-xl overflow-hidden flex flex-col h-[400px]"
    >
      <div className="h-12 border-b border-gray-800 bg-[#0d1323] flex items-center justify-between px-4">
        <div className="flex items-center gap-2 text-xs font-mono text-gray-400">
          <SafeIcon name="Terminal" className="text-blue-400" />
          <span>Manual Feature Request Injection</span>
        </div>
        <div className="flex gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500/50"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50"></div>
          <div className="w-2.5 h-2.5 rounded-full bg-green-500/50"></div>
        </div>
      </div>
      
      <div className="flex-1 p-4 flex flex-col relative">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="// Describe the feature, bug, or refactor required...
// Example: Add a rate limiting middleware to the auth route."
          className="flex-1 w-full bg-transparent text-gray-200 font-mono text-sm resize-none focus:outline-none placeholder-gray-600 terminal-scroll"
          spellCheck="false"
        />
        
        <div className="flex items-center justify-between mt-4 border-t border-gray-800 pt-4">
          <div className="flex items-center gap-3">
            <select 
              value={targetRepo}
              onChange={(e) => setTargetRepo(e.target.value)}
              className="bg-[#111827] border border-gray-700 text-xs text-gray-300 rounded px-2 py-1.5 focus:outline-none focus:border-blue-500 font-mono"
            >
              <option value="axim-core-api">axim-core-api</option>
              <option value="frontend-dashboard">frontend-dashboard</option>
              <option value="payment-gateway">payment-gateway</option>
            </select>
            <span className="text-gray-600 text-xs font-mono">TARGET_REPO</span>
          </div>
          
          <button
            onClick={handleDeploy}
            disabled={isGenerating || !prompt.trim()}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
              isGenerating 
                ? 'bg-blue-600/20 text-blue-400 cursor-not-allowed border border-blue-500/20'
                : prompt.trim() 
                  ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_15px_rgba(37,99,235,0.4)]'
                  : 'bg-gray-800 text-gray-500 cursor-not-allowed'
            }`}
          >
            {isGenerating ? (
              <>
                <SafeIcon name="Loader" className="animate-spin" />
                Orchestrating...
              </>
            ) : (
              <>
                <SafeIcon name="Zap" />
                Deploy Swarm
              </>
            )}
          </button>
        </div>
      </div>
    </motion.div>
  );
};

export default PromptTerminal;