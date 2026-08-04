// End-to-end proof that requireTenantFeature, mounted in front of a real
// route the way src/index.ts mounts it (`/api/billing` -> gstBilling,
// `/api/wizmatch` -> wizmatch), actually enforces the plan entitlement — and,
// critically, that it does NOT accidentally lock Growth-Escalators' own
// production traffic out of the features its plan legitimately has on.
//
// This does not boot src/index.ts (a real HTTP listener + real Postgres pool
// per wizmatchIndexMountOrder.test.ts's own reasoning for avoiding that).
// Instead it builds a minimal express app with `req.user` injected directly
// (same convention wizmatchIndexMountOrder.test.ts uses) and the REAL
// `requireTenantFeature` + REAL `getTenantFeatures`/`computeTenantFeatures`
// wired in front of a stub downstream handler — so the plan-default table in
// tenantFeatures.ts is exercised for real, not re-implemented here.
//
// Tenant slugs below are placeholders (`reseller-pilot-sample`,
// `growth-escalators`, `wizmatch`), matching this repo's existing convention
// of never naming a real CLIENT tenant in a test (tenantFeatures.test.ts's
// history: "stop naming the real client tenant slug"). `growth-escalators`
// and `wizmatch` themselves are GE's own two internal tenants, already named
// throughout tenantFeatures.ts/tenantFeatures.test.ts — not a client.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

function mockTenantRow(row: { plan: string; settings: unknown } | undefined) {
  const limit = vi.fn().mockResolvedValue(row ? [row] : []);
  const where = vi.fn().mockReturnValue({ limit });
  const from = vi.fn().mockReturnValue({ where });
  const select = vi.fn().mockReturnValue({ from });
  // `pool` included (unlike tenantFeatures.test.ts's narrower db-only mock)
  // so any other module that happens to share this worker's module registry
  // and imports `pool` from '../db/index' (e.g. audit logging) degrades to a
  // harmless no-op instead of an unhandled "no pool export" warning.
  vi.doMock('../db/index', () => ({ db: { select }, pool: { query: vi.fn().mockResolvedValue({ rows: [] }) } }));
}

async function startApp(
  feature: 'wizmatch' | 'gstBilling',
  user: { id: string; tenantId: string; role: string },
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const { requireTenantFeature } = await import('../middleware/requireTenantFeature');
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { user: unknown }).user = user;
    next();
  });
  app.use('/protected', requireTenantFeature(feature), (_req, res) => {
    res.status(200).json({ ok: true });
  });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { baseUrl, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

describe('requireTenantFeature — route enforcement (real getTenantFeatures/computeTenantFeatures)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  describe('wizmatch — the /api/wizmatch route group', () => {
    it('a reseller-pilot tenant (wizmatch explicitly off) gets 403', async () => {
      mockTenantRow({ plan: 'reseller_pilot', settings: {} });
      const { baseUrl, close } = await startApp('wizmatch', {
        id: 'user-1',
        tenantId: 'reseller-pilot-tenant-id',
        role: 'admin',
      });
      try {
        const res = await fetch(`${baseUrl}/protected`);
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({
          error: 'feature_not_enabled',
          message: "This feature ('wizmatch') is not enabled for your account.",
        });
      } finally {
        await close();
      }
    });

    // CONTROL — the tenant that actually generates production Wizmatch
    // traffic. Wizmatch admin logins are provisioned under a SEPARATE tenant
    // row (plan `wizmatch_internal`, slug `wizmatch`) by
    // src/scripts/createWizmatchAdmin.ts — a GE staff member's Wizmatch
    // session's `req.user.tenantId` is this tenant's id, never
    // growth-escalators's (users.tenant_id is one-tenant-per-account; H-1 in
    // auth.ts: "both pilot operators hold accounts in two of them"). This is
    // the tenant this gate must NOT break.
    it('the wizmatch_internal tenant (wizmatch on) is unaffected — normal 200', async () => {
      mockTenantRow({ plan: 'wizmatch_internal', settings: {} });
      const { baseUrl, close } = await startApp('wizmatch', {
        id: 'wizmatch-admin',
        tenantId: 'wizmatch-tenant-id',
        role: 'admin',
      });
      try {
        const res = await fetch(`${baseUrl}/protected`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
      } finally {
        await close();
      }
    });

    // SAFETY-CHECK FINDING, pinned as a test rather than left as a comment.
    // PLAN_DEFAULTS (tenantFeatures.ts) resolves growth-escalators
    // (agency_internal) to wizmatch: false BY DESIGN — the doc comment on
    // that table states Wizmatch automation/traffic runs under the SEPARATE
    // wizmatch_internal tenant above, not this one, and
    // tenantFeatures.test.ts already pins this exact resolution as "matches
    // today". This test proves that fact holds through requireTenantFeature
    // too: growth-escalators traffic correctly 403s here, which is the
    // INTENDED behaviour (GE's own Wizmatch admin uses the dedicated
    // wizmatch tenant login, not their growth-escalators one) — not a
    // regression this PR introduces.
    it('growth-escalators (agency_internal — wizmatch off by design) also 403s on /api/wizmatch, matching the documented plan default', async () => {
      mockTenantRow({ plan: 'agency_internal', settings: {} });
      const { baseUrl, close } = await startApp('wizmatch', {
        id: 'ge-staff',
        tenantId: 'growth-escalators-tenant-id',
        role: 'admin',
      });
      try {
        const res = await fetch(`${baseUrl}/protected`);
        expect(res.status).toBe(403);
      } finally {
        await close();
      }
    });
  });

  describe('gstBilling — the /api/billing route group', () => {
    it('a reseller-pilot tenant (gstBilling explicitly off) gets 403', async () => {
      mockTenantRow({ plan: 'reseller_pilot', settings: {} });
      const { baseUrl, close } = await startApp('gstBilling', {
        id: 'user-1',
        tenantId: 'reseller-pilot-tenant-id',
        role: 'admin',
      });
      try {
        const res = await fetch(`${baseUrl}/protected`);
        expect(res.status).toBe(403);
      } finally {
        await close();
      }
    });

    // CONTROL — growth-escalators (agency_internal) has gstBilling ON by
    // plan default (the "Overdue Invoice Check" cron already runs for this
    // exact tenant via getSingleActiveTenantWithFeature('gstBilling') in
    // worker.ts) and IS the tenant GE's own finance/ops staff use for GST
    // invoicing today. This gate must not touch that.
    it('growth-escalators (agency_internal — gstBilling on) is unaffected — normal 200', async () => {
      mockTenantRow({ plan: 'agency_internal', settings: {} });
      const { baseUrl, close } = await startApp('gstBilling', {
        id: 'ge-staff',
        tenantId: 'growth-escalators-tenant-id',
        role: 'admin',
      });
      try {
        const res = await fetch(`${baseUrl}/protected`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
      } finally {
        await close();
      }
    });
  });
});
