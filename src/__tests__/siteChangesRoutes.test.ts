// Route-level contract for src/routes/siteChanges.ts — the site_changes
// approvals API (migration 0048). Mirrors wizmatchTodayRoutes.test.ts's
// convention: mount the REAL router on a REAL express app, mock only the
// service/registry/live-fetch layers, and assert on path/role/error-mapping
// behaviour end to end. `../services/siteChangeCapabilities` is deliberately
// NOT mocked — it is the frozen, pure capabilities contract the route reads
// from, and using the real implementation is what proves the wiring (not
// just that some object with an `enabled` key came back).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { SiteChangeError, type SiteChange } from '../services/siteChangeService';
import type { SeoSite } from '../services/seoSiteRegistry';

// SiteProviderError is deliberately NOT imported statically here. This test
// file's top-level imports run once, before `beforeEach`'s vi.resetModules().
// `site-provider.interface.ts` is not vi.mock'd (nothing to fake — it's just
// classes/types), so resetModules gives the ROUTE a fresh module instance on
// every `startServer()` call, with its own distinct `SiteProviderError`
// class. A statically-imported class from before the reset would fail
// `instanceof` against errors the route constructs from its own fresh
// import — the same trap this suite's header warns about, just for a
// non-mocked module instead of a mocked one. Import it dynamically, after
// `startServer()`, so the test uses the SAME class identity the route sees.
async function freshSiteProviderError() {
  const mod = await import('../modules/site/providers/site-provider.interface');
  return mod.SiteProviderError;
}

// ---------------------------------------------------------------------------
// mocks — hoisted so the vi.mock factories below (which hoist above these
// imports at the source-transform level) can close over them. Every mock is
// value-free (vi.fn()); behaviour is set per-test with mockResolvedValue /
// mockRejectedValue, never baked into the factory — a shared vi.mock factory
// with a baked-in value would let the LAST test's value win everywhere else.
// ---------------------------------------------------------------------------
const serviceMocks = vi.hoisted(() => ({
  getSiteChange: vi.fn(),
  listSiteChanges: vi.fn(),
  createSiteChange: vi.fn(),
  stageSiteChange: vi.fn(),
  verifySiteChange: vi.fn(),
  approveSiteChange: vi.fn(),
  rejectSiteChange: vi.fn(),
  publishApprovedChange: vi.fn(),
  completeSiteChangeHandoff: vi.fn(),
}));

const registryMocks = vi.hoisted(() => ({
  getSeoSiteById: vi.fn(),
}));

const liveSnapshotMocks = vi.hoisted(() => ({
  fetchLivePageSnapshot: vi.fn(),
}));

vi.mock('../services/siteChangeService', async (importOriginal) => {
  // Keeps the real SiteChangeError class, isSiteChangeStatus, SITE_CHANGE_STATUSES,
  // etc. (pure, no I/O) — only the DB-backed functions are replaced.
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ...serviceMocks,
  };
});

vi.mock('../services/seoSiteRegistry', () => ({
  ...registryMocks,
}));

vi.mock('../modules/site/liveSnapshot', async (importOriginal) => {
  // extractSeoElements/diffSeoElements/EMPTY_SEO_ELEMENTS are pure — kept
  // real so preview tests exercise genuine extraction, not a stub.
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    ...liveSnapshotMocks,
  };
});

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------
function makeChange(overrides: Partial<SiteChange> = {}): SiteChange {
  return {
    id: 'change-1',
    tenantId: 'tenant-1',
    siteId: 'site-1',
    changeKind: 'page_update',
    pageUrl: '/services/dental-implants',
    status: 'awaiting_approval',
    version: 3,
    payload: {},
    stagedRef: 'staged-ref-1',
    previewUrl: null,
    diff: null,
    stagedAt: new Date('2026-08-01T00:00:00Z'),
    verifyPassed: true,
    verifyIssues: [],
    verifiedAt: new Date('2026-08-01T00:05:00Z'),
    approvedBy: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    decisionReason: null,
    publishRequestId: null,
    publishedAt: null,
    liveUrl: null,
    externalRef: null,
    publishResult: null,
    lastError: null,
    lastErrorAt: null,
    verifiedLiveAt: null,
    supersededByChangeId: null,
    source: 'admin',
    createdBy: 'user-1',
    createdAt: new Date('2026-07-31T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:05:00Z'),
    ...overrides,
  };
}

