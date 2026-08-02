import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// `releaseEnrolment` is the only writer of the `manually_released` terminal
// enrolment state — before it, a prospect replying held their company's
// cold-email lock forever (every reply state is in
// WIZMATCH_LIVE_ENROLMENT_STATES and nothing transitioned off it).
//
// The fake pg client below is deliberately SQL-AWARE: it applies exactly the
// predicates the statement actually contains, so deleting `e.state = ANY(...)`
// or `e.tenant_id = $1` from the service changes the fake's behaviour and fails
// a test here. A fake that ignored the WHERE clause would make the
// compare-and-set untestable — the guard would be assumed, never watched to fail.

interface EnrolmentRow {
  id: string;
  tenant_id: string;
  company_id: string;
  contact_id: string | null;
  batch_id: string;
  state: string;
  released_by_user_id: string | null;
  release_reason: string | null;
  state_at: string | null;
}

const store = vi.hoisted(() => ({
  enrolments: [] as EnrolmentRow[],
  staffingEvents: [] as Array<Record<string, unknown>>,
  auditRows: [] as unknown[][],
  sql: [] as string[],
  updateParams: [] as unknown[][],
  failStaffingEventInsert: false,
}));

/** Applies only the predicates the statement really has — see the file header. */
function matchRows(sql: string, params: unknown[]): EnrolmentRow[] {
  let rows = store.enrolments.slice();

  const tenantParam = sql.match(/(?:e\.)?tenant_id\s*=\s*\$(\d+)/);
  if (tenantParam) rows = rows.filter((r) => r.tenant_id === params[Number(tenantParam[1]) - 1]);

  // Leading-boundary required, or this would match the `id` inside `tenant_id`.
  const idParam = sql.match(/[\s(](?:e\.)?id\s*=\s*\$(\d+)/);
  if (idParam) rows = rows.filter((r) => r.id === params[Number(idParam[1]) - 1]);

  const stateAnyParam = sql.match(/(?:e\.)?state\s*=\s*ANY\(\$(\d+)/);
  if (stateAnyParam) {
    const allowed = params[Number(stateAnyParam[1]) - 1] as string[];
    rows = rows.filter((r) => allowed.includes(r.state));
  } else {
    const stateInLiteral = sql.match(/(?:e\.)?state\s+IN\s*\(([^)]*)\)/i);
    if (stateInLiteral) {
      const allowed = stateInLiteral[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
      rows = rows.filter((r) => allowed.includes(r.state));
    }
  }
  return rows;
}

const client = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    store.sql.push(sql);

    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };

    if (sql.includes('UPDATE wizmatch_outreach_enrolments')) {
      store.updateParams.push(params);
      const matched = matchRows(sql, params);
      const returning = matched.map((row) => {
        const previousState = row.state;
        row.state = 'manually_released';
        row.released_by_user_id = (params[2] as string) ?? null;
        row.release_reason = (params[3] as string) ?? null;
        row.state_at = 'now()';
        return {
          id: row.id,
          company_id: row.company_id,
          contact_id: row.contact_id,
          batch_id: row.batch_id,
          previous_state: previousState,
        };
      });
      return { rows: returning, rowCount: returning.length };
    }

    if (sql.includes('SELECT state FROM wizmatch_outreach_enrolments')) {
      const matched = matchRows(sql, params);
      return { rows: matched.map((r) => ({ state: r.state })), rowCount: matched.length };
    }

    if (sql.includes('INSERT INTO wizmatch_staffing_events')) {
      if (store.failStaffingEventInsert) throw new Error('staffing event insert exploded');
      store.staffingEvents.push({
        tenant_id: params[0],
        actor_user_id: params[1],
        event_type: 'outreach_enrolment.manually_released',
        source_id: params[2],
        company_id: params[3],
        contact_id: params[4],
        payload: JSON.parse(String(params[5])),
      });
      return { rows: [], rowCount: 1 };
    }

    return { rows: [], rowCount: 0 };
  }),
  release: vi.fn(),
};

