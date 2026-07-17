import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../modules/esign/esign.repository', () => ({
  findOpenContracts: vi.fn(),
  latestEventAt: vi.fn(),
}));
vi.mock('../modules/esign/esign.service', () => ({
  expireContract: vi.fn().mockResolvedValue(true),
  remindCurrentSigner: vi.fn().mockResolvedValue(undefined),
}));

import * as repo from '../modules/esign/esign.repository';
import * as service from '../modules/esign/esign.service';
import { expireOverdueContracts, sendSigningReminders } from '../modules/esign/esign.jobs';

const NOW = new Date('2026-07-17T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

beforeEach(() => vi.clearAllMocks());

describe('expireOverdueContracts', () => {
  it('expires only open contracts past their expiresAt', async () => {
    vi.mocked(repo.findOpenContracts).mockResolvedValue([
      { id: 'c1', tenantId: 't', status: 'SENT', expiresAt: daysAgo(1) },
      { id: 'c2', tenantId: 't', status: 'VIEWED', expiresAt: new Date(NOW.getTime() + 86_400_000) },
      { id: 'c3', tenantId: 't', status: 'SENT', expiresAt: null },
    ] as any);
    const res = await expireOverdueContracts(NOW);
    expect(res).toEqual({ checked: 3, expired: 1 });
    expect(service.expireContract).toHaveBeenCalledTimes(1);
    expect(service.expireContract).toHaveBeenCalledWith('t', 'c1');
  });
});

describe('sendSigningReminders', () => {
  it('reminds open, non-expired, not-recently-touched contracts only', async () => {
    vi.mocked(repo.findOpenContracts).mockResolvedValue([
      { id: 'c1', tenantId: 't', status: 'SENT', sentAt: daysAgo(5), expiresAt: null },   // due
      { id: 'c2', tenantId: 't', status: 'SENT', sentAt: daysAgo(0.02), expiresAt: null }, // too soon
      { id: 'c3', tenantId: 't', status: 'SENT', sentAt: daysAgo(10), expiresAt: daysAgo(1) }, // expired → skip
      { id: 'c4', tenantId: 't', status: 'VIEWED', sentAt: null, expiresAt: null }, // never sent → skip
    ] as any);
    vi.mocked(repo.latestEventAt).mockResolvedValue(null);
    const res = await sendSigningReminders(NOW, 3);
    expect(res.reminded).toBe(1);
    expect(service.remindCurrentSigner).toHaveBeenCalledTimes(1);
    expect(service.remindCurrentSigner).toHaveBeenCalledWith('t', 'c1');
  });

  it('throttles: does not remind if a reminder went out within the interval', async () => {
    vi.mocked(repo.findOpenContracts).mockResolvedValue([
      { id: 'c1', tenantId: 't', status: 'SENT', sentAt: daysAgo(10), expiresAt: null },
    ] as any);
    vi.mocked(repo.latestEventAt).mockResolvedValue(daysAgo(1)); // reminded yesterday, interval 3d
    const res = await sendSigningReminders(NOW, 3);
    expect(res.reminded).toBe(0);
    expect(service.remindCurrentSigner).not.toHaveBeenCalled();
  });

  it('a single reminder failure does not abort the sweep', async () => {
    vi.mocked(repo.findOpenContracts).mockResolvedValue([
      { id: 'c1', tenantId: 't', status: 'SENT', sentAt: daysAgo(5), expiresAt: null },
      { id: 'c2', tenantId: 't', status: 'SENT', sentAt: daysAgo(5), expiresAt: null },
    ] as any);
    vi.mocked(repo.latestEventAt).mockResolvedValue(null);
    vi.mocked(service.remindCurrentSigner).mockRejectedValueOnce(new Error('smtp down'));
    const res = await sendSigningReminders(NOW, 3);
    expect(res.reminded).toBe(1); // second still processed
    expect(service.remindCurrentSigner).toHaveBeenCalledTimes(2);
  });
});
