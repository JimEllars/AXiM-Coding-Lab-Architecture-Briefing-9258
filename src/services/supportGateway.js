const supportApiUrl = import.meta.env.VITE_SUPPORT_API_URL;

function getDispatchUrl() {
  if (!supportApiUrl) {
    throw new Error('VITE_SUPPORT_API_URL must point to the authenticated AXiM Support API.');
  }

  return `${supportApiUrl.replace(/\/$/, '')}/api/v1/tasks/dispatch`;
}

export async function dispatchSupportTask(payload) {
  const response = await fetch(getDispatchUrl(), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`AXiM Support request failed: ${response.statusText}`);
  }

  return response.json();
}
