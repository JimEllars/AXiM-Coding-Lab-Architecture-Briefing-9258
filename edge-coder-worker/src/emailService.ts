export interface EmailPayload {
  to: string;
  bcc?: string;
  subject: string;
  html: string;
}

export async function sendEmailItMessage(payload: EmailPayload, env: any): Promise<boolean> {
  const url = 'https://api.emailit.com/v1/email/send';

  const emailData = {
    from: 'system@axim.us.com',
    to: payload.to,
    bcc: payload.bcc ? [payload.bcc] : [],
    subject: payload.subject,
    html: payload.html
  };

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.EMAILIT_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(emailData),
      signal: controller.signal as any
    });

    clearTimeout(timeout);

    if (!response.ok) {
      if (response.status >= 500) {
        throw new Error(`EmailIt 5xx Error: ${response.status}`);
      }
      console.error(`EmailIt API Error: ${response.status} ${await response.text()}`);
      return false;
    }

    return true;
  } catch (error: any) {
    console.error('EmailIt Dispatch Failed, queueing to DLQ:', error.message);

    if (env.CODER_DLQ_KV) {
      const dlqId = `dlq_email_${Date.now()}`;
      await env.CODER_DLQ_KV.put(dlqId, JSON.stringify(emailData));
    }
    return false;
  }
}
