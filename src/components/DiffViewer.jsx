import React from 'react';
import { motion } from 'framer-motion';
import SafeIcon from '@/common/SafeIcon';

const DiffViewer = ({ diff, filePath, taskId }) => {
  const lines = (diff || '').split('\n');
  
  return (
    <div className="bg-[#0a0f1c] border border-gray-800 rounded-xl overflow-hidden flex flex-col h-full">
      <div className="h-10 border-b border-gray-800 bg-[#0d1323] flex items-center px-4 shrink-0">
        <div className="flex items-center gap-3">
          <SafeIcon name="FileText" className="text-gray-400 text-xs" />
          <span className="text-[11px] font-mono text-gray-400">{filePath}</span>
        </div>
      </div>
      <div className="flex-1 p-4 overflow-y-auto terminal-scroll bg-[#030712] text-[12px] font-mono leading-relaxed">
        {lines.map((line, idx) => {
          let lineClass = "text-gray-400";
          let bgClass = "hover:bg-gray-800/30";
          
          if (line.startsWith('+')) {
            lineClass = "text-green-400";
            bgClass = "bg-green-500/5 border-l-2 border-green-500/50";
          } else if (line.startsWith('-')) {
            lineClass = "text-red-400";
            bgClass = "bg-red-500/5 border-l-2 border-red-500/50";
          } else if (line.startsWith('@@')) {
            lineClass = "text-blue-400/70 bg-blue-500/5";
            bgClass = "";
          }

          return (
            <div key={idx} className={`flex px-2 py-0.5 group ${bgClass}`}>
              <span className="w-8 flex-shrink-0 text-gray-700 select-none text-right pr-4 border-r border-gray-800/30 mr-4">
                {idx + 1}
              </span>
              <span className={`whitespace-pre ${lineClass}`}>{line}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DiffViewer;