cat << 'INNER_EOF' > src/pages/Repositories.jsx
import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { labService } from '../services/labService';
import SafeIcon from '@/common/SafeIcon';

const Repositories = () => {
  const [repos, setRepos] = useState([]);
  const [scanning, setScanning] = useState(null);
  const [isScaffoldModalOpen, setIsScaffoldModalOpen] = useState(false);

  const [scaffoldName, setScaffoldName] = useState('');
  const [scaffoldType, setScaffoldType] = useState('Cloudflare Pages (React PWA)');
  const [scaffoldReqs, setScaffoldReqs] = useState('');
  const [isScaffolding, setIsScaffolding] = useState(false);
  const [scaffoldError, setScaffoldError] = useState('');

  useEffect(() => {
    labService.getRepositories().then(setRepos);

    const handleEvent = (event) => {
      if (event.type === 'TASKS_UPDATED') {
        labService.getRepositories().then(setRepos);
      }
    };

    const unsubscribe = labService.subscribe(handleEvent);
    return () => unsubscribe();
  }, []);

  const handleScan = (e, id) => {
    e.preventDefault();
    e.stopPropagation();
    setScanning(id);
    setTimeout(() => setScanning(null), 3000);
  };

  const handleScaffoldSubmit = async (e) => {
    e.preventDefault();
    if (!scaffoldName.trim() || !scaffoldReqs.trim()) {
      setScaffoldError('Name and requirements are required.');
      return;
    }
    setScaffoldError('');
    setIsScaffolding(true);

    const result = await labService.scaffoldProject({
      name: scaffoldName,
      type: scaffoldType,
      requirements: scaffoldReqs
    });

    setIsScaffolding(false);

    if (result.success) {
      setIsScaffoldModalOpen(false);
      setScaffoldName('');
      setScaffoldReqs('');

      // Optimistic append
      setRepos(prev => [{
        id: `R-${scaffoldName}`,
        name: scaffoldName,
        health: 100,
        activeSwarm: true,
        lastPatch: 'Just now',
        language: scaffoldType.includes('React') ? 'JavaScript' : 'TypeScript',
        coverage: 'N/A',
        files: 0,
        branches: 1,
        dependencies: []
      }, ...prev]);
    } else {
      setScaffoldError(result.error || 'Failed to initialize project.');
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Ecosystem Repositories</h1>
          <p className="text-sm text-gray-400 mt-1">Managed Codebases & Autonomous Swarm Status</p>
        </div>
        <button
          onClick={() => setIsScaffoldModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-all shadow-[0_0_20px_rgba(37,99,235,0.2)]"
        >
          <SafeIcon name="Plus" />
          Connect Repository
        </button>
      </div>

      {repos.length === 0 ? (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-12 flex flex-col items-center justify-center text-center">
          <SafeIcon name="Database" className="text-4xl text-gray-600 mb-4" />
          <h3 className="text-lg font-bold text-white mb-2">No active repositories configured</h3>
          <p className="text-sm text-gray-500 max-w-md">Connect your first repository to begin autonomous swarm operations and codebase management.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {repos.map((repo, idx) => (
          <Link to={`/repositories/${repo.id}`} key={repo.id}>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 hover:border-blue-500/30 transition-all group relative overflow-hidden h-full flex flex-col"
            >
              {scanning === repo.id && (
                <div className="absolute inset-0 bg-blue-600/5 backdrop-blur-[2px] z-10 flex flex-col items-center justify-center space-y-3">
                  <div className="w-12 h-12 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-[10px] font-mono text-blue-400 animate-pulse">DEEP_SCAN_IN_PROGRESS</span>
                </div>
              )}

              <div className="flex justify-between items-start mb-6">
                <div className="p-3 rounded-xl bg-gray-800 group-hover:bg-blue-600/20 group-hover:text-blue-400 transition-all duration-300">
                  <SafeIcon name="Github" className="text-2xl" />
                </div>
                <div className="flex flex-col items-end gap-2 text-right">
                  <div className={`text-[10px] font-bold px-2 py-0.5 rounded ${repo.activeSwarm ? 'bg-blue-500/10 text-blue-400 animate-pulse' : 'bg-gray-800 text-gray-500'}`}>
                    {repo.activeSwarm ? 'SWARM ACTIVE' : 'STANDBY'}
                  </div>
                  <span className="text-[9px] font-mono text-gray-600 uppercase tracking-tighter">{repo.language}</span>
                </div>
              </div>

              <h3 className="text-lg font-bold text-white mb-1 group-hover:text-blue-400 transition-colors">{repo.name}</h3>
              <div className="flex items-center gap-4 text-xs text-gray-500 mb-6">
                <span className="flex items-center gap-1">
                  <SafeIcon name="CheckCircle" className="text-green-500 text-[10px]" />
                  {repo.coverage} Coverage
                </span>
                <span className="text-gray-700">|</span>
                <span>{repo.lastPatch}</span>
              </div>

              <div className="space-y-4 mt-auto">
                <div className="space-y-2">
                  <div className="flex justify-between items-center text-[10px] uppercase font-mono tracking-widest">
                    <span className="text-gray-500">Repository Health Index</span>
                    <span className={repo.health > 90 ? 'text-[#10b981]' : 'text-[#f59e0b]'}>{repo.health}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-gray-800/50 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${repo.health}%` }}
                      transition={{ duration: 1, delay: 0.5 }}
                      className={`h-full rounded-full ${repo.health > 90 ? 'bg-[#10b981]' : 'bg-[#f59e0b]'}`}
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={(e) => handleScan(e, repo.id)}
                    className="flex-1 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors border border-slate-800"
                  >
                    Quick Scan
                  </button>
                </div>
              </div>
            </motion.div>
          </Link>
        ))}
            </div>
      )}

      {/* Scaffolding Modal */}
      <AnimatePresence>
        {isScaffoldModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border border-slate-800 rounded-2xl p-6 w-full max-w-lg shadow-2xl relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-600 to-emerald-500"></div>

              <div className="flex justify-between items-center mb-6">
                <div>
                  <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <SafeIcon name="Rocket" className="text-blue-500" />
                    Initialize Micro-App
                  </h3>
                  <p className="text-sm text-gray-400 mt-1">Deploy a new autonomous repository.</p>
                </div>
                <button
                  onClick={() => setIsScaffoldModalOpen(false)}
                  className="text-gray-500 hover:text-white transition-colors"
                >
                  <SafeIcon name="X" className="text-xl" />
                </button>
              </div>

              {scaffoldError && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-start gap-2 text-red-400 text-sm">
                  <SafeIcon name="AlertTriangle" className="mt-0.5 shrink-0" />
                  <p>{scaffoldError}</p>
                </div>
              )}

              <form onSubmit={handleScaffoldSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Project Name</label>
                  <input
                    type="text"
                    value={scaffoldName}
                    onChange={(e) => setScaffoldName(e.target.value)}
                    placeholder="e.g. axim-auth-service"
                    className="w-full bg-[#111827] border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors"
                    disabled={isScaffolding}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Deployment Target</label>
                  <select
                    value={scaffoldType}
                    onChange={(e) => setScaffoldType(e.target.value)}
                    className="w-full bg-[#111827] border border-gray-700 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition-colors"
                    disabled={isScaffolding}
                  >
                    <option value="Cloudflare Pages (React PWA)">Cloudflare Pages (React PWA)</option>
                    <option value="Cloudflare Worker (API)">Cloudflare Worker (API)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-400 uppercase tracking-wider mb-2">Requirements & Architecture Spec</label>
                  <textarea
                    value={scaffoldReqs}
                    onChange={(e) => setScaffoldReqs(e.target.value)}
                    placeholder="Describe the application features, desired framework configurations, and primary API endpoints..."
                    className="w-full h-32 bg-[#111827] border border-gray-700 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors resize-none text-sm"
                    disabled={isScaffolding}
                  ></textarea>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsScaffoldModalOpen(false)}
                    className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white transition-colors"
                    disabled={isScaffolding}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isScaffolding}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white rounded-lg text-sm font-bold transition-all shadow-[0_0_20px_rgba(37,99,235,0.2)] flex items-center gap-2"
                  >
                    {isScaffolding ? (
                      <>
                        <SafeIcon name="Loader" className="animate-spin" />
                        Initializing...
                      </>
                    ) : (
                      <>
                        Initialize Project
                        <SafeIcon name="ArrowRight" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Repositories;
INNER_EOF
