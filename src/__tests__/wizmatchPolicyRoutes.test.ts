// PRD-005 PR 4 — route-level contract for src/routes/wizmatchPolicy.ts.
//
// The service-level suite (wizmatchPolicyService.test.ts) calls the exported
// functions directly, so it is structurally blind to routing defects: the
// admin-only `POST /companies/bulk/policy` was shadowed by the team_lead
// `POST /companies/:id/policy` declared above it and never ran, and every
// service test still passed. These tests mount the REAL router on a REAL
// express app and issue REAL requests, so path precedence, the role gate that
// actually fires, and the feature flag are all exercised end to end.
//
// Only the service layer and the RBAC middleware are stubbed — the router,
// its path table and its registration order are the code under test.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

const calls = vi.hoisted(() => ({
  writeCompanyPolicy: [] as unknown[][],
  bulkWriteCompanyPolicy: [] as unknown[][],
  roleGates: [] as string[][],
}));

vi.mock('../middleware/rbac', () => ({
  // Records which roles each route demanded, and always allows through, so a
  // test can assert on the gate that fired without needing real auth.
  requireRole:
    (...roles: string[]) =>
    (_req: unknown, _res: unknown, next: () => void) => {
      calls.roleGates.push(roles);
      next();
    },
}));

vi.mock('../modules/outreach/policyService', () => ({
  getCompanyPolicyView: async () => ({ effective: {}, scoped: [], history: [], accountOwnerUserId: null }),
  writeCompanyPolicy: async (...args: unknown[]) => {
    calls.writeCompanyPolicy.push(args);
    return { id: 'policy-1' };
  },
  writeCompanyPolicyOverride: async () => ({ id: 'policy-override' }),
  assignAccountOwner: async () => ({ ok: true }),
  bulkWriteCompanyPolicy: async (...args: unknown[]) => {
    calls.bulkWriteCompanyPolicy.push(args);
    return { results: [] };
  },
  listCompaniesByPolicy: async () => [],
  PolicyValidationError: class extends Error {},
  PolicyOverrideRefusedError: class extends Error {},
}));

vi.mock('../modules/outreach/duplicateService', () => ({
  listDuplicates: async () => [],
  resolveDuplicate: async () => ({ id: 'dup-1' }),
  DuplicateValidationError: class extends Error {},
}));

vi.mock('../modules/outreach/policyReadiness', () => ({
  getWizmatchPolicyReadiness: async () => ({ ok: true }),
}));

let server: Server;
let baseUrl: string;

async function startServer() {
  const { default: router } = await import('../routes/wizmatchPolicy');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { user: unknown }).user = { tenantId: 'tenant-1', id: 'user-1', role: 'admin' };
    next();
  });
  app.use('/api/wizmatch', router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeEach(() => {
  calls.writeCompanyPolicy.length = 0;
  calls.bulkWriteCompanyPolicy.length = 0;
  calls.roleGates.length = 0;
  process.env.WIZMATCH_COMPANY_POLICY_ENABLED = 'true';
});

afterEach(async () => {
  delete process.env.WIZMATCH_COMPANY_POLICY_ENABLED;
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('wizmatchPolicy router — path precedence', () => {
  it('routes POST /companies/bulk/policy to the bulk handler, not the single-company one', async () => {
    await startServer();

    const res = await fetch(`${baseUrl}/api/wizmatch/companies/bulk/policy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ companyIds: ['company-1', 'company-2'], scopeType: 'entire_company' }),
    });

    expect(res.status).toBe(200);
    // The defect this pins: with `/companies/:id/policy` registered first,
    // express matched it with id='bulk' and the bulk handler never ran.
    expect(calls.bulkWriteCompanyPolicy).toHaveLength(1);
    expect(calls.writeCompanyPolicy).toHaveLength(0);
    expect(calls.bulkWriteCompanyPolicy[0][1]).toMatchObject({ companyIds: ['company-1', 'company-2'] });
  });

  it('gates POST /companies/bulk/policy on admin, not team_lead (PRD-005 §4)', async () => {
    await startServer();

    await fetch(`${baseUrl}/api/wizmatch/companies/bulk/policy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ companyIds: ['company-1'], scopeType: 'entire_company' }),
    });

    expect(calls.roleGates).toContainEqual(['admin']);
    expect(calls.roleGates).not.toContainEqual(['admin', 'team_lead']);
  });

  it('still routes a real company id to the single-company handler', async () => {
    await startServer();

    const res = await fetch(`${baseUrl}/api/wizmatch/companies/3f1a5c2e-0000-4000-8000-000000000001/policy`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scopeType: 'entire_company' }),
    });

    expect(res.status).toBe(201);
    expect(calls.writeCompanyPolicy).toHaveLength(1);
    expect(calls.writeCompanyPolicy[0][1]).toBe('3f1a5c2e-0000-4000-8000-000000000001');
    expect(calls.bulkWriteCompanyPolicy).toHaveLength(0);
  });
});

describe('wizmatchPolicy router — feature flag', () => {
  it('404s every route when WIZMATCH_COMPANY_POLICY_ENABLED is not exactly "true"', async () => {
    process.env.WIZMATCH_COMPANY_POLICY_ENABLED = 'TRUE';
    await startServer();

    for (const [method, path] of [
      ['GET', '/api/wizmatch/companies/c1/policy'],
      ['POST', '/api/wizmatch/companies/bulk/policy'],
      ['GET', '/api/wizmatch/companies/duplicates'],
      ['GET', '/api/wizmatch/policy/readiness'],
    ] as const) {
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({ companyIds: ['c1'] }) : undefined,
      });
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    expect(calls.bulkWriteCompanyPolicy).toHaveLength(0);
  });
});
