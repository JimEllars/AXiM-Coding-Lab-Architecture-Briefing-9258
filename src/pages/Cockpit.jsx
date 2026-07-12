import React from 'react';
import { motion } from 'framer-motion';
import PromptTerminal from '../components/PromptTerminal';
import PipelineMonitor from '../components/PipelineMonitor';
import DiffViewer from '../components/DiffViewer';
import SafeIcon from '@/common/SafeIcon';

const StatCard = ({ title, value, icon, trend, color, delay }) => (
  <motion.div 
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.4, delay }}
    className="bg-[#0a0f1c] border border-gray-800 rounded-xl p-5 relative overflow-hidden group"
  >
    <div className={`absolute top-0 left-0 w-1 h-full bg-${color}-500/50 group-hover:bg-${color}-400 transition-colors`}></div>
    <div className="flex justify-between items-start">
      <div>
        <p className="text-gray-400 text-xs font-mono mb-1">{title}</p>
        <h3 className="text-2xl font-bold text-white tracking-tight">{value}</h3>
      </div>
      <div className={`p-2 rounded-lg bg-${color}-500/10 text-${color}-400 border border-${color}-500/20`}>
        <SafeIcon name={icon} className="text-lg" />
      </div>
    </div>
    <div className="mt-4 flex items-center gap-2 text-xs">
      <span className="text-green-400 flex items-center gap-1">
        <SafeIcon name="TrendingUp" /> {trend}
      </span>
      <span className="text-gray-500">vs last 24h</span>
    </div>
  </motion.div>
);

const Cockpit = () => {
  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Autonomous Engineering Node</h1>
          <p className="text-sm text-gray-400 mt-1">AXiM Macro-Ecosystem • No-GCP Perimeter Active</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-mono">
          <SafeIcon name="CheckCircle" className="text-sm" />
          SYSTEMS NOMINAL
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard title="TOKENS BURNED" value="1.24M" icon="Zap" trend="+12.5%" color="blue" delay={0.1} />
        <StatCard title="PULL REQUESTS OPENED" value="48" icon="GitPullRequest" trend="+4" color="purple" delay={0.2} />
        <StatCard title="AVG REMEDIATION TIME" value="1m 14s" icon="Clock" trend="-12s" color="green" delay={0.3} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <PromptTerminal />
        </div>
        <div>
          <PipelineMonitor />
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
          <SafeIcon name="Eye" className="text-blue-400" />
          Pending Human Review
        </h2>
        <DiffViewer />
      </div>
    </div>
  );
};

export default Cockpit;