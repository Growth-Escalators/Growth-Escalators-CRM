// Read-only guard for the live owner walkthrough.
//
// This exists so that driving PRODUCTION cannot write, structurally, rather than
// because the script author remembered not to click things. Discipline is the
// weaker guarantee: one stray `dragTo` on the Placements Kanban is a PUT with no
// confirmation and no undo.
//
// Installed at BROWSER CONTEXT level, not page level, so popups and new tabs
// inherit it, and registered FIRST — Playwright runs route handlers in reverse
// registration order and a later handler calling fulfil() unconditionally would
// shadow this one.

import type { BrowserContext, Route, Request } from '@playwright/test';

export type WriteAttempt = {
  ts: string;
  method: string;
  /** Pathname ONLY. Query strings can carry record ids and search terms. */
  pathname: string;
  kind: 'blocked-write' | 'suppressed-telemetry' | 'foreign-host' | 'auth-alarm';
  /** Which walkthrough stop was on screen. Set by the caller via setStop(). */
  stop: string;
  resourceType: string;
};

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Auth endpoints that must be unreachable. `/auth/forgot-password` POSTs and
 * then advances WITHOUT checking res.ok, so a stray click emails the owner for
 * real; `/auth/reset-password` would change their password. The walkthrough
 * starts from a saved session and has no business touching any of these.
 */
const AUTH_ALARM = /\/auth\/(login|forgot-password|reset-password)/;

/** The route-view beacon. See suppression rationale in the header of the config. */
const TELEMETRY = /\/api\/wizmatch\/telemetry\/route-view/;

export class ReadOnlyGuard {
  readonly attempts: WriteAttempt[] = [];
  private stop = 'pre-walkthrough';
  private alarmed = false;

  setStop(stop: string) { this.stop = stop; }

  /** True if an auth endpoint was ever hit — the run must fail on this. */
  get hasAuthAlarm() { return this.alarmed; }

  /** Attempts since a marker, so a stop can assert only what IT caused. */
  since(index: number) { return this.attempts.slice(index); }
  get mark() { return this.attempts.length; }

  private record(req: Request, kind: WriteAttempt['kind']) {
    const url = new URL(req.url());
    this.attempts.push({
      ts: new Date().toISOString(),
      method: req.method(),
      pathname: url.pathname, // query deliberately dropped
      kind,
      stop: this.stop,
      resourceType: req.resourceType(),
    });
  }

  async install(context: BrowserContext, baseHost: string) {
    await context.route('**/*', async (route: Route) => {
      const req = route.request();
      const method = req.method();
      const url = new URL(req.url());

      // Anything off-host: abort. Fonts/CDNs are irrelevant to the assessment and
      // this stops the run reaching anywhere it was not pointed.
      if (url.hostname !== baseHost) {
        this.record(req, 'foreign-host');
        return route.abort();
      }

      if (READ_METHODS.has(method)) return route.fallback();

      // --- everything below is a write attempt ---

      if (AUTH_ALARM.test(url.pathname)) {
        this.alarmed = true;
        this.record(req, 'auth-alarm');
        return route.fulfill({ status: 405, contentType: 'application/json', body: '{"error":"auth endpoint blocked"}' });
      }

      if (TELEMETRY.test(url.pathname)) {
        // Fulfil with the real contract (204) so the client path is identical.
        // Recorded separately so write-attempts.json does not mix instrumentation
        // in with genuine product writes.
        this.record(req, 'suppressed-telemetry');
        return route.fulfill({ status: 204, body: '' });
      }

      this.record(req, 'blocked-write');
      // 405, deliberately — NOT abort() and NOT 401.
      //
      // abort() surfaces to the page as a generic "Failed to fetch", which
      // apiFetch renders identically to a real outage; the walkthrough would then
      // be unable to distinguish a blocked write from a broken endpoint, and
      // would learn nothing about how the product reports failure.
      //
      // 401 is actively dangerous: admin/src/lib/api.js turns any 401 into
      // clearAuthSession() + a hard redirect to /login, which would destroy the
      // session mid-run.
      return route.fulfill({
        status: 405,
        contentType: 'application/json',
        body: '{"error":"blocked by read-only walkthrough harness"}',
      });
    });
  }
}

/**
 * Controls that must never be clicked, matched on ACCESSIBLE NAME.
 *
 * The route guard already makes these harmless; this makes them un-attempted, so
 * the run never depends on a single mechanism. Ordered roughly by cost of a
 * mistake: the first two spend real money with a provider.
 */
export const FORBIDDEN_CONTROL = new RegExp(
  [
    'run discovery',            // Apollo/Snov — real spend
    'source public',            // X-Ray/Serper — real spend
    'delete',                   // every "Delete permanently"
    'reject',                   // Job Leads fires on ONE click, no dialog
    'generate drafts',          // creates outreach content
    'generate sheet',           // creates an external Google Sheet
    'send',                     // any send surface
    'enrol', 'enroll',
    'save view', 'save current',
    'forgot password', 'reset password',
    'create placement', 'record sent', 'accept',
    'approve', 'qualify', 'merge', 'block', 'pause', 'resume',
    'assign owner', 'set review',
    'withdraw', 'cancel submission',
    'add ', 'new ', 'create ',
    'link', 'unlink',
    'deactivate', 'remove',
  ].join('|'),
  'i',
);

/** Throws rather than clicking anything on the denylist. */
export function assertClickable(accessibleName: string) {
  if (FORBIDDEN_CONTROL.test(accessibleName)) {
    throw new Error(
      `refusing to click "${accessibleName}" — matches the walkthrough denylist. `
      + 'If this is genuinely read-only, narrow the pattern rather than bypassing it.',
    );
  }
}
