// PRD-005 §10.6.1 (ADR-006 D-6) — the WizMatch outreach-enrolment state machine.
//
// This is the single source of truth for the 15 enrolment states. The schema
// CHECK constraint, all four partial-unique-index predicates in
// src/db/schema.ts, and the resolver/gate module in
// src/services/wizmatchOutreachGate.ts all derive from these exported
// constants rather than repeating the literal list — PRD-005 §20.1 requires
// this so a future state addition cannot silently miss one of the four
// lock predicates.

/** States that HOLD the company cold-email lock. A reply does not release it (D-6). */
export const WIZMATCH_LIVE_ENROLMENT_STATES = [
  'queued',
  'exported',
  'sent',
  'replied',
  'awaiting_action',
  'positive_reply',
  'referral_received',
  'conversation_open',
] as const;

/** States that RELEASE the company cold-email lock. Only explicit, audited terminal transitions. */
export const WIZMATCH_TERMINAL_ENROLMENT_STATES = [
  'completed',
  'closed',
  'disqualified',
  'company_blocked',
  'unsubscribed',
  'contact_invalid',
  'manually_released',
] as const;

export const WIZMATCH_ALL_ENROLMENT_STATES = [
  ...WIZMATCH_LIVE_ENROLMENT_STATES,
  ...WIZMATCH_TERMINAL_ENROLMENT_STATES,
] as const;

export type WizmatchLiveEnrolmentState = (typeof WIZMATCH_LIVE_ENROLMENT_STATES)[number];
export type WizmatchTerminalEnrolmentState = (typeof WIZMATCH_TERMINAL_ENROLMENT_STATES)[number];
export type WizmatchEnrolmentState = (typeof WIZMATCH_ALL_ENROLMENT_STATES)[number];

export function isLiveEnrolmentState(state: string): state is WizmatchLiveEnrolmentState {
  return (WIZMATCH_LIVE_ENROLMENT_STATES as readonly string[]).includes(state);
}

export function isTerminalEnrolmentState(state: string): state is WizmatchTerminalEnrolmentState {
  return (WIZMATCH_TERMINAL_ENROLMENT_STATES as readonly string[]).includes(state);
}

/** Builds a Postgres `'a','b','c'` literal list for use inside a raw SQL `IN (...)` clause. */
function toSqlLiteralList(values: readonly string[]): string {
  return values.map((v) => `'${v}'`).join(',');
}

export const WIZMATCH_LIVE_STATES_SQL_LIST = toSqlLiteralList(WIZMATCH_LIVE_ENROLMENT_STATES);
export const WIZMATCH_ALL_STATES_SQL_LIST = toSqlLiteralList(WIZMATCH_ALL_ENROLMENT_STATES);
