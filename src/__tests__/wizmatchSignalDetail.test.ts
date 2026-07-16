import { describe, expect, it, vi } from 'vitest';
import { getWizmatchSignalDetail, normalizePersistedPocCandidate, normalizeWizmatchSignalListItem, SIGNAL_DRAFTS_QUERY } from '../services/wizmatchSignalDetail';

describe('Wizmatch signal detail', () => {
  it('uses the real message timestamp and scopes every detail query to the tenant', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        queries.push({ sql, params });
        if (sql.includes('FROM wizmatch_job_signals')) return { rows: [{ id: 'signal-a', company_id: 'company-a', contact_id: 'contact-a', matched_candidate_ids: [] }] };
        if (sql.includes('FROM messages')) return { rows: [{ id: 'draft-a', created_at: '2026-07-14T10:00:00Z' }] };
        if (sql.includes('job_signal.qualified')) return { rows: [{ qualified_at: '2026-07-14T09:00:00Z', task_id: 'task-a', task_status: 'open', owner_user_id: 'user-a', due_at: '2026-07-15T09:00:00Z' }] };
        if (sql.includes('FROM wizmatch_requirements')) return { rows: [{ id: 'requirement-a', title: 'SAP ABAP', stage: 'draft' }] };
        if (sql.includes('FROM wizmatch_contact_candidates')) return { rows: Array.from({ length: 5 }, (_, index) => ({ id: `poc-${index}`, metadata: { pocState: index ? 'identified_channel_pending' : 'verified' } })) };
        return { rows: [] };
      }),
    };

    const detail = await getWizmatchSignalDetail('tenant-a', 'signal-a', db as any);
    expect(detail?.drafts).toHaveLength(1);
    expect(SIGNAL_DRAFTS_QUERY).toContain('sent_at AS created_at');
    expect(SIGNAL_DRAFTS_QUERY).toContain('ORDER BY sent_at DESC');
    expect(detail?.qualification).toMatchObject({ qualified: true, taskId: 'task-a', ownerUserId: 'user-a' });
    expect(detail?.linked_requirement_id).toBe('requirement-a');
    expect(detail?.poc_candidates).toHaveLength(3);
    expect(detail?.poc_candidates[0]).toMatchObject({ id: 'poc-0', state: 'verified' });
    expect(queries.every((query) => query.params.includes('tenant-a'))).toBe(true);
  });

  it('exposes persisted POC metadata as the top-level state consumed by Job Leads', () => {
    expect(normalizePersistedPocCandidate({ id: 'poc-a', metadata: { pocState: 'generic_contact_only' } }))
      .toMatchObject({ id: 'poc-a', state: 'generic_contact_only' });
    expect(normalizePersistedPocCandidate({ id: 'poc-b', metadata: {} }))
      .toMatchObject({ id: 'poc-b', state: 'pending_research' });
  });

  it('normalizes human qualification and linked requirement truth for list rows', () => {
    expect(normalizeWizmatchSignalListItem({
      id: 'signal-a', qualified: true, poc_task_id: 'task-a', poc_task_status: 'open',
      poc_task_due_at: '2026-07-15T09:00:00Z', linked_requirement_id: 'requirement-a',
      linked_requirement_title: 'SAP ABAP', linked_requirement_stage: 'draft',
    })).toMatchObject({
      qualification: { qualified: true, taskId: 'task-a', taskStatus: 'open' },
      linked_requirement: { id: 'requirement-a', title: 'SAP ABAP', stage: 'draft' },
    });
  });
});
