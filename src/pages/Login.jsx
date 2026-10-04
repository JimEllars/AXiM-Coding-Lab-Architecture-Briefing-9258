import React, { useEffect } from 'react';

const Login = () => {
  useEffect(() => {

    const cookies = document.cookie.split(';');
    let cookieToken = null;
    for (let i = 0; i < cookies.length; i++) {
        const cookie = cookies[i].trim();
        if (cookie.startsWith('axim_session=')) {
            cookieToken = cookie.substring('axim_session='.length);
            break;
        }
    }

    if (cookieToken) {
        localStorage.setItem('axim_internal_key', cookieToken);
        // decode jwt for email
        try {
            const base64Url = cookieToken.split('.')[1];
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
                return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
            }).join(''));
            const decoded = JSON.parse(jsonPayload);
            if (decoded.email) {
                localStorage.setItem('axim_user_email', decoded.email);
            }
        } catch(e) { console.error("Could not parse jwt", e); }
    }

    const existingKey = localStorage.getItem('axim_internal_key');
    const existingEmail = localStorage.getItem('axim_user_email');


    if (existingKey && existingEmail) {
      window.location.href = '/';
      return;
    }

    // Redirect directly to AXiM Passport SSO
    window.location.href = 'https://passport.axim.us.com/login?redirect_uri=https://coder.axim.us.com/auth/callback&app_id=codinglab';
  }, []);

  return (
    <div className="flex h-screen items-center justify-center bg-[#0a0f1c] text-white flex-col gap-4">
      <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      <div className="font-mono text-sm tracking-widest text-blue-400">REDIRECTING TO SECURE PASSPORT SSO...</div>
    </div>
  );
};

export default Login;
