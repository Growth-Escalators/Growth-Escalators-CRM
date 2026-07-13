import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/index', () => ({
  pool: { query: vi.fn() },
}));

vi.mock('../services/contactService', async () => {
  const actual = await vi.importActual<typeof import('../services/contactService')>('../services/contactService');
  return {
    ...actual,
    findOrCreateContact: vi.fn(),
  };
});

import { pool } from '../db/index';
import { findOrCreateContact } from '../services/contactService';
import { classifyWizmatchClientLead, linkApprovedWizmatchClientLead } from '../services/wizmatchClientLeadLink';

const findOrCreateMock = vi.mocked(findOrCreateContact);
const queryMock = vi.mocked(pool.query);

beforeEach(() => {
  vi.clearAllMocks();
  findOrCreateMock.mockResolvedValue({
    contact: { id: 'crm-contact-1' } as any,
    channels: [],
    created: false,
  });
  queryMock.mockResolvedValue({ rows: [], rowCount: 1 } as any);
});

describe('linkApprovedWizmatchClientLead', () => {
  it('normalizes channels and classifies a deduplicated CRM contact as a Client Lead', async () => {
    const result = await linkApprovedWizmatchClientLead('tenant-1', {
      id: 'candidate-1',
      companyId: 'company-1',
      companyName: 'Example Staffing Client',
      name: 'Asha Rao',
      title: 'Head of Talent Acquisition',
      email: ' ASHA@EXAMPLE.TEST ',
      phone: '+91 98765 43210',
      linkedinUrl: ' https://linkedin.example/asha ',
      metadata: { confidenceTier: 'high' },
    });

    expect(findOrCreateMock).toHaveBeenCalledWith('tenant-1', expect.objectContaining({
      firstName: 'Asha',
      lastName: 'Rao',
      companyName: 'Example Staffing Client',
      tags: ['Client Lead'],
      channels: [
        { channelType: 'email', channelValue: 'asha@example.test', isPrimary: true },
        { channelType: 'phone', channelValue: '919876543210', isPrimary: false },
        { channelType: 'linkedin', channelValue: 'https://linkedin.example/asha', isPrimary: false },
      ],
    }));
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("ARRAY['Client Lead']"),
      expect.arrayContaining(['Example Staffing Client', 'tenant-1', 'crm-contact-1']),
    );
    expect(queryMock.mock.calls[0][0]).toContain('last_activity_at = NOW()');
    expect(queryMock.mock.calls[0][0]).toContain('WHERE tenant_id = $3 AND id = $4');
    expect(result).toEqual({ crmContactId: 'crm-contact-1', created: false });
  });

  it('returns created=true without changing the classification update contract', async () => {
    findOrCreateMock.mockResolvedValue({
      contact: { id: 'crm-contact-2' } as any,
      channels: [],
      created: true,
    });

    await expect(linkApprovedWizmatchClientLead('tenant-1', {
      id: 'candidate-2',
      companyId: 'company-1',
      name: 'Ravi Mehta',
      email: 'ravi@example.test',
    })).resolves.toEqual({ crmContactId: 'crm-contact-2', created: true });

    expect(queryMock).toHaveBeenCalledOnce();
  });

  it('classifies an already-linked CRM contact without creating another contact', async () => {
    await classifyWizmatchClientLead('tenant-1', 'existing-crm-contact', {
      id: 'candidate-3',
      companyId: 'company-1',
      companyName: 'Example Staffing Client',
      name: 'Existing Lead',
    });

    expect(findOrCreateMock).not.toHaveBeenCalled();
    expect(queryMock).toHaveBeenCalledWith(
      expect.stringContaining("ARRAY['Client Lead']"),
      expect.arrayContaining(['Example Staffing Client', 'tenant-1', 'existing-crm-contact']),
    );
  });
});
