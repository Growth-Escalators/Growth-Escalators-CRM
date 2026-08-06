/**
 * site_changes lifecycle — propose → stage → verify → awaiting_approval →
 * approve → publish.
 *
 * This module owns the one invariant that matters most in the whole SEO
 * system: **nothing reaches a client's live website without a recorded human
 * approval.** Everything else here is plumbing around that.
 *
 * The invariant is enforced at three independent layers, on purpose:
 *
 *  1. **The database** — `site_changes_approved_requires_approver` (migration
 *     0048) rejects any row that sits in an approved-or-later status without
 *     both `approved_by` and `approved_at`.
 *  2. **This module** — `publishApprovedChange()` is the SOLE caller of
 *     `provider.publishChange()` anywhere in the codebase, and it calls
 *     `assertSiteChangeApproved()` first, unconditionally.
 *  3. **Each provider** — every SiteProvider re-checks `approved.approvedBy`
 *     before its first network call and throws `unauthorised_publish`.
 *
 * Three layers for one rule is not belt-and-braces theatre. A bug in any one
 * of them means the system silently edits somebody's live business website
 * with nobody's consent — the failure is invisible, unbounded, and lands on a
 * client rather than on us.
 *
 * ---------------------------------------------------------------------------
 * STRUCTURE (mirrors wizmatchCostGuard.ts / seoCostGuard.ts):
 *
 *   PART 1 — pure. Status vocabulary, the transition table, and the approval
 *            assertion. No I/O, no pool import reachable from it, no clock
 *            dependency. Unit-testable with zero database.
 *   PART 2 — impure. Repository + orchestration on top of `pool`.
 *
 * EVERY query in Part 2 binds tenant_id. A query here without a tenant_id
 * predicate is a cross-tenant leak that lets one agency stage an edit onto
 * another agency's client's website.
 * ---------------------------------------------------------------------------
 */
import { randomUUID } from 'crypto';
import { pool } from '../db/index';
import logger from '../utils/logger';
import { getSeoSiteById, type SeoSite } from './seoSiteRegistry';
import { getSiteProvider } from '../modules/site/providers';
import {
  SiteProviderError,
  assertSiteProviderReady,
  type ApprovedSiteChange,
  type SiteChangeInput,
  type SitePlatform,
  type SiteProvider,
  type SitePublishResult,
  type SiteRef,
  type SiteStageResult,
  type SiteVerifyIssue,
} from '../modules/site/providers/site-provider.interface';

// ===========================================================================
// PART 1 — PURE
// ===========================================================================

export const SITE_CHANGE_STATUSES = [
  /** Recorded, nothing sent anywhere yet. */
  'proposed',
  /** A provider-side draft/branch exists. Still invisible to the public. */
  'staged',
  /** Verification passed — sitting in the approval queue, waiting on a human. */
  'awaiting_approval',
  /** Verification found a blocking issue. Re-stageable, never approvable. */
  'verification_failed',
  /** A human approved it. The ONLY status from which a publish may start. */
  'approved',
  /** A publish attempt is in flight. */
  'publishing',
  'published',
  /** Git sites: the server recorded the change; a human performs the merge. */
  'handoff_required',
  'rejected',
  'publish_failed',
  /** A newer proposal for the same target replaced this one. */
  'superseded',
] as const;

export type SiteChangeStatus = (typeof SITE_CHANGE_STATUSES)[number];

export type SiteChangeEvent =
  | 'stage_succeeded'
  | 'stage_failed'
  | 'verify_passed'
  | 'verify_failed'
  | 'approve'
  | 'reject'
  | 'publish_started'
  | 'publish_succeeded'
  | 'publish_handoff'
  | 'publish_failed'
  /** Returns a failed publish to 'approved' so the retry goes back through the approval assertion. */
  | 'retry_publish'
  | 'handoff_completed'
  | 'supersede';

/** Statuses from which no event leads anywhere. */
const TERMINAL_STATUSES: ReadonlySet<SiteChangeStatus> = new Set<SiteChangeStatus>(['rejected', 'superseded']);

export function isTerminalSiteChangeStatus(status: SiteChangeStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isSiteChangeStatus(value: unknown): value is SiteChangeStatus {
  return typeof value === 'string' && (SITE_CHANGE_STATUSES as readonly string[]).includes(value);
}

/**
 * The transition table. Pure, exhaustive, and the only thing permitted to
 * compute a new `site_changes.status`.
 *
 * Returns `null` for an illegal (status, event) pair rather than throwing, so
 * callers can distinguish "not allowed" from "blew up" — `assertSiteChange
 * Transition` below is the throwing wrapper for callers that want one.
 *
 * Two properties this table deliberately guarantees, both worth checking any
 * time it is edited:
 *
 *  - **No path reaches `approved` except via `awaiting_approval` + `approve`.**
 *    In particular `verification_failed` has no route to `approved`: a change
 *    with a blocking verification issue can be re-staged and re-verified, but
 *    it can never be waved through.
 *  - **No path reaches `publishing` except from `approved` or a retry of
 *    `publish_failed`** (which itself was only reachable via `approved`).
 */
export function nextSiteChangeStatus(current: SiteChangeStatus, event: SiteChangeEvent): SiteChangeStatus | null {
  switch (current) {
    case 'proposed':
      if (event === 'stage_succeeded') return 'staged';
      // Staging is retryable and the failure is recorded on `last_error`, so a
      // failed stage returns the row to where it was rather than inventing a
      // dead-end state nothing can leave.
      if (event === 'stage_failed') return 'proposed';
      if (event === 'reject') return 'rejected';
      if (event === 'supersede') return 'superseded';
      return null;

    case 'staged':
      if (event === 'verify_passed') return 'awaiting_approval';
      if (event === 'verify_failed') return 'verification_failed';
      if (event === 'stage_succeeded') return 'staged'; // re-stage is idempotent
      if (event === 'stage_failed') return 'staged';
      if (event === 'reject') return 'rejected';
      if (event === 'supersede') return 'superseded';
      return null;

    case 'verification_failed':
      if (event === 'stage_succeeded') return 'staged';
      if (event === 'stage_failed') return 'verification_failed';
      if (event === 'verify_passed') return 'awaiting_approval';
      if (event === 'verify_failed') return 'verification_failed';
      if (event === 'reject') return 'rejected';
      if (event === 'supersede') return 'superseded';
      return null;

    case 'awaiting_approval':
      if (event === 'approve') return 'approved';
      if (event === 'reject') return 'rejected';
      // A re-verify that now fails must be able to pull a change back OUT of
      // the approval queue — otherwise an operator can approve something whose
      // staged draft has since broken.
      if (event === 'verify_failed') return 'verification_failed';
      if (event === 'verify_passed') return 'awaiting_approval';
      if (event === 'stage_succeeded') return 'staged';
      if (event === 'supersede') return 'superseded';
      return null;

    case 'approved':
      if (event === 'publish_started') return 'publishing';
      // Approval is revocable right up until publish starts.
      if (event === 'reject') return 'rejected';
      if (event === 'supersede') return 'superseded';
      return null;

    case 'publishing':
      if (event === 'publish_succeeded') return 'published';
      if (event === 'publish_handoff') return 'handoff_required';
      if (event === 'publish_failed') return 'publish_failed';
      return null;

    case 'publish_failed':
      // Retry goes back through 'approved', NOT straight to 'publishing'.
      // `assertSiteChangeApproved` requires status === 'approved' exactly, so a
      // publish_failed → publishing edge would be an unreachable dead path —
      // and "loosen the assertion to accept publish_failed too" is the wrong
      // fix: the value of that assertion is that it names exactly one status.
      // An explicit retry transition keeps the approval record (approvedBy /
      // approvedAt survive untouched) and leaves a retry visible in the row's
      // history rather than hidden inside a publish call.
      if (event === 'retry_publish') return 'approved';
      if (event === 'reject') return 'rejected';
      if (event === 'supersede') return 'superseded';
      return null;

    case 'handoff_required':
      // A human merged the branch; the change is now live.
      if (event === 'handoff_completed') return 'published';
      if (event === 'supersede') return 'superseded';
      return null;

    case 'published':
      if (event === 'supersede') return 'superseded';
      return null;

    case 'rejected':
    case 'superseded':
      return null;

    default: {
      const _exhaustive: never = current;
      return _exhaustive;
    }
  }
}

export class SiteChangeError extends Error {
  readonly code:
    | 'not_found'
    | 'invalid_transition'
    | 'version_conflict'
    | 'invalid_input'
    | 'site_not_ready'
    | 'unsupported_platform';

  constructor(code: SiteChangeError['code'], message: string) {
    super(message);
    this.name = 'SiteChangeError';
    this.code = code;
  }
}

export function assertSiteChangeTransition(
  current: SiteChangeStatus,
  event: SiteChangeEvent,
  changeId: string,
): SiteChangeStatus {
  const next = nextSiteChangeStatus(current, event);
  if (next === null) {
    throw new SiteChangeError(
      'invalid_transition',
      `change ${changeId}: '${event}' is not legal from status '${current}'`,
    );
  }
  return next;
}

/** The minimum shape `assertSiteChangeApproved` needs — deliberately not the full row, so it stays trivially testable. */
export interface ApprovalCheckable {
  readonly id: string;
  readonly status: SiteChangeStatus;
  readonly approvedBy: string | null;
  readonly approvedAt: Date | null;
  readonly verifyPassed: boolean | null;
}

/**
 * The hard stop. Throws `SiteProviderError('unauthorised_publish')` unless a
 * human is on record as having approved this exact change.
 *
 * Note what is NOT accepted as approval: a status of 'approved' on its own is
 * not enough, and an `approvedBy` on its own is not enough. Both, plus a
 * timestamp, plus a verification that did not fail. An approval record with a
 * missing approver is a bug somewhere upstream, and the safe reading of a bug
 * here is "nobody approved this".
 */
export function assertSiteChangeApproved(change: ApprovalCheckable): void {
  const provider = 'site-change-service';
  if (change.status !== 'approved') {
    throw new SiteProviderError(
      'unauthorised_publish',
      provider,
      `change ${change.id} is in status '${change.status}', not 'approved' — refusing to publish`,
    );
  }
  if (typeof change.approvedBy !== 'string' || change.approvedBy.trim().length === 0) {
    throw new SiteProviderError(
      'unauthorised_publish',
      provider,
      `change ${change.id} is marked approved but has no approver on record — refusing to publish`,
    );
  }
  if (!(change.approvedAt instanceof Date) || Number.isNaN(change.approvedAt.getTime())) {
    throw new SiteProviderError(
      'unauthorised_publish',
      provider,
      `change ${change.id} is marked approved but has no approval timestamp — refusing to publish`,
    );
  }
  // Reachable only if the transition table were edited to allow it. Cheap to
  // check, and the thing it prevents is publishing a change a verifier already
  // said was broken.
  if (change.verifyPassed === false) {
    throw new SiteProviderError(
      'unauthorised_publish',
      provider,
      `change ${change.id} failed verification — refusing to publish`,
    );
  }
}

// ===========================================================================
// PART 2 — IMPURE (database + provider orchestration)
// ===========================================================================

export type SiteChangeKind = 'page_create' | 'page_update' | 'redirect' | 'robots_txt' | 'metafield';

export interface SiteChange {
  id: string;
  tenantId: string;
  siteId: string;
  changeKind: string;
  pageUrl: string | null;
  status: SiteChangeStatus;
  version: number;
  payload: Record<string, unknown>;
  stagedRef: string | null;
  previewUrl: string | null;
  diff: string | null;
  stagedAt: Date | null;
  verifyPassed: boolean | null;
  verifyIssues: SiteVerifyIssue[];
  verifiedAt: Date | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  rejectedBy: string | null;
  rejectedAt: Date | null;
  decisionReason: string | null;
  publishRequestId: string | null;
  publishedAt: Date | null;
  liveUrl: string | null;
  externalRef: string | null;
  publishResult: Record<string, unknown> | null;
  lastError: string | null;
  lastErrorAt: Date | null;
  verifiedLiveAt: Date | null;
  supersededByChangeId: string | null;
  source: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateSiteChangeInput {
  siteId: string;
  changeKind?: SiteChangeKind;
  pageUrl?: string | null;
  /** The vendor-neutral change body. `changeId` is assigned by this service, not the caller. */
  payload: Omit<SiteChangeInput, 'changeId'>;
  source?: 'cron' | 'admin' | 'agent';
  createdBy?: string | null;
}

const SELECT_COLUMNS = `
  id, tenant_id, site_id, change_kind, page_url, status, version, payload,
  staged_ref, preview_url, diff, staged_at,
  verify_passed, verify_issues, verified_at,
  approved_by, approved_at, rejected_by, rejected_at, decision_reason,
  publish_request_id, published_at, live_url, external_ref, publish_result,
  last_error, last_error_at, verified_live_at, superseded_by_change_id,
  source, created_by, created_at, updated_at`;

function rowToSiteChange(row: Record<string, unknown>): SiteChange {
  const status = row.status;
  if (!isSiteChangeStatus(status)) {
    // A status the code does not know about means someone wrote to this table
    // outside the state machine. Surfacing it loudly beats silently treating
    // it as something benign.
    throw new SiteChangeError('invalid_input', `site_changes row ${String(row.id)} has unknown status ${String(status)}`);
  }
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    siteId: String(row.site_id),
    changeKind: String(row.change_kind),
    pageUrl: row.page_url === null || row.page_url === undefined ? null : String(row.page_url),
    status,
    version: Number(row.version),
    payload: (row.payload as Record<string, unknown> | null) ?? {},
    stagedRef: row.staged_ref === null || row.staged_ref === undefined ? null : String(row.staged_ref),
    previewUrl: row.preview_url === null || row.preview_url === undefined ? null : String(row.preview_url),
    diff: row.diff === null || row.diff === undefined ? null : String(row.diff),
    stagedAt: (row.staged_at as Date | null) ?? null,
    verifyPassed: row.verify_passed === null || row.verify_passed === undefined ? null : Boolean(row.verify_passed),
    verifyIssues: Array.isArray(row.verify_issues) ? (row.verify_issues as SiteVerifyIssue[]) : [],
    verifiedAt: (row.verified_at as Date | null) ?? null,
    approvedBy: row.approved_by === null || row.approved_by === undefined ? null : String(row.approved_by),
    approvedAt: (row.approved_at as Date | null) ?? null,
    rejectedBy: row.rejected_by === null || row.rejected_by === undefined ? null : String(row.rejected_by),
    rejectedAt: (row.rejected_at as Date | null) ?? null,
    decisionReason: row.decision_reason === null || row.decision_reason === undefined ? null : String(row.decision_reason),
    publishRequestId:
      row.publish_request_id === null || row.publish_request_id === undefined ? null : String(row.publish_request_id),
    publishedAt: (row.published_at as Date | null) ?? null,
    liveUrl: row.live_url === null || row.live_url === undefined ? null : String(row.live_url),
    externalRef: row.external_ref === null || row.external_ref === undefined ? null : String(row.external_ref),
    publishResult: (row.publish_result as Record<string, unknown> | null) ?? null,
    lastError: row.last_error === null || row.last_error === undefined ? null : String(row.last_error),
    lastErrorAt: (row.last_error_at as Date | null) ?? null,
    verifiedLiveAt: (row.verified_live_at as Date | null) ?? null,
    supersededByChangeId:
      row.superseded_by_change_id === null || row.superseded_by_change_id === undefined
        ? null
        : String(row.superseded_by_change_id),
    source: String(row.source),
    createdBy: row.created_by === null || row.created_by === undefined ? null : String(row.created_by),
    createdAt: (row.created_at as Date | null) ?? new Date(0),
    updatedAt: (row.updated_at as Date | null) ?? new Date(0),
  };
}

/**
 * An error string safe to persist and show in the admin. Truncated hard, and
 * never the raw provider body: a vendor error can echo back a request header
 * or a signed URL, and `last_error` is read by anyone with admin access.
 */
function safeErrorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\s+/g, ' ').trim().slice(0, 500);
}

// ---- reads ---------------------------------------------------------------

export async function getSiteChange(tenantId: string, id: string): Promise<SiteChange | null> {
  const { rows } = await pool.query(
    `SELECT ${SELECT_COLUMNS} FROM site_changes WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id],
  );
  return rows[0] ? rowToSiteChange(rows[0]) : null;
}

export async function listSiteChanges(
  tenantId: string,
  opts: { siteId?: string; status?: SiteChangeStatus | SiteChangeStatus[]; limit?: number } = {},
): Promise<SiteChange[]> {
  const params: unknown[] = [tenantId];
  let sql = `SELECT ${SELECT_COLUMNS} FROM site_changes WHERE tenant_id = $1`;

  if (opts.siteId) {
    params.push(opts.siteId);
    sql += ` AND site_id = $${params.length}`;
  }
  if (opts.status) {
    const statuses = Array.isArray(opts.status) ? opts.status : [opts.status];
    params.push(statuses);
    sql += ` AND status = ANY($${params.length}::text[])`;
  }
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  params.push(limit);
  sql += ` ORDER BY created_at DESC LIMIT $${params.length}`;

  const { rows } = await pool.query(sql, params);
  return rows.map(rowToSiteChange);
}

// ---- create --------------------------------------------------------------

/**
 * Records a new proposal and supersedes any still-open proposal for the same
 * target on the same site.
 *
 * Superseding matters: without it, two cron runs a day apart leave two live
 * proposals for the same page in the approval queue, an operator approves both,
 * and the second publish silently reverts the first. `superseded` is a terminal
 * status precisely so the queue only ever shows the current intent.
 *
 * The supersede and the insert run in one transaction — a crash between them
 * would otherwise leave exactly the duplicate-in-queue state this prevents.
 */
export async function createSiteChange(tenantId: string, input: CreateSiteChangeInput): Promise<SiteChange> {
  const site = await getSeoSiteById(tenantId, input.siteId);
  if (!site) {
    // Deliberately the same error a genuinely-missing site produces: a tenant
    // must not be able to probe another tenant's site ids by comparing
    // "not found" against "not yours".
    throw new SiteChangeError('not_found', `site ${input.siteId} not found for this tenant`);
  }

  const changeKind = input.changeKind ?? 'page_update';
  const pageUrl = input.pageUrl ?? (typeof input.payload.pageUrl === 'string' ? input.payload.pageUrl : null);
  if (changeKind !== 'robots_txt' && (pageUrl === null || pageUrl.trim().length === 0)) {
    throw new SiteChangeError('invalid_input', `changeKind '${changeKind}' requires a pageUrl`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Non-terminal, non-published proposals for the same target are replaced.
    // A published change is left alone — it is history, not intent.
    const supersedable: SiteChangeStatus[] = [
      'proposed',
      'staged',
      'awaiting_approval',
      'verification_failed',
      'approved',
      'publish_failed',
    ];
    const { rows: inserted } = await client.query(
      `INSERT INTO site_changes (tenant_id, site_id, change_kind, page_url, payload, source, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       RETURNING ${SELECT_COLUMNS}`,
      [
        tenantId,
        site.id,
        changeKind,
        pageUrl,
        JSON.stringify(input.payload ?? {}),
        input.source ?? 'admin',
        input.createdBy ?? null,
      ],
    );
    const created = rowToSiteChange(inserted[0]);

    const { rowCount } = await client.query(
      `UPDATE site_changes
          SET status = 'superseded', superseded_by_change_id = $1, updated_at = NOW(), version = version + 1
        WHERE tenant_id = $2 AND site_id = $3 AND id <> $1
          AND change_kind = $4
          AND page_url IS NOT DISTINCT FROM $5
          AND status = ANY($6::text[])`,
      [created.id, tenantId, site.id, changeKind, pageUrl, supersedable],
    );
    if (rowCount && rowCount > 0) {
      logger.info(
        `[site-change] superseded ${rowCount} open change(s) for site ${site.id} ${changeKind} ${pageUrl ?? '(no page)'}`,
      );
    }

    await client.query('COMMIT');
    return created;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

// ---- transitions ---------------------------------------------------------

interface TransitionPatch {
  [column: string]: unknown;
}

/**
 * The single write path for `status`. Everything that changes a change's state
 * goes through here.
 *
 * `SELECT ... FOR UPDATE` inside a transaction, then an UPDATE guarded on the
 * row's version. Two things this closes that a bare UPDATE would not:
 *   - two operators acting on the same change concurrently (the second one's
 *     stale view loses instead of overwriting the first's decision), and
 *   - a cron re-staging a change while a human is approving it.
 *
 * `expectedVersion` is the caller's optimistic-concurrency token, passed from
 * the UI. Omitted means "whatever the current version is" — correct for
 * server-initiated transitions (staging, publishing) which have no rendered
 * view to be stale against.
 */
async function applyTransition(
  tenantId: string,
  id: string,
  event: SiteChangeEvent,
  patch: TransitionPatch = {},
  expectedVersion?: number,
): Promise<SiteChange> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT ${SELECT_COLUMNS} FROM site_changes WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, id],
    );
    if (!rows[0]) {
      throw new SiteChangeError('not_found', `change ${id} not found for this tenant`);
    }
    const current = rowToSiteChange(rows[0]);

    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw new SiteChangeError(
        'version_conflict',
        `change ${id} has moved on (expected version ${expectedVersion}, found ${current.version})`,
      );
    }

    const nextStatus = assertSiteChangeTransition(current.status, event, id);

    const setFragments = ['status = $3', 'version = version + 1', 'updated_at = NOW()'];
    const params: unknown[] = [tenantId, id, nextStatus];
    for (const [column, value] of Object.entries(patch)) {
      params.push(value);
      setFragments.push(`${column} = $${params.length}`);
    }

    const { rows: updated } = await client.query(
      `UPDATE site_changes SET ${setFragments.join(', ')}
        WHERE tenant_id = $1 AND id = $2
        RETURNING ${SELECT_COLUMNS}`,
      params,
    );
    await client.query('COMMIT');
    return rowToSiteChange(updated[0]);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

// ---- provider plumbing ---------------------------------------------------

const SUPPORTED_PLATFORMS: ReadonlySet<string> = new Set<SitePlatform>(['git', 'wordpress', 'shopify']);

function toSiteRef(site: SeoSite): SiteRef {
  if (!SUPPORTED_PLATFORMS.has(site.platform)) {
    // seo_sites.platform defaults to 'unknown' — a site can be registered for
    // reporting long before anyone decides how it publishes. That is a valid
    // state; attempting to stage a change onto it is not.
    throw new SiteChangeError(
      'unsupported_platform',
      `site ${site.id} has platform '${site.platform}' — set a real platform before staging changes`,
    );
  }
  return {
    id: site.id,
    tenantId: site.tenantId,
    domain: site.domain,
    platform: site.platform as SitePlatform,
    // Without this the registry's credential_provider column is written by the
    // admin and read by nobody — each adapter would guess its own default and
    // a tenant with two integrations for one platform could not say which site
    // uses which.
    credentialProvider: site.credentialProvider,
    adapterConfig: site.adapterConfig,
  };
}

async function loadChangeAndProvider(
  tenantId: string,
  id: string,
): Promise<{ change: SiteChange; site: SeoSite; siteRef: SiteRef; provider: SiteProvider }> {
  const change = await getSiteChange(tenantId, id);
  if (!change) throw new SiteChangeError('not_found', `change ${id} not found for this tenant`);

  const site = await getSeoSiteById(tenantId, change.siteId);
  if (!site) throw new SiteChangeError('not_found', `site ${change.siteId} not found for this tenant`);
  if (site.status !== 'active') {
    throw new SiteChangeError('site_not_ready', `site ${site.id} is '${site.status}' — not active`);
  }

  const siteRef = toSiteRef(site);
  const provider = getSiteProvider(siteRef.platform);
  assertSiteProviderReady(provider, siteRef);
  return { change, site, siteRef, provider };
}

function toProviderInput(change: SiteChange): SiteChangeInput {
  const payload = change.payload as Partial<SiteChangeInput>;
  return {
    changeId: change.id,
    pageUrl: change.pageUrl ?? String(payload.pageUrl ?? ''),
    isNewPage: change.changeKind === 'page_create' || payload.isNewPage === true,
    title: payload.title,
    metaTitle: payload.metaTitle,
    metaDescription: payload.metaDescription,
    canonicalUrl: payload.canonicalUrl,
    bodyHtml: payload.bodyHtml,
    structuredData: payload.structuredData,
    redirectFrom: payload.redirectFrom,
  };
}

// ---- stage / verify ------------------------------------------------------

export async function stageSiteChange(tenantId: string, id: string): Promise<SiteChange> {
  const { change, siteRef, provider } = await loadChangeAndProvider(tenantId, id);

  let staged: SiteStageResult;
  try {
    staged = await provider.stageChange(siteRef, toProviderInput(change));
  } catch (e) {
    logger.error(`[site-change] stage failed for change ${id}: ${safeErrorText(e)}`);
    await applyTransition(tenantId, id, 'stage_failed', {
      last_error: safeErrorText(e),
      last_error_at: new Date(),
    }).catch((inner) => {
      // Recording the failure must never mask the failure itself.
      logger.error(`[site-change] could not record stage failure for ${id}: ${safeErrorText(inner)}`);
    });
    throw e;
  }

  // Trust the provider's capabilities, not its output: a provider that says it
  // cannot produce a diff must not have one persisted, and vice versa. This is
  // where a mis-implemented adapter gets caught rather than silently filling a
  // column the approval UI branches on.
  const previewUrl = provider.capabilities.stagesRemoteDraft ? (staged.previewUrl ?? null) : null;
  const diff = provider.capabilities.producesReviewableDiff ? (staged.diff ?? null) : null;

  return applyTransition(tenantId, id, 'stage_succeeded', {
    staged_ref: staged.stagedRef,
    preview_url: previewUrl,
    diff,
    staged_at: staged.createdAt ?? new Date(),
    last_error: null,
    last_error_at: null,
  });
}

export async function verifySiteChange(tenantId: string, id: string): Promise<SiteChange> {
  const { change, siteRef, provider } = await loadChangeAndProvider(tenantId, id);
  if (!change.stagedRef) {
    throw new SiteChangeError('invalid_input', `change ${id} has not been staged`);
  }

  const staged: SiteStageResult = {
    stagedRef: change.stagedRef,
    previewUrl: change.previewUrl ?? undefined,
    diff: change.diff ?? undefined,
    createdAt: change.stagedAt ?? new Date(),
  };

  let issues: SiteVerifyIssue[] = [];
  let passed = false;
  try {
    // The change is passed explicitly rather than left to the provider's own
    // stage-time memory: verification frequently runs in a different process
    // from staging, where that memory is empty.
    const result = await provider.verifyChange(siteRef, staged, toProviderInput(change));
    issues = [...result.issues];
    // Recompute rather than trusting `passed`: `passed` is defined as "no
    // blocking issue", and a provider that returns passed:true alongside a
    // blocking issue is wrong in the direction that matters.
    passed = result.passed && !issues.some((issue) => issue.severity === 'blocking');
  } catch (e) {
    logger.error(`[site-change] verify failed for change ${id}: ${safeErrorText(e)}`);
    issues = [{ severity: 'blocking', code: 'verify_threw', message: safeErrorText(e) }];
    passed = false;
  }

  return applyTransition(tenantId, id, passed ? 'verify_passed' : 'verify_failed', {
    verify_passed: passed,
    verify_issues: JSON.stringify(issues),
    verified_at: new Date(),
  });
}

// ---- the human decision --------------------------------------------------

/**
 * Records a human's approval. `userId` must be a real users.id — the FK and
 * the `site_changes_approved_requires_approver` CHECK both enforce that the
 * approval carries an identity, and there is deliberately no "system" or
 * "automation" identity that could satisfy them.
 */
export async function approveSiteChange(
  tenantId: string,
  id: string,
  opts: { userId: string; reason?: string; expectedVersion?: number },
): Promise<SiteChange> {
  if (!opts.userId || opts.userId.trim().length === 0) {
    throw new SiteChangeError('invalid_input', 'approval requires a user id');
  }
  return applyTransition(
    tenantId,
    id,
    'approve',
    {
      approved_by: opts.userId,
      approved_at: new Date(),
      decision_reason: opts.reason ?? null,
    },
    opts.expectedVersion,
  );
}

export async function rejectSiteChange(
  tenantId: string,
  id: string,
  opts: { userId: string; reason: string; expectedVersion?: number },
): Promise<SiteChange> {
  if (!opts.userId || opts.userId.trim().length === 0) {
    throw new SiteChangeError('invalid_input', 'rejection requires a user id');
  }
  // Required on reject, optional on approve: a rejected proposal is the one
  // whose reasoning the next run needs in order not to repeat it.
  if (!opts.reason || opts.reason.trim().length === 0) {
    throw new SiteChangeError('invalid_input', 'rejection requires a reason');
  }
  return applyTransition(
    tenantId,
    id,
    'reject',
    {
      rejected_by: opts.userId,
      rejected_at: new Date(),
      decision_reason: opts.reason.trim().slice(0, 2000),
    },
    opts.expectedVersion,
  );
}

// ---- publish -------------------------------------------------------------

/**
 * Serialises publish attempts for one change across every process.
 *
 * Copied from `withWizmatchSourceLock`. Without it, two workers (or a worker
 * and an operator clicking twice) can both read status='approved' and both
 * call the provider — publishing the same change twice, which on a platform
 * without `supportsIdempotentPublish` means two live pages.
 *
 * Returns `null` when the lock is already held, which callers must treat as
 * "someone else is publishing this", not as a failure.
 */
export async function withSiteChangeLock<T>(changeId: string, run: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  const key = `site-change-publish:${changeId}`;
  try {
    const lock = await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [key]);
    if (!lock.rows[0]?.locked) return null;
    try {
      return await run();
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
    }
  } finally {
    client.release();
  }
}

/**
 * THE ONLY FUNCTION IN THIS CODEBASE THAT MAY CALL `provider.publishChange()`.
 *
 * If you are adding a second caller, stop: the hard-stop invariant is only as
 * strong as the number of doors into the provider's publish method, and this
 * is the one door with the approval assertion on it. Route the new caller
 * through here instead.
 *
 * Returns `null` when another process holds the publish lock for this change.
 */
export async function publishApprovedChange(tenantId: string, id: string): Promise<SiteChange | null> {
  return withSiteChangeLock(id, async () => {
    const { change, siteRef, provider } = await loadChangeAndProvider(tenantId, id);

    // ---- the hard stop -----------------------------------------------------
    assertSiteChangeApproved(change);
    // -----------------------------------------------------------------------

    if (!change.stagedRef) {
      throw new SiteChangeError('invalid_input', `change ${id} is approved but was never staged`);
    }

    // Reuse an existing request id on retry so a provider with
    // supportsIdempotentPublish can recognise the second attempt as the same
    // request rather than a new publish.
    const publishRequestId = change.publishRequestId ?? randomRequestId();
    const publishing = await applyTransition(tenantId, id, 'publish_started', {
      publish_request_id: publishRequestId,
      last_error: null,
      last_error_at: null,
    });

    const approved: ApprovedSiteChange = {
      stagedRef: change.stagedRef,
      changeId: change.id,
      // Non-null by assertSiteChangeApproved above.
      approvedBy: change.approvedBy as string,
      approvedAt: change.approvedAt as Date,
      publishRequestId,
      // Carried forward so an adapter's publish-time work that depends on the
      // original request — Shopify's redirectFrom, most importantly — does not
      // quietly do nothing when publish runs in a process that never staged it.
      change: toProviderInput(change),
    };

    let result: SitePublishResult;
    try {
      result = await provider.publishChange(siteRef, approved);
    } catch (e) {
      logger.error(`[site-change] publish failed for change ${id}: ${safeErrorText(e)}`);
      await applyTransition(tenantId, id, 'publish_failed', {
        last_error: safeErrorText(e),
        last_error_at: new Date(),
      }).catch((inner) => {
        logger.error(`[site-change] could not record publish failure for ${id}: ${safeErrorText(inner)}`);
      });
      throw e;
    }

    if (result.status === 'handoff_required') {
      logger.info(`[site-change] change ${id} on site ${siteRef.id} requires a git handoff (branch recorded)`);
      return applyTransition(tenantId, id, 'publish_handoff', {
        publish_result: JSON.stringify(result),
      });
    }

    logger.info(`[site-change] change ${id} published on site ${siteRef.id}`);
    void publishing;
    return applyTransition(tenantId, id, 'publish_succeeded', {
      published_at: new Date(),
      live_url: result.liveUrl,
      external_ref: result.externalRef,
      publish_result: JSON.stringify(result),
    });
  });
}

/**
 * Returns a failed publish to 'approved' so it can be attempted again.
 *
 * Deliberately a separate, explicit call rather than something
 * `publishApprovedChange` does for itself: an automatic retry loop against a
 * live website is exactly the kind of thing that turns one bad publish into
 * fifty. A human (or an operator-triggered route) asks for the retry.
 */
export async function retrySiteChangePublish(
  tenantId: string,
  id: string,
  opts: { expectedVersion?: number } = {},
): Promise<SiteChange> {
  return applyTransition(tenantId, id, 'retry_publish', {}, opts.expectedVersion);
}

/**
 * Marks a git handoff as merged by a human. Kept separate from
 * `publishApprovedChange` because no server-side action fulfils it — this
 * records something a person did outside the system, and pretending otherwise
 * is how a "published" status stops meaning anything.
 */
export async function completeSiteChangeHandoff(
  tenantId: string,
  id: string,
  opts: { liveUrl?: string; expectedVersion?: number } = {},
): Promise<SiteChange> {
  return applyTransition(
    tenantId,
    id,
    'handoff_completed',
    {
      published_at: new Date(),
      live_url: opts.liveUrl ?? null,
    },
    opts.expectedVersion,
  );
}

/**
 * Records that the drift sweep saw this change actually live. This — not
 * `published_at` — is what starts the observation-window clock the outcome
 * scoring reads, because a publish that silently failed to render must never
 * be scored as if it shipped.
 */
export async function markSiteChangeVerifiedLive(
  tenantId: string,
  id: string,
  at: Date = new Date(),
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE site_changes SET verified_live_at = $3, updated_at = NOW()
      WHERE tenant_id = $1 AND id = $2 AND verified_live_at IS NULL`,
    [tenantId, id, at],
  );
  return (rowCount ?? 0) > 0;
}

function randomRequestId(): string {
  return randomUUID();
}
