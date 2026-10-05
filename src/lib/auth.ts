export interface SessionData {
  user: {
    email: string;
    role: string;
  };
}

export async function verifyAximSession(): Promise<SessionData | null> {
  const getCookie = (name: string) => {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop()?.split(';').shift();
    return null;
  };

  const aximSession = getCookie('axim_session');
  if (!aximSession) return null;

  try {
    const res = await fetch('https://passport.axim.us.com/api/v1/auth/verify-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${aximSession}`
      }
    });

    if (!res.ok) {
      return null;
    }
    const data = await res.json();
    return data;
  } catch (err) {
    console.error('Session verification failed', err);
    return null;
  }
}

export function isSuperUser(email: string): boolean {
  return email === 'james.ellars@axim.us.com' || email === 'jrellars@gmail.com';
}
