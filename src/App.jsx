import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import '@questlabs/react-sdk/dist/style.css';
import DashboardLayout from './components/layout/DashboardLayout';
import Cockpit from './pages/Cockpit';
import PullRequests from './pages/PullRequests';
import Telemetry from './pages/Telemetry';
import Repositories from './pages/Repositories';
import RepositoryDetail from './pages/RepositoryDetail';
import Topology from './pages/Topology';
import AuditLogs from './pages/AuditLogs';
import Settings from './pages/Settings';
import SecOps from './pages/SecOps';
import KnowledgeBase from './pages/KnowledgeBase';
import AgentRegistry from './pages/AgentRegistry';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<DashboardLayout />}>
          <Route index element={<Cockpit />} />
          <Route path="prs" element={<PullRequests />} />
          <Route path="repositories" element={<Repositories />} />
          <Route path="repositories/:id" element={<RepositoryDetail />} />
          <Route path="knowledge" element={<KnowledgeBase />} />
          <Route path="agents" element={<AgentRegistry />} />
          <Route path="secops" element={<SecOps />} />
          <Route path="topology" element={<Topology />} />
          <Route path="telemetry" element={<Telemetry />} />
          <Route path="audit" element={<AuditLogs />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;