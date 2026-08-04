// Tenant-feature-gating PR (#115) — src/routes/leads.ts had no dedicated test
// file before that PR, which wired tenant resolution through
// getSingleActiveTenantWithFeature.
//
// UPDATED 2026-08-04 (fix: lead-theft by slug order). That helper picked the
// FIRST qualifying tenant by slug when more than one matched — so a
// reseller_pilot tenant (which also has crmAutomation: true) sorting before
// growth-escalators would silently steal GE's own inbound agency leads. This
// route ingests leads from GE's OWN white-label landing page, so it must be
// pinned to GE's tenant explicitly — it now goes through
// getDefaultIngestTenant instead. See tenantFeatures.test.ts for the unit
// coverage of the slug-pinning itself; this file proves the ROUTE wires to
// the correct (pinned) helper and behaves correctly for its return values.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const findOrCreateContact = vi.fn();
const getDefaultIngestTenant = vi.fn();
const getSingleActiveTenantWithFeature = vi.fn();
const sendSlackMessage = vi.fn().mockResolvedValue(undefined);

vi.mock('../services/contactService', () => ({ findOrCreateContact }));
vi.mock('../services/tenantFeatures', () => ({ getDefaultIngestTenant, getSingleActiveTenantWithFeature }));
vi.mock('../services/slackService', () => ({ sendSlackMessage }));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

const selectWhere = vi.fn();
const updateWhere = vi.fn().mockResolvedValue(undefined);
vi.mock('../db/index', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: selectWhere }) }) }),
    update: () => ({ set: () => ({ where: updateWhere }) }),
  },
  contacts: { id: 'id' },
}));

let server: Server;
let baseUrl: string;

async function startServer() {
  const { default: router } = await import('../routes/leads');
  const app = express();
  app.use(express.json());
  app.use('/api/leads', router);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const validBody = { name: 'Asha Rao', agencyName: 'Rao Media', email: 'asha@example.invalid', phone: '9876543210', adSpend: '5L' };

describe('POST /api/leads/agency — tenant resolution + route-level gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    selectWhere.mockResolvedValue([{ tags: [] }]);
    findOrCreateContact.mockResolvedValue({ contact: { id: 'contact-1' }, created: true });
  });

  afterEach(async () => {
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("resolves via getDefaultIngestTenant('crmAutomation') and files the contact under that tenant", async () => {
    getDefaultIngestTenant.mockResolvedValue({ id: 'ge-tenant-id', slug: 'growth-escalators' });
    await startServer();

    const res = await fetch(`${baseUrl}/api/leads/agency`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(200);
    expect(getDefaultIngestTenant).toHaveBeenCalledWith('crmAutomation');
    expect(findOrCreateContact).toHaveBeenCalledWith('ge-tenant-id', expect.objectContaining({ firstName: 'Asha' }));
  });

  it('declines cleanly (503) instead of a raw 500 when GE\'s tenant does not have crmAutomation enabled', async () => {
    getDefaultIngestTenant.mockResolvedValue(null);
    await startServer();

    const res = await fetch(`${baseUrl}/api/leads/agency`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(503);
    expect(findOrCreateContact).not.toHaveBeenCalled();
  });

  // THE REGRESSION GUARD for Bug 1 at this call site: this route must never
  // fall back to the old slug-scan helper, which is exactly what silently
  // routed GE's own inbound leads to a reseller tenant that sorted first.
  it('never calls getSingleActiveTenantWithFeature (the bug-class helper) — this route is pinned, not feature-scanned', async () => {
    getDefaultIngestTenant.mockResolvedValue({ id: 'ge-tenant-id', slug: 'growth-escalators' });
    await startServer();

    await fetch(`${baseUrl}/api/leads/agency`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(getSingleActiveTenantWithFeature).not.toHaveBeenCalled();
  });

  it('still validates required fields before ever resolving a tenant', async () => {
    getDefaultIngestTenant.mockResolvedValue({ id: 'ge-tenant-id', slug: 'growth-escalators' });
    await startServer();

    const res = await fetch(`${baseUrl}/api/leads/agency`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'No Email Or Phone' }),
    });

    expect(res.status).toBe(400);
    expect(getDefaultIngestTenant).not.toHaveBeenCalled();
  });
});
