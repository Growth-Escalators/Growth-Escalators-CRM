// PRD-005 §16 rule 5, D-35 (owner-ratified 2026-07-26), O-1 (PR 3 review) —
// a mode flip must alert/audit exactly once per ACTUAL transition, not once
// per request. Before this fix, §16 rule 5 had no implementation at all.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  policyRows: [] as any[],
  slackCalls: [] as any[],
  auditCalls: [] as any[],
  /** The persisted mode baseline `audit_logs` would return, or [] for a first-ever boot. */
  persistedModeRows: [] as any[],
  poolQueries: [] as any[],
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
    pool: {
      query: (text: string, params?: unknown[]) => {
        state.poolQueries.push({ text, params });
        return Promise.resolve({ rows: state.persistedModeRows });
      },
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

function auditActions(): string[] {
  return state.auditCalls.map((call) => call[0]?.action);
}

beforeEach(() => {
  state.policyRows = [rootPolicy()];
  state.slackCalls = [];
  state.auditCalls = [];
  state.persistedModeRows = [];
  state.poolQueries = [];
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
    expect(auditActions().filter((a) => a === 'wizmatch_policy_enforcement_mode_changed')).toHaveLength(1);
  });
});

// D-35 restart gap — found by the 2026-07-26 independent re-review. The env var
// that carries the mode is applied by REDEPLOYING, so the real flip always
// arrives as a fresh process with an empty in-process baseline. Before this
// fix, that case seeded silently and the alert could never fire in production;
// only the in-process mutation above (which no deployment performs) was
// covered. Each test here re-imports the module to genuinely simulate a boot.
describe('D-35 — a flip applied by restarting into a new mode still alerts', () => {
  async function bootFresh(mode: 'shadow' | 'enforce') {
    vi.resetModules();
    if (mode === 'enforce') process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE = 'enforce';
    else delete process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE;
    const mod = await import('../modules/outreach/outreachGate');
    await mod.resolveCompanyStatus('tenant-1', 'company-1');
    await flushMicrotasks();
  }

  it('alerts when a fresh process boots into enforce and the persisted baseline was shadow', async () => {
    state.persistedModeRows = [{ mode: 'shadow' }];
    await bootFresh('enforce');

    expect(state.slackCalls).toHaveLength(1);
    expect(state.slackCalls[0][1]).toContain('shadow');
    expect(state.slackCalls[0][1]).toContain('enforce');
    expect(auditActions()).toContain('wizmatch_policy_enforcement_mode_changed');
  });

  it('does not alert when a fresh process boots into the SAME mode as the persisted baseline', async () => {
    state.persistedModeRows = [{ mode: 'shadow' }];
    await bootFresh('shadow');

    expect(state.slackCalls).toHaveLength(0);
    expect(auditActions()).not.toContain('wizmatch_policy_enforcement_mode_changed');
  });

  it('records the baseline silently on a first-ever boot with no persisted history', async () => {
    state.persistedModeRows = [];
    await bootFresh('enforce');

    expect(state.slackCalls).toHaveLength(0);
    expect(auditActions()).toEqual(['wizmatch_policy_enforcement_mode_observed']);
    expect(state.auditCalls[0][0]).toMatchObject({ newValues: { mode: 'enforce' } });
  });

  it('consults the persisted baseline at most once per process, not once per request', async () => {
    state.persistedModeRows = [{ mode: 'shadow' }];
    vi.resetModules();
    delete process.env.WIZMATCH_POLICY_ENFORCEMENT_MODE;
    const mod = await import('../modules/outreach/outreachGate');
    await mod.resolveCompanyStatus('tenant-1', 'company-1');
    await mod.resolveCompanyStatus('tenant-1', 'company-1');
    await mod.resolveCompanyStatus('tenant-1', 'company-1');
    await flushMicrotasks();

    expect(state.poolQueries).toHaveLength(1);
  });
});
