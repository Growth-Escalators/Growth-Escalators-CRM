// PR 8B (P8B-2) — "UI action honesty". One backend-computed answer to
// "can this actor take this action on this item, and if not, why not", so the
// workbench renders capabilities instead of guessing at them.
//
// This file is a PURE FUNCTION over an item the API already built plus the
// caller's role. It issues no query and it is NOT the enforcement path: the
// authoritative checks stay exactly where they are — the route-level role
// allow-list in `src/routes/wizmatchToday.ts` and the per-target checks inside
// `decisionWorkbenchActions.ts` (which re-reads current state in its own
// transaction and can therefore refuse things this function, working from a
// possibly-stale item, would have shown as enabled). A capability that says
// `enabled: true` is a prediction; the server still gets the final word.
//
// It exists because this codebase has repeatedly paid for two independent rule
// engines drifting apart. The rules below are deliberately a single mirrored
// transcription of the enforcement path, kept in one place, rather than a
// second rule set scattered through JSX.

import type {
  DecisionWorkbenchCompanyItem,
  DecisionWorkbenchSignalItem,
  DecisionWorkbenchContactItem,
} from './decisionWorkbench';
import type { TodayActionType } from './decisionWorkbenchActions';

export interface TodayActionCapability {
  enabled: boolean;
  /** Operator-facing explanation. Non-null exactly when `enabled` is false. */
  reason: string | null;
}

export type TodayActionCapabilities = Record<TodayActionType, TodayActionCapability>;

export type CapabilityContext = 'single' | 'bulk';

const ALL_ACTIONS: TodayActionType[] = [
  'approve_queue',
  'skip',
  'pause',
  'resume',
  'block',
  'reject',
  'assign_owner',
  'set_review_date',
  'merge',
  'confirm_separate',
];

/** Mirrors `decisionWorkbenchActions.ts` UNBLOCKING_ACTIONS. */
const UNBLOCKING_ACTIONS: TodayActionType[] = ['approve_queue', 'resume', 'skip', 'pause'];

/** Mirrors `decisionWorkbenchActions.ts` DUPLICATE_TARGET_ACTIONS. */
const DUPLICATE_TARGET_ACTIONS: TodayActionType[] = ['merge', 'confirm_separate'];

/**
 * Mirrors the route-level allow-list in `src/routes/wizmatchToday.ts`
 * (`allowedRoles = isBulk ? ['admin'] : ['admin', 'team_lead']`). A request
 * carrying more than one target IS a bulk action there, whatever it is named,
 * which is why the context — not the action — selects the list.
 */
const ROLES_BY_CONTEXT: Record<CapabilityContext, readonly string[]> = {
  single: ['admin', 'team_lead'],
  bulk: ['admin'],
};

/**
 * Scope kinds at which a non-overridable block removes COMPANY-level actions.
 * P8B-1: a non-overridable block scoped to one signal or one requirement
 * constrains that signal/requirement only — it must not disable company-level
 * unblocking actions, which the pre-P8B-1 code wrongly did by matching any
 * active non-overridable row at any scope.
 */
type NonOverridableBlockKind = 'signal' | 'requirement' | 'company_scope';

/**
 * The policy lane (P8B-1) is adding `nonOverridableBlockKind` to
 * `DecisionWorkbenchCompanyItem`. Prefer it when present; otherwise derive the
 * same answer from the already-shipped `nonOverridableScopeKey`, whose format
 * is fixed by `buildScopeKey()` (`entire_company` or `<scopeType>:<ref>`).
 * An unrecognised or missing key falls back to `company_scope` — the
 * restrictive answer — so a shape change can only ever over-disable.
 */
function nonOverridableBlockKindOf(item: DecisionWorkbenchCompanyItem): NonOverridableBlockKind | null {
  if (!item.isNonOverridable) return null;
  const declared = (item as { nonOverridableBlockKind?: NonOverridableBlockKind | null }).nonOverridableBlockKind;
  if (declared) return declared;
  const scopeKey = item.nonOverridableScopeKey || '';
  if (scopeKey.startsWith('specific_signal:')) return 'signal';
  if (scopeKey.startsWith('specific_requirement:')) return 'requirement';
  return 'company_scope';
}

