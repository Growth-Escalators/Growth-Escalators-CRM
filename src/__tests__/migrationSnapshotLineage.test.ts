// Guards the drizzle SNAPSHOT lineage — a sibling failure to the journal
// ordering bug in migrationJournalOrdering.test.ts, found the same way (a
// deploy nearly broke) and invisible to every check that existed at the time.
//
// WHAT WENT WRONG. The five SEO migrations were generated as 0045-0049 against
// `meta/0044_snapshot.json`, then renumbered to 0047-0051 during a merge with
// main. The renumber moved the .sql files and rewrote the journal — but not the
// snapshots. Two separate breakages resulted, both sitting on main undetected:
//
//   1. `0047_snapshot.json.prevId` still pointed at 0044, the same parent
//      `0045_snapshot.json` claims. drizzle-kit refuses to run at all with
//      "are pointing to a parent snapshot ... which is a collision" — so
//      `db:generate` was simply broken for everyone.
//
//   2. Every snapshot from 0047 on described "0044's schema plus the SEO
//      tables", with no knowledge of the `roles` / `role_permissions` /
//      `user_invites` / `user_permission_overrides` tables main added in its
//      own 0045 and 0046. `db:generate` diffs schema.ts against the NEWEST
//      snapshot, so the next migration anyone generated would have contained
//      `CREATE TABLE roles` for a table that already exists in production —
//      42P07 on boot, and because Railway migrates on boot, a failed deploy.
//      This was confirmed: it is exactly what the run that produced 0052
//      emitted before the file was trimmed by hand.
//
// WHY TESTS AND NOT CARE. Nothing about either failure is visible in a diff.
// Both artefacts are machine-written JSON that nobody reads, the .sql files
// and journal looked correct, the build passed, and the test suite passed.
// The first symptom of (2) would have been production down.
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import * as schema from '../db/schema';

const META_DIR = join(__dirname, '..', 'db', 'migrations', 'meta');

interface Snapshot {
  id: string;
  prevId: string;
  tables: Record<string, unknown>;
}

const snapshotFiles = readdirSync(META_DIR)
  .filter((f) => /^\d{4}_snapshot\.json$/.test(f))
  .sort();

const snapshots = snapshotFiles.map((file) => ({
  file,
  data: JSON.parse(readFileSync(join(META_DIR, file), 'utf8')) as Snapshot,
}));

describe('migration snapshot lineage', () => {
  it('has snapshots to check at all', () => {
    // Without this, every assertion below passes vacuously if the glob or the
    // directory layout ever changes.
    //
    // Fewer snapshots than journal entries is EXPECTED and not a defect: a
    // dozen migrations in this repo are hand-authored SQL added straight to the
    // journal (0006_billing_seed, 0009_discovery_tables, 0014_brevo_email_
    // templates_seed and friends), and those never had a drizzle-generated
    // snapshot to begin with. The lineage assertions below therefore chain the
    // snapshots that DO exist, in filename order, rather than expecting one per
    // journal entry.
    expect(snapshots.length).toBeGreaterThan(35);
  });

  it('chains each snapshot to its immediate predecessor', () => {
    const offenders: string[] = [];
    for (let i = 1; i < snapshots.length; i += 1) {
      const prev = snapshots[i - 1];
      const cur = snapshots[i];
      if (cur.data.prevId !== prev.data.id) {
        offenders.push(
          `${cur.file}.prevId=${cur.data.prevId} but ${prev.file}.id=${prev.data.id}`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it('gives every snapshot a distinct id, so no two can claim the same parent', () => {
    const ids = snapshots.map((s) => s.data.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  /**
   * THE ONE THAT MATTERS. `db:generate` diffs schema.ts against the newest
   * snapshot alone, so a table that schema.ts declares and that snapshot omits
   * is reported as "needs creating" — even when it has existed in production
   * for weeks. That is failure (2) above, and this is the assertion that
   * catches it.
   *
   * Table PRESENCE only, deliberately. A full structural comparison would
   * re-implement drizzle's own differ, and would fail on every legitimate
   * pending change (the normal state between editing schema.ts and running
   * db:generate). Presence is the coarse property that was actually violated
   * and that no amount of ordinary review would surface.
   */
  it('has the newest snapshot contain every table schema.ts declares', () => {
    const newest = snapshots[snapshots.length - 1];
    const snapshotTables = new Set(
      Object.keys(newest.data.tables).map((k) => k.split('.').pop() as string),
    );

    const declared = Object.values(schema)
      .map(getDrizzleTableName)
      .filter((n): n is string => Boolean(n));

    expect(declared.length).toBeGreaterThan(90); // guard against the extraction silently returning nothing

    const missing = declared.filter((t) => !snapshotTables.has(t)).sort();
    expect(missing, `${newest.file} is missing tables that schema.ts declares — run npm run db:generate`).toEqual([]);
  });

  it('control — the chain check actually fails on a forked lineage', () => {
    // Both assertions above currently pass, which is indistinguishable from
    // "the assertion is broken and can never fail" without this. Reproduce the
    // real shape of the bug: two snapshots claiming the same parent.
    const forked = [
      { file: 'a', data: { id: 'A', prevId: 'ROOT', tables: {} } },
      { file: 'b', data: { id: 'B', prevId: 'A', tables: {} } },
      { file: 'c', data: { id: 'C', prevId: 'A', tables: {} } }, // regression: should be 'B'
    ];
    const offenders: string[] = [];
    for (let i = 1; i < forked.length; i += 1) {
      if (forked[i].data.prevId !== forked[i - 1].data.id) offenders.push(forked[i].file);
    }
    expect(offenders).toEqual(['c']);
  });

  it('control — the table-extraction actually finds tables, and ignores non-tables', () => {
    // If getDrizzleTableName ever returns null for everything (a drizzle-orm
    // internals change, say), the missing-table assertion above would compare
    // [] to [] and pass forever while guarding nothing.
    expect(getDrizzleTableName(schema.seoPageMetrics)).toBe('seo_page_metrics');
    expect(getDrizzleTableName({ name: 'not_a_table' })).toBeNull();
    expect(getDrizzleTableName(null)).toBeNull();
  });
});

/**
 * Reads a Drizzle table's SQL name off the symbol drizzle-orm stamps on every
 * pgTable. Going through the symbol rather than a `.name` property matters:
 * schema.ts also exports plain objects, enums and helper functions, and several
 * of them do have a `.name`, which would otherwise be collected as phantom
 * table names and make the assertion above fail for the wrong reason.
 */
function getDrizzleTableName(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const nameSymbol = Object.getOwnPropertySymbols(value).find(
    (s) => s.description === 'drizzle:Name',
  );
  if (!nameSymbol) return null;
  const name = (value as Record<symbol, unknown>)[nameSymbol];
  return typeof name === 'string' ? name : null;
}
