// PRD-005 PR 7 §12 — route-level contract for src/routes/wizmatchPrepare.ts.
// Mirrors wizmatchTodayRoutes.test.ts's convention: mount the REAL router on a
// REAL express app, mock only the service layer, and assert flag/path
// behaviour end to end — including the C-1-class regression (a `res.status(404)`
// inline gate would 404 the WHOLE /api/wizmatch prefix once this router sits
// ahead of wizmatchRouter; `next('router')` must not regress to that).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const calls = vi.hoisted(() => ({
  prepareSingleCompany: [] as unknown[][],
  getPrepStatus: [] as unknown[][],
}));

const state = vi.hoisted(() => ({
  prepareOutcome: { ok: true, result: { companyId: 'company-1', status: 'prepared' } } as Record<string, unknown>,
  prepStatus: { lastPreparedAt: '2026-07-27T00:00:00.000Z' } as Record<string, unknown> | null,
}));

vi.mock('../modules/outreach/prepareCompanies', () => ({
  prepareSingleCompany: async (...args: unknown[]) => {
    calls.prepareSingleCompany.push(args);
    return state.prepareOutcome;
  },
  getPrepStatus: async (...args: unknown[]) => {
    calls.getPrepStatus.push(args);
    return state.prepStatus;
  },
}));

let server: Server;
let baseUrl: string;

async function startServer() {
  const { default: router } = await import('../routes/wizmatchPrepare');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: unknown }).user = { tenantId: 'tenant-1', id: 'user-1', role: 'staff' };
    next();
  });
  app.use('/api/wizmatch', router);
  // A downstream handler proves next('router') actually falls through, rather
  // than the request dead-ending inside this router's own 404.
  app.use('/api/wizmatch', (_req, res) => res.status(200).json({ fellThrough: true }));
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(() => {
  vi.resetModules();
  calls.prepareSingleCompany.length = 0;
  calls.getPrepStatus.length = 0;
  state.prepareOutcome = { ok: true, result: { companyId: 'company-1', status: 'prepared' } };
  state.prepStatus = { lastPreparedAt: '2026-07-27T00:00:00.000Z' };
  process.env.WIZMATCH_AUTO_PREP_ENABLED = 'true';
});

afterEach(async () => {
  delete process.env.WIZMATCH_AUTO_PREP_ENABLED;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('wizmatchPrepare router — feature flag (default off)', () => {
  it('falls through to later /api/wizmatch mounts when the flag is unset, rather than 404ing the whole prefix', async () => {
    delete process.env.WIZMATCH_AUTO_PREP_ENABLED;
    await startServer();

    const res = await fetch(`${baseUrl}/api/wizmatch/companies/company-1/prepare`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fellThrough: true });
    expect(calls.prepareSingleCompany).toHaveLength(0);
  });

  it('stays off for a value that is not an enable ("off", "0", "maybe")', async () => {
    process.env.WIZMATCH_AUTO_PREP_ENABLED = 'off';
    await startServer();

    const res = await fetch(`${baseUrl}/api/wizmatch/companies/company-1/prepare/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ fellThrough: true });
    expect(calls.getPrepStatus).toHaveLength(0);
  });

  // The route MUST agree with the worker cron's `enabled()` parser. When it
  // required the exact string 'true', `WIZMATCH_AUTO_PREP_ENABLED=1` started the
  // cron (which scrapes websites) while both routes 404'd — the automated side
  // ran and the operator's own inspection surface did not (PR 6 review, M-D).
  it.each(['1', 'TRUE', 'yes', 'on'])('accepts %s, the same values the cron accepts', async (value) => {
    process.env.WIZMATCH_AUTO_PREP_ENABLED = value;
    await startServer();

    const res = await fetch(`${baseUrl}/api/wizmatch/companies/company-1/prepare/status`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ prep: state.prepStatus });
    expect(calls.getPrepStatus).toHaveLength(1);
  });

  it('serves the real routes once the flag is "true"', async () => {
    await startServer();

    const postRes = await fetch(`${baseUrl}/api/wizmatch/companies/company-1/prepare`, { method: 'POST' });
    expect(postRes.status).toBe(200);
    expect(await postRes.json()).toMatchObject({ companyId: 'company-1', status: 'prepared' });
    expect(calls.prepareSingleCompany).toEqual([['tenant-1', 'company-1']]);

    const getRes = await fetch(`${baseUrl}/api/wizmatch/companies/company-1/prepare/status`);
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({ prep: state.prepStatus });
  });
});

describe('wizmatchPrepare router — error shapes', () => {
  it('returns 409 (retryable) when the advisory lock is held', async () => {
    state.prepareOutcome = { ok: false, reason: 'lock_held' };
    await startServer();

    const res = await fetch(`${baseUrl}/api/wizmatch/companies/company-1/prepare`, { method: 'POST' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'lock_held' });
  });

  // Distinct from 409 on purpose: a client retrying a 409 is behaving
  // correctly, a client retrying a nonexistent company loops forever.
  it('returns 404 (permanent) for a company that does not exist in this tenant', async () => {
    state.prepareOutcome = { ok: false, reason: 'not_found' };
    await startServer();

    const res = await fetch(`${baseUrl}/api/wizmatch/companies/company-1/prepare`, { method: 'POST' });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'not_found' });
  });

  it('returns 404 for a company with no prep status recorded', async () => {
    state.prepStatus = null;
    await startServer();

    const res = await fetch(`${baseUrl}/api/wizmatch/companies/company-1/prepare/status`);
    expect(res.status).toBe(404);
  });
});
