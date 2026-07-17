import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mockPoolQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockPoolConnect = vi.fn();

vi.mock('../db/index', () => ({
  pool: {
    query: (...args: unknown[]) => mockPoolQuery(...args),
    connect: (...args: unknown[]) => mockPoolConnect(...args),
  },
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function extractSqlText(sqlOrString: unknown): string {
  if (typeof sqlOrString === 'string') return sqlOrString;
  const chunks = (sqlOrString as { queryChunks?: unknown[] })?.queryChunks ?? [];
  return chunks
    .map((c) => {
      if (typeof c === 'string') return c;
      const value = (c as { value?: unknown[] })?.value;
      return Array.isArray(value) ? value.join('') : '';
    })
    .join(' ');
}

describe('withWizmatchSourceLock (H11 — advisory lock)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockPoolConnect.mockResolvedValue({ query: mockClientQuery, release: mockClientRelease });
  });

  it('runs the callback and returns its result when the lock is acquired', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ locked: true }] }) // pg_try_advisory_lock
      .mockResolvedValueOnce({ rows: [] }); // pg_advisory_unlock
    const { withWizmatchSourceLock } = await import('../services/wizmatchSourcing');

    const result = await withWizmatchSourceLock('tenant-1', 'poc_discovery', async () => 'done');

    expect(result).toBe('done');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    // Unlock must be called even on the success path.
    expect(mockClientQuery).toHaveBeenCalledTimes(2);
  });

  it('returns null without running the callback when the lock is already held', async () => {
    mockClientQuery.mockResolvedValueOnce({ rows: [{ locked: false }] });
    const { withWizmatchSourceLock } = await import('../services/wizmatchSourcing');
    const run = vi.fn().mockResolvedValue('should not run');

    const result = await withWizmatchSourceLock('tenant-1', 'poc_discovery', run);

    expect(result).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it('still releases the client and unlocks when the callback throws', async () => {
    mockClientQuery
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValueOnce({ rows: [] });
    const { withWizmatchSourceLock } = await import('../services/wizmatchSourcing');

    await expect(
      withWizmatchSourceLock('tenant-1', 'poc_discovery', async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    expect(mockClientQuery).toHaveBeenCalledTimes(2); // lock + unlock, even though run() threw
  });
});

describe('discoverFreePocsForSignal — busy-lock error surface (H11)', () => {
  const originalEnv = process.env.WIZMATCH_POC_DISCOVERY_ENABLED;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.WIZMATCH_POC_DISCOVERY_ENABLED = 'true';
    mockPoolConnect.mockResolvedValue({ query: mockClientQuery, release: mockClientRelease });
  });

  afterEach(() => {
    process.env.WIZMATCH_POC_DISCOVERY_ENABLED = originalEnv;
  });

  it('throws a retryable poc_discovery_busy error when a concurrent request already holds the lock for this tenant', async () => {
    mockClientQuery.mockResolvedValue({ rows: [{ locked: false }] }); // every attempt in this test finds the lock busy
    const { discoverFreePocsForSignal, describePocDiscoveryFailure } = await import('../services/wizmatchSourcing');

    await expect(discoverFreePocsForSignal('tenant-1', 'signal-1', 'user-1')).rejects.toThrow(
      /already running for this tenant/,
    );

    // pool.query (the signal lookup inside the locked function body) must
    // NEVER be reached — the lock check short-circuits before any of that
    // work starts.
    expect(mockPoolQuery).not.toHaveBeenCalled();

    // Also confirm this new error maps to a retryable, well-formed API shape.
    try {
      await discoverFreePocsForSignal('tenant-1', 'signal-1', 'user-1');
    } catch (error) {
      const described = describePocDiscoveryFailure(error);
      expect(described.retryable).toBe(true);
      expect(described.code).toBe('poc_discovery_busy');
    }
  });
});

describe('recoverStaleWizmatchSourceRuns (H11 — stale running cleanup)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('flips stale running rows to failed with quota_consumed >= 1', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [{ id: 'run-1' }, { id: 'run-2' }], rowCount: 2 });
    const { recoverStaleWizmatchSourceRuns } = await import('../services/wizmatchSourcing');

    const count = await recoverStaleWizmatchSourceRuns();

    expect(count).toBe(2);
    const [sql, params] = mockPoolQuery.mock.calls[0];
    const text = extractSqlText(sql).toUpperCase();
    expect(text).toContain('SET STATUS=\'FAILED\'');
    expect(text).toContain('GREATEST(QUOTA_CONSUMED,1)');
    expect(text).toContain("WHERE STATUS='RUNNING'");
    // A cutoff timestamp must be passed as a bound parameter.
    expect(params[0]).toBeInstanceOf(Date);
  });

  it('returns 0 when nothing is stale', async () => {
    mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    const { recoverStaleWizmatchSourceRuns } = await import('../services/wizmatchSourcing');
    expect(await recoverStaleWizmatchSourceRuns()).toBe(0);
  });
});
