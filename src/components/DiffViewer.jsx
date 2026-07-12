import React from 'react';
import { motion } from 'framer-motion';
import SafeIcon from '@/common/SafeIcon';

const diffData = `@@ -12,5 +12,8 @@
 export function processPayload(data) {
   if (!data) return null;
-  const parsed = JSON.parse(data);
-  return parsed.items;
+  try {
+    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
+    return parsed?.items || [];
+  } catch (e) {
+    return [];
+  }
 }`;

const DiffViewer = () => {
  const lines = diffData.split('\n');

  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.6 }}
      className="bg-[#0a0f1c] border border-gray-800 rounded-xl overflow-hidden"
    >
      <div className="h-12 border-b border-gray-800 bg-[#0d1323] flex items-center justify-between px-4">
        <div className="flex items-center gap-3">
          <SafeIcon name="FileText" className="text-gray-400 text-sm" />
          <span className="text-sm font-mono text-gray-300">utils/parser.js</span>
          <span className="text-xs px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">HOTFIX-8A92F1</span>
        </div>
        <div className="flex gap-2">
          <button className="px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-white transition-colors">
            Reject
          </button>
          <button className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-500 text-white rounded transition-colors shadow-[0_0_10px_rgba(22,163,74,0.3)]">
            <SafeIcon name="GitMerge" className="text-[14px]" />
            Merge & Deploy
          </button>
        </div>
      </div>
      
      <div className="p-4 overflow-x-auto terminal-scroll bg-[#030712] text-sm font-mono leading-relaxed">
        {lines.map((line, idx) => {
          let lineClass = "text-gray-300";
          let bgClass = "hover:bg-gray-800/50";
          
          if (line.startsWith('+')) {
            lineClass = "text-green-400";
            bgClass = "bg-green-500/10 border-l-2 border-green-500";
          } else if (line.startsWith('-')) {
            lineClass = "text-red-400";
            bgClass = "bg-red-500/10 border-l-2 border-red-500";
          } else if (line.startsWith('@@')) {
            lineClass = "text-blue-400";
            bgClass = "bg-blue-500/5";
          }

          return (
            <div key={idx} className={`flex px-2 py-0.5 ${bgClass}`}>
              <span className="w-8 flex-shrink-0 text-gray-600 select-none text-right pr-4">{idx + 1}</span>
              <span className={`whitespace-pre ${lineClass}`}>{line}</span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
};

export default DiffViewer;