import { describe, expect, it, vi } from 'vitest';
import { calculateCandidateRequirementMatch, createWizmatchMatchingService } from '../services/wizmatchMatchingDomain';

const skills = {
  abap: { id: 'abap', family: 'SAP', specialization: 'ABAP', canonicalLabel: 'SAP ABAP' },
  fico: { id: 'fico', family: 'SAP', specialization: 'FICO', canonicalLabel: 'SAP FICO' },
  java: { id: 'java', family: 'Java', specialization: 'Java', canonicalLabel: 'Java' },
  javascript: { id: 'javascript', family: 'JavaScript', specialization: 'JavaScript', canonicalLabel: 'JavaScript' },
};

type TestSkill = typeof skills.abap & { allowBroadFamily?: boolean };
function input(required: TestSkill, candidate: TestSkill) {
  return {
    requirement: { location: 'Pune', workMode: 'hybrid', normalizedBudgetMaxAnnual: 2_000_000, skills: [{ ...required, importance: 'mandatory', minimumYears: 3 }] },
    candidate: { availabilityStatus: 'available', location: 'Pune', normalizedAnnualRate: 1_500_000, skills: [{ ...candidate, experienceYears: 5, evidence: 'Project evidence', lastUsedAt: '2026-06-01', verified: true }] },
  };
}

describe('Gate B matching', () => {
  it('scores a verified exact match with explainable dimensions', () => {
    const result = calculateCandidateRequirementMatch(input(skills.abap, skills.abap));
    expect(result.blockers).toEqual([]);
    // input() specifies zero preferred skills, so preferredSkills correctly
    // scores 0 (not the old default-to-full-marks 15 — see H15): 50
    // mandatory + 0 preferred + 15 evidence + 8 location + 7 availability +
    // 5 commercial = 85. Was previously asserted as >=90 back when an empty
    // preferred list silently scored full marks for criteria that were
    // never actually specified.
    expect(result.score).toBe(85);
    expect(result.dimensions.mandatorySkills).toBe(50);
    expect(result.dimensions.preferredSkills).toBe(0);
  });

  it('awards preferredSkills points only when preferred skills are actually specified and matched', () => {
    const data = input(skills.java, skills.java);
    data.requirement.skills.push({ ...skills.javascript, importance: 'preferred' } as never);
    data.candidate.skills.push({ ...skills.javascript, experienceYears: 5, evidence: 'e', lastUsedAt: '2026-06-01', verified: true } as never);
    const result = calculateCandidateRequirementMatch(data);
    expect(result.dimensions.preferredSkills).toBe(15);
    expect(result.score).toBe(100);
  });

  it('keeps SAP ABAP and SAP FICO separate by default', () => {
    const result = calculateCandidateRequirementMatch(input(skills.abap, skills.fico));
    expect(result.score).toBe(0);
    expect(result.blockers).toContain('missing_mandatory:SAP ABAP');
  });

  it('keeps Java and JavaScript separate', () => {
    const result = calculateCandidateRequirementMatch(input(skills.java, skills.javascript));
    expect(result.score).toBe(0);
    expect(result.blockers).toContain('missing_mandatory:Java');
  });

  it('allows broad-family matching only when visibly configured', () => {
    const result = calculateCandidateRequirementMatch(input({ ...skills.abap, allowBroadFamily: true }, skills.fico));
    expect(result.blockers).toEqual([]);
  });

  it('blocks location, availability and commercial failures before scoring', () => {
    const data = input(skills.java, skills.java);
    data.candidate.location = 'Delhi';
    data.candidate.availabilityStatus = 'placed';
    data.candidate.normalizedAnnualRate = 3_000_000;
    const result = calculateCandidateRequirementMatch(data);
    expect(result.score).toBe(0);
    expect(result.blockers).toEqual(expect.arrayContaining(['location', 'availability', 'commercial']));
  });

  it('shows missing evidence instead of awarding evidence points', () => {
    const data = input(skills.java, skills.java);
    data.candidate.skills[0].evidence = null as unknown as string;
    data.candidate.skills[0].lastUsedAt = null as unknown as string;
    const result = calculateCandidateRequirementMatch(data);
    expect(result.missingEvidence).toEqual(expect.arrayContaining(['skill_evidence:Java', 'recency:Java']));
    expect(result.dimensions.experienceRecencyEvidence).toBeLessThan(15);
  });
});

