import { describe, it, expect } from 'vitest';
import { runWithRequestContext, getRequestId } from '../utils/requestContext';

describe('requestContext (M6 — requestId propagation to log lines)', () => {
  it('returns undefined outside any request context', () => {
    expect(getRequestId()).toBeUndefined();
  });

  it('exposes the requestId synchronously within the context', () => {
    runWithRequestContext({ requestId: 'req-1' }, () => {
      expect(getRequestId()).toBe('req-1');
    });
  });

  it('exposes the requestId across an await inside the context (async continuation)', async () => {
    await runWithRequestContext({ requestId: 'req-2' }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      expect(getRequestId()).toBe('req-2');
    });
  });

  it('is undefined again after the context exits', async () => {
    await runWithRequestContext({ requestId: 'req-3' }, async () => {
      expect(getRequestId()).toBe('req-3');
    });
    expect(getRequestId()).toBeUndefined();
  });

  it('does not leak between concurrently-running contexts', async () => {
    const results: string[] = [];
    await Promise.all([
      runWithRequestContext({ requestId: 'a' }, async () => {
        await new Promise((r) => setTimeout(r, 10));
        results.push(getRequestId()!);
      }),
      runWithRequestContext({ requestId: 'b' }, async () => {
        await new Promise((r) => setTimeout(r, 1));
        results.push(getRequestId()!);
      }),
    ]);
    expect(results.sort()).toEqual(['a', 'b']);
  });

  it('nested contexts shadow the outer one and restore it on exit', () => {
    runWithRequestContext({ requestId: 'outer' }, () => {
      expect(getRequestId()).toBe('outer');
      runWithRequestContext({ requestId: 'inner' }, () => {
        expect(getRequestId()).toBe('inner');
      });
      expect(getRequestId()).toBe('outer');
    });
  });
});
