// Route-view telemetry — src/routes/wizmatchTelemetry.ts.
//
// Same convention as wizmatchTodayRoutes.test.ts: mount the REAL router on a
// REAL express app, fake `req.user` with a one-line middleware, and mock only
// the DB. `pool.query` is the mock boundary — these assertions are about what
// the route does and does not persist, so the recorded SQL args are the
// subject of most of them.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const state = vi.hoisted(() => ({
  inserts: [] as Array<{ text: string; values: unknown[] }>,
  /** Set to make the next INSERT reject, standing in for a dead/absent table. */
  failInsert: false,
  selectRows: [] as Array<Record<string, unknown>>,
  lastSelect: null as { text: string; values: unknown[] } | null,
}));

vi.mock('../db/index', () => ({
  pool: {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      if (/INSERT INTO wizmatch_route_views/.test(text)) {
        if (state.failInsert) throw new Error('relation "wizmatch_route_views" does not exist');
        state.inserts.push({ text, values: values || [] });
        return { rows: [] };
      }
      if (/FROM wizmatch_route_views/.test(text)) {
        state.lastSelect = { text, values: values || [] };
        return { rows: state.selectRows };
      }
      return { rows: [] };
    }),
  },
  db: {},
}));

let server: Server | null = null;
let baseUrl = '';

async function startServer(role = 'admin', tenantId = 'tenant-1', userId = 'user-1') {
  vi.resetModules();
  const { default: router } = await import('../routes/wizmatchTelemetry');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: unknown }).user = { tenantId, id: userId, role };
    next();
  });
  app.use('/api/wizmatch', router);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
}

function postView(body: unknown) {
  return fetch(`${baseUrl}/api/wizmatch/telemetry/route-view`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.inserts.length = 0;
  state.selectRows.length = 0;
  state.failInsert = false;
});

afterEach(async () => {
  if (server) {
    const s = server;
    server = null;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }
});

describe('POST /telemetry/route-view', () => {
  it('records a known route with identity taken from the token', async () => {
    await startServer('staff', 'tenant-1', 'user-9');
    const res = await postView({ routeId: 'more-inbox', path: '/wizmatch/inbox' });

    expect(res.status).toBe(204);
    expect(state.inserts).toHaveLength(1);
    // tenant, user, route, path, role
    expect(state.inserts[0].values).toEqual(['tenant-1', 'user-9', 'more-inbox', '/wizmatch/inbox', 'staff']);
  });

  it('takes tenant from req.user and IGNORES a tenantId supplied in the body', async () => {
    await startServer('staff', 'tenant-1', 'user-9');
    await postView({ routeId: 'today', path: '/wizmatch/today', tenantId: 'tenant-EVIL', userId: 'someone-else' });

    expect(state.inserts[0].values[0]).toBe('tenant-1');
    expect(state.inserts[0].values[1]).toBe('user-9');
  });

  it('rejects an unknown routeId — 204, but nothing persisted', async () => {
    await startServer();
    const res = await postView({ routeId: 'not-a-real-route', path: '/wizmatch/today' });

    expect(res.status).toBe(204);
    expect(state.inserts).toHaveLength(0);
  });

  it('rejects a free-text routeId, so the column cannot become a text sink', async () => {
    await startServer();
    await postView({ routeId: 'x'.repeat(5000), path: '/wizmatch/today' });
    await postView({ routeId: { nested: 'object' }, path: '/wizmatch/today' });

    expect(state.inserts).toHaveLength(0);
  });

  it('never persists a query string beyond the whitelisted tab', async () => {
    await startServer();
    await postView({ routeId: 'hiring-contacts', path: '/wizmatch/hiring-contacts?id=contact-abc123&q=secret+search' });

    expect(state.inserts).toHaveLength(1);
    const storedPath = String(state.inserts[0].values[3]);
    expect(storedPath).toBe('/wizmatch/hiring-contacts');
    expect(storedPath).not.toContain('id=');
    expect(storedPath).not.toContain('contact-abc123');
    expect(storedPath).not.toContain('secret');
  });

  it('keeps ?tab= so more-provider-runs stays distinguishable from more-system', async () => {
    await startServer();
    await postView({ routeId: 'more-provider-runs', path: '/wizmatch/system?tab=sourcing&id=leak' });

    expect(state.inserts[0].values[3]).toBe('/wizmatch/system?tab=sourcing');
  });

  it('returns 204 even when the insert throws', async () => {
    await startServer();
    state.failInsert = true;
    const res = await postView({ routeId: 'today', path: '/wizmatch/today' });

    // The mutation this guards: replacing the catch with a 500 (or removing the
    // try/catch so express's default handler answers) breaks navigation on
    // every route change the moment the table is missing.
    expect(res.status).toBe(204);
    expect(state.inserts).toHaveLength(0);
  });

  it('returns 204 on a malformed body rather than surfacing a validation error', async () => {
    await startServer();
    expect((await postView({})).status).toBe(204);
    expect((await postView({ routeId: 'today' })).status).toBe(204);
    expect((await postView({ routeId: 'today', path: 'not-a-path' })).status).toBe(204);
    expect(state.inserts).toHaveLength(0);
  });
});

