import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { labService } from '../services/labService';
import SafeIcon from '@/common/SafeIcon';
import DiffViewer from '../components/DiffViewer';

const PullRequests = () => {
  const [tasks, setTasks] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);
  const [isMerging, setIsMerging] = useState(false);
  const [view, setView] = useState('diff'); // 'diff' | 'discussion'
  const [commentText, setCommentText] = useState('');

  useEffect(() => {
    const fetchTasks = () => labService.getTasks().then(data => {
      setTasks(data);
      if (!selectedTask && data.length > 0) setSelectedTask(data[0]);
      // Update selected task reference if it exists in the new data
      if (selectedTask) {
        const updated = data.find(t => t.id === selectedTask.id);
        if (updated) setSelectedTask(updated);
      }
    });

    fetchTasks();
    return labService.subscribe((event) => {
      if (event.type === 'TASKS_UPDATED') {
        setTasks(event.tasks);
        const current = event.tasks.find(t => t.id === (selectedTask?.id || ''));
        if (current) setSelectedTask(current);
        else if (event.tasks.length > 0) setSelectedTask(event.tasks[0]);
        else setSelectedTask(null);
      }
    });
  }, [selectedTask?.id]);

  const handleMerge = async () => {
    if (!selectedTask) return;
    setIsMerging(true);
    await labService.mergePR(selectedTask.id);
    setIsMerging(false);
  };

  const handleAddComment = async () => {
    if (!commentText.trim() || !selectedTask) return;
    await labService.addComment(selectedTask.id, commentText);
    setCommentText('');
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Active Pull Requests</h1>
          <p className="text-sm text-gray-400 mt-1">Autonomous patches awaiting human validation</p>
        </div>
        <div className="flex items-center gap-2 text-xs font-mono text-gray-500 bg-[#0a0f1c] px-3 py-1.5 border border-gray-800 rounded-full">
          <SafeIcon name="GitPullRequest" />
          <span>{tasks.length} PENDING REVIEW</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[calc(100vh-250px)]">
        {/* Sidebar List */}
        <div className="lg:col-span-1 space-y-3 overflow-y-auto terminal-scroll pr-2">
          {tasks.length === 0 ? (
            <div className="p-8 text-center bg-[#0a0f1c] border border-gray-800 border-dashed rounded-xl">
              <SafeIcon name="CheckCircle" className="mx-auto text-3xl text-gray-700 mb-3" />
              <p className="text-xs text-gray-500 font-mono">NO PENDING PRS</p>
            </div>
          ) : tasks.map((task) => (
            <button
              key={task.id}
              onClick={() => setSelectedTask(task)}
              className={`w-full text-left p-4 rounded-xl border transition-all duration-200 group ${
                selectedTask?.id === task.id 
                  ? 'bg-blue-600/10 border-blue-500/40' 
                  : 'bg-[#0a0f1c] border-gray-800 hover:border-gray-700'
              }`}
            >
              <div className="flex justify-between items-start mb-2 text-xs font-mono">
                <span className="text-blue-400">{task.id}</span>
                <span className="text-gray-600">{task.time}</span>
              </div>
              <h4 className="text-sm font-medium text-white truncate mb-1">{task.file}</h4>
              <div className="flex items-center gap-2 mt-3">
                <span className={`text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase tracking-tighter ${
                  task.status === 'Review Gate' ? 'text-yellow-400 border-yellow-400/20 bg-yellow-400/5' : 'text-blue-400 border-blue-400/20 bg-blue-400/5'
                }`}>
                  {task.status}
                </span>
                <span className="text-[10px] text-gray-500 font-mono truncate">{task.repository}</span>
              </div>
            </button>
          ))}
        </div>

        {/* Detail View */}
        <div className="lg:col-span-3 flex flex-col h-full overflow-hidden">
          {selectedTask ? (
            <div className="space-y-4 flex-1 flex flex-col min-h-0">
              <div className="bg-[#0a0f1c] border border-gray-800 rounded-xl p-4 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded bg-gray-800 flex items-center justify-center border border-gray-700">
                    <SafeIcon name="Cpu" className="text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-white font-medium text-sm">{selectedTask.id} • {selectedTask.origin}</h3>
                    <p className="text-[11px] text-gray-500 font-mono tracking-tighter uppercase">BRANCH: {selectedTask.branch}</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <button 
                    onClick={handleMerge}
                    disabled={isMerging}
                    className="flex items-center gap-2 px-6 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-xs font-bold transition-all shadow-[0_0_15px_rgba(22,163,74,0.3)] disabled:opacity-50"
                  >
                    {isMerging ? <SafeIcon name="Loader" className="animate-spin" /> : <SafeIcon name="GitMerge" />}
                    Merge & Deploy
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 p-1 bg-[#0a0f1c] border border-gray-800 rounded-lg w-fit shrink-0">
                <button 
                  onClick={() => setView('diff')}
                  className={`px-4 py-1.5 rounded text-xs font-medium transition-all ${view === 'diff' ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                >
                  Files Changed
                </button>
                <button 
                  onClick={() => setView('discussion')}
                  className={`px-4 py-1.5 rounded text-xs font-medium transition-all flex items-center gap-2 ${view === 'discussion' ? 'bg-gray-800 text-white' : 'text-gray-500 hover:text-gray-300'}`}
                >
                  Discussion
                  {selectedTask.comments?.length > 0 && (
                    <span className="w-4 h-4 rounded-full bg-blue-600 text-[10px] flex items-center justify-center text-white">
                      {selectedTask.comments.length}
                    </span>
                  )}
                </button>
              </div>
              
              <div className="flex-1 min-h-0 relative">
                <AnimatePresence mode="wait">
                  {view === 'diff' ? (
                    <motion.div 
                      key="diff"
                      initial={{ opacity: 0, x: -10 }} 
                      animate={{ opacity: 1, x: 0 }} 
                      exit={{ opacity: 0, x: 10 }}
                      className="absolute inset-0"
                    >
                      <DiffViewer diff={selectedTask.diff} filePath={selectedTask.file} taskId={selectedTask.id} />
                    </motion.div>
                  ) : (
                    <motion.div 
                      key="discussion"
                      initial={{ opacity: 0, x: 10 }} 
                      animate={{ opacity: 1, x: 0 }} 
                      exit={{ opacity: 0, x: -10 }}
                      className="absolute inset-0 bg-[#0a0f1c] border border-gray-800 rounded-xl overflow-hidden flex flex-col"
                    >
                      <div className="flex-1 overflow-y-auto p-6 space-y-6 terminal-scroll">
                        {selectedTask.comments?.map(comment => (
                          <div key={comment.id} className="flex gap-4">
                            <div className="w-8 h-8 rounded bg-gray-800 border border-gray-700 flex items-center justify-center shrink-0">
                              <SafeIcon name="User" className="text-gray-500 text-xs" />
                            </div>
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-white">{comment.author}</span>
                                <span className="text-[10px] text-gray-600 font-mono">{comment.time}</span>
                              </div>
                              <p className="text-sm text-gray-400 leading-relaxed bg-[#111827] p-3 rounded-lg border border-gray-800">
                                {comment.text}
                              </p>
                            </div>
                          </div>
                        ))}
                        {selectedTask.comments?.length === 0 && (
                          <div className="h-full flex flex-col items-center justify-center text-gray-600 space-y-2">
                            <SafeIcon name="MessageSquare" className="text-3xl opacity-20" />
                            <p className="text-xs font-mono uppercase tracking-widest">No cognitive feedback recorded</p>
                          </div>
                        )}
                      </div>
                      <div className="p-4 border-t border-gray-800 bg-[#0d1323]">
                        <div className="flex gap-2">
                          <input 
                            value={commentText}
                            onChange={(e) => setCommentText(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleAddComment()}
                            placeholder="Add a comment or instruction..."
                            className="flex-1 bg-[#111827] border border-gray-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                          />
                          <button 
                            onClick={handleAddComment}
                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-all"
                          >
                            Comment
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          ) : (
            <div className="flex-1 bg-[#0a0f1c] border border-gray-800 border-dashed rounded-xl flex flex-col items-center justify-center text-gray-500">
              <div className="w-16 h-16 rounded-full bg-gray-900 border border-gray-800 flex items-center justify-center mb-4">
                <SafeIcon name="Inbox" className="text-2xl text-gray-700" />
              </div>
              <p className="text-sm font-mono tracking-widest">SELECT A TASK TO REVIEW PATCH</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PullRequests;