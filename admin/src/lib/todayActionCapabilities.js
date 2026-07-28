// PR 8B (P8B-2) — client-side reading of the capability answer the backend
// attaches to each Today queue item (src/modules/outreach/decisionWorkbenchCapabilities.ts).
//
// These helpers contain NO rule of their own; they only read an answer that
// already exists and decide what to do when it is missing or malformed. That
// case FAILS CLOSED: a response with no `capabilities` object, a non-object
// capabilities value, or an entry missing `enabled === true` renders the action
// disabled. Showing an action as available on data we could not interpret is
// exactly the dishonesty P8B-2 exists to remove — and it is the same posture
// `normalizeStaffingAccess` already takes for staffing phases.

const UNKNOWN = Object.freeze({
  enabled: false,
  reason: 'Unable to determine permissions for this action. Refresh the page.',
});

export function capabilityFor(item, action) {
  const capabilities = item?.capabilities;
  if (!capabilities || typeof capabilities !== 'object') return UNKNOWN;
  const capability = capabilities[action];
  if (!capability || typeof capability !== 'object') return UNKNOWN;
  if (capability.enabled !== true) {
    return { enabled: false, reason: capability.reason || UNKNOWN.reason };
  }
  return { enabled: true, reason: null };
}

export function resolveBulkCapability(capability) {
  if (!capability || typeof capability !== 'object') return UNKNOWN;
  if (capability.enabled !== true) {
    return { enabled: false, reason: capability.reason || 'Bulk actions require admin.' };
  }
  return { enabled: true, reason: null };
}

// H-6 / M-0 / M-1 remediation — the bulk action bar must answer "can THIS
// selection take this action", not "is this actor role-eligible for bulk in
// general". `bulkCapability` (from `resolveBulkCapability`) is a pure ROLE
// gate computed once per response; it says nothing about whether the rows the
// operator actually selected would individually accept the action. Before
// this function existed the bar rendered every button from `bulkCapability`
// alone, which produced two dishonest states:
//   - H-6: selecting only non-overridable-blocked rows (the "Paused or
//     Blocked" queue's own `resume` bulk action) rendered ENABLED for an
//     admin, even though the server refuses every one of those targets
//     individually — the bar offered an action guaranteed to fail on every
//     row in the selection.
//   - M-0/M-1: a `team_lead` selecting exactly ONE row was told "Bulk actions
//     require admin", even though a single-target request is not a bulk
//     action server-side at all (`isBulk = targets.length > 1` in
//     wizmatchToday.ts) and the server accepts it from that role.
//
// Fails closed on the same idiom as `capabilityFor`/`resolveBulkCapability`
// above: no selection, or a non-array selection, resolves to UNKNOWN.
export function resolveSelectionCapability(selection, action, bulkCapability) {
  if (!Array.isArray(selection) || selection.length === 0) return UNKNOWN;

  // A single-target request is never "bulk" server-side (isBulk requires
  // more than one target), so it must be answered from that ONE row's own
  // single-context capability — never from the bulk role gate, which would
  // wrongly reject a team_lead who the server would accept.
  if (selection.length === 1) return capabilityFor(selection[0], action);

  // More than one target IS bulk server-side regardless of what any
  // individual row looks like — the role gate is checked first and, when it
  // fails, short-circuits before any per-row intersection is computed. A
  // team_lead must not see bulk enabled merely because every selected row
  // happens to individually permit the action.
  const roleGate = resolveBulkCapability(bulkCapability);
  if (!roleGate.enabled) return roleGate;

  const denials = selection
    .map((item) => capabilityFor(item, action))
    .filter((capability) => !capability.enabled);
  if (denials.length === 0) return { enabled: true, reason: null };

  const distinctReasons = [...new Set(denials.map((d) => d.reason))];
  if (denials.length === selection.length) {
    // Every selected row denies this action — surface the SPECIFIC reason
    // (e.g. a non-overridable block) rather than the generic bulk-admin
    // message, so the operator sees why the action is unavailable, not just
    // that it is.
    return { enabled: false, reason: distinctReasons[0] || 'This action is not available for the selected companies.' };
  }
  return {
    enabled: false,
    reason: `${denials.length} of ${selection.length} selected companies do not permit this action`
      + (distinctReasons.length === 1 ? `: ${distinctReasons[0]}` : '.'),
  };
}