// ---------------------------------------------------------------------------
// H16: replaceRequirementSkills/replaceCandidateSkills lock the row with
// SELECT ... FOR UPDATE (not a plain existence check) before deleting and
// re-inserting the join-table rows — closing the writer-vs-writer race where
// two concurrent edits under READ COMMITTED could each DELETE from a
// snapshot that predates the other's commit, leaving the join table as the
// union of both edits. createWizmatchMatchingService takes an injectable
// dbPool, so this is testable without mocking the module import.
// ---------------------------------------------------------------------------
function makeFakeDbPool(queryImpl: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount?: number }>) {
  const calls: string[] = [];
  const client = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push(sql);
      const result = await queryImpl(sql, params);
      // Mirror node-postgres: rowCount defaults to rows.length unless the
      // test explicitly overrides it (e.g. to simulate a 0-row "not found").
      return { rowCount: result.rows.length, ...result };
    },
    release: vi.fn(),
  };
  return { connect: async () => client, calls } as unknown as { connect: () => Promise<typeof client>; calls: string[] };
}

describe('H16 — row locking on skill replace', () => {
  it('replaceRequirementSkills locks the requirement row with FOR UPDATE before deleting join rows', async () => {
    const fakePool = makeFakeDbPool(async (sql) => {
      if (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK')) return { rows: [] };
      if (sql.includes('FOR UPDATE')) return { rows: [{ id: 'req-1' }] }; // the lock succeeds
      if (sql.startsWith('DELETE')) return { rows: [] };
      if (sql.startsWith('UPDATE')) return { rows: [] };
      if (sql.startsWith('INSERT INTO wizmatch_staffing_events')) return { rows: [] };
      return { rows: [] };
    });
    const service = createWizmatchMatchingService(fakePool as never);

    await service.replaceRequirementSkills({ tenantId: 'tenant-1', userId: 'user-1' }, 'req-1', []);

    const lockCall = fakePool.calls.find((sql) => sql.includes('wizmatch_requirements') && sql.includes('FOR UPDATE'));
    expect(lockCall).toBeDefined();
    // The lock must be acquired BEFORE the DELETE that clears the join table.
    const lockIdx = fakePool.calls.findIndex((sql) => sql.includes('FOR UPDATE'));
    const deleteIdx = fakePool.calls.findIndex((sql) => sql.startsWith('DELETE FROM wizmatch_requirement_skills'));
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(deleteIdx).toBeGreaterThan(lockIdx);
  });

  it('replaceRequirementSkills throws 404 without deleting anything when the requirement is not found under FOR UPDATE', async () => {
    const fakePool = makeFakeDbPool(async (sql) => {
      if (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK')) return { rows: [] };
      if (sql.includes('FOR UPDATE')) return { rows: [] }; // not found / not visible to this tenant
      return { rows: [] };
    });
    const service = createWizmatchMatchingService(fakePool as never);

    await expect(service.replaceRequirementSkills({ tenantId: 'tenant-1', userId: 'user-1' }, 'req-missing', []))
      .rejects.toThrow('Referenced record was not found');
    expect(fakePool.calls.some((sql) => sql.startsWith('DELETE'))).toBe(false);
  });

  it('replaceCandidateSkills locks the candidate row with FOR UPDATE before deleting join rows', async () => {
    const fakePool = makeFakeDbPool(async (sql) => {
      if (sql.includes('BEGIN') || sql.includes('COMMIT') || sql.includes('ROLLBACK')) return { rows: [] };
      if (sql.includes('FOR UPDATE')) return { rows: [{ id: 'cand-1' }] };
      return { rows: [] };
    });
    const service = createWizmatchMatchingService(fakePool as never);

    await service.replaceCandidateSkills({ tenantId: 'tenant-1', userId: 'user-1' }, 'cand-1', []);

    const lockCall = fakePool.calls.find((sql) => sql.includes('wizmatch_candidates') && sql.includes('FOR UPDATE'));
    expect(lockCall).toBeDefined();
  });
});
