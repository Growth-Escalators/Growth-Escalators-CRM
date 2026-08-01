// 2026-08-01 — the contact-intelligence read path used to issue 6-7 DB queries
// PER COMPANY:
//
//   1  internal contact candidates
//   3  persisted intelligence (company / candidates / discovery runs)
//   2-3 canonical policy eligibility
//
// At the queue's max page of 100 companies that is ~700 round trips, fired as
// one unbounded Promise.all burst against a pool with `max: 20`. Three routes
// shared the pattern — GET /contact-intelligence/queue, the review workbench
// (fixed 75 companies) and GET /command-center — but only command-center had
// been switched to the batched helpers, so the other two kept fanning out.
//
// All three now go through `buildBatchedContactIntelligence`, which turns the
// first four per-company queries into four set-based ones and bounds the
// remaining eligibility queries with a concurrency limiter.
//
// WHY THIS TEST EXISTS SEPARATELY FROM THE E2E SPEC: e2e/wizmatch-admin-request-
// fanout.spec.ts measures requests the BROWSER makes. This fan-out is entirely
// server-side — the browser issues exactly one request either way — so the e2e
// spec cannot see this regression at all. It has to be asserted here.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const routes = readFileSync(join(__dirname, '..', 'routes', 'wizmatch.ts'), 'utf8');
const repo = readFileSync(join(__dirname, '..', 'services', 'wizmatchContactIntelligenceRepo.ts'), 'utf8');

// Line-wise comment strip. NOT a block-comment regex: wizmatch.ts contains `*/`
// inside string literals and a /\*[\s\S]*?\*\// strip devours the file.
const strip = (src: string) => src
  .split('\n')
  .filter((l) => {
    const t = l.trim();
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  })
  .join('\n');

const bareRoutes = strip(routes);
const bareRepo = strip(repo);

/** Body of a named async function, up to the next top-level declaration. */
function functionBody(src: string, decl: string): string {
  const start = src.indexOf(decl);
  expect(start, `not found: ${decl}`).toBeGreaterThan(-1);
  const next = src.indexOf('\nasync function ', start + decl.length);
  const nextRouter = src.indexOf('\nrouter.', start + decl.length);
  const ends = [next, nextRouter].filter((n) => n > -1);
  return src.slice(start, ends.length ? Math.min(...ends) : undefined);
}

describe('the contact-intelligence fan-out is batched in exactly one place', () => {
  it('the shared helper exists', () => {
    expect(bareRoutes).toMatch(/async function buildBatchedContactIntelligence\(/);
  });

  it('all three consumers call the shared helper', () => {
    // queue route, review workbench, command-center. If a fourth consumer is
    // added and calls the builders directly, the next assertion catches it.
    const calls = bareRoutes.match(/await buildBatchedContactIntelligence\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('NO route maps the per-company builders directly any more', () => {
    // This is the actual regression guard. Before the fix, each consumer did
    //   rows.map((row) => buildContactIntelligenceResult(tenantId, row))
    // with no override argument — which is what made it 1 query per company.
    // A two-argument call inside a .map is the fan-out signature.
    expect(bareRoutes).not.toMatch(/\.map\(\s*\(row\)\s*=>\s*buildContactIntelligenceResult\(\s*tenantId,\s*row\s*\)\s*\)/);
    expect(bareRoutes).not.toMatch(/\.map\(\s*\(item\)\s*=>\s*withPersistedContactIntelligence\(\s*tenantId,\s*item\s*\)\s*\)/);
  });

  it('the helper batches all three fan-outs, not just two', () => {
    const body = functionBody(bareRoutes, 'async function buildBatchedContactIntelligence(');
    expect(body).toContain('fetchInternalContactCandidatesBatch');
    expect(body).toContain('fetchPersistedContactIntelligenceBatch');
    // The eligibility batch is the one most easily forgotten — it is a
    // concurrency limiter rather than a query batcher, so it looks optional.
    expect(body).toContain('resolveCanonicalCompanyEligibilityBatch');
  });

  it('the three batch fetches run concurrently, not in series', () => {
    const body = functionBody(bareRoutes, 'async function buildBatchedContactIntelligence(');
    expect(body).toMatch(/await Promise\.all\(\[[\s\S]*?fetchInternalContactCandidatesBatch[\s\S]*?fetchPersistedContactIntelligenceBatch[\s\S]*?resolveCanonicalCompanyEligibilityBatch[\s\S]*?\]\)/);
  });

  it('every batched result is actually passed into the builders', () => {
    // Fetching a batch and then not using it would be worse than not batching:
    // the queries still run AND the per-company ones run too.
    const body = functionBody(bareRoutes, 'async function buildBatchedContactIntelligence(');
    expect(body).toMatch(/internalContactsByCompany\.get\(row\.company_id\)/);
    expect(body).toMatch(/canonicalByCompany\.get\(row\.company_id\)/);
    expect(body).toMatch(/persistedByCompany\.get\(item\.companyId\)/);
  });

  it('an empty page short-circuits instead of issuing three empty batch queries', () => {
    const body = functionBody(bareRoutes, 'async function buildBatchedContactIntelligence(');
    expect(body).toMatch(/if \(rows\.length === 0\) return \[\]/);
  });
});

describe('the builders keep working without overrides (behaviour is unchanged)', () => {
  it('all three override params are optional', () => {
    // Every override must stay optional: the detail routes call these for a
    // single company, where batching is pointless and the old path is correct.
    expect(bareRepo).toMatch(/internalContactsOverride\?:/);
    expect(bareRepo).toMatch(/canonicalEligibilityOverride\?:/);
    expect(bareRepo).toMatch(/persistedOverride\?:/);
  });

  it('each override falls back to the per-company fetch when omitted', () => {
    expect(bareRepo).toMatch(/internalContactsOverride \?\? await fetchInternalContactCandidates\(/);
    expect(bareRepo).toMatch(/canonicalEligibilityOverride \?\? await resolveCanonicalCompanyEligibility\(/);
  });

  it('uses ?? not ||, so a legitimately empty batch result is not re-fetched', () => {
    // A company with zero internal contacts batches to `[]`. With `||` that
    // falsy-but-valid result would fall through and re-issue the very query the
    // batch was meant to replace — silently restoring the N+1 for exactly the
    // companies that have no contacts.
    expect(bareRepo).not.toMatch(/internalContactsOverride \|\|/);
    expect(bareRepo).not.toMatch(/canonicalEligibilityOverride \|\|/);
  });
});
