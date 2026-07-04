import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

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

export default function Breadcrumbs() {
  const location = useLocation();
  const parts = location.pathname.split('/').filter(Boolean);

  const crumbs = parts.map((part, i) => ({
    label: ROUTE_LABELS[part] || part.charAt(0).toUpperCase() + part.slice(1),
    path: '/' + parts.slice(0, i + 1).join('/'),
    isLast: i === parts.length - 1,
  }));

  return (
    <nav className="flex items-center gap-1 text-xs text-neutral-400">
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
