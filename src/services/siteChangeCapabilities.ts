/**
 * What an operator may do to one site change, computed ONCE on the server.
 *
 * WHY THIS EXISTS AS ITS OWN MODULE. PR 8A's review found the WizMatch
 * workbench "showed actions a `staff` member's role always 403s" — the
 * frontend had its own idea of what was allowed and the backend had another,
 * so the UI offered buttons the API rejected. The fix there was one canonical
 * backend-computed capability calculation the UI renders from directly, and
 * this is the same pattern for site changes.
 *
 * The rule: the UI must NEVER decide whether an action is available. It reads
 * `capabilities` off the row. If a button is enabled here and the route
 * refuses it, that is a bug in this file, not in the route — which is the
 * point, because there is then exactly one place to fix it.
 *
 * PURE. No I/O, no clock beyond an injected `now`, no pool import. Every
 * branch is unit-testable with a plain object.
 */
import {
  isTerminalSiteChangeStatus,
  nextSiteChangeStatus,
  type SiteChange,
  type SiteChangeStatus,
} from './siteChangeService';

/** The actions the approvals UI can offer. Deliberately NOT the same list as SiteChangeEvent — these are operator intents, not state-machine edges. */
export const SITE_CHANGE_ACTIONS = ['stage', 'verify', 'approve', 'reject', 'publish', 'complete_handoff'] as const;
export type SiteChangeAction = (typeof SITE_CHANGE_ACTIONS)[number];

export interface SiteChangeCapability {
  readonly enabled: boolean;
  /** Shown to the operator when disabled. Never blank — an unexplained disabled control is the defect PR 8A's H-2 was about. */
  readonly reason: string | null;
}

export type SiteChangeCapabilities = Readonly<Record<SiteChangeAction, SiteChangeCapability>>;

/** The subset of a role model this calculation needs. Roles come from the caller's session, never from the request body. */
export interface SiteChangeActor {
  readonly role: string;
}

const ALLOWED = Object.freeze({ enabled: true, reason: null });

function denied(reason: string): SiteChangeCapability {
  return Object.freeze({ enabled: false, reason });
}

/**
 * Who may take a decision that reaches a live website.
 *
 * `admin` only, deliberately. This is narrower than the routes' general read
 * access on purpose: approving a change is the act the entire hard-stop design
 * exists to make deliberate, and widening it is a decision for a human, not a
 * default. Broadening this list must come with a written reason.
 */
const DECISION_ROLES: ReadonlySet<string> = new Set(['admin']);

export function canDecideSiteChanges(actor: SiteChangeActor): boolean {
  return DECISION_ROLES.has(actor.role);
}

/**
 * Computes every action's availability for one change.
 *
 * Order of checks matters: a terminal status is reported as terminal even for
 * a user who also lacks the role, because "this change is already rejected" is
 * more useful to an operator than "you lack permission" on something nobody
 * could act on.
 */
export function computeSiteChangeCapabilities(change: SiteChange, actor: SiteChangeActor): SiteChangeCapabilities {
  const terminal = isTerminalSiteChangeStatus(change.status);
  const mayDecide = canDecideSiteChanges(actor);

  const gate = (action: SiteChangeAction, requiresDecisionRole: boolean, extra?: () => string | null): SiteChangeCapability => {
    if (terminal) return denied(`this change is ${change.status} and can no longer be acted on`);
    if (requiresDecisionRole && !mayDecide) return denied('only an admin can approve, reject or publish a site change');
    const blocked = extra?.();
    if (blocked) return denied(blocked);
    return ALLOWED;
  };

  return Object.freeze({
    stage: gate('stage', false, () =>
      nextSiteChangeStatus(change.status, 'stage_succeeded') === null
        ? `a change in "${change.status}" cannot be staged`
        : null,
    ),
    verify: gate('verify', false, () => {
      if (!change.stagedRef) return 'stage this change before verifying it';
      return nextSiteChangeStatus(change.status, 'verify_passed') === null
        ? `a change in "${change.status}" cannot be verified`
        : null;
    }),
    approve: gate('approve', true, () => {
      if (change.status !== 'awaiting_approval') {
        return change.status === 'verification_failed'
          ? 'verification found a blocking issue — fix and re-verify before approving'
          : `only a change awaiting approval can be approved (this one is "${change.status}")`;
      }
      // Belt-and-braces against a future transition-table edit: a change whose
      // verification failed must never be approvable, whatever its status says.
      if (change.verifyPassed === false) return 'verification failed — this change cannot be approved';
      return null;
    }),
    reject: gate('reject', true, () =>
      nextSiteChangeStatus(change.status, 'reject') === null
        ? `a change in "${change.status}" can no longer be rejected`
        : null,
    ),
    publish: gate('publish', true, () => {
      if (change.status === 'publish_failed') return 'retry this change before publishing it again';
      if (change.status !== 'approved') return 'a change must be approved by a human before it can be published';
      if (!change.stagedRef) return 'this change was approved but never staged';
      return null;
    }),
    complete_handoff: gate('complete_handoff', true, () =>
      change.status !== 'handoff_required'
        ? 'only a git change awaiting a human merge can be marked complete'
        : null,
    ),
  });
}

/**
 * Which preview the UI should render for one change.
 *
 * Three tiers, chosen by what the platform can actually produce rather than by
 * platform name:
 *  - `diff`     — a real unified source diff exists (git).
 *  - `elements` — no diff, but the SEO surface can be compared before/after.
 *                 Always available, on every platform, and covers most reviews.
 *  - `preview`  — a provider-hosted draft with its own URL (WordPress, Shopify).
 *
 * `elements` is the floor: it renders even when the other two are absent, so
 * an operator is never asked to approve a change they cannot see.
 */
export type SiteChangePreviewTier = 'diff' | 'preview' | 'elements';

export function resolveSiteChangePreviewTier(change: SiteChange): SiteChangePreviewTier {
  if (change.diff && change.diff.trim().length > 0) return 'diff';
  if (change.previewUrl && change.previewUrl.trim().length > 0) return 'preview';
  return 'elements';
}

/** The row shape the approvals UI renders. `capabilities` is authoritative — the UI must not re-derive it. */
export interface SiteChangeDTO extends SiteChange {
  readonly capabilities: SiteChangeCapabilities;
  readonly previewTier: SiteChangePreviewTier;
}

export function toSiteChangeDTO(change: SiteChange, actor: SiteChangeActor): SiteChangeDTO {
  return {
    ...change,
    capabilities: computeSiteChangeCapabilities(change, actor),
    previewTier: resolveSiteChangePreviewTier(change),
  };
}
