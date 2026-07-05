import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
const ContactsPage = lazy(() => import('./pages/ContactsPage.jsx'));
const PipelinePage = lazy(() => import('./pages/PipelinePage.jsx'));
const PipelineManagerPage = lazy(() => import('./pages/PipelineManagerPage.jsx'));
const EmailTemplatesPage = lazy(() => import('./pages/EmailTemplatesPage.jsx'));
const BillingPage = lazy(() => import('./pages/BillingPage.jsx'));
const FinancePage = lazy(() => import('./pages/FinancePage.jsx'));
const PermissionsPage = lazy(() => import('./pages/PermissionsPage.jsx'));
const AdsPage = lazy(() => import('./pages/AdsPage.jsx'));
const MetaAssetsPage = lazy(() => import('./pages/MetaAssetsPage.jsx'));
const SocialPage = lazy(() => import('./pages/SocialPage.jsx'));
const InboxPage = lazy(() => import('./pages/InboxPage.jsx'));
const LeadDiscoveryPage = lazy(() => import('./pages/LeadDiscoveryPage.jsx'));
const MarketingPage = lazy(() => import('./pages/MarketingPage.jsx'));
const AuditPage = lazy(() => import('./pages/AuditPage.jsx'));
const DashboardPage = lazy(() => import('./pages/DashboardPage.jsx'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage.jsx'));
const SEOPage = lazy(() => import('./pages/SEOPage.jsx'));
const IntelligencePage = lazy(() => import('./pages/IntelligencePage.jsx'));
const GrowthOSPage = lazy(() => import('./pages/GrowthOSPage.jsx'));
const WhatsAppTemplatesPage = lazy(() => import('./pages/WhatsAppTemplatesPage.jsx'));
const OutreachDashboard = lazy(() => import('./pages/OutreachDashboard.jsx'));
const OutboundPage = lazy(() => import('./pages/OutboundPage.jsx'));
const LinksPage = lazy(() => import('./pages/LinksPage.jsx'));
const ClientDetailPage = lazy(() => import('./pages/ClientDetailPage.jsx'));
const ClientsPage = lazy(() => import('./pages/ClientsPage.jsx'));
const FunnelManagementPage = lazy(() => import('./pages/FunnelManagementPage.jsx'));
const TasksBoardPage = lazy(() => import('./pages/tasks/TasksPage.jsx'));
const MyAttendancePage = lazy(() => import('./pages/MyAttendancePage.jsx'));
const WizmatchRequirementsPage = lazy(() => import('./pages/WizmatchRequirementsPage.jsx'));
const WizmatchSignalsPage = lazy(() => import('./pages/WizmatchSignalsPage.jsx'));
const WizmatchCandidatesPage = lazy(() => import('./pages/WizmatchCandidatesPage.jsx'));
const WizmatchReviewQueuePage = lazy(() => import('./pages/WizmatchReviewQueuePage.jsx'));
const WizmatchDomainsPage = lazy(() => import('./pages/WizmatchDomainsPage.jsx'));
const WizmatchCompliancePage = lazy(() => import('./pages/WizmatchCompliancePage.jsx'));
const WizmatchPlacementsPage = lazy(() => import('./pages/WizmatchPlacementsPage.jsx'));
const WizmatchPrimesPage = lazy(() => import('./pages/WizmatchPrimesPage.jsx'));
const WizmatchAnalyticsPage = lazy(() => import('./pages/WizmatchAnalyticsPage.jsx'));
const AppLayout = lazy(() => import('./components/AppLayout.jsx'));

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'system-ui' }}>
          <h2 style={{ color: '#dc2626', marginBottom: '16px' }}>Something went wrong</h2>
          <p style={{ color: '#64748b', marginBottom: '24px' }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '8px 24px', background: '#0284c7', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}
          >
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function PrivateRoute({ children }) {
  const token = localStorage.getItem('ge_crm_token');
  return token ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh'}}><p>Loading...</p></div>}>
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
            <Route path="/finance" element={<PrivateRoute><FinancePage /></PrivateRoute>} />
            <Route path="/settings/permissions" element={<PrivateRoute><PermissionsPage /></PrivateRoute>} />
            <Route path="/settings/audit" element={<PrivateRoute><AuditPage /></PrivateRoute>} />
            <Route path="/ads" element={<PrivateRoute><AdsPage /></PrivateRoute>} />
            <Route path="/meta-assets" element={<PrivateRoute><MetaAssetsPage /></PrivateRoute>} />
            <Route path="/reports" element={<Navigate to="/dashboard" replace />} />
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
            <Route path="/outbound" element={<PrivateRoute><OutboundPage /></PrivateRoute>} />
            <Route path="/links" element={<PrivateRoute><LinksPage /></PrivateRoute>} />
            <Route path="/social-scheduling" element={<Navigate to="/social" replace />} />
            <Route path="/clients" element={<PrivateRoute><ClientsPage /></PrivateRoute>} />
            <Route path="/client/:clientId" element={<PrivateRoute><ClientDetailPage /></PrivateRoute>} />
            <Route path="/funnels" element={<PrivateRoute><FunnelManagementPage /></PrivateRoute>} />
            <Route path="/tasks" element={<PrivateRoute><TasksBoardPage /></PrivateRoute>} />
            <Route path="/tasks/v2" element={<PrivateRoute><TasksBoardPage /></PrivateRoute>} />
            <Route path="/my-attendance" element={<PrivateRoute><MyAttendancePage /></PrivateRoute>} />
            <Route path="/wizmatch/requirements" element={<PrivateRoute><AppLayout><WizmatchRequirementsPage /></AppLayout></PrivateRoute>} />
            <Route path="/wizmatch/signals" element={<PrivateRoute><AppLayout><WizmatchSignalsPage /></AppLayout></PrivateRoute>} />
            <Route path="/wizmatch/candidates" element={<PrivateRoute><AppLayout><WizmatchCandidatesPage /></AppLayout></PrivateRoute>} />
            <Route path="/wizmatch/queue" element={<PrivateRoute><AppLayout><WizmatchReviewQueuePage /></AppLayout></PrivateRoute>} />
            <Route path="/wizmatch/domains" element={<PrivateRoute><AppLayout><WizmatchDomainsPage /></AppLayout></PrivateRoute>} />
            <Route path="/wizmatch/compliance" element={<PrivateRoute><AppLayout><WizmatchCompliancePage /></AppLayout></PrivateRoute>} />
            <Route path="/wizmatch/placements" element={<PrivateRoute><AppLayout><WizmatchPlacementsPage /></AppLayout></PrivateRoute>} />
            <Route path="/wizmatch/primes" element={<PrivateRoute><AppLayout><WizmatchPrimesPage /></AppLayout></PrivateRoute>} />
            <Route path="/wizmatch/analytics" element={<PrivateRoute><AppLayout><WizmatchAnalyticsPage /></AppLayout></PrivateRoute>} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
