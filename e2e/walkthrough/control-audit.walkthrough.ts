// Interactive control audit — LOCAL ONLY.
//
// Answers "what is on each screen, and what does each button actually do?"
// by enumerating every interactive control and then CLICKING the safe ones and
// recording the observable effect: navigation, dialog, network write, toast, or
// nothing at all.
//
// "Nothing at all" is the most valuable outcome here. A control that fires no
// request, opens no dialog and changes no URL is either decorative or broken,
// and both are candidates for deletion — which is the point of the exercise.
//
// LOCAL ONLY, enforced below. This clicks real buttons against a real database.

import { test } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.env.WALKTHROUGH_ARTIFACT_DIR || '/tmp';

const ROUTES: Array<[string, string]> = [
  ['today', '/wizmatch/today'],
  ['job-leads', '/wizmatch/job-leads'],
  ['companies', '/wizmatch/companies'],
  ['hiring-contacts', '/wizmatch/hiring-contacts'],
  ['hiring-contacts-queue', '/wizmatch/hiring-contacts?tab=queue'],
  ['requirements', '/wizmatch/requirements'],
  ['candidates', '/wizmatch/candidates'],
  ['submissions', '/wizmatch/submissions'],
  ['placements', '/wizmatch/placements'],
  ['reports', '/wizmatch/reports'],
  ['talent-matching', '/wizmatch/talent-matching'],
  ['find-contact', '/wizmatch/find-contact'],
  ['my-work', '/wizmatch/my-work'],
  ['review-workbench', '/wizmatch/review-workbench'],
  ['system', '/wizmatch/system'],
];

// Never clicked. Irreversible, spend-incurring, or sends to a human — even
// locally these tell us nothing worth the blast radius.
const NEVER = /delete|remove|archive|reject|discard|purge|sign out|log ?out|run discovery|run now|source (public )?candidates|generate drafts?|send|enrol|enroll|approve|accept offer|create placement|record sent|regenerate|deactivate|reset/i;

type Control = {
  name: string; tag: string; disabled: boolean;
  clicked: boolean; effect: string; writes: string[]; error?: string;
};

test('control audit (local)', async ({ page, context, baseURL }) => {
  const host = new URL(baseURL!).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`control-audit is LOCAL ONLY and refuses to run against ${host} — it clicks real buttons.`);
  }
  test.setTimeout(25 * 60_000);

  const writes: string[] = [];
  const reads: string[] = [];
  const downloads: string[] = [];
  page.on('request', (r) => {
    const m = r.method();
    if (!r.url().includes('/api/')) return;
    if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') reads.push(`${m} ${new URL(r.url()).pathname}`);
    else writes.push(`${m} ${new URL(r.url()).pathname}`);
  });
  // A CSV/Export button neither navigates nor writes — without this it reads as dead.
  page.on('download', (d) => { downloads.push(d.suggestedFilename()); });

  const report: Array<{
    route: string; path: string; landed: string;
    counts: { buttons: number; links: number; inputs: number; selects: number; tables: number; rows: number };
    controls: Control[];
  }> = [];

  for (const [id, path] of ROUTES) {
    await page.goto(path, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(2200);

    const landed = new URL(page.url()).pathname;
    const counts = {
      buttons: await page.locator('button:visible').count().catch(() => 0),
      links: await page.locator('a:visible').count().catch(() => 0),
      inputs: await page.locator('input:visible').count().catch(() => 0),
      selects: await page.locator('select:visible').count().catch(() => 0),
      tables: await page.locator('table').count().catch(() => 0),
      rows: await page.locator('table tbody tr').count().catch(() => 0),
    };

    // Snapshot the button list once; clicking mutates the DOM underneath us.
    const names: string[] = await page.evaluate(() => Array.from(document.querySelectorAll('button'))
      .filter((b) => (b as HTMLElement).offsetParent !== null)
      .map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60))
      .filter(Boolean));

    const seen = new Set<string>();
    const controls: Control[] = [];

    for (const name of names) {
      if (seen.has(name)) continue;      // one probe per distinct label
      seen.add(name);
      if (controls.length >= 14) break;  // keep the run bounded; logged below

      const loc = page.getByRole('button', { name, exact: true }).first();
      let disabled = false;
      try { disabled = await loc.isDisabled({ timeout: 800 }); } catch { continue; }

      const c: Control = { name, tag: 'button', disabled, clicked: false, effect: '', writes: [] };
      if (disabled) { c.effect = 'disabled'; controls.push(c); continue; }
      if (NEVER.test(name)) { c.effect = 'SKIPPED (destructive/spend/sends)'; controls.push(c); continue; }

      const urlBefore = page.url();
      const dialogsBefore = await page.locator('[role="dialog"], .fixed.inset-0').count().catch(() => 0);
      const writeMark = writes.length;
      const readMark = reads.length;
      const dlMark = downloads.length;
      // Cheap DOM fingerprint. Without it, anything that updates in place —
      // expanding a row, switching a tab, opening the More menu — is
      // indistinguishable from a button wired to nothing.
      const domBefore = await page.evaluate(() => document.body.innerHTML.length).catch(() => -1);

      try {
        await loc.click({ timeout: 2500 });
        c.clicked = true;
        await page.waitForTimeout(900);

        const urlAfter = page.url();
        const dialogsAfter = await page.locator('[role="dialog"], .fixed.inset-0').count().catch(() => 0);
        const domAfter = await page.evaluate(() => document.body.innerHTML.length).catch(() => -1);
        c.writes = writes.slice(writeMark);
        const didRead = reads.length > readMark;
        const didDownload = downloads.length > dlMark;
        const domChanged = domBefore >= 0 && domAfter >= 0 && Math.abs(domAfter - domBefore) > 40;

        if (urlAfter !== urlBefore) c.effect = `navigated -> ${new URL(urlAfter).pathname}`;
        else if (dialogsAfter > dialogsBefore) c.effect = 'opened dialog';
        else if (c.writes.length) c.effect = 'fired write';
        else if (didDownload) c.effect = 'downloaded file';
        else if (didRead && domChanged) c.effect = 'refetched + re-rendered';
        else if (didRead) c.effect = 'refetched (no visible change)';
        else if (domChanged) c.effect = 'changed the page in place';
        else c.effect = 'no observable effect';

        // Return to a known state.
        if (dialogsAfter > dialogsBefore) await page.keyboard.press('Escape').catch(() => {});
        if (urlAfter !== urlBefore) {
          await page.goto(path, { waitUntil: 'domcontentloaded' }).catch(() => {});
          await page.waitForTimeout(1200);
        }
      } catch (e) {
        c.error = String(e).slice(0, 90);
        c.effect = 'click failed';
      }
      controls.push(c);
    }

    if (names.length > seen.size) {
      // Never let a bounded probe read as full coverage.
      controls.push({
        name: `(+${names.length - seen.size} more buttons not probed)`, tag: 'note',
        disabled: false, clicked: false, effect: 'NOT PROBED — run bounded at 14 per page', writes: [],
      });
    }

    report.push({ route: id, path, landed, counts, controls });
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/control-audit.json`, JSON.stringify(report, null, 2));
  // eslint-disable-next-line no-console
  console.log(`\n  audited ${report.length} routes -> ${OUT}/control-audit.json\n`);
});
