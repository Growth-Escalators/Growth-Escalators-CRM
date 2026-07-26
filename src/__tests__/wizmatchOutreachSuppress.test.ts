import { describe, it, expect, vi, beforeEach } from 'vitest';

// PRD-005 §8.10.1 rows 25-29 — suppress() is the sole write path for the
// email/channel suppression grain: it must lowercase the address and write
// both the effective-state row (wizmatch_suppression_list) and the
// append-only audit row (wizmatch_suppression_events).

const inserts: Array<{ table: string; values: any }> = [];

vi.mock('../db', async () => {
  const actualSchema = await vi.importActual<typeof import('../db/schema')>('../db/schema');
  return {
    ...actualSchema,
    db: {
      insert: (table: unknown) => ({
        values: (values: unknown) => {
          const name = table === actualSchema.wizmatchSuppressionList ? 'wizmatch_suppression_list' : table === actualSchema.wizmatchSuppressionEvents ? 'wizmatch_suppression_events' : 'unknown';
          inserts.push({ table: name, values });
          return { onConflictDoNothing: vi.fn(async () => undefined) };
        },
      }),
    },
  };
});

import { suppress } from '../modules/outreach/outreachGate';

beforeEach(() => {
  inserts.length = 0;
});

describe('suppress()', () => {
  it('lowercases the email on both the list row and the event row', async () => {
    await suppress({ tenantId: 't1', email: '  Jane.Doe@Example.COM  ', reason: 'hard_bounce', source: 'test' });
    const listRow = inserts.find((i) => i.table === 'wizmatch_suppression_list');
    const eventRow = inserts.find((i) => i.table === 'wizmatch_suppression_events');
    expect(listRow?.values.email).toBe('jane.doe@example.com');
    expect(eventRow?.values.email).toBe('jane.doe@example.com');
  });

  it('maps hard_bounce to the email_hard_bounce reason code on the event row', async () => {
    await suppress({ tenantId: 't1', email: 'x@example.com', reason: 'hard_bounce', source: 'test' });
    const eventRow = inserts.find((i) => i.table === 'wizmatch_suppression_events');
    expect(eventRow?.values.reasonCode).toBe('email_hard_bounce');
    expect(eventRow?.values.grain).toBe('email');
  });

  it('writes both rows exactly once per call', async () => {
    await suppress({ tenantId: 't1', email: 'x@example.com', reason: 'unsubscribe', source: 'test' });
    expect(inserts).toHaveLength(2);
  });
});
