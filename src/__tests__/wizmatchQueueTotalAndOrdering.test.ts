// 2026-08-01 — the two properties of queue paging that SQL-text assertions
// cannot establish, proved as behaviour instead.
//
// Part 1: the `total` fix, demonstrated on fixtures rather than asserted as a
// substring. The old count and the new one are both evaluated against the same
// rows, including the cross-tenant reference the single-column FK permits, and
// the two answers are shown to differ. A substring assertion would tell you the
// SQL changed; this tells you the number changed, and by how much.
//
// Part 2: the no-duplicate / no-skip property of OFFSET paging. This is a
// property of the ORDER BY being a STRICT TOTAL order — if any two distinct rows
// compare equal, their relative order is unspecified and a page boundary falling
// between them can show one row twice and never show the other.
//
// LIMITATION, stated plainly: Part 2 proves the ordering SPEC is total. It does
// not prove Postgres implements that spec — wizmatchQueuePaging.test.ts is what
// ties the spec to the emitted ORDER BY. Neither test alone is a proof; together
// they are.

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Part 1 — the total fix
// ---------------------------------------------------------------------------

type Company = { id: string; tenant_id: string };
type Signal = { tenant_id: string; company_id: string | null };

/** What the queue's row query actually returns: companies of THIS tenant that have a signal of THIS tenant. */
const reachableCompanies = (companies: Company[], signals: Signal[], tenantId: string) =>
  companies.filter((c) => c.tenant_id === tenantId
    && signals.some((s) => s.tenant_id === tenantId && s.company_id === c.id));

/** The NEW count: COUNT(*) FROM wizmatch_companies c WHERE c.tenant_id=$1 AND EXISTS (…) */
const newTotal = (companies: Company[], signals: Signal[], tenantId: string) =>
  reachableCompanies(companies, signals, tenantId).length;

/** The OLD count: COUNT(DISTINCT company_id) FROM wizmatch_job_signals WHERE tenant_id=$1 AND company_id IS NOT NULL */
const oldTotal = (_companies: Company[], signals: Signal[], tenantId: string) =>
  new Set(signals.filter((s) => s.tenant_id === tenantId && s.company_id != null).map((s) => s.company_id)).size;

