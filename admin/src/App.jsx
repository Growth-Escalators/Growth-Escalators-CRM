import React, { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { getAuthPermissions, getAuthToken, getAuthUser, getProductHome, getTenantSlug, normalizeTenantSlug } from './lib/auth.js';
import { apiFetch } from './lib/api.js';
import { normalizeStaffingAccess } from './lib/staffingAccess.js';
import { buildWizmatchLegacyEntityTarget, getWizmatchRoute, mergeRouteSearch, wizmatchAliasTarget } from './lib/wizmatchRouteRegistry.js';

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
const WizmatchCommandCenterNewPage = lazy(() => import('./pages/WizmatchNewPages.jsx').then((module) => ({ default: module.WizmatchCommandCenterNewPage })));
const WizmatchClientDiscoveryNewPage = lazy(() => import('./pages/WizmatchNewPages.jsx').then((module) => ({ default: module.WizmatchClientDiscoveryNewPage })));
const WizmatchDeliveryBoardPage = lazy(() => import('./pages/WizmatchDeliveryBoardPage.jsx'));
const WizmatchJobLeadsPage = lazy(() => import('./pages/WizmatchJobLeadsPage.jsx'));
const WizmatchCandidateIntelligenceNewPage = lazy(() => import('./pages/WizmatchNewPages.jsx').then((module) => ({ default: module.WizmatchCandidateIntelligenceNewPage })));
const WizmatchCandidatesPage = lazy(() => import('./pages/WizmatchCandidatesPage.jsx'));
const WizmatchContactIntelligenceNewPage = lazy(() => import('./pages/WizmatchNewPages.jsx').then((module) => ({ default: module.WizmatchContactIntelligenceNewPage })));
const WizmatchPlacementsPage = lazy(() => import('./pages/WizmatchPlacementsPage.jsx'));
const WizmatchPrimesPage = lazy(() => import('./pages/WizmatchPrimesPage.jsx'));
const WizmatchAnalyticsNewPage = lazy(() => import('./pages/WizmatchNewPages.jsx').then((module) => ({ default: module.WizmatchAnalyticsNewPage })));
const WizmatchAnalyticsPage = lazy(() => import('./pages/WizmatchAnalyticsPage.jsx'));
const WizmatchReviewWorkbenchPage = lazy(() => import('./pages/WizmatchOperatingPages.jsx').then((module) => ({ default: module.WizmatchReviewWorkbenchPage })));
const WizmatchIntelligencePage = lazy(() => import('./pages/WizmatchOperatingPages.jsx').then((module) => ({ default: module.WizmatchIntelligencePage })));
const WizmatchRequirementPriorityPage = lazy(() => import('./pages/WizmatchOperatingPages.jsx').then((module) => ({ default: module.WizmatchRequirementPriorityPage })));
const WizmatchGuardrailsPage = lazy(() => import('./pages/WizmatchOperatingPages.jsx').then((module) => ({ default: module.WizmatchGuardrailsPage })));
const WizmatchReadinessPage = lazy(() => import('./pages/WizmatchOperatingPages.jsx').then((module) => ({ default: module.WizmatchReadinessPage })));
const WizmatchLocalDemoFlowPage = lazy(() => import('./pages/WizmatchOperatingPages.jsx').then((module) => ({ default: module.WizmatchLocalDemoFlowPage })));
const WizmatchSystemPage = lazy(() => import('./pages/WizmatchSystemPage.jsx'));
const WizmatchTodayPage = lazy(() => import('./pages/WizmatchTodayPage.jsx'));
const WizmatchCompaniesPage = lazy(() => import('./pages/WizmatchCompaniesPage.jsx'));
const WizmatchHiringContactsPage = lazy(() => import('./pages/WizmatchHiringContactsPage.jsx'));
const WizmatchRolesPage = lazy(() => import('./pages/WizmatchRolesPage.jsx'));
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
  const wizmatchSharedRouteMap = {
    '/dashboard': '/wizmatch/dashboard',
    '/contacts': '/wizmatch/contacts',
    '/pipeline': '/wizmatch/pipeline',
    '/tasks': '/wizmatch/tasks',
    '/inbox': '/wizmatch/inbox',
    '/billing': '/wizmatch/billing',
    '/finance': '/wizmatch/finance',
    '/emails': '/wizmatch/emails',
    '/whatsapp-templates': '/wizmatch/whatsapp-templates',
    '/discover': '/wizmatch/discover',
    '/outreach-dashboard': '/wizmatch/outreach',
    '/intelligence': '/wizmatch/intelligence',
    '/settings/permissions': '/wizmatch/settings/permissions',
    '/settings/audit': '/wizmatch/settings/audit',
    '/pipelines/settings': '/wizmatch/pipelines/settings',
  };
  if (!token && isWizmatchPath && growthToken && normalizeTenantSlug(growthUser?.tenantSlug) !== 'wizmatch') {
    return <Navigate to={getProductHome(growthUser?.tenantSlug || 'growth-escalators')} replace />;
  }
  if (!token) {
    const requestedProduct = isWizmatchPath ? 'wizmatch' : activeTenantSlug;
    const returnTo = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?tenant=${requestedProduct}&returnTo=${returnTo}`} replace />;
  }
  if (token && isWizmatchUser && !isWizmatchPath) {
    return <Navigate to={wizmatchSharedRouteMap[location.pathname] || getProductHome(userTenantSlug)} replace />;
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

function WizmatchAliasRedirect({ to, defaults }) {
  const location = useLocation();
  const target = to
    ? mergeRouteSearch(to, location.search, defaults)
    : wizmatchAliasTarget(location.pathname, location.search);
  return <Navigate to={`${target || '/wizmatch/today'}${location.hash || ''}`} replace />;
}

function WizmatchEntityAliasRedirect({ entityType, paramName }) {
  const location = useLocation();
  const params = useParams();
  const id = params[paramName];
  const target = id
    ? buildWizmatchLegacyEntityTarget(entityType, id, location.search)
    : '/wizmatch/today';
  return <Navigate to={`${target}${location.hash || ''}`} replace />;
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
  if (state.access?.allowed && state.access.phases[phase]) return children;
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-sm">
        <h2 className="text-lg font-semibold text-neutral-900">This workspace is not enabled</h2>
        <p className="mt-2 text-sm text-neutral-600">Your tenant or pilot access does not include Staffing Gate {phase}. Access is closed rather than showing incomplete data.</p>
        <a href="/wizmatch/job-leads" className="mt-4 inline-flex rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700">Open Job Leads</a>
      </div>
    </div>
  );
}

function QueryBoundaryQaPage() {
  const location = useLocation();
  if (new URLSearchParams(location.search).get('tab') === 'crash') {
    throw new Error('Intentional query-boundary QA crash');
  }
  return <h1>Query boundary recovered</h1>;
}

function WizmatchWorkspaceRoute({ routeId, children }) {
  const definition = getWizmatchRoute(routeId);
  const workspace = <AppLayout>{children}</AppLayout>;
  return definition?.phase
    ? <StaffingPhaseRoute phase={definition.phase}>{workspace}</StaffingPhaseRoute>
    : workspace;
}

export default function App() {
  return (
    <BrowserRouter>
      <RouteErrorBoundary>
        <Suspense fallback={<div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100vh'}}><p>Loading...</p></div>}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            {import.meta.env.DEV && <Route path="/__qa/query-boundary" element={<QueryBoundaryQaPage />} />}
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
            {import.meta.env.DEV && <Route path="/wizmatch-demo" element={<WizmatchReviewWorkbenchPage demoMode />} />}
            <Route path="/wizmatch" element={<WizmatchAliasRedirect to="/wizmatch/today" />} />
            <Route path="/wizmatch/today" element={<PrivateRoute><WizmatchWorkspaceRoute routeId="wm-my-work"><WizmatchTodayPage /></WizmatchWorkspaceRoute></PrivateRoute>} />
            <Route path="/wizmatch/dashboard" element={<WizmatchAliasRedirect />} />
            <Route path="/wizmatch/contacts" element={<PrivateRoute><ContactsPage /></PrivateRoute>} />
            <Route path="/wizmatch/pipeline" element={<PrivateRoute><PipelinePage /></PrivateRoute>} />
            <Route path="/wizmatch/tasks" element={<PrivateRoute><TasksBoardPage /></PrivateRoute>} />
            <Route path="/wizmatch/inbox" element={<PrivateRoute><InboxPage /></PrivateRoute>} />
            <Route path="/wizmatch/billing" element={<PrivateRoute><BillingPage /></PrivateRoute>} />
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
            <Route path="/wizmatch/command-center" element={<WizmatchAliasRedirect />} />
            <Route path="/wizmatch/command-center-new" element={<WizmatchAliasRedirect />} />
            {import.meta.env.DEV && <Route path="/wizmatch/review-workbench-demo" element={<WizmatchReviewWorkbenchPage demoMode />} />}
            <Route path="/wizmatch/review-workbench" element={<WizmatchAliasRedirect />} />
            {import.meta.env.DEV && <Route path="/wizmatch/client-discovery-demo" element={<Navigate to="/wizmatch/client-discovery-new-demo" replace />} />}
            {import.meta.env.DEV && <Route path="/wizmatch/client-discovery-new-demo" element={<WizmatchClientDiscoveryNewPage demoMode />} />}
            <Route path="/wizmatch/job-leads" element={<PrivateRoute><WizmatchWorkspaceRoute routeId="wm-signals"><WizmatchJobLeadsPage /></WizmatchWorkspaceRoute></PrivateRoute>} />
            <Route path="/wizmatch/job-leads/:signalId" element={<WizmatchEntityAliasRedirect entityType="signal" paramName="signalId" />} />
            <Route path="/wizmatch/signals/:signalId" element={<WizmatchEntityAliasRedirect entityType="signal" paramName="signalId" />} />
            <Route path="/wizmatch/client-discovery" element={<WizmatchAliasRedirect />} />
            <Route path="/wizmatch/client-discovery-new" element={<WizmatchAliasRedirect />} />
            <Route path="/wizmatch/companies" element={<PrivateRoute><WizmatchWorkspaceRoute routeId="wm-relationships"><WizmatchCompaniesPage /></WizmatchWorkspaceRoute></PrivateRoute>} />
            <Route path="/wizmatch/companies/:companyId" element={<WizmatchEntityAliasRedirect entityType="company" paramName="companyId" />} />
            <Route path="/wizmatch/relationships/:companyId" element={<WizmatchEntityAliasRedirect entityType="company" paramName="companyId" />} />
            <Route path="/wizmatch/hiring-contacts" element={<PrivateRoute><WizmatchWorkspaceRoute routeId="wm-hiring-contacts"><WizmatchHiringContactsPage /></WizmatchWorkspaceRoute></PrivateRoute>} />
            <Route path="/wizmatch/hiring-contacts/:contactId" element={<WizmatchEntityAliasRedirect entityType="contact" paramName="contactId" />} />
            <Route path="/wizmatch/contact-intelligence/:contactId" element={<WizmatchEntityAliasRedirect entityType="contact" paramName="contactId" />} />
            <Route path="/wizmatch/roles" element={<PrivateRoute><WizmatchWorkspaceRoute routeId="wm-requirements"><WizmatchRolesPage /></WizmatchWorkspaceRoute></PrivateRoute>} />
            <Route path="/wizmatch/roles/:requirementId" element={<WizmatchEntityAliasRedirect entityType="requirement" paramName="requirementId" />} />
            <Route path="/wizmatch/requirements/new" element={<WizmatchAliasRedirect />} />
            <Route path="/wizmatch/requirements/:requirementId" element={<WizmatchEntityAliasRedirect entityType="requirement" paramName="requirementId" />} />
            <Route path="/wizmatch/submissions" element={<PrivateRoute><WizmatchWorkspaceRoute routeId="wm-delivery"><WizmatchDeliveryBoardPage /></WizmatchWorkspaceRoute></PrivateRoute>} />
            <Route path="/wizmatch/submissions/:submissionId" element={<WizmatchEntityAliasRedirect entityType="submission" paramName="submissionId" />} />
            <Route path="/wizmatch/delivery/:submissionId" element={<WizmatchEntityAliasRedirect entityType="submission" paramName="submissionId" />} />
            <Route path="/wizmatch/reports" element={<PrivateRoute><WizmatchWorkspaceRoute routeId="wm-analytics-new"><WizmatchAnalyticsPage /></WizmatchWorkspaceRoute></PrivateRoute>} />
            <Route path="/wizmatch/requirements" element={<WizmatchAliasRedirect />} />
            <Route path="/wizmatch/my-work" element={<WizmatchAliasRedirect />} />
            <Route path="/wizmatch/relationships" element={<WizmatchAliasRedirect />} />
            <Route path="/wizmatch/talent-matching" element={<WizmatchAliasRedirect />} />
            <Route path="/wizmatch/delivery" element={<WizmatchAliasRedirect />} />
            {import.meta.env.DEV && <Route path="/wizmatch/requirement-priority-new-demo" element={<WizmatchRequirementPriorityPage demoMode />} />}
            <Route path="/wizmatch/requirement-priority-new" element={<WizmatchAliasRedirect />} />
            <Route path="/wizmatch/signals" element={<WizmatchAliasRedirect />} />
            {import.meta.env.DEV && <Route path="/wizmatch/candidate-intelligence-demo" element={<Navigate to="/wizmatch/candidate-intelligence-new-demo" replace />} />}
            {import.meta.env.DEV && <Route path="/wizmatch/candidate-intelligence-new-demo" element={<WizmatchCandidateIntelligenceNewPage demoMode />} />}
            <Route path="/wizmatch/candidate-intelligence" element={<WizmatchAliasRedirect />} />
            <Route path="/wizmatch/candidate-intelligence-new" element={<WizmatchAliasRedirect />} />
            <Route path="/wizmatch/candidates" element={<PrivateRoute><WizmatchWorkspaceRoute routeId="wm-talent-matching"><WizmatchCandidatesPage /></WizmatchWorkspaceRoute></PrivateRoute>} />
            <Route path="/wizmatch/candidates/:candidateId" element={<WizmatchEntityAliasRedirect entityType="candidate" paramName="candidateId" />} />
            <Route path="/wizmatch/candidate-intelligence/:candidateId" element={<WizmatchEntityAliasRedirect entityType="candidate" paramName="candidateId" />} />
            <Route path="/wizmatch/source-candidates" element={<WizmatchAliasRedirect />} />
            <Route path="/wizmatch/queue" element={<WizmatchAliasRedirect />} />
            {import.meta.env.DEV && <Route path="/wizmatch/contact-intelligence-demo" element={<Navigate to="/wizmatch/contact-intelligence-new-demo" replace />} />}
            {import.meta.env.DEV && <Route path="/wizmatch/contact-intelligence-new-demo" element={<WizmatchContactIntelligenceNewPage demoMode />} />}
            <Route path="/wizmatch/contact-intelligence" element={<WizmatchAliasRedirect />} />
            <Route path="/wizmatch/contact-intelligence-new" element={<WizmatchAliasRedirect />} />
            {/* Diagnostics — folded into the single System page (Workstream B). Old
                standalone routes redirect to the matching System tab; -demo variants
                (no auth, sample data) are unaffected. */}
            <Route path="/wizmatch/domains" element={<WizmatchAliasRedirect />} />
            <Route path="/wizmatch/compliance" element={<WizmatchAliasRedirect />} />
            {import.meta.env.DEV && <Route path="/wizmatch/guardrails-new-demo" element={<WizmatchGuardrailsPage demoMode />} />}
            <Route path="/wizmatch/guardrails-new" element={<WizmatchAliasRedirect />} />
            {import.meta.env.DEV && <Route path="/wizmatch/readiness-demo" element={<WizmatchReadinessPage demoMode />} />}
            <Route path="/wizmatch/readiness" element={<WizmatchAliasRedirect />} />
            <Route path="/wizmatch/system" element={<PrivateRoute><AppLayout><WizmatchSystemPage /></AppLayout></PrivateRoute>} />
            <Route path="/wizmatch/placements" element={<PrivateRoute><WizmatchWorkspaceRoute routeId="wm-placements"><WizmatchPlacementsPage /></WizmatchWorkspaceRoute></PrivateRoute>} />
            <Route path="/wizmatch/placements/:placementId" element={<WizmatchEntityAliasRedirect entityType="placement" paramName="placementId" />} />
            <Route path="/wizmatch/primes" element={<PrivateRoute><AppLayout><WizmatchPrimesPage /></AppLayout></PrivateRoute>} />
            {import.meta.env.DEV && <Route path="/wizmatch/analytics-demo" element={<Navigate to="/wizmatch/analytics-new-demo" replace />} />}
            {import.meta.env.DEV && <Route path="/wizmatch/analytics-new-demo" element={<WizmatchAnalyticsNewPage demoMode />} />}
            <Route path="/wizmatch/analytics" element={<WizmatchAliasRedirect />} />
            <Route path="/wizmatch/analytics-new" element={<WizmatchAliasRedirect />} />
            {import.meta.env.DEV && <Route path="/wizmatch/local-demo-flow-demo" element={<WizmatchLocalDemoFlowPage demoMode />} />}
            <Route path="/wizmatch/local-demo-flow" element={<WizmatchAliasRedirect />} />
            <Route path="/" element={<HomeRedirect />} />
            <Route path="*" element={<HomeRedirect />} />
          </Routes>
        </Suspense>
      </RouteErrorBoundary>
    </BrowserRouter>
  );
}
