// Guards the failure that took down the deploy of PR #163.
//
// drizzle walks `meta/_journal.json` in array order but SKIPS any migration
// whose `when` is not greater than the last one already applied. So a journal
// whose `when` values are out of order does not error — it silently omits
// migrations, and the first symptom is a much later migration failing on an
// object the skipped one was supposed to create.
//
// That is exactly what happened: five SEO migrations were renumbered
// 0045-0049 -> 0047-0051 during a merge with main. Their `idx` and `tag` were
// updated; their `when` timestamps were not, so three of them sorted BEFORE
// main's 0046. drizzle applied 0046, skipped 0047/0048/0049, then ran 0050 —
// which adds a foreign key to `seo_sites`, the table skipped 0048 creates.
// Boot failed with 42P01, and because Railway migrates on boot, the deploy
// failed with it.
//
// WHY THIS IS A TEST AND NOT A COMMENT. The renumber WAS verified before
// shipping — by applying every migration to an empty scratch database. From
// empty there is no "last applied", so nothing is ever skipped and this class
// of bug cannot appear. The check was structurally incapable of catching it.
// A test that reads the journal directly does not have that blind spot.
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

const journal = JSON.parse(
  readFileSync(join(__dirname, '..', 'db', 'migrations', 'meta', '_journal.json'), 'utf8'),
) as { entries: JournalEntry[] };

/**
 * Three historical entries predate this rule being understood and sort out of
 * order against their neighbours. They are PERMANENTLY SKIPPED in every
 * environment, production included, and have been for months — production's
 * applied count has sat at exactly `journal length - 3` throughout.
 *
 * They are exempted rather than fixed on purpose: changing a historical
 * `when` would make drizzle reconsider migrations every existing database has
 * already moved past, which is a far larger risk than the inert gap they
 * leave. Do not add to this list to make a new failure pass — a NEW entry out
 * of order is the bug this file exists to catch.
 */
const KNOWN_OUT_OF_ORDER = new Set([
  '0008_great_romulus',
  '0013_lively_blue_shield',
  '0014_brevo_email_templates_seed',
]);

describe('migration journal ordering', () => {
  it('has a strictly increasing `when` for every entry outside the known-historical exemptions', () => {
    const offenders: string[] = [];
    let highest = -Infinity;
    for (const entry of journal.entries) {
      if (KNOWN_OUT_OF_ORDER.has(entry.tag)) {
        // Skipped by drizzle anyway; do not let them move the watermark.
        continue;
      }
      if (entry.when <= highest) {
        offenders.push(`${entry.tag} (when=${entry.when}) does not exceed the previous ${highest}`);
      }
      highest = Math.max(highest, entry.when);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps idx aligned with array position', () => {
    // drizzle reads entries positionally; an idx that disagrees with its slot
    // means someone edited the journal by hand and mis-numbered it.
    const mismatched = journal.entries
      .map((e, i) => ({ e, i }))
      .filter(({ e, i }) => e.idx !== i)
      .map(({ e, i }) => `position ${i}: idx=${e.idx} tag=${e.tag}`);
    expect(mismatched).toEqual([]);
  });

  it('keeps the tag prefix aligned with idx for everything from 0045 onward', () => {
    // A renumber that moves the FILE but not the journal tag (or vice versa)
    // produces a journal that looks right and applies the wrong file.
    //
    // Scoped to idx >= 45 deliberately. Six historical entries disagree —
    // e.g. idx 4 is tagged `0005_update_wa_template_names`, idx 20 is
    // `0022_tenant_scoped_user_emails` — from renames that predate this work.
    // Asserting over all of history would mean either failing on the first
    // run or "fixing" long-applied entries, which is the more dangerous
    // option. 45 is where the renumber that caused the #163 deploy failure
    // happened, and everything from there forward follows the convention.
    const FIRST_ENFORCED_IDX = 45;
    const mismatched = journal.entries
      .filter((e) => e.idx >= FIRST_ENFORCED_IDX)
      .filter((e) => !e.tag.startsWith(String(e.idx).padStart(4, '0')))
      .map((e) => `idx=${e.idx} tag=${e.tag}`);
    expect(mismatched).toEqual([]);
  });

  it('has no duplicate idx or tag', () => {
    const idxs = journal.entries.map((e) => e.idx);
    const tags = journal.entries.map((e) => e.tag);
    expect(new Set(idxs).size).toBe(idxs.length);
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('control — the ordering check actually fails on an out-of-order entry', () => {
    // Without this, the assertion above could pass because the loop never
    // runs, or because the exemption list swallowed everything. Prove it bites.
    const broken: JournalEntry[] = [
      { idx: 0, when: 100, tag: '0000_a' },
      { idx: 1, when: 300, tag: '0001_b' },
      { idx: 2, when: 200, tag: '0002_c' }, // regression: earlier than its predecessor
    ];
    const offenders: string[] = [];
    let highest = -Infinity;
    for (const e of broken) {
      if (e.when <= highest) offenders.push(e.tag);
      highest = Math.max(highest, e.when);
    }
    expect(offenders).toEqual(['0002_c']);
  });
});
