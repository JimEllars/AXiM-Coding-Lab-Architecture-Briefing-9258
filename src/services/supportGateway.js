import { generateHmacSignature } from '../utils/crypto';
import { supabase } from './supabaseClient';

const supportApiUrl = import.meta.env.VITE_SUPPORT_API_URL || 'https://support.axim.us.com';
const ingressUrl = import.meta.env.VITE_INGRESS_URL || '/api/v1/ingress';

function getDispatchUrl() {
  if (!supportApiUrl) {
    throw new Error('VITE_SUPPORT_API_URL must point to the authenticated AXiM Support API.');
  }
  return `${supportApiUrl.replace(/\/$/, '')}/api/v1/tasks/dispatch`;
}

export async function dispatchSupportTask(payload) {
  if (!payload.assigned_model) {
    const prefsStr = localStorage.getItem("axim_lab_preferences");
    if (prefsStr) {
      try {
        const prefs = JSON.parse(prefsStr);
        if (prefs.model) {
          payload.assigned_model = prefs.model;
        }
      } catch (e) {
        console.error('Failed to parse lab preferences:', e);
      }
    }
  }

  const payloadString = JSON.stringify(payload);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(getDispatchUrl(), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: payloadString,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`AXiM Support request failed: ${response.statusText}`);
    }

    return response.json();
  } catch (error) {
    clearTimeout(timeoutId);

    const isNetworkError = error.name === 'AbortError' ||
                           error.message.includes('Failed to fetch') ||
                           error.message.includes('Could not resolve host');

    if (isNetworkError) {
      console.warn('[SUPPORT_GATEWAY_FALLBACK] support.axim.us.com unreachable. Failing over to direct Worker Ingress.');

      const internalKey = import.meta.env.VITE_AXIM_INTERNAL_KEY || localStorage.getItem('axim_internal_key');
      const headers = { 'Content-Type': 'application/json' };

      if (internalKey) {
        headers['X-Axim-Signature'] = await generateHmacSignature(payloadString, internalKey);
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          headers['Authorization'] = `Bearer ${session.access_token}`;
        }
      }

      const fallbackResponse = await fetch(ingressUrl, {
        method: 'POST',
        headers,
        body: payloadString
      });

      if (!fallbackResponse.ok) {
         throw new Error(`Worker Ingress fallback failed: ${fallbackResponse.statusText}`);
      }

      return fallbackResponse.json();
    }

    throw error;
  }
}
