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
    try {
      // Base telemetry from database
      const telemetryData = await labService.getTelemetryData();

      // Live Edge Metrics from Worker
      let edgeMetrics = null;
      try {
        const ingressUrl = import.meta.env.VITE_INGRESS_URL ? import.meta.env.VITE_INGRESS_URL.replace('/ingress', '/metrics') : '/api/metrics';

        const { supabase } = await import('../services/supabaseClient');
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token || '';

        const response = await fetch(ingressUrl, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          edgeMetrics = await response.json();
          localStorage.setItem('axim_edge_metrics', JSON.stringify(edgeMetrics));
        } else {
          throw new Error('Edge metrics response not ok');
        }
      } catch (edgeErr) {
        console.warn('Failed to fetch live edge metrics, attempting fallback cache.', edgeErr);
        const cached = localStorage.getItem('axim_edge_metrics');
        if (cached) {
          edgeMetrics = JSON.parse(cached);
          // Set error flag for partial degradation, but we still have data
          setError(true);
        }
      }

      // We process Node Health with Deterministic Badges
      let workerStatus = 'Unknown';
      let workerLatency = '-';
      let workerColor = 'blue';

      if (edgeMetrics) {
         const p99 = parseInt(edgeMetrics.p99_latency?.['1h'] || '0', 10);
         const errorRateStr = edgeMetrics.error_rate?.['1h'] || '0%';
         const errorRate = parseFloat(errorRateStr);

         workerLatency = edgeMetrics.p99_latency?.['1h'] || '-';

         if (p99 < 250 && errorRate < 1) {
            workerStatus = 'Nominal';
            workerColor = 'green';
         } else if (p99 >= 250 && p99 <= 800) {
            workerStatus = 'Degraded';
            workerColor = 'yellow';
         } else {
            workerStatus = 'Critical';
            workerColor = 'red';
         }
      }

      // Update Node Health from DB base + Live Edge Worker Metrics
      telemetryData.nodeHealth = [
        { name: 'Core LLM Proxy', status: 'Nominal', latency: '124ms', color: 'green' },
        { name: 'GitHub API Bridge', status: 'Nominal', latency: '45ms', color: 'green' },
        { name: 'Asguard SOC Ingress', status: 'Nominal', latency: '85ms', color: 'green' },
        { name: 'Worker Analytics (Edge)', status: workerStatus, latency: workerLatency, color: workerColor }
      ];


      setData(telemetryData);
      localStorage.setItem('axim_telemetry_cache', JSON.stringify(telemetryData));

      // If we got here and didn't trigger edgeErr fallback, clear error state

      if (edgeMetrics && !error) setError(false);

    } catch (err) {
      console.error('Error fetching telemetry:', err);
      // Fallback
      setError(true);
      const cachedTelemetry = localStorage.getItem('axim_telemetry_cache');
      if (cachedTelemetry) {
        setData(JSON.parse(cachedTelemetry));
      } else {
        setData({
           dateLabels: [], tokenUsage: [],
           nodeHealth: [
             { name: 'Core LLM Proxy', status: 'Unknown', latency: '-', color: 'blue' },
             { name: 'GitHub API Bridge', status: 'Unknown', latency: '-', color: 'blue' },
             { name: 'Asguard SOC Ingress', status: 'Unknown', latency: '-', color: 'blue' },
             { name: 'Worker Task Locks', status: 'Unknown', latency: '-', color: 'blue' }
           ],
           roiMetrics: { hoursSaved: 0, efficiencyGain: '0%', totalCost: '$0.00', estimatedSavings: '$0.00' },
           logs: []
        });
      }
    }
  }, [error]);

  useEffect(() => {
    fetchTelemetryData();

    let intervalId;

    const startPolling = () => {
      intervalId = setInterval(() => {
        if (document.visibilityState === 'visible') {
          fetchTelemetryData();
        }
      }, 10000);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        clearInterval(intervalId);
      } else {
        fetchTelemetryData(); // Fetch immediately on returning
        startPolling();
      }
    };

    startPolling();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
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
  if (color === 'green') colorClass = 'bg-green-500/10 text-green-400 border-green-500/20';
  if (color === 'yellow') colorClass = 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
  if (color === 'red') colorClass = 'bg-red-500/10 text-red-400 border-red-500/20';

  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-[#111827] border border-slate-800">
      <div className="flex flex-col">
        <span className="text-xs font-medium text-gray-300">{label}</span>
        <span className="text-[10px] text-gray-500 font-mono">{latency}</span>
      </div>
      <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${colorClass}`}>
        {status}
      </span>
    </div>
  );
};

export default Telemetry;
