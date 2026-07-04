import React from 'react';

/**
 * Fluent Badge — the standardized 6-type status system.
 * Replaces per-page STATUS_COLORS maps.
 *
 * <Badge type="success">Matched</Badge>
 * <Badge type="accent" dot>Sent</Badge>
 */
const TYPES = {
  success: 'bg-success-500/10 text-success-600 border-success-500/20',
  warning: 'bg-warning-500/10 text-warning-700 border-warning-500/20',
  danger: 'bg-danger-500/10 text-danger-600 border-danger-500/20',
  info: 'bg-primary-500/10 text-primary-700 border-primary-500/20',
  accent: 'bg-accent-500/10 text-accent-700 border-accent-500/20',
  muted: 'bg-neutral-200 text-neutral-500 border-neutral-300',
};

const DOTS = {
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
  info: 'bg-primary-500',
  accent: 'bg-accent-500',
  muted: 'bg-neutral-400',
};

// Map raw backend statuses to badge types once, app-wide.
export const STATUS_TYPE = {
  new: 'info', scored: 'info', enriched: 'info', matched: 'success',
  drafted: 'warning', sent: 'accent', replied_positive: 'success',
  replied_other: 'muted', dead: 'muted', placed: 'success',
  active: 'success', pending: 'warning', overdue: 'danger',
};

export default function Badge({ type = 'info', dot = false, className = '', children }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border
        ${TYPES[type] ?? TYPES.info} ${className}`}
    >
      {dot && <span className={`w-1.5 h-1.5 rounded-full ${DOTS[type] ?? DOTS.info}`} />}
      {children}
    </span>
  );
}

/** Convenience: <StatusBadge status="replied_positive" /> */
export function StatusBadge({ status }) {
  return <Badge type={STATUS_TYPE[status] ?? 'muted'}>{String(status ?? '—').replace(/_/g, ' ')}</Badge>;
}
