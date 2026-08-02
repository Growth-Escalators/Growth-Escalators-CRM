// Keeps the telemetry route list honest against the admin nav registry, and
// keeps the client beacon mounted where it can actually see every route.
//
// This file is .js on purpose, matching wizmatchRouteRegistry.test.js: tsconfig
// pins `rootDir: "./src"` and `allowJs` is off, so a .js test may import across
// into admin/ while a .test.ts of the same content would fail `npm run build`.
// That is also why src/routes/wizmatchTelemetry.ts carries a hand-written
// mirror of the registry instead of importing it — this test is what stops the
// mirror drifting.

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WIZMATCH_ROUTES } from '../../admin/src/routes/wizmatchRouteRegistry.ts';
import { resolveRouteView } from '../../admin/src/lib/telemetry.js';
import { WIZMATCH_TELEMETRY_ROUTES } from '../routes/wizmatchTelemetry.ts';

const adminSrc = (...p) => path.join(__dirname, '..', '..', 'admin', 'src', ...p);
const read = (...p) => fs.readFileSync(adminSrc(...p), 'utf8');

/**
 * Strips comments before any source-text assertion — the same exemption
 * wizmatchQueuePaging.test.ts makes. Without it the prose in these files
 * (which necessarily names `<Routes>` and `apiFetch` to explain itself)
 * counts as code and the guards fire on their own documentation.
 */
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('telemetry route mirror ↔ wizmatchRouteRegistry', () => {
  it('mirrors every registry route, in order, with the same id and label', () => {
    expect(WIZMATCH_TELEMETRY_ROUTES.map((r) => ({ id: r.id, label: r.label })))
      .toEqual(WIZMATCH_ROUTES.map((r) => ({ id: r.id, label: r.label })));
  });

  it('accepts no route id the registry does not define', () => {
    const registryIds = new Set(WIZMATCH_ROUTES.map((r) => r.id));
    for (const route of WIZMATCH_TELEMETRY_ROUTES) {
      expect(registryIds.has(route.id), `${route.id} is not a registry route`).toBe(true);
    }
  });
});

describe('resolveRouteView', () => {
  it('resolves every registry route back to its own id — no route is invisible', () => {
    for (const route of WIZMATCH_ROUTES) {
      const [pathname, search = ''] = route.path.split('?');
      const view = resolveRouteView(pathname, search ? `?${search}` : '');
      expect(view, `${route.path} resolved to nothing`).toBeTruthy();
      expect(view.routeId, `${route.path} resolved to the wrong entry`).toBe(route.id);
    }
  });

  it('keeps Provider Runs distinct from System despite the shared pathname', () => {
    // A pathname-only lookup collapses these two, which would report the
    // deep-linked entry as never-visited however often it is opened.
    expect(resolveRouteView('/wizmatch/system', '').routeId).toBe('more-system');
    expect(resolveRouteView('/wizmatch/system', '?tab=sourcing').routeId).toBe('more-provider-runs');
  });

  it('folds legacy aliases onto their canonical route', () => {
    expect(resolveRouteView('/wizmatch/signals', '').routeId).toBe('job-leads');
    expect(resolveRouteView('/wizmatch/contact-intelligence', '').routeId).toBe('hiring-contacts');
  });

  it('drops every query param except a well-formed tab', () => {
    expect(resolveRouteView('/wizmatch/candidates', '?id=cand-123&q=jane').path).toBe('/wizmatch/candidates');
    expect(resolveRouteView('/wizmatch/system', '?tab=../../etc/passwd').path).toBe('/wizmatch/system');
  });

  it('returns null off the registry, so non-Wizmatch pages send nothing', () => {
    expect(resolveRouteView('/dashboard', '')).toBeNull();
    expect(resolveRouteView('/login', '')).toBeNull();
  });
});

describe('beacon mount point', () => {
  // The reason this guard exists: AppLayout is the obvious home for the effect
  // and the wrong one. Only 24 of the 36 registry routes render AppLayout — the
  // other 12 render their own bare <Sidebar/>, and those 12 are almost exactly
  // the "More" pages this experiment is meant to judge (Inbox, Tasks, CRM
  // Contacts, Pipeline, Billing, Expenses, Permissions...). Mounted there, the
  // instrument measures the pages nobody proposed hiding and misses every page
  // somebody did. Moving it back would silently re-break the experiment while
  // every other test stayed green.
  const app = code(read('App.jsx'));
  const appLayout = code(read('components', 'AppLayout.jsx'));

  it('mounts the beacon inside BrowserRouter, above <Routes>', () => {
    const browserRouter = app.indexOf('<BrowserRouter>');
    const beacon = app.indexOf('<RouteViewBeacon />');
    const routes = app.indexOf('<Routes>');

    expect(browserRouter).toBeGreaterThan(-1);
    expect(beacon, 'App.jsx must render <RouteViewBeacon />').toBeGreaterThan(-1);
    expect(beacon).toBeGreaterThan(browserRouter); // useLocation needs router context
    expect(beacon).toBeLessThan(routes);           // above every <Route>, including guarded ones
  });

  it('does not mount the beacon in AppLayout, which 12 of the 36 routes never render', () => {
    expect(appLayout).not.toContain('sendRouteViewBeacon');
    expect(appLayout).not.toContain('resolveRouteView');
  });

  it('routes the beacon through the fire-and-forget helper, never apiFetch', () => {
    const telemetry = code(read('lib', 'telemetry.js'));
    // apiFetch clears the session and redirects to /login on a 401
    // (lib/api.js:19-22) — on a per-navigation ping that is a logout bug.
    expect(telemetry).not.toContain('apiFetch');
    expect(telemetry).toContain('keepalive: true');
  });
});
