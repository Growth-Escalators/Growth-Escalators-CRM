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
  // WizMatch outreach policy (PRD-005 §8.2/§10.3) — outreach_eligibility and
  // duplicate resolution values not already covered above.
  eligible: 'success', paused: 'warning', merged: 'success', confirmed_separate: 'muted',
  // PR 8A hardening (task 9) — the Decision Workbench passes the canonical
  // resolver's own `decision` string ('allow'|'review'|'deny') straight into
  // this component. None of the three were keys here, so every one fell
  // back to `muted` — a denied company rendered with the SAME neutral grey
  // badge as an unrecognised status, which is exactly what "denied must
  // never fall back to a neutral badge" forbids.
  allow: 'success', review: 'warning', deny: 'danger',
  // Explicit, distinct treatment for states beyond a plain decision: the
  // shadow-vs-canonical divergence badge and a routed/assigned item.
  // Non-overridable is folded into the SAME badge as the decision (a
  // relabelled `deny`, not a second `badge-danger` element) rather than a
  // standalone tone — `badge-danger`'s shared CSS already fails the repo's
  // own color-contrast check (recorded, not fixed, in the PR 6 review —
  // editing a class used by dozens of other pages is out of scope here), so
  // a second `badge-danger` on the same row multiplies a known defect
  // instead of adding a new one.
  shadow_would_block: 'info',
  // A stale (policy changed since load) workbench item. Deliberately its OWN
  // key — `stale` above already means "an old contact candidate" for the
  // contact-candidate pages, a different concept with a different tone
  // (`muted`), so reusing it here would silently recolour that badge too.
  stale_policy_state: 'warning',
  routed: 'info',
};

export default function StatusBadge({ status, label }) {
  const tone = STATUS_TONE[status] || 'muted';
  return (
    <span className={`badge-${tone} text-[11px]`}>
      {(label || String(status || '')).replaceAll('_', ' ')}
    </span>
  );
}
