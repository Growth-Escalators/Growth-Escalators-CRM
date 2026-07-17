import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mockCreateSourceRun = vi.fn();
const mockFinishSourceRun = vi.fn();
const mockGetWizmatchSourcingConfig = vi.fn();
const mockAssertSearchApiAllowance = vi.fn();
const mockGetSearchApiRunUsage = vi.fn();
const mockSearchPublicWeb = vi.fn();
const mockFindOrCreateContact = vi.fn();
const mockPoolQuery = vi.fn();
const mockDbInsertValues = vi.fn();

vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args) },
  db: {
    insert: () => ({
      values: (...args: unknown[]) => {
        mockDbInsertValues(...args);
        return { onConflictDoNothing: vi.fn().mockResolvedValue(undefined) };
      },
    }),
  },
}));

vi.mock('../db/schema', () => ({ wizmatchCandidates: {} }));

vi.mock('../config/constants', () => ({ WIZMATCH_INDIA_ONLY: true }));

vi.mock('./contactService', () => ({
  findOrCreateContact: (...args: unknown[]) => mockFindOrCreateContact(...args),
}));

vi.mock('../services/contactService', () => ({
  findOrCreateContact: (...args: unknown[]) => mockFindOrCreateContact(...args),
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('./wizmatchSourcing', () => ({
  createSourceRun: (...args: unknown[]) => mockCreateSourceRun(...args),
  finishSourceRun: (...args: unknown[]) => mockFinishSourceRun(...args),
  getWizmatchSourcingConfig: (...args: unknown[]) => mockGetWizmatchSourcingConfig(...args),
}));

vi.mock('../services/wizmatchSourcing', () => ({
  createSourceRun: (...args: unknown[]) => mockCreateSourceRun(...args),
  finishSourceRun: (...args: unknown[]) => mockFinishSourceRun(...args),
  getWizmatchSourcingConfig: (...args: unknown[]) => mockGetWizmatchSourcingConfig(...args),
}));

vi.mock('./wizmatchSearchApi', () => ({
  assertSearchApiAllowance: (...args: unknown[]) => mockAssertSearchApiAllowance(...args),
  getSearchApiRunUsage: (...args: unknown[]) => mockGetSearchApiRunUsage(...args),
  searchPublicWeb: (...args: unknown[]) => mockSearchPublicWeb(...args),
}));

vi.mock('../services/wizmatchSearchApi', () => ({
  assertSearchApiAllowance: (...args: unknown[]) => mockAssertSearchApiAllowance(...args),
  getSearchApiRunUsage: (...args: unknown[]) => mockGetSearchApiRunUsage(...args),
  searchPublicWeb: (...args: unknown[]) => mockSearchPublicWeb(...args),
}));

describe('runXrayScrape — cost cap correctness (H10/H11)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.WIZMATCH_TENANT_ID = 'tenant-1';
    process.env.SEARCHAPI_API_KEY = 'test-key';
    mockGetWizmatchSourcingConfig.mockReturnValue({ searchApiDailyCap: 5, searchApiMonthlyCap: 80 });
    mockGetSearchApiRunUsage.mockResolvedValue({ daily: 0, monthly: 0 });
    mockCreateSourceRun.mockResolvedValue({ id: 'run-1' });
    mockFinishSourceRun.mockResolvedValue(undefined);
    mockSearchPublicWeb.mockResolvedValue([]);
    mockPoolQuery.mockResolvedValue({ rows: [] });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('H10: creates a source_run for the daily cron path (no requirementId) — previously recorded nothing at all', async () => {
    const { runXrayScrape } = await import('../services/wizmatchXrayScraper');
    await runXrayScrape(3); // exactly how worker.ts's cron calls this — no context arg

    expect(mockCreateSourceRun).toHaveBeenCalledTimes(1);
    const call = mockCreateSourceRun.mock.calls[0][0];
    expect(call.provider).toBe('xray');
    expect(call.trigger).toBe('scheduled');
    expect(call.requirementId).toBeNull();
    expect(mockFinishSourceRun).toHaveBeenCalledTimes(1);
    expect(mockFinishSourceRun.mock.calls[0][0]).toBe('run-1');
  });

  it('H10: checks the SearchAPI allowance upfront and skips entirely when exceeded — previously the cron never checked at all', async () => {
    mockAssertSearchApiAllowance.mockImplementation(() => {
      throw new Error('Daily SearchAPI allowance reached');
    });
    const { runXrayScrape } = await import('../services/wizmatchXrayScraper');
    const result = await runXrayScrape(3);

    expect(result).toEqual({ queries_run: 0, candidates_found: 0, candidates_created: 0, skipped_exists: 0, errors: 0 });
    // No source_run created and no search attempted once the cap check fails.
    expect(mockCreateSourceRun).not.toHaveBeenCalled();
    expect(mockSearchPublicWeb).not.toHaveBeenCalled();
  });

  it('marks the trigger as "manual" for an adhoc (recruiter-triggered) query', async () => {
    mockSearchPublicWeb.mockResolvedValue([]);
    const { runXrayScrape } = await import('../services/wizmatchXrayScraper');
    await runXrayScrape(1, { skill: 'java', location: 'Pune' }, { requirementId: 'req-1', requestedBy: 'user-1' });

    const call = mockCreateSourceRun.mock.calls[0][0];
    expect(call.trigger).toBe('manual');
    expect(call.requirementId).toBe('req-1');
  });
});
