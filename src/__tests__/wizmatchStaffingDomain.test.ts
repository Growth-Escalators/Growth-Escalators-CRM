import { describe, expect, it, vi } from 'vitest';
import { StaffingDomainError, assertStageTransition, createWizmatchStaffingService } from '../services/wizmatchStaffingDomain';

function fakePool(responder: (sql: string, params: unknown[]) => { rows?: any[]; rowCount?: number } = () => ({ rows: [], rowCount: 1 })) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      const result = responder(sql, params);
      return { rows: result.rows ?? [], rowCount: result.rowCount ?? result.rows?.length ?? 1 };
    }),
    release: vi.fn(),
  };
  return { pool: { connect: vi.fn(async () => client) } as any, client, calls };
}

// Read-only listX() methods call dbPool.query(...) directly (no transaction),
// unlike the write paths above which go through pool.connect(). This fake
// exposes .query on the pool itself.
function fakeQueryPool(responder: (sql: string, params: unknown[]) => { rows?: any[]; rowCount?: number } = () => ({ rows: [], rowCount: 0 })) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const result = responder(sql, params);
    return { rows: result.rows ?? [], rowCount: result.rowCount ?? result.rows?.length ?? 0 };
  });
  return { pool: { query } as any, calls };
}

describe('Wizmatch staffing domain', () => {
  it('enforces the explicit requirement state machine', () => {
    expect(() => assertStageTransition('draft', 'qualifying')).not.toThrow();
    expect(() => assertStageTransition('offer', 'filled')).not.toThrow();
    expect(() => assertStageTransition('draft', 'filled')).toThrowError(StaffingDomainError);
    expect(() => assertStageTransition('filled', 'sourcing')).toThrowError(/Cannot move/);
  });

  it('creates a tenant-scoped company relationship, bumps contact activity and appends its event in one transaction', async () => {
    const ids = { tenant: 'tenant-a', company: 'company-a', contact: 'person-a', actor: 'user-a', relationship: 'relationship-a' };
    const fake = fakePool((sql) => {
      if (sql.includes('INSERT INTO wizmatch_company_contacts')) return { rows: [{ id: ids.relationship, contact_id: ids.contact }], rowCount: 1 };
      if (sql.includes('SELECT id FROM')) return { rows: [{ id: 'owned' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const service = createWizmatchStaffingService(fake.pool);

    await service.createCompanyContact(
      { tenantId: ids.tenant, userId: ids.actor }, ids.company,
      { contactId: ids.contact, roles: ['talent_acquisition', 'hiring_manager'] },
    );

    expect(fake.calls[0].sql).toBe('BEGIN');
    expect(fake.calls.at(-1)?.sql).toBe('COMMIT');
    expect(fake.client.release).toHaveBeenCalledOnce();
    expect(fake.calls.filter(call => call.sql.includes('wizmatch_company_contact_roles'))).toHaveLength(2);
    expect(fake.calls.some(call => call.sql.includes('UPDATE contacts SET last_activity_at'))).toBe(true);
    const event = fake.calls.find(call => call.sql.includes('INSERT INTO wizmatch_staffing_events'));
    expect(event?.params).toEqual(expect.arrayContaining([ids.tenant, ids.actor, 'company_contact.created', ids.company, ids.contact, ids.relationship]));
  });

  it('rejects cross-company requirement attribution and rolls back without an event', async () => {
    const fake = fakePool((sql) => {
      if (sql.includes('SELECT id,company_id FROM wizmatch_requirements')) return { rows: [{ id: 'sap-role', company_id: 'company-a' }], rowCount: 1 };
      if (sql.includes('SELECT id,company_id,contact_id FROM wizmatch_company_contacts')) return { rows: [{ id: 'person-b-link', company_id: 'company-b', contact_id: 'person-b' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const service = createWizmatchStaffingService(fake.pool);

    await expect(service.addRequirementContact(
      { tenantId: 'tenant-a', userId: 'actor' }, 'sap-role',
      { companyContactId: 'person-b-link', role: 'source', isPrimarySource: true },
    )).rejects.toMatchObject({ code: 'company_mismatch' });

    expect(fake.calls.at(-1)?.sql).toBe('ROLLBACK');
    expect(fake.calls.some(call => call.sql.includes('INSERT INTO wizmatch_staffing_events'))).toBe(false);
  });

  it('preserves requirement history by blocking relationship deactivation while attribution is active', async () => {
    const fake = fakePool((sql) => {
      if (sql.includes('SELECT 1 FROM wizmatch_requirement_contacts')) return { rows: [{ '?column?': 1 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const service = createWizmatchStaffingService(fake.pool);
    await expect(service.deactivateCompanyContact(
      { tenantId: 'tenant-a', userId: 'actor' }, 'company-a', 'person-a-link',
    )).rejects.toMatchObject({ code: 'active_attribution_exists' });
    expect(fake.calls.at(-1)?.sql).toBe('ROLLBACK');
    expect(fake.calls.some(call => call.sql.includes('UPDATE wizmatch_company_contacts'))).toBe(false);
  });

  it('blocks acceptance until source channel, account owner, recruiter, SLA and next action are present', async () => {
    const fake = fakePool((sql) => {
      if (sql.includes('SELECT * FROM wizmatch_requirements')) return { rows: [{ id: 'java-role', company_id: 'company-a', stage: 'qualifying', sla_due_at: null, next_action: null, next_action_due_at: null }], rowCount: 1 };
      if (sql.includes('EXISTS(SELECT 1 FROM wizmatch_requirement_contacts')) return { rows: [{ has_primary: false, has_primary_channel: false, has_owner: false, has_recruiter: false }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const service = createWizmatchStaffingService(fake.pool);

    await expect(service.transitionRequirement(
      { tenantId: 'tenant-a', userId: 'actor' }, 'java-role', { stage: 'accepted' },
    )).rejects.toThrow(/primary source contact, primary source contact channel, account owner, recruiter, SLA due date, dated next action/);
    expect(fake.calls.at(-1)?.sql).toBe('ROLLBACK');
  });

  it('creates a linked task when a dated next action is set', async () => {
    const fake = fakePool((sql) => {
      if (sql.includes('SELECT id FROM users')) return { rows: [{ id: 'recruiter-a' }], rowCount: 1 };
      if (sql.includes('UPDATE wizmatch_requirements')) return { rows: [{ id: 'sap-role', company_id: 'company-a', title: 'SAP ABAP Developer' }], rowCount: 1 };
      if (sql.includes('INSERT INTO tasks')) return { rows: [{ id: 'task-a', title: 'Call source person' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const service = createWizmatchStaffingService(fake.pool);
    const result = await service.setNextAction(
      { tenantId: 'tenant-a', userId: 'recruiter-a' }, 'sap-role',
      { nextAction: 'Call source person', nextActionDueAt: '2026-07-14T10:00:00.000Z' },
    );
    expect(result.task.id).toBe('task-a');
    expect(fake.calls.some(call => call.sql.includes('INSERT INTO wizmatch_task_links'))).toBe(true);
    expect(fake.calls.find(call => call.sql.includes('INSERT INTO wizmatch_staffing_events'))?.params)
      .toEqual(expect.arrayContaining(['requirement.next_action_set', 'sap-role']));
  });

  it('turns Requirement Priority review plans into durable linked tasks and timeline events', async () => {
    const fake = fakePool((sql) => {
      if (sql.includes('SELECT id,company_id,title FROM wizmatch_requirements')) return { rows: [{ id: 'java-role', company_id: 'company-a', title: 'Java Developer' }], rowCount: 1 };
      if (sql.includes('INSERT INTO tasks')) return { rows: [{ id: 'review-task', title: 'Review candidates — Java Developer' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const service = createWizmatchStaffingService(fake.pool);
    const result = await service.createReviewPlan(
      { tenantId: 'tenant-a', userId: 'lead-a' }, 'java-role',
      { action: 'review_candidates', notes: 'Review the top five candidates' },
    );
    expect(result).toMatchObject({ task: { id: 'review-task' }, nextActionUpdated: false });
    expect(fake.calls.some(call => call.sql.includes('INSERT INTO wizmatch_task_links'))).toBe(true);
    expect(fake.calls.find(call => call.sql.includes('INSERT INTO wizmatch_staffing_events'))?.params)
      .toEqual(expect.arrayContaining(['requirement.review_plan_created', 'java-role']));
    expect(fake.calls.at(-1)?.sql).toBe('COMMIT');
  });

  it('blocks hard-deleting a hiring contact that still has an active attribution, submission or interview', async () => {
    const fake = fakePool((sql) => {
      if (sql.includes('SELECT cc.id, cc.contact_id')) return { rows: [{ id: 'poc-a', contact_id: 'person-a', first_name: 'Asha', last_name: 'Rao' }], rowCount: 1 };
      if (sql.includes('FROM wizmatch_submission_recipients')) return { rows: [{ n: 2 }], rowCount: 1 };
      if (sql.includes('COUNT(*)')) return { rows: [{ n: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const service = createWizmatchStaffingService(fake.pool);

    await expect(service.deleteCompanyContact(
      { tenantId: 'tenant-a', userId: 'lead-a' }, 'company-a', 'poc-a',
    )).rejects.toMatchObject({ status: 409, code: 'has_dependencies' });

    // Never destructive when blocked: no company_contact delete, and the CRM
    // contact row is untouched. Transaction rolls back.
    expect(fake.calls.some(call => call.sql.includes('DELETE FROM wizmatch_company_contacts'))).toBe(false);
    expect(fake.calls.some(call => call.sql.includes('DELETE FROM contacts'))).toBe(false);
    expect(fake.calls.at(-1)?.sql).toBe('ROLLBACK');
  });

  it('hard-deletes a clean hiring contact relationship while preserving the CRM contact row', async () => {
    const fake = fakePool((sql) => {
      if (sql.includes('SELECT cc.id, cc.contact_id')) return { rows: [{ id: 'poc-a', contact_id: 'person-a', first_name: 'Asha', last_name: 'Rao' }], rowCount: 1 };
      if (sql.includes('COUNT(*)')) return { rows: [{ n: 0 }], rowCount: 1 };
      if (sql.includes('DELETE FROM wizmatch_company_contacts')) return { rows: [{ id: 'poc-a' }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const service = createWizmatchStaffingService(fake.pool);

    const result = await service.deleteCompanyContact(
      { tenantId: 'tenant-a', userId: 'lead-a' }, 'company-a', 'poc-a',
    );
    expect(result).toEqual({ deleted: true, id: 'poc-a' });

    // Removes NOT NULL children, detaches nullable history FKs, deletes the link.
    expect(fake.calls.some(call => call.sql.includes('DELETE FROM wizmatch_company_contact_roles'))).toBe(true);
    expect(fake.calls.some(call => call.sql.includes('DELETE FROM wizmatch_requirement_contacts'))).toBe(true);
    expect(fake.calls.some(call => call.sql.includes('UPDATE wizmatch_task_links SET company_contact_id = NULL'))).toBe(true);
    expect(fake.calls.some(call => call.sql.includes('UPDATE wizmatch_staffing_events SET company_contact_id = NULL'))).toBe(true);
    expect(fake.calls.some(call => call.sql.includes('DELETE FROM wizmatch_company_contacts'))).toBe(true);
    // The CRM contact row itself is preserved — only its activity is bumped.
    expect(fake.calls.some(call => call.sql.includes('DELETE FROM contacts'))).toBe(false);
    expect(fake.calls.some(call => call.sql.includes('UPDATE contacts SET last_activity_at'))).toBe(true);
    // Audits the deletion with the detached (null) company_contact link.
    const event = fake.calls.find(call => call.sql.includes('INSERT INTO wizmatch_staffing_events'));
    expect(event?.params).toEqual(expect.arrayContaining(['company_contact.deleted']));
    expect(fake.calls.at(-1)?.sql).toBe('COMMIT');
  });

  // Regression for the admin "Linked hiring contacts" tab N+1: it used to fan
  // out one listCompanyContacts call per company (183 companies in prod =>
  // 183 parallel requests => 429s from the rate limiter). Fixed by wiring the
  // page to this single cross-company aggregate query instead. Guards two
  // things a future edit could silently reintroduce or regress: (1) the query
  // stays a single tenant-scoped statement (not a per-company loop), and (2)
  // it returns every relationship_stage, not just 'active', since the admin
  // tab's Relationship filter still offers inactive / do_not_contact.
  it('lists hiring contacts across all companies in a single tenant-scoped query, all relationship stages included', async () => {
    const rows = [
      { id: 'poc-a', company_id: 'company-a', company_name: 'Acme', first_name: 'Asha', last_name: 'Rao', relationship_stage: 'active', active_requirement_count: 2 },
      { id: 'poc-b', company_id: 'company-b', company_name: 'Beta', first_name: 'Ravi', last_name: 'Iyer', relationship_stage: 'inactive', active_requirement_count: 0 },
    ];
    const fake = fakeQueryPool(() => ({ rows }));
    const service = createWizmatchStaffingService(fake.pool);

    const result = await service.listHiringContacts('tenant-a');

    // A FIXED number of queries — not one per company. It is 2 now (rows + a
    // count for the honest "first 1000 of N" denominator), which is still O(1)
    // in the number of companies. The assertion is the property, not the
    // literal: a per-company loop would scale with `rows`.
    expect(fake.calls.length).toBeLessThanOrEqual(2);
    expect(fake.calls.length).toBeLessThan(rows.length + 1);
    for (const call of fake.calls) {
      expect(call.params[0]).toBe('tenant-a');
      expect(call.sql).toContain('cc.tenant_id=$1');
    }
    const rowQuery = fake.calls[0];
    expect(rowQuery.sql).toContain('FROM wizmatch_company_contacts cc');
    // Must not restrict to active-only relationships (that filter is applied
    // client-side by the admin table so inactive/do_not_contact stay visible).
    expect(rowQuery.sql).not.toContain(`cc.relationship_stage='active'`);
    expect(rowQuery.sql).toContain('active_requirement_count');
    // Shape is now { items, total } so the page can distinguish "1000 loaded"
    // from "1000 of 4312 matching".
    expect(result.items).toEqual(rows);
    expect(typeof result.total).toBe('number');
  });

  // listCompanies had NO coverage before the `total` count query was added to it.
  // A count query is the easiest place to forget tenant scoping — it is written
  // separately from the row query and returns a bare number, so a leak shows up
  // as a slightly-too-large denominator rather than as visible foreign rows.
  it('scopes EVERY listCompanies query to the caller tenant, including the count', async () => {
    const fake = fakeQueryPool(() => ({ rows: [{ total: 3 }] }));
    const service = createWizmatchStaffingService(fake.pool);

    await service.listCompanies('tenant-a', 'acme');

    expect(fake.calls.length).toBeGreaterThan(0);
    for (const call of fake.calls) {
      expect(call.params[0]).toBe('tenant-a');
      expect(call.sql).toContain('c.tenant_id=$1');
      expect(call.params).toHaveLength(2);
    }
  });

  it('listCompanies applies the same search predicate to rows and to the count', async () => {
    // If the two predicates diverge, the denominator stops describing the
    // numerator — "showing 500 of 4312" where the 4312 counted something else.
    const fake = fakeQueryPool(() => ({ rows: [] }));
    const service = createWizmatchStaffingService(fake.pool);

    await service.listCompanies('tenant-a', 'acme');

    const countCall = fake.calls.find((c) => c.sql.includes('COUNT(*)'));
    expect(countCall, 'no count query issued').toBeTruthy();
    for (const call of fake.calls) {
      expect(call.sql).toContain("c.name ILIKE '%' || $2 || '%'");
      expect(call.params[1]).toBe('acme');
    }
  });

  it('listCompanies returns { items, total }, not a bare array', async () => {
    const rows = [{ id: 'c1', name: 'Acme' }];
    let call = 0;
    const fake = fakeQueryPool(() => (call++ === 0 ? { rows } : { rows: [{ total: 42 }] }));
    const service = createWizmatchStaffingService(fake.pool);

    const result = await service.listCompanies('tenant-a');

    expect(result.items).toEqual(rows);
    expect(result.total).toBe(42);
  });

  it('scopes listHiringContacts to the caller tenant and never accepts a tenant id from the query string', async () => {
    const fake = fakeQueryPool(() => ({ rows: [] }));
    const service = createWizmatchStaffingService(fake.pool);

    await service.listHiringContacts('tenant-a', 'anything');

    // EVERY query the service issues must be tenant-scoped, not just the first.
    for (const call of fake.calls) {
      expect(call.params[0]).toBe('tenant-a');
      // The signature only accepts (tenantId, search) — there is no code path
      // for a caller-supplied tenant id to reach the query.
      expect(call.params).toHaveLength(2);
      expect(call.sql).toContain('cc.tenant_id=$1');
    }
  });
});
