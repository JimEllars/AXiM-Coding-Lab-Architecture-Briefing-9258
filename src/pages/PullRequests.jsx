import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { labService } from '../services/labService';
import SafeIcon from '@/common/SafeIcon';
import DiffViewer from '../components/DiffViewer';

const PullRequests = () => {
  const [tasks, setTasks] = useState([]);
  const [selectedTask, setSelectedTask] = useState(null);

  useEffect(() => {
    labService.getTasks().then(data => {
      setTasks(data);
      setSelectedTask(data[0]); // Default to first PR
    });
  }, []);

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Active Pull Requests</h1>
        <div className="flex items-center gap-2 text-xs font-mono text-gray-500">
          <SafeIcon name="GitPullRequest" />
          <span>{tasks.filter(t => t.status === 'Review Gate').length} PENDING REVIEW</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 space-y-3">
          {tasks.map((task) => (
            <button
              key={task.id}
              onClick={() => setSelectedTask(task)}
              className={`w-full text-left p-4 rounded-xl border transition-all duration-200 ${
                selectedTask?.id === task.id 
                  ? 'bg-blue-600/10 border-blue-500/40' 
                  : 'bg-[#0a0f1c] border-gray-800 hover:border-gray-700'
              }`}
            >
              <div className="flex justify-between items-start mb-2">
                <span className="text-xs font-mono text-blue-400 group-hover:text-blue-300">
                  {task.id}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                  task.status === 'Review Gate' ? 'text-yellow-400 border-yellow-400/20 bg-yellow-400/5' : 'text-gray-500 border-gray-800 bg-gray-800/20'
                }`}>
                  {task.status}
                </span>
              </div>
              <h4 className="text-sm font-medium text-white truncate mb-1">{task.file}</h4>
              <p className="text-[11px] text-gray-500 font-mono">{task.repository}</p>
            </button>
          ))}
        </div>

        <div className="lg:col-span-3">
          {selectedTask ? (
            <motion.div
              layoutId="diff-panel"
              className="space-y-4"
            >
              <div className="bg-[#0a0f1c] border border-gray-800 rounded-xl p-4 flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded bg-gray-800 flex items-center justify-center">
                    <SafeIcon name="Cpu" className="text-blue-400" />
                  </div>
                  <div>
                    <h3 className="text-white font-medium">{selectedTask.id} • {selectedTask.origin}</h3>
                    <p className="text-xs text-gray-400">Targeting {selectedTask.branch} branch</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500 font-mono">TOKENS: {selectedTask.tokens.toLocaleString()}</p>
                  <p className="text-xs text-green-400 font-mono">COST: ${selectedTask.cost.toFixed(2)}</p>
                </div>
              </div>
              <DiffViewer task={selectedTask} />
            </motion.div>
          ) : (
            <div className="h-[400px] bg-[#0a0f1c] border border-gray-800 border-dashed rounded-xl flex items-center justify-center text-gray-500">
              Select a task to view the code patch
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PullRequests;