import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { getAuthPermissions, getAuthToken, getAuthUser, getProductHome, getTenantSlug, normalizeTenantSlug, WIZMATCH_SHARED_ROUTE_MAP } from './lib/auth.js';
import { apiFetch } from './lib/api.js';
import { normalizeStaffingAccess } from './lib/staffingAccess.js';

const LoginPage = lazy(() => import('./pages/LoginPage.jsx'));
const ContactsPage = lazy(() => import('./pages/ContactsPage.jsx'));
const PipelinePage = lazy(() => import('./pages/PipelinePage.jsx'));
const PipelineManagerPage = lazy(() => import('./pages/PipelineManagerPage.jsx'));
const EmailTemplatesPage = lazy(() => import('./pages/EmailTemplatesPage.jsx'));
const BillingPage = lazy(() => import('./pages/BillingPage.jsx'));
// Contracts now hand off to Documenso (see ContractsLaunchPage). The old
// in-CRM ContractsPage stays on disk, dormant, for easy revert.
const ContractsLaunchPage = lazy(() => import('./pages/ContractsLaunchPage.jsx'));
const SignContractPage = lazy(() => import('./pages/SignContractPage.jsx'));
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
const WizmatchCommandCenterNewPage = lazy(() => import('./pages/WizmatchNewPages.jsx').then((module) => ({ default: module.WizmatchCommandCenterNewPage })));
const WizmatchClientDiscoveryNewPage = lazy(() => import('./pages/WizmatchNewPages.jsx').then((module) => ({ default: module.WizmatchClientDiscoveryNewPage })));
const WizmatchClientDiscoveryPage = lazy(() => import('./pages/WizmatchClientDiscoveryPage.jsx'));
const WizmatchRequirementsPage = lazy(() => import('./pages/WizmatchRequirementsPage.jsx'));
const WizmatchMyWorkPage = lazy(() => import('./pages/WizmatchMyWorkPage.jsx'));
const WizmatchRelationshipsPage = lazy(() => import('./pages/WizmatchRelationshipsPage.jsx'));
const WizmatchCompaniesPage = lazy(() => import('./pages/WizmatchCompaniesPage.jsx'));
const WizmatchHiringContactsPage = lazy(() => import('./pages/WizmatchHiringContactsPage.jsx'));
const WizmatchTalentMatchingPage = lazy(() => import('./pages/WizmatchTalentMatchingPage.jsx'));
const WizmatchDeliveryBoardPage = lazy(() => import('./pages/WizmatchDeliveryBoardPage.jsx'));
const WizmatchSignalsPage = lazy(() => import('./pages/WizmatchSignalsPage.jsx'));
const WizmatchCandidateIntelligenceNewPage = lazy(() => import('./pages/WizmatchNewPages.jsx').then((module) => ({ default: module.WizmatchCandidateIntelligenceNewPage })));
const WizmatchCandidateIntelligencePage = lazy(() => import('./pages/WizmatchCandidateIntelligencePage.jsx'));
const WizmatchCandidatesPage = lazy(() => import('./pages/WizmatchCandidatesPage.jsx'));
const WizmatchSourceCandidatesPage = lazy(() => import('./pages/WizmatchSourceCandidatesPage.jsx'));
const WizmatchContactIntelligenceNewPage = lazy(() => import('./pages/WizmatchNewPages.jsx').then((module) => ({ default: module.WizmatchContactIntelligenceNewPage })));
const WizmatchContactIntelligencePage = lazy(() => import('./pages/WizmatchContactIntelligencePage.jsx'));
const WizmatchPlacementsPage = lazy(() => import('./pages/WizmatchPlacementsPage.jsx'));
const WizmatchPrimesPage = lazy(() => import('./pages/WizmatchPrimesPage.jsx'));
const WizmatchAnalyticsNewPage = lazy(() => import('./pages/WizmatchNewPages.jsx').then((module) => ({ default: module.WizmatchAnalyticsNewPage })));
const WizmatchAnalyticsPage = lazy(() => import('./pages/WizmatchAnalyticsPage.jsx'));
const WizmatchReviewWorkbenchPage = lazy(() => import('./pages/WizmatchOperatingPages.jsx').then((module) => ({ default: module.WizmatchReviewWorkbenchPage })));
const WizmatchDashboardPage = lazy(() => import('./pages/WizmatchOperatingPages.jsx').then((module) => ({ default: module.WizmatchDashboardPage })));
const WizmatchTodayPage = lazy(() => import('./pages/WizmatchTodayPage.jsx'));
const WizmatchIntelligencePage = lazy(() => import('./pages/WizmatchOperatingPages.jsx').then((module) => ({ default: module.WizmatchIntelligencePage })));
const WizmatchRequirementPriorityPage = lazy(() => import('./pages/WizmatchOperatingPages.jsx').then((module) => ({ default: module.WizmatchRequirementPriorityPage })));
const WizmatchGuardrailsPage = lazy(() => import('./pages/WizmatchOperatingPages.jsx').then((module) => ({ default: module.WizmatchGuardrailsPage })));
const WizmatchReadinessPage = lazy(() => import('./pages/WizmatchOperatingPages.jsx').then((module) => ({ default: module.WizmatchReadinessPage })));
const WizmatchLocalDemoFlowPage = lazy(() => import('./pages/WizmatchOperatingPages.jsx').then((module) => ({ default: module.WizmatchLocalDemoFlowPage })));
const WizmatchSystemPage = lazy(() => import('./pages/WizmatchSystemPage.jsx'));
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
  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }
  render() {
    if (this.state.hasError) {
      const failedPath = this.props.resetKey || window.location.pathname;
      return (
        <div style={{ padding: '40px', textAlign: 'center', fontFamily: 'system-ui' }}>
          <h2 style={{ color: '#dc2626', marginBottom: '16px' }}>Something went wrong</h2>
          <p style={{ color: '#64748b', marginBottom: '24px' }}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <p style={{ color: '#94a3b8', marginBottom: '24px', fontSize: '13px' }}>
            Failed page: {failedPath}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '8px 24px', background: '#0284c7', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', marginRight: '12px' }}
          >
            Reload Page
          </button>
          <button
            onClick={() => { window.location.href = getProductHome(getTenantSlug()); }}
            style={{ padding: '8px 24px', background: '#0f172a', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' }}
          >
            Go to Dashboard
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function RouteErrorBoundary({ children }) {
  const location = useLocation();
  return <ErrorBoundary resetKey={`${location.pathname}${location.search}`}>{children}</ErrorBoundary>;
}

function PrivateRoute({ children }) {
  const location = useLocation();
  const activeTenantSlug = getTenantSlug();
  const isWizmatchPath = location.pathname.startsWith('/wizmatch');
  const activeToken = getAuthToken(activeTenantSlug);
  const activeUser = getAuthUser(activeTenantSlug);
  const growthToken = getAuthToken('growth-escalators');
  const growthUser = getAuthUser('growth-escalators');
  const wizmatchToken = getAuthToken('wizmatch');
  const wizmatchUser = getAuthUser('wizmatch');
  const token = isWizmatchPath ? wizmatchToken : activeToken;
  const user = isWizmatchPath ? wizmatchUser : activeUser;
  const userTenantSlug = normalizeTenantSlug(user?.tenantSlug || (isWizmatchPath ? 'wizmatch' : activeTenantSlug));
  const isWizmatchUser = userTenantSlug === 'wizmatch';
  if (!token && isWizmatchPath && growthToken && normalizeTenantSlug(growthUser?.tenantSlug) !== 'wizmatch') {
    return <Navigate to={getProductHome(growthUser?.tenantSlug || 'growth-escalators')} replace />;
  }
  if (!token) {
    const requestedProduct = isWizmatchPath ? 'wizmatch' : activeTenantSlug;
    const returnTo = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?tenant=${requestedProduct}&returnTo=${returnTo}`} replace />;
  }
  if (token && isWizmatchUser && !isWizmatchPath) {
    return <Navigate to={WIZMATCH_SHARED_ROUTE_MAP[location.pathname] || getProductHome(userTenantSlug)} replace />;
  }
  if (token && !isWizmatchUser && isWizmatchPath) {
    return <Navigate to={getProductHome(userTenantSlug)} replace />;
  }
  return children;
}

function HomeRedirect() {
  const activeTenantSlug = getTenantSlug();
  const user = getAuthUser(activeTenantSlug);
  return <Navigate to={getProductHome(user?.tenantSlug || activeTenantSlug)} replace />;
}

function StaffingPhaseRoute({ phase, children }) {
  const pilotAccess = getAuthPermissions('wizmatch').staffingPilotAccess === true;
  const [state, setState] = useState({ status: 'loading', access: null, error: '' });

  const loadAccess = useCallback(async () => {
    if (!pilotAccess) {
      setState({ status: 'ready', access: normalizeStaffingAccess(null), error: '' });
      return;
    }
    setState({ status: 'loading', access: null, error: '' });
    try {
      const response = await apiFetch('/api/wizmatch/staffing/access');
      setState({ status: 'ready', access: normalizeStaffingAccess(response), error: '' });
    } catch (error) {
      setState({
        status: 'error',
        access: null,
        error: error?.message || 'Staffing access could not be verified.',
      });
    }
  }, [pilotAccess]);

  useEffect(() => { loadAccess(); }, [loadAccess]);

  if (state.status === 'loading') {
    return <div className="flex min-h-screen items-center justify-center text-sm text-neutral-500">Checking staffing access…</div>;
  }
  if (state.status === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-red-200 bg-white p-6 text-center shadow-sm">
          <h2 className="text-lg font-semibold text-neutral-900">Staffing access unavailable</h2>
          <p className="mt-2 text-sm text-neutral-600">{state.error}</p>
          <button type="button" onClick={loadAccess} className="mt-4 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">
            Retry
          </button>
        </div>
      </div>
    );
  }
  return state.access?.allowed && state.access.phases[phase]
    ? children
    : <Navigate to="/wizmatch/today" replace />;
}

function QueryBoundaryQaPage() {
  const location = useLocation();
  if (new URLSearchParams(location.search).get('tab') === 'crash') {
    throw new Error('Intentional query-boundary QA crash');
  }
  return <h1>Query boundary recovered</h1>;
}

export default function App() {
  return (
    <BrowserRouter>
      <RouteErrorBoundary>
        <Suspense fallback={<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh'}}><p>Loading...</p></div>}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            {/* Public signing page — external signers have no CRM login; the token in the URL is the authorization */}
            <Route path="/sign/:token" element={<SignContractPage />} />
            {import.meta.env.DEV && <Route path="/__qa/query-boundary" element={<QueryBoundaryQaPage />} />}
            <Route path="/dashboard" element={<PrivateRoute><DashboardPage /></PrivateRoute>} />
            <Route path="/contacts" element={<PrivateRoute><ContactsPage /></PrivateRoute>} />
            <Route path="/pipeline" element={<PrivateRoute><PipelinePage /></PrivateRoute>} />
            <Route path="/automations" element={<Navigate to="/intelligence?tab=automations" replace />} />
            <Route path="/pipelines/settings" element={<PrivateRoute><PipelineManagerPage /></PrivateRoute>} />
            <Route path="/health" element={<Navigate to="/intelligence?tab=health" replace />} />
            <Route path="/emails" element={<PrivateRoute><EmailTemplatesPage /></PrivateRoute>} />
            <Route path="/billing" element={<PrivateRoute><BillingPage /></PrivateRoute>} />
            <Route path="/contracts" element={<PrivateRoute><ContractsLaunchPage /></PrivateRoute>} />
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
            {import.meta.env.DEV && <Route path="/wizmatch-demo" element={<WizmatchReviewWorkbenchPage demoMode />} />}
            <Route path="/wizmatch" element={<Navigate to="/wizmatch/today" replace />} />
            <Route path="/wizmatch/dashboard" element={<Navigate to="/wizmatch/today" replace />} />
            <Route path="/wizmatch/today" element={<PrivateRoute><AppLayout><WizmatchTodayPage /></AppLayout></PrivateRoute>} />
            <Route path="/wizmatch/contacts" element={<PrivateRoute><ContactsPage /></PrivateRoute>} />
            <Route path="/wizmatch/pipeline" element={<PrivateRoute><PipelinePage /></PrivateRoute>} />
            <Route path="/wizmatch/tasks" element={<PrivateRoute><TasksBoardPage /></PrivateRoute>} />
            <Route path="/wizmatch/inbox" element={<PrivateRoute><InboxPage /></PrivateRoute>} />
            <Route path="/wizmatch/billing" element={<PrivateRoute><BillingPage /></PrivateRoute>} />
            <Route path="/wizmatch/contracts" element={<PrivateRoute><ContractsLaunchPage /></PrivateRoute>} />
            <Route path="/wizmatch/finance" element={<PrivateRoute><FinancePage /></PrivateRoute>} />
            <Route path="/wizmatch/emails" element={<PrivateRoute><AppLayout><EmailTemplatesPage /></AppLayout></PrivateRoute>} />
            <Route path="/wizmatch/whatsapp-templates" element={<PrivateRoute><WhatsAppTemplatesPage /></PrivateRoute>} />
            <Route path="/wizmatch/discover" element={<PrivateRoute><AppLayout><LeadDiscoveryPage /></AppLayout></PrivateRoute>} />
            <Route path="/wizmatch/outreach" element={<PrivateRoute><OutreachDashboard /></PrivateRoute>} />
            <Route path="/wizmatch/intelligence" element={<PrivateRoute><AppLayout><WizmatchIntelligencePage /></AppLayout></PrivateRoute>} />
            <Route path="/wizmatch/settings/permissions" element={<PrivateRoute><PermissionsPage /></PrivateRoute>} />
            <Route path="/wizmatch/settings/audit" element={<PrivateRoute><AuditPage /></PrivateRoute>} />
            <Route path="/wizmatch/pipelines/settings" element={<PrivateRoute><PipelineManagerPage /></PrivateRoute>} />
            {import.meta.env.DEV && <Route path="/wizmatch/command-center-demo" element={<Navigate to="/wizmatch/review-workbench-demo" replace />} />}
            {import.meta.env.DEV && <Route path="/wizmatch/command-center-new-demo" element={<WizmatchCommandCenterNewPage demoMode />} />}
            <Route path="/wizmatch/command-center" element={<Navigate to="/wizmatch/review-workbench" replace />} />
            <Route path="/wizmatch/command-center-new" element={<Navigate to="/wizmatch/today" replace />} />
            {import.meta.env.DEV && <Route path="/wizmatch/review-workbench-demo" element={<WizmatchReviewWorkbenchPage demoMode />} />}
            <Route path="/wizmatch/review-workbench" element={<PrivateRoute><AppLayout><WizmatchReviewWorkbenchPage /></AppLayout></PrivateRoute>} />
            {import.meta.env.DEV && <Route path="/wizmatch/client-discovery-demo" element={<Navigate to="/wizmatch/client-discovery-new-demo" replace />} />}
            {import.meta.env.DEV && <Route path="/wizmatch/client-discovery-new-demo" element={<WizmatchClientDiscoveryNewPage demoMode />} />}
            <Route path="/wizmatch/client-discovery" element={<PrivateRoute><AppLayout><WizmatchClientDiscoveryPage /></AppLayout></PrivateRoute>} />
            <Route path="/wizmatch/client-discovery-new" element={<Navigate to="/wizmatch/client-discovery" replace />} />
            <Route path="/wizmatch/requirements" element={<PrivateRoute><AppLayout><WizmatchRequirementsPage /></AppLayout></PrivateRoute>} />
            <Route path="/wizmatch/my-work" element={<PrivateRoute><StaffingPhaseRoute phase="A"><AppLayout><WizmatchMyWorkPage /></AppLayout></StaffingPhaseRoute></PrivateRoute>} />
            <Route path="/wizmatch/relationships" element={<Navigate to="/wizmatch/companies" replace />} />
            <Route path="/wizmatch/companies" element={<PrivateRoute><StaffingPhaseRoute phase="A"><AppLayout><WizmatchCompaniesPage /></AppLayout></StaffingPhaseRoute></PrivateRoute>} />
            <Route path="/wizmatch/talent-matching" element={<PrivateRoute><StaffingPhaseRoute phase="B"><AppLayout><WizmatchTalentMatchingPage /></AppLayout></StaffingPhaseRoute></PrivateRoute>} />
            <Route path="/wizmatch/delivery" element={<Navigate to="/wizmatch/submissions" replace />} />
            <Route path="/wizmatch/submissions" element={<PrivateRoute><StaffingPhaseRoute phase="C"><AppLayout><WizmatchDeliveryBoardPage /></AppLayout></StaffingPhaseRoute></PrivateRoute>} />
            {import.meta.env.DEV && <Route path="/wizmatch/requirement-priority-new-demo" element={<WizmatchRequirementPriorityPage demoMode />} />}
            <Route path="/wizmatch/requirement-priority-new" element={<PrivateRoute><AppLayout><WizmatchRequirementPriorityPage /></AppLayout></PrivateRoute>} />
            <Route path="/wizmatch/signals" element={<Navigate to="/wizmatch/job-leads" replace />} />
            <Route path="/wizmatch/job-leads" element={<PrivateRoute><AppLayout><WizmatchSignalsPage /></AppLayout></PrivateRoute>} />
            {import.meta.env.DEV && <Route path="/wizmatch/candidate-intelligence-demo" element={<Navigate to="/wizmatch/candidate-intelligence-new-demo" replace />} />}
            {import.meta.env.DEV && <Route path="/wizmatch/candidate-intelligence-new-demo" element={<WizmatchCandidateIntelligenceNewPage demoMode />} />}
            <Route path="/wizmatch/candidate-intelligence" element={<PrivateRoute><AppLayout><WizmatchCandidateIntelligencePage /></AppLayout></PrivateRoute>} />
            <Route path="/wizmatch/candidate-intelligence-new" element={<Navigate to="/wizmatch/candidate-intelligence" replace />} />
            <Route path="/wizmatch/candidates" element={<PrivateRoute><AppLayout><WizmatchCandidatesPage /></AppLayout></PrivateRoute>} />
            <Route path="/wizmatch/source-candidates" element={<PrivateRoute><AppLayout><WizmatchSourceCandidatesPage /></AppLayout></PrivateRoute>} />
            <Route path="/wizmatch/queue" element={<Navigate to="/wizmatch/review-workbench" replace />} />
            {import.meta.env.DEV && <Route path="/wizmatch/contact-intelligence-demo" element={<Navigate to="/wizmatch/contact-intelligence-new-demo" replace />} />}
            {import.meta.env.DEV && <Route path="/wizmatch/contact-intelligence-new-demo" element={<WizmatchContactIntelligenceNewPage demoMode />} />}
            <Route path="/wizmatch/contact-intelligence" element={<Navigate to="/wizmatch/hiring-contacts" replace />} />
            <Route path="/wizmatch/hiring-contacts" element={<PrivateRoute><AppLayout><WizmatchHiringContactsPage /></AppLayout></PrivateRoute>} />
            <Route path="/wizmatch/contact-intelligence-new" element={<Navigate to="/wizmatch/hiring-contacts" replace />} />
            {/* Diagnostics — folded into the single System page (Workstream B). Old
                standalone routes redirect to the matching System tab; -demo variants
                (no auth, sample data) are unaffected. */}
            <Route path="/wizmatch/domains" element={<Navigate to="/wizmatch/system?tab=domains" replace />} />
            <Route path="/wizmatch/compliance" element={<Navigate to="/wizmatch/system?tab=compliance" replace />} />
            {import.meta.env.DEV && <Route path="/wizmatch/guardrails-new-demo" element={<WizmatchGuardrailsPage demoMode />} />}
            <Route path="/wizmatch/guardrails-new" element={<Navigate to="/wizmatch/system?tab=guardrails" replace />} />
            {import.meta.env.DEV && <Route path="/wizmatch/readiness-demo" element={<WizmatchReadinessPage demoMode />} />}
            <Route path="/wizmatch/readiness" element={<Navigate to="/wizmatch/system?tab=readiness" replace />} />
            <Route path="/wizmatch/system" element={<PrivateRoute><AppLayout><WizmatchSystemPage /></AppLayout></PrivateRoute>} />
            <Route path="/wizmatch/placements" element={<PrivateRoute><AppLayout><WizmatchPlacementsPage /></AppLayout></PrivateRoute>} />
            <Route path="/wizmatch/primes" element={<PrivateRoute><AppLayout><WizmatchPrimesPage /></AppLayout></PrivateRoute>} />
            {import.meta.env.DEV && <Route path="/wizmatch/analytics-demo" element={<Navigate to="/wizmatch/analytics-new-demo" replace />} />}
            {import.meta.env.DEV && <Route path="/wizmatch/analytics-new-demo" element={<WizmatchAnalyticsNewPage demoMode />} />}
            <Route path="/wizmatch/analytics" element={<Navigate to="/wizmatch/reports" replace />} />
            <Route path="/wizmatch/reports" element={<PrivateRoute><AppLayout><WizmatchAnalyticsPage /></AppLayout></PrivateRoute>} />
            <Route path="/wizmatch/analytics-new" element={<Navigate to="/wizmatch/reports" replace />} />
            {import.meta.env.DEV && <Route path="/wizmatch/local-demo-flow-demo" element={<WizmatchLocalDemoFlowPage demoMode />} />}
            <Route path="/wizmatch/local-demo-flow" element={<PrivateRoute><AppLayout><WizmatchLocalDemoFlowPage /></AppLayout></PrivateRoute>} />
            <Route path="/" element={<HomeRedirect />} />
            <Route path="*" element={<HomeRedirect />} />
          </Routes>
        </Suspense>
      </RouteErrorBoundary>
    </BrowserRouter>
  );
}
