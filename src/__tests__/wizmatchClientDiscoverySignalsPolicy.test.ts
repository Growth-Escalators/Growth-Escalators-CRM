// H-5 (code review, revoked-PR-8B remediation) — regression tests for
// `fetchClientDiscoverySignals`'s blocked-signal exclusion (PRD-005 §8.2 L4).
//
// Confirmed by the prior read-only audit: `fetchClientDiscoverySignals`'s raw
// SQL had NO policy predicate at all, so an ACTIVE `specific_signal` blocked
// policy row never stopped that signal from surfacing, ranking or scoring in
// client discovery — and the `active_signal_count` subquery counted a
// blocked sibling signal too, inflating a company's OWN discovery score via
// `signalStrength` in `wizmatchClientDiscovery.ts`. Fixed at the SQL source
// (mirroring `prepareCompanies.ts`'s `fetchBestSignal` NOT EXISTS pattern),
// tenant-scoped the same way (the policy row's tenant must match the
// signal's tenant — the exact bug class H-1 closes elsewhere in this repo).
//
// This file's mock is a faithful (small) interpreter of the two NOT EXISTS
// predicates under test, not a vacuous stand-in that returns a fixture
// verbatim — the same discipline `prepareCompanies.test.ts` uses for
// `fetchBestSignal`, and the same discipline this project's own revoked
// CODE_READY verdict was found to be missing (a passing mutation control
// proves only what it mutates). Every assertion below has a real, source-level
// mutation control: temporarily strip the clause from `wizmatch.ts`, confirm
// red, restore, confirm green.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mockPoolQuery = vi.fn();

vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args) },
}));

interface SignalFixture {
  id: string;
  tenantId: string;
  companyId: string;
  status: string;
  score: number | null;
}

interface PolicyFixture {
  tenantId: string;
  companyId: string;
  signalId: string;
  outreachEligibility: string;
  supersededAt: Date | null;
}

const state = {
  signals: [] as SignalFixture[],
  policies: [] as PolicyFixture[],
};

/**
 * Isolates the `NOT EXISTS (SELECT 1 FROM wizmatch_company_policies ...)`
 * block within a larger chunk of query text, via balanced-paren matching.
 * Isolation matters: `restText` (below) also contains the UNRELATED
 * `placement_count` subquery, which correlates on `wp.tenant_id = s.tenant_id`
 * — an un-anchored substring check for `.tenant_id = s.tenant_id` matches
 * that too (`wp.tenant_id` ends in `p.tenant_id`), so a tenant-predicate
 * check run against the whole surrounding text would silently pass even
 * after the real exclusion's OWN tenant correlation was deleted. Isolating
 * the exclusion block first is what makes the tenant-scoping mutation
 * control below actually load-bearing.
 */
function extractExclusionBlock(text: string): string | null {
  const policiesIdx = text.indexOf('wizmatch_company_policies');
  if (policiesIdx === -1) return null;
  const startIdx = text.lastIndexOf('NOT EXISTS (', policiesIdx);
  if (startIdx === -1) return null;
  const openParenIdx = startIdx + 'NOT EXISTS ('.length - 1;
  let depth = 0;
  for (let i = openParenIdx; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') {
      depth--;
      if (depth === 0) return text.slice(startIdx, i + 1);
    }
  }
  return text.slice(startIdx);
}

/** The exact five-part predicate the fix adds, checked WITHIN the isolated block only. */
function hasBlockExclusion(text: string): boolean {
  const block = extractExclusionBlock(text);
  if (!block) return false;
  return /scope_type = 'specific_signal'/.test(block)
    && /outreach_eligibility = 'blocked'/.test(block)
    && /superseded_at IS NULL/.test(block);
}

/** The tenant correlation inside that predicate — the H-1-class safety bar. */
function hasTenantPredicate(text: string): boolean {
  const block = extractExclusionBlock(text);
  if (!block) return false;
  return /\.tenant_id = s\d?\.tenant_id/.test(block);
}

function blockedSignalIds(tenantId: string, enforceTenant: boolean): Set<string> {
  const ids = new Set<string>();
  for (const p of state.policies) {
    if (p.outreachEligibility !== 'blocked' || p.supersededAt !== null) continue;
    if (enforceTenant && p.tenantId !== tenantId) continue;
    ids.add(p.signalId);
  }
  return ids;
}

/**
 * Faithful (small) interpreter of `fetchClientDiscoverySignals`'s raw SQL.
 * Reacts to the ACTUAL text vitest is handed, so deleting the NOT EXISTS
 * clause (or just its tenant correlation) from `wizmatch.ts` changes this
 * mock's output, not only a fixture the test controls directly.
 */
