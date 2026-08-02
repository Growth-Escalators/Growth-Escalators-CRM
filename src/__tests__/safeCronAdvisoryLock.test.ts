import { describe, expect, it, vi, beforeAll, beforeEach, afterAll } from 'vitest';

/**
 * safeCron() advisory-lock session binding.
 *
 * Postgres advisory locks are SESSION-scoped. safeCron used to acquire with
 * `pool.query(pg_try_advisory_lock)` and release with
 * `pool.query(pg_advisory_unlock)` — two arbitrary connections out of a pool of
 * 20. When they differed, the unlock returned false without erroring, the lock
 * stayed held, and (because `min: 2` connections are never reaped) every later
 * fire of that cron hit "another instance holds the lock, skipping" and
 * returned before running the job — silently, forever.
 *
 * These tests pin the acquire and the release to ONE client. Each call to
 * pool.connect() deliberately hands back a DIFFERENT object so "same client"
 * is a real assertion, not an accident.
 */

type FakeClient = {
  id: number;
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
};

const mockPoolQuery = vi.fn();
const mockPoolConnect = vi.fn();
let issuedClients: FakeClient[] = [];
let nextClientId = 0;

function newClient(): FakeClient {
  const client: FakeClient = { id: ++nextClientId, query: vi.fn(), release: vi.fn() };
  // Happy-path default: this session gets the lock, and gives it back.
  client.query.mockResolvedValue({ rows: [{ acquired: true, released: true }], rowCount: 1 });
  issuedClients.push(client);
  return client;
}

vi.mock('../db/index', () => ({
  pool: {
    query: (...args: unknown[]) => mockPoolQuery(...args),
    connect: (...args: unknown[]) => mockPoolConnect(...args),
    end: vi.fn(),
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
    on: vi.fn(),
  },
  db: {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn().mockResolvedValue([]) })) })),
  },
  getPoolStats: () => ({ total: 0, idle: 0, waiting: 0 }),
}));

// node-cron registration is a module-level side effect of importing worker.ts.
// Neutralise it — we only want safeCron itself.
vi.mock('node-cron', () => ({
  default: { schedule: vi.fn(), validate: vi.fn(() => true) },
  schedule: vi.fn(),
  validate: vi.fn(() => true),
}));

// safeCron dynamically imports these on every run.
vi.mock('../services/systemHealthMonitor', () => ({
  logCronStart: vi.fn(async () => 0),
  logCronSuccess: vi.fn(async () => undefined),
  logCronPartial: vi.fn(async () => undefined),
  logCronFailure: vi.fn(async () => undefined),
  checkAllSystems: vi.fn(async () => ({ overallScore: 100 })),
  sendCriticalAlerts: vi.fn(async () => undefined),
}));
vi.mock('../services/slackService', () => ({
  sendSlackDM: vi.fn(async () => undefined),
  sendSlackMessage: vi.fn(async () => undefined),
}));

function sqlOf(call: unknown[] | undefined): string {
  return typeof call?.[0] === 'string' ? (call[0] as string) : '';
}

/** All SQL statements pool.query() (the shared, arbitrary-connection path) saw. */
function poolSql(): string[] {
  return mockPoolQuery.mock.calls.map((c) => sqlOf(c));
}

let safeCron: (name: string, fn: () => Promise<unknown>, useAdvisoryLock?: boolean) => Promise<void>;
let stopBackgroundJobs: () => Promise<void>;

beforeAll(async () => {
  // Module-level bootstrap in worker.ts issues a few pool.query() calls.
  mockPoolQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  mockPoolConnect.mockImplementation(async () => newClient());
  const mod = await import('../worker');
  safeCron = mod.safeCron;
  stopBackgroundJobs = mod.stopBackgroundJobs;
});

afterAll(async () => {
  // worker.ts registers setInterval timers at import; clear them so vitest exits.
  await stopBackgroundJobs();
});

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockPoolConnect.mockReset();
  issuedClients = [];
  // Deliberately NOT an advisory-lock-aware response: if anything still routes
  // the lock through pool.query(), it reads `acquired: true` from the wrong
  // session and the assertions below catch it.
  mockPoolQuery.mockResolvedValue({ rows: [{ acquired: true, released: true }], rowCount: 1 });
  mockPoolConnect.mockImplementation(async () => newClient());
});

// Unique cron name per test — safeCron keys its in-process overlap map by name.
let nameSeq = 0;
const uniqueName = (label: string) => `test-${label}-${++nameSeq}`;

