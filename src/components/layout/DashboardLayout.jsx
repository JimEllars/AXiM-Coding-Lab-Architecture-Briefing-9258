import React, { useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import SafeIcon from '@/common/SafeIcon';
import CommandPalette from '../CommandPalette';
import CognitiveReasoning from '../CognitiveReasoning';

const Sidebar = () => {
  const location = useLocation();
  return (
    <div className="w-64 bg-[#0a0f1c] border-r border-gray-800 h-screen flex flex-col z-20">
      <div className="h-16 flex items-center px-6 border-b border-gray-800">
        <Link to="/" className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-blue-600/20 flex items-center justify-center border border-blue-500/50">
            <SafeIcon name="Cpu" className="text-blue-400 text-lg" />
          </div>
          <span className="font-bold text-white tracking-widest text-sm italic">AXiM LAB</span>
        </Link>
      </div>

      <div className="flex-1 py-6 px-4 space-y-1 overflow-y-auto terminal-scroll">
        <NavItem to="/" icon="Terminal" label="Dev Cockpit" active={location.pathname === '/'} />
        <NavItem to="/prs" icon="GitPullRequest" label="Active PRs" badge="3" active={location.pathname === '/prs'} />
        <NavItem to="/repositories" icon="Database" label="Repositories" active={location.pathname.startsWith('/repositories')} />
        <NavItem to="/knowledge" icon="Book" label="Knowledge Base" active={location.pathname === '/knowledge'} />
        <NavItem to="/agents" icon="Users" label="Agent Registry" active={location.pathname === '/agents'} />
        <div className="pt-4 pb-2">
          <p className="text-[9px] text-gray-600 font-mono uppercase px-3 tracking-widest">Observability</p>
        </div>
        <NavItem to="/secops" icon="Shield" label="SecOps Center" active={location.pathname === '/secops'} />
        <NavItem to="/topology" icon="Target" label="Ecosystem Topology" active={location.pathname === '/topology'} />
        <NavItem to="/telemetry" icon="Activity" label="Swarm Telemetry" active={location.pathname === '/telemetry'} />
        <NavItem to="/audit" icon="List" label="Audit Logs" active={location.pathname === '/audit'} />
      </div>

      <div className="p-4 border-t border-gray-800">
        <NavItem to="/settings" icon="Settings" label="Settings" active={location.pathname === '/settings'} />
      </div>
    </div>
  );
};

const NavItem = ({ to, icon, label, active, badge }) => (
  <Link to={to} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-all duration-200 group ${
    active ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20' : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
  }`}>
    <div className="flex items-center gap-3">
      <SafeIcon name={icon} className={`text-lg ${active ? 'text-blue-400' : 'text-gray-500 group-hover:text-gray-300'}`} />
      <span className="text-sm font-medium">{label}</span>
    </div>
    {badge && (
      <span className="bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">{badge}</span>
    )}
  </Link>
);

const DashboardLayout = () => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-[#030712] text-gray-100 font-sans">
      <CommandPalette isOpen={isSearchOpen} onClose={() => setIsSearchOpen(false)} />
      <CognitiveReasoning />
      <Sidebar />
      <div className="flex-1 flex flex-col relative overflow-hidden">
        <header className="h-16 bg-[#030712]/50 backdrop-blur-xl border-b border-gray-800 flex items-center justify-between px-8 sticky top-0 z-40">
          <button 
            onClick={() => setIsSearchOpen(true)}
            className="flex items-center gap-3 px-4 py-1.5 bg-gray-900 border border-gray-800 rounded-lg text-gray-500 hover:border-gray-700 transition-all"
          >
            <SafeIcon name="Search" className="text-sm" />
            <span className="text-xs font-mono">Quick Search...</span>
            <span className="text-[10px] bg-gray-800 px-1.5 py-0.5 rounded ml-4">⌘K</span>
          </button>
          <div className="flex items-center gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-[10px] text-white font-bold leading-none">Admin Ellars</p>
              <p className="text-[9px] text-gray-500 font-mono mt-1 uppercase">Superuser</p>
            </div>
            <div className="w-9 h-9 rounded-xl bg-gray-800 border border-gray-700 flex items-center justify-center">
              <SafeIcon name="User" className="text-gray-500" />
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-8 relative z-0 terminal-scroll">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;