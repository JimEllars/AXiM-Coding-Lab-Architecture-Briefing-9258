import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import SafeIcon from '@/common/SafeIcon';
import { labService } from '../services/labService';

const CognitiveReasoning = () => {
  const [activeTask, setActiveTask] = useState(null);
  const [thoughtChain, setThoughtChain] = useState([]);

  useEffect(() => {
    return labService.subscribe((event) => {
      if (event.type === 'REASONING_START') {
        setActiveTask({ id: event.taskId, prompt: event.prompt });
        setThoughtChain([
          { text: 'Initializing neural context...', status: 'complete' },
          { text: 'Parsing repository AST for structural patterns...', status: 'loading' }
        ]);
        
        // Simulate chain development
        setTimeout(() => updateChain(1, 'complete'), 1000);
        setTimeout(() => addChain('Analyzing security vectors for ReDoS vulnerability...'), 1800);
        setTimeout(() => addChain('Synthesizing remediation patch (DeepSeek-Coder)...'), 2800);
      }
      if (event.type === 'REASONING_END') {
        setTimeout(() => setActiveTask(null), 2000);
      }
    });
  }, []);

  const updateChain = (idx, status) => {
    setThoughtChain(prev => {
      const next = [...prev];
      if (next[idx]) next[idx].status = status;
      return next;
    });
  };

  const addChain = (text) => {
    setThoughtChain(prev => [...prev, { text, status: 'loading' }]);
    setTimeout(() => {
      setThoughtChain(prev => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last) last.status = 'complete';
        return next;
      });
    }, 800);
  };

  return (
    <AnimatePresence>
      {activeTask && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 pointer-events-none"
        >
          <div className="w-full max-w-lg bg-[#0d1323]/90 backdrop-blur-xl border border-blue-500/30 rounded-2xl shadow-[0_0_80px_rgba(37,99,235,0.2)] overflow-hidden pointer-events-auto">
            <div className="p-4 bg-blue-600/10 border-b border-blue-500/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <SafeIcon name="Cpu" className="text-blue-400 animate-pulse" />
                <span className="text-xs font-bold text-white uppercase tracking-widest">Onyx_Cognitive_Reasoning</span>
              </div>
              <span className="text-[10px] font-mono text-blue-400">{activeTask.id}</span>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="space-y-2">
                <p className="text-[10px] text-gray-500 font-mono uppercase">Instruction Ingress</p>
                <p className="text-sm text-gray-300 italic">"{activeTask.prompt}"</p>
              </div>

              <div className="space-y-4">
                <p className="text-[10px] text-gray-500 font-mono uppercase">Thought Chain</p>
                <div className="space-y-3">
                  {thoughtChain.map((thought, idx) => (
                    <motion.div 
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      key={idx} 
                      className="flex items-center gap-3"
                    >
                      {thought.status === 'loading' ? (
                        <div className="w-4 h-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin"></div>
                      ) : (
                        <div className="w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center">
                          <SafeIcon name="Check" className="text-[10px] text-white" />
                        </div>
                      )}
                      <span className={`text-xs font-mono ${thought.status === 'loading' ? 'text-blue-400 animate-pulse' : 'text-gray-400'}`}>
                        {thought.text}
                      </span>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-4 bg-black/40 border-t border-gray-800 flex items-center justify-between">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 opacity-50"></div>
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500 opacity-20"></div>
              </div>
              <span className="text-[9px] font-mono text-gray-500">LLM_GATEWAY: DEEPSEEK-CODER-V2</span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default CognitiveReasoning;