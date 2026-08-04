import { describe, it, expect, vi, beforeEach } from 'vitest';

// placePipelineContact()'s internal "agency" hot-lead notification is
// GE-specific and must only fire for GE's own tenant, regardless of which
// tenant made the placement. These tests assert the notification fires for
// GE placements and is skipped entirely for a reseller tenant's placement.

const GE_TENANT_ID = 'tenant-ge-aaaaaaaa-aaaa-aaaa-aaaaaaaaaaaa';
const RESELLER_TENANT_ID = 'tenant-reseller-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const mockPoolQuery = vi.fn();
const mockSendSlackDM = vi.fn().mockResolvedValue(true);

vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args), connect: vi.fn() },
}));

vi.mock('../services/slackService', () => ({
  sendSlackDM: (...args: unknown[]) => mockSendSlackDM(...args),
}));

function baseImpl(sqlText: string, params: unknown[] = []): { rows: unknown[] } {
  // GE tenant id lookup (resolveGeTenantId)
  if (sqlText.includes('FROM tenants WHERE slug')) return { rows: [{ id: GE_TENANT_ID }] };
  // pipeline lookup by tenant + name
  if (sqlText.includes('SELECT id, name FROM pipelines WHERE tenant_id')) return { rows: [{ id: 'pipe-1', name: 'Agency Owners' }] };
  // stages lookup for the found pipeline
  if (sqlText.includes('SELECT stages FROM pipelines WHERE id')) return { rows: [{ stages: ['Paid ₹9', 'Paid ₹707'] }] };
  // upsert into pipeline_contacts
  if (sqlText.includes('INSERT INTO pipeline_contacts')) return { rows: [] };
  // update deals to link pipeline
  if (sqlText.includes('UPDATE deals SET pipeline_id')) return { rows: [] };
  // merge tags onto contact
  if (sqlText.includes('UPDATE contacts')) return { rows: [] };
  // contact info for the DM body (only reached for the GE-tenant branch)
  if (sqlText.includes('SELECT first_name, last_name')) {
    return { rows: [{ first_name: 'Agency', last_name: 'Buyer', phone: '919999999999' }] };
  }
  void params;
  return { rows: [] };
}

beforeEach(() => {
  vi.resetModules();
  mockPoolQuery.mockReset();
  mockSendSlackDM.mockClear();
  mockPoolQuery.mockImplementation(async (sqlText: string, params: unknown[] = []) => baseImpl(sqlText, params));
});

describe('services/pipelineService.ts — agency hot-lead DM is GE-tenant-only', () => {
  it('fires the Slack DM when the placement belongs to GE\'s own tenant', async () => {
    const { placePipelineContact } = await import('../services/pipelineService');
    const result = await placePipelineContact({
      contactId: 'contact-ge',
      segment: 'agency',
      amount: 707,
      bump1: false,
      bump2: false,
      tenantId: GE_TENANT_ID,
    });

    expect(result.success).toBe(true);
    expect(mockSendSlackDM).toHaveBeenCalledTimes(1);
    const [, message] = mockSendSlackDM.mock.calls[0];
    expect(message).toContain('Agency Buyer');
  });

  it('does NOT fire the Slack DM when the placement belongs to a reseller tenant', async () => {
    const { placePipelineContact } = await import('../services/pipelineService');
    const result = await placePipelineContact({
      contactId: 'contact-reseller',
      segment: 'agency',
      amount: 707,
      bump1: false,
      bump2: false,
      tenantId: RESELLER_TENANT_ID,
    });

    expect(result.success).toBe(true);
    expect(mockSendSlackDM).not.toHaveBeenCalled();
  });

  it('does NOT fire the Slack DM for a reseller tenant even with the legacy agency_owner segment id', async () => {
    const { placePipelineContact } = await import('../services/pipelineService');
    await placePipelineContact({
      contactId: 'contact-reseller-2',
      segment: 'agency_owner',
      amount: 707,
      bump1: false,
      bump2: false,
      tenantId: RESELLER_TENANT_ID,
    });

    expect(mockSendSlackDM).not.toHaveBeenCalled();
  });
});
