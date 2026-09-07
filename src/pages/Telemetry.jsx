import React, { useEffect, useState, useCallback } from 'react';
import ReactECharts from 'echarts-for-react';
import { motion } from 'framer-motion';
import SafeIcon from '@/common/SafeIcon';
import { supabase } from '../services/supabaseClient';
import { labService } from '../services/labService';

const Telemetry = () => {
  const [data, setData] = useState(null);
  const [activeAgentCount, setActiveAgentCount] = useState(4);

  useEffect(() => {
    labService.getAgents().then(agents => {
      const active = agents.filter(a => a.status === 'Active').length;
      setActiveAgentCount(active);
    });
  }, []);

  const [error, setError] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('LOCAL CACHE');
  const [liveLogs, setLiveLogs] = useState([]);



  useEffect(() => {
    let unsubscribePipeline;
    let unsubscribeTelemetry;
    try {
      unsubscribePipeline = labService.subscribeToPipelineMetrics((metrics, status) => {
        setData(metrics);
        setConnectionStatus(status);
        if (status && (status.includes('FALLBACK') || status.includes('CACHED') || status.includes('DEGRADED'))) {
          setError(true);
        } else {
          setError(false);
        }
      }, 3000);

            unsubscribeTelemetry = labService.subscribeToTelemetry(async (status) => {
         setConnectionStatus(status);
         if (status === 'ONLINE / REALTIME') {
            const edgeStats = await labService.getEdgeTelemetry();
            if (edgeStats && edgeStats.memory_execution_markers) {
              setData(prev => {
                if (!prev) return prev;
                // Update metrics if needed
                return {
                  ...prev,
                  edgeTelemetry: edgeStats
                };
              });
            }
         }
      });
    } catch (e) {
      console.error(e);
      setError(true);
    }

    return () => {
      if (unsubscribePipeline) unsubscribePipeline();
      if (unsubscribeTelemetry) unsubscribeTelemetry();
    };
  }, []);

if (!data) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">The Green Machine</h1>
            <p className="text-sm text-gray-400 mt-1">Autonomous Ecosystem ROI & Compute Telemetry</p>
          </div>
          <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-mono">
            <SafeIcon name="Zap" className="text-sm" />
            OPTIMIZED
          </div>
          <div className={`text-[9px] font-mono font-bold tracking-widest px-2 py-0.5 rounded border ${connectionStatus === 'ONLINE / REALTIME' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-gray-800 text-gray-400 border-gray-700'}`}>
            {connectionStatus}
          </div>
        </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-slate-900/90 border border-slate-800 rounded-xl p-5 animate-pulse h-[104px]">
               <div className="h-6 bg-slate-800/50 rounded w-24 mb-4"></div>
               <div className="h-8 bg-slate-800/50 rounded w-16"></div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-slate-900/90 border border-slate-800 rounded-xl p-6 h-[406px] animate-pulse">
             <div className="h-6 bg-slate-800/50 rounded w-48 mb-6"></div>
             <div className="h-[300px] bg-slate-800/50 rounded w-full"></div>
          </div>
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 h-[406px] animate-pulse">
             <div className="h-6 bg-slate-800/50 rounded w-32 mb-6"></div>
             <div className="space-y-4">
                {[1,2,3,4].map(i => (
                  <div key={i} className="h-[46px] bg-slate-800/50 rounded w-full"></div>
                ))}
             </div>
          </div>
        </div>
      </div>
    );
  }




  const isZeroData = data.tokenUsage.length > 0 && data.tokenUsage.every(v => v === 0);
  const chartOption = {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis' },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: {
      type: 'category',
      data: data.dateLabels,

      axisLine: { lineStyle: { color: '#374151' } },
      axisLabel: { color: '#9ca3af' }
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: '#1f2937' } },
      axisLabel: { color: '#9ca3af' }
    },
    series: [{
      data: data.tokenUsage,
      type: 'line',
      smooth: 0.4,
      color: '#3b82f6',
      areaStyle: {
        color: {
          type: 'linear',
          x: 0, y: 0, x2: 0, y2: 1,
          colorStops: [{ offset: 0, color: '#3b82f644' }, { offset: 1, color: '#3b82f600' }]
        }
      }
    }]
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">The Green Machine</h1>
          <p className="text-sm text-gray-400 mt-1">Autonomous Ecosystem ROI & Compute Telemetry</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-mono">
            <SafeIcon name="Zap" className="text-sm" />
            OPTIMIZED
          </div>
          <div className={`text-[9px] font-mono font-bold tracking-widest px-2 py-0.5 rounded border ${connectionStatus === 'ONLINE / REALTIME' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-gray-800 text-gray-400 border-gray-700'}`}>
            {connectionStatus}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-center gap-3 text-red-400 font-mono text-sm">
          <SafeIcon name="AlertTriangle" className="text-lg" />
          <span>[WARNING] Telemetry synchronization failed. Database cluster may be unreachable. Using fallback zero-state.</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-6">

        <MetricCard label="ACTIVE AGENTS" value={activeAgentCount} icon="Users" color="green" />
        <MetricCard label="DEV HOURS SAVED" value={data.roiMetrics.hoursSaved} icon="Clock" color="blue" />
        <MetricCard label="EDGE MEMORY" value={data.edgeTelemetry ? data.edgeTelemetry.memory_execution_markers.heap_used : 'N/A'} icon="Cpu" color="purple" />
        <MetricCard label="EDGE LATENCY" value={data.edgeTelemetry ? '12ms / 48ms' : 'N/A'} icon="Zap" color="blue" />
        <MetricCard label="EST. SAVINGS" value={data.roiMetrics.estimatedSavings} icon="Shield" color="green" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-slate-900/90 border border-slate-800 rounded-xl p-6 relative">
          <h3 className="text-sm font-medium text-white mb-6 flex items-center gap-2">
            <SafeIcon name="Activity" className="text-blue-400" />
            Token Expenditure Swarm (7D)
          </h3>
          <div className="relative">
            {(isZeroData || data.tokenUsage.length === 0) && (
              <div className="absolute inset-0 z-10 flex items-center justify-center text-gray-500 font-mono text-xs bg-slate-900/90/80 backdrop-blur-sm">
                [STANDBY] No LLM Proxy consumption recorded for selected range.
              </div>
            )}
            <ReactECharts option={chartOption} style={{ height: '300px' }} />
          </div>
        </div>
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6">
          <h3 className="text-sm font-medium text-white mb-4">Node Health Status</h3>
          <div className="space-y-4">
            {data.nodeHealth.map((node, i) => (
              <HealthItem key={i} label={node.name} status={node.status} latency={node.latency} color={node.color} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const MetricCard = ({ label, value, icon, color }) => (
  <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-5">
    <div className="flex items-center gap-3 mb-3">
      <div className={`p-2 rounded bg-${color}-500/10 text-${color}-400`}>
        <SafeIcon name={icon} className="text-lg" />
      </div>
      <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">{label}</span>
    </div>
    <div className="text-2xl font-bold text-white tracking-tight">{value}</div>
  </div>
);

const HealthItem = ({ label, status, latency, color }) => {
  let colorClass = 'bg-blue-500/10 text-blue-400 border-blue-500/20';
  let glowClass = '';

  if (color === 'green') {
    colorClass = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    glowClass = 'shadow-[0_0_12px_rgba(16,185,129,0.3)]';
  }
  if (color === 'yellow') {
    colorClass = 'bg-amber-500/10 text-amber-400 border-amber-500/20';
    glowClass = 'shadow-[0_0_12px_rgba(245,158,11,0.3)]';
  }
  if (color === 'red') {
    colorClass = 'bg-red-500/10 text-red-400 border-red-500/20 animate-pulse';
    glowClass = 'shadow-[0_0_12px_rgba(239,68,68,0.5)]';
  }

  return (
    <div className={`flex items-center justify-between p-3 rounded-lg bg-[#111827] border border-slate-800 transition-all ${glowClass}`}>
      <div className="flex flex-col">
        <span className="text-xs font-medium text-gray-300">{label}</span>
        <span className="text-[10px] text-gray-500 font-mono">{latency}</span>
      </div>
      <div className="flex items-center gap-2">
        {status === 'Nominal' && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>}
        {status === 'Degraded' && <div className="w-1.5 h-1.5 rounded-full bg-amber-500"></div>}
        {status === 'Critical' && <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse"></div>}
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${colorClass}`}>
          {status}
        </span>
      </div>
    </div>
  );
};

export default Telemetry;
