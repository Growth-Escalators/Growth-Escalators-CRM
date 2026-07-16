import React from 'react';

/**
 * Fluent Badge — the standardized 6-type status system.
 * Replaces per-page STATUS_COLORS maps.
 *
 * <Badge type="success">Matched</Badge>
 * <Badge type="accent" dot>Sent</Badge>
 */
const TYPES = {
  success: 'bg-success-50 text-success-700 border-success-200',
  warning: 'bg-warning-50 text-warning-800 border-warning-200',
  danger: 'bg-danger-50 text-danger-700 border-danger-200',
  info: 'bg-primary-50 text-primary-800 border-primary-200',
  accent: 'bg-accent-50 text-accent-700 border-accent-200',
  muted: 'bg-neutral-200 text-neutral-700 border-neutral-300',
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
