import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { labService } from '../services/labService';
import SafeIcon from '@/common/SafeIcon';

const KnowledgeBase = () => {
  const [knowledge, setKnowledge] = useState([]);
  const [isAdding, setIsAdding] = useState(false);
  const [search, setSearch] = useState('');
  const [newNote, setNewNote] = useState({ title: '', content: '', category: 'General', tags: '' });
  const [activeCategory, setActiveCategory] = useState('All');

  useEffect(() => {
    labService.getKnowledge().then(setKnowledge);
    return labService.subscribe(event => {
      if (event.type === 'KNOWLEDGE_UPDATED') setKnowledge(event.knowledge);
    });
  }, []);

  const handleSave = async () => {
    if (!newNote.title || !newNote.content) return;
    await labService.addNote({
      ...newNote,
      tags: newNote.tags.split(',').map(t => t.trim()).filter(t => t)
    });
    setNewNote({ title: '', content: '', category: 'General', tags: '' });
    setIsAdding(false);
  };

  const filtered = knowledge.filter(k => {
    const matchesSearch = search.trim() === '' ||
      k.title.toLowerCase().includes(search.toLowerCase()) ||
      k.content.toLowerCase().includes(search.toLowerCase()) ||
      k.category.toLowerCase().includes(search.toLowerCase()) ||
      (k.tags && k.tags.some(tag => tag.toLowerCase().includes(search.toLowerCase())));

    const matchesCategory = activeCategory === 'All' || k.category === activeCategory;

    return matchesSearch && matchesCategory;
  });

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Organizational Brain</h1>
          <p className="text-sm text-gray-400 mt-1">Shared knowledge nodes fueling the autonomous swarm</p>
        </div>
        <div className="flex gap-3">
          <div className="relative">
            <SafeIcon name="Search" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-xs" />
            <input 
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search knowledge..." 
              className="bg-[#0a0f1c] border border-gray-800 rounded-lg pl-9 pr-4 py-2 text-xs text-white focus:outline-none focus:border-blue-500 w-64"
            />
          </div>
          <button 
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-all shadow-lg shadow-blue-600/20"
          >
            <SafeIcon name="Plus" /> New Node
          </button>
        </div>
      </div>

      <div className="flex gap-2">
        {['All', 'General', 'Security', 'Infrastructure', 'Frontend'].map(cat => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1 text-[10px] font-mono rounded-full border transition-all ${
              activeCategory === cat
                ? 'bg-blue-600/20 border-blue-500 text-blue-400'
                : 'bg-gray-900 border-gray-800 text-gray-500 hover:text-gray-300'
            }`}
          >
            {cat}
          </button>
        ))}
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
              <div className="flex items-center gap-2 text-blue-400 mb-2">
                <SafeIcon name="Plus" />
                <span className="text-xs font-bold uppercase tracking-widest font-mono">Create_Knowledge_Node</span>
              </div>
              <input 
                placeholder="Title (e.g., API Error Handling)" 
                value={newNote.title}
                onChange={e => setNewNote({...newNote, title: e.target.value})}
                className="w-full bg-[#111827] border border-gray-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
              <div className="grid grid-cols-2 gap-3">
                <select 
                  value={newNote.category}
                  onChange={e => setNewNote({...newNote, category: e.target.value})}
                  className="bg-[#111827] border border-gray-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option>Security</option>
                  <option>Infrastructure</option>
                  <option>Frontend</option>
                  <option>General</option>
                </select>
                <input 
                  placeholder="Tags (comma separated)" 
                  value={newNote.tags}
                  onChange={e => setNewNote({...newNote, tags: e.target.value})}
                  className="bg-[#111827] border border-gray-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                />
              </div>
              <textarea 
                placeholder="Contextual content for the swarm..." 
                rows={5}
                value={newNote.content}
                onChange={e => setNewNote({...newNote, content: e.target.value})}
                className="w-full bg-[#111827] border border-gray-700 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 resize-none font-mono"
              />
              <div className="flex gap-3 pt-2">
                <button onClick={handleSave} className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-500 transition-colors">Commit Node</button>
                <button onClick={() => setIsAdding(false)} className="flex-1 py-2.5 bg-gray-800 text-gray-400 rounded-lg text-xs font-bold hover:bg-gray-700 transition-colors">Discard</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {filtered.map((item, idx) => (
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            key={item.id}
            className="bg-[#0a0f1c] border border-gray-800 rounded-2xl p-6 hover:border-blue-500/20 transition-all group relative flex flex-col"
          >
            <div className="flex justify-between items-start mb-4">
              <span className={`text-[10px] font-mono px-2 py-0.5 rounded border uppercase ${
                item.category === 'Security' ? 'text-red-400 border-red-400/20 bg-red-400/5' :
                item.category === 'Frontend' ? 'text-blue-400 border-blue-400/20 bg-blue-400/5' :
                'text-gray-400 border-gray-800 bg-gray-900'
              }`}>
                {item.category}
              </span>
              <span className="text-[10px] text-gray-600 font-mono">{item.lastUpdated}</span>
            </div>
            <h3 className="text-lg font-bold text-white mb-3 group-hover:text-blue-400 transition-colors">{item.title}</h3>
            <p className="text-sm text-gray-400 mb-6 font-mono leading-relaxed line-clamp-4 flex-1">
              {item.content}
            </p>
            <div className="flex flex-wrap gap-1.5 mb-6">
              {item.tags?.map(tag => (
                <span key={tag} className="text-[9px] px-1.5 py-0.5 bg-gray-900 text-gray-500 rounded font-mono border border-gray-800">#{tag}</span>
              ))}
            </div>
            <div className="flex items-center justify-between pt-4 border-t border-gray-800">
              <div className="flex items-center gap-2 text-[10px] text-gray-500">
                <SafeIcon name="User" className="text-xs" />
                <span>{item.author}</span>
              </div>
              <button className="text-xs text-gray-500 hover:text-blue-400 transition-colors">
                <SafeIcon name="Edit" />
              </button>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default KnowledgeBase;