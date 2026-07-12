import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import '@questlabs/react-sdk/dist/style.css';
import DashboardLayout from './components/layout/DashboardLayout';
import Cockpit from './pages/Cockpit';
import PullRequests from './pages/PullRequests';
import Telemetry from './pages/Telemetry';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<DashboardLayout />}>
          <Route index element={<Cockpit />} />
          <Route path="prs" element={<PullRequests />} />
          <Route path="telemetry" element={<Telemetry />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;