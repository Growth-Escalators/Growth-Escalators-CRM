import { describe, it, expect, vi, beforeEach } from 'vitest';

// PRD-005 §8.10.1 rows 25-29 — suppress() is the sole write path for the
// email/channel suppression grain: it must lowercase the address and write
// both the effective-state row (wizmatch_suppression_list) and the
// append-only audit row (wizmatch_suppression_events).

const inserts: Array<{ table: string; values: any }> = [];
const state = { transactionCalls: 0, failOn: null as string | null };

vi.mock('../db', async () => {
  const actualSchema = await vi.importActual<typeof import('../db/schema')>('../db/schema');
  const makeInsert = () => (table: unknown) => ({
    values: (values: unknown) => {
      const name = table === actualSchema.wizmatchSuppressionList
        ? 'wizmatch_suppression_list'
        : table === actualSchema.wizmatchSuppressionEvents
          ? 'wizmatch_suppression_events'
          : 'unknown';
      if (state.failOn === name) throw new Error(`simulated failure inserting ${name}`);
      inserts.push({ table: name, values });
      return { onConflictDoNothing: vi.fn(async () => undefined) };
    },
  });
  return {
    ...actualSchema,
    db: {
      insert: makeInsert(),
      // Both writes must happen inside ONE transaction (§8.10 rule 4). The mock
      // discards everything written by a callback that throws, mirroring a real
      // ROLLBACK, so a non-transactional implementation is detectable.
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        state.transactionCalls++;
        const before = inserts.length;
        try {
          return await fn({ insert: makeInsert() });
        } catch (err) {
          inserts.length = before;
          throw err;
        }
      },
    },
  };
});

import { suppress, isStatedContactPreference } from '../modules/outreach/outreachGate';

beforeEach(() => {
  inserts.length = 0;
  state.transactionCalls = 0;
  state.failOn = null;
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

  // §8.10 rule 4 — routing every caller through suppress() is what makes the
  // append-only event "guaranteed rather than remembered". Two autocommitted
  // statements only make it usual: if the second fails, the effective-state row
  // is left live with no audit history.
  it('performs both writes inside one transaction', async () => {
    await suppress({ tenantId: 't1', email: 'x@example.com', reason: 'unsubscribe', source: 'test' });
    expect(state.transactionCalls).toBe(1);
  });

  it('rolls the suppression-list row back when the audit-event write fails', async () => {
    state.failOn = 'wizmatch_suppression_events';
    await expect(
      suppress({ tenantId: 't1', email: 'x@example.com', reason: 'hard_bounce', source: 'test' }),
    ).rejects.toThrow(/wizmatch_suppression_events/);
    // Neither row survives — no suppression without its audit trail.
    expect(inserts).toHaveLength(0);
  });
});

// §8.4 / §8.5 — three grains, three homes. A channel-quality fact must never be
// promoted to a stated personal preference.
describe('isStatedContactPreference() — suppression grain separation', () => {
  it('treats a stated preference as contact-grain', () => {
    expect(isStatedContactPreference('unsubscribe')).toBe(true);
    expect(isStatedContactPreference('do_not_contact')).toBe(true);
    expect(isStatedContactPreference('manual')).toBe(true);
  });

  it('never treats a hard bounce or spam complaint as contact-grain', () => {
    // A dead mailbox says nothing about whether the person wants to be reached
    // on their other channels — flipping contacts.do_not_contact for it is the
    // grain collapse §8.4 forbids.
    expect(isStatedContactPreference('hard_bounce')).toBe(false);
    expect(isStatedContactPreference('complaint')).toBe(false);
  });
});
