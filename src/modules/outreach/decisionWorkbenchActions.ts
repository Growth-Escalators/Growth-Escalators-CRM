// PRD-005 PR 6 §12 "Decision workbench" API — POST /api/wizmatch/today/actions.
//
// Every contextual action in the workbench (approve/skip/pause/resume/
// block/reject/assign owner/set review date/merge/confirm separate) is
// implemented as a call into the EXISTING PR 4 write services
// (`policyService.ts`, `duplicateService.ts`) — this file adds no new write
// path, no new eligibility computation, and no new suppression/enrolment
// mutation. It is the "contextual action" layer the PRD asks for, not a
// second gate.
//
// Server-side re-validation and stale/mixed-selection rejection are
// inherited, not reimplemented:
//   - `writeCompanyPolicy` re-reads the active row inside its own
//     transaction and throws `PolicyOverrideRefusedError` (409) if the
//     predecessor is non-overridable — a target that became unblockable
//     since the page loaded is rejected here, per-target, not silently
//     allowed.
//   - `resolveDuplicate` updates `WHERE resolution = 'pending'` as part of
//     the statement itself, so a duplicate already resolved by someone else
//     loses the race and throws `already_resolved` — the exact "reject
//     stale selections" behaviour this endpoint requires.
//   - `assignAccountOwner` re-validates the candidate owner is same-tenant.
//
// Every target is processed independently and its own try/catch — one
// target's failure never aborts or silently drops another (§12 "per-target
// result[]; partial success reported, never silently swallowed"), mirroring
// the exact pattern `bulkWriteCompanyPolicy` (PR 4) already established.

import {
  writeCompanyPolicy,
  assignAccountOwner,
  PolicyValidationError,
  PolicyOverrideRefusedError,
  type PolicyActor,
  type PolicyWriteInput,
} from './policyService';
import { resolveDuplicate, DuplicateValidationError } from './duplicateService';
import { resolveEffectivePolicy } from './policyResolver';
import type { EvidenceKind } from './policyTypes';

export type TodayActionType =
  | 'approve_queue'
  | 'skip'
  | 'pause'
  | 'resume'
  | 'block'
  | 'reject'
  | 'assign_owner'
  | 'set_review_date'
  | 'merge'
  | 'confirm_separate';

/**
 * The route's actor plus the caller's role. The role is required here, not only
 * at the route, because PRD-005 §4 distinguishes "write a policy row"
 * (team_lead) from "admin override of a `standard` block" (admin) by the
 * PREDECESSOR state — which only this layer reads.
 */
export interface TodayActor extends PolicyActor {
  role?: string;
}

export type TodayActionTargetType = 'company' | 'duplicate';

export interface TodayActionTarget {
  type: TodayActionTargetType;
  id: string;
}

export interface TodayActionRequest {
  action: TodayActionType;
  targets: TodayActionTarget[];
  reasonCode?: string;
  reason?: string;
  evidenceKind?: EvidenceKind;
  evidenceText?: string;
  evidenceUrl?: string;
  evidenceRef?: string;
  reviewDate?: string;
  ownerUserId?: string;
}

export interface TodayActionResult {
  type: TodayActionTargetType;
  id: string;
  ok: boolean;
  error?: string;
  code?: string;
}

export interface TodayActionsOutcome {
  requested: number;
  succeeded: number;
  failed: number;
  results: TodayActionResult[];
}

export class TodayActionValidationError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'TodayActionValidationError';
    this.code = code;
  }
}

const DUPLICATE_TARGET_ACTIONS: TodayActionType[] = ['merge', 'confirm_separate'];

const ACTION_DEFAULT_REASON_CODE: Partial<Record<TodayActionType, string>> = {
  approve_queue: 'manual_approved_by_operator',
  skip: 'manual_skip_for_now',
  pause: 'manual_pause_by_operator',
  resume: 'manual_reclassified',
  block: 'manual_block_by_operator',
  reject: 'manual_block_by_operator',
  merge: 'manual_reclassified',
  confirm_separate: 'manual_reclassified',
};

