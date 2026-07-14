import React from 'react';

// Consistent status badge coloring across all Wizmatch entity pages. Extend
// STATUS_TONE per new status string as new entities adopt this component —
// unknown statuses fall back to 'muted' rather than throwing.
const STATUS_TONE = {
  // generic
  draft: 'muted', active: 'success', inactive: 'muted', archived: 'muted',
  // requirements / signals
  new: 'info', qualifying: 'info', accepted: 'success', sourcing: 'info',
  covered: 'success', submitted: 'info', interviewing: 'warning', offer: 'warning',
  filled: 'success', on_hold: 'warning', closed_lost: 'danger', cancelled: 'danger',
  closed: 'muted', dead: 'muted', placed: 'success',
  // contact candidates
  needs_review: 'warning', approved: 'success', rejected: 'danger',
  do_not_contact: 'danger', linked_to_crm: 'success', stale: 'muted',
  // candidates
  available: 'success', benched: 'muted', unavailable: 'muted',
  // submissions/consents/offers
  requested: 'warning', granted: 'success', revoked: 'danger', withdrawn: 'muted',
  // generic fallbacks
  blocked: 'danger', pending: 'warning', succeeded: 'success', failed: 'danger', partial: 'warning',
};

export default function StatusBadge({ status, label }) {
  const tone = STATUS_TONE[status] || 'muted';
  return (
    <span className={`badge-${tone} text-[11px]`}>
      {(label || String(status || '')).replaceAll('_', ' ')}
    </span>
  );
}
