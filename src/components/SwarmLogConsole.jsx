import React, { useEffect, useState, useRef, useCallback } from 'react';
import SafeIcon from '@/common/SafeIcon';
import { labService } from '../services/labService';

const SwarmLogConsole = () => {
  const [logs, setLogs] = useState([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    if (autoScroll && scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTo({
             top: scrollRef.current.scrollHeight,
             behavior: 'smooth'
          });
        }
      });
    }
  }, [autoScroll]);

  useEffect(() => {
    setLogs(labService.getSystemLogs());
    
    // Subscribe to internal UI broadcast


    let logBuffer = [];
    let batchTimeout;
    const unsubscribe = labService.subscribe((event) => {
      if (event.type === 'LOG_ADDED') {
        logBuffer.push(event.log);
        if (batchTimeout) clearTimeout(batchTimeout);
        batchTimeout = setTimeout(() => {
          setLogs(prev => {
            const updatedLogs = [...prev, ...logBuffer];
            logBuffer = [];
            return updatedLogs.slice(-1000); // Increased buffer to 1000 lines
          });
        }, 250);
      }
    });


    // Sub to Supabase Realtime on lab_audit_logs if available, fallback to edge polling
    let edgePollInterval;
    let realtimeChannel;

    import('../services/supabaseClient').then(({ supabase }) => {
      try {
        realtimeChannel = supabase.channel('audit_logs_channel')
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'coding_tasks_errors' }, payload => {
             setLogs(prev => {
                const updatedLogs = [...prev, {
                   id: payload.new.id || Date.now(),
                   text: `[SYSTEM] ${payload.new.message || 'Audit Log Event'}`,
                   type: 'system',
                   time: new Date(payload.new.created_at || Date.now()).toLocaleTimeString([], { hour12: false })
                }];
                return updatedLogs.slice(-1000); // 1000 limit
             });
          })
          .subscribe();


      } catch (err) {
        console.error('Failed to subscribe to realtime, falling back to edge heartbeat:', err);
        edgePollInterval = setInterval(async () => {
           if (document.visibilityState === 'visible') {
             try {
                const logsResp = await labService.getAuditLogs();
                // Mock adding latest log to console if it's new
                // This is a naive polling fallback mechanism
             } catch (e) { /* ignore fallback errors */ }
           }
        }, 15000);
      }
    });

    return () => {
      unsubscribe();
      if (realtimeChannel) {
         import('../services/supabaseClient').then(({ supabase }) => {
            supabase.removeChannel(realtimeChannel);
         });
      }
      if (edgePollInterval) clearInterval(edgePollInterval);
    };
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [logs, scrollToBottom]);

  const handleExport = () => {
    const logText = logs.map(l => `[${l.time}] ${l.text}`).join('\n');
    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'swarm-logs.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-[#030712] border border-gray-800 rounded-lg h-full flex flex-col font-mono text-[11px] overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-800 bg-[#0a0f1c] flex items-center justify-between shrink-0">
        <span className="text-gray-400 flex items-center gap-2">
          <SafeIcon name="Cpu" className="text-blue-500 animate-pulse" />
          SYSTEM_KERNEL_LOGS
        </span>
        <div className="flex gap-3 items-center">
          <button onClick={() => setAutoScroll(!autoScroll)} className={`text-[9px] uppercase font-bold tracking-widest transition-colors flex items-center gap-1 ${autoScroll ? 'text-blue-400' : 'text-gray-500'}`}>
             <SafeIcon name={autoScroll ? "Lock" : "Unlock"} className="text-[10px]" />
             Scroll: {autoScroll ? 'ON' : 'OFF'}
          </button>
          <button onClick={handleExport} className="text-[9px] uppercase text-gray-500 hover:text-gray-300 font-bold tracking-widest transition-colors flex items-center gap-1">
             <SafeIcon name="Download" className="text-[10px]" />
             Export
          </button>
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
        </div>
      </div>
      <div ref={scrollRef} className="flex-1 p-3 overflow-y-auto terminal-scroll space-y-1">
        {logs.map(log => (
          <div key={log.id} className="flex gap-2">
            <span className="text-gray-600 select-none">[{log.time}]</span>
            <span className={`
              ${
                log.text.includes('FORCE_UNLOCKED') || log.text.includes('[BRAIN] New knowledge node') || log.text.includes('[WARN]')
                  ? 'text-orange-400 font-bold bg-orange-500/5 border-l-2 border-orange-500 px-2 rounded-r'
                  : log.text.includes('[Synthesizer]') || log.text.includes('[LLM]') ? 'text-purple-400' :
                log.text.includes('[Validator]') || log.text.includes('[GITOPS]') ? 'text-blue-400' :
                log.text.includes('[SecOps]') || log.text.includes('[INGRESS]') ? 'text-green-400' :
                log.text.includes('[SYSTEM]') && log.text.includes('Reconnecting') ? 'text-yellow-400' :
                log.text.includes('[SYSTEM]') || log.text.includes('[INFO]') ? 'text-gray-400' :
                log.text.includes('[CRITICAL]') ? 'text-red-400 font-bold bg-red-900/50 px-2 rounded' :
                'text-gray-400'}
            `}>
              {log.text}
            </span>
          </div>

        ))}
        {logs.length === 0 && <span className="text-gray-700 italic">No events recorded in current cycle.</span>}
        {<div className="inline-block w-2 h-4 bg-blue-500 animate-pulse align-middle ml-1"></div>}
      </div>
    </div>
  );
};

export default SwarmLogConsole;