vi.mock('../db/index', async () => {
  const actualSchema = await vi.importActual<typeof import('../db/schema')>('../db/schema');
  return {
    ...actualSchema,
    db: {},
    pool: {
      connect: vi.fn(async () => client),
      // auditLogger writes here, outside the enrolment transaction (the same
      // shape duplicateService uses); it must never be the thing that fails a release.
      query: vi.fn(async (_sql: string, params: unknown[] = []) => {
        store.auditRows.push(params);
        return { rows: [], rowCount: 1 };
      }),
    },
  };
});

vi.mock('../services/claudeService', () => ({
  callClaude: vi.fn(),
  parseClaudeJSON: vi.fn(),
  CLAUDE_MODELS: { SONNET: 'claude-sonnet-test' },
}));

vi.mock('../config/constants', () => ({
  WIZMATCH_UNSUBSCRIBE_HMAC_SECRET: 'test-secret',
  WIZMATCH_PHYSICAL_ADDRESS: 'Wizmatch LLC, Test Address',
}));

import {
  releaseEnrolment,
  runEnrolmentReleaseActions,
  EnrolmentReleaseValidationError,
} from '../services/wizmatchOutreachService';
import { WIZMATCH_LIVE_ENROLMENT_STATES } from '../config/wizmatchOutreachStates';

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT = '22222222-2222-2222-2222-222222222222';
const ACTOR = { tenantId: TENANT, userId: 'user-1', role: 'admin' };

function enrolment(overrides: Partial<EnrolmentRow> = {}): EnrolmentRow {
  return {
    id: 'enr-1',
    tenant_id: TENANT,
    company_id: 'co-1',
    contact_id: 'contact-1',
    batch_id: 'batch-1',
    state: 'replied',
    released_by_user_id: null,
    release_reason: null,
    state_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.enrolments = [];
  store.staffingEvents = [];
  store.auditRows = [];
  store.sql = [];
  store.updateParams = [];
  store.failStaffingEventInsert = false;
});

