import { describe, it, expect, vi } from 'vitest';
import { runMigrationsWithLock } from '../scripts/migrate';

// M13 hotfix — production incident 2026-07-17: two consecutive Railway
// deploys hung silently right after "[migrate] Migration complete" for
// 5-8 minutes each, until the healthcheck killed the container. Root cause:
// migrate.ts called `await pool.end()` BEFORE its own `finally` block
// released the advisory-lock client (lockClient) back to the pool.
// pool.end() waits for every checked-out client to return before it
// resolves — a real pg.Pool would never resolve that await, so
// process.exit() never ran either.
//
// This models that exact "wait for all clients released" semantic with a
// fake pool (not just spying on call order) so a future refactor that
// reintroduces the deadlock fails this test rather than only being caught
// live in production again.

function makeFakePool() {
  let outstanding = 0;
  let resolveEnd: (() => void) | null = null;
  const endPromise = new Promise<void>((resolve) => { resolveEnd = resolve; });

  const client = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(() => {
      outstanding -= 1;
      if (outstanding === 0) resolveEnd?.();
    }),
  };

  const pool = {
    connect: vi.fn(async () => {
      outstanding += 1;
      return client;
    }),
    // Real pg.Pool.end() semantics: doesn't resolve until every checked-out
    // client has called .release(). If outstanding never reaches 0, this
    // promise never resolves — exactly the deadlock this test guards against.
    end: vi.fn(() => endPromise),
  };

  return { pool, client };
}

describe('runMigrationsWithLock (M13 hotfix — pool.end() deadlock)', () => {
  it('releases the lock client before returning, so a subsequent pool.end() resolves', async () => {
    const { pool, client } = makeFakePool();

    await runMigrationsWithLock(pool as any, 123, async () => { /* migration succeeds */ });

    expect(client.release).toHaveBeenCalledTimes(1);

    // The regression scenario: caller now does what migrate.ts's main() does.
    // With the client already released, pool.end() must resolve promptly —
    // this expectation itself would hang/timeout under the old buggy code
    // where pool.end() was called before the client was released.
    await expect(pool.end()).resolves.toBeUndefined();
  });

  it('still releases the lock client (and unlocks) when the migration throws', async () => {
    const { pool, client } = makeFakePool();

    await expect(
      runMigrationsWithLock(pool as any, 123, async () => { throw new Error('bad migration'); }),
    ).rejects.toThrow('bad migration');

    expect(client.release).toHaveBeenCalledTimes(1);
    await expect(pool.end()).resolves.toBeUndefined();
  });

  it('sends the advisory unlock for the same key it locked, before releasing', async () => {
    const { pool, client } = makeFakePool();

    await runMigrationsWithLock(pool as any, 999, async () => {});

    const calls = client.query.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(calls[0]).toMatch(/pg_advisory_lock/);
    expect(calls[1]).toMatch(/pg_advisory_unlock/);
    expect(client.query.mock.calls[0][1]).toEqual([999]);
    expect(client.query.mock.calls[1][1]).toEqual([999]);
  });

  it('does not throw if the unlock query itself fails — release still happens', async () => {
    const { pool, client } = makeFakePool();
    client.query.mockImplementation((sql: string) => {
      if (sql.includes('unlock')) return Promise.reject(new Error('connection reset'));
      return Promise.resolve({ rows: [] });
    });

    await runMigrationsWithLock(pool as any, 1, async () => {});

    expect(client.release).toHaveBeenCalledTimes(1);
    await expect(pool.end()).resolves.toBeUndefined();
  });
});