function allow(): TodayActionCapability {
  return { enabled: true, reason: null };
}

function deny(reason: string): TodayActionCapability {
  return { enabled: false, reason };
}

/**
 * Predicts the outcome of a single action, in the same order the enforcement
 * path applies its checks, so the reason shown is the reason the server would
 * actually give.
 */
function capabilityFor(
  action: TodayActionType,
  item: DecisionWorkbenchCompanyItem,
  actorRole: string | undefined,
  context: CapabilityContext,
): TodayActionCapability {
  const allowedRoles = ROLES_BY_CONTEXT[context];
  if (!actorRole || !allowedRoles.includes(actorRole)) {
    return deny(context === 'bulk'
      ? 'Bulk actions require admin.'
      : 'This action requires team_lead or admin.');
  }

  if (DUPLICATE_TARGET_ACTIONS.includes(action)) {
    if (!item.duplicatePending || !item.duplicateId) {
      return deny('There is no pending duplicate on this company to resolve.');
    }
    return allow();
  }

  const blockKind = nonOverridableBlockKindOf(item);
  if (blockKind === 'company_scope' && UNBLOCKING_ACTIONS.includes(action)) {
    const where = item.nonOverridableScopeKey && item.nonOverridableScopeKey !== 'entire_company'
      ? ` at scope '${item.nonOverridableScopeKey}'`
      : '';
    return deny(`This company has a non-overridable block${where}. No override, resume or reclassify action is available at any scope.`);
  }

  if (item.outreachEligibility === 'blocked'
    && UNBLOCKING_ACTIONS.includes(action)
    && actorRole !== 'admin') {
    return deny('Overriding a block requires an admin.');
  }

  if (action === 'approve_queue' && item.outreachEligibility === 'eligible') {
    return deny('This company is already eligible; the approval was already recorded.');
  }

  // Mirrors the `policy_dimension_unresolved` precondition: this action rewrites
  // the root row verbatim apart from the review date, so it refuses outright
  // rather than defaulting a missing dimension to a cold-start value.
  if (action === 'set_review_date'
    && !(item.outreachEligibility && item.externalHiringPolicy && item.relationshipType && item.policyReasonCode)) {
    return deny("This company's policy row is missing a required field; its review date cannot be changed until the policy is fully resolved.");
  }

  return allow();
}

export function computeTodayActionCapabilities(
  item: DecisionWorkbenchCompanyItem,
  actorRole: string | undefined,
  context: CapabilityContext,
): TodayActionCapabilities {
  const capabilities = {} as TodayActionCapabilities;
  for (const action of ALL_ACTIONS) {
    capabilities[action] = capabilityFor(action, item, actorRole, context);
  }
  return capabilities;
}

/**
 * The bulk bar is a pure role gate (the route treats >1 target as admin-only
 * regardless of action or per-item state), so the UI asks this once per page
 * rather than reconciling N selected items with different individual states.
 */
export function computeBulkCapability(actorRole: string | undefined): TodayActionCapability {
  return ROLES_BY_CONTEXT.bulk.includes(actorRole || '')
    ? allow()
    : deny('Bulk actions require admin.');
}

// ---------------------------------------------------------------------------
// Signals and contacts.
//
// Two SIBLING functions rather than new branches inside `capabilityFor`.
// `computeTodayActionCapabilities` predicts `runTodayActions`, whose target
// union is closed at `company | duplicate` and whose per-target results carry
// a failure `code`; signals and contacts go to entirely different endpoints
// (`POST /signals/bulk-action`, `POST /contact-intelligence/contacts/bulk-review`)
// with a different envelope and no `code` at all. Folding them into the
// company predictor would make one function claim to mirror three unrelated
// enforcement paths — and it is pinned by parity tests against exactly one of
// them (`wizmatchCapabilityEnforcementParity.test.ts`).
//
// The role gate is IDENTICAL and deliberately shares `ROLES_BY_CONTEXT`,
// because both endpoints reuse `allowBulkRole` in `src/routes/wizmatch.ts`,
// which is a transcription of the same `/today/actions` split.
// ---------------------------------------------------------------------------

