import { beforeEach, describe, expect, it, vi } from 'vitest';

const { poolQuery } = vi.hoisted(() => ({ poolQuery: vi.fn() }));

vi.mock('../db/index', () => ({
  pool: { query: poolQuery },
  db: {},
  deals: {},
  contacts: {},
  pipelines: {},
}));

vi.mock('../middleware/requirePerm', () => ({
  requirePerm: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../services/salesOutcomeFeedback', () => ({
  sendSalesOutcomeFeedback: vi.fn(),
}));

import dealsRouter from '../routes/deals';

function handler(path: string, method: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const layer = (dealsRouter as any).stack.find((item: any) => item.route?.path === path && item.route?.methods?.[method]);
  if (!layer) throw new Error(`route not found: ${method.toUpperCase()} ${path}`);
  return layer.route.stack.at(-1).handle as (req: any, res: any) => Promise<void>;
}

function response() {
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

describe('GET /deals/pipeline-summary', () => {
  beforeEach(() => {
    poolQuery.mockReset();
  });

  it('returns tenant-scoped active-deal totals in the dashboard shape', async () => {
    poolQuery.mockResolvedValue({
      rows: [
        { stage: 'New Lead', count: 2, total_value: '125000' },
        { stage: 'Proposal', count: 1, total_value: '75000' },
      ],
    });

    const res = response();
    await handler('/pipeline-summary', 'get')(
      { user: { tenantId: 'tenant-123' } },
      res,
    );

    expect(poolQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = poolQuery.mock.calls[0];
    expect(sql).toContain('tenant_id = $1');
    expect(sql).toContain("metadata->>'archived'");
    expect(params).toEqual(['tenant-123']);
    expect(res.json).toHaveBeenCalledWith({
      totalValue: 200000,
      stages: [
        { stage: 'New Lead', count: 2, totalValue: 125000 },
        { stage: 'Proposal', count: 1, totalValue: 75000 },
      ],
    });
  });

  it('is registered before the generic deal-id route', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const paths = (dealsRouter as any).stack
      .filter((item: any) => item.route?.methods?.get)
      .map((item: any) => item.route.path);

    expect(paths.indexOf('/pipeline-summary')).toBeGreaterThanOrEqual(0);
    expect(paths.indexOf('/pipeline-summary')).toBeLessThan(paths.indexOf('/:id'));
  });
});
