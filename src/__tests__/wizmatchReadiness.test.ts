import { describe, expect, it } from 'vitest';
import { evaluateWizmatchReadiness, type WizmatchTableReadiness } from '../services/wizmatchReadiness';

function table(
  name: string,
  count: number,
  options: { required?: boolean; label?: string; exists?: boolean } = {},
): WizmatchTableReadiness {
  const exists = options.exists ?? true;
  return {
    table: name,
    label: options.label || name,
    required: options.required ?? true,
    exists,
    count: exists ? count : null,
    latestAt: exists && count > 0 ? '2026-07-06T00:00:00.000Z' : null,
    status: exists ? (count > 0 ? 'ready' : 'needs_data') : 'needs_migration_check',
    reason: exists ? 'fixture' : 'missing',
  };
}

const healthyTables = [
  table('wizmatch_companies', 12),
  table('wizmatch_job_signals', 30),
  table('wizmatch_candidates', 25),
  table('wizmatch_requirements', 7),
  table('wizmatch_company_intelligence', 6),
  table('wizmatch_contact_candidates', 11),
  table('wizmatch_discovery_runs', 3),
  table('wizmatch_placements', 1, { required: false }),
  table('wizmatch_domain_health', 2),
  table('wizmatch_suppression_list', 1),
  table('contacts', 50),
  table('contact_channels', 80),
];

describe('Wizmatch Data Readiness', () => {
  it('returns ready output when required tables and live rows exist', () => {
    const result = evaluateWizmatchReadiness(healthyTables);

    expect(result.database.status).toBe('connected');
    expect(result.overall.status).toBe('ready');
    expect(result.overall.score).toBe(100);
    expect(result.modules.every((module) => module.status === 'ready')).toBe(true);
    expect(result.guardedItems).toContain('Automatic outreach sending remains blocked.');
  });

  it('reports missing Contact Intelligence tables without throwing', () => {
    const result = evaluateWizmatchReadiness([
      ...healthyTables.filter((item) => !['wizmatch_company_intelligence', 'wizmatch_contact_candidates'].includes(item.table)),
      table('wizmatch_company_intelligence', 0, { exists: false }),
      table('wizmatch_contact_candidates', 0, { exists: false }),
    ]);

    expect(result.overall.status).toBe('needs_migration_check');
    expect(result.overall.primaryIssue).toContain('Missing required table');
    expect(result.modules.find((module) => module.module === 'contact_intelligence')?.status).toBe('needs_migration_check');
  });

  it('surfaces needs-data when schema exists but live records are empty', () => {
    const result = evaluateWizmatchReadiness(healthyTables.map((item) => ({ ...item, count: 0, latestAt: null, status: 'needs_data' as const })));

    expect(result.overall.status).toBe('needs_data');
    expect(result.modules.find((module) => module.module === 'client_discovery')?.reason).toContain('No company/job-signal data');
    expect(result.modules.find((module) => module.module === 'guardrails')?.status).toBe('needs_data');
    expect(result.operatorNotes.some((note) => note.includes('/wizmatch/readiness'))).toBe(true);
  });
});
