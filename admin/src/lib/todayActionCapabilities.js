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