describe('safeCron advisory lock — session binding', () => {
  it('acquires and releases the lock on the SAME dedicated client', async () => {
    const name = uniqueName('same-client');
    const fn = vi.fn(async () => 'ok');

    await safeCron(name, fn);

    // Exactly one connection was checked out for the whole run.
    expect(mockPoolConnect).toHaveBeenCalledTimes(1);
    expect(issuedClients).toHaveLength(1);
    const client = issuedClients[0];

    expect(fn).toHaveBeenCalledTimes(1);

    // Both the acquire and the release landed on that one client object.
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(sqlOf(client.query.mock.calls[0])).toContain('pg_try_advisory_lock');
    expect(sqlOf(client.query.mock.calls[1])).toContain('pg_advisory_unlock');

    // Same lock key on both sides.
    expect(client.query.mock.calls[0][1]).toEqual(client.query.mock.calls[1][1]);

    // And nothing advisory-lock-shaped went through the shared pool.
    expect(poolSql().filter((s) => s.includes('advisory'))).toEqual([]);

    // Normal path: connection goes back to the pool intact (no error arg).
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(undefined);
  });

  it('releases the lock on the same client when fn() throws', async () => {
    const name = uniqueName('fn-throws');
    const fn = vi.fn(async () => { throw new Error('job blew up'); });

    // safeCron catches job errors itself.
    await expect(safeCron(name, fn)).resolves.toBeUndefined();

    expect(mockPoolConnect).toHaveBeenCalledTimes(1);
    const client = issuedClients[0];
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(sqlOf(client.query.mock.calls[1])).toContain('pg_advisory_unlock');
    expect(poolSql().filter((s) => s.includes('advisory'))).toEqual([]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('does not run fn() when the lock is held elsewhere, and returns the client', async () => {
    const name = uniqueName('lock-busy');
    const fn = vi.fn(async () => 'should not run');
    mockPoolConnect.mockImplementationOnce(async () => {
      const client = newClient();
      client.query.mockResolvedValueOnce({ rows: [{ acquired: false }] });
      return client;
    });

    await safeCron(name, fn);

    expect(fn).not.toHaveBeenCalled();
    const client = issuedClients[0];
    // Only the acquire ran — no unlock, because we never held the lock.
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(sqlOf(client.query.mock.calls[0])).toContain('pg_try_advisory_lock');
    // The connection must still go back to the pool — otherwise every skipped
    // cron fire leaks one of the 20 pool slots.
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith();
  });

  it('destroys the connection when pg_advisory_unlock throws, so the session (and its lock) dies', async () => {
    const name = uniqueName('unlock-throws');
    const unlockError = new Error('connection terminated unexpectedly');
    mockPoolConnect.mockImplementationOnce(async () => {
      const client = newClient();
      client.query
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockRejectedValueOnce(unlockError);
      return client;
    });

    await safeCron(name, vi.fn(async () => 'ok'));

    const client = issuedClients[0];
    expect(client.query).toHaveBeenCalledTimes(2);
    // release(err) => pg-pool destroys rather than reuses. A session that may
    // still hold the lock must never re-enter the pool.
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(unlockError);
  });

  it('warns instead of failing silently when pg_advisory_unlock returns false', async () => {
    const name = uniqueName('unlock-false');
    mockPoolConnect.mockImplementationOnce(async () => {
      const client = newClient();
      client.query
        .mockResolvedValueOnce({ rows: [{ acquired: true }] })
        .mockResolvedValueOnce({ rows: [{ released: false }] });
      return client;
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await safeCron(name, vi.fn(async () => 'ok'));

    const warned = warn.mock.calls.map((c) => String(c[0])).join('\n');
    warn.mockRestore();
    expect(warned).toContain('pg_advisory_unlock returned false');
    expect(warned).toContain(name);
  });

  it('still runs the job (without a lock) when the connection cannot be checked out', async () => {
    const name = uniqueName('connect-fails');
    const fn = vi.fn(async () => 'ok');
    mockPoolConnect.mockRejectedValueOnce(new Error('timeout exceeded when trying to connect'));

    await safeCron(name, fn);

    // It must have TRIED to take a dedicated session (this is what fails on the
    // old pool.query() implementation, which never checked one out)…
    expect(mockPoolConnect).toHaveBeenCalledTimes(1);
    expect(issuedClients).toHaveLength(0);
    // …and then failed open: a lock we couldn't take is not a reason to skip
    // the job, matching the previous behaviour.
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // Behaviour-preservation guard for the opt-out path, not a bug repro: this
  // one also passes against the old implementation, by design.
  it('checks out no connection at all when useAdvisoryLock is false', async () => {
    const name = uniqueName('no-lock');
    const fn = vi.fn(async () => 'ok');

    await safeCron(name, fn, false);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockPoolConnect).not.toHaveBeenCalled();
    expect(poolSql().filter((s) => s.includes('advisory'))).toEqual([]);
  });
});
