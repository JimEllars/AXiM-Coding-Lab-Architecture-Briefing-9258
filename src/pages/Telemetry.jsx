import React, { useEffect, useState, useCallback } from 'react';
import ReactECharts from 'echarts-for-react';
import { motion } from 'framer-motion';
import SafeIcon from '@/common/SafeIcon';
import { supabase } from '../services/supabaseClient';
import { labService } from '../services/labService';

const Telemetry = () => {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  const fetchTelemetryData = useCallback(async () => {
    let retries = 0;
    const maxRetries = 3;

    while (retries <= maxRetries) {
      try {
        const telemetryData = await labService.getTelemetryData();
        setData(telemetryData);
        setError(false);
        return;
      } catch (err) {
        console.error('Error fetching telemetry:', err);
        retries++;
        if (retries > maxRetries) {
          setError(true);
          setData({
             tokenUsage: [0, 0, 0, 0, 0, 0, 0],
             roiMetrics: { hoursSaved: 0, efficiencyGain: '0%', totalCost: '$0.00', estimatedSavings: '$0.00' },
             logs: []
          });
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
  }, []);

  useEffect(() => {
    fetchTelemetryData();
  }, [fetchTelemetryData]);

  if (!data) {
    return (
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white">The Green Machine</h1>
            <p className="text-sm text-gray-400 mt-1">Autonomous Ecosystem ROI & Compute Telemetry</p>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-mono">
            <SafeIcon name="Zap" className="text-sm" />
            OPTIMIZED
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[1,2,3,4].map(i => (
            <div key={i} className="bg-[#0a0f1c] border border-gray-800 rounded-xl p-5 animate-pulse h-[104px]">
               <div className="h-6 bg-slate-800/50 rounded w-24 mb-4"></div>
               <div className="h-8 bg-slate-800/50 rounded w-16"></div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-[#0a0f1c] border border-gray-800 rounded-xl p-6 h-[406px] animate-pulse">
             <div className="h-6 bg-slate-800/50 rounded w-48 mb-6"></div>
             <div className="h-[300px] bg-slate-800/50 rounded w-full"></div>
          </div>
          <div className="bg-[#0a0f1c] border border-gray-800 rounded-xl p-6 h-[406px] animate-pulse">
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

  const chartOption = {
    backgroundColor: 'transparent',
    tooltip: { trigger: 'axis' },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: {
      type: 'category',
      data: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
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
      smooth: true,
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
        <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-mono">
          <SafeIcon name="Zap" className="text-sm" />
          OPTIMIZED
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-center gap-3 text-red-400 font-mono text-sm">
          <SafeIcon name="AlertTriangle" className="text-lg" />
          <span>[WARNING] Telemetry synchronization failed. Database cluster may be unreachable. Using fallback zero-state.</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <MetricCard label="DEV HOURS SAVED" value={data.roiMetrics.hoursSaved} icon="Clock" color="blue" />
        <MetricCard label="EFFICIENCY GAIN" value={data.roiMetrics.efficiencyGain} icon="TrendingUp" color="green" />
        <MetricCard label="COMPUTE COST" value={data.roiMetrics.totalCost} icon="DollarSign" color="purple" />
        <MetricCard label="EST. SAVINGS" value={data.roiMetrics.estimatedSavings} icon="Shield" color="blue" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-[#0a0f1c] border border-gray-800 rounded-xl p-6">
          <h3 className="text-sm font-medium text-white mb-6 flex items-center gap-2">
            <SafeIcon name="Activity" className="text-blue-400" />
            Token Expenditure Swarm (7D)
          </h3>
          <ReactECharts option={chartOption} style={{ height: '300px' }} />
        </div>
        <div className="bg-[#0a0f1c] border border-gray-800 rounded-xl p-6">
          <h3 className="text-sm font-medium text-white mb-4">Node Health Status</h3>
          <div className="space-y-4">
            <HealthItem label="Core LLM Proxy" status="Operational" latency="142ms" color="green" />
            <HealthItem label="GitHub API Bridge" status="Nominal" latency="89ms" color="green" />
            <HealthItem label="Asguard SOC Ingress" status="Active" latency="12ms" color="green" />
            <HealthItem label="Worker Task Locks" status="Locked (3)" latency="<1ms" color="blue" />
          </div>
        </div>
      </div>
    </div>
  );
};

const MetricCard = ({ label, value, icon, color }) => (
  <div className="bg-[#0a0f1c] border border-gray-800 rounded-xl p-5">
    <div className="flex items-center gap-3 mb-3">
      <div className={`p-2 rounded bg-${color}-500/10 text-${color}-400`}>
        <SafeIcon name={icon} className="text-lg" />
      </div>
      <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">{label}</span>
    </div>
    <div className="text-2xl font-bold text-white tracking-tight">{value}</div>
  </div>
);

const HealthItem = ({ label, status, latency, color }) => (
  <div className="flex items-center justify-between p-3 rounded-lg bg-[#111827] border border-gray-800">
    <div className="flex flex-col">
      <span className="text-xs font-medium text-gray-300">{label}</span>
      <span className="text-[10px] text-gray-500 font-mono">{latency}</span>
    </div>
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${
      color === 'green' ? 'bg-green-500/10 text-green-400' : 'bg-blue-500/10 text-blue-400'
    }`}>
      {status}
    </span>
  </div>
);

export default Telemetry;
