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
import AnalyticsPage from './pages/AnalyticsPage.jsx';
import SEOPage from './pages/SEOPage.jsx';
import IntelligencePage from './pages/IntelligencePage.jsx';
import GrowthOSPage from './pages/GrowthOSPage.jsx';
import WhatsAppTemplatesPage from './pages/WhatsAppTemplatesPage.jsx';
import OutreachDashboard from './pages/OutreachDashboard.jsx';
import LinksPage from './pages/LinksPage.jsx';
import SocialSchedulingPage from './pages/SocialSchedulingPage.jsx';
import ClientDetailPage from './pages/ClientDetailPage.jsx';

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
        <Route path="/automations" element={<Navigate to="/intelligence?tab=automations" replace />} />
        <Route path="/pipelines/settings" element={<PrivateRoute><PipelineManagerPage /></PrivateRoute>} />
        <Route path="/health" element={<Navigate to="/intelligence?tab=health" replace />} />
        <Route path="/emails" element={<PrivateRoute><EmailTemplatesPage /></PrivateRoute>} />
        <Route path="/billing" element={<PrivateRoute><BillingPage /></PrivateRoute>} />
        <Route path="/settings/permissions" element={<PrivateRoute><PermissionsPage /></PrivateRoute>} />
        <Route path="/settings/audit" element={<PrivateRoute><AuditPage /></PrivateRoute>} />
        <Route path="/ads" element={<PrivateRoute><AdsPage /></PrivateRoute>} />
        <Route path="/reports" element={<PrivateRoute><ReportsPage /></PrivateRoute>} />
        <Route path="/social" element={<PrivateRoute><SocialPage /></PrivateRoute>} />
        <Route path="/inbox" element={<PrivateRoute><InboxPage /></PrivateRoute>} />
        <Route path="/discover" element={<PrivateRoute><LeadDiscoveryPage /></PrivateRoute>} />
        <Route path="/marketing" element={<Navigate to="/ads?tab=accounts" replace />} />
        <Route path="/analytics" element={<PrivateRoute><AnalyticsPage /></PrivateRoute>} />
        <Route path="/seo" element={<PrivateRoute><SEOPage /></PrivateRoute>} />
        <Route path="/intelligence" element={<PrivateRoute><IntelligencePage /></PrivateRoute>} />
        <Route path="/growth-os" element={<PrivateRoute><GrowthOSPage /></PrivateRoute>} />
        <Route path="/whatsapp-templates" element={<PrivateRoute><WhatsAppTemplatesPage /></PrivateRoute>} />
        <Route path="/outreach-dashboard" element={<PrivateRoute><OutreachDashboard /></PrivateRoute>} />
        <Route path="/links" element={<PrivateRoute><LinksPage /></PrivateRoute>} />
        <Route path="/social-scheduling" element={<PrivateRoute><SocialSchedulingPage /></PrivateRoute>} />
        <Route path="/client/:clientId" element={<PrivateRoute><ClientDetailPage /></PrivateRoute>} />
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
