// GET /today/queues now serves SIX queues that do not all act on the same
// endpoint: the four company queues go to POST /today/actions, while
// `signalsToQualify` and `contactsToReview` go to POST /signals/bulk-action
// and POST /contact-intelligence/contacts/bulk-review respectively.
//
// `attachCapabilities` therefore dispatches per queue key. This file proves
// that dispatch is real: a signal item must NOT come back carrying company
// action capabilities (which would advertise `approve_queue` on a row whose
// id `/today/actions` would route into DUPLICATE resolution — that path's
// target union is closed at `company | duplicate` and its dispatch ends in an
// `else`), and a company item must not come back carrying `qualify`.
//
// Lives in its own file rather than in `wizmatchTodayRoutes.test.ts`, which
// pins the shipped route contract and must stay unmodified.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const state = vi.hoisted(() => ({
  queues: {} as Record<string, unknown>,
}));

vi.mock('../modules/outreach/decisionWorkbench', () => ({
  buildTodayQueues: async () => state.queues,
}));

vi.mock('../modules/outreach/decisionWorkbenchActions', () => ({
  TodayActionValidationError: class extends Error { code = 'x'; },
  runTodayActions: async () => ({ requested: 0, succeeded: 0, failed: 0, results: [] }),
}));

vi.mock('../middleware/wizmatchMachineSyncLane', () => ({
  wizmatchPilotOrMachineSync: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

let server: Server;
let baseUrl: string;

async function startServer(role: string) {
  const { default: router } = await import('../routes/wizmatchToday');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: unknown }).user = { tenantId: 'tenant-1', id: 'user-1', role };
    next();
  });
  app.use('/api/wizmatch', router);
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const companyItem = {
  kind: 'company',
  companyId: 'company-1',
  companyName: 'Acme',
  outreachEligibility: 'needs_review',
  externalHiringPolicy: 'unknown',
  relationshipType: 'new_prospect',
  policyReasonCode: 'manual_reclassified',
  isNonOverridable: false,
  nonOverridableScopeKey: null,
  duplicatePending: false,
  duplicateId: null,
};

beforeEach(() => {
  vi.resetModules();
  process.env.WIZMATCH_DECISION_WORKBENCH_ENABLED = 'true';
  state.queues = {
    readyToContact: [companyItem],
    needsReview: [],
    routed: [],
    pausedOrBlocked: [],
    repliesNeedingAction: [],
    signalsToQualify: [{ kind: 'signal', signalId: 'signal-1', jobTitle: 'Java Engineer', status: 'scored' }],
    contactsToReview: [{ kind: 'contact', candidateId: 'candidate-1', name: 'Priya', status: 'needs_review' }],
    counts: {},
    partial: { skippedCompanyIds: [], skippedEnrolmentIds: [] },
  };
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

type Body = {
  readyToContact: Array<{ capabilities: Record<string, { enabled: boolean; reason: string | null }> }>;
  signalsToQualify: Array<{ capabilities: Record<string, { enabled: boolean; reason: string | null }> }>;
  contactsToReview: Array<{ capabilities: Record<string, { enabled: boolean; reason: string | null }> }>;
};

describe('GET /today/queues — capabilities are dispatched per queue, not shared', () => {
  it('gives each queue its OWN action vocabulary', async () => {
    await startServer('admin');
    const body = (await (await fetch(`${baseUrl}/api/wizmatch/today/queues`)).json()) as Body;

    expect(Object.keys(body.signalsToQualify[0].capabilities).sort()).toEqual(['qualify', 'reject']);
    expect(Object.keys(body.contactsToReview[0].capabilities).sort()).toEqual(['approve', 'reject']);
    // The company vocabulary is unchanged and must not leak into the new
    // queues: `approve_queue` on a signal row would advertise an action
    // /today/actions cannot perform on that id.
    expect(body.readyToContact[0].capabilities.approve_queue).toBeDefined();
    expect(body.signalsToQualify[0].capabilities.approve_queue).toBeUndefined();
    expect(body.readyToContact[0].capabilities.qualify).toBeUndefined();
  });

  it('answers the new queues from the CALLER\'S role, proving the role is wired through both new predictors', async () => {
    await startServer('staff');
    const staff = (await (await fetch(`${baseUrl}/api/wizmatch/today/queues`)).json()) as Body;
    expect(staff.signalsToQualify[0].capabilities.qualify).toEqual({
      enabled: false, reason: 'This action requires team_lead or admin.',
    });
    expect(staff.contactsToReview[0].capabilities.approve.enabled).toBe(false);

    await new Promise<void>((resolve) => server.close(() => resolve()));
    vi.resetModules();
    await startServer('team_lead');
    const lead = (await (await fetch(`${baseUrl}/api/wizmatch/today/queues`)).json()) as Body;
    expect(lead.signalsToQualify[0].capabilities.qualify).toEqual({ enabled: true, reason: null });
    expect(lead.contactsToReview[0].capabilities.approve).toEqual({ enabled: true, reason: null });
  });

  it('a queue absent from the payload is skipped, not thrown on (back-compat with an older service shape)', async () => {
    delete state.queues.signalsToQualify;
    delete state.queues.contactsToReview;
    await startServer('admin');
    const res = await fetch(`${baseUrl}/api/wizmatch/today/queues`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.signalsToQualify).toBeUndefined();
    expect((body.readyToContact as Body['readyToContact'])[0].capabilities).toBeDefined();
  });
});
