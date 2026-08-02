// Local axe measurement, run against `npm run admin:dev`.
//
// The point of this spec is to be the OPPOSITE of e2e/wizmatch-a11y.spec.ts in
// the two ways that matter:
//
//   1. It mocks every API to a NON-EMPTY payload. The existing suite mocks to
//      `{ items: [], total: 0 }`, so tables render zero rows and every per-row
//      violation (the tasks/ListView row checkbox, row action buttons) simply
//      never exists. That is the single biggest reason the suite is green while
//      production measured 381 axe nodes.
//   2. It records EVERY impact level. The existing suite filters to
//      critical/serious, which makes all 50 moderate nodes — landmark-unique,
//      region, heading-order, page-has-heading-one — structurally invisible.
//
// It asserts nothing. It writes a JSON tally to be diffed against the
// production baseline. An assertion here would abort the sweep and lose the
// measurement, which is the only thing this file exists to produce.

import { test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.env.WALKTHROUGH_ARTIFACT_DIR || '/tmp';

// Non-empty and shaped loosely enough that most list pages will render rows.
const ROW = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Sample Row', title: 'Sample Row', company: 'Sample Co',
  status: 'new', stage: 'draft', email: 'a@b.invalid', phone: '910000000000',
  created_at: '2026-08-01T00:00:00Z', updated_at: '2026-08-01T00:00:00Z',
  amount: 0, currency: 'INR', score: 5, keywords: ['java'], skills: ['java'],
};
const rows = Array.from({ length: 5 }, (_, i) => ({ ...ROW, id: `0000000-${i}`, name: `Sample Row ${i}` }));

const ROUTES: Array<[string, string]> = [
  ['today', '/wizmatch/today'],
  ['job-leads', '/wizmatch/job-leads'],
  ['companies', '/wizmatch/companies'],
  ['hiring-contacts', '/wizmatch/hiring-contacts'],
  ['requirements', '/wizmatch/requirements'],
  ['candidates', '/wizmatch/candidates'],
  ['placements', '/wizmatch/placements'],
  ['reports', '/wizmatch/reports'],
  ['tasks', '/wizmatch/tasks'],
  ['inbox', '/wizmatch/inbox'],
  ['contacts', '/wizmatch/contacts'],
  ['pipeline', '/wizmatch/pipeline'],
  ['billing', '/wizmatch/billing'],
  ['finance', '/wizmatch/finance'],
  ['audit', '/wizmatch/settings/audit'],
];

test('local axe tally', async ({ page, context }) => {
  test.setTimeout(15 * 60_000);

  // Permissions must be BROAD and stored under the tenant-prefixed key
  // (admin/src/lib/auth.js storageKey()), or route guards bounce every request
  // to /wizmatch/today and the page under test never mounts. A first pass at
  // this spec did exactly that and reported 0 violations on 8 routes — a false
  // negative indistinguishable from success, and the same trap the existing
  // suite falls into.
  const PERMS = {
    isOwner: true, billingView: true, staffingPilotAccess: true, canCRM: true,
    canInbox: true, canTasks: true, canSequences: true, canContracts: true, canBilling: true,
  };

  await context.route('**/api/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      items: rows, data: rows, results: rows, rows,
      total: rows.length, count: rows.length, unread: 0, pending: 0,
      ok: true, ...PERMS, permissions: PERMS, phases: { A: true, B: true, C: true },
    }),
  }));

  await context.addInitScript((perms) => {
    localStorage.setItem('crm_active_tenant_slug', 'wizmatch');
    localStorage.setItem('wizmatch_crm_token', 'local-measurement-token');
    localStorage.setItem('wizmatch_crm_user', JSON.stringify({ role: 'admin', tenantSlug: 'wizmatch', id: 'u1' }));
    localStorage.setItem('wizmatch_crm_permissions', JSON.stringify(perms));
  }, PERMS);

  const tally: Record<string, { impact: string | null; nodes: number }> = {};
  const perRoute: Array<{
    route: string; nodes: number; landed: string; rendered: boolean;
    inputs: number; selects: number; rows: number;
  }> = [];

  for (const [id, path] of ROUTES) {
    // eslint-disable-next-line no-await-in-loop
    await page.goto(path, { waitUntil: 'domcontentloaded' }).catch(() => {});
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(1500);

    // Record whether the page ACTUALLY MOUNTED. Without this a redirect to
    // /wizmatch/today scores zero violations and reads as a clean page.
    // eslint-disable-next-line no-await-in-loop
    const [landed, inputs, selects, rowCount] = await Promise.all([
      Promise.resolve(new URL(page.url()).pathname),
      page.locator('input').count().catch(() => 0),
      page.locator('select').count().catch(() => 0),
      page.locator('table tbody tr').count().catch(() => 0),
    ]);
    const rendered = landed === path.split('?')[0];

    let n = 0;
    try {
      // eslint-disable-next-line no-await-in-loop
      const res = await new AxeBuilder({ page }).analyze();
      for (const v of res.violations) {
        tally[v.id] = { impact: v.impact ?? null, nodes: (tally[v.id]?.nodes ?? 0) + v.nodes.length };
        n += v.nodes.length;
      }
    } catch {
      n = -1; // scan failed — NOT "clean"
    }
    perRoute.push({ route: id, nodes: n, landed, rendered, inputs, selects, rows: rowCount });
  }

  mkdirSync(OUT, { recursive: true });
  const total = Object.values(tally).reduce((a, b) => a + b.nodes, 0);
  writeFileSync(`${OUT}/axe-local.json`, JSON.stringify({ total, tally, perRoute }, null, 2));
  // eslint-disable-next-line no-console
  console.log(`\n  LOCAL AXE TOTAL: ${total}\n` + Object.entries(tally)
    .sort((a, b) => b[1].nodes - a[1].nodes)
    .map(([k, v]) => `    ${k.padEnd(30)} ${String(v.impact).padEnd(9)} ${v.nodes}`).join('\n') + '\n');
});