export type SignalActionType = 'qualify' | 'reject';
export type SignalActionCapabilities = Record<SignalActionType, TodayActionCapability>;

export type ContactActionType = 'approve' | 'reject';
export type ContactActionCapabilities = Record<ContactActionType, TodayActionCapability>;

const SIGNAL_ACTIONS: SignalActionType[] = ['qualify', 'reject'];
const CONTACT_ACTIONS: ContactActionType[] = ['approve', 'reject'];

/**
 * Terminal signal statuses. `qualifySignalAndCreatePocTask` refuses these
 * itself (`... AND status NOT IN ('dead','placed')`), so predicting `qualify`
 * as enabled on them would offer a click guaranteed to come back "Signal not
 * found or not qualifiable".
 *
 * `rejectSignal` carries NO such guard — it would happily overwrite a
 * `placed` signal with `dead`. That is the more dangerous of the two, so
 * `reject` is denied here as well.
 */
const SIGNAL_TERMINAL_STATUSES = new Set(['dead', 'placed']);

/**
 * Contact-candidate statuses that mean "a human already decided this".
 *
 * `applyContactCandidateReview` does NOT refuse a repeat review: it resolves
 * the transition with a hardcoded `currentContactStatus: 'needs_review'` and
 * updates on `(tenant_id, id)` alone, so re-approving a rejected candidate
 * succeeds and silently overwrites the earlier decision and its reviewer.
 * This deny is therefore a UI-side idempotency guard over an endpoint that
 * has none — the safe direction for a predictor (it can only over-disable),
 * but it is a prediction and not enforcement, exactly as this file's header
 * says of every answer here.
 */
const CONTACT_REVIEWED_STATUSES = new Set(['approved', 'rejected', 'do_not_contact', 'linked_to_crm']);

export function computeSignalActionCapabilities(
  item: Pick<DecisionWorkbenchSignalItem, 'status'>,
  actorRole: string | undefined,
  context: CapabilityContext,
): SignalActionCapabilities {
  const allowedRoles = ROLES_BY_CONTEXT[context];
  const capabilities = {} as SignalActionCapabilities;
  for (const action of SIGNAL_ACTIONS) {
    if (!actorRole || !allowedRoles.includes(actorRole)) {
      capabilities[action] = deny(context === 'bulk'
        ? 'Bulk actions require admin.'
        : 'This action requires team_lead or admin.');
      continue;
    }
    capabilities[action] = SIGNAL_TERMINAL_STATUSES.has(item.status)
      ? deny(`This signal is already ${item.status}; it has been decided and cannot be qualified or rejected again.`)
      : allow();
  }
  return capabilities;
}

export function computeContactActionCapabilities(
  item: Pick<DecisionWorkbenchContactItem, 'status'>,
  actorRole: string | undefined,
  context: CapabilityContext,
): ContactActionCapabilities {
  const allowedRoles = ROLES_BY_CONTEXT[context];
  const capabilities = {} as ContactActionCapabilities;
  for (const action of CONTACT_ACTIONS) {
    if (!actorRole || !allowedRoles.includes(actorRole)) {
      capabilities[action] = deny(context === 'bulk'
        ? 'Bulk actions require admin.'
        : 'This action requires team_lead or admin.');
      continue;
    }
    capabilities[action] = CONTACT_REVIEWED_STATUSES.has(item.status)
      ? deny(`This contact was already reviewed (${item.status}). Reviewing it again would overwrite that decision.`)
      : allow();
  }
  return capabilities;
}
