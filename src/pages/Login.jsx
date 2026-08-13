import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../services/supabaseClient';
import SafeIcon from '@/common/SafeIcon';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setError('[ACCESS DENIED]');
      setLoading(false);
    } else {
      navigate('/');
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0f1c] text-gray-100 font-sans justify-center items-center">
      <div className="w-full max-w-md p-8 bg-[#030712]/50 backdrop-blur-xl border border-gray-800 rounded-lg shadow-2xl relative">
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-10 h-10 rounded bg-blue-600/20 flex items-center justify-center border border-blue-500/50">
            <SafeIcon name="Cpu" className="text-blue-400 text-xl" />
          </div>
          <span className="font-bold text-white tracking-widest text-xl italic">AXiM LAB</span>
        </div>

        <form onSubmit={handleLogin} className="space-y-6">
          <div>
            <label className="block text-xs font-mono text-gray-400 mb-2 uppercase tracking-wider">Authentication Alias (Email)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-3 bg-gray-900/50 border border-gray-700 rounded-md text-white focus:outline-none focus:border-blue-500/50 transition-colors"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-mono text-gray-400 mb-2 uppercase tracking-wider">Secure Passphrase</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 bg-gray-900/50 border border-gray-700 rounded-md text-white focus:outline-none focus:border-blue-500/50 transition-colors"
              required
            />
          </div>

          {error && (
            <div className="text-red-500 font-mono text-sm tracking-widest font-bold text-center mt-4">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/50 text-blue-400 font-mono text-sm uppercase tracking-widest rounded-md transition-all mt-8"
          >
            {loading ? 'Authenticating...' : 'Initialize Uplink'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default Login;
