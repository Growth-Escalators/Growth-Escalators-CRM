// Tenant-feature-gating PR — proves the 'lead'/'agency_lead' branch of
// edgeQueueDrainer's dispatch() resolves the tenant via
// getSingleActiveTenantWithFeature('crmAutomation') instead of the old
// hardcoded eq(tenants.slug, DEFAULT_TENANT_SLUG) lookup, and that a missing
// qualifying tenant is a silent no-op (matching the previous `if (!tenant) return;`
// behavior) rather than a thrown error.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const findOrCreateContact = vi.fn();
const getSingleActiveTenantWithFeature = vi.fn();
const sendSlackMessage = vi.fn().mockResolvedValue(undefined);

vi.mock('../services/contactService', () => ({ findOrCreateContact }));
vi.mock('../services/tenantFeatures', () => ({ getSingleActiveTenantWithFeature }));
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

  it("resolves the tenant via getSingleActiveTenantWithFeature('crmAutomation') — matches today's DEFAULT_TENANT_SLUG target", async () => {
    getSingleActiveTenantWithFeature.mockResolvedValue({ id: 'ge-tenant-id', slug: 'growth-escalators' });
    const { dispatch } = await import('../services/edgeQueueDrainer');

    await dispatch({ type: 'lead', payload: { name: 'Asha Rao', email: 'asha@example.invalid' } });

    expect(getSingleActiveTenantWithFeature).toHaveBeenCalledWith('crmAutomation');
    expect(findOrCreateContact).toHaveBeenCalledWith('ge-tenant-id', expect.objectContaining({ firstName: 'Asha' }));
  });

  it('is a silent no-op when no active tenant has crmAutomation enabled (same as the old "if (!tenant) return")', async () => {
    getSingleActiveTenantWithFeature.mockResolvedValue(null);
    const { dispatch } = await import('../services/edgeQueueDrainer');

    await expect(dispatch({ type: 'agency_lead', payload: { name: 'Asha Rao', email: 'asha@example.invalid' } })).resolves.toBeUndefined();
    expect(findOrCreateContact).not.toHaveBeenCalled();
  });

  it('would pick up a second tenant automatically — no code change needed here if one more tenant gets crmAutomation enabled', async () => {
    // getSingleActiveTenantWithFeature itself has dedicated multi-tenant
    // coverage in tenantFeatures.test.ts; this just proves dispatch() defers
    // entirely to whatever it resolves, rather than a hardcoded slug/id.
    getSingleActiveTenantWithFeature.mockResolvedValue({ id: 'second-tenant-id', slug: 'second-agency' });
    const { dispatch } = await import('../services/edgeQueueDrainer');

    await dispatch({ type: 'lead', payload: { name: 'New Co Lead', email: 'lead@example.invalid' } });

    expect(findOrCreateContact).toHaveBeenCalledWith('second-tenant-id', expect.any(Object));
  });
});
