// Tenant-feature-gating PR — src/routes/leads.ts had no dedicated test file
// before this PR. This is both (a) proof that the tenant resolution used by
// POST /api/leads/agency now goes through getSingleActiveTenantWithFeature
// instead of the old hardcoded eq(tenants.slug, DEFAULT_TENANT_SLUG) lookup,
// with identical behavior for today's single-tenant reality, and (b) the
// illustrative "route-level gate" example called for in the PR: the route
// now cleanly declines (503) rather than 500ing when no tenant qualifies.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const findOrCreateContact = vi.fn();
const getSingleActiveTenantWithFeature = vi.fn();
const sendSlackMessage = vi.fn().mockResolvedValue(undefined);

vi.mock('../services/contactService', () => ({ findOrCreateContact }));
vi.mock('../services/tenantFeatures', () => ({ getSingleActiveTenantWithFeature }));
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

  it("resolves via getSingleActiveTenantWithFeature('crmAutomation') and files the contact under that tenant — matches today's DEFAULT_TENANT_SLUG target", async () => {
    getSingleActiveTenantWithFeature.mockResolvedValue({ id: 'ge-tenant-id', slug: 'growth-escalators' });
    await startServer();

    const res = await fetch(`${baseUrl}/api/leads/agency`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(200);
    expect(getSingleActiveTenantWithFeature).toHaveBeenCalledWith('crmAutomation');
    expect(findOrCreateContact).toHaveBeenCalledWith('ge-tenant-id', expect.objectContaining({ firstName: 'Asha' }));
  });

  it('declines cleanly (503) instead of a raw 500 when no active tenant has crmAutomation enabled', async () => {
    getSingleActiveTenantWithFeature.mockResolvedValue(null);
    await startServer();

    const res = await fetch(`${baseUrl}/api/leads/agency`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(503);
    expect(findOrCreateContact).not.toHaveBeenCalled();
  });

  it('would automatically pick up a second tenant if one were onboarded with crmAutomation enabled', async () => {
    getSingleActiveTenantWithFeature.mockResolvedValue({ id: 'second-tenant-id', slug: 'second-agency' });
    await startServer();

    const res = await fetch(`${baseUrl}/api/leads/agency`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(200);
    expect(findOrCreateContact).toHaveBeenCalledWith('second-tenant-id', expect.any(Object));
  });

  it('still validates required fields before ever resolving a tenant', async () => {
    getSingleActiveTenantWithFeature.mockResolvedValue({ id: 'ge-tenant-id', slug: 'growth-escalators' });
    await startServer();

    const res = await fetch(`${baseUrl}/api/leads/agency`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'No Email Or Phone' }),
    });

    expect(res.status).toBe(400);
    expect(getSingleActiveTenantWithFeature).not.toHaveBeenCalled();
  });
});