describe('releaseEnrolment — compare-and-set release of the company cold-email lock', () => {
  it('releases a live (replied) enrolment and reports the state it was released from', async () => {
    store.enrolments = [enrolment({ state: 'replied' })];

    const result = await releaseEnrolment(ACTOR, 'enr-1', '  prospect asked us to close the loop  ');

    expect(result).toEqual({
      kind: 'released',
      enrolment: {
        id: 'enr-1',
        companyId: 'co-1',
        contactId: 'contact-1',
        batchId: 'batch-1',
        previousState: 'replied',
      },
    });
    const row = store.enrolments[0];
    expect(row.state).toBe('manually_released');
    expect(row.released_by_user_id).toBe('user-1');
    // Trimmed, so a whitespace-only reason can never satisfy the CHECK constraint.
    expect(row.release_reason).toBe('prospect asked us to close the loop');
  });

  it('writes the staffing event inside the same transaction as the state change', async () => {
    store.enrolments = [enrolment({ state: 'conversation_open' })];

    await releaseEnrolment(ACTOR, 'enr-1', 'moved to a warm thread');

    expect(store.staffingEvents).toHaveLength(1);
    expect(store.staffingEvents[0]).toMatchObject({
      tenant_id: TENANT,
      actor_user_id: 'user-1',
      event_type: 'outreach_enrolment.manually_released',
      source_id: 'enr-1',
      company_id: 'co-1',
      contact_id: 'contact-1',
      payload: {
        enrolmentId: 'enr-1',
        batchId: 'batch-1',
        fromState: 'conversation_open',
        toState: 'manually_released',
        releaseReason: 'moved to a warm thread',
      },
    });

    const iBegin = store.sql.indexOf('BEGIN');
    const iUpdate = store.sql.findIndex((s) => s.includes('UPDATE wizmatch_outreach_enrolments'));
    const iEvent = store.sql.findIndex((s) => s.includes('INSERT INTO wizmatch_staffing_events'));
    const iCommit = store.sql.indexOf('COMMIT');
    expect(iBegin).toBeGreaterThan(-1);
    expect(iBegin).toBeLessThan(iUpdate);
    expect(iUpdate).toBeLessThan(iEvent);
    expect(iEvent).toBeLessThan(iCommit);
    expect(store.sql).not.toContain('ROLLBACK');
  });

  it('rolls the state change back when the staffing event cannot be written', async () => {
    store.enrolments = [enrolment()];
    store.failStaffingEventInsert = true;

    await expect(releaseEnrolment(ACTOR, 'enr-1', 'reason')).rejects.toThrow(/staffing event insert exploded/);

    expect(store.sql).toContain('ROLLBACK');
    expect(store.sql).not.toContain('COMMIT');
    expect(store.staffingEvents).toHaveLength(0);
  });

  it('reports already_released on a second call and does NOT overwrite the first release', async () => {
    store.enrolments = [enrolment({ state: 'positive_reply' })];

    const first = await releaseEnrolment(ACTOR, 'enr-1', 'first operator reason');
    expect(first.kind).toBe('released');

    const second = await releaseEnrolment(
      { tenantId: TENANT, userId: 'user-2' },
      'enr-1',
      'second operator reason',
    );

    expect(second).toEqual({ kind: 'already_released', state: 'manually_released' });
    // The losing writer must not stamp itself over the actual decision-maker.
    expect(store.enrolments[0].released_by_user_id).toBe('user-1');
    expect(store.enrolments[0].release_reason).toBe('first operator reason');
    // And must not emit a second timeline event for a release that did not happen.
    expect(store.staffingEvents).toHaveLength(1);
  });

  it('refuses to release an already-terminal enrolment (unsubscribed) rather than resurrecting it', async () => {
    store.enrolments = [enrolment({ state: 'unsubscribed' })];

    const result = await releaseEnrolment(ACTOR, 'enr-1', 'reason');

    expect(result).toEqual({ kind: 'already_released', state: 'unsubscribed' });
    expect(store.enrolments[0].state).toBe('unsubscribed');
    expect(store.staffingEvents).toHaveLength(0);
  });

  it('makes a cross-tenant enrolment id indistinguishable from a non-existent one', async () => {
    store.enrolments = [enrolment({ id: 'enr-other', tenant_id: OTHER_TENANT, state: 'sent' })];

    const crossTenant = await releaseEnrolment(ACTOR, 'enr-other', 'reason');
    const missing = await releaseEnrolment(ACTOR, 'enr-nope', 'reason');

    expect(crossTenant).toEqual({ kind: 'not_found' });
    expect(crossTenant).toEqual(missing);
    // Untouched — no state change, no leak of the other tenant's state via the result.
    expect(store.enrolments[0].state).toBe('sent');
    expect(store.staffingEvents).toHaveLength(0);
  });

  it('rejects a missing/blank release reason BEFORE any UPDATE, so the CHECK constraint is never the gate', async () => {
    store.enrolments = [enrolment()];

    await expect(releaseEnrolment(ACTOR, 'enr-1', '   ')).rejects.toMatchObject({
      code: 'release_reason_required',
    });
    await expect(releaseEnrolment(ACTOR, 'enr-1', undefined as unknown as string)).rejects.toBeInstanceOf(
      EnrolmentReleaseValidationError,
    );

    expect(store.updateParams).toHaveLength(0);
    expect(client.query).not.toHaveBeenCalled();
    expect(store.enrolments[0].state).toBe('replied');
  });

  it('rejects an actor with no user id BEFORE any UPDATE (the same CHECK requires released_by_user_id)', async () => {
    store.enrolments = [enrolment()];

    await expect(releaseEnrolment({ tenantId: TENANT }, 'enr-1', 'reason')).rejects.toMatchObject({
      code: 'actor_required',
    });
    expect(client.query).not.toHaveBeenCalled();
  });
});