describe('GET /telemetry/route-usage', () => {
  it('includes zero-view routes and sorts them first', async () => {
    state.selectRows.push({ route_id: 'today', views: 42, distinct_users: 3, last_viewed_at: new Date('2026-07-30T10:00:00Z') });
    await startServer('admin');

    const res = await fetch(`${baseUrl}/api/wizmatch/telemetry/route-usage?days=14`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { days: number; items: Array<{ routeId: string; views: number }> };

    const { WIZMATCH_TELEMETRY_ROUTES } = await import('../routes/wizmatchTelemetry');
    // The mutation this guards: returning the aggregate directly instead of
    // left-joining the registry drops all 35 never-visited routes — the exact
    // rows the experiment exists to surface.
    expect(body.items).toHaveLength(WIZMATCH_TELEMETRY_ROUTES.length);

    const inbox = body.items.find((i: { routeId: string }) => i.routeId === 'more-inbox');
    expect(inbox).toMatchObject({ views: 0, distinctUsers: 0, lastViewedAt: null, label: 'Inbox' });

    expect(body.items[0].views).toBe(0);
    expect(body.items[body.items.length - 1]).toMatchObject({ routeId: 'today', views: 42, distinctUsers: 3 });
  });

  it('scopes the aggregate to the caller tenant', async () => {
    await startServer('admin', 'tenant-7');
    await fetch(`${baseUrl}/api/wizmatch/telemetry/route-usage`);

    expect(state.lastSelect!.text).toMatch(/tenant_id = \$1/);
    expect(state.lastSelect!.values[0]).toBe('tenant-7');
  });

  it('clamps days instead of trusting the query param', async () => {
    await startServer('admin');

    await fetch(`${baseUrl}/api/wizmatch/telemetry/route-usage?days=99999`);
    expect(state.lastSelect!.values[1]).toBe(90);

    await fetch(`${baseUrl}/api/wizmatch/telemetry/route-usage?days=-5`);
    expect(state.lastSelect!.values[1]).toBe(1);

    await fetch(`${baseUrl}/api/wizmatch/telemetry/route-usage?days=DROP+TABLE`);
    expect(state.lastSelect!.values[1]).toBe(14);
  });

  it('is admin-only', async () => {
    for (const role of ['staff', 'team_lead', 'sales', 'viewer']) {
      await startServer(role);
      const res = await fetch(`${baseUrl}/api/wizmatch/telemetry/route-usage`);
      expect(res.status, `role ${role} must not read the report`).toBe(403);
      const s = server!;
      server = null;
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  it('still lets a non-admin RECORD a view — the report is admin-only, the write is not', async () => {
    await startServer('staff');
    expect((await postView({ routeId: 'more-tasks', path: '/wizmatch/tasks' })).status).toBe(204);
    expect(state.inserts).toHaveLength(1);
  });
});
