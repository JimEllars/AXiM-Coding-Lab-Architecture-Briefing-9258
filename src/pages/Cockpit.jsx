import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import PromptTerminal from '../components/PromptTerminal';
import PipelineMonitor from '../components/PipelineMonitor';
import SwarmLogConsole from '../components/SwarmLogConsole';
import SafeIcon from '@/common/SafeIcon';
import { labService } from '../services/labService';

const Cockpit = () => {
  const [activeNodes, setActiveNodes] = useState(0);
  const [totalNodes, setTotalNodes] = useState(8);
  const [supportTickets, setSupportTickets] = useState([]);

  useEffect(() => {
    const fetchNodes = async () => {
      const agents = await labService.getAgents();
      if (agents) {
        setTotalNodes(agents.length || 8);
        setActiveNodes(agents.filter(a => a.status === 'Active').length || 0);
      }
    };
    const fetchTickets = async () => {
      try {
        const tasks = await labService.getTasks();
        const filtered = (tasks || []).filter(task =>
          task.origin_source === 'axim-support-system' ||
          task.origin_source === 'Onyx_Support_Triage' ||
          (task.id && task.id.startsWith('SUP-')) ||
          task.ticketId
        );
        setSupportTickets(filtered);
      } catch (err) {
        console.error("Failed to fetch tickets", err);
      }
    };
    fetchNodes();
    fetchTickets();
  }, []);

  const location = useLocation();
  const state = location.state;

  const [isPatching, setIsPatching] = useState(false);
  const [patchStatus, setPatchStatus] = useState('UNRESOLVED');

  const handleAutoPatch = async () => {
    if (isPatching) return; // Prevent double dispatch
    setIsPatching(true);
    setPatchStatus('PATCHING');
    try {
      await labService.triggerTask({
        repository_name: 'axim-core-api',
        target_file_path: 'auth_api/v2/login.js',
        instruction_prompt: "CRITICAL HOTFIX: Sanitize inbound parameters across the query generation matrix and secure identified polymorphic injection vectors.",
        origin_source: 'Asguard_WAF'
      });
      console.log("[Asguard] Threat vector patch orchestration successfully handed off to edge worker.");
      setPatchStatus('RESOLVED');
    } catch (err) {
      console.error("[Asguard] Failed to trigger patch orchestration:", err);
      labService.logIncident('Worker rejected compilation - ' + err.message);
      setPatchStatus('UNRESOLVED');
    } finally {
      setIsPatching(false);
    }
  };


  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Autonomous Engineering Node</h1>
          <p className="text-sm text-gray-400 mt-1">AXiM Macro-Ecosystem • Multi-Agent Orchestration</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-mono">
            <SafeIcon name="Cpu" className="animate-pulse" />
            SWARM_READY
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-green-500/10 border border-green-500/20 text-green-400 text-xs font-mono">
            <SafeIcon name="CheckCircle" className="text-sm" />
            SYSTEMS_NOMINAL
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 space-y-6">
          <PromptTerminal 
            initialRepo={state?.repoId} 
            initialPrompt={state?.autoPrompt}
            initialFile={state?.filePath}
          />
          <div className="h-[350px]">
            <SwarmLogConsole />
          </div>
        </div>
        <div className="lg:col-span-4 space-y-6">
          <PipelineMonitor />
          
          <div className="bg-[#111726] border border-slate-800 rounded-xl p-5 mb-6 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-violet-600/5 blur-3xl rounded-full group-hover:bg-violet-600/10 transition-all"></div>
            <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
              <SafeIcon name="LifeBuoy" className="text-violet-400" />
              Incoming Support Tickets
            </h3>
            <div className="space-y-4">
              {supportTickets.length === 0 ? (
                <div className="text-[11px] text-gray-500 italic">No active support remediation tickets in queue.</div>
              ) : (
                supportTickets.map(ticket => (
                  <div key={ticket.id} className="p-3 rounded-lg bg-[#111726] border border-slate-800 text-[11px] text-gray-300">
                    <div className="flex justify-between items-center mb-2">
                       <span className="font-bold text-violet-300">{ticket.ticketId || ticket.id}</span>
                       <span className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-400 font-mono text-[9px]">{ticket.status}</span>
                    </div>
                    <p className="mb-3 truncate">{ticket.instruction_prompt || ticket.description || 'Automated Remediation'}</p>
                    <div className="flex items-center gap-1.5 text-[9px] font-mono text-gray-500 uppercase">
                       <span className={ticket.status === 'Generating' ? 'text-blue-400 font-bold' : ''}>[Received]</span> &rarr;
                       <span className={ticket.status === 'Committing' ? 'text-blue-400 font-bold' : ''}>[Branching]</span> &rarr;
                       <span className={ticket.status === 'Review Gate' ? 'text-purple-400 font-bold' : ''}>[Patching]</span> &rarr;
                       <span className={['MERGED', 'COMPLETED'].includes(ticket.status) ? 'text-green-400 font-bold' : ''}>[Merged]</span>
                    </div>
                    <div className="mt-3 flex gap-2">
                       {ticket.pull_request_url && (
                         <a href={ticket.pull_request_url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline">View PR</a>
                       )}
                       <a href="#" className="text-violet-400 hover:underline">Support Ticket</a>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-[#111726] border border-slate-800 rounded-xl p-5 mb-6">
            <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
              <SafeIcon name="Mail" className="text-blue-400" />
              HITL Comms
            </h3>
            <button
              onClick={async () => {
                try {
                  const workerBase = import.meta.env.VITE_INGRESS_URL ? import.meta.env.VITE_INGRESS_URL.replace('/api/v1/ingress', '') : '';
                  await fetch(`${workerBase}/api/v1/email/test-briefing`, {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'Authorization': `Bearer ${await labService.getValidToken()}`,
                      'X-Axim-Signature': localStorage.getItem('axim_internal_key') || ''
                    }
                  });
                  alert("Test briefing dispatched successfully.");
                } catch (e) {
                  alert("Failed to dispatch test briefing.");
                }
              }}
              className="w-full py-2 bg-[#111726] hover:bg-gray-800 text-gray-300 rounded text-[10px] font-bold uppercase tracking-widest transition-colors border border-slate-800"
            >
              Dispatch Test HITL Executive Briefing
            </button>
          </div>

          <div className="bg-[#111726] border border-slate-800 rounded-xl p-5 relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-32 h-32 bg-orange-600/5 blur-3xl rounded-full group-hover:bg-orange-600/10 transition-all"></div>
            <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
              <SafeIcon name="Shield" className="text-orange-400" />
              Asguard Security Feed
            </h3>
            <div className="space-y-4">
              {patchStatus === 'UNRESOLVED' && (
              <div className="p-3 rounded-lg bg-orange-500/5 border border-orange-500/20 text-[11px] text-orange-200">
                <p className="font-bold mb-1 uppercase tracking-wider flex items-center gap-2">
                  <SafeIcon name="AlertTriangle" />
                  UNRESOLVED
                </p>
                Potential SQL Injection vector identified in <code className="text-white bg-gray-900 px-1 rounded">auth_api/v2/login</code>.
              </div>
              )}
              {patchStatus === 'PATCHING' && (
              <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/30 text-[11px] text-purple-300 relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-purple-400 to-transparent animate-shimmer"></div>
                <p className="font-bold mb-1 uppercase tracking-wider flex items-center gap-2">
                  <SafeIcon name="Loader" className="animate-pulse" />
                  PATCHING...
                </p>
                Swarm active. Security patch deploying to <code className="text-white bg-gray-900 px-1 rounded">auth_api/v2/login</code>.
              </div>
              )}
              {patchStatus === 'RESOLVED' && (
              <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/30 text-[11px] text-green-300 relative overflow-hidden">
                <p className="font-bold mb-1 uppercase tracking-wider flex items-center gap-2">
                  <SafeIcon name="CheckCircle" />
                  RESOLVED
                </p>
                Security patch deployed to <code className="text-white bg-gray-900 px-1 rounded">auth_api/v2/login</code>.
              </div>
              )}
              <button
                onClick={handleAutoPatch}
                disabled={isPatching}
                className="w-full py-2 bg-[#111726] hover:bg-gray-800 text-gray-300 rounded text-[10px] font-bold uppercase tracking-widest transition-colors border border-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPatching ? 'Deploying Remediation Swarm...' : 'Auto-Patch Incident'}
              </button>
            </div>
          </div>

          <div className="bg-[#111726] border border-slate-800 rounded-xl p-5">
            <h3 className="text-sm font-medium text-white mb-4 flex items-center gap-2">
              <SafeIcon name="Zap" className="text-blue-400" />
              Node Topology
            </h3>
            <div className="grid grid-cols-4 gap-2">
              {Array.from({ length: totalNodes }, (_, i) => i + 1).map(i => (
                <div key={i} className={`h-1.5 rounded-full ${i <= activeNodes ? 'bg-blue-500 shadow-[0_0_5px_rgba(59,130,246,0.5)]' : 'bg-gray-800'}`}></div>
              ))}
            </div>
            <p className="text-[10px] text-gray-500 font-mono mt-3 uppercase">{activeNodes}/{totalNodes} Compute Nodes Active</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Cockpit;