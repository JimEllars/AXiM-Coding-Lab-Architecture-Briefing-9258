import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { labService } from '../services/labService';
import { supabase } from '../services/supabaseClient';
import SafeIcon from '@/common/SafeIcon';

const AuditLogs = () => {
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    labService.getAuditLogs().then(setLogs);

    const channel = supabase
      .channel('audit-logs-stream')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'coding_tasks_errors' }, payload => {
        setLogs(prev => [{
          id: payload.new.id || Date.now().toString(),
          timestamp: payload.new.created_at || new Date().toISOString(),
          actor: payload.new.component || 'Autonomous Swarm',
          action: payload.new.error_type || 'ERROR',
          target: payload.new.task_id || 'System',
          status: 'FAILED'
        }, ...prev]);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);


  const exportCsv = () => {
    const headers = ['Timestamp', 'Component', 'Action', 'Target', 'Status'];
    const rows = logs.map(log => [
      log.timestamp || '',
      log.actor || 'Autonomous Swarm',
      log.action || '',
      log.target || '',
      log.status || ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(e => e.map(field => `"${String(field).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `axim_audit_log_${new Date().toISOString()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };



  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="mb-8 flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Governance & Audit Logs</h1>
          <p className="text-sm text-gray-400 mt-1">Immutable trace of autonomous swarm interventions</p>
        </div>
        <button
          onClick={exportCsv}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 border border-blue-500/30 rounded-lg text-sm font-medium transition-all"
        >
          <SafeIcon name="Download" /> Export Audit Log (.CSV)
        </button>
      </div>

      <div className="bg-[#0a0f1c] border border-gray-800 rounded-xl overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-[#0d1323] border-b border-gray-800">
              <th className="px-6 py-4 text-[10px] font-mono text-gray-500 uppercase tracking-widest">Timestamp</th>
              <th className="px-6 py-4 text-[10px] font-mono text-gray-500 uppercase tracking-widest">Actor</th>
              <th className="px-6 py-4 text-[10px] font-mono text-gray-500 uppercase tracking-widest">Action</th>
              <th className="px-6 py-4 text-[10px] font-mono text-gray-500 uppercase tracking-widest">Target</th>
              <th className="px-6 py-4 text-[10px] font-mono text-gray-500 uppercase tracking-widest">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800 text-sm">
            {logs.length === 0 ? (
              <tr>
                <td colSpan="5" className="px-6 py-12 text-center text-gray-500 font-mono text-xs">
                  <div className="flex flex-col items-center gap-3">
                    <SafeIcon name="Search" className="text-gray-600 text-2xl" />
                    No system anomalies or audit events recorded
                  </div>
                </td>
              </tr>
            ) : logs.map((log, idx) => (
              <motion.tr 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: idx * 0.05 }}
                key={log.id} 
                className="hover:bg-gray-800/10 transition-colors"
              >
                <td className="px-6 py-4 text-gray-400 font-mono text-xs">{log.timestamp}</td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-blue-600/20 flex items-center justify-center border border-blue-500/30">
                      <SafeIcon name={(log.actor || 'WAF').includes('WAF') ? 'Shield' : 'User'} className="text-[10px] text-blue-400" />
                    </div>
                    <span className="text-white font-medium">{log.actor || 'Autonomous Swarm'}</span>
                  </div>
                </td>
                <td className="px-6 py-4">
                  <span className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-300 font-mono">{log.action}</span>
                </td>
                <td className="px-6 py-4 text-gray-400 font-mono text-xs">{log.target}</td>
                <td className="px-6 py-4">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    log.status === 'SUCCESS' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
                  }`}>
                    {log.status}
                  </span>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AuditLogs;