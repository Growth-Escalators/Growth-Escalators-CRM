import { describe, expect, it } from 'vitest';
import {
  requireCandidateAccess,
  requireRequirementAccess,
  resolveStaffingAccess,
} from '../services/wizmatchStaffingAccess';

const actor = (role = 'staff', userId = 'user-1') => ({ tenantId: 'tenant-1', userId, role });

describe('Wizmatch staffing pilot access', () => {
  it('fails closed in production when no named roster is configured', () => {
    const access = resolveStaffingAccess(actor('admin'), { NODE_ENV: 'production' });
    expect(access.allowed).toBe(false);
    expect(access.configured).toBe(false);
  });

  it('allows only named eligible users unless the expansion switch is explicit', () => {
    const env = { NODE_ENV: 'production', WIZMATCH_STAFFING_PILOT_USER_IDS: 'user-1,user-2' };
    expect(resolveStaffingAccess(actor('staff', 'user-1'), env).allowed).toBe(true);
    expect(resolveStaffingAccess(actor('staff', 'user-3'), env).allowed).toBe(false);
    expect(resolveStaffingAccess(actor('viewer', 'user-1'), env).allowed).toBe(false);
    expect(resolveStaffingAccess(actor('staff', 'user-3'), { NODE_ENV: 'production', WIZMATCH_STAFFING_PILOT_ALL_USERS: 'true' }).allowed).toBe(true);
  });

  it('returns the approved role capability matrix without exposing the roster', () => {
    const recruiter = resolveStaffingAccess(actor('staff'), {});
    const lead = resolveStaffingAccess(actor('team_lead'), {});
    const admin = resolveStaffingAccess(actor('admin'), {});
    expect(recruiter.capabilities.approveSubmissions).toBe(false);
    expect(recruiter.capabilities.manageCandidateEvidence).toBe(true);
    expect(lead.capabilities.viewCommercial).toBe(true);
    expect(lead.capabilities.manageFinance).toBe(false);
    expect(admin.capabilities.manageFinance).toBe(true);
    expect(recruiter).not.toHaveProperty('pilotUserIds');
  });

  it('requires recruiters and account owners to be assigned to the exact requirement', async () => {
    const allowedDb = { query: async () => ({ rowCount: 1, rows: [{ '?column?': 1 }] }) } as any;
    const deniedDb = { query: async () => ({ rowCount: 0, rows: [] }) } as any;
    await expect(requireRequirementAccess(allowedDb, actor('staff'), 'requirement-1')).resolves.toBeTruthy();
    await expect(requireRequirementAccess(deniedDb, actor('staff'), 'requirement-2')).rejects.toMatchObject({ code: 'requirement_assignment_required' });
    await expect(requireRequirementAccess(deniedDb, actor('sales'), 'requirement-2')).rejects.toMatchObject({ code: 'requirement_assignment_required' });
    await expect(requireRequirementAccess(deniedDb, actor('team_lead'), 'requirement-2')).resolves.toBeTruthy();
  });

  it('limits recruiter candidate access to candidates matched to assigned work', async () => {
    const allowedDb = { query: async () => ({ rowCount: 1, rows: [{ '?column?': 1 }] }) } as any;
    const deniedDb = { query: async () => ({ rowCount: 0, rows: [] }) } as any;
    await expect(requireCandidateAccess(allowedDb, actor('staff'), 'candidate-1')).resolves.toBeTruthy();
    await expect(requireCandidateAccess(deniedDb, actor('staff'), 'candidate-2')).rejects.toMatchObject({ code: 'candidate_assignment_required' });
    await expect(requireCandidateAccess(allowedDb, actor('sales'), 'candidate-1')).rejects.toMatchObject({ code: 'forbidden' });
  });
});
