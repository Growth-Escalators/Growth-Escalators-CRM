// Per-stop observation. The point of the walkthrough is measurements, not
// impressions — the house rule for the report is "no adjective without a datum",
// and this is where the data comes from.

import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { ReadOnlyGuard } from './readonly-guard';

export type PaintOutcome = 'rows' | 'empty-state' | 'error-state' | 'login-redirect' | 'timeout';

export type StopObservation = {
  routeId: string;
  path: string;
  navMs: number;
  /**
   * WHICH of rows / empty / error appeared first, plus how long it took.
   * The distinction is the whole value: it separates "slow" from "genuinely has
   * no data" from "broken", which look identical in a screenshot and identical
   * in a naive timing number.
   */
  paint: { outcome: PaintOutcome; ms: number };
  apiRequestCount: number;
  slowestApi: Array<{ pathname: string; ms: number; status: number }>;
  consoleErrors: string[];
  pageErrors: string[];
  /** Pathname + status only. Never query strings, never bodies. */
  failedResponses: Array<{ pathname: string; status: number }>;
  axeViolations: Array<{ id: string; impact: string | null; nodes: number }>;
  /** First ten Tab stops by accessible name — catches "the first 8 stops are all sidebar". */
  tabOrder: string[];
  screenshot: string;
  writeAttemptsHere: number;
};

/** Collectors must be attached BEFORE navigation or the first paint is missed. */
export function attachCollectors(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedResponses: Array<{ pathname: string; status: number }> = [];
  const apiTimings: Array<{ pathname: string; ms: number; status: number }> = [];
  const started = new Map<string, number>();

  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`[${m.type()}] ${m.text()}`.slice(0, 300));
  });
  page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 300)));
  page.on('request', (r) => { if (r.url().includes('/api/')) started.set(r.url(), Date.now()); });
  page.on('response', (r) => {
    const url = new URL(r.url());
    if (r.status() >= 400) failedResponses.push({ pathname: url.pathname, status: r.status() });
    const t0 = started.get(r.url());
    if (t0 && url.pathname.includes('/api/')) {
      apiTimings.push({ pathname: url.pathname, ms: Date.now() - t0, status: r.status() });
    }
  });

  return {
    consoleErrors, pageErrors, failedResponses, apiTimings,
    reset() {
      consoleErrors.length = 0; pageErrors.length = 0;
      failedResponses.length = 0; apiTimings.length = 0; started.clear();
    },
  };
}

/**
 * Race the three things a list page can become. Whichever resolves first is the
 * honest answer to "what did the user actually get".
 */
async function racePaint(page: Page): Promise<{ outcome: PaintOutcome; ms: number }> {
  const t0 = Date.now();
  const rows = page.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'rows' as const);
  const empty = page.getByText(/no .*(found|yet|match)|is empty|nothing to/i).first()
    .waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'empty-state' as const);
  const error = page.getByText(/couldn't|could not|failed to|something went wrong|try again/i).first()
    .waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'error-state' as const);

  // A bounced-to-login page matches none of the three, so without this every
  // stop would burn the full timeout and the run would report 37 "timeouts" for
  // what is actually one expired session. The local dry run did exactly that:
  // 18.7 minutes to say nothing.
  const login = page.waitForURL(/\/login(\?|$)/, { timeout: 30_000 }).then(() => 'login-redirect' as const);

  try {
    const outcome = await Promise.race([rows, empty, error, login]);
    return { outcome, ms: Date.now() - t0 };
  } catch {
    return { outcome: 'timeout', ms: Date.now() - t0 };
  }
}

async function tabProbe(page: Page, n = 10): Promise<string[]> {
  const names: string[] = [];
  await page.keyboard.press('Escape').catch(() => {});
  for (let i = 0; i < n; i += 1) {
    await page.keyboard.press('Tab');
    const name = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return '(none)';
      const label = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 40) || el.tagName.toLowerCase();
      return `${el.tagName.toLowerCase()}:${label}`;
    }).catch(() => '(unreadable)');
    names.push(name);
  }
  return names;
}

export async function visit(
  page: Page,
  guard: ReadOnlyGuard,
  collectors: ReturnType<typeof attachCollectors>,
  artifactDir: string,
  routeId: string,
  path: string,
): Promise<StopObservation> {
  guard.setStop(routeId);
  collectors.reset();
  const mark = guard.mark;

  const t0 = Date.now();
  await page.goto(path, { waitUntil: 'commit' });
  const paint = await racePaint(page);
  const navMs = Date.now() - t0;

  // Let late XHRs settle so the fan-out count is real, but never block the run
  // on a hung request.
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});

  const screenshot = `${artifactDir}/${routeId}.png`;
  await page.screenshot({
    path: screenshot,
    fullPage: true,
    // Masked at capture time — these are the regions that can carry secrets.
    mask: [page.locator('input[type="password"]'), page.locator('[data-sensitive]')],
  }).catch(() => {});

  let axeViolations: StopObservation['axeViolations'] = [];
  try {
    // RECORDED, never asserted — an assertion here would abort the run and lose
    // every subsequent stop.
    const res = await new AxeBuilder({ page }).analyze();
    axeViolations = res.violations.map((v) => ({ id: v.id, impact: v.impact ?? null, nodes: v.nodes.length }));
  } catch { /* a11y scan failure must not end the walkthrough */ }

  const tabOrder = await tabProbe(page).catch(() => []);
  const slowestApi = [...collectors.apiTimings].sort((a, b) => b.ms - a.ms).slice(0, 3);

  return {
    routeId,
    path,
    navMs,
    paint,
    apiRequestCount: collectors.apiTimings.length,
    slowestApi,
    consoleErrors: [...collectors.consoleErrors],
    pageErrors: [...collectors.pageErrors],
    failedResponses: [...collectors.failedResponses],
    axeViolations,
    tabOrder,
    screenshot,
    writeAttemptsHere: guard.since(mark).filter((a) => a.kind === 'blocked-write').length,
  };
}
