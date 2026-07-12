import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import SafeIcon from '@/common/SafeIcon';

const CommandPalette = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        isOpen ? onClose() : null;
      }
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const commands = [
    { icon: 'Terminal', label: 'Go to Dev Cockpit', path: '/', shortcut: 'G C' },
    { icon: 'GitPullRequest', label: 'Review Active PRs', path: '/prs', shortcut: 'G P' },
    { icon: 'Database', label: 'Explore Repositories', path: '/repositories', shortcut: 'G R' },
    { icon: 'Shield', label: 'SecOps Center', path: '/secops', shortcut: 'G S' },
    { icon: 'Target', label: 'Ecosystem Topology', path: '/topology', shortcut: 'G T' },
    { icon: 'Activity', label: 'Swarm Telemetry', path: '/telemetry', shortcut: 'G L' },
    { icon: 'Settings', label: 'System Settings', path: '/settings', shortcut: 'G O' },
  ].filter(c => c.label.toLowerCase().includes(query.toLowerCase()));

  const handleSelect = (path) => {
    navigate(path);
    onClose();
    setQuery('');
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4">
      <motion.div 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        exit={{ opacity: 0 }} 
        onClick={onClose} 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm" 
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: -20 }} 
        animate={{ opacity: 1, scale: 1, y: 0 }} 
        exit={{ opacity: 0, scale: 0.95, y: -20 }} 
        className="w-full max-w-xl bg-[#0d1323] border border-gray-800 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden relative z-10"
      >
        <div className="p-4 border-b border-gray-800 flex items-center gap-3">
          <SafeIcon name="Search" className="text-gray-500" />
          <input 
            autoFocus 
            value={query} 
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands, repositories, or tasks..." 
            className="flex-1 bg-transparent border-none outline-none text-white text-sm" 
          />
          <span className="text-[10px] text-gray-500 font-mono bg-gray-800 px-1.5 py-0.5 rounded">ESC</span>
        </div>
        <div className="max-h-[300px] overflow-y-auto p-2">
          {commands.map((cmd, idx) => (
            <button 
              key={idx} 
              onClick={() => handleSelect(cmd.path)}
              className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-blue-600/10 group transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gray-800 group-hover:bg-blue-600/20 group-hover:text-blue-400 transition-colors">
                  <SafeIcon name={cmd.icon} />
                </div>
                <span className="text-sm text-gray-300 group-hover:text-white">{cmd.label}</span>
              </div>
              <span className="text-[10px] font-mono text-gray-600 group-hover:text-blue-400/60">{cmd.shortcut}</span>
            </button>
          ))}
          {commands.length === 0 && (
            <div className="p-8 text-center text-gray-500 text-sm font-mono uppercase tracking-widest">
              No results found
            </div>
          )}
        </div>
        <div className="p-3 bg-[#0a0f1c] border-t border-gray-800 flex items-center justify-center gap-6">
          <div className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-[9px] text-gray-400">↑↓</kbd>
            <span className="text-[10px] text-gray-500">Navigate</span>
          </div>
          <div className="flex items-center gap-1.5">
            <kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-[9px] text-gray-400">↵</kbd>
            <span className="text-[10px] text-gray-500">Select</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default CommandPalette;