function makeSite(overrides: Partial<SeoSite> = {}): SeoSite {
  return {
    id: 'site-1',
    tenantId: 'tenant-1',
    clientId: null,
    label: 'Example',
    domain: 'example.com',
    platform: 'wordpress',
    adapterConfig: {},
    credentialProvider: null,
    gscProperty: null,
    ga4PropertyId: null,
    riskProfile: 'standard',
    requiredChecks: [],
    autoPublishAllowed: false,
    observationWindowDays: 14,
    status: 'active',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

let server: Server;
let baseUrl: string;

async function startServer(role = 'admin', userId = 'user-1', tenantId = 'tenant-1') {
  const { default: router } = await import('../routes/siteChanges');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: unknown }).user = { id: userId, tenantId, role, email: 'u@example.com', tokenVersion: 1 };
    next();
  });
  app.use('/api/seo-changes', router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(() => {
  vi.resetModules();
  for (const fn of Object.values(serviceMocks)) fn.mockReset();
  for (const fn of Object.values(registryMocks)) fn.mockReset();
  for (const fn of Object.values(liveSnapshotMocks)) fn.mockReset();
});

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// tenant scoping — the body must never override the session's tenantId
// ---------------------------------------------------------------------------
describe('tenant scoping', () => {
  it('POST / uses the session tenantId even when the body supplies a different one', async () => {
    serviceMocks.createSiteChange.mockResolvedValue(makeChange({ status: 'proposed' }));
    await startServer('admin', 'user-1', 'tenant-real');
    const res = await fetch(`${baseUrl}/api/seo-changes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        siteId: 'site-1',
        tenantId: 'tenant-attacker',
        payload: { pageUrl: '/x', isNewPage: false },
      }),
    });
    expect(res.status).toBe(201);
    expect(serviceMocks.createSiteChange).toHaveBeenCalledTimes(1);
    expect(serviceMocks.createSiteChange.mock.calls[0][0]).toBe('tenant-real');
  });

  it('GET / uses the session tenantId regardless of query params', async () => {
    serviceMocks.listSiteChanges.mockResolvedValue([]);
    await startServer('admin', 'user-1', 'tenant-real');
    const res = await fetch(`${baseUrl}/api/seo-changes?tenantId=tenant-attacker`);
    expect(res.status).toBe(200);
    expect(serviceMocks.listSiteChanges.mock.calls[0][0]).toBe('tenant-real');
  });

  it('POST /:id/approve uses the session tenantId', async () => {
    serviceMocks.approveSiteChange.mockResolvedValue(makeChange({ status: 'approved' }));
    await startServer('admin', 'user-1', 'tenant-real');
    const res = await fetch(`${baseUrl}/api/seo-changes/change-1/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 3, tenantId: 'tenant-attacker' }),
    });
    expect(res.status).toBe(200);
    expect(serviceMocks.approveSiteChange.mock.calls[0][0]).toBe('tenant-real');
  });
});

