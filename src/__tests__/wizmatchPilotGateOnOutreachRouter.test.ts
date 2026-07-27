// M-3 remediation — regression guard for the fix in src/index.ts's
// `/api/wizmatch` mount for `wizmatchRouter` (the 82-route send/spend/read
// router). Before this fix that mount was
// `app.use('/api/wizmatch', requireAuth, wizmatchRequireAdmin, wizmatchRouter)`
// with NO pilot-roster check — only the admin/team_lead/viewer role gate.
// This router carries send (`POST /signals/:id/send`), paid discovery
// (`POST /contact-intelligence/companies/:companyId/discover`), and provider
// invocation routes; a non-roster admin/team_lead could reach every one of
// them.
//
// `src/index.ts` cannot be safely imported in a unit test (module load starts
// a real HTTP listener and a real Postgres pool — see the same note in
// wizmatchIndexMountOrder.test.ts, this repo's established convention for
// this exact problem). This file therefore combines the two techniques that
// convention already uses:
//   1. A source-level scan asserting the real mount line in src/index.ts
//      actually wires `wizmatchPilotGate` into the chain, in the correct
//      position (after wizmatchRequireAdmin, before wizmatchRouter).
//   2. A behavioural test that mounts the REAL `wizmatchPilotGate` and the
//      REAL `wizmatchRouter` on a bare express app, in the SAME relative
//      order the fixed index.ts mount now uses, and proves the gate actually
//      denies/passes as expected — something the source scan alone cannot see
//      (a source scan would not catch e.g. the gate being wired to run AFTER
//      the router instead of before it).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const sendSignalDraftEmail = vi.fn();
vi.mock('../services/wizmatchOutreachService', () => ({
  generateSignalDraftEmails: vi.fn(),
  sendSignalDraftEmail: (...args: unknown[]) => sendSignalDraftEmail(...args),
}));

const runManualPaidContactDiscovery = vi.fn();
vi.mock('../services/wizmatchContactIntelligenceRepo', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, runManualPaidContactDiscovery: (...args: unknown[]) => runManualPaidContactDiscovery(...args) };
});

vi.mock('../modules/outreach/outreachGate', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    evaluateWizmatchOutreachGate: vi.fn(async () => ({ preparationAllowed: true, reasonCodes: [] })),
    shouldBlock: vi.fn(() => false),
  };
});

describe('src/index.ts — /api/wizmatch wizmatchRouter mount wires wizmatchPilotGate (M-3)', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');

  it('imports wizmatchPilotGate from the middleware module', () => {
    expect(source).toMatch(/import \{ wizmatchPilotGate \} from '\.\/middleware\/wizmatchPilotGate';/);
  });

  it('mounts wizmatchPilotGate in the wizmatchRouter chain, after wizmatchRequireAdmin and before wizmatchRouter', () => {
    expect(source).toMatch(
      /app\.use\('\/api\/wizmatch', requireAuth, wizmatchRequireAdmin, wizmatchPilotGate, wizmatchRouter\);/,
    );
  });

  it('the internal-ingest/unsubscribe short-circuit is registered BEFORE this mount and never reaches it', () => {
    const shortCircuitIdx = source.indexOf("if (isInternalIngest || isPublicUnsubscribe) return wizmatchRouter(req, res, next);");
    const gatedMountIdx = source.indexOf("app.use('/api/wizmatch', requireAuth, wizmatchRequireAdmin, wizmatchPilotGate, wizmatchRouter);");
    expect(shortCircuitIdx).toBeGreaterThan(-1);
    expect(gatedMountIdx).toBeGreaterThan(-1);
    expect(shortCircuitIdx).toBeLessThan(gatedMountIdx);
  });
});

describe('wizmatchPilotGate + wizmatchRouter, mounted in the fixed index.ts order — behavioural', () => {
  let server: Server | null = null;
  let baseUrl: string;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WIZMATCH_SENDING_ENABLED = 'true';
  });

  afterEach(async () => {
    delete process.env.WIZMATCH_SENDING_ENABLED;
    delete process.env.WIZMATCH_STAFFING_PILOT_USER_IDS;
    delete process.env.WIZMATCH_STAFFING_PILOT_ALL_USERS;
    if (server) {
      const s = server;
      server = null;
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  async function startGatedRouter(user: Record<string, unknown>): Promise<string> {
    vi.resetModules();
    const { wizmatchPilotGate } = await import('../middleware/wizmatchPilotGate');
    const { default: wizmatchRouter } = await import('../routes/wizmatch');

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { user: unknown }).user = user;
      next();
    });
    // Mirrors the FIXED src/index.ts order: requireAuth/wizmatchRequireAdmin
    // are stubbed above (their own coverage lives elsewhere); this exercises
    // exactly the wizmatchPilotGate -> wizmatchRouter relative order the M-3
    // fix put in place.
    app.use('/api/wizmatch', wizmatchPilotGate, wizmatchRouter);

    await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
    return `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  }

  it('denies a non-roster user on a send-capable route (POST /signals/:id/send) before the service is ever called', async () => {
    process.env.WIZMATCH_STAFFING_PILOT_USER_IDS = 'someone-else';
    baseUrl = await startGatedRouter({ tenantId: 'tenant-1', id: 'user-1', role: 'team_lead' });

    const res = await fetch(`${baseUrl}/api/wizmatch/signals/sig-1/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variant_message_id: 'msg-1' }),
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('staffing_pilot_access_required');
    expect(sendSignalDraftEmail).not.toHaveBeenCalled();
  });

  it('denies a non-roster user on a paid-discovery route (POST /contact-intelligence/companies/:companyId/discover) before the service is ever called', async () => {
    process.env.WIZMATCH_STAFFING_PILOT_USER_IDS = 'someone-else';
    baseUrl = await startGatedRouter({ tenantId: 'tenant-1', id: 'user-1', role: 'admin' });

    const res = await fetch(`${baseUrl}/api/wizmatch/contact-intelligence/companies/company-1/discover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmPreview: true }),
    });
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('staffing_pilot_access_required');
    expect(runManualPaidContactDiscovery).not.toHaveBeenCalled();
  });

  it('a rostered user with an appropriate role passes the pilot gate and reaches the existing RBAC/route logic (send)', async () => {
    process.env.WIZMATCH_STAFFING_PILOT_USER_IDS = 'user-1';
    sendSignalDraftEmail.mockResolvedValueOnce({ kind: 'not_found' });
    baseUrl = await startGatedRouter({ tenantId: 'tenant-1', id: 'user-1', role: 'team_lead' });

    const res = await fetch(`${baseUrl}/api/wizmatch/signals/sig-1/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ variant_message_id: 'msg-1' }),
    });
    // Reaches the route's own handler (mocked service returns `not_found` ->
    // 404), not the pilot gate's 403 — proving the gate let it through.
    expect(res.status).toBe(404);
    expect(sendSignalDraftEmail).toHaveBeenCalledTimes(1);
  });

  it('a rostered user with an appropriate role passes the pilot gate and reaches the existing RBAC/route logic (paid discovery)', async () => {
    process.env.WIZMATCH_STAFFING_PILOT_USER_IDS = 'user-1';
    runManualPaidContactDiscovery.mockResolvedValueOnce({ kind: 'not_found' });
    baseUrl = await startGatedRouter({ tenantId: 'tenant-1', id: 'user-1', role: 'admin' });

    const res = await fetch(`${baseUrl}/api/wizmatch/contact-intelligence/companies/company-1/discover`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ confirmPreview: true }),
    });
    expect(res.status).toBe(404);
    expect(runManualPaidContactDiscovery).toHaveBeenCalledTimes(1);
  });
});
