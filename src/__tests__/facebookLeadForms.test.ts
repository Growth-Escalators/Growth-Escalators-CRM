import { describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';
import {
  buildFacebookLeadSlackMessage,
  extractFacebookLeadgenChanges,
  mapFacebookLeadFields,
  processFacebookLeadgenChange,
  verifyMetaLeadSignature,
  type FacebookLeadProcessDeps,
} from '../services/facebookLeadForms';

const encryptedToken = (() => {
  process.env.JWT_SECRET = 'test-secret';
  const key = crypto.scryptSync('test-secret', 'salt', 32);
  const iv = Buffer.alloc(16, 1);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update('page-token', 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${encrypted.toString('hex')}`;
})();

describe('Facebook Lead Forms', () => {
  it('parses Meta leadgen webhook payloads', () => {
    const changes = extractFacebookLeadgenChanges({
      object: 'page',
      entry: [{
        id: 'page-1',
        changes: [{
          field: 'leadgen',
          value: {
            page_id: 'page-1',
            leadgen_id: 'lead-1',
            form_id: 'form-1',
            ad_id: 'ad-1',
            created_time: 123,
          },
        }],
      }],
    });

    expect(changes).toEqual([{
      pageId: 'page-1',
      leadgenId: 'lead-1',
      formId: 'form-1',
      adId: 'ad-1',
      adgroupId: undefined,
      createdTime: 123,
    }]);
  });

  it('ignores non-leadgen webhook changes', () => {
    expect(extractFacebookLeadgenChanges({
      object: 'page',
      entry: [{ id: 'page-1', changes: [{ field: 'feed', value: {} }] }],
    })).toEqual([]);
  });

  it('maps standard and custom Facebook lead fields', () => {
    const mapped = mapFacebookLeadFields({
      id: 'lead-1',
      field_data: [
        { name: 'full_name', values: ['Priya Sharma'] },
        { name: 'email', values: [' PRIYA@Example.COM '] },
        { name: 'phone_number', values: ['98765 43210'] },
        { name: 'company_name', values: ['Acme Tech'] },
        { name: 'budget_range', values: ['2L-5L'] },
      ],
    });

    expect(mapped).toMatchObject({
      firstName: 'Priya',
      lastName: 'Sharma',
      email: 'priya@example.com',
      phone: '919876543210',
      companyName: 'Acme Tech',
      customFields: { budget_range: '2L-5L' },
    });
  });

  it('verifies Meta signatures over the raw body', () => {
    const rawBody = JSON.stringify({ object: 'page' });
    const signature = 'sha256=' + crypto.createHmac('sha256', 'app-secret').update(rawBody).digest('hex');

    expect(verifyMetaLeadSignature(rawBody, signature, 'app-secret')).toBe(true);
    expect(verifyMetaLeadSignature(rawBody, 'sha256=bad', 'app-secret')).toBe(false);
  });

  it('creates or reuses a CRM contact, updates activity, and sends Slack', async () => {
    const findOrCreate = vi.fn().mockResolvedValue({
      contact: { id: 'contact-1', firstName: 'Priya' },
      channels: [],
      created: true,
    });
    const updateContactAfterLead = vi.fn().mockResolvedValue(undefined);
    const sendSlack = vi.fn().mockResolvedValue(true);
    const deps: FacebookLeadProcessDeps = {
      getPageAccountByPageId: vi.fn().mockResolvedValue({
        id: 'social-1',
        tenantId: 'tenant-1',
        accountId: 'page-1',
        accountName: 'Growth Escalators',
        accessToken: encryptedToken,
      }),
      fetchLeadDetails: vi.fn().mockResolvedValue({
        id: 'lead-1',
        form_id: 'form-1',
        campaign_name: 'July Demo Campaign',
        field_data: [
          { name: 'full_name', values: ['Priya Sharma'] },
          { name: 'email', values: ['priya@example.com'] },
          { name: 'phone_number', values: ['9876543210'] },
        ],
      }),
      findOrCreate,
      getContactSnapshot: vi.fn().mockResolvedValue({ tags: ['existing'], metadata: { previous: true } }),
      updateContactAfterLead,
      sendSlack,
    };

    const result = await processFacebookLeadgenChange({ pageId: 'page-1', leadgenId: 'lead-1' }, deps);

    expect(result).toMatchObject({ contactId: 'contact-1', created: true, slackSent: true });
    expect(findOrCreate).toHaveBeenCalledWith('tenant-1', expect.objectContaining({
      source: 'facebook_lead_form',
      channels: [
        { channelType: 'email', channelValue: 'priya@example.com', isPrimary: true },
        { channelType: 'phone', channelValue: '919876543210', isPrimary: false },
      ],
    }));
    expect(updateContactAfterLead).toHaveBeenCalledWith('contact-1', expect.objectContaining({
      status: 'lead',
      tags: expect.arrayContaining(['existing', 'facebook_lead', 'meta_lead_form', 'page:Growth Escalators']),
      metadata: expect.objectContaining({
        previous: true,
        facebookLead: expect.objectContaining({ leadgenId: 'lead-1', formId: 'form-1' }),
      }),
    }));
    expect(sendSlack).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('New Facebook Lead Form Lead'));
  });

  it('does not fail processing when Slack fails', async () => {
    const deps: FacebookLeadProcessDeps = {
      getPageAccountByPageId: vi.fn().mockResolvedValue({
        id: 'social-1',
        tenantId: 'tenant-1',
        accountId: 'page-1',
        accountName: 'Growth Escalators',
        accessToken: encryptedToken,
      }),
      fetchLeadDetails: vi.fn().mockResolvedValue({
        id: 'lead-1',
        field_data: [{ name: 'email', values: ['lead@example.com'] }],
      }),
      findOrCreate: vi.fn().mockResolvedValue({
        contact: { id: 'contact-1', firstName: 'lead' },
        channels: [],
        created: false,
      }),
      getContactSnapshot: vi.fn().mockResolvedValue({ tags: [], metadata: {} }),
      updateContactAfterLead: vi.fn().mockResolvedValue(undefined),
      sendSlack: vi.fn().mockRejectedValue(new Error('slack down')),
    };

    await expect(processFacebookLeadgenChange({ pageId: 'page-1', leadgenId: 'lead-1' }, deps))
      .resolves.toMatchObject({ contactId: 'contact-1', slackSent: false });
  });

  it('renders Slack messages with page, form, campaign, and contact status', () => {
    const message = buildFacebookLeadSlackMessage({
      mapped: {
        firstName: 'Priya',
        lastName: 'Sharma',
        fullName: 'Priya Sharma',
        email: 'priya@example.com',
        phone: '919876543210',
        companyName: 'Acme',
        customFields: {},
      },
      lead: { id: 'lead-1', form_id: 'form-1', campaign_name: 'Hiring Campaign', ad_name: 'Lead Ad' },
      change: { pageId: 'page-1', leadgenId: 'lead-1' },
      pageName: 'Growth Escalators',
      created: true,
    });

    expect(message).toContain('Priya Sharma');
    expect(message).toContain('form-1');
    expect(message).toContain('Hiring Campaign');
    expect(message).toContain('NEW contact');
  });
});