describe('releaseEnrolment — live-state list is derived from the config, never a literal', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'services', 'wizmatchOutreachService.ts'),
    'utf8',
  );

  it('imports WIZMATCH_LIVE_ENROLMENT_STATES from the shared config module', () => {
    expect(source).toMatch(
      /import\s*\{[^}]*WIZMATCH_LIVE_ENROLMENT_STATES[^}]*\}\s*from\s*'\.\.\/config\/wizmatchOutreachStates'/,
    );
  });

  it('spells no live-state literal into the release UPDATE statement', () => {
    const update = source.slice(
      source.indexOf('UPDATE wizmatch_outreach_enrolments'),
      source.indexOf('RETURNING e.id'),
    );
    expect(update.length).toBeGreaterThan(0);
    for (const state of WIZMATCH_LIVE_ENROLMENT_STATES) {
      expect(update).not.toContain(`'${state}'`);
    }
  });

  it('passes exactly the config list to the compare-and-set predicate', async () => {
    store.enrolments = [enrolment()];
    await releaseEnrolment(ACTOR, 'enr-1', 'reason');

    expect(store.updateParams).toHaveLength(1);
    expect(store.updateParams[0][4]).toEqual([...WIZMATCH_LIVE_ENROLMENT_STATES]);
  });
});

describe('runEnrolmentReleaseActions — per-target envelope matching /today/actions', () => {
  it('reports every target independently: released, already-terminal and missing', async () => {
    store.enrolments = [
      enrolment({ id: 'live-1', state: 'awaiting_action' }),
      enrolment({ id: 'done-1', state: 'completed' }),
    ];

    const outcome = await runEnrolmentReleaseActions(ACTOR, {
      action: 'release',
      reason: 'pilot cleanup',
      targets: [
        { type: 'enrolment', id: 'live-1' },
        { type: 'enrolment', id: 'done-1' },
        { type: 'enrolment', id: 'missing-1' },
      ],
    });

    expect(outcome.requested).toBe(3);
    expect(outcome.succeeded).toBe(1);
    expect(outcome.failed).toBe(2);
    expect(outcome.results).toEqual([
      { type: 'enrolment', id: 'live-1', ok: true },
      expect.objectContaining({ type: 'enrolment', id: 'done-1', ok: false, code: 'already_released' }),
      expect.objectContaining({ type: 'enrolment', id: 'missing-1', ok: false, code: 'not_found' }),
    ]);
    expect(store.staffingEvents).toHaveLength(1);
  });

  it('rejects the whole request (never partially applies) on a bad shape', async () => {
    store.enrolments = [enrolment()];

    await expect(
      runEnrolmentReleaseActions(ACTOR, { action: 'release', reason: 'r', targets: [] }),
    ).rejects.toMatchObject({ code: 'targets_required' });

    await expect(
      runEnrolmentReleaseActions(ACTOR, {
        action: 'release',
        reason: 'r',
        targets: [{ type: 'company', id: 'co-1' } as never],
      }),
    ).rejects.toMatchObject({ code: 'mixed_invalid_targets' });

    await expect(
      runEnrolmentReleaseActions(ACTOR, {
        action: 'release',
        reason: '   ',
        targets: [{ type: 'enrolment', id: 'enr-1' }],
      }),
    ).rejects.toMatchObject({ code: 'release_reason_required' });

    await expect(
      runEnrolmentReleaseActions(ACTOR, {
        action: 'release',
        reason: 'r',
        targets: Array.from({ length: 101 }, (_, i) => ({ type: 'enrolment' as const, id: `e-${i}` })),
      }),
    ).rejects.toMatchObject({ code: 'too_many_targets' });

    await expect(
      runEnrolmentReleaseActions({ tenantId: TENANT }, {
        action: 'release',
        reason: 'r',
        targets: [{ type: 'enrolment', id: 'enr-1' }],
      }),
    ).rejects.toMatchObject({ code: 'actor_required' });

    expect(client.query).not.toHaveBeenCalled();
    expect(store.enrolments[0].state).toBe('replied');
  });
});
