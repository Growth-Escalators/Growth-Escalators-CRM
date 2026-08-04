// Tenant-feature-gating PR (#115) — proves the 'lead'/'agency_lead' branch of
// edgeQueueDrainer's dispatch() resolves the tenant via a service call rather
// than the old hardcoded eq(tenants.slug, DEFAULT_TENANT_SLUG) lookup, and
// that a missing qualifying tenant is a silent no-op (matching the previous
// `if (!tenant) return;` behavior) rather than a thrown error.
//
// UPDATED 2026-08-04 (fix: lead-theft by slug order). getSingleActiveTenantWithFeature
// picked the FIRST qualifying tenant by slug when more than one matched, so a
// reseller_pilot tenant (also crmAutomation: true) sorting before
// growth-escalators would silently steal GE's own edge-ingested leads. This
// drain handles events from GE's OWN edge infrastructure, so it must be
// pinned to GE's tenant — it now goes through getDefaultIngestTenant instead.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const findOrCreateContact = vi.fn();
const getDefaultIngestTenant = vi.fn();
const getSingleActiveTenantWithFeature = vi.fn();
const sendSlackMessage = vi.fn().mockResolvedValue(undefined);

vi.mock('../services/contactService', () => ({ findOrCreateContact }));
vi.mock('../services/tenantFeatures', () => ({ getDefaultIngestTenant, getSingleActiveTenantWithFeature }));
vi.mock('../services/slackService', () => ({ sendSlackMessage }));
vi.mock('../services/cashfreeEventProcessor', () => ({
  processCashfreeEvent: vi.fn(),
  recordPendingOrder: vi.fn(),
}));
vi.mock('../services/upstashClient', () => ({
  getUpstashClient: () => null,
  QUEUE_STREAM: 'test-stream',
  QUEUE_DLQ: 'test-dlq',
  QUEUE_GROUP: 'test-group',
  QUEUE_CONSUMER: 'test-consumer',
}));
vi.mock('../utils/logger', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

// dispatch()'s 'lead'/'agency_lead' case no longer touches `db` directly for
// tenant resolution (that's mocked via '../services/tenantFeatures' above),
// but it still does its own "existing contact tags" lookup via
// db.select().from(contacts).where(eq(contacts.id, ...)).limit(1).
const updateWhere = vi.fn().mockResolvedValue(undefined);
vi.mock('../db/index', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ tags: [] }] }) }) }),
    update: () => ({ set: () => ({ where: updateWhere }) }),
  },
  contacts: { id: 'id' },
  pool: { query: vi.fn() },
}));

describe('edgeQueueDrainer.dispatch — lead/agency_lead tenant resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findOrCreateContact.mockResolvedValue({ contact: { id: 'contact-1' }, created: true });
  });

  it("resolves the tenant via getDefaultIngestTenant('crmAutomation') — pinned to GE's tenant", async () => {
    getDefaultIngestTenant.mockResolvedValue({ id: 'ge-tenant-id', slug: 'growth-escalators' });
    const { dispatch } = await import('../services/edgeQueueDrainer');

    await dispatch({ type: 'lead', payload: { name: 'Asha Rao', email: 'asha@example.invalid' } });

    expect(getDefaultIngestTenant).toHaveBeenCalledWith('crmAutomation');
    expect(findOrCreateContact).toHaveBeenCalledWith('ge-tenant-id', expect.objectContaining({ firstName: 'Asha' }));
  });

  it('is a silent no-op when GE\'s tenant does not have crmAutomation enabled (same as the old "if (!tenant) return")', async () => {
    getDefaultIngestTenant.mockResolvedValue(null);
    const { dispatch } = await import('../services/edgeQueueDrainer');

    await expect(dispatch({ type: 'agency_lead', payload: { name: 'Asha Rao', email: 'asha@example.invalid' } })).resolves.toBeUndefined();
    expect(findOrCreateContact).not.toHaveBeenCalled();
  });

  // THE REGRESSION GUARD for Bug 1 at this call site: this drain must never
  // fall back to the old slug-scan helper, which is exactly what silently
  // routed GE's own edge-ingested leads to a reseller tenant that sorted first.
  it('never calls getSingleActiveTenantWithFeature (the bug-class helper) — this drain is pinned, not feature-scanned', async () => {
    getDefaultIngestTenant.mockResolvedValue({ id: 'ge-tenant-id', slug: 'growth-escalators' });
    const { dispatch } = await import('../services/edgeQueueDrainer');

    await dispatch({ type: 'lead', payload: { name: 'Asha Rao', email: 'asha@example.invalid' } });

    expect(getSingleActiveTenantWithFeature).not.toHaveBeenCalled();
  });
});
