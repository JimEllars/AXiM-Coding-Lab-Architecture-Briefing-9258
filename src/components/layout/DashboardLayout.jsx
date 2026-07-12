import React from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import SafeIcon from '@/common/SafeIcon';

const Sidebar = () => {
  const location = useLocation();
  
  return (
    <div className="w-64 bg-[#0a0f1c] border-r border-gray-800 h-screen flex flex-col">
      <div className="h-16 flex items-center px-6 border-b border-gray-800">
        <Link to="/" className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-blue-600/20 flex items-center justify-center border border-blue-500/50 hover:bg-blue-600/30 transition-colors">
            <SafeIcon name="Cpu" className="text-blue-400 text-lg" />
          </div>
          <span className="font-bold text-white tracking-wider text-sm">AXiM LAB</span>
        </Link>
      </div>
      
      <div className="flex-1 py-6 px-4 space-y-2">
        <NavItem to="/" icon="Terminal" label="Dev Cockpit" active={location.pathname === '/'} />
        <NavItem to="/prs" icon="GitPullRequest" label="Active PRs" badge="3" active={location.pathname === '/prs'} />
        <NavItem to="/telemetry" icon="Activity" label="Swarm Telemetry" active={location.pathname === '/telemetry'} />
        <NavItem to="#" icon="Shield" label="Asguard SOC" />
      </div>

      <div className="p-4 border-t border-gray-800">
        <div className="flex items-center gap-3 px-2">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.6)]"></div>
          <span className="text-xs text-gray-400 font-mono">NODE ONLINE</span>
        </div>
      </div>
    </div>
  );
};

const NavItem = ({ to, icon, label, active, badge }) => (
  <Link to={to} className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition-all duration-200 ${
    active ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20' : 'text-gray-400 hover:bg-gray-800/50 hover:text-gray-200'
  }`}>
    <div className="flex items-center gap-3">
      <SafeIcon name={icon} className="text-lg" />
      <span className="text-sm font-medium">{label}</span>
    </div>
    {badge && (
      <span className="bg-blue-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
        {badge}
      </span>
    )}
  </Link>
);

const Header = () => (
  <header className="h-16 bg-[#0a0f1c]/80 backdrop-blur-md border-b border-gray-800 flex items-center justify-between px-8 sticky top-0 z-10">
    <div className="flex items-center gap-4 text-sm text-gray-400 font-mono">
      <span>//</span>
      <span>ENV: PRODUCTION</span>
      <span>//</span>
      <span>ROUTING: DEEPSEEK-CODER</span>
    </div>
    <div className="flex items-center gap-4">
      <button className="p-2 text-gray-400 hover:text-white transition-colors">
        <SafeIcon name="Bell" className="text-xl" />
      </button>
      <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-purple-500 to-blue-500 p-[2px]">
        <div className="w-full h-full bg-[#0a0f1c] rounded-full flex items-center justify-center">
          <SafeIcon name="User" className="text-sm text-gray-300" />
        </div>
      </div>
    </div>
  </header>
);

const DashboardLayout = () => {
  return (
    <div className="flex h-screen overflow-hidden bg-[#030712]">
      <Sidebar />
      <div className="flex-1 flex flex-col relative">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-blue-600/5 blur-[120px] rounded-full pointer-events-none"></div>
        <Header />
        <main className="flex-1 overflow-y-auto p-8 relative z-0 terminal-scroll">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;