describe('queue total counts only companies the query can actually return', () => {
  // ca belongs to tenant A. cb belongs to tenant B. The third signal belongs to
  // tenant A but points at cb — legal, because wizmatch_job_signals.company_id
  // is a SINGLE-COLUMN foreign key to wizmatch_companies.id with no tenant.
  const companies: Company[] = [
    { id: 'ca', tenant_id: 'A' },
    { id: 'cb', tenant_id: 'B' },
  ];
  const signals: Signal[] = [
    { tenant_id: 'A', company_id: 'ca' },
    { tenant_id: 'B', company_id: 'cb' },
    { tenant_id: 'A', company_id: 'cb' }, // <- cross-tenant reference
  ];

  it('the new total matches what a user can actually page through', () => {
    expect(newTotal(companies, signals, 'A')).toBe(1);
    expect(reachableCompanies(companies, signals, 'A').map((c) => c.id)).toEqual(['ca']);
  });

  it('the OLD total over-counted — this is the bug, made concrete', () => {
    expect(oldTotal(companies, signals, 'A')).toBe(2);
    expect(oldTotal(companies, signals, 'A')).toBeGreaterThan(newTotal(companies, signals, 'A'));
  });

  it('an inflated total is what makes Next a dead button', () => {
    // With total=2 and a page size of 1, the UI offers a second page that the
    // row query can never fill — the user clicks Next and nothing happens.
    const pageSize = 1;
    const reachable = reachableCompanies(companies, signals, 'A');
    const pagesClaimedByOldTotal = Math.ceil(oldTotal(companies, signals, 'A') / pageSize);
    const pagesActuallyFillable = Math.ceil(reachable.length / pageSize);
    expect(pagesClaimedByOldTotal).toBe(2);
    expect(pagesActuallyFillable).toBe(1);
  });

  it('signals with a null company_id count in neither', () => {
    const withNull: Signal[] = [...signals, { tenant_id: 'A', company_id: null }];
    expect(newTotal(companies, withNull, 'A')).toBe(1);
    expect(oldTotal(companies, withNull, 'A')).toBe(2);
  });

  it('a company with no signals at all is excluded', () => {
    const extra = [...companies, { id: 'cc', tenant_id: 'A' }];
    expect(newTotal(extra, signals, 'A')).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Part 2 — the ordering is a strict total order
// ---------------------------------------------------------------------------

type Row = { company_id: string; signal_score: number | null; active_signal_count: number; updated_at: string | null };

/**
 * Mirrors:
 *   ORDER BY COALESCE(ls.signal_score,0) DESC, active_signal_count DESC,
 *            c.updated_at DESC NULLS LAST, c.id DESC
 */
function compareRows(a: Row, b: Row): number {
  const score = (b.signal_score ?? 0) - (a.signal_score ?? 0);
  if (score !== 0) return score;
  const active = b.active_signal_count - a.active_signal_count;
  if (active !== 0) return active;
  // NULLS LAST under DESC: a null sorts after any non-null.
  if (a.updated_at !== b.updated_at) {
    if (a.updated_at === null) return 1;
    if (b.updated_at === null) return -1;
    return a.updated_at < b.updated_at ? 1 : -1;
  }
  if (a.company_id === b.company_id) return 0;
  return a.company_id < b.company_id ? 1 : -1; // c.id DESC
}

// Deliberately degenerate: every score 0, active count in {0,1}, a third with a
// NULL updated_at. This is the shape that made the old ordering unstable — if
// the comparator is not total, these fixtures expose it.
const rows: Row[] = Array.from({ length: 200 }, (_, i) => ({
  company_id: `c-${String(i).padStart(3, '0')}`,
  signal_score: 0,
  active_signal_count: i % 2,
  updated_at: i % 3 === 0 ? null : '2026-07-01T00:00:00Z',
}));

describe('OFFSET paging cannot duplicate or skip a row', () => {
  const sorted = [...rows].sort(compareRows);
  const PAGE = 25;
  const pages = Array.from({ length: Math.ceil(sorted.length / PAGE) }, (_, p) => sorted.slice(p * PAGE, (p + 1) * PAGE));

  it('no two DISTINCT rows compare equal (the strictness property)', () => {
    // This is the property that actually makes OFFSET safe. Everything else in
    // this describe follows from it.
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        expect(compareRows(sorted[i], sorted[j]), `${sorted[i].company_id} ties with ${sorted[j].company_id}`).not.toBe(0);
      }
    }
  });

  it('the union of all pages is exactly the full set', () => {
    const seen = pages.flat().map((r) => r.company_id);
    expect(seen).toHaveLength(rows.length);
    expect(new Set(seen).size).toBe(rows.length);
  });

  it('no id appears on two pages', () => {
    const seen = pages.flat().map((r) => r.company_id);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('each page equals the corresponding slice of the full sort', () => {
    pages.forEach((page, p) => {
      expect(page.map((r) => r.company_id)).toEqual(
        sorted.slice(p * PAGE, (p + 1) * PAGE).map((r) => r.company_id),
      );
    });
  });

  it('NULL updated_at sorts after a real timestamp at the same score/count', () => {
    const withDate: Row = { company_id: 'x', signal_score: 0, active_signal_count: 0, updated_at: '2026-07-01T00:00:00Z' };
    const withNull: Row = { company_id: 'y', signal_score: 0, active_signal_count: 0, updated_at: null };
    expect(compareRows(withDate, withNull)).toBeLessThan(0);
  });
});

describe('without the id tiebreak the property fails (why c.id is mandatory)', () => {
  const compareWithoutId = (a: Row, b: Row): number => {
    const score = (b.signal_score ?? 0) - (a.signal_score ?? 0);
    if (score !== 0) return score;
    const active = b.active_signal_count - a.active_signal_count;
    if (active !== 0) return active;
    if (a.updated_at === b.updated_at) return 0;
    if (a.updated_at === null) return 1;
    if (b.updated_at === null) return -1;
    return a.updated_at < b.updated_at ? 1 : -1;
  };

  it('distinct rows tie, so page boundaries would be unspecified', () => {
    // Scan every pair, not just adjacent ones — the fixture generator alternates
    // active_signal_count, so neighbours never tie even though many rows do.
    let ties = 0;
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        if (compareWithoutId(rows[i], rows[j]) === 0) ties += 1;
      }
    }
    expect(ties, 'no ties in the fixture — it cannot demonstrate the hazard').toBeGreaterThan(0);
  });

  it('and the full comparator resolves every one of those ties', () => {
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        if (compareWithoutId(rows[i], rows[j]) === 0) {
          expect(compareRows(rows[i], rows[j])).not.toBe(0);
        }
      }
    }
  });
});
