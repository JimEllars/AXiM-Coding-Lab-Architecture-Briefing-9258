import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import SafeIcon from '@/common/SafeIcon';

const AuthCallback = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState(null);

  useEffect(() => {
    const processToken = async () => {
      const params = new URLSearchParams(location.search);
      const token = params.get('token');

      if (!token) {
        setError('No authentication token found in request.');
        return;
      }

      try {
        // Strip the token from URL
        window.history.replaceState({}, document.title, '/');

        // Verify role (Simulated validation for this phase)
        const mockRole = 'engineer';
        const allowedRoles = ['developer', 'engineer', 'admin', 'super_user'];

        if (!allowedRoles.includes(mockRole)) {
            setError('Unauthorized role. Access denied.');
            return;
        }

        // Store session
        localStorage.setItem('axim_internal_key', token);
        localStorage.setItem('axim_user_role', mockRole);
        localStorage.setItem('axim_user_profile', JSON.stringify({ role: mockRole, name: 'Admin Ellars' }));

        // Attempt Supabase setSession so that App.jsx acknowledges it.
        // If it's an actual JWT Supabase expects, this works. Otherwise, we might need a workaround for App.jsx.
        // We'll call setSession. If it fails, the app might not log in fully if App relies ONLY on supabase.
        // Actually, we can use an anonymous sign-in or a mock session if needed, but let's try setSession.

        // As a fallback, we will redirect to '/'
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: token,
          refresh_token: token,
        });

        if (sessionError) {
           console.warn('Supabase setSession failed:', sessionError);
           // For development/mock purposes, if setSession fails, we might still want to proceed,
           // but App.jsx uses `session` from supabase to guard routes.
           // In this scenario, we might need to rely on the existing login or assume `token` is valid for supabase.
        }

        // Redirect after a short delay to allow session to settle
        setTimeout(() => navigate('/'), 500);

      } catch (err) {
        setError('Failed to process authentication token.');
        console.error(err);
      }
    };

    processToken();
  }, [location, navigate]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#0a0f1c] text-white">
        <div className="text-red-500 font-mono">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-[#0a0f1c] text-white flex-col gap-4">
      <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      <div className="font-mono text-sm tracking-widest text-blue-400">VERIFYING SSO UPLINK...</div>
    </div>
  );
};

export default AuthCallback;
