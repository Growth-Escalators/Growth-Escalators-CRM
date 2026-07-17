import { describe, it, expect, vi, beforeEach } from 'vitest';

// M25 — daily blocker-alert dedup used to be an in-memory Map, reset on
// every process restart (so a heavy-deploy day re-pinged the same blocker
// after every deploy) and computed "today" via UTC, silently flipping the
// day boundary at 05:30 IST. It's now a read against the `events` table
// (already written by logAlertSent) filtered on the IST calendar date.
// These tests drive checkAndAlertBlockers end-to-end with everything
// external mocked, asserting the dedup read is what gates the Slack send.

function extractSqlText(sqlObj: unknown): string {
  const chunks = (sqlObj as { queryChunks?: unknown[] })?.queryChunks ?? [];
  return chunks
    .map((c) => {
      const value = (c as { value?: unknown })?.value;
      return Array.isArray(value) ? value.join('') : '';
    })
    .join('');
}

let dedupHasRow = false;
const mockDbExecute = vi.fn(async (sqlObj: unknown) => {
  const text = extractSqlText(sqlObj);
  if (text.includes('FROM tenants')) return { rows: [{ id: 'tenant-1' }] };
  if (text.includes('blocker_alert_sent')) return { rows: dedupHasRow ? [{ exists: 1 }] : [] };
  return { rows: [] };
});

const mockInsertValues = vi.fn().mockResolvedValue(undefined);
const mockPoolQuery = vi.fn();

vi.mock('../db/index', () => ({
  db: {
    execute: (sqlObj: unknown) => mockDbExecute(sqlObj),
    insert: () => ({ values: (...args: unknown[]) => mockInsertValues(...args) }),
  },
  events: {},
  pool: { query: (...args: unknown[]) => mockPoolQuery(...args) },
}));

const mockSendSlackMessage = vi.fn().mockResolvedValue(undefined);
const mockSendSlackDM = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/slackService', () => ({
  sendSlackMessage: (...args: unknown[]) => mockSendSlackMessage(...args),
  sendSlackDM: (...args: unknown[]) => mockSendSlackDM(...args),
}));

import { checkAndAlertBlockers } from '../services/blockerAlertService';

const ONE_OVERDUE_TASK_ROW = {
  id: 'task-1',
  title: 'Ship the thing',
  due_at: new Date(Date.now() - 3 * 86400_000),
  days_overdue: 3, // >= BLOCKER_THRESHOLD_DAYS (2), < CRITICAL_THRESHOLD_DAYS (5)
};

function setupSingleOverdueTaskForJatin() {
  mockPoolQuery.mockImplementation(async (queryText: string, params?: unknown[]) => {
    if (queryText.includes('FROM users WHERE email')) {
      const email = (params as string[])[0];
      return email === 'jatin@growthescalators.com' ? { rows: [{ id: 'user-jatin' }] } : { rows: [] };
    }
    if (queryText.includes('FROM tasks')) {
      return { rows: [ONE_OVERDUE_TASK_ROW] };
    }
    return { rows: [] };
  });
}

describe('checkAndAlertBlockers — IST-persisted dedup (M25)', () => {
  beforeEach(() => {
    mockDbExecute.mockClear();
    mockInsertValues.mockClear();
    mockPoolQuery.mockReset();
    mockSendSlackMessage.mockClear();
    mockSendSlackDM.mockClear();
    dedupHasRow = false;
    setupSingleOverdueTaskForJatin();
  });

  it('skips a task already alerted today — no Slack message, no re-log', async () => {
    dedupHasRow = true;

    const result = await checkAndAlertBlockers();

    expect(mockSendSlackMessage).not.toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
    expect(result).toMatchObject({ checked: 1, alerted: 0, skipped: 1 });
  });

  it('alerts and logs a task not yet alerted today', async () => {
    dedupHasRow = false;

    const result = await checkAndAlertBlockers();

    expect(mockSendSlackMessage).toHaveBeenCalledTimes(1);
    expect(mockInsertValues).toHaveBeenCalledTimes(1);
    expect(mockInsertValues.mock.calls[0][0]).toMatchObject({
      eventType: 'blocker_alert_sent',
      payload: expect.objectContaining({ taskId: 'task-1' }),
    });
    expect(result).toMatchObject({ checked: 1, alerted: 1, skipped: 0 });
  }, 10000);

  it('fails open (still alerts) if the dedup read itself throws', async () => {
    // getTenantId's result is cached module-wide after the first test, so this
    // may or may not re-query "FROM tenants" — handle both, and throw only for
    // the dedup query itself.
    mockDbExecute.mockImplementation(async (sqlObj: unknown) => {
      const text = extractSqlText(sqlObj);
      if (text.includes('FROM tenants')) return { rows: [{ id: 'tenant-1' }] };
      if (text.includes('blocker_alert_sent')) throw new Error('db blip');
      return { rows: [] };
    });

    const result = await checkAndAlertBlockers();

    expect(mockSendSlackMessage).toHaveBeenCalledTimes(1);
    expect(result.alerted).toBe(1);
  }, 10000);
});
