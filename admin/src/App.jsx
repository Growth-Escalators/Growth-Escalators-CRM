import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './pages/LoginPage.jsx';
import ContactsPage from './pages/ContactsPage.jsx';
import PipelinePage from './pages/PipelinePage.jsx';
import AutomationsPage from './pages/AutomationsPage.jsx';
import PipelineManagerPage from './pages/PipelineManagerPage.jsx';
import SystemHealthPage from './pages/SystemHealthPage.jsx';
import EmailTemplatesPage from './pages/EmailTemplatesPage.jsx';
import BillingPage from './pages/BillingPage.jsx';
import PermissionsPage from './pages/PermissionsPage.jsx';
import AdsPage from './pages/AdsPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import SocialPage from './pages/SocialPage.jsx';
import InboxPage from './pages/InboxPage.jsx';
import LeadDiscoveryPage from './pages/LeadDiscoveryPage.jsx';
import MarketingPage from './pages/MarketingPage.jsx';
import AuditPage from './pages/AuditPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';

function PrivateRoute({ children }) {
  const token = localStorage.getItem('ge_crm_token');
  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <BrowserRouter basename="/crm">
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/dashboard" element={<PrivateRoute><DashboardPage /></PrivateRoute>} />
        <Route path="/contacts" element={<PrivateRoute><ContactsPage /></PrivateRoute>} />
        <Route path="/pipeline" element={<PrivateRoute><PipelinePage /></PrivateRoute>} />
        <Route path="/automations" element={<PrivateRoute><AutomationsPage /></PrivateRoute>} />
        <Route path="/pipelines/settings" element={<PrivateRoute><PipelineManagerPage /></PrivateRoute>} />
        <Route path="/health" element={<PrivateRoute><SystemHealthPage /></PrivateRoute>} />
        <Route path="/emails" element={<PrivateRoute><EmailTemplatesPage /></PrivateRoute>} />
        <Route path="/billing" element={<PrivateRoute><BillingPage /></PrivateRoute>} />
        <Route path="/settings/permissions" element={<PrivateRoute><PermissionsPage /></PrivateRoute>} />
        <Route path="/settings/audit" element={<PrivateRoute><AuditPage /></PrivateRoute>} />
        <Route path="/ads" element={<PrivateRoute><AdsPage /></PrivateRoute>} />
        <Route path="/reports" element={<PrivateRoute><ReportsPage /></PrivateRoute>} />
        <Route path="/social" element={<PrivateRoute><SocialPage /></PrivateRoute>} />
        <Route path="/inbox" element={<PrivateRoute><InboxPage /></PrivateRoute>} />
        <Route path="/discover" element={<PrivateRoute><LeadDiscoveryPage /></PrivateRoute>} />
        <Route path="/marketing" element={<PrivateRoute><MarketingPage /></PrivateRoute>} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
