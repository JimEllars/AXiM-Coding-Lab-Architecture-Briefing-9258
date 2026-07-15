import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import SafeIcon from '@/common/SafeIcon';
import { supabase } from '../services/supabaseClient';
import { generateHmacSignature } from '../utils/crypto';

const DiffViewer = ({ diff, filePath, taskId, task }) => {
  const [issubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorToast, setErrorToast] = useState(null);

  const lines = (diff || '').split('\n');


  const handleAction = async (status) => {
    if (!taskId) return;
    setIsSubmitting(true);
    setErrorToast(null);

    // Save previous state for rollback (assuming previous state was 'Review Gate')
    const previousStatus = 'Review Gate';

    try {
      // Optimistic update
      const { error } = await supabase
        .from('coding_tasks')
        .update({ status })
        .eq('id', taskId);

      if (error) throw error;

      if (status === 'APPROVED' || status === 'REJECTED') {
        const ingressUrl = import.meta.env.VITE_INGRESS_URL || '/api/v1/ingress';
        const actionUrl = ingressUrl.replace('/api/v1/ingress', '/api/v1/deploy-action');

        const repoParts = (task?.repository || 'axim-organization/axim-core-api').split('/');
        const owner = repoParts.length > 1 ? repoParts[0] : 'axim-organization';
        const repoName = repoParts.length > 1 ? repoParts[1] : repoParts[0];

        const prNumber = task?.pr_number || parseInt(taskId.replace(/\D/g, '')) || 1;

        const payloadBody = JSON.stringify({
          task_id: taskId,
          pr_number: prNumber,
          repository_owner: owner,
          repository_name: repoName,
          action: status
        });

        const internalKey = import.meta.env.VITE_AXIM_INTERNAL_KEY || 'development-key';
        const signature = await generateHmacSignature(payloadBody, internalKey);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
          const response = await fetch(actionUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Axim-Signature': signature
            },
            body: payloadBody,
            signal: controller.signal
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
             throw new Error(`Failed to trigger deployment action: ${response.statusText}`);
          }
        } catch (fetchError) {
          clearTimeout(timeoutId);
          // Rollback the optimistic UI state
          await supabase.from('coding_tasks').update({ status: previousStatus }).eq('id', taskId);
          throw new Error(fetchError.name === 'AbortError' ? 'Network timeout. Please try again.' : (fetchError.message || 'Transaction failed. Please try again.'));
        }
      }

      setIsSuccess(true);
    } catch (err) {
      setErrorToast(err.message || 'Transaction failed. Please try again.');
      setIsSubmitting(false);
    }
  };


  return (
    <AnimatePresence mode="wait">
      {!isSuccess ? (
        <motion.div
          key="viewer"
          initial={{ opacity: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, filter: 'blur(10px)', transition: { duration: 0.5 } }}
          className="bg-[#0a0f1c] border border-gray-800 rounded-xl overflow-hidden flex flex-col h-full relative"
        >
          {issubmitting && (
            <div className="absolute inset-0 z-50 bg-[#0a0f1c]/50 backdrop-blur-sm flex items-center justify-center">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                className="w-12 h-12 rounded-full border-2 border-blue-500/20 border-t-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.5)]"
              />
            </div>
          )}

          {errorToast && (
            <div className="absolute top-12 left-1/2 -translate-x-1/2 z-40 bg-red-900/90 border border-red-500/50 text-red-200 px-4 py-2 rounded shadow-lg text-xs font-mono flex items-center gap-2">
              <SafeIcon name="AlertCircle" />
              {errorToast}
              <button onClick={() => setErrorToast(null)} className="ml-2 hover:text-white">
                <SafeIcon name="X" />
              </button>
            </div>
          )}

          <div className="h-10 border-b border-gray-800 bg-[#0d1323] flex items-center justify-between px-4 shrink-0">
            <div className="flex items-center gap-3">
              <SafeIcon name="FileText" className="text-gray-400 text-xs" />
              <span className="text-[11px] font-mono text-gray-400">{filePath}</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleAction('REJECTED')}
                disabled={issubmitting}
                className="px-3 py-1 bg-red-600/10 hover:bg-red-600/20 text-red-400 rounded border border-red-600/20 text-[10px] font-bold uppercase transition-colors disabled:opacity-50"
              >
                Reject Patch
              </button>
              <button
                onClick={() => handleAction('APPROVED')}
                disabled={issubmitting}
                className="flex items-center gap-1.5 px-3 py-1 bg-green-600 hover:bg-green-500 text-white rounded text-[10px] font-bold uppercase transition-all shadow-[0_0_10px_rgba(22,163,74,0.2)] disabled:opacity-50"
              >
                <SafeIcon name="GitMerge" className="text-[10px]" />
                Merge & Deploy
              </button>
            </div>
          </div>
          <div className="flex-1 p-4 overflow-y-auto terminal-scroll bg-[#030712] text-[12px] font-mono leading-relaxed">
            {lines.map((line, idx) => {
              let lineClass = "text-gray-400";
              let bgClass = "hover:bg-gray-800/30";

              if (line.startsWith('+')) {
                lineClass = "text-green-400";
                bgClass = "bg-green-500/5 border-l-2 border-green-500/50";
              } else if (line.startsWith('-')) {
                lineClass = "text-red-400";
                bgClass = "bg-red-500/5 border-l-2 border-red-500/50";
              } else if (line.startsWith('@@')) {
                lineClass = "text-blue-400/70 bg-blue-500/5";
                bgClass = "";
              }

              return (
                <div key={idx} className={`flex px-2 py-0.5 group ${bgClass}`}>
                  <span className="w-8 flex-shrink-0 text-gray-700 select-none text-right pr-4 border-r border-gray-800/30 mr-4">
                    {idx + 1}
                  </span>
                  <span className={`whitespace-pre ${lineClass}`}>{line}</span>
                </div>
              );
            })}
          </div>
        </motion.div>
      ) : (
        <motion.div
          key="success"
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex-1 flex flex-col items-center justify-center bg-[#0a0f1c] border border-gray-800 rounded-xl"
        >
          <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center mb-4">
            <SafeIcon name="Check" className="text-3xl text-green-500" />
          </div>
          <h3 className="text-white font-medium mb-1">DEPLOYED</h3>
          <p className="text-xs text-gray-500 font-mono">The state has been stabilized.</p>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default DiffViewer;