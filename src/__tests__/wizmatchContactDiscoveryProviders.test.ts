import { afterEach, describe, expect, it, vi } from 'vitest';

const resolveMx = vi.fn(async (_domain: string) => [] as Array<{ exchange: string; priority: number }>);

vi.mock('dns', () => ({
  promises: {
    resolveMx: (domain: string) => resolveMx(domain),
    resolveTxt: vi.fn(async () => []),
  },
}));

import { classifyMxProvider, detectCatchAll } from '../services/wizmatchContactDiscoveryProviders';

describe('classifyMxProvider', () => {
  afterEach(() => {
    resolveMx.mockReset();
    resolveMx.mockResolvedValue([]);
  });

  it('detects Google Workspace domains', async () => {
    resolveMx.mockResolvedValue([{ exchange: 'aspmx.l.google.com', priority: 1 }]);
    expect(await classifyMxProvider('acme.in')).toBe('google');
  });

  it('detects Microsoft 365 domains', async () => {
    resolveMx.mockResolvedValue([{ exchange: 'acme-in.mail.protection.outlook.com', priority: 0 }]);
    expect(await classifyMxProvider('acme.in')).toBe('microsoft');
  });

  it('classifies self-hosted/other domains as other', async () => {
    resolveMx.mockResolvedValue([{ exchange: 'mail.acme.in', priority: 10 }]);
    expect(await classifyMxProvider('acme.in')).toBe('other');
  });

  it('returns none when the domain has no MX records', async () => {
    resolveMx.mockResolvedValue([]);
    expect(await classifyMxProvider('acme.in')).toBe('none');
  });
});

describe('detectCatchAll', () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns null when Reacher is not configured', async () => {
    delete process.env.REACHER_BASE_URL;
    const reacher = vi.fn(async () => 'verified' as const);
    expect(await detectCatchAll('acme.in', reacher)).toBeNull();
    expect(reacher).not.toHaveBeenCalled();
  });

  it('flags catch-all when a random non-existent address verifies as deliverable', async () => {
    process.env.REACHER_BASE_URL = 'https://reacher.example';
    const reacher = vi.fn(async () => 'verified' as const);
    expect(await detectCatchAll('acme.in', reacher)).toBe(true);
    expect(reacher).toHaveBeenCalledTimes(1);
  });

  it('returns false when a random address is rejected (not catch-all)', async () => {
    process.env.REACHER_BASE_URL = 'https://reacher.example';
    const reacher = vi.fn(async () => 'invalid' as const);
    expect(await detectCatchAll('acme.in', reacher)).toBe(false);
  });

  it('returns null (undetermined) when Reacher cannot tell', async () => {
    process.env.REACHER_BASE_URL = 'https://reacher.example';
    const reacher = vi.fn(async () => 'unknown' as const);
    expect(await detectCatchAll('acme.in', reacher)).toBeNull();
  });
});
