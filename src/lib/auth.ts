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

export function hydrateUserPermissions(): { email: string, role: string } | null {
  const getCookie = (name: string) => {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop()?.split(';').shift();
    return null;
  };

  const token = localStorage.getItem('axim_internal_key') || getCookie('axim_session');
  if (!token) return null;

  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));

    const decoded = JSON.parse(jsonPayload);
    if (decoded && decoded.email) {
      if (decoded.email === 'james.ellars@axim.us.com' || decoded.email === 'jrellars@gmail.com') {
        localStorage.setItem('axim_user_role', 'super_user');
        return { email: decoded.email, role: 'super_user' };
      }
      return { email: decoded.email, role: 'user' };
    }
  } catch (e) {
    console.error('Failed to parse JWT for hydration', e);
  }
  return null;
}
