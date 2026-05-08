import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';

/**
 * Breadcrumb — presentational, props-driven trail.
 *
 * Distinct from Breadcrumbs.jsx (plural) which auto-derives crumbs from
 * the URL. This one expects callers to pass exactly what they want shown.
 *
 * Props:
 *   crumbs: Array<{ label: string; to?: string }>
 *
 * Items with `to` render as <Link>; without, plain <span>.
 * The last item is always bold + darker, regardless of whether it has `to`.
 */
export default function Breadcrumb({ crumbs = [] }) {
  if (!Array.isArray(crumbs) || crumbs.length === 0) return null;

  return (
    <nav className="flex items-center gap-1 text-xs text-slate-500">
      {crumbs.map((crumb, i) => {
        const isLast = i === crumbs.length - 1;
        const lastClass = isLast ? 'font-semibold text-slate-700' : '';
        const linkClass = `hover:text-slate-700 transition-colors ${lastClass}`.trim();

        return (
          <React.Fragment key={i}>
            {i > 0 && <ChevronRight className="w-3 h-3 text-slate-300" />}
            {crumb.to && !isLast ? (
              <Link to={crumb.to} className={linkClass}>{crumb.label}</Link>
            ) : crumb.to ? (
              <Link to={crumb.to} className={lastClass}>{crumb.label}</Link>
            ) : (
              <span className={lastClass}>{crumb.label}</span>
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
}
