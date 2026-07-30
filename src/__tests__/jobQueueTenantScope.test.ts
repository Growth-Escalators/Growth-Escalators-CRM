// QA run 2026-07-30 — regression guard for finding S1 (CRITICAL, new this run;
// not present in the 2026-07-30 failure matrix).
//
// The defect: `/api/jobs` is mounted with `requireAuth` ONLY (`src/index.ts:252`)
// — no role gate and no tenant scoping — and the four backing service functions
// (`getPendingJobs`, `claimJob`, `completeJob`, `failJob`) filtered by job
// `id`/`status`/`jobType` and never by `tenant_id`, despite the `jobs` table
// carrying a `tenant_id` column that `insertJob` populates.
//
// So ANY authenticated user, of ANY role (down to the lowest-privilege `staff`)
// and ANY tenant, could:
//   - GET /api/jobs/pending          -> read every tenant's job payloads. Those
//     payloads are raw webhook bodies and enrolment records: `sequence_step`
//     carries contactId/tenantId, `booking_processed` and `hot_lead_alert`
//     carry contact names and lead scores.
//   - PATCH /api/jobs/:id/claim|complete|fail -> claim, complete or dead-letter
//     another tenant's job by GUID, i.e. silently drop their work.
//
// THE FIX IS DELIBERATELY "own tenant OR NULL", NOT "own tenant".
// Webhook-originated jobs are inserted with an explicit `null` tenant
// (`webhooks.ts:176`, `:287`, `:314`, `:340` — inbound_wa, booking_failed,
// form_submit, chatwoot_event). They are system-level work not yet attributed to
// a tenant. A strict `tenant_id = caller` filter would make every one of them
// invisible to every caller and silently stop inbound processing entirely.
//
// RESIDUAL GAP, recorded rather than hidden: NULL-tenant jobs remain visible to
// every authenticated tenant. Fully closing that requires attributing webhook
// jobs to a tenant at ingestion, which is a product change beyond this QA pass.
// See docs/testing/WIZMATCH_REMAINING_GAPS_AND_ROADMAP.md.
//
// Internal callers must stay UNSCOPED: `stuckJobWorker.ts:27` calls `failJob`
// as a system sweeper across all tenants. The scope is therefore an optional
// argument that only the HTTP layer passes.

import { describe, it, expect, vi, beforeEach } from 'vitest';

type Where = unknown;
const captured: { where: Where[] } = { where: [] };

// Records the `where` expression each query builds so the tests can assert that
// a tenant predicate was actually applied, rather than trusting the call shape.
vi.mock('../db/index', () => {
  const chain = (sink: Where[]) => ({
    from: () => ({
      where: (w: Where) => {
        sink.push(w);
        return {
          orderBy: () => ({ limit: async () => [] }),
          limit: async () => [],
        };
      },
    }),
  });
  return {
    db: {
      select: () => chain(captured.where),
      update: () => ({
        set: () => ({
          where: (w: Where) => {
            captured.where.push(w);
            return { returning: async () => [] };
          },
        }),
      }),
    },
    jobs: {
      id: 'id',
      tenantId: 'tenant_id',
      status: 'status',
      jobType: 'job_type',
      processAfter: 'process_after',
    },
  };
});

/**
 * Drizzle builds an opaque SQL AST. Rather than assert on its internals, we
 * serialise it and look for the tenant column — enough to prove a tenant
 * predicate is present or absent, which is exactly what S1 is about.
 */
function mentionsTenant(where: Where): boolean {
  return JSON.stringify(where, (_k, v) => (typeof v === 'symbol' ? String(v) : v))
    .includes('tenant_id');
}

describe('job queue tenant scoping (S1)', () => {
  beforeEach(() => {
    captured.where = [];
    vi.clearAllMocks();
  });

  it('getPendingJobs applies a tenant predicate when a scope is supplied', async () => {
    const { getPendingJobs } = await import('../services/jobQueue');
    await getPendingJobs(undefined, 10, { tenantId: 'tenant-a' });
    expect(captured.where).toHaveLength(1);
    expect(mentionsTenant(captured.where[0]), 'getPendingJobs ignored the tenant scope').toBe(true);
  });

  it('claimJob applies a tenant predicate when a scope is supplied', async () => {
    const { claimJob } = await import('../services/jobQueue');
    await claimJob('job-1', { tenantId: 'tenant-a' });
    expect(mentionsTenant(captured.where[0]), 'claimJob ignored the tenant scope').toBe(true);
  });

  it('completeJob applies a tenant predicate when a scope is supplied', async () => {
    const { completeJob } = await import('../services/jobQueue');
    await completeJob('job-1', { tenantId: 'tenant-a' });
    expect(mentionsTenant(captured.where[0]), 'completeJob ignored the tenant scope').toBe(true);
  });

  it('failJob applies a tenant predicate when a scope is supplied', async () => {
    const { failJob } = await import('../services/jobQueue');
    await failJob('job-1', 'boom', { tenantId: 'tenant-a' });
    expect(mentionsTenant(captured.where[0]), 'failJob ignored the tenant scope').toBe(true);
  });

  // Internal system callers (stuckJobWorker) must keep cross-tenant reach.
  it('omitting the scope leaves every query unscoped, for internal system callers', async () => {
    const { getPendingJobs, claimJob, completeJob, failJob } = await import('../services/jobQueue');
    await getPendingJobs(undefined, 10);
    await claimJob('job-1');
    await completeJob('job-1');
    await failJob('job-1', 'boom');
    for (const where of captured.where) {
      expect(mentionsTenant(where), 'an unscoped call unexpectedly filtered by tenant').toBe(false);
    }
  });
});

describe('the /api/jobs router passes the caller tenant through (S1)', () => {
  it('every handler derives its scope from req.user, never from the request body or query', () => {
    // Source-level assertion: the exploit is that the route trusts nothing but
    // the URL. This pins that each handler reads the tenant from the
    // authenticated session, and that no handler takes a tenant from input.
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'jobs.ts'), 'utf8');
    const bare = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    // The scope is derived from the authenticated session...
    expect(bare, 'the /api/jobs router never reads a tenant from req.user').toMatch(/req\.user\?\.tenantId/);

    // ...and every one of the four service calls is handed that scope. Counting
    // the call sites rather than `req.user` occurrences deliberately: the
    // derivation is centralised in one `scopeOf(req)` helper, so a per-handler
    // `req.user` count would be an assertion about style, not about safety.
    const scoped = bare.match(/scopeOf\(req\)/g) ?? [];
    expect(scoped.length, 'not every /api/jobs handler passes a tenant scope to the job queue').toBe(4);
    for (const call of ['getPendingJobs(', 'claimJob(', 'completeJob(', 'failJob(']) {
      const invocation = bare.slice(bare.indexOf(call));
      expect(
        invocation.slice(0, invocation.indexOf(')') + 1),
        `${call} is called without a tenant scope`,
      ).toContain('scopeOf(req)');
    }

    // And never from attacker-controlled input.
    expect(bare).not.toMatch(/tenantId\s*[=:]\s*(?:req\.body|req\.query)/);
    expect(bare).not.toMatch(/req\.(?:body|query|headers)\s*(?:\.|\[['"])tenant/i);
  });
});