// ---------------------------------------------------------------------------
// role gating
// ---------------------------------------------------------------------------
describe('role gating', () => {
  it('a non-admin gets 403 on approve', async () => {
    await startServer('staff');
    const res = await fetch(`${baseUrl}/api/seo-changes/change-1/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1 }),
    });
    expect(res.status).toBe(403);
    expect(serviceMocks.approveSiteChange).not.toHaveBeenCalled();
  });

  it('a non-admin gets 403 on reject', async () => {
    await startServer('staff');
    const res = await fetch(`${baseUrl}/api/seo-changes/change-1/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'no', version: 1 }),
    });
    expect(res.status).toBe(403);
    expect(serviceMocks.rejectSiteChange).not.toHaveBeenCalled();
  });

  it('a non-admin gets 403 on publish', async () => {
    await startServer('staff');
    const res = await fetch(`${baseUrl}/api/seo-changes/change-1/publish`, { method: 'POST' });
    expect(res.status).toBe(403);
    expect(serviceMocks.publishApprovedChange).not.toHaveBeenCalled();
  });

  it('a non-admin gets 403 on handoff-complete', async () => {
    await startServer('staff');
    const res = await fetch(`${baseUrl}/api/seo-changes/change-1/handoff-complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1 }),
    });
    expect(res.status).toBe(403);
    expect(serviceMocks.completeSiteChangeHandoff).not.toHaveBeenCalled();
  });

  it('a non-admin gets 403 on create', async () => {
    await startServer('staff');
    const res = await fetch(`${baseUrl}/api/seo-changes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ siteId: 'site-1', payload: {} }),
    });
    expect(res.status).toBe(403);
    expect(serviceMocks.createSiteChange).not.toHaveBeenCalled();
  });

  it('a non-admin gets 200 on the list', async () => {
    serviceMocks.listSiteChanges.mockResolvedValue([makeChange()]);
    await startServer('staff');
    const res = await fetch(`${baseUrl}/api/seo-changes`);
    expect(res.status).toBe(200);
  });

  it('a non-admin gets 200 on a single change read', async () => {
    serviceMocks.getSiteChange.mockResolvedValue(makeChange());
    await startServer('staff');
    const res = await fetch(`${baseUrl}/api/seo-changes/change-1`);
    expect(res.status).toBe(200);
  });

  it('stage and verify are open to a non-admin role (not gated like approve/reject/publish)', async () => {
    serviceMocks.stageSiteChange.mockResolvedValue(makeChange({ status: 'staged' }));
    serviceMocks.verifySiteChange.mockResolvedValue(makeChange({ status: 'awaiting_approval' }));
    await startServer('staff');

    const stageRes = await fetch(`${baseUrl}/api/seo-changes/change-1/stage`, { method: 'POST' });
    expect(stageRes.status).toBe(200);
    expect(serviceMocks.stageSiteChange).toHaveBeenCalledTimes(1);

    const verifyRes = await fetch(`${baseUrl}/api/seo-changes/change-1/verify`, { method: 'POST' });
    expect(verifyRes.status).toBe(200);
    expect(serviceMocks.verifySiteChange).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// publish: null-means-locked, never a 500 or a silent success
// ---------------------------------------------------------------------------
describe('POST /:id/publish', () => {
  it('returns 409 publish_in_progress when the service returns null (lock held)', async () => {
    serviceMocks.publishApprovedChange.mockResolvedValue(null);
    await startServer('admin');
    const res = await fetch(`${baseUrl}/api/seo-changes/change-1/publish`, { method: 'POST' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('publish_in_progress');
  });

  it('returns 200 with the DTO on a real publish', async () => {
    serviceMocks.publishApprovedChange.mockResolvedValue(makeChange({ status: 'published' }));
    await startServer('admin');
    const res = await fetch(`${baseUrl}/api/seo-changes/change-1/publish`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { change: { status: string; capabilities: unknown } };
    expect(body.change.status).toBe('published');
    expect(body.change.capabilities).toBeDefined();
  });

  it('unauthorised_publish from the provider produces 403, not 500, with a stable code', async () => {
    await startServer('admin');
    const SiteProviderError = await freshSiteProviderError();
    serviceMocks.publishApprovedChange.mockRejectedValue(
      new SiteProviderError('unauthorised_publish', 'wordpress', 'change change-1 is not approved — refusing to publish'),
    );
    const res = await fetch(`${baseUrl}/api/seo-changes/change-1/publish`, { method: 'POST' });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('unauthorised_publish');
    // The raw provider message (which could echo internal detail) never
    // reaches the body — only the generic, stable message does.
    expect(body.message).not.toContain('change-1');
  });

  it('never leaks a raw provider error message for a non-approval provider failure', async () => {
    await startServer('admin');
    const SiteProviderError = await freshSiteProviderError();
    serviceMocks.publishApprovedChange.mockRejectedValue(
      new SiteProviderError('provider_unavailable', 'wordpress', 'connection refused to internal-host with token abc123'),
    );
    const res = await fetch(`${baseUrl}/api/seo-changes/change-1/publish`, { method: 'POST' });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('provider_unavailable');
    expect(JSON.stringify(body)).not.toContain('token abc123');
    expect(JSON.stringify(body)).not.toContain('internal-host');
  });
});

// ---------------------------------------------------------------------------
// SiteChangeError → HTTP status mapping
// ---------------------------------------------------------------------------
describe('SiteChangeError status mapping', () => {
  it.each([
    ['not_found', 404],
    ['invalid_transition', 409],
    ['version_conflict', 409],
    ['invalid_input', 400],
    ['site_not_ready', 409],
    ['unsupported_platform', 400],
  ] as const)('%s maps to %d', async (code, status) => {
    serviceMocks.stageSiteChange.mockRejectedValue(new SiteChangeError(code, `boom: ${code}`));
    await startServer('admin');
    const res = await fetch(`${baseUrl}/api/seo-changes/change-1/stage`, { method: 'POST' });
    expect(res.status).toBe(status);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(code);
  });

  it('a version_conflict on approve specifically produces 409 version_conflict', async () => {
    serviceMocks.approveSiteChange.mockRejectedValue(
      new SiteChangeError('version_conflict', 'change change-1 has moved on (expected version 1, found 3)'),
    );
    await startServer('admin');
    const res = await fetch(`${baseUrl}/api/seo-changes/change-1/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1 }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('version_conflict');
  });
});

// ---------------------------------------------------------------------------
// validation
// ---------------------------------------------------------------------------
describe('input validation', () => {
  it('reject without a reason is 400 and never reaches the service', async () => {
    await startServer('admin');
    const res = await fetch(`${baseUrl}/api/seo-changes/change-1/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1 }),
    });
    expect(res.status).toBe(400);
    expect(serviceMocks.rejectSiteChange).not.toHaveBeenCalled();
  });

  it('reject without a version is 400', async () => {
    await startServer('admin');
    const res = await fetch(`${baseUrl}/api/seo-changes/change-1/reject`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'no' }),
    });
    expect(res.status).toBe(400);
    expect(serviceMocks.rejectSiteChange).not.toHaveBeenCalled();
  });

  it('approve without a version is 400', async () => {
    await startServer('admin');
    const res = await fetch(`${baseUrl}/api/seo-changes/change-1/approve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(serviceMocks.approveSiteChange).not.toHaveBeenCalled();
  });

  it('handoff-complete without a version is 400', async () => {
    await startServer('admin');
    const res = await fetch(`${baseUrl}/api/seo-changes/change-1/handoff-complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(serviceMocks.completeSiteChangeHandoff).not.toHaveBeenCalled();
  });

  it('create without siteId is 400', async () => {
    await startServer('admin');
    const res = await fetch(`${baseUrl}/api/seo-changes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: {} }),
    });
    expect(res.status).toBe(400);
    expect(serviceMocks.createSiteChange).not.toHaveBeenCalled();
  });

  it('create with an invalid changeKind is 400', async () => {
    await startServer('admin');
    const res = await fetch(`${baseUrl}/api/seo-changes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ siteId: 'site-1', changeKind: 'not_a_real_kind', payload: {} }),
    });
    expect(res.status).toBe(400);
    expect(serviceMocks.createSiteChange).not.toHaveBeenCalled();
  });

  it('create with a non-object payload is 400', async () => {
    await startServer('admin');
    const res = await fetch(`${baseUrl}/api/seo-changes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ siteId: 'site-1', payload: 'not-an-object' }),
    });
    expect(res.status).toBe(400);
    expect(serviceMocks.createSiteChange).not.toHaveBeenCalled();
  });

  it('list rejects an invalid status query param with 400', async () => {
    await startServer('admin');
    const res = await fetch(`${baseUrl}/api/seo-changes?status=not_a_real_status`);
    expect(res.status).toBe(400);
    expect(serviceMocks.listSiteChanges).not.toHaveBeenCalled();
  });

  it('list rejects a non-positive-integer limit with 400', async () => {
    await startServer('admin');
    const res = await fetch(`${baseUrl}/api/seo-changes?limit=-1`);
    expect(res.status).toBe(400);
    expect(serviceMocks.listSiteChanges).not.toHaveBeenCalled();
  });

  it('list passes siteId/status/limit through to the service', async () => {
    serviceMocks.listSiteChanges.mockResolvedValue([]);
    await startServer('admin');
    const res = await fetch(`${baseUrl}/api/seo-changes?siteId=site-9&status=approved&limit=5`);
    expect(res.status).toBe(200);
    expect(serviceMocks.listSiteChanges).toHaveBeenCalledWith('tenant-1', {
      siteId: 'site-9',
      status: 'approved',
      limit: 5,
    });
  });
});

// ---------------------------------------------------------------------------
// GET /:id
// ---------------------------------------------------------------------------
describe('GET /:id', () => {
  it('404s when the change is not found for this tenant', async () => {
    serviceMocks.getSiteChange.mockResolvedValue(null);
    await startServer('admin');
    const res = await fetch(`${baseUrl}/api/seo-changes/missing`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_found');
  });
});

// ---------------------------------------------------------------------------
// DTO wiring — every row carries the capabilities/previewTier the UI reads
// ---------------------------------------------------------------------------
describe('DTO wiring', () => {
  it('every row in the list response carries capabilities and a previewTier', async () => {
    serviceMocks.listSiteChanges.mockResolvedValue([
      makeChange({ id: 'c1', status: 'awaiting_approval' }),
      makeChange({ id: 'c2', status: 'published' }),
    ]);
    await startServer('admin');
    const res = await fetch(`${baseUrl}/api/seo-changes`);
    const body = (await res.json()) as {
      changes: Array<{ id: string; capabilities: Record<string, { enabled: boolean }>; previewTier: string }>;
    };
    expect(body.changes).toHaveLength(2);
    for (const row of body.changes) {
      expect(row.capabilities).toBeDefined();
      expect(row.capabilities.approve).toBeDefined();
      expect(row.capabilities.publish).toBeDefined();
      expect(typeof row.previewTier).toBe('string');
    }
    // Real capability computation, not a stub: a published (terminal-ish —
    // actually not terminal, but not awaiting_approval) change cannot be approved.
    expect(body.changes[1].capabilities.approve.enabled).toBe(false);
  });

  it("a role that can't decide (staff) sees approve disabled even on an awaiting_approval change", async () => {
    serviceMocks.getSiteChange.mockResolvedValue(makeChange({ status: 'awaiting_approval', verifyPassed: true }));
    await startServer('staff');
    const res = await fetch(`${baseUrl}/api/seo-changes/change-1`);
    const body = (await res.json()) as { change: { capabilities: Record<string, { enabled: boolean; reason: string | null }> } };
    expect(body.change.capabilities.approve.enabled).toBe(false);
    expect(body.change.capabilities.approve.reason).toBeTruthy();
  });

  it('admin sees approve enabled on an awaiting_approval, verified change', async () => {
    serviceMocks.getSiteChange.mockResolvedValue(makeChange({ status: 'awaiting_approval', verifyPassed: true }));
    await startServer('admin');
    const res = await fetch(`${baseUrl}/api/seo-changes/change-1`);
    const body = (await res.json()) as { change: { capabilities: Record<string, { enabled: boolean }> } };
    expect(body.change.capabilities.approve.enabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /:id/preview
// ---------------------------------------------------------------------------
describe('GET /:id/preview', () => {
  it('survives a failed live fetch: before is null, response is still 200', async () => {
    serviceMocks.getSiteChange.mockResolvedValue(makeChange({ pageUrl: '/services/x', diff: null, payload: {} }));
    registryMocks.getSeoSiteById.mockResolvedValue(makeSite());
    liveSnapshotMocks.fetchLivePageSnapshot.mockRejectedValue(new Error('site is down'));
    await startServer('admin');

    const res = await fetch(`${baseUrl}/api/seo-changes/change-1/preview`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tier: string; diff: string | null; elements: { before: unknown; after: unknown } };
    expect(body.elements.before).toBeNull();
    expect(body.elements.after).toBeDefined();
  });

  it('never returns raw HTML — only extracted SeoElements fields', async () => {
    serviceMocks.getSiteChange.mockResolvedValue(
      makeChange({ pageUrl: '/x', payload: { bodyHtml: '<html><head><title>Hi</title></head><body><h1>Hi</h1></body></html>' } }),
    );
    registryMocks.getSeoSiteById.mockResolvedValue(makeSite());
    liveSnapshotMocks.fetchLivePageSnapshot.mockResolvedValue({
      pageUrl: 'https://example.com/x',
      fetchedAt: new Date(),
      httpStatus: 200,
      elements: { metaTitle: 'Old', metaDescription: null, canonicalUrl: null, robots: null, h1: 'Old H1', h1Count: 1, jsonLdTypes: [], wordCount: 2, internalLinkCount: 0, externalLinkCount: 0 },
      contentHash: 'abc',
    });
    await startServer('admin');

    const res = await fetch(`${baseUrl}/api/seo-changes/change-1/preview`);
    const body = (await res.json()) as { elements: { before: Record<string, unknown>; after: Record<string, unknown> } };
    for (const key of ['bodyHtml', 'html', 'rawHtml']) {
      expect(body.elements.before).not.toHaveProperty(key);
      expect(body.elements.after).not.toHaveProperty(key);
    }
    // 'after' was extracted fresh from the staged bodyHtml, not copied from 'before'.
    expect(body.elements.after.metaTitle).toBe('Hi');
  });

  it('skips the live fetch entirely when the change has no pageUrl', async () => {
    serviceMocks.getSiteChange.mockResolvedValue(makeChange({ pageUrl: null, changeKind: 'robots_txt', payload: {} }));
    await startServer('admin');

    const res = await fetch(`${baseUrl}/api/seo-changes/change-1/preview`);
    expect(res.status).toBe(200);
    expect(liveSnapshotMocks.fetchLivePageSnapshot).not.toHaveBeenCalled();
    const body = (await res.json()) as { elements: { before: unknown } };
    expect(body.elements.before).toBeNull();
  });

  it('fetches the live page at an absolute URL built from the site domain + change pageUrl', async () => {
    serviceMocks.getSiteChange.mockResolvedValue(makeChange({ pageUrl: '/services/dental-implants', payload: {} }));
    registryMocks.getSeoSiteById.mockResolvedValue(makeSite({ domain: 'example.com' }));
    liveSnapshotMocks.fetchLivePageSnapshot.mockResolvedValue({
      pageUrl: 'https://example.com/services/dental-implants',
      fetchedAt: new Date(),
      httpStatus: 200,
      elements: { metaTitle: 'Live', metaDescription: null, canonicalUrl: null, robots: null, h1: null, h1Count: 0, jsonLdTypes: [], wordCount: 0, internalLinkCount: 0, externalLinkCount: 0 },
      contentHash: 'x',
    });
    await startServer('admin');

    await fetch(`${baseUrl}/api/seo-changes/change-1/preview`);
    expect(liveSnapshotMocks.fetchLivePageSnapshot).toHaveBeenCalledWith(
      'https://example.com/services/dental-implants',
      expect.objectContaining({ providerName: expect.any(String) }),
    );
  });

  it('reports the stored diff and the DTO previewTier alongside the elements', async () => {
    serviceMocks.getSiteChange.mockResolvedValue(
      makeChange({ pageUrl: null, diff: '--- a/x\n+++ b/x', payload: {} }),
    );
    await startServer('admin');

    const res = await fetch(`${baseUrl}/api/seo-changes/change-1/preview`);
    const body = (await res.json()) as { tier: string; diff: string | null };
    expect(body.diff).toBe('--- a/x\n+++ b/x');
    expect(body.tier).toBe('diff');
  });

  it('404s when the change does not exist for this tenant', async () => {
    serviceMocks.getSiteChange.mockResolvedValue(null);
    await startServer('admin');
    const res = await fetch(`${baseUrl}/api/seo-changes/missing/preview`);
    expect(res.status).toBe(404);
  });
});
