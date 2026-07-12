import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { labService } from '../services/labService';
import SafeIcon from '@/common/SafeIcon';

const KnowledgeBase = () => {
  const [knowledge, setKnowledge] = useState([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newNote, setNewNote] = useState({ title: '', content: '', category: 'General' });

  useEffect(() => {
    labService.getKnowledge().then(setKnowledge);
    return labService.subscribe(event => {
      if (event.type === 'KNOWLEDGE_UPDATED') setKnowledge(event.knowledge);
    });
  }, []);

  const handleSave = async () => {
    if (!newNote.title || !newNote.content) return;
    await labService.addNote(newNote);
    setNewNote({ title: '', content: '', category: 'General' });
    setIsAdding(false);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Knowledge Base</h1>
          <p className="text-sm text-gray-400 mt-1">Internal documentation & agent instruction sets</p>
        </div>
        <button 
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-all"
        >
          <SafeIcon name="Plus" /> New Knowledge Node
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <AnimatePresence>
          {isAdding && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-[#0a0f1c] border border-blue-500/30 rounded-2xl p-6 space-y-4"
            >
              <input 
                placeholder="Title..." 
                value={newNote.title}
                onChange={e => setNewNote({...newNote, title: e.target.value})}
                className="w-full bg-[#111827] border border-gray-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
              <select 
                value={newNote.category}
                onChange={e => setNewNote({...newNote, category: e.target.value})}
                className="w-full bg-[#111827] border border-gray-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option>Security</option>
                <option>Infrastructure</option>
                <option>Frontend</option>
                <option>General</option>
              </select>
              <textarea 
                placeholder="Content..." 
                rows={4}
                value={newNote.content}
                onChange={e => setNewNote({...newNote, content: e.target.value})}
                className="w-full bg-[#111827] border border-gray-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500 resize-none"
              />
              <div className="flex gap-2">
                <button onClick={handleSave} className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-xs font-bold">Save Node</button>
                <button onClick={() => setIsAdding(false)} className="flex-1 py-2 bg-gray-800 text-gray-400 rounded-lg text-xs font-bold">Cancel</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {knowledge.map((item, idx) => (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            key={item.id}
            className="bg-[#0a0f1c] border border-gray-800 rounded-2xl p-6 hover:border-gray-700 transition-all group"
          >
            <div className="flex justify-between items-start mb-4">
              <span className="text-[10px] font-mono text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20 uppercase">
                {item.category}
              </span>
              <span className="text-[10px] text-gray-600 font-mono">{item.lastUpdated}</span>
            </div>
            <h3 className="text-lg font-bold text-white mb-2 group-hover:text-blue-400 transition-colors">{item.title}</h3>
            <p className="text-sm text-gray-400 line-clamp-3 mb-6 font-mono leading-relaxed">
              {item.content}
            </p>
            <div className="flex items-center gap-2 text-[10px] text-gray-500">
              <SafeIcon name="User" />
              <span>{item.author}</span>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default KnowledgeBase;