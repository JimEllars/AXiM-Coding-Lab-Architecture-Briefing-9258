import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';

function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));

    return JSON.parse(jsonPayload);
  } catch(e) {
    return null;
  }
}

const AuthCallback = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState(null);

  useEffect(() => {
    const processToken = async () => {
      const params = new URLSearchParams(location.search);
      let token = params.get('token');

      // Check for axim_session cookie if no token in URL
      if (!token) {
        const cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
          const cookie = cookies[i].trim();
          if (cookie.startsWith('axim_session=')) {
            token = cookie.substring('axim_session='.length);
            break;
          }
        }
      }

      if (!token) {
        setError('No authentication token found in request or session.');
        setTimeout(() => navigate('/login?error=sso_failed', { replace: true }), 2000);
        return;
      }

      try {
        // Strip the token from URL if it was there
        if (params.get('token')) {
          window.history.replaceState({}, document.title, '/');
        }

        // Simulating the verify-token exchange from Passport SSO
        // Try decoding JWT to get email and role, or default to mock
        const decoded = parseJwt(token);
        const email = decoded?.email || 'james.ellars@axim.us.com';

        let role = 'engineer';
        if (email === 'james.ellars@axim.us.com' || email === 'jrellars@gmail.com') {
          role = 'super_user';
        }

        // Store session in localStorage
        localStorage.setItem('axim_internal_key', token);
        localStorage.setItem('axim_user_email', email);
        localStorage.setItem('axim_user_role', role);
        localStorage.setItem('axim_user_profile', JSON.stringify({ role, email }));

try {
          const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
            access_token: token,
            refresh_token: token,
          });

          if (sessionError) {
             console.warn('Supabase setSession failed:', sessionError);
             // We continue since we are handling local storage for AXiM SSO auth
          } else if (sessionData && sessionData.session && sessionData.session.user) {
             const sessionEmail = sessionData.session.user.email;
             const extractedRole = (sessionEmail === 'james.ellars@axim.us.com' || sessionEmail === 'jrellars@gmail.com') ? 'super_user' : 'engineer';

             localStorage.setItem('axim_user_email', sessionEmail);
             localStorage.setItem('axim_user_role', extractedRole);
             localStorage.setItem('axim_user_profile', JSON.stringify({ role: extractedRole, email: sessionEmail }));
          }
        } catch (supabaseAuthErr) {
            console.error("Critical supabase auth error:", supabaseAuthErr);
        }

        // Redirect after a short delay to allow session to settle
        setTimeout(() => navigate('/'), 500);

      } catch (err) {
        setError('Failed to process authentication token.');
        console.error(err);
        setTimeout(() => {
            navigate('/login?error=sso_failed', { replace: true });
        }, 2000);
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
