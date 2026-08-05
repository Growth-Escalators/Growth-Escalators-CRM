/**
 * Decides what a change between two snapshots of a live page MEANS.
 *
 * This is the differentiator the whole SEO product is sold on, so it is worth
 * being precise about what it is for. An agency's recurring failure mode is
 * not "we didn't do the work" — it is "we did the work, and then something
 * silently undid it, and nobody noticed until the client asked why rankings
 * stalled three months later." The most common cause is somebody on the
 * client's side editing a page the agency shipped, with no malice and no
 * announcement.
 *
 * So the question this function answers is not "did the page change" — a hash
 * comparison answers that. It is "did the page change in a way nobody on our
 * side asked for", which needs the change log as a second input.
 *
 * PURE. No I/O, no clock beyond the injected `now`, no pool import. Every
 * branch is unit-testable with two plain objects, which matters because the
 * expensive part of testing a drift sweep is the fetching, and none of that
 * belongs in here.
 */
import { diffSeoElements, type SeoElements } from '../modules/site/liveSnapshot';

export type SeoDriftKind =
  /** Changed, and one of our approved changes was published just before it. The system working. */
  | 'verified_live'
  /** Changed with NO approved change behind it. The sellable one. */
  | 'unexpected_edit'
  /** 404/410. */
  | 'page_gone'
  /** `noindex` appeared. Costs traffic silently and completely. */
  | 'noindex_added'
  | 'canonical_changed'
  | 'structured_data_removed';

export type SeoDriftSeverity = 'info' | 'warning' | 'critical';

export interface SeoDriftMatch {
  readonly changeId: string;
  readonly publishedAt: Date;
}

export interface ClassifySeoDriftInput {
  /** The previous snapshot's elements, or null on the first ever sweep of this URL. */
  readonly previous: SeoElements | null;
  readonly previousHttpStatus: number | null;
  readonly current: SeoElements;
  readonly currentHttpStatus: number;
  /** Our most recent approved+published change for this URL, if any. */
  readonly matchedChange: SeoDriftMatch | null;
  readonly now: Date;
}

export interface SeoDriftResult {
  readonly kind: SeoDriftKind;
  readonly severity: SeoDriftSeverity;
  readonly changedFields: readonly string[];
  /** Set only for `verified_live` — the change this drift confirms went live. */
  readonly matchedChangeId: string | null;
  /** One line, safe to put in a Slack alert. Never contains page content. */
  readonly summary: string;
}

/**
 * How recently one of our publishes must have happened for a change on the
 * page to be attributed to it.
 *
 * 48 hours, not 1: a CDN or a static-site rebuild can lag a publish by hours,
 * and attributing our own change to "the client edited it" is the expensive
 * error — it burns the agency's trust in the alert, and an alert nobody trusts
 * is worse than no alert. The opposite error (calling a client edit ours) is
 * bounded: it only happens inside a 48h window where we also touched the page,
 * and the next sweep with no matching publish catches it.
 */
export const DRIFT_ATTRIBUTION_WINDOW_MS = 48 * 60 * 60 * 1000;

function isNoIndex(robots: string | null): boolean {
  return typeof robots === 'string' && /\bnoindex\b/i.test(robots);
}

/**
 * Classifies the difference between two snapshots.
 *
 * Returns `null` when nothing meaningful changed — the common case by far, and
 * the one that must stay cheap. A caller should compare content hashes first
 * and only reach this function when they differ; this is the second, more
 * expensive question, not the first.
 *
 * Ordering matters and is deliberate: the checks run most-severe first, so a
 * page that both went `noindex` AND had its title edited is reported as the
 * noindex, which is the thing that actually costs money.
 */
export function classifySeoDrift(input: ClassifySeoDriftInput): SeoDriftResult | null {
  const { previous, previousHttpStatus, current, currentHttpStatus, matchedChange, now } = input;

  // A page that has gone is the loudest possible signal, and it is meaningful
  // even on a first sweep with no previous snapshot to diff against.
  if (currentHttpStatus === 404 || currentHttpStatus === 410) {
    // Only report the transition, not every sweep of a page that has been
    // gone for weeks — a permanently-404 URL would otherwise alert daily
    // forever, which is how an alert channel gets muted.
    if (previousHttpStatus !== null && (previousHttpStatus === 404 || previousHttpStatus === 410)) return null;
    return {
      kind: 'page_gone',
      severity: 'critical',
      changedFields: ['httpStatus'],
      matchedChangeId: null,
      summary: `page returns ${currentHttpStatus} (was ${previousHttpStatus ?? 'not previously seen'})`,
    };
  }

  // Nothing to compare against yet. A first sighting is a baseline, not drift.
  if (previous === null) return null;

  const diff = diffSeoElements(previous, current);
  if (diff.length === 0) return null;
  const changedFields = diff.map((d) => d.field as string);

  // ---- severity-ordered special cases, all reported regardless of whether we
  // published recently: these are damaging enough that "we probably did it"
  // is not a good enough reason to stay quiet. If our own change added a
  // noindex, the agency still needs to know today.

  if (!isNoIndex(previous.robots) && isNoIndex(current.robots)) {
    return {
      kind: 'noindex_added',
      severity: 'critical',
      changedFields,
      matchedChangeId: null,
      summary: 'robots directive now contains noindex — this page will drop out of search',
    };
  }

  if (previous.canonicalUrl !== current.canonicalUrl) {
    return {
      kind: 'canonical_changed',
      severity: 'warning',
      changedFields,
      matchedChangeId: null,
      summary: `canonical changed from ${previous.canonicalUrl ?? '(none)'} to ${current.canonicalUrl ?? '(none)'}`,
    };
  }

  const lostTypes = previous.jsonLdTypes.filter((t) => !current.jsonLdTypes.includes(t));
  if (lostTypes.length > 0) {
    return {
      kind: 'structured_data_removed',
      severity: 'warning',
      changedFields,
      matchedChangeId: null,
      summary: `structured data removed: ${lostTypes.join(', ')} — rich results for this page will stop`,
    };
  }

  // ---- ordinary content change: ours, or somebody else's?

  const attributable =
    matchedChange !== null
    && now.getTime() - matchedChange.publishedAt.getTime() <= DRIFT_ATTRIBUTION_WINDOW_MS
    && now.getTime() >= matchedChange.publishedAt.getTime();

  if (attributable) {
    return {
      kind: 'verified_live',
      severity: 'info',
      changedFields,
      matchedChangeId: matchedChange.changeId,
      summary: `matches approved change ${matchedChange.changeId} — confirmed live`,
    };
  }

  return {
    kind: 'unexpected_edit',
    severity: 'warning',
    changedFields,
    matchedChangeId: null,
    summary: `changed with no approved change behind it: ${changedFields.join(', ')}`,
  };
}

/** Drift worth interrupting a human for. Everything else is dashboard-only. */
export function shouldAlertOnDrift(result: SeoDriftResult): boolean {
  return result.severity === 'critical' || result.kind === 'unexpected_edit';
}
