import React, { useEffect, useState, useRef, useCallback } from 'react';
import SafeIcon from '@/common/SafeIcon';
import { labService } from '../services/labService';

const SwarmLogConsole = () => {
  const [logs, setLogs] = useState([]);
  const scrollRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    }
  }, []);

  useEffect(() => {
    setLogs(labService.getSystemLogs());
    
    const unsubscribe = labService.subscribe((event) => {
      if (event.type === 'LOG_ADDED') {
        setLogs(prev => {
          const updatedLogs = [...prev, event.log];
          // Keep strictly the last 150 logs to prevent memory leaks
          return updatedLogs.slice(-150);
        });
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [logs, scrollToBottom]);

  return (
    <div className="bg-[#030712] border border-gray-800 rounded-lg h-full flex flex-col font-mono text-[11px] overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-800 bg-[#0a0f1c] flex items-center justify-between shrink-0">
        <span className="text-gray-400 flex items-center gap-2">
          <SafeIcon name="Cpu" className="text-blue-500 animate-pulse" />
          SYSTEM_KERNEL_LOGS
        </span>
        <div className="flex gap-1">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 p-3 overflow-y-auto terminal-scroll space-y-1">
        {logs.map(log => (
          <div key={log.id} className="flex gap-2">
            <span className="text-gray-600 select-none">[{log.time}]</span>
            <span className={`
              ${log.text.includes('[LLM]') ? 'text-purple-400' : 
                log.text.includes('[GITOPS]') ? 'text-blue-400' : 
                log.text.includes('[INGRESS]') ? 'text-green-400' :
                'text-gray-400'}
            `}>
              {log.text}
            </span>
          </div>
        ))}
        {logs.length === 0 && <span className="text-gray-700 italic">No events recorded in current cycle.</span>}
        <div className="inline-block w-2 h-4 bg-blue-500 animate-pulse align-middle ml-1"></div>
      </div>
    </div>
  );
};

export default SwarmLogConsole;