function dispatch(sqlText: string, params: unknown[]) {
  const text = String(sqlText).replace(/\s+/g, ' ').trim();
  const tenantId = params[0] as string;

  const countMarkerIdx = text.indexOf('AS active_signal_count');
  const countSubqueryText = text.slice(0, countMarkerIdx);
  const restText = text.slice(countMarkerIdx);

  const countExcludesBlocked = hasBlockExclusion(countSubqueryText);
  const countTenantScoped = hasTenantPredicate(countSubqueryText);
  const rowExcludesBlocked = hasBlockExclusion(restText);
  const rowTenantScoped = hasTenantPredicate(restText);

  const rowBlocked = blockedSignalIds(tenantId, rowTenantScoped);
  const countBlocked = blockedSignalIds(tenantId, countTenantScoped);

  const eligibleSignals = state.signals.filter((s) => {
    if (s.tenantId !== tenantId) return false;
    if (s.status === 'dead' || s.status === 'placed') return false;
    if (rowExcludesBlocked && rowBlocked.has(s.id)) return false;
    return true;
  });

  const ordered = [...eligibleSignals].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

  const rows = ordered.map((s) => ({
    id: s.id,
    job_title: `Role for ${s.id}`,
    company_id: s.companyId,
    company_name: 'Acme',
    company_domain: null,
    company_industry: null,
    company_country: null,
    is_prime: null,
    prime_msa_status: null,
    h1b_sponsor_count: null,
    source: null,
    location: null,
    status: s.status,
    signal_score: s.score,
    days_open: null,
    repost_count: null,
    matched_candidate_count: 0,
    active_signal_count: state.signals.filter((s2) => {
      if (s2.tenantId !== s.tenantId) return false;
      if (s2.companyId !== s.companyId) return false;
      if (s2.status === 'dead' || s2.status === 'placed') return false;
      if (countExcludesBlocked && countBlocked.has(s2.id)) return false;
      return true;
    }).length,
    positive_reply_count: 0,
    placement_count: 0,
    domain_status: null,
    suppressed_count: 0,
    active_duplicate_count: 0,
  }));

  return { rows, rowCount: rows.length };
}

beforeEach(() => {
  state.signals = [];
  state.policies = [];
  mockPoolQuery.mockImplementation((sql: string, params: unknown[] = []) => dispatch(sql, params));
});

describe('fetchClientDiscoverySignals — a blocked specific_signal row is excluded', () => {
  it('excludes the blocked signal from the result set, keeping the open sibling', async () => {
    state.signals = [
      { id: 'sig-blocked', tenantId: 'tenant-1', companyId: 'company-1', status: 'new', score: 90 },
      { id: 'sig-open', tenantId: 'tenant-1', companyId: 'company-1', status: 'new', score: 40 },
    ];
    state.policies = [
      { tenantId: 'tenant-1', companyId: 'company-1', signalId: 'sig-blocked', outreachEligibility: 'blocked', supersededAt: null },
    ];
    const { fetchClientDiscoverySignals } = await import('../routes/wizmatch');
    const rows = await fetchClientDiscoverySignals('tenant-1', 25);
    expect(rows.map((r) => r.id)).toEqual(['sig-open']);
  });

  // CONTROL — with no blocked signal, both surface, highest score first.
  it('returns both signals when neither is blocked (control)', async () => {
    state.signals = [
      { id: 'sig-a', tenantId: 'tenant-1', companyId: 'company-1', status: 'new', score: 90 },
      { id: 'sig-b', tenantId: 'tenant-1', companyId: 'company-1', status: 'new', score: 40 },
    ];
    const { fetchClientDiscoverySignals } = await import('../routes/wizmatch');
    const rows = await fetchClientDiscoverySignals('tenant-1', 25);
    expect(rows.map((r) => r.id)).toEqual(['sig-a', 'sig-b']);
  });

  // CONTROL — a merely-overridable block (not yet superseded, but the row's
  // own `outreach_eligibility` is what matters, not overridability) still
  // excludes: overridability governs whether an admin MAY supersede the row,
  // not whether the block is in force right now (mirrors prepareCompanies.ts).
  it('excludes an overridable-but-currently-blocked signal too', async () => {
    state.signals = [
      { id: 'sig-blocked', tenantId: 'tenant-1', companyId: 'company-1', status: 'new', score: 90 },
    ];
    state.policies = [
      { tenantId: 'tenant-1', companyId: 'company-1', signalId: 'sig-blocked', outreachEligibility: 'blocked', supersededAt: null },
    ];
    const { fetchClientDiscoverySignals } = await import('../routes/wizmatch');
    const rows = await fetchClientDiscoverySignals('tenant-1', 25);
    expect(rows).toHaveLength(0);
  });

  // CONTROL — a SUPERSEDED block (no longer active) must not exclude.
  it('does not exclude a signal whose block has been superseded', async () => {
    state.signals = [
      { id: 'sig-a', tenantId: 'tenant-1', companyId: 'company-1', status: 'new', score: 90 },
    ];
    state.policies = [
      { tenantId: 'tenant-1', companyId: 'company-1', signalId: 'sig-a', outreachEligibility: 'blocked', supersededAt: new Date() },
    ];
    const { fetchClientDiscoverySignals } = await import('../routes/wizmatch');
    const rows = await fetchClientDiscoverySignals('tenant-1', 25);
    expect(rows.map((r) => r.id)).toEqual(['sig-a']);
  });
});

