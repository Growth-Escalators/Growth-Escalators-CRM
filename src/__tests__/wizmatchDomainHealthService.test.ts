import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/index', () => ({
  pool: { query: vi.fn() },
}));

vi.mock('../services/slackService', () => ({
  sendSlackMessage: vi.fn().mockResolvedValue(true),
}));

vi.mock('../config/constants', () => ({
  WIZMATCH_SYSTEM_CHANNEL: 'C_SYSTEM_TEST',
}));

import {
  runWizmatchDomainHealthCheck,
} from '../services/wizmatchDomainHealthService';

function createPool(overrides: {
  domains?: Array<{ id: string; domain: string }>;
  sends?: number;
  replies?: number;
  recentAlert?: boolean;
} = {}) {
  const domains = overrides.domains ?? [{ id: 'domain-1', domain: 'alpha.example' }];
  const sends = overrides.sends ?? 25;
  const replies = overrides.replies ?? 0;
  const recentAlert = overrides.recentAlert ?? false;

  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes('SELECT id, domain FROM wizmatch_domain_health')) {
      return { rows: domains };
    }
    if (sql.includes('COUNT(*) FILTER')) {
      return { rows: [{ sends, replies }] };
    }
    if (sql.includes('UPDATE wizmatch_domain_health')) {
      return { rows: [], rowCount: 1 };
    }
    if (sql.includes('FROM events') && sql.includes('event_type')) {
      return { rows: recentAlert ? [{ id: 'existing-alert' }] : [] };
    }
    if (sql.includes('SELECT name, slug FROM tenants')) {
      return { rows: [{ name: 'Wizmatch', slug: 'wizmatch' }] };
    }
    if (sql.includes('INSERT INTO events')) {
      return { rows: [], rowCount: 1 };
    }
    throw new Error(`Unexpected query: ${sql} ${JSON.stringify(params)}`);
  });

  return { query };
}

function updateStatuses(query: ReturnType<typeof vi.fn>) {
  return query.mock.calls
    .filter(([sql]) => String(sql).includes('UPDATE wizmatch_domain_health'))
    .map(([, params]) => (params as unknown[])[6]);
}

describe('runWizmatchDomainHealthCheck', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('posts one actionable Slack alert when all configured domains are degraded', async () => {
    const pool = createPool({
      domains: [
        { id: 'domain-1', domain: 'alpha.example' },
        { id: 'domain-2', domain: 'beta.example' },
      ],
      sends: 25,
      replies: 0,
      recentAlert: false,
    });
    const resolveTxt = vi.fn(async () => []);
    const sendSlackMessage = vi.fn(async () => true);

    const result = await runWizmatchDomainHealthCheck('tenant-1', {
      pool,
      resolveTxt,
      sendSlackMessage,
      systemChannel: 'C_SYSTEM_TEST',
    });

    expect(result).toMatchObject({
      checked: 2,
      healthy: 0,
      warn: 2,
      alertSent: true,
      alertThrottled: false,
    });
    expect(sendSlackMessage).toHaveBeenCalledOnce();
    const [channel, text] = sendSlackMessage.mock.calls[0] as unknown as [string, string];
    expect(channel).toBe('C_SYSTEM_TEST');
    expect(text).toContain('Tenant: Wizmatch (wizmatch)');
    expect(text).toContain('alpha.example: SPF fail, DMARC fail, low reply rate');
    expect(text).toContain('fallback-to-all inbox behavior');

    expect(updateStatuses(pool.query)).toEqual(['warn', 'warn']);
    expect(updateStatuses(pool.query).every((status) => status === 'warn' || status === 'healthy')).toBe(true);
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO events'))).toBe(true);
  });

  it('throttles repeat all-degraded alerts when a marker event exists in the last 24 hours', async () => {
    const pool = createPool({ recentAlert: true });
    const sendSlackMessage = vi.fn(async () => true);

    const result = await runWizmatchDomainHealthCheck('tenant-1', {
      pool,
      resolveTxt: vi.fn(async () => []),
      sendSlackMessage,
      systemChannel: 'C_SYSTEM_TEST',
    });

    expect(result.alertSent).toBe(false);
    expect(result.alertThrottled).toBe(true);
    expect(sendSlackMessage).not.toHaveBeenCalled();
    expect(pool.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO events'))).toBe(false);
  });

  it('marks domains healthy when SPF, DMARC, and reply-rate checks pass', async () => {
    const pool = createPool({
      domains: [{ id: 'domain-1', domain: 'healthy.example' }],
      sends: 10,
      replies: 0,
    });
    const resolveTxt = vi.fn(async (hostname: string) => {
      if (hostname.startsWith('_dmarc.')) return [['v=DMARC1; p=none']];
      return [['v=spf1 include:_spf.example ~all']];
    });
    const sendSlackMessage = vi.fn(async () => true);

    const result = await runWizmatchDomainHealthCheck('tenant-1', {
      pool,
      resolveTxt,
      sendSlackMessage,
      systemChannel: 'C_SYSTEM_TEST',
    });

    expect(result.healthy).toBe(1);
    expect(result.warn).toBe(0);
    expect(updateStatuses(pool.query)).toEqual(['healthy']);
    expect(sendSlackMessage).not.toHaveBeenCalled();
  });
});
