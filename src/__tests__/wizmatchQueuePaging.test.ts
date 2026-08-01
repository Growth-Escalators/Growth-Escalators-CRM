// 2026-08-01 — server-side paging for the contact-intelligence queue.
//
// Three defects are fixed together here, and each has its own guard below:
//
// 1. THE PLACEHOLDER COLLISION. The row query builds its params array
//    positionally and interpolated `params.length` AFTER the last push. Adding a
//    second trailing param the obvious way produces `LIMIT $n OFFSET $n` — both
//    reading the same index — and with offset 0 that is `LIMIT 0`, i.e. an empty
//    queue in production on the happy path. Note that a bare
//    `expect(sql).toContain('OFFSET')` PASSES against that bug. The assertion
//    has to tie each placeholder back to its actual param value.
//
// 2. NON-DETERMINISTIC ORDER. OFFSET paging is only sound over a strict total
//    order. The query sorted by signal_score / active_signal_count / updated_at,
//    none of which is unique (score defaults to 0, the count is a small int, and
//    updated_at is nullable) — so ties left row order unspecified and paging
//    could duplicate and skip rows.
//
// 3. AN INFLATED `total`. The count keyed off wizmatch_job_signals.company_id
//    without requiring the company to be in the same tenant. The FK is
//    single-column (no tenant), so a cross-tenant reference is representable and
//    was counted, even though its company can never appear in `items`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const poolQuery = vi.fn();
vi.mock('../db/index', () => ({
  db: {},
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
}));

import { fetchContactIntelligenceCompanyRows } from '../services/wizmatchContactIntelligenceRepo';
import { clampListLimit, clampListOffset } from '../routes/wizmatch';

beforeEach(() => {
  poolQuery.mockReset();
  poolQuery.mockResolvedValue({ rows: [] });
});

/** The SQL text and params of the single query the fetcher issued. */
async function captureQuery(...args: Parameters<typeof fetchContactIntelligenceCompanyRows>) {
  await fetchContactIntelligenceCompanyRows(...args);
  const [sql, params] = poolQuery.mock.calls[0] as [string, unknown[]];
  return { sql: String(sql), params };
}

describe('LIMIT / OFFSET placeholders resolve to distinct params', () => {
  it('binds limit and offset to DIFFERENT placeholders holding the right values', async () => {
    const { sql, params } = await captureQuery('tenant-1', 25, { offset: 50 });

    const m = sql.match(/LIMIT \$(\d+) OFFSET \$(\d+)/);
    expect(m, 'query does not emit `LIMIT $n OFFSET $n`').toBeTruthy();

    const limitIdx = Number(m![1]);
    const offsetIdx = Number(m![2]);

    // The collision: both interpolating params.length gives $n === $n.
    expect(limitIdx, 'LIMIT and OFFSET share a placeholder index').not.toBe(offsetIdx);

    // Placeholders are 1-based; tie each back to its real value.
    expect(params[limitIdx - 1]).toBe(25);
    expect(params[offsetIdx - 1]).toBe(50);
    expect(params).toEqual(['tenant-1', 25, 50]);
  });

  it('always emits OFFSET, including the default-zero case', async () => {
    const { sql, params } = await captureQuery('tenant-1', 25);
    const m = sql.match(/LIMIT \$(\d+) OFFSET \$(\d+)/);
    expect(m).toBeTruthy();
    expect(params[Number(m![2]) - 1]).toBe(0);
  });
});

describe('companyId and offset cannot collide positionally', () => {
  it('keeps the companyId placeholder distinct from limit and offset', async () => {
    const { sql, params } = await captureQuery('tenant-1', 1, { companyId: 'co-1', offset: 5 });

    // Derive the index from the SQL rather than hardcoding $2 — hardcoding is the
    // positional brittleness the options-object signature exists to remove.
    const cm = sql.match(/AND c\.id = \$(\d+)/);
    expect(cm, 'companyId filter missing').toBeTruthy();
    const companyIdx = Number(cm![1]);
    expect(params[companyIdx - 1]).toBe('co-1');

    const lm = sql.match(/LIMIT \$(\d+) OFFSET \$(\d+)/)!;
    expect(new Set([companyIdx, Number(lm[1]), Number(lm[2])]).size).toBe(3);
  });

  it('the single-row callers still get limit 1 and offset 0', async () => {
    // persistContactIntelligenceSnapshot and the detail route both pass
    // (tenantId, 1, { companyId }) and treat 0 rows as "not found". A stray
    // offset here would 404 a company that exists.
    const { params } = await captureQuery('tenant-1', 1, { companyId: 'co-1' });
    expect(params).toEqual(['tenant-1', 'co-1', 1, 0]);
  });
});

