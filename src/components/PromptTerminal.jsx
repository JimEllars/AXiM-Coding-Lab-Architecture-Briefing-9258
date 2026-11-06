import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import SafeIcon from '@/common/SafeIcon';
import { labService } from '../services/labService';
import { FLEET_REGISTRY, RUNTIME_EXPECTED_EXTENSIONS, findRuntimeMismatches, resolveFleetCoordinates } from '../lib/fleetRegistry';

/**
 * Placeholder hints per runtime so the operator types a path the worker's
 * hardware-as-code validators can actually classify (e.g. `model.py` for
 * FreeCAD, `platformio.ini` for firmware projects).
 */
const RUNTIME_FILE_HINTS = {
  'Node.js Edge': 'src/routes/auth.ts, src/utils/helpers.ts',
  'Python Sandbox': 'scripts/etl_pipeline.py',
  'Embedded C++ (ESP32-S3)': 'src/main.ino',
  'PlatformIO Firmware': 'platformio.ini, src/main.cpp',
  'ROS 2 / Python': 'nodes/telemetry_publisher.py',
  'FreeCAD / OpenUSD': 'models/bracket.py',
  'MuJoCo / URDF': 'robot/axim_arm.urdf, robot/scene.mjcf'
};

const PromptTerminal = ({ initialRepo, initialPrompt, initialFiles }) => {
  // ---- State -----------------------------------------------------------------
  // Every hook lives above the first effect that reads it. The previous layout
  // declared `targetRepo`/`targetFiles` *after* the preview effect's dependency
  // array, so the first render threw `ReferenceError: Cannot access
  // 'targetFiles' before initialization` (a temporal dead zone read during
  // render, not a render-phase hook error) and the whole cockpit fell back to
  // the layout ErrorBoundary. `render-smoke.test.jsx` now mounts this component
  // so the ordering cannot regress silently.
  const [prompt, setPrompt] = useState(initialPrompt || sessionStorage.getItem('axim_terminal_prompt') || '');
  const [filePreview, setFilePreview] = useState(null);
  const [fileContent, setFileContent] = useState(null);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [showPreview, setShowPreview] = useState(false);
  const [availableRepos, setAvailableRepos] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [targetRepo, setTargetRepo] = useState(() => {
    const repo = initialRepo || sessionStorage.getItem('axim_terminal_repo') || FLEET_REGISTRY.CORE.repo;
    return repo;
  });
  const [targetFiles, setTargetFiles] = useState(
    initialFiles?.length > 0
      ? initialFiles.join(', ')
      : sessionStorage.getItem('axim_terminal_file') || ''
  );
  const [targetRuntime, setTargetRuntime] = useState('Node.js Edge');
  const [executionEngine, setExecutionEngine] = useState(sessionStorage.getItem('axim_terminal_engine') || 'AXiM Swarm (In-House)');
  const [knowledge, setKnowledge] = useState([]);
  const [selectedContext, setSelectedContext] = useState([]);
  const [warningMessage, setWarningMessage] = useState(null);

  // ---- Derived ---------------------------------------------------------------
  // The cockpit passes `JimEllars/<repo>`; the repo dropdown lists bare repo
  // names. Resolving both through the fleet registry keeps the select bound to
  // an option and keeps the preview pointed at a repository that exists.
  const previewCoordinates = resolveFleetCoordinates(targetRepo);
  const selectedRepoName = previewCoordinates.repo;
  const targetFilePaths = targetFiles.split(',').map((file) => file.trim()).filter(Boolean);
  const runtimeMismatches = findRuntimeMismatches(targetRuntime, targetFilePaths);
  const userRole = localStorage.getItem('axim_user_role') || 'engineer';
  const isSuperUser = userRole === 'super_user';

  // ---- Effects ---------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Cmd/Ctrl + L to clear console
      if ((e.metaKey || e.ctrlKey) && e.key === 'l') {
        e.preventDefault();
        // Since PromptTerminal doesn't own logs, we rely on a custom event or let SwarmLogConsole handle it.
        // We'll dispatch a custom event that SwarmLogConsole can listen to.
        window.dispatchEvent(new CustomEvent('axim-clear-logs'));
      }
      // Cmd/Ctrl + K to focus search - Layout already handles this or we can dispatch
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
         // Should be handled globally, but we can prevent default here if needed
         // e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Debounced file preview fetcher. The owner/repo pair comes from the fleet
  // registry: the old code computed a `repoName` alias from the project key and
  // then never used it, sending `CORE` as both owner and repository, so every
  // preview for a key-selected project requested a repository that does not
  // exist.
  useEffect(() => {
    const primaryFile = targetFilePaths[0];
    if (!primaryFile) {
      setFilePreview(null);
      setPreviewError(null);
      setShowPreview(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsPreviewLoading(true);
      setIsLoadingFile(true);
      setPreviewError(null);
      try {
        const { owner, repo, defaultBranch } = resolveFleetCoordinates(targetRepo);
        const text = await labService.fetchFilePreview(owner, repo, primaryFile, defaultBranch);
        setFileContent(text);
        setIsLoadingFile(false);
        if (text && text.startsWith('Error loading file preview')) {
           setPreviewError(text);
           setFilePreview(null);
        } else {
           setFilePreview(text);
           setShowPreview(true);
        }
      } catch (err) {
        setPreviewError(err.message);
      } finally {
        setIsPreviewLoading(false);
      }
    }, 750); // 750ms debounce

    return () => clearTimeout(timer);
    // `targetFiles` is a string; `targetFilePaths` is derived from it each
    // render, so the string is the correct dependency identity here.
  }, [targetFiles, targetRepo]);

  useEffect(() => {
    labService.getRepositories().then(setAvailableRepos);
  }, []);

  useEffect(() => {
    sessionStorage.setItem('axim_terminal_prompt', prompt);
  }, [prompt]);

  useEffect(() => {
    sessionStorage.setItem('axim_terminal_repo', targetRepo);
  }, [targetRepo]);

  useEffect(() => {
    sessionStorage.setItem('axim_terminal_file', targetFiles);
  }, [targetFiles]);

  useEffect(() => {
    sessionStorage.setItem('axim_terminal_engine', executionEngine);
  }, [executionEngine]);

  useEffect(() => {
    labService.getKnowledge().then(setKnowledge);
    if (initialRepo) {
      // Ensure correct format 'JimEllars/repo-name' is set
      const normalizedRepo = initialRepo;
      setTargetRepo(normalizedRepo);
    }
    if (initialPrompt) setPrompt(initialPrompt);
    if (initialFiles) setTargetFiles(initialFiles.join(', '));
  }, [initialRepo, initialPrompt, initialFiles]);

  const handleDeploy = async () => {
    if (!prompt.trim()) {
      setWarningMessage("Invalid input: Prompt cannot be empty or just whitespace.");
      setTimeout(() => setWarningMessage(null), 3000);
      return;
    }
    setIsGenerating(true);
    try {
      const taskId = `MANUAL-${Math.random().toString(36).substring(7).toUpperCase()}`;
      const prefsStr = localStorage.getItem("axim_lab_preferences");
      const fallbackModel = localStorage.getItem('axim_model');
      let selectedModel = fallbackModel || "deepseek-coder";
      if (prefsStr) {
        try {
          const prefs = JSON.parse(prefsStr);
          if (prefs.model) selectedModel = prefs.model;
        } catch (e) { console.error(e); }
      }
      const payloadBody = JSON.stringify({
        instruction_prompt: prompt,
        repository_name: previewCoordinates.repo,
        project_key: previewCoordinates.repo,
        target_file_paths: targetFilePaths,
        origin_source: 'Manual_Dev_Cockpit',
        contextIds: selectedContext,
        task_id: taskId,
        runtime_env: targetRuntime,
        assigned_model: selectedModel,
        delegate_to_jules: executionEngine === 'Jules Agent (External Google Cloud)'
      });

      await labService.triggerTask(JSON.parse(payloadBody));
      setPrompt('');

    } catch (error) {
      console.error('Failed to trigger task:', error);
      labService.logToConsole({ id: Date.now() + Math.random(), text: '[CRITICAL] Edge Swarm Task Failed: ' + error.message, type: 'system', time: new Date().toLocaleTimeString([], { hour12: false }) });
    } finally {
      setIsGenerating(false);
    }
  };

    const handleAutoMatch = () => {
    setSelectedContext([]);
    const promptLower = prompt.toLowerCase();
    const promptWords = promptLower.split(/\W+/).filter(w => w.length > 2);

    const matchedIds = knowledge.filter(item => {
      const titleLower = item.title.toLowerCase();
      const matchInTitle = promptWords.some(word => titleLower.includes(word));
      const matchInTags = item.tags && item.tags.some(tag => promptWords.some(word => tag.toLowerCase().includes(word)));
      return matchInTitle || matchInTags;
    }).map(item => item.id);

    setSelectedContext(matchedIds);
  };

  const toggleContext = (id) => {
    setSelectedContext(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="bg-[#111827] border border-[#1F2937] rounded-2xl overflow-hidden flex flex-col h-[500px] shadow-[0_20px_50px_rgba(0,0,0,0.5)]"
    >
      <div className="h-12 border-b border-[#1F2937] bg-[#0B0F19] flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500/20 border border-red-500/40"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20 border border-yellow-500/40"></div>
            <div className="w-2.5 h-2.5 rounded-full bg-green-500/20 border border-green-500/40"></div>
          </div>
          <div className="h-4 w-[1px] bg-gray-800 mx-2"></div>
          <span className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">Cognitive_Ingress_v3.2</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-[10px] text-[#FDD023] font-mono">
            <SafeIcon name="Cpu" className="animate-pulse" />
            ONYX_ORCHESTRATOR_ONLINE
          </div>
        </div>
      </div>
      
      <div className="flex-1 flex overflow-hidden">
        {/* Workspace */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex-1 relative">
            <div className="absolute top-4 left-4 pointer-events-none opacity-20">
              <SafeIcon name="Terminal" className="text-6xl text-[#FDD023]" />
            </div>
            {warningMessage && (
              <div className="absolute top-2 right-2 left-2 bg-red-500/10 border border-red-500/50 text-red-400 px-3 py-2 rounded text-xs z-20 font-mono shadow-sm flex items-center gap-2">
                <SafeIcon name="AlertTriangle" className="text-sm" />
                {warningMessage}
              </div>
            )}
            {!isSuperUser && (
              <div className="absolute top-0 left-0 w-full h-full bg-black/40 backdrop-blur-sm z-20 flex items-center justify-center flex-col">
                <SafeIcon name="Lock" className="text-4xl text-yellow-500 mb-2" />
                <span className="text-yellow-500 font-mono text-sm tracking-widest bg-yellow-500/10 px-4 py-2 border border-yellow-500/50 rounded">SUPER USER CLEARANCE REQUIRED</span>
              </div>
            )}
                        {showPreview && filePreview && (
              <div className="absolute top-2 left-2 right-2 bg-[#0B0F19]/90 border border-gray-700 rounded z-30 shadow-lg backdrop-blur-md overflow-hidden flex flex-col" style={{ maxHeight: '200px' }}>
                <div className="flex justify-between items-center p-2 border-b border-gray-700 bg-[#111827]">
                  <span className="text-[10px] text-blue-400 font-mono flex items-center gap-2">
                    <SafeIcon name="File" className="text-xs" /> LIVE PREVIEW: {targetFiles}
                  </span>
                  <button onClick={() => setShowPreview(false)} className="text-gray-500 hover:text-white">
                    <SafeIcon name="X" className="text-xs" />
                  </button>
                </div>
                <div className="p-2 overflow-y-auto text-[10px] font-mono text-gray-300 leading-relaxed terminal-scroll whitespace-pre-wrap">
                  {filePreview.split('\n').slice(0, 20).join('\n')}
                  {filePreview.split('\n').length > 20 && '\n... (truncated)'}
                </div>
              </div>
            )}
            {isPreviewLoading && (
              <div className="absolute top-2 right-2 text-[10px] text-blue-400 font-mono z-30 flex items-center gap-1">
                 <SafeIcon name="Loader" className="animate-spin" /> FETCHING PREVIEW...
              </div>
            )}
            {previewError && targetFiles && !isPreviewLoading && (
              <div className="absolute top-2 right-2 text-[10px] text-red-400 font-mono z-30 flex items-center gap-1 bg-red-900/20 px-2 py-1 rounded">
                 <SafeIcon name="AlertTriangle" /> PREVIEW UNAVAILABLE
              </div>
            )}

            <textarea 
              aria-label="Task prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="// Task: Describe the architectural modification or remediation..." 
              className="w-full h-full bg-transparent text-gray-200 font-mono text-sm p-6 resize-none focus:outline-none placeholder-gray-700 terminal-scroll relative z-10"
              disabled={isGenerating}
              spellCheck="false"
            />
            {fileContent && (
              <div className="bg-gray-900 border-t border-gray-800 p-2 overflow-y-auto" style={{ maxHeight: '200px' }}>
                <pre className="text-[10px] text-gray-300 font-mono whitespace-pre-wrap leading-relaxed">
                  <code>
                    {fileContent.split('\n').slice(0, 20).join('\n')}
                    {fileContent.split('\n').length > 20 && '\n... (truncated)'}
                  </code>
                </pre>
              </div>
            )}
          </div>

          <div className="p-4 border-t border-[#1F2937] bg-[#0B0F19]/30 flex items-center justify-between shrink-0">
            <div className="flex gap-4">
              <div className="space-y-1">
                <label
                  htmlFor="axim-target-repo"
                  className="text-[9px] text-gray-600 font-mono uppercase tracking-tighter"
                >Target Repository</label>
                <select 
                  id="axim-target-repo"
                  value={selectedRepoName}
                  onChange={(e) => setTargetRepo(e.target.value)}
                  className="block w-48 bg-[#111827] border border-gray-700 text-xs text-gray-300 rounded-lg px-3 py-1.5 focus:outline-none font-mono hover:border-gray-600 transition-colors"
                >
                  {/* `selectedRepoName` keeps the select bound to an option when the
                      cockpit hands in a `owner/repo` slug or a project key. */}
                  {availableRepos.map(repo => (
                    <option key={repo.id} value={repo.name}>
                      {repo.name.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="axim-execution-engine"
                  className="text-[9px] text-gray-600 font-mono uppercase tracking-tighter"
                >Execution Engine</label>
                <select
                  id="axim-execution-engine"
                  value={executionEngine}
                  onChange={(e) => setExecutionEngine(e.target.value)}
                  className="block w-40 bg-[#111827] border border-gray-700 text-xs text-gray-300 rounded-lg px-3 py-1.5 focus:outline-none font-mono hover:border-gray-600 transition-colors"
                >
                  <option value="AXiM Swarm (In-House)">AXiM Swarm (In-House)</option>
                  <option value="Jules Agent (External Google Cloud)">Jules Agent (External)</option>
                </select>
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="axim-target-runtime"
                  className="text-[9px] text-gray-600 font-mono uppercase tracking-tighter"
                >Target Runtime</label>
                <select
                  id="axim-target-runtime"
                  value={targetRuntime}
                  onChange={(e) => setTargetRuntime(e.target.value)}
                  className="block w-36 bg-[#111827] border border-gray-700 text-xs text-gray-300 rounded-lg px-3 py-1.5 focus:outline-none font-mono hover:border-gray-600 transition-colors"
                >
                  <option value="Node.js Edge">Node.js Edge</option>
                  <option value="Python Sandbox">Python Sandbox</option>
                  <option value="Embedded C++ (ESP32-S3)">Embedded C++ (ESP32-S3)</option>
                  <option value="PlatformIO Firmware">PlatformIO Firmware</option>
                  <option value="ROS 2 / Python">ROS 2 / Python</option>
                  <option value="FreeCAD / OpenUSD">FreeCAD / OpenUSD</option>
                  <option value="MuJoCo / URDF">MuJoCo / URDF</option>
                </select>
              </div>
              <div className="space-y-1">
                <label
                  htmlFor="axim-target-files"
                  className="text-[9px] text-gray-600 font-mono uppercase tracking-tighter"
                >File Path</label>
                <textarea
                  id="axim-target-files"
                  value={targetFiles}
                  onChange={(e) => setTargetFiles(e.target.value)}
                  placeholder={RUNTIME_FILE_HINTS[targetRuntime] || 'src/routes/auth.ts, src/utils/helpers.ts'}
                  className={`block w-48 bg-[#111827] border text-xs text-gray-300 rounded-lg px-3 py-1.5 focus:outline-none font-mono transition-colors resize-y min-h-[32px] max-h-[100px] ${
                    runtimeMismatches.length > 0 ? 'border-amber-600/70' : 'border-gray-700 hover:border-gray-600'
                  }`}
                />
              </div>
            </div>
            {/* Pre-flight hint. `validateCodeSyntax()` in the worker routes on the
                file extension, so a runtime/path mismatch burns an LLM run and
                then fails [AST_CHECK]. Warn, do not block: the worker stays the
                authority. */}
            {runtimeMismatches.length > 0 && (
              <p className="text-[9px] font-mono text-amber-500/90 max-w-md leading-snug">
                RUNTIME/PATH MISMATCH: {runtimeMismatches.join(', ')} — {targetRuntime} expects{' '}
                {(RUNTIME_EXPECTED_EXTENSIONS[targetRuntime] || []).join(' ') || 'a known extension'}.
              </p>
            )}
            <button 
              onClick={handleDeploy}
              disabled={isGenerating || !prompt.trim() || !isSuperUser}
              className={`px-8 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-3 ${
                isGenerating 
                  ? 'bg-[#FDD023]/10 text-[#FDD023] border border-[#FDD023]/30'
                  : 'bg-[#FDD023] hover:bg-[#FDD023] text-white shadow-[0_0_30px_rgba(37,99,235,0.3)]'
              }`}
            >
              {isGenerating ? <SafeIcon name="Loader" className="animate-spin text-sm" /> : <SafeIcon name="Zap" className="text-sm" />}
              {isGenerating ? 'TRANSMITTING PAYLOAD TO EDGE...' : 'DEPLOY SWARM'}
            </button>
          </div>
        </div>

        {/* Brain Context Sidebar */}
        <div className="w-72 bg-[#0B0F19]/50 border-l border-[#1F2937] flex flex-col shrink-0">
          <div className="p-4 border-b border-[#1F2937] bg-[#111827]/50 flex justify-between items-center">
            <h4 className="text-[10px] text-gray-400 font-mono font-bold uppercase tracking-[0.2em] flex items-center gap-2">
              <SafeIcon name="Book" className="text-[#FDD023]" /> Organizational Brain
            </h4>
            <button onClick={handleAutoMatch} className="text-[10px] font-mono text-blue-400 border border-blue-500/30 px-2 py-1 rounded hover:bg-blue-500/10 transition-colors">
              Auto-Match
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2 terminal-scroll">
            {knowledge.map(item => (
              <button 
                key={item.id}
                onClick={() => toggleContext(item.id)}
                className={`w-full text-left p-3 rounded-xl border transition-all group ${
                  selectedContext.includes(item.id) 
                    ? 'bg-[#FDD023]/10 border-[#FDD023]/40 text-[#FDD023] shadow-[inset_0_0_15px_rgba(37,99,235,0.05)]'
                    : 'bg-[#111827]/50 border-[#1F2937] text-gray-500 hover:border-gray-700 hover:bg-[#111827]'
                }`}
              >
                <div className="flex justify-between items-start mb-1">
                  <p className={`text-[11px] font-bold truncate ${selectedContext.includes(item.id) ? 'text-[#FDD023]' : 'text-gray-400'}`}>
                    {item.title}
                  </p>
                  {selectedContext.includes(item.id) && <SafeIcon name="Check" className="text-[10px]" />}
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[8px] font-mono px-1 rounded ${
                    selectedContext.includes(item.id) ? 'bg-[#FDD023]/20 text-[#FDD023]' : 'bg-gray-800 text-gray-600'
                  }`}>
                    {item.category.toUpperCase()}
                  </span>
                </div>
              </button>
            ))}
          </div>
          <div className="p-3 border-t border-[#1F2937] bg-[#111827]/80">
            <p className="text-[9px] text-gray-600 font-mono text-center">
              {selectedContext.length} Context Nodes Selected
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
};

export default PromptTerminal;