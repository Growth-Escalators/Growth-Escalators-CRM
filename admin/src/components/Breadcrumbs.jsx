import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { findWizmatchRoute } from '../lib/wizmatchRouteRegistry.js';

const ROUTE_LABELS = {
  contacts: 'Contacts',
  pipeline: 'Pipeline',
  pipelines: 'Pipeline',
  settings: 'Settings',
  permissions: 'Permissions',
  automations: 'Automations',
  emails: 'Email Templates',
  billing: 'Billing',
  ads: 'Meta Ads',
  reports: 'Reports',
  social: 'Social',
  inbox: 'Inbox',
  marketing: 'Marketing',
  health: 'System Health',
  discover: 'Lead Discovery',
  audit: 'Audit Log',
  dashboard: 'Dashboard',
};

const SYSTEM_TAB_LABELS = {
  readiness: 'Readiness',
  guardrails: 'Guardrails',
  domains: 'Domains',
  compliance: 'Compliance',
  sourcing: 'Provider runs',
  permissions: 'Permissions',
};

function friendlySegment(value) {
  const decoded = decodeURIComponent(String(value || ''));
  if (/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(decoded)) return 'Details';
  return ROUTE_LABELS[decoded] || decoded
    .replaceAll('-', ' ')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function Breadcrumbs() {
  const location = useLocation();
  const parts = location.pathname.split('/').filter(Boolean);

  if (parts[0] === 'wizmatch') {
    const registered = findWizmatchRoute(location.pathname);
    const routePath = registered?.path || '/wizmatch/today';
    const routeLabel = registered?.label || (parts[1] ? friendlySegment(parts[1]) : 'Today');
    const tab = new URLSearchParams(location.search).get('tab');
    const tabLabel = routePath === '/wizmatch/system' && tab ? SYSTEM_TAB_LABELS[tab] || friendlySegment(tab) : null;
    return (
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1 text-xs text-neutral-600">
        <Link to="/wizmatch/today" className="shrink-0 hover:text-neutral-700 transition-colors">Wizmatch</Link>
        <ChevronRight className="w-3 h-3 shrink-0 text-neutral-300" />
        {tabLabel ? (
          <>
            <Link to={routePath} className="truncate hover:text-neutral-700 transition-colors">{routeLabel}</Link>
            <ChevronRight className="w-3 h-3 shrink-0 text-neutral-300" />
            <span className="truncate font-semibold text-neutral-700">{tabLabel}</span>
          </>
        ) : (
          <span className="truncate font-semibold text-neutral-700">{routeLabel}</span>
        )}
      </nav>
    );
  }

  const crumbs = parts.map((part, i) => ({
    label: friendlySegment(part),
    path: '/' + parts.slice(0, i + 1).join('/'),
    isLast: i === parts.length - 1,
  }));

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-neutral-600">
      <Link to="/" className="hover:text-neutral-700 transition-colors">CRM</Link>
      {crumbs.map((crumb, i) => (
        <React.Fragment key={i}>
          <ChevronRight className="w-3 h-3 text-neutral-300" />
          {crumb.isLast ? (
            <span className="text-neutral-700 font-semibold">{crumb.label}</span>
          ) : (
            <Link to={crumb.path} className="hover:text-neutral-700 transition-colors">{crumb.label}</Link>
          )}
        </React.Fragment>
      ))}
    </nav>
  );
}