const VALID_ACTIONS: TodayActionType[] = [
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

function expectedTargetTypeFor(action: TodayActionType): TodayActionTargetType {
  return DUPLICATE_TARGET_ACTIONS.includes(action) ? 'duplicate' : 'company';
}

/**
 * Rejects the WHOLE request (not per-target) when the action/target-type
 * combination is nonsensical — e.g. `merge` against a `company` target, or an
 * empty selection. This is the "reject mixed-invalid selections" half of the
 * contract; per-target staleness (a row that changed between page load and
 * submit) is handled per-target below, not here.
 */
function validateRequestShape(request: TodayActionRequest): void {
  if (!VALID_ACTIONS.includes(request.action)) {
    throw new TodayActionValidationError(`Unknown action '${request.action}'.`, 'unknown_action');
  }
  if (!Array.isArray(request.targets) || request.targets.length === 0) {
    throw new TodayActionValidationError('targets must be a non-empty array.', 'targets_required');
  }
  const expected = expectedTargetTypeFor(request.action);
  for (const target of request.targets) {
    if (!target || target.type !== expected || typeof target.id !== 'string' || target.id.trim() === '') {
      throw new TodayActionValidationError(
        `action '${request.action}' requires every target to be of type '${expected}' with a non-empty id.`,
        'mixed_invalid_targets',
      );
    }
  }
  if ((request.action === 'block' || request.action === 'reject') &&
    !(request.evidenceKind && (request.evidenceText?.trim() || request.evidenceUrl?.trim() || request.evidenceRef?.trim()))) {
    throw new TodayActionValidationError(
      'block/reject requires evidenceKind plus one of evidenceText/evidenceUrl/evidenceRef.',
      'evidence_required',
    );
  }
  if ((request.action === 'pause' || request.action === 'set_review_date') && !request.reviewDate) {
    throw new TodayActionValidationError(`${request.action} requires reviewDate.`, 'review_date_required');
  }
  if (request.action === 'assign_owner' && !request.ownerUserId) {
    throw new TodayActionValidationError('assign_owner requires ownerUserId.', 'owner_user_id_required');
  }
}

/** Actions that move a company OFF a `blocked` root row — i.e. an override of a standard block. */
const UNBLOCKING_ACTIONS: TodayActionType[] = ['approve_queue', 'resume', 'skip', 'pause'];

async function applyCompanyEligibilityAction(
  actor: TodayActor,
  companyId: string,
  request: TodayActionRequest,
): Promise<void> {
  if (request.action === 'assign_owner') {
    await assignAccountOwner(actor, companyId, request.ownerUserId as string);
    return;
  }

  // Re-reads the CURRENT root row for this company at call time — the
  // server-side re-validation the bulk contract requires. A company whose
  // root row was superseded (or blocked non-overridably) since the page
  // loaded is caught here or by `writeCompanyPolicy` itself, per-target.
  const effective = await resolveEffectivePolicy(actor.tenantId, companyId, {
    tenantId: actor.tenantId,
    action: 'enrol',
    companyId,
  });
  const root = effective.rootRow;
  if (!root) {
    throw new TodayActionValidationError('This company has no root policy row yet (policy_missing_root).', 'policy_missing_root');
  }

  // PRD-005 §4: "Write a policy row (approve/pause/block/reclassify)" is
  // team_lead, but "Admin override of a `standard` block" is ADMIN. The two
  // are distinguished by the PREDECESSOR state, which this layer must read —
  // the route can only see the action name. Without this, a team_lead could
  // one-click "Approve & Queue" a blocked company straight to `eligible` with
  // no evidence, because `writeCompanyPolicy` only refuses non-overridable
  // predecessors. The endpoint was even telling the operator otherwise:
  // "This company is blocked by policy. Reclassify requires an admin."
  if (root.outreachEligibility === 'blocked'
    && UNBLOCKING_ACTIONS.includes(request.action)
    && actor.role !== 'admin') {
    throw new TodayActionValidationError(
      'Overriding a block requires an admin.',
      'requires_admin_override',
    );
  }

  const reasonCode = request.reasonCode || ACTION_DEFAULT_REASON_CODE[request.action] || 'manual_reclassified';
  // Carry the predecessor's protective attributes forward. `writeCompanyPolicy`
  // writes what it is given and defaults the rest (`isPermanent: false`,
  // `blockClass: 'standard'`), so rebuilding the row from the request alone
  // silently downgraded a permanent compliance block to a temporary standard
  // one — and dropped its evidence — on something as innocuous as Set Review Date.
  const base: Omit<PolicyWriteInput, 'outreachEligibility'> = {
    scopeType: 'entire_company',
    externalHiringPolicy: root.externalHiringPolicy ?? 'unknown',
    relationshipType: root.relationshipType ?? 'new_prospect',
    isPermanent: root.isPermanent ?? undefined,
    blockClass: root.blockClass ?? undefined,
    reasonCode,
    reason: request.reason,
    evidenceKind: request.evidenceKind ?? root.evidenceKind ?? undefined,
    evidenceText: request.evidenceText ?? root.evidenceText ?? undefined,
    evidenceUrl: request.evidenceUrl ?? root.evidenceUrl ?? undefined,
    evidenceRef: request.evidenceRef ?? root.evidenceRef ?? undefined,
    reviewDate: request.reviewDate,
  };

  switch (request.action) {
    case 'approve_queue':
      await writeCompanyPolicy(actor, companyId, { ...base, outreachEligibility: 'eligible' });
      return;
    case 'skip':
      await writeCompanyPolicy(actor, companyId, { ...base, outreachEligibility: 'needs_review' });
      return;
    case 'pause':
      await writeCompanyPolicy(actor, companyId, { ...base, outreachEligibility: 'paused' });
      return;
    case 'resume':
      await writeCompanyPolicy(actor, companyId, { ...base, outreachEligibility: 'needs_review' });
      return;
    case 'block':
    case 'reject':
      await writeCompanyPolicy(actor, companyId, { ...base, outreachEligibility: 'blocked' });
      return;
    case 'set_review_date':
      await writeCompanyPolicy(actor, companyId, { ...base, outreachEligibility: root.outreachEligibility ?? 'needs_review' });
      return;
    default:
      throw new TodayActionValidationError(`Action '${request.action}' is not a company-target action.`, 'unsupported_action');
  }
}

async function applyDuplicateAction(actor: TodayActor, duplicateId: string, request: TodayActionRequest): Promise<void> {
  const resolution = request.action === 'merge' ? ('merged' as const) : ('confirmed_separate' as const);
  const reasonCode = request.reasonCode || ACTION_DEFAULT_REASON_CODE[request.action] || 'manual_reclassified';
  await resolveDuplicate(actor, duplicateId, { resolution, reasonCode, evidence: request.evidenceText || request.reason });
}

function messageAndCodeFor(error: unknown): { message: string; code?: string } {
  if (error instanceof PolicyValidationError) return { message: error.message, code: error.code };
  if (error instanceof PolicyOverrideRefusedError) return { message: error.message, code: 'override_refused' };
  if (error instanceof DuplicateValidationError) return { message: error.message, code: error.code };
  if (error instanceof TodayActionValidationError) return { message: error.message, code: error.code };
  if (error instanceof Error) return { message: error.message };
  return { message: String(error) };
}

/**
 * The sole entry point for `POST /api/wizmatch/today/actions`. Validates the
 * whole-request shape first (rejects a mixed or empty selection outright),
 * then processes every target independently so one bad target cannot hide
 * or abort the rest.
 */
export async function runTodayActions(actor: TodayActor, request: TodayActionRequest): Promise<TodayActionsOutcome> {
  validateRequestShape(request);

  const results: TodayActionResult[] = [];
  for (const target of request.targets) {
    try {
      if (target.type === 'company') {
        await applyCompanyEligibilityAction(actor, target.id, request);
      } else {
        await applyDuplicateAction(actor, target.id, request);
      }
      results.push({ type: target.type, id: target.id, ok: true });
    } catch (error) {
      const { message, code } = messageAndCodeFor(error);
      results.push({ type: target.type, id: target.id, ok: false, error: message, code });
    }
  }

  return {
    requested: request.targets.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}
