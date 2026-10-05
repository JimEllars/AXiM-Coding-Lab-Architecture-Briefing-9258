export interface Env {
  AXIM_INTERNAL_KEY: string;
}

export async function dispatchCallbacks(
  task: any,
  prUrl: string,
  branch: string,
  commitSha: string,
  tokensConsumed: number,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  const supportPayload = {
    ticket_id: task.ticketId || task.taskId,
    status: 'PATCH_READY',
    pr_url: prUrl,
    branch: branch,
    commit_sha: commitSha,
    tokens_consumed: tokensConsumed
  };

  const asguardPayload = {
    incident_hash: task.incident_hash || task.taskId,
    status: 'RULE_PR_OPENED',
    pr_url: prUrl,
    branch: branch
  };

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(env.AXIM_INTERNAL_KEY || 'development-key'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signPayload = async (payload: any) => {
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify(payload)));
    return Array.from(new Uint8Array(signature)).map(b => b.toString(16).padStart(2, '0')).join('');
  };

  ctx.waitUntil((async () => {
    try {
      const supportSig = await signPayload(supportPayload);
      await fetch(`https://support.axim.us.com/api/v1/tickets/${supportPayload.ticket_id}/patch-status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Axim-Signature': supportSig
        },
        body: JSON.stringify(supportPayload)
      });
    } catch (e) {
      console.error('Support callback failed:', e);
    }
  })());

  ctx.waitUntil((async () => {
    try {
      const asguardSig = await signPayload(asguardPayload);
      await fetch(`https://asguard.axim.us.com/api/v1/triage/resolution`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Axim-Signature': asguardSig
        },
        body: JSON.stringify(asguardPayload)
      });
    } catch (e) {
      console.error('Asguard callback failed:', e);
    }
  })());
}
