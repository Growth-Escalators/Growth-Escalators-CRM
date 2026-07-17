import { describe, it, expect, vi, beforeEach } from 'vitest';

// H13 — the pipeline-placement cron (worker.ts) calls deliverPurchaseAssets
// again every 5 minutes for any contact stuck failing pipeline placement,
// previously re-sending the full WhatsApp + email sequence up to 288x/day.
// This tests only the pre-send dedupe guard added at the top of the
// function — everything downstream (WA send, email send, delivery log,
// Slack alert) is mocked out so a "skip" is observable as "none of the
// downstream sends were called."

const mockQuery = vi.fn();
vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => mockQuery(...args) },
}));

const mockSendWhatsAppMessage = vi.fn();
vi.mock('../services/growthOSSetup', () => ({
  sendWhatsAppMessage: (...args: unknown[]) => mockSendWhatsAppMessage(...args),
}));

const mockSendSlackDM = vi.fn();
vi.mock('../services/slackService', () => ({
  sendSlackDM: (...args: unknown[]) => mockSendSlackDM(...args),
}));

const mockGetFunnelConfig = vi.fn();
vi.mock('../services/funnelConfigService', () => ({
  getFunnelConfig: (...args: unknown[]) => mockGetFunnelConfig(...args),
  renderTemplate: (tpl: string) => tpl,
}));

import { deliverPurchaseAssets } from '../services/assetDeliveryService';

describe('deliverPurchaseAssets — pre-send dedupe (H13)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockSendWhatsAppMessage.mockResolvedValue(true);
    mockSendSlackDM.mockResolvedValue(undefined);
    mockGetFunnelConfig.mockResolvedValue(null);
  });

  it('skips the send entirely when a delivery already succeeded in the last 24h', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // dedupe SELECT finds a row

    await deliverPurchaseAssets({
      contactId: 'contact-1', firstName: 'Riya', phone: '919999999999', email: 'riya@example.com',
      bump1: false, bump2: false, segment: 'd2c', funnelSlug: 'ecom',
    });

    expect(mockSendWhatsAppMessage).not.toHaveBeenCalled();
    expect(mockGetFunnelConfig).not.toHaveBeenCalled();
    // Only the dedupe SELECT should have run — no INSERT into purchase_delivery_log.
    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(mockQuery.mock.calls[0][0]).toMatch(/SELECT 1 FROM purchase_delivery_log/);
  });

  it('proceeds with delivery when no prior delivery is found', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // dedupe SELECT — nothing found
      .mockResolvedValue({ rows: [] }); // every subsequent INSERT/query call

    await deliverPurchaseAssets({
      contactId: 'contact-2', firstName: 'Aman', phone: '919999999998', email: null,
      bump1: false, bump2: false, segment: 'd2c', funnelSlug: 'ecom',
    });

    expect(mockSendWhatsAppMessage).toHaveBeenCalledTimes(1);
  });

  it('scopes the dedupe check to contact + funnel (different funnel is not deduped)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValue({ rows: [] });

    await deliverPurchaseAssets({
      contactId: 'contact-3', firstName: 'Dev', phone: '919999999997', email: null,
      bump1: false, bump2: false, segment: 'd2c', funnelSlug: 'other-funnel',
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(['contact-3', 'other-funnel']);
  });

  it('defaults the funnel slug to "ecom" in the dedupe check when none is passed', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] }).mockResolvedValue({ rows: [] });

    await deliverPurchaseAssets({
      contactId: 'contact-4', firstName: 'Sam', phone: null, email: null,
      bump1: false, bump2: false, segment: 'd2c',
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(['contact-4', 'ecom']);
  });

  it('fails open (proceeds with delivery) if the dedupe check itself errors', async () => {
    mockQuery
      .mockRejectedValueOnce(new Error('db blip'))
      .mockResolvedValue({ rows: [] });

    await deliverPurchaseAssets({
      contactId: 'contact-5', firstName: 'Nina', phone: '919999999996', email: null,
      bump1: false, bump2: false, segment: 'd2c', funnelSlug: 'ecom',
    });

    expect(mockSendWhatsAppMessage).toHaveBeenCalledTimes(1);
  });
});
