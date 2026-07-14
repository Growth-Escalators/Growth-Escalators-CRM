import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { WIZMATCH_ROUTES } from '../routes/wizmatchRouteRegistry.ts';
import { getProductHome } from '../lib/auth.js';

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

// Wizmatch path labels are sourced from the shared route registry, keyed by
// the FULL cumulative path (not bare segment) so two different routes that
// happen to share a final segment — e.g. /wizmatch/settings/audit and
// /wizmatch/pipelines/settings both ending in a "settings"-like segment —
// never collide. Covers legacy aliases too, so an old bookmark (e.g.
// /wizmatch/signals) still renders its current friendly label ("Job Leads").
const WIZMATCH_PATH_LABELS = {};
for (const route of WIZMATCH_ROUTES) {
  for (const path of [route.path, ...route.legacyAliases]) {
    WIZMATCH_PATH_LABELS[path.split('?')[0]] = route.breadcrumb.label;
  }
}

export default function Breadcrumbs() {
  const location = useLocation();
  const parts = location.pathname.split('/').filter(Boolean);
  const isWizmatch = parts[0] === 'wizmatch';
  const rootLabel = isWizmatch ? 'Wizmatch' : 'CRM';
  const rootPath = isWizmatch ? getProductHome('wizmatch') : '/';

  const crumbs = parts.map((part, i) => {
    const cumulativePath = '/' + parts.slice(0, i + 1).join('/');
    return {
      label: (isWizmatch && WIZMATCH_PATH_LABELS[cumulativePath]) || ROUTE_LABELS[part] || part.charAt(0).toUpperCase() + part.slice(1),
      path: cumulativePath,
      isLast: i === parts.length - 1,
    };
  });

  return (
    <nav className="flex items-center gap-1 text-xs text-neutral-400">
      <Link to={rootPath} className="hover:text-neutral-700 transition-colors">{rootLabel}</Link>
      {crumbs.filter((_, i) => !(isWizmatch && i === 0)).map((crumb, i) => (
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
