// PRD-005 §16 rule 5, D-35 (owner-ratified 2026-07-26), O-1 (PR 3 review) —
// a mode flip must alert/audit exactly once per ACTUAL transition, not once
// per request. Before this fix, §16 rule 5 had no implementation at all.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  policyRows: [] as any[],
  slackCalls: [] as any[],
  auditCalls: [] as any[],
}));

vi.mock('../db', async () => {
  const actualSchema = await vi.importActual<typeof import('../db/schema')>('../db/schema');
  return {
    ...actualSchema,
    db: {
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            if (table === actualSchema.wizmatchCompanyPolicies) return Promise.resolve(state.policyRows);
            return Promise.resolve([]);
          },
        }),
      }),
    },
  };
});

vi.mock('../config/constants', () => ({
  WIZMATCH_SYSTEM_CHANNEL: '#wizmatch-system-test',
}));

vi.mock('../services/slackService', () => ({
  sendSlackMessage: (...args: any[]) => {
    state.slackCalls.push(args);
    return Promise.resolve(true);
  },
}));

vi.mock('../services/auditLogger', () => ({
  auditLog: (...args: any[]) => {
    state.auditCalls.push(args);
    return Promise.resolve();
  },
}));

import { resolveCompanyStatus } from '../modules/outreach/outreachGate';

function rootPolicy() {
  return {
    id: 'policy-1', companyId: 'company-1', scopeType: 'entire_company', scopeKey: 'entire_company',
    outreachEligibility: 'eligible', externalHiringPolicy: 'accepts_external_vendors', relationshipType: 'new_prospect',
    reasonCode: 'policy_accepts_external_vendors', blockClass: 'standard', isNonOverridable: false, isPermanent: false,
    evidenceKind: 'human_text', evidenceText: 'test', evidenceUrl: null, evidenceRef: null, source: 'human',
    actorUserId: null, supersededAt: null,
  };
}

async function flushMicrotasks() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  state.policyRows = [rootPolicy()];
  state.slackCalls = [];
  state.auditCalls = [];
  delete process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE;
});

describe('D-35 — mode-flip alert fires once per transition, not per request', () => {
  it('does not alert on the first read after boot (no prior known mode to compare against)', async () => {
    await resolveCompanyStatus('tenant-1', 'company-1');
    await flushMicrotasks();
    expect(state.slackCalls).toHaveLength(0);
  });

  it('does not alert across repeated requests in the same mode', async () => {
    await resolveCompanyStatus('tenant-1', 'company-1');
    await resolveCompanyStatus('tenant-1', 'company-1');
    await resolveCompanyStatus('tenant-1', 'company-1');
    await flushMicrotasks();
    expect(state.slackCalls).toHaveLength(0);
  });

  it('alerts exactly once when the mode actually transitions, not once per subsequent request', async () => {
    await resolveCompanyStatus('tenant-1', 'company-1'); // seeds shadow as the known baseline
    process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE = 'enforce';
    await resolveCompanyStatus('tenant-1', 'company-1'); // the transition
    await resolveCompanyStatus('tenant-1', 'company-1'); // same mode again — must NOT re-alert
    await resolveCompanyStatus('tenant-1', 'company-1');
    await flushMicrotasks();

    expect(state.slackCalls).toHaveLength(1);
    expect(state.slackCalls[0][1]).toContain('shadow');
    expect(state.slackCalls[0][1]).toContain('enforce');
    expect(state.auditCalls).toHaveLength(1);
    expect(state.auditCalls[0][0]).toMatchObject({ action: 'wizmatch_policy_enforcement_mode_changed' });
  });
});
