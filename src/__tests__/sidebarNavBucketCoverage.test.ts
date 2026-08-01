// 2026-08-01 — the Sidebar drops nav entries silently, in TWO places:
//
//   Sidebar.jsx  `if (e.group && map[e.group]) map[e.group].push(e)`
//                → an entry whose `group` is not a key of
//                  { tools, finance, settings, 'wizmatch-more' } is dropped.
//
//   Sidebar.jsx  `if (e.moreSection && map[e.moreSection]) …`
//                → a 'wizmatch-more' entry whose `moreSection` is not in
//                  MORE_SECTION_ORDER is dropped.
//
// In both cases the entry REMAINS in `visible`, and `visible` is what the
// command palette receives — so the route ends up **searchable via Cmd+K but
// absent from the sidebar**, with no error, no warning, and nothing in the
// build output. It is the kind of defect that gets reported as "the menu is
// missing an item" months later.
//
// This matters right now because the plan's next phase hides low-usage nav
// entries. The obvious way to do that is to invent a new group string, which
// would trip site 1 and produce exactly that ghost state. This test makes the
// invariant explicit BEFORE that work starts: every visible entry that declares
// a group must land in exactly one rendered bucket.
//
// Asserted against the registry + the Sidebar's own constants read from source,
// rather than by rendering React (there is no jsdom in this suite).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ADMIN = join(__dirname, '..', '..', 'admin', 'src');
const sidebar = readFileSync(join(ADMIN, 'components', 'Sidebar.jsx'), 'utf8');
const registry = readFileSync(join(ADMIN, 'routes', 'wizmatchRouteRegistry.ts'), 'utf8');

/** The bucket keys Sidebar actually renders into. */
function renderedGroupKeys(): string[] {
  const m = sidebar.match(/const map = \{([^}]*)\};\s*\n\s*for \(const e of visible\)/);
  expect(m, 'the grouped bucket map moved — update this test').toBeTruthy();
  return (m![1].match(/'[^']+'|\btools\b|\bfinance\b|\bsettings\b/g) ?? [])
    .map((s) => s.replace(/'/g, '').trim())
    .filter(Boolean);
}

/** The moreSection labels Sidebar actually renders. */
function renderedMoreSections(): string[] {
  const m = sidebar.match(/const MORE_SECTION_ORDER = \[([^\]]+)\]/);
  expect(m, 'MORE_SECTION_ORDER moved — update this test').toBeTruthy();
  return (m![1].match(/'([^']+)'/g) ?? []).map((s) => s.replace(/'/g, ''));
}

/** Every registry entry that declares a group, with its moreSection if any. */
function groupedRegistryEntries(): Array<{ id: string; group: string; moreSection?: string }> {
  const out: Array<{ id: string; group: string; moreSection?: string }> = [];
  // Entries are object literals; match id + optional group/moreSection within one.
  for (const block of registry.split(/\n\s*\{\s*\n/).slice(1)) {
    const id = block.match(/\bid: '([^']+)'/)?.[1];
    if (!id) continue;
    const group = block.match(/\bgroup: '([^']+)'/)?.[1];
    if (!group) continue; // ungrouped is deliberate (pending-merge / retired)
    const moreSection = block.match(/\bmoreSection: '([^']+)'/)?.[1];
    out.push({ id, group, moreSection });
  }
  return out;
}

describe('every grouped nav entry lands in a rendered bucket', () => {
  // How a group actually reaches the Sidebar (navEntries.js
  // wizmatchEntriesFromRegistry): a registry `group: 'primary'` becomes `null`
  // and renders flat under the "Wizmatch" section; EVERY other registry group
  // collapses to the single bucket 'wizmatch-more' and is then sub-bucketed by
  // `moreSection`.
  //
  // So for WizMatch the first drop site is unreachable by construction — the
  // mapping can only ever emit null or 'wizmatch-more'. The live risks are the
  // moreSection sub-bucket, and Growth's hand-authored `group` values which are
  // written straight into NAV_ENTRIES with no mapping layer at all.

  it("no 'More' entry declares a moreSection the Sidebar does not render", () => {
    const sections = renderedMoreSections();
    expect(sections.length).toBeGreaterThan(0);
    const orphans = groupedRegistryEntries()
      .filter((e) => e.group !== 'primary')
      .filter((e) => e.moreSection && !sections.includes(e.moreSection))
      .map((e) => `${e.id} → moreSection '${e.moreSection}'`);
    expect(
      orphans,
      `these entries would be searchable in Cmd+K but ABSENT from the sidebar:\n${orphans.join('\n')}\n`
      + `Sidebar renders only: ${sections.join(', ')}`,
    ).toEqual([]);
  });

  it("every non-primary entry actually declares a moreSection", () => {
    // No moreSection hits the `e.moreSection &&` guard and is dropped just as
    // silently as a wrong one.
    const missing = groupedRegistryEntries()
      .filter((e) => e.group !== 'primary' && !e.moreSection)
      .map((e) => e.id);
    expect(missing, `More entries with no moreSection: ${missing.join(', ')}`).toEqual([]);
  });

  it('every Growth nav group is a bucket the Sidebar renders', () => {
    // NAV_ENTRIES is hand-authored with literal group strings and no mapping
    // layer, so this is where an invented group value would actually bite.
    const keys = renderedGroupKeys();
    // Comments stripped first: navEntries.js documents the mapping with a
    // literal `group: 'primary'` in prose, which a naive match reads as a real
    // declaration and reports as an orphan.
    const nav = readFileSync(join(ADMIN, 'components', 'navEntries.js'), 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    const declared = [...nav.matchAll(/\bgroup: '([^']+)'/g)].map((m) => m[1]);
    const unrendered = [...new Set(declared)].filter((g) => !keys.includes(g));
    expect(
      unrendered,
      `Growth nav groups with no rendered bucket: ${unrendered.join(', ')}. `
      + `Sidebar renders only: ${keys.join(', ')}`,
    ).toEqual([]);
  });
});

describe('the retired traps stay out of nav and search', () => {
  // Two registry entries render Growth CRM tools under a /wizmatch/ path with no
  // WizMatch semantics. Both are deliberately routed-but-hidden. Pinning them
  // stops a future "the menu is missing an item" fix from putting them back.
  it.each([
    ['more-discovery', "Growth's Google-Places local-business finder"],
    ['more-outreach', "Growth's Saleshandy dashboard"],
  ])('%s is not in the sidebar and not in Cmd+K (%s)', (id) => {
    const block = registry.split(/\n\s*\{\s*\n/).find((b) => b.includes(`id: '${id}'`));
    expect(block, `registry entry ${id} not found`).toBeTruthy();
    expect(block, `${id} regained a group — it would reappear in the sidebar`)
      .not.toMatch(/\bgroup: '/);
    expect(block, `${id} must stay out of Cmd+K`).toMatch(/searchVisible: false/);
  });

  it('both are still ROUTED — hidden is not deleted', () => {
    const app = readFileSync(join(ADMIN, 'App.jsx'), 'utf8');
    expect(app).toContain('/wizmatch/discover');
    expect(app).toContain('/wizmatch/outreach');
  });
});