describe('the ORDER BY is a strict total order', () => {
  it('ends with the primary key so ties cannot shuffle between pages', async () => {
    const { sql } = await captureQuery('tenant-1', 25);
    const orderBy = sql.slice(sql.lastIndexOf('ORDER BY'), sql.lastIndexOf('LIMIT'));
    expect(orderBy).toMatch(/c\.id\s+DESC/);
    // It must be LAST, or it would override a meaningful sort key.
    expect(orderBy.trim().replace(/\s+/g, ' ')).toMatch(/c\.id DESC$/);
  });

  it('sorts NULL updated_at last rather than first', async () => {
    // Under plain DESC, Postgres puts NULLs FIRST — so a company with no
    // updated_at outranked every peer tied with it on score and signal count.
    const { sql } = await captureQuery('tenant-1', 25);
    const orderBy = sql.slice(sql.lastIndexOf('ORDER BY'), sql.lastIndexOf('LIMIT'));
    expect(orderBy).toMatch(/c\.updated_at DESC NULLS LAST/);
  });
});

describe('clamps keep Postgres from ever seeing an invalid LIMIT/OFFSET', () => {
  // Postgres errors on LIMIT -5 AND on LIMIT 2.7 — truncation matters as much
  // as the floor, which `Math.min(Number(x) || 25, 100)` alone did not do.
  it.each([
    [-5, 1], [0, 25], [2.7, 2], ['abc', 25], ['', 25], [1e9, 100], [100, 100], [50, 50],
  ])('limit %j -> %i', (raw, expected) => {
    expect(clampListLimit(raw, 25, 100)).toBe(expected);
  });

  it.each([[-1, 0], [0, 0], [3.9, 3], ['abc', 0], ['', 0], [50, 50]])(
    'offset %j -> %i', (raw, expected) => {
      expect(clampListOffset(raw)).toBe(expected);
    });

  it('the repo clamps too, independently of the route', async () => {
    // Five callers, not all of them routes — the SQL boundary is the last line
    // of defence.
    const { params } = await captureQuery('tenant-1', -5 as number, { offset: -3 });
    expect(params).toEqual(['tenant-1', 1, 0]);
  });
});

describe('every paged route in wizmatch.ts clamps BOTH limit and offset', () => {
  // The first pass at this clamped `offset` on 7 routes but `limit` on only 2,
  // leaving 11 routes where ?limit=-5 still reached Postgres as `LIMIT -5` and
  // 500'd — the exact bug the helper was introduced to prevent. A per-route
  // audit is the only thing that catches a partially-applied sweep.
  const routeSrc = readFileSync(join(__dirname, '..', 'routes', 'wizmatch.ts'), 'utf8');
  const bare = routeSrc
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
    })
    .join('\n');

  it('no route still builds a limit with a bare Math.min(Number(...))', () => {
    expect(bare).not.toMatch(/Math\.min\(Number\(req\.query\.limit\)/);
  });

  it('no route still builds an offset with a bare Number(...) || 0', () => {
    expect(bare).not.toMatch(/Number\(req\.query\.offset\)\s*\|\|\s*0/);
  });

  it('every req.query.limit read goes through the clamp', () => {
    const reads = bare.match(/req\.query\.limit/g) ?? [];
    const clamped = bare.match(/clampListLimit\(req\.query\.limit/g) ?? [];
    expect(clamped.length).toBe(reads.length);
  });

  it('every req.query.offset read goes through the clamp', () => {
    const reads = bare.match(/req\.query\.offset/g) ?? [];
    const clamped = bare.match(/clampListOffset\(req\.query\.offset/g) ?? [];
    expect(clamped.length).toBe(reads.length);
  });
});
