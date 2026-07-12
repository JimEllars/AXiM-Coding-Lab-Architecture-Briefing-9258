import React, { useState } from 'react';
import { motion } from 'framer-motion';
import SafeIcon from '@/common/SafeIcon';

const Settings = () => {
  const [model, setModel] = useState('deepseek-coder');
  const [temp, setTemp] = useState(0.2);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white tracking-tight">System Configuration</h1>
        <p className="text-sm text-gray-400 mt-1">Global parameters for autonomous cognitive routing</p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* Cognitive Model Routing */}
        <section className="bg-[#0a0f1c] border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-800 bg-[#0d1323]">
            <h3 className="text-sm font-medium text-white flex items-center gap-2">
              <SafeIcon name="Cpu" className="text-purple-400" />
              Cognitive Engine
            </h3>
          </div>
          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-mono text-gray-500 uppercase tracking-widest">Active Model</label>
                <select 
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full bg-[#111827] border border-gray-700 rounded-lg px-4 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
                >
                  <option value="deepseek-coder">DeepSeek Coder V2 (Optimized)</option>
                  <option value="gpt-4o">GPT-4o (Reasoning Mode)</option>
                  <option value="claude-3-5">Claude 3.5 Sonnet</option>
                </select>
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <label className="text-xs font-mono text-gray-500 uppercase tracking-widest">Temperature</label>
                  <span className="text-xs font-mono text-blue-400">{temp}</span>
                </div>
                <input 
                  type="range" min="0" max="1" step="0.1" 
                  value={temp} 
                  onChange={(e) => setTemp(parseFloat(e.target.value))}
                  className="w-full accent-blue-500"
                />
              </div>
            </div>
          </div>
        </section>

        {/* GitOps Access */}
        <section className="bg-[#0a0f1c] border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-800 bg-[#0d1323]">
            <h3 className="text-sm font-medium text-white flex items-center gap-2">
              <SafeIcon name="GitBranch" className="text-blue-400" />
              GitOps Infrastructure
            </h3>
          </div>
          <div className="p-6 space-y-4">
            <div className="flex items-center justify-between p-4 rounded-lg bg-[#111827] border border-gray-800">
              <div>
                <h4 className="text-sm font-medium text-white">GitHub Integration</h4>
                <p className="text-xs text-gray-500">Managing access to 14 repositories</p>
              </div>
              <button className="px-4 py-1.5 bg-gray-800 hover:bg-gray-700 text-white rounded text-xs font-medium transition-colors border border-gray-700">
                Refresh Token
              </button>
            </div>
            <div className="flex items-center justify-between p-4 rounded-lg bg-[#111827] border border-gray-800">
              <div>
                <h4 className="text-sm font-medium text-white">Web-Hook Ingress</h4>
                <p className="text-xs text-gray-500">Active endpoint: https://lab.axim.io/hooks</p>
              </div>
              <div className="flex items-center gap-2 px-2 py-1 rounded bg-green-500/10 text-green-400 text-[10px] font-bold">
                <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
                LISTENING
              </div>
            </div>
          </div>
        </section>

        {/* Security / Asguard Connect */}
        <section className="bg-[#0a0f1c] border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-800 bg-[#0d1323]">
            <h3 className="text-sm font-medium text-white flex items-center gap-2">
              <SafeIcon name="Shield" className="text-orange-400" />
              Security Perimeter (Asguard)
            </h3>
          </div>
          <div className="p-6">
            <div className="flex items-center gap-4 mb-6">
              <div className="flex-1">
                <h4 className="text-sm font-medium text-white">Auto-Remediation Gate</h4>
                <p className="text-xs text-gray-500 mt-1">When Asguard detects a threat, trigger the swarm to patch vulnerabilities.</p>
              </div>
              <div className="w-12 h-6 bg-blue-600 rounded-full relative cursor-pointer">
                <div className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full"></div>
              </div>
            </div>
            <div className="p-4 rounded-lg bg-orange-500/5 border border-orange-500/10">
              <p className="text-[11px] text-orange-200 leading-relaxed italic">
                "Autonomous remediation is currently restricted to non-breaking structural changes. Full logic overwrite requires manual PR approval."
              </p>
            </div>
          </div>
        </section>
      </div>

      <div className="flex justify-end gap-4 pt-4">
        <button className="px-6 py-2 text-sm font-medium text-gray-400 hover:text-white transition-colors">Discard Changes</button>
        <button className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium shadow-[0_0_20px_rgba(37,99,235,0.3)] transition-all">
          Save Configuration
        </button>
      </div>
    </div>
  );
};

export default Settings;