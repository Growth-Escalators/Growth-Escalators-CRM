// The hard-stop invariant, tested from three angles:
//
//  1. the pure transition table (no DB, no provider) — proving there is no
//     route to `approved` that skips a human, and no route to `publishing`
//     that skips `approved`;
//  2. `assertSiteChangeApproved` in isolation — proving each individual piece
//     of an approval record is load-bearing;
//  3. `publishApprovedChange` end-to-end against the mock provider — proving
//     the assertion runs BEFORE the provider is touched, which is the only
//     ordering that actually protects a live website.
//
// Point 3 also serves as the ADR-007 seam proof: the same caller drives a
// 'wordpress' profile to `published` and a 'git' profile to `handoff_required`
// with no branch on `identity.name` anywhere.
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/index', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

vi.mock('../services/seoSiteRegistry', () => ({
  getSeoSiteById: vi.fn(),
}));

import { pool } from '../db/index';
import { getSeoSiteById } from '../services/seoSiteRegistry';
import { MockSiteProvider, resetSiteProvider, setSiteProvider } from '../modules/site/providers';
import { SiteProviderError } from '../modules/site/providers/site-provider.interface';
import {
  SITE_CHANGE_STATUSES,
  assertSiteChangeApproved,
  isTerminalSiteChangeStatus,
  nextSiteChangeStatus,
  publishApprovedChange,
  retrySiteChangePublish,
  type ApprovalCheckable,
  type SiteChangeEvent,
  type SiteChangeStatus,
} from '../services/siteChangeService';

const ALL_EVENTS: SiteChangeEvent[] = [
  'stage_succeeded',
  'stage_failed',
  'verify_passed',
  'verify_failed',
  'approve',
  'reject',
  'publish_started',
  'publish_succeeded',
  'publish_handoff',
  'publish_failed',
  'retry_publish',
  'handoff_completed',
  'supersede',
];

const TENANT = '11111111-1111-1111-1111-111111111111';
const SITE = '22222222-2222-2222-2222-222222222222';
const CHANGE = '33333333-3333-3333-3333-333333333333';
const USER = '44444444-4444-4444-4444-444444444444';

// ---------------------------------------------------------------------------
// 1. the pure transition table
// ---------------------------------------------------------------------------

describe('nextSiteChangeStatus', () => {
  it('reaches "approved" only via a human "approve", or an explicit retry of a failed publish', () => {
    const routes: Array<[SiteChangeStatus, SiteChangeEvent]> = [];
    for (const status of SITE_CHANGE_STATUSES) {
      for (const event of ALL_EVENTS) {
        if (nextSiteChangeStatus(status, event) === 'approved') routes.push([status, event]);
      }
    }
    // The retry edge preserves an approval that already happened — it cannot
    // manufacture one, because publish_failed is only reachable from approved.
    expect(routes.sort()).toEqual(
      [
        ['awaiting_approval', 'approve'],
        ['publish_failed', 'retry_publish'],
      ].sort(),
    );
  });

  it('reaches "publishing" only from "approved"', () => {
    const routes: Array<[SiteChangeStatus, SiteChangeEvent]> = [];
    for (const status of SITE_CHANGE_STATUSES) {
      for (const event of ALL_EVENTS) {
        if (nextSiteChangeStatus(status, event) === 'publishing') routes.push([status, event]);
      }
    }
    expect(routes).toEqual([['approved', 'publish_started']]);
  });

  it('never lets a verification failure reach approval', () => {
    for (const event of ALL_EVENTS) {
      expect(nextSiteChangeStatus('verification_failed', event)).not.toBe('approved');
    }
    // It can be re-staged and re-verified — that is the intended recovery path.
    expect(nextSiteChangeStatus('verification_failed', 'stage_succeeded')).toBe('staged');
  });

  it('treats "rejected" and "superseded" as terminal for every event', () => {
    for (const status of ['rejected', 'superseded'] as SiteChangeStatus[]) {
      expect(isTerminalSiteChangeStatus(status)).toBe(true);
      for (const event of ALL_EVENTS) {
        expect(nextSiteChangeStatus(status, event)).toBeNull();
      }
    }
  });

  it('walks the happy path proposed → staged → awaiting_approval → approved → publishing → published', () => {
    let status: SiteChangeStatus = 'proposed';
    status = nextSiteChangeStatus(status, 'stage_succeeded') as SiteChangeStatus;
    expect(status).toBe('staged');
    status = nextSiteChangeStatus(status, 'verify_passed') as SiteChangeStatus;
    expect(status).toBe('awaiting_approval');
    status = nextSiteChangeStatus(status, 'approve') as SiteChangeStatus;
    expect(status).toBe('approved');
    status = nextSiteChangeStatus(status, 'publish_started') as SiteChangeStatus;
    expect(status).toBe('publishing');
    status = nextSiteChangeStatus(status, 'publish_succeeded') as SiteChangeStatus;
    expect(status).toBe('published');
  });

  it('routes a git publish to handoff_required, and lets a human close it out', () => {
    expect(nextSiteChangeStatus('publishing', 'publish_handoff')).toBe('handoff_required');
    expect(nextSiteChangeStatus('handoff_required', 'handoff_completed')).toBe('published');
  });

  it('returns null rather than throwing on a nonsense pair', () => {
    expect(nextSiteChangeStatus('proposed', 'publish_succeeded')).toBeNull();
    expect(nextSiteChangeStatus('published', 'approve')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. the approval assertion
// ---------------------------------------------------------------------------

function approvalRecord(overrides: Partial<ApprovalCheckable> = {}): ApprovalCheckable {
  return {
    id: CHANGE,
    status: 'approved',
    approvedBy: USER,
    approvedAt: new Date('2026-08-05T10:00:00Z'),
    verifyPassed: true,
    ...overrides,
  };
}

describe('assertSiteChangeApproved', () => {
  it('accepts a complete approval record', () => {
    expect(() => assertSiteChangeApproved(approvalRecord())).not.toThrow();
  });

  it.each<SiteChangeStatus>(['proposed', 'staged', 'awaiting_approval', 'verification_failed', 'rejected'])(
    'refuses status "%s"',
    (status) => {
      try {
        assertSiteChangeApproved(approvalRecord({ status }));
        throw new Error('expected assertSiteChangeApproved to throw');
      } catch (e) {
        expect(e).toBeInstanceOf(SiteProviderError);
        expect((e as SiteProviderError).code).toBe('unauthorised_publish');
      }
    },
  );

  it.each([
    ['a null approver', { approvedBy: null }],
    ['a blank approver', { approvedBy: '   ' }],
    ['a missing timestamp', { approvedAt: null }],
    ['an invalid timestamp', { approvedAt: new Date('not-a-date') }],
    ['a failed verification', { verifyPassed: false }],
  ])('refuses %s', (_label, overrides) => {
    try {
      assertSiteChangeApproved(approvalRecord(overrides as Partial<ApprovalCheckable>));
      throw new Error('expected assertSiteChangeApproved to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(SiteProviderError);
      expect((e as SiteProviderError).code).toBe('unauthorised_publish');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. publishApprovedChange against the mock provider
// ---------------------------------------------------------------------------

interface FakeRow {
  [column: string]: unknown;
}

function baseRow(overrides: FakeRow = {}): FakeRow {
  return {
    id: CHANGE,
    tenant_id: TENANT,
    site_id: SITE,
    change_kind: 'page_update',
    page_url: 'https://example.com/pricing',
    status: 'approved',
    version: 4,
    payload: { pageUrl: 'https://example.com/pricing', metaTitle: 'Pricing' },
    staged_ref: 'staged-1',
    preview_url: null,
    diff: null,
    staged_at: new Date('2026-08-05T09:00:00Z'),
    verify_passed: true,
    verify_issues: [],
    verified_at: new Date('2026-08-05T09:05:00Z'),
    approved_by: USER,
    approved_at: new Date('2026-08-05T10:00:00Z'),
    rejected_by: null,
    rejected_at: null,
    decision_reason: null,
    publish_request_id: null,
    published_at: null,
    live_url: null,
    external_ref: null,
    publish_result: null,
    last_error: null,
    last_error_at: null,
    verified_live_at: null,
    superseded_by_change_id: null,
    source: 'admin',
    created_by: USER,
    created_at: new Date('2026-08-05T08:00:00Z'),
    updated_at: new Date('2026-08-05T10:00:00Z'),
    ...overrides,
  };
}

/**
 * A pool fake with just enough behaviour for applyTransition: an advisory
 * lock, a row that can be SELECTed FOR UPDATE, and an UPDATE that applies the
 * SET fragments back onto the row so a second transition sees the first one's
 * result.
 */
function installFakePool(row: FakeRow, opts: { lockAvailable?: boolean } = {}) {
  const state = { ...row };
  const lockAvailable = opts.lockAvailable ?? true;

  const clientQuery = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/^\s*(BEGIN|COMMIT|ROLLBACK)/i.test(sql)) return { rows: [], rowCount: 0 };
    if (sql.includes('pg_try_advisory_lock')) return { rows: [{ locked: lockAvailable }], rowCount: 1 };
    if (sql.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }], rowCount: 1 };
    if (sql.includes('FROM site_changes') && sql.includes('FOR UPDATE')) {
      return { rows: [{ ...state }], rowCount: 1 };
    }
    if (sql.trimStart().startsWith('UPDATE site_changes')) {
      // Mirror applyTransition's parameter layout: $1 tenant, $2 id, $3 status,
      // then one param per patch column in `SET` order.
      const setClause = sql.slice(sql.indexOf('SET') + 3, sql.indexOf('WHERE'));
      const assignments = setClause.split(',').map((s) => s.trim());
      for (const assignment of assignments) {
        const match = /^([a-z_]+)\s*=\s*\$(\d+)$/.exec(assignment);
        if (match) state[match[1]] = params[Number(match[2]) - 1];
        else if (/^version\s*=\s*version \+ 1$/.test(assignment)) state.version = Number(state.version) + 1;
      }
      return { rows: [{ ...state }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });

  const client = { query: clientQuery, release: vi.fn() };
  vi.mocked(pool.connect).mockResolvedValue(client as never);
  vi.mocked(pool.query).mockImplementation((async (sql: string) => {
    if (sql.includes('FROM site_changes')) return { rows: [{ ...state }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }) as never);

  return { state, clientQuery };
}

describe('publishApprovedChange', () => {
  let provider: MockSiteProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    resetSiteProvider();
    provider = new MockSiteProvider();
    provider.__reset();
    for (const platform of ['git', 'wordpress', 'shopify'] as const) {
      setSiteProvider(platform, provider);
    }
    vi.mocked(getSeoSiteById).mockResolvedValue({
      id: SITE,
      tenantId: TENANT,
      clientId: null,
      label: 'Example',
      domain: 'example.com',
      platform: 'wordpress',
      adapterConfig: {},
      credentialProvider: 'wordpress',
      gscProperty: null,
      ga4PropertyId: null,
      riskProfile: 'standard',
      requiredChecks: [],
      autoPublishAllowed: false,
      observationWindowDays: 21,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it('refuses to publish a change that is still awaiting approval — and never touches the provider', async () => {
    installFakePool(baseRow({ status: 'awaiting_approval', approved_by: null, approved_at: null }));
    const publishSpy = vi.spyOn(provider, 'publishChange');

    await expect(publishApprovedChange(TENANT, CHANGE)).rejects.toMatchObject({
      code: 'unauthorised_publish',
    });
    // The ordering IS the protection: an assertion that runs after the network
    // call has already gone out protects nothing.
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('refuses a row whose status says approved but which carries no approver', async () => {
    installFakePool(baseRow({ approved_by: null }));
    const publishSpy = vi.spyOn(provider, 'publishChange');

    await expect(publishApprovedChange(TENANT, CHANGE)).rejects.toMatchObject({
      code: 'unauthorised_publish',
    });
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('publishes an approved change and records the live url', async () => {
    const { state } = installFakePool(baseRow());

    const result = await publishApprovedChange(TENANT, CHANGE);

    expect(result?.status).toBe('published');
    expect(result?.liveUrl).toContain('example.com');
    expect(state.publish_request_id).toBeTruthy();
    expect(state.published_at).toBeInstanceOf(Date);
  });

  it('passes the recorded approver through to the provider', async () => {
    installFakePool(baseRow());
    const publishSpy = vi.spyOn(provider, 'publishChange');

    await publishApprovedChange(TENANT, CHANGE);

    expect(publishSpy).toHaveBeenCalledTimes(1);
    const approved = publishSpy.mock.calls[0][1];
    expect(approved.approvedBy).toBe(USER);
    expect(approved.stagedRef).toBe('staged-1');
    expect(approved.publishRequestId).toBeTruthy();
  });

  it('routes a git-profile site to handoff_required without the caller branching on provider name', async () => {
    // Same call, same caller, no `identity.name` check anywhere — only the
    // capability profile changes. This is the ADR-007 seam proof.
    provider.__setProfile('git');
    vi.mocked(getSeoSiteById).mockResolvedValue({
      id: SITE,
      tenantId: TENANT,
      clientId: null,
      label: 'Example',
      domain: 'example.com',
      platform: 'git',
      adapterConfig: { repo: 'org/site', branch: 'main' },
      credentialProvider: null,
      gscProperty: null,
      ga4PropertyId: null,
      riskProfile: 'standard',
      requiredChecks: [],
      autoPublishAllowed: false,
      observationWindowDays: 21,
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { state } = installFakePool(baseRow());

    const result = await publishApprovedChange(TENANT, CHANGE);

    expect(result?.status).toBe('handoff_required');
    expect(result?.publishedAt).toBeNull();
    expect(state.published_at).toBeNull();
    expect(provider.identity.name).toBe('mock');
  });

  it('returns null rather than double-publishing when another process holds the lock', async () => {
    installFakePool(baseRow(), { lockAvailable: false });
    const publishSpy = vi.spyOn(provider, 'publishChange');

    const result = await publishApprovedChange(TENANT, CHANGE);

    expect(result).toBeNull();
    expect(publishSpy).not.toHaveBeenCalled();
  });

  it('reuses an existing publish_request_id on retry so an idempotent provider can recognise it', async () => {
    const existing = '55555555-5555-5555-5555-555555555555';
    const { state } = installFakePool(baseRow({ status: 'publish_failed', publish_request_id: existing }));
    const publishSpy = vi.spyOn(provider, 'publishChange');

    // A failed publish is not directly re-publishable — it has to travel back
    // through 'approved' first, which is what keeps the approval assertion on
    // the retry path too.
    await expect(publishApprovedChange(TENANT, CHANGE)).rejects.toMatchObject({
      code: 'unauthorised_publish',
    });
    expect(publishSpy).not.toHaveBeenCalled();

    await retrySiteChangePublish(TENANT, CHANGE);
    expect(state.status).toBe('approved');

    await publishApprovedChange(TENANT, CHANGE);
    expect(publishSpy.mock.calls[0][1].publishRequestId).toBe(existing);
  });

  it('records the failure and rethrows when the provider fails', async () => {
    const { state } = installFakePool(baseRow());
    provider.__setScenario(TENANT, SITE, 'failure');

    await expect(publishApprovedChange(TENANT, CHANGE)).rejects.toBeInstanceOf(SiteProviderError);

    expect(state.status).toBe('publish_failed');
    expect(String(state.last_error)).toContain('scenario=failure');
  });
});

// ---------------------------------------------------------------------------
// 4. the structural guard
// ---------------------------------------------------------------------------

describe('publishChange has exactly one caller', () => {
  // `publishApprovedChange` is the only door into a provider's publish method
  // with the approval assertion on it. A second caller elsewhere in src/ would
  // be a door without one — and nothing about reading the code makes that
  // obvious, which is why this is a test and not a comment.
  it('is called only from siteChangeService.ts', () => {
    const srcRoot = join(__dirname, '..');
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === '__tests__' || entry === 'node_modules') continue;
          walk(full);
          continue;
        }
        if (!entry.endsWith('.ts')) continue;
        // The interface declares the method; the providers implement it.
        // Neither is a caller.
        if (full.includes(join('modules', 'site', 'providers'))) continue;
        if (full.endsWith(join('services', 'siteChangeService.ts'))) continue;

        const code = readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
          .replace(/\/\/.*$/gm, '');
        if (/\.publishChange\s*\(/.test(code)) offenders.push(full.slice(srcRoot.length + 1));
      }
    };

    walk(srcRoot);
    expect(offenders).toEqual([]);
  });
});
