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
// navEntries.js is plain JS with no type declarations, and tsconfig has
// allowJs off — so a .ts file importing it trips TS7016 under noImplicitAny.
// The sibling test that calls the same function (adminFrontendHelpers.test.js)
// gets away with it only because it is .js and therefore never typechecked.
// Suppressing here rather than inventing a .d.ts for a module that has no
// hand-written type surface; vitest transpiles via esbuild, so runtime is
// unaffected.
// @ts-ignore -- untyped JS module, see above
import { getVisibleEntries } from '../../admin/src/components/navEntries.js';

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
  // These registry entries render Growth CRM pages under a /wizmatch/ path with
  // no WizMatch semantics. All are deliberately routed-but-hidden. Pinning them
  // stops a future "the menu is missing an item" fix from putting them back.
  //
  // 2026-08-02 — grown from 2 entries to the full set. Asserted against the
  // registry SOURCE TEXT (not the parsed module) on purpose: this is the layer
  // that catches a mistake the runtime cannot report, e.g. `more-provider-runs`
  // shipped with `searchVisible` declared twice, false then true, so the object
  // silently evaluated to the opposite of its own comment.
  const HIDDEN = [
    ['more-inbox', "Growth's shared inbox"],
    ['more-outreach', "Growth's Saleshandy dashboard"],
    ['more-templates-email', "Growth's email templates"],
    ['more-templates-wa', "Growth's WhatsApp templates"],
    ['more-contacts', "Growth's whole contact book"],
    ['more-pipeline', "Growth's deal pipeline"],
    ['more-tasks', "Growth's task list"],
    ['more-discovery', "Growth's Google-Places local-business finder"],
    ['more-provider-runs', 'a System tab that does not exist'],
    ['more-billing', "Growth's invoicing"],
    ['more-expenses', "Growth's expenses + attendance"],
  ] as const;

  // These entries are heavily commented — and the comments quote the very
  // field names being asserted on ("no `group`", "searchVisible: false"). Match
  // against code only, or the prose explaining the rule trips the rule.
  const stripComments = (s: string) => s
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

  it.each(HIDDEN)('%s is not in the sidebar and not in Cmd+K (%s)', (id) => {
    const raw = registry.split(/\n\s*\{\s*\n/).find((b) => b.includes(`id: '${id}'`));
    expect(raw, `registry entry ${id} not found`).toBeTruthy();
    const block = stripComments(raw!);
    expect(block, `${id} regained a group — it would reappear in the sidebar`)
      .not.toMatch(/\bgroup: '/);
    expect(block, `${id} must stay out of Cmd+K`).toMatch(/searchVisible: false/);
    expect(
      (block.match(/\bsearchVisible:/g) ?? []).length,
      `${id} declares searchVisible more than once — the last one silently wins`,
    ).toBe(1);
  });

  it('all are still ROUTED — hidden is not deleted', () => {
    const app = readFileSync(join(ADMIN, 'App.jsx'), 'utf8');
    for (const path of [
      '/wizmatch/inbox', '/wizmatch/outreach', '/wizmatch/emails',
      '/wizmatch/whatsapp-templates', '/wizmatch/contacts', '/wizmatch/pipeline',
      '/wizmatch/tasks', '/wizmatch/discover', '/wizmatch/system',
      '/wizmatch/billing', '/wizmatch/finance',
    ]) {
      expect(app, `${path} lost its route — the entry is now unreachable`).toContain(path);
    }
  });
});

describe('the Communication bucket is fully retired', () => {
  // Half-removing it is the failure mode: a registry entry declaring
  // moreSection 'Communication' with the Sidebar no longer rendering that
  // section is dropped from the sidebar silently while staying in Cmd+K.
  it('Sidebar renders no Communication section', () => {
    expect(renderedMoreSections()).not.toContain('Communication');
  });

  it('no registry entry declares the Communication group or section', () => {
    expect(registry).not.toMatch(/moreSection: 'Communication'/);
    expect(registry).not.toMatch(/group: 'more\.communication'/);
  });
});

describe('the global badge polls only run where a badge can be shown', () => {
  // Sidebar.jsx mounts on every authenticated page, so its two badge polls
  // (/api/inbox/unread-count every 30s, /api/finance/leaves/pending-count every
  // 60s) were a request on EVERY page for EVERY user — measured among the 3
  // slowest calls on 25 and 22 of 37 pages. They are now gated on
  // `visible.some(e => e.badge === …)`.
  //
  // That gate is only as good as this precondition, which is why it is pinned
  // here rather than left implicit: `visible` is what getVisibleEntries()
  // returns, so if a badge-bearing entry ever comes back into the WizMatch nav
  // the polls come back with it — silently, and on every page again.
  const allPhases = { A: true, B: true, C: true };
  const badgesFor = (role: string, perms: object, slug: string) =>
    getVisibleEntries(role, perms, slug, allPhases)
      .map((e: { id: string; badge?: string }) => e.badge)
      .filter(Boolean);

  it('WizMatch nav carries no badge — both polls stay off across the product', () => {
    for (const perms of [
      { staffingPilotAccess: true },
      { staffingPilotAccess: true, billingView: true, isOwner: true },
    ]) {
      expect(badgesFor('admin', perms, 'wizmatch')).toEqual([]);
    }
  });

  it('Growth CRM nav still carries both badges — the polls are not dead code', () => {
    const badges = badgesFor('admin', { billingView: true }, 'growth-escalators');
    expect(badges).toContain('inbox-unread');
    expect(badges).toContain('pending-leaves');
  });

  it('a Growth user who cannot see Inbox does not poll for its count', () => {
    // canInbox excludes 'staff'; the old empty-dependency-array effect polled
    // for them anyway.
    expect(badgesFor('staff', {}, 'growth-escalators')).not.toContain('inbox-unread');
  });
});

describe('the Billing nav flag matches the API rule', () => {
  // src/routes/billing.ts gates every endpoint on `!p?.billingView &&
  // !p?.isOwner` — a DB grant, never a role. `canBilling: isAdmin || …` showed
  // the page to admins without the grant and all four endpoints then 403'd.
  const nav = readFileSync(join(ADMIN, 'components', 'navEntries.js'), 'utf8');

  it('canBilling is grant-only — no isAdmin shortcut', () => {
    const line = nav.split('\n').find((l) => l.includes('canBilling:'));
    expect(line, 'canBilling flag not found in computeFlags()').toBeTruthy();
    expect(line, 'canBilling regained an isAdmin shortcut the API does not honour')
      .not.toMatch(/\bisAdmin\b/);
    expect(line).toMatch(/perms\.billingView/);
    expect(line).toMatch(/perms\.isOwner/);
  });

  it('Expenses and Funnels do NOT ride on canBilling', () => {
    // Their APIs (src/routes/finance.ts, src/routes/funnel.ts) carry no
    // billingView check, and /finance is where leave approvals live — so
    // tightening canBilling must not take them down with it.
    for (const id of ['expenses', 'funnels']) {
      const block = nav.split(/\n\s*\{\s*\n/).find((b) => b.includes(`id: '${id}'`));
      expect(block, `nav entry ${id} not found`).toBeTruthy();
      expect(block, `${id} would be hidden from admins by the tightened canBilling`)
        .toMatch(/f\.canFinance/);
    }
  });
});