describe('fetchClientDiscoverySignals — active_signal_count excludes a blocked sibling', () => {
  it('does not let a blocked sibling inflate the open signal\'s own active_signal_count', async () => {
    state.signals = [
      { id: 'sig-blocked', tenantId: 'tenant-1', companyId: 'company-1', status: 'new', score: 90 },
      { id: 'sig-open', tenantId: 'tenant-1', companyId: 'company-1', status: 'new', score: 40 },
    ];
    state.policies = [
      { tenantId: 'tenant-1', companyId: 'company-1', signalId: 'sig-blocked', outreachEligibility: 'blocked', supersededAt: null },
    ];
    const { fetchClientDiscoverySignals } = await import('../routes/wizmatch');
    const rows = await fetchClientDiscoverySignals('tenant-1', 25);
    expect(rows).toHaveLength(1);
    // Without the count-subquery fix this would read 2 (both open signals
    // counted); with the fix, the blocked sibling is excluded, leaving 1
    // (sig-open counting only itself).
    expect(rows[0].activeSignalCount).toBe(1);
  });

  // CONTROL — three open siblings, none blocked: the count is the raw open count.
  it('counts every open sibling when none is blocked (control)', async () => {
    state.signals = [
      { id: 'sig-a', tenantId: 'tenant-1', companyId: 'company-1', status: 'new', score: 90 },
      { id: 'sig-b', tenantId: 'tenant-1', companyId: 'company-1', status: 'new', score: 40 },
      { id: 'sig-c', tenantId: 'tenant-1', companyId: 'company-1', status: 'new', score: 30 },
    ];
    const { fetchClientDiscoverySignals } = await import('../routes/wizmatch');
    const rows = await fetchClientDiscoverySignals('tenant-1', 25);
    expect(rows[0].activeSignalCount).toBe(3);
  });
});

describe('fetchClientDiscoverySignals — tenant scoping (H-1-class safety bar)', () => {
  it('a blocked signal in tenant B never affects tenant A\'s discovery results or counts', async () => {
    // Same company_id value reused across two tenants deliberately, to
    // isolate the TENANT predicate specifically — company ids are otherwise
    // tenant-unique in production, so this is the only way to prove the
    // tenant correlation (not the company correlation) is what is doing the
    // work here.
    state.signals = [
      { id: 'sig-a', tenantId: 'tenant-A', companyId: 'company-1', status: 'new', score: 90 },
      { id: 'sig-b', tenantId: 'tenant-A', companyId: 'company-1', status: 'new', score: 40 },
    ];
    state.policies = [
      // Blocks a same-id-shaped signal, but under tenant-B — must never
      // reach across into tenant-A's query.
      { tenantId: 'tenant-B', companyId: 'company-1', signalId: 'sig-a', outreachEligibility: 'blocked', supersededAt: null },
    ];
    const { fetchClientDiscoverySignals } = await import('../routes/wizmatch');
    const rows = await fetchClientDiscoverySignals('tenant-A', 25);
    expect(rows.map((r) => r.id)).toEqual(['sig-a', 'sig-b']);
    expect(rows.find((r) => r.id === 'sig-a')!.activeSignalCount).toBe(2);
  });

  it('scopes both NOT EXISTS exclusions to the same tenant as the signal they guard (static source check)', () => {
    const source = readFileSync(join(__dirname, '../routes/wizmatch.ts'), 'utf8');
    // Matched with a leading word boundary that excludes a `w` prefix, since
    // `wp.tenant_id = s.tenant_id` (the unrelated placement_count subquery,
    // alias `wp`) is itself a substring match for the un-anchored form of
    // this assertion — a real false-positive this test tripped over while
    // being written, and exactly the "assertion satisfied by an unrelated
    // string" defect class this repo's revoked review called out.
    expect(source).toMatch(/(?<!w)\bp\.tenant_id = s\.tenant_id/);
    expect(source).toMatch(/\bp2\.tenant_id = s2\.tenant_id/);
    expect(source).toMatch(/(?<!w)\bp\.company_id = s\.company_id/);
    expect(source).toMatch(/\bp2\.company_id = s2\.company_id/);
    // The distinctive, unambiguous anchor for each exclusion's own scope key.
    expect(source).toContain("p.scope_key = 'specific_signal:' || LOWER(s.id::text)");
    expect(source).toContain("p2.scope_key = 'specific_signal:' || LOWER(s2.id::text)");
  });
});
