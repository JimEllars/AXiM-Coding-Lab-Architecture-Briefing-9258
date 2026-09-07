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

        const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
          access_token: token,
          refresh_token: token,
        });

        if (sessionError) {
           console.warn('Supabase setSession failed, attempting silent anonymous login fallback:', sessionError);

           // Fallback for demo environments without actual SSO JWTs
           const { data: anonData, error: anonError } = await supabase.auth.signInAnonymously();
           if (anonError) {
             console.error("Anonymous fallback failed:", anonError);
           }
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
      <div className="flex h-screen items-center justify-center bg-slate-900 text-white">
        <div className="text-red-500 font-mono">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-slate-900 text-white flex-col gap-4">
      <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      <div className="font-mono text-sm tracking-widest text-blue-400">VERIFYING SSO UPLINK...</div>
    </div>
  );
};

export default AuthCallback;
