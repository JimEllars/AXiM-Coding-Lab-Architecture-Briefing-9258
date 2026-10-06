import { Env } from './ingress';
import { generateHmacSignature } from './utils/crypto';

export async function dispatchCallbackWebhook(
  system: 'support' | 'asguard',
  payload: any,
  env: Env
): Promise<void> {
  if (!env.AXIM_INTERNAL_KEY) {
    console.error('[CALLBACK] Failed: Missing AXIM_INTERNAL_KEY');
    return;
  }

  const endpoint = system === 'support'
    ? `https://support.axim.us.com/api/v1/tickets/${payload.ticket_id}/patch-status`
    : `https://asguard.axim.us.com/api/v1/triage/resolution`;

  const bodyString = JSON.stringify(payload);
  const signature = await generateHmacSignature(bodyString, env.AXIM_INTERNAL_KEY);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Axim-Signature': signature
      },
      body: bodyString
    });

    if (!response.ok) {
      console.error(`[CALLBACK] Failed to dispatch ${system} webhook: ${response.status} ${response.statusText}`);
    }
  } catch (err: any) {
    console.error(`[CALLBACK] Error dispatching ${system} webhook: ${err.message}`);
  }
}
