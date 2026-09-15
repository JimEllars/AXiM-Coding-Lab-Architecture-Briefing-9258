import React, { useEffect } from 'react';

const Login = () => {
  useEffect(() => {
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
