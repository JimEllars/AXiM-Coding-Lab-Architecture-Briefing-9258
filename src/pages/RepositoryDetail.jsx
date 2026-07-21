import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { labService } from '../services/labService';
import SafeIcon from '@/common/SafeIcon';

const RepositoryDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [repo, setRepo] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileTree, setFileTree] = useState([]);
  const [loadingFiles, setLoadingFiles] = useState(true);

  useEffect(() => {
    labService.getRepositories().then(data => {
      setRepo(data.find(r => r.id === id));
    });

    labService.getTasks().then(tasks => {
      const repoName = id.replace(/^R-/, '');
      const repoTasks = tasks.filter(t => t.repository_name === repoName);

      const filePaths = new Set();
      repoTasks.forEach(t => {
        if (t.target_file_path) {
          filePaths.add(t.target_file_path);
        }
      });

      if (filePaths.size === 0) {
        setFileTree([]);
      } else {
        const defaultHealths = {
          'src/core/auth.ts': { health: 99 },
          'src/api/router.ts': { health: 94 },
          'middleware/logger.ts': { health: 100 },
          'config/security.yaml': { health: 62, warning: true },
          'src/main.ts': { health: 98 },
          'src/utils/crypto.ts': { health: 91 },
          'tests/auth.spec.ts': { health: 88 }
        };

        const finalFiles = Array.from(filePaths).map(path => {
          if (defaultHealths[path]) {
            return { name: path, ...defaultHealths[path] };
          }
          return {
            name: path,
            health: Math.floor(Math.random() * 20) + 80,
            warning: false
          };
        });

        // Ensure default files are also included
        Object.keys(defaultHealths).forEach(path => {
          if (!filePaths.has(path)) {
            finalFiles.push({ name: path, ...defaultHealths[path] });
          }
        });

        setFileTree(finalFiles);
      }
      setLoadingFiles(false);
    });
  }, [id]);

  const handlePatchRequest = () => {
    if (!selectedFile) return;
    navigate('/', { state: { 
      repoId: repo.name, 
      filePath: selectedFile.name,
      autoPrompt: `Refactor ${selectedFile.name} to improve structural integrity and security headers.`
    }});
  };

  if (!repo) return null;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-xs font-mono text-gray-500 mb-2">
        <Link to="/repositories" className="hover:text-blue-400 transition-colors">REPOSITORIES</Link>
        <span>/</span>
        <span className="text-gray-300">{repo.name.toUpperCase()}</span>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        <div className="lg:col-span-8 flex-1 space-y-6">
          <div className="bg-[#0a0f1c] border border-gray-800 rounded-2xl p-8 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-8 opacity-10">
              <SafeIcon name="Github" className="text-9xl rotate-12" />
            </div>
            
            <div className="flex justify-between items-start mb-8 relative z-10">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-gray-800 border border-gray-700 flex items-center justify-center shadow-inner">
                  <SafeIcon name="Github" className="text-3xl text-white" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-white">{repo.name}</h1>
                  <p className="text-sm text-gray-400">{repo.language} • {repo.files} Files • {repo.coverage} Coverage</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button className="px-4 py-2 bg-[#111827] hover:bg-gray-800 text-gray-400 rounded-lg text-xs font-bold transition-all border border-gray-800">
                  Settings
                </button>
                <button className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold transition-all shadow-lg shadow-blue-600/20">
                  Deep Scan
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative z-10">
              <Stat label="HEALTH" value={`${repo.health}%`} color="green" />
              <Stat label="COVERAGE" value={repo.coverage} color="blue" />
              <Stat label="BRANCHES" value={repo.branches} color="purple" />
            </div>
          </div>

          <div className="bg-[#0a0f1c] border border-gray-800 rounded-2xl overflow-hidden flex flex-col h-[500px]">
            <div className="p-4 border-b border-gray-800 bg-[#0d1323] flex items-center justify-between">
              <h3 className="text-xs font-bold text-white font-mono flex items-center gap-2">
                <SafeIcon name="Folder" className="text-blue-500" />
                FILE_TREE_HEALTH
              </h3>
              {selectedFile && (
                <motion.button
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  onClick={handlePatchRequest}
                  className="px-3 py-1 bg-blue-600/10 border border-blue-500/30 text-blue-400 text-[10px] font-bold rounded hover:bg-blue-600/20 transition-all uppercase"
                >
                  Request Swarm Patch
                </motion.button>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-1 terminal-scroll">
              {!loadingFiles && fileTree.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-600 space-y-2">
                  <SafeIcon name="FileMinus" className="text-3xl opacity-20" />
                  <p className="text-xs font-mono uppercase tracking-widest">No active file paths indexed for this repository</p>
                </div>
              ) : (
                fileTree.map(file => (
                  <FileRow
                    key={file.name}
                    name={file.name}
                    health={file.health}
                    warning={file.warning}
                    isSelected={selectedFile?.name === file.name}
                    onSelect={() => setSelectedFile({ name: file.name })}
                  />
                ))
              )}
            </div>
          </div>
        </div>

        <div className="lg:w-80 space-y-6">
          <div className="bg-[#0a0f1c] border border-gray-800 rounded-2xl p-6">
            <h3 className="text-xs font-bold text-white mb-6 uppercase tracking-widest flex items-center gap-2">
              <SafeIcon name="Activity" className="text-blue-400" />
              SWARM_TELEMETRY
            </h3>
            <div className="space-y-6">
              <div className="flex justify-between items-end">
                <div className="space-y-1">
                  <p className="text-[10px] text-gray-500 font-mono">LATENCY</p>
                  <p className="text-lg font-bold text-white">42ms</p>
                </div>
                <div className="w-24 h-8 flex items-end gap-1">
                  {[40, 60, 30, 80, 50, 90, 40].map((h, i) => (
                    <div key={i} className="flex-1 bg-blue-500/20 rounded-t-sm" style={{ height: `${h}%` }}></div>
                  ))}
                </div>
              </div>
              
              <div className="pt-4 border-t border-gray-800 space-y-4">
                <div className="p-3 rounded-lg bg-[#111827] border border-gray-800">
                  <p className="text-[10px] text-gray-500 font-mono mb-1">COMPUTE_NODES</p>
                  <div className="flex gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    <div className="w-2 h-2 rounded-full bg-green-500"></div>
                    <div className="w-2 h-2 rounded-full bg-gray-700"></div>
                  </div>
                </div>
                <button className="w-full py-2 bg-[#111827] hover:bg-gray-800 text-gray-400 text-[10px] font-bold uppercase tracking-widest border border-gray-800 rounded-lg transition-all">
                  Ecosystem View
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

const Stat = ({ label, value, color }) => (
  <div className="bg-[#111827] border border-gray-800 rounded-xl p-4 hover:border-blue-500/20 transition-all">
    <p className="text-[10px] text-gray-500 font-mono mb-1 uppercase tracking-widest">{label}</p>
    <p className={`text-xl font-bold text-${color}-400`}>{value}</p>
  </div>
);

const FileRow = ({ name, health, warning, isSelected, onSelect }) => (
  <div 
    onClick={onSelect}
    className={`flex items-center justify-between p-3 rounded-lg transition-all cursor-pointer border ${
      isSelected ? 'bg-blue-600/10 border-blue-500/40' : 'bg-transparent border-transparent hover:bg-gray-800/30'
    }`}
  >
    <div className="flex items-center gap-3">
      <SafeIcon name={warning ? 'AlertTriangle' : 'File'} className={warning ? 'text-yellow-500' : 'text-gray-500'} />
      <span className={`text-xs font-mono ${isSelected ? 'text-blue-400 font-bold' : 'text-gray-300'}`}>{name}</span>
    </div>
    <div className="flex items-center gap-4">
      <span className={`text-[10px] font-mono ${health > 90 ? 'text-green-500' : health > 70 ? 'text-yellow-500' : 'text-red-500'}`}>
        {health}%
      </span>
      <div className="w-16 h-1 bg-gray-800 rounded-full overflow-hidden">
        <div className={`h-full ${health > 90 ? 'bg-green-500' : health > 70 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${health}%` }}></div>
      </div>
    </div>
  </div>
);

export default RepositoryDetail;
