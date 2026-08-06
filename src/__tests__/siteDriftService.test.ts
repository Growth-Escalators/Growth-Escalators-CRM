import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — hoisted above imports by Vitest, so the static imports below (and
// everything siteDriftService.ts itself imports) get the mocked versions.
// Factories are kept value-free (a documented trap in this repo: baked
// per-`it()` values in the factory silently make the LAST one win everywhere
// because `vi.mock` factories hoist once, in source order). Every test
// configures behaviour afterwards via `vi.mocked(fn).mockResolvedValue(...)`.
// ---------------------------------------------------------------------------
vi.mock('../db/index', () => ({
  pool: { query: vi.fn() },
}));

vi.mock('../services/seoSiteRegistry', () => ({
  listSeoSites: vi.fn(),
}));

vi.mock('../services/siteChangeService', () => ({
  markSiteChangeVerifiedLive: vi.fn(),
}));

vi.mock('../services/slackService', () => ({
  sendSlackMessage: vi.fn(),
}));

vi.mock('../config/constants', () => ({
  SLACK_SEO_CHANNEL: 'C_SEO_TEST',
}));

vi.mock('../services/seoTenantContext', () => ({
  resolveDefaultSeoTenantId: vi.fn().mockResolvedValue('tenant-default'),
}));

import { pool } from '../db/index';
import { listSeoSites } from '../services/seoSiteRegistry';
import { markSiteChangeVerifiedLive } from '../services/siteChangeService';
import { sendSlackMessage } from '../services/slackService';
import { resolveDefaultSeoTenantId } from '../services/seoTenantContext';
import { runSeoDriftSweep } from '../services/siteDriftService';
import { extractSeoElements, hashSeoElements, type SeoElements } from '../modules/site/liveSnapshot';
import type { SeoSite } from '../services/seoSiteRegistry';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const TENANT_ID = 'tenant-1';
const PAGE_URL = 'https://acme.example.com/pricing';

function makeSite(overrides: Partial<SeoSite> = {}): SeoSite {
  return {
    id: 'site-1',
    tenantId: TENANT_ID,
    clientId: null,
    label: 'Acme',
    domain: 'acme.example.com',
    platform: 'wordpress',
    adapterConfig: {},
    credentialProvider: null,
    gscProperty: null,
    ga4PropertyId: null,
    riskProfile: 'standard',
    requiredChecks: [],
    autoPublishAllowed: false,
    observationWindowDays: 21,
    status: 'active',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function fakeResponse(init: { status?: number; headers?: Record<string, string>; body?: string }): Response {
  const { status = 200, headers = { 'content-type': 'text/html' }, body = '' } = init;
  return new Response(body, { status, headers });
}

/** Maps an exact URL string to a canned response. Throws on any unexpected fetch (no network, ever). */
function makeFetchImpl(byUrl: Record<string, { status?: number; body?: string; headers?: Record<string, string> }>): typeof fetch {
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    const spec = byUrl[url];
    if (!spec) throw new Error(`siteDriftService test: unexpected fetch for ${url}`);
    return fakeResponse(spec);
  }) as unknown as typeof fetch;
}

/** The exact hash/elements a live sweep would compute for `html` at `url` — used to seed "previous" rows. */
function computeSnapshot(html: string, url: string = PAGE_URL): { elements: SeoElements; hash: string } {
  // Mirrors fetchLivePageSnapshot: it extracts against the URL AFTER
  // `new URL(...).toString()` normalisation, not the raw input string.
  const normalised = new URL(url).toString();
  const elements = extractSeoElements(html, normalised);
  return { elements, hash: hashSeoElements(elements) };
}

interface PoolState {
  clientPagesUrls: string[];
  recentChangeUrls: string[];
  previousSnapshots: Record<string, { content_hash: string; http_status: number; elements: SeoElements } | undefined>;
  matchedChanges: Record<string, { id: string; published_at: Date } | undefined>;
  insertedSnapshots: Array<{ id: string; params: unknown[] }>;
  updatedAlertedIds: string[];
  /** seo_page_metrics rows — the drift sweep's third URL source (top GSC URLs by impressions). */
  pageMetricsRows: Array<{ page_url: string; impressions: number; recorded_date: string }>;
}

/**
 * Routes `pool.query` calls by matching a stable substring of the SQL text
 * against each of siteDriftService's five distinct queries — the pattern this
 * repo already uses for services with more than one or two queries per call
 * (see seoIndexingQueue.test.ts's mockPoolForSync). Returns the mutable state
 * object so a test can inspect what was written, or mutate it mid-test (used
 * by the "does not re-alert" test to simulate the second sweep seeing the
 * snapshot the first sweep just wrote).
 */
function mockPool(seed: Partial<PoolState> = {}): PoolState {
  const state: PoolState = {
    clientPagesUrls: [],
    recentChangeUrls: [],
    previousSnapshots: {},
    matchedChanges: {},
    insertedSnapshots: [],
    updatedAlertedIds: [],
    pageMetricsRows: [],
    ...seed,
  };
  let nextId = 1;

  vi.mocked(pool.query).mockImplementation(async (text: unknown, params?: unknown[]) => {
    const sql = String(text);
    const p = (params ?? []) as unknown[];

    if (sql.includes('FROM client_pages')) {
      return { rows: state.clientPagesUrls.map((u) => ({ page_url: u })) } as never;
    }
    if (sql.includes('SELECT DISTINCT page_url FROM site_changes')) {
      return { rows: state.recentChangeUrls.map((u) => ({ page_url: u })) } as never;
    }
    if (sql.includes('SELECT id, published_at FROM site_changes')) {
      const url = p[2] as string;
      const row = state.matchedChanges[url];
      return { rows: row ? [row] : [] } as never;
    }
    if (sql.includes('content_hash, http_status, elements')) {
      const url = p[2] as string;
      const row = state.previousSnapshots[url];
      return { rows: row ? [row] : [] } as never;
    }
    if (sql.includes('MAX(recorded_date)')) {
      // Real MAX() semantics, not "whatever was inserted last" — a test can
      // seed rows out of order and this still answers "most recent on file".
      const dates = state.pageMetricsRows.map((r) => r.recorded_date).sort();
      return { rows: [{ latest_date: dates.length ? dates[dates.length - 1] : null }] } as never;
    }
    if (sql.includes('SELECT page_url FROM seo_page_metrics')) {
      // Mirrors the real query's WHERE/ORDER BY/LIMIT exactly, using the
      // params the implementation actually passed — so a wrong recorded_date,
      // wrong sort, or wrong limit shows up as a wrong result set, not a
      // silently-passing mock.
      const recordedDate = p[2] as string;
      const limit = p[3] as number;
      const rows = state.pageMetricsRows
        .filter((r) => r.recorded_date === recordedDate)
        .sort((a, b) => b.impressions - a.impressions)
        .slice(0, limit)
        .map((r) => ({ page_url: r.page_url }));
      return { rows } as never;
    }
    if (sql.includes('INSERT INTO seo_site_snapshots')) {
      const id = `snap-${nextId++}`;
      state.insertedSnapshots.push({ id, params: p });
      return { rows: [{ id }] } as never;
    }
    if (sql.includes('UPDATE seo_site_snapshots')) {
      state.updatedAlertedIds.push(p[1] as string);
      return { rowCount: 1 } as never;
    }
    throw new Error(`siteDriftService test: unrouted SQL: ${sql}`);
  });

  return state;
}

beforeEach(() => {
  vi.mocked(listSeoSites).mockReset();
  vi.mocked(markSiteChangeVerifiedLive).mockReset();
  vi.mocked(sendSlackMessage).mockReset().mockResolvedValue(true);
  vi.mocked(resolveDefaultSeoTenantId).mockReset().mockResolvedValue('tenant-default');
});

// ---------------------------------------------------------------------------
describe('runSeoDriftSweep', () => {
  it('unchanged hash writes nothing and does not classify', async () => {
    const html = '<title>Pricing</title><meta name="description" content="stable">';
    const { elements, hash } = computeSnapshot(html);

    vi.mocked(listSeoSites).mockResolvedValue([makeSite()]);
    const state = mockPool({
      clientPagesUrls: [PAGE_URL],
      previousSnapshots: { [PAGE_URL]: { content_hash: hash, http_status: 200, elements } },
    });
    const fetchImpl = makeFetchImpl({ [PAGE_URL]: { status: 200, body: html } });

    const summary = await runSeoDriftSweep(TENANT_ID, { fetchImpl });

    expect(summary).toEqual({ sites: 1, urls: 1, drifts: 0, alerts: 0, errors: 0 });
    expect(state.insertedSnapshots).toHaveLength(0); // never classified, never wrote a row
    expect(sendSlackMessage).not.toHaveBeenCalled();
    expect(markSiteChangeVerifiedLive).not.toHaveBeenCalled();
  });

  it('a changed <title> with no matching change produces unexpected_edit (the exit criterion)', async () => {
    const before = computeSnapshot('<title>Old Title</title>');
    const afterHtml = '<title>New Title</title>';

    vi.mocked(listSeoSites).mockResolvedValue([makeSite()]);
    const state = mockPool({
      clientPagesUrls: [PAGE_URL],
      previousSnapshots: { [PAGE_URL]: { content_hash: before.hash, http_status: 200, elements: before.elements } },
      matchedChanges: {}, // nothing of ours published for this URL
    });
    const fetchImpl = makeFetchImpl({ [PAGE_URL]: { status: 200, body: afterHtml } });

    const summary = await runSeoDriftSweep(TENANT_ID, { fetchImpl });

    expect(summary).toEqual({ sites: 1, urls: 1, drifts: 1, alerts: 1, errors: 0 });
    expect(state.insertedSnapshots).toHaveLength(1);
    expect(state.insertedSnapshots[0].params[7]).toBe('unexpected_edit'); // drift_kind
    expect(sendSlackMessage).toHaveBeenCalledOnce();
    expect(vi.mocked(sendSlackMessage).mock.calls[0][1]).toContain('unexpected_edit');
    expect(markSiteChangeVerifiedLive).not.toHaveBeenCalled();
  });

  it('a change published 1h ago produces verified_live and calls markSiteChangeVerifiedLive', async () => {
    const before = computeSnapshot('<title>Old Title</title>');
    const afterHtml = '<title>New Title</title>';
    const publishedAt = new Date(Date.now() - 60 * 60 * 1000); // 1h ago — inside the 48h attribution window

    vi.mocked(listSeoSites).mockResolvedValue([makeSite()]);
    const state = mockPool({
      clientPagesUrls: [PAGE_URL],
      previousSnapshots: { [PAGE_URL]: { content_hash: before.hash, http_status: 200, elements: before.elements } },
      matchedChanges: { [PAGE_URL]: { id: 'change-1', published_at: publishedAt } },
    });
    const fetchImpl = makeFetchImpl({ [PAGE_URL]: { status: 200, body: afterHtml } });

    const summary = await runSeoDriftSweep(TENANT_ID, { fetchImpl });

    expect(summary).toEqual({ sites: 1, urls: 1, drifts: 1, alerts: 0, errors: 0 });
    expect(state.insertedSnapshots[0].params[7]).toBe('verified_live');
    expect(markSiteChangeVerifiedLive).toHaveBeenCalledOnce();
    expect(markSiteChangeVerifiedLive).toHaveBeenCalledWith(TENANT_ID, 'change-1', expect.any(Date));
    // verified_live is the system working, not a page in trouble — no Slack noise for it.
    expect(sendSlackMessage).not.toHaveBeenCalled();
  });

  it('a 404 produces page_gone', async () => {
    const before = computeSnapshot('<title>Pricing</title>');

    vi.mocked(listSeoSites).mockResolvedValue([makeSite()]);
    const state = mockPool({
      clientPagesUrls: [PAGE_URL],
      previousSnapshots: { [PAGE_URL]: { content_hash: before.hash, http_status: 200, elements: before.elements } },
    });
    const fetchImpl = makeFetchImpl({ [PAGE_URL]: { status: 404, body: '<title>Not Found</title>' } });

    const summary = await runSeoDriftSweep(TENANT_ID, { fetchImpl });

    expect(summary).toEqual({ sites: 1, urls: 1, drifts: 1, alerts: 1, errors: 0 });
    expect(state.insertedSnapshots[0].params[7]).toBe('page_gone'); // drift_kind
    expect(state.insertedSnapshots[0].params[8]).toBe('critical'); // drift_severity
    expect(sendSlackMessage).toHaveBeenCalledOnce();
  });

  it('noindex appearing produces a critical alert', async () => {
    const before = computeSnapshot('<title>Pricing</title><meta name="robots" content="index, follow">');
    const afterHtml = '<title>Pricing</title><meta name="robots" content="noindex">';

    vi.mocked(listSeoSites).mockResolvedValue([makeSite()]);
    const state = mockPool({
      clientPagesUrls: [PAGE_URL],
      previousSnapshots: { [PAGE_URL]: { content_hash: before.hash, http_status: 200, elements: before.elements } },
    });
    const fetchImpl = makeFetchImpl({ [PAGE_URL]: { status: 200, body: afterHtml } });

    const summary = await runSeoDriftSweep(TENANT_ID, { fetchImpl });

    expect(summary.alerts).toBe(1);
    expect(state.insertedSnapshots[0].params[7]).toBe('noindex_added');
    expect(state.insertedSnapshots[0].params[8]).toBe('critical');
    expect(sendSlackMessage).toHaveBeenCalledOnce();
  });

  it('a second sweep of an already-alerted drift does NOT re-alert', async () => {
    const before = computeSnapshot('<title>Old Title</title>');
    const afterHtml = '<title>New Title</title>';
    const after = computeSnapshot(afterHtml);

    vi.mocked(listSeoSites).mockResolvedValue([makeSite()]);
    const state = mockPool({
      clientPagesUrls: [PAGE_URL],
      previousSnapshots: { [PAGE_URL]: { content_hash: before.hash, http_status: 200, elements: before.elements } },
    });
    const fetchImpl = makeFetchImpl({ [PAGE_URL]: { status: 200, body: afterHtml } });

    const first = await runSeoDriftSweep(TENANT_ID, { fetchImpl });
    expect(first.alerts).toBe(1);
    expect(sendSlackMessage).toHaveBeenCalledOnce();

    // Simulate what the DB now holds: the row the first sweep just wrote,
    // reflecting the still-drifted (unfixed) page.
    state.previousSnapshots[PAGE_URL] = { content_hash: after.hash, http_status: 200, elements: after.elements };

    const second = await runSeoDriftSweep(TENANT_ID, { fetchImpl });

    expect(second).toEqual({ sites: 1, urls: 1, drifts: 0, alerts: 0, errors: 0 }); // cheap path — hash unchanged since the alert
    expect(sendSlackMessage).toHaveBeenCalledOnce(); // still just the one call, from the first sweep
    expect(state.insertedSnapshots).toHaveLength(1); // no second row written either
  });

  it('one URL throwing does not abort the others', async () => {
    const urlA = 'https://acme.example.com/broken';
    const urlB = PAGE_URL;
    const beforeB = computeSnapshot('<title>Pricing</title>', urlB);

    vi.mocked(listSeoSites).mockResolvedValue([makeSite()]);
    mockPool({
      clientPagesUrls: [urlA, urlB],
      previousSnapshots: { [urlB]: { content_hash: beforeB.hash, http_status: 200, elements: beforeB.elements } },
    });
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url === urlA) throw new Error('connection reset');
      if (url === urlB) return fakeResponse({ status: 200, body: '<title>Pricing</title>' });
      throw new Error(`unexpected fetch for ${url}`);
    }) as unknown as typeof fetch;

    const summary = await runSeoDriftSweep(TENANT_ID, { fetchImpl });

    expect(summary.sites).toBe(1);
    expect(summary.urls).toBe(2); // both were attempted
    expect(summary.errors).toBe(1); // only urlA's failure counted
    expect(fetchImpl).toHaveBeenCalledTimes(2); // urlB was actually reached, not skipped
  });

  it('every query binds tenant_id', async () => {
    const before = computeSnapshot('<title>Old</title>');
    vi.mocked(listSeoSites).mockResolvedValue([makeSite()]);
    mockPool({
      clientPagesUrls: [PAGE_URL],
      recentChangeUrls: [PAGE_URL],
      previousSnapshots: { [PAGE_URL]: { content_hash: before.hash, http_status: 200, elements: before.elements } },
      matchedChanges: { [PAGE_URL]: { id: 'change-1', published_at: new Date() } },
    });
    const fetchImpl = makeFetchImpl({ [PAGE_URL]: { status: 200, body: '<title>New</title>' } });

    await runSeoDriftSweep(TENANT_ID, { fetchImpl });

    const calls = vi.mocked(pool.query).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [sqlArg, paramsArg] of calls) {
      expect(String(sqlArg)).toMatch(/tenant_id/i);
      expect((paramsArg as unknown[])?.[0]).toBe(TENANT_ID);
    }
  });

  it('skips sites that are not active (paused/archived)', async () => {
    vi.mocked(listSeoSites).mockResolvedValue([makeSite({ id: 'site-paused', status: 'paused' })]);
    mockPool();
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const summary = await runSeoDriftSweep(TENANT_ID, { fetchImpl });

    expect(summary).toEqual({ sites: 0, urls: 0, drifts: 0, alerts: 0, errors: 0 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('caps URLs per site at 200 and does not silently check more', async () => {
    const manyUrls = Array.from({ length: 250 }, (_, i) => `https://acme.example.com/page-${i}`);
    const html = '<title>Same</title>';

    vi.mocked(listSeoSites).mockResolvedValue([makeSite()]);
    const previousSnapshots: PoolState['previousSnapshots'] = {};
    const byUrl: Record<string, { status: number; body: string }> = {};
    for (const u of manyUrls) {
      const snap = computeSnapshot(html, u);
      previousSnapshots[u] = { content_hash: snap.hash, http_status: 200, elements: snap.elements };
      byUrl[u] = { status: 200, body: html };
    }
    mockPool({ clientPagesUrls: manyUrls, previousSnapshots });
    const fetchImpl = makeFetchImpl(byUrl);

    const summary = await runSeoDriftSweep(TENANT_ID, { fetchImpl });

    expect(summary.urls).toBe(200); // truncated from 250
    expect(fetchImpl).toHaveBeenCalledTimes(200); // the other 50 were never even fetched
  });

  it('falls back to resolveDefaultSeoTenantId when no tenantId is supplied', async () => {
    vi.mocked(listSeoSites).mockResolvedValue([]);
    mockPool();
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    const summary = await runSeoDriftSweep(undefined, { fetchImpl });

    expect(resolveDefaultSeoTenantId).toHaveBeenCalledOnce();
    expect(listSeoSites).toHaveBeenCalledWith('tenant-default');
    expect(summary).toEqual({ sites: 0, urls: 0, drifts: 0, alerts: 0, errors: 0 });
  });
});

// ---------------------------------------------------------------------------
// Third URL source — top seo_page_metrics URLs by impressions. Every test
// below seeds a `previousSnapshots` entry matching the live fetch response so
// the sweep takes the cheap unchanged-hash path (no classify, no alert) —
// these tests are about which URLs get CHECKED at all, not drift outcomes,
// which the `runSeoDriftSweep` describe block above already covers.
// ---------------------------------------------------------------------------
describe('third URL source — top seo_page_metrics URLs by impressions', () => {
  it('includes a GSC-only URL: present in seo_page_metrics but absent from client_pages and site_changes', async () => {
    const gscOnlyUrl = 'https://acme.example.com/gsc-only';
    const html = '<title>GSC Only</title>';
    const snap = computeSnapshot(html, gscOnlyUrl);

    vi.mocked(listSeoSites).mockResolvedValue([makeSite()]);
    mockPool({
      previousSnapshots: { [gscOnlyUrl]: { content_hash: snap.hash, http_status: 200, elements: snap.elements } },
      pageMetricsRows: [{ page_url: gscOnlyUrl, impressions: 500, recorded_date: '2026-08-05' }],
    });
    const fetchImpl = makeFetchImpl({ [gscOnlyUrl]: { status: 200, body: html } });

    const summary = await runSeoDriftSweep(TENANT_ID, { fetchImpl });

    // This URL exists in neither client_pages nor site_changes — the only
    // way it gets checked at all is via the seo_page_metrics source.
    expect(summary.urls).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('dedupes a URL that appears in both client_pages and seo_page_metrics', async () => {
    const before = computeSnapshot('<title>Pricing</title>');

    vi.mocked(listSeoSites).mockResolvedValue([makeSite()]);
    mockPool({
      clientPagesUrls: [PAGE_URL],
      previousSnapshots: { [PAGE_URL]: { content_hash: before.hash, http_status: 200, elements: before.elements } },
      pageMetricsRows: [{ page_url: PAGE_URL, impressions: 500, recorded_date: '2026-08-05' }],
    });
    const fetchImpl = makeFetchImpl({ [PAGE_URL]: { status: 200, body: '<title>Pricing</title>' } });

    const summary = await runSeoDriftSweep(TENANT_ID, { fetchImpl });

    expect(summary.urls).toBe(1); // one URL, checked once — not once per source
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('uses only the MOST RECENT recorded_date on file — a stale, higher-impression row is not a candidate', async () => {
    const oldUrl = 'https://acme.example.com/old-winner';
    const newUrl = 'https://acme.example.com/new-page';
    const oldSnap = computeSnapshot('<title>Old Winner</title>', oldUrl);
    const newSnap = computeSnapshot('<title>New Page</title>', newUrl);

    vi.mocked(listSeoSites).mockResolvedValue([makeSite()]);
    mockPool({
      previousSnapshots: {
        [oldUrl]: { content_hash: oldSnap.hash, http_status: 200, elements: oldSnap.elements },
        [newUrl]: { content_hash: newSnap.hash, http_status: 200, elements: newSnap.elements },
      },
      pageMetricsRows: [
        { page_url: oldUrl, impressions: 10_000, recorded_date: '2026-08-01' }, // far higher impressions, but a stale date
        { page_url: newUrl, impressions: 5, recorded_date: '2026-08-05' }, // the most recent date on file
      ],
    });
    const fetchImpl = makeFetchImpl({
      [oldUrl]: { status: 200, body: '<title>Old Winner</title>' },
      [newUrl]: { status: 200, body: '<title>New Page</title>' },
    });

    const summary = await runSeoDriftSweep(TENANT_ID, { fetchImpl });

    expect(summary.urls).toBe(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(newUrl, expect.anything());
  });

  it('orders by impressions descending and respects the top-50 limit', async () => {
    const RECORDED_DATE = '2026-08-05';
    const rows: PoolState['pageMetricsRows'] = [];
    const previousSnapshots: PoolState['previousSnapshots'] = {};
    const byUrl: Record<string, { status: number; body: string }> = {};

    // 55 candidates, one more than the 50-URL limit, ranked 1..55 by
    // impressions — the bottom 5 (impressions 1-5) must be dropped.
    for (let i = 1; i <= 55; i++) {
      const url = `https://acme.example.com/imp-${i}`;
      const html = `<title>Page ${i}</title>`;
      const snap = computeSnapshot(html, url);
      rows.push({ page_url: url, impressions: i, recorded_date: RECORDED_DATE });
      previousSnapshots[url] = { content_hash: snap.hash, http_status: 200, elements: snap.elements };
      byUrl[url] = { status: 200, body: html };
    }

    vi.mocked(listSeoSites).mockResolvedValue([makeSite()]);
    mockPool({ previousSnapshots, pageMetricsRows: rows });
    const fetchImpl = makeFetchImpl(byUrl);

    const summary = await runSeoDriftSweep(TENANT_ID, { fetchImpl });

    expect(summary.urls).toBe(50); // top 50 of 55 by impressions
    expect(fetchImpl).toHaveBeenCalledTimes(50);
    expect(fetchImpl).toHaveBeenCalledWith('https://acme.example.com/imp-55', expect.anything()); // highest impressions — made the cut
    for (let i = 1; i <= 5; i++) {
      expect(fetchImpl).not.toHaveBeenCalledWith(`https://acme.example.com/imp-${i}`, expect.anything()); // the five lowest — did not
    }
  });

  it('a site with no seo_page_metrics rows yet contributes nothing from this source, without error', async () => {
    const before = computeSnapshot('<title>Pricing</title>');

    vi.mocked(listSeoSites).mockResolvedValue([makeSite()]);
    mockPool({
      clientPagesUrls: [PAGE_URL],
      previousSnapshots: { [PAGE_URL]: { content_hash: before.hash, http_status: 200, elements: before.elements } },
      pageMetricsRows: [], // GSC pull hasn't run for this site yet
    });
    const fetchImpl = makeFetchImpl({ [PAGE_URL]: { status: 200, body: '<title>Pricing</title>' } });

    const summary = await runSeoDriftSweep(TENANT_ID, { fetchImpl });

    expect(summary).toEqual({ sites: 1, urls: 1, drifts: 0, alerts: 0, errors: 0 }); // client_pages source alone, no crash
  });
});
