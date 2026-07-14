import type { Pool } from 'pg';

export type WizmatchReadinessStatus = 'ready' | 'needs_data' | 'needs_migration_check' | 'blocked';

export interface WizmatchTableReadiness {
  table: string;
  label: string;
  required: boolean;
  exists: boolean;
  count: number | null;
  latestAt: string | null;
  status: WizmatchReadinessStatus;
  reason: string;
}

export interface WizmatchModuleReadiness {
  module: string;
  label: string;
  status: WizmatchReadinessStatus;
  score: number;
  reason: string;
  counts: Record<string, number>;
  nextStep: string;
}

export interface WizmatchReadinessResult {
  generatedAt: string;
  database: {
    status: 'connected' | 'error';
    reason: string;
  };
  overall: {
    status: WizmatchReadinessStatus;
    schemaStatus: 'ready' | 'needs_migration_check' | 'blocked';
    usableFunnelStatus: WizmatchReadinessStatus;
    score: number;
    primaryIssue: string;
  };
  tables: WizmatchTableReadiness[];
  modules: WizmatchModuleReadiness[];
  operatorNotes: string[];
  guardedItems: string[];
}

type TableConfig = {
  table: string;
  label: string;
  required: boolean;
  createdColumn?: string;
  updatedColumn?: string;
};

const TABLES: TableConfig[] = [
  { table: 'wizmatch_companies', label: 'Companies', required: true, updatedColumn: 'updated_at' },
  { table: 'wizmatch_job_signals', label: 'Job signals', required: true },
  { table: 'wizmatch_candidates', label: 'Candidates', required: true, updatedColumn: 'updated_at' },
  { table: 'wizmatch_requirements', label: 'Requirements', required: true, updatedColumn: 'updated_at' },
  { table: 'wizmatch_company_intelligence', label: 'Company intelligence', required: true, updatedColumn: 'updated_at' },
  { table: 'wizmatch_contact_candidates', label: 'Contact candidates', required: true, updatedColumn: 'updated_at' },
  { table: 'wizmatch_discovery_runs', label: 'Discovery runs', required: true },
  { table: 'wizmatch_placements', label: 'Placements', required: false, updatedColumn: 'updated_at' },
  { table: 'wizmatch_domain_health', label: 'Domain health', required: true },
  { table: 'wizmatch_suppression_list', label: 'Suppressions', required: true, createdColumn: 'suppressed_at' },
  { table: 'contacts', label: 'CRM contacts', required: true, updatedColumn: 'updated_at' },
  { table: 'contact_channels', label: 'CRM contact channels', required: true },
];

const GUARDED_ITEMS = [
  'Paid Apollo/Snov/Reacher discovery is disabled unless preview, caps, and env enablement pass.',
  'Google fallback discovery is disabled unless explicitly enabled and earlier discovery paths fail.',
  'Automatic outreach sending remains blocked.',
  'Automatic candidate submission remains blocked.',
  'Legacy Wizmatch sourcing, enrichment, scraper, importer, digest, and warmup automation remains blocked.',
  'Production migrations require explicit approval.',
];

function quoteIdent(identifier: string) {
  if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

function statusWeight(status: WizmatchReadinessStatus) {
  if (status === 'ready') return 100;
  if (status === 'needs_data') return 55;
  if (status === 'needs_migration_check') return 25;
  return 0;
}

function minStatus(statuses: WizmatchReadinessStatus[]): WizmatchReadinessStatus {
  if (statuses.includes('blocked')) return 'blocked';
  if (statuses.includes('needs_migration_check')) return 'needs_migration_check';
  if (statuses.includes('needs_data')) return 'needs_data';
  return 'ready';
}

function byTable(tables: WizmatchTableReadiness[]) {
  return new Map(tables.map((table) => [table.table, table]));
}

function tableCount(map: Map<string, WizmatchTableReadiness>, table: string) {
  return map.get(table)?.count ?? 0;
}

function tableStatus(map: Map<string, WizmatchTableReadiness>, table: string) {
  return map.get(table)?.status ?? 'needs_migration_check';
}

function moduleStatusFromTables(
  tableMap: Map<string, WizmatchTableReadiness>,
  requiredTables: string[],
  readyWhen: boolean,
) {
  const tableStatuses = requiredTables.map((table) => tableStatus(tableMap, table));
  const missing = tableStatuses.includes('needs_migration_check');
  if (missing) return 'needs_migration_check';
  return readyWhen ? 'ready' : 'needs_data';
}

function buildModule(
  tableMap: Map<string, WizmatchTableReadiness>,
  module: string,
  label: string,
  requiredTables: string[],
  counts: Record<string, number>,
  readyWhen: boolean,
  emptyReason: string,
  nextStep: string,
): WizmatchModuleReadiness {
  const status = moduleStatusFromTables(tableMap, requiredTables, readyWhen);
  const missingTables = requiredTables.filter((table) => !tableMap.get(table)?.exists);
  return {
    module,
    label,
    status,
    score: statusWeight(status),
    reason: status === 'ready'
      ? 'Real data is present for this module.'
      : status === 'needs_migration_check'
        ? `Missing table(s): ${missingTables.join(', ')}. Check migration state before relying on live data.`
        : emptyReason,
    counts,
    nextStep: status === 'ready' ? 'Use this module with logged-in live data.' : nextStep,
  };
}

export function evaluateWizmatchReadiness(
  tables: WizmatchTableReadiness[],
  databaseStatus: WizmatchReadinessResult['database'] = { status: 'connected', reason: 'Database query completed.' },
): WizmatchReadinessResult {
  const tableMap = byTable(tables);
  const companies = tableCount(tableMap, 'wizmatch_companies');
  const signals = tableCount(tableMap, 'wizmatch_job_signals');
  const candidates = tableCount(tableMap, 'wizmatch_candidates');
  const requirements = tableCount(tableMap, 'wizmatch_requirements');
  const companyIntel = tableCount(tableMap, 'wizmatch_company_intelligence');
  const contactCandidates = tableCount(tableMap, 'wizmatch_contact_candidates');
  const placements = tableCount(tableMap, 'wizmatch_placements');
  const domains = tableCount(tableMap, 'wizmatch_domain_health');
  const suppressions = tableCount(tableMap, 'wizmatch_suppression_list');
  const discoveryRuns = tableCount(tableMap, 'wizmatch_discovery_runs');
  const contacts = tableCount(tableMap, 'contacts');
  const channels = tableCount(tableMap, 'contact_channels');

  const modules = [
    buildModule(
      tableMap,
      'client_discovery',
      'Client Discovery',
      ['wizmatch_companies', 'wizmatch_job_signals', 'wizmatch_candidates', 'wizmatch_domain_health'],
      { companies, signals, candidates, domains },
      companies > 0 && signals > 0,
      'No company/job-signal data yet. Import or create IT/Tech signals before discovery can rank opportunities.',
      'Load Wizmatch companies and job signals, then refresh the Client Discovery queue.',
    ),
    buildModule(
      tableMap,
      'contact_intelligence',
      'Contact Intelligence',
      ['wizmatch_company_intelligence', 'wizmatch_contact_candidates', 'wizmatch_discovery_runs', 'contacts', 'contact_channels'],
      { companyIntel, contactCandidates, contacts, channels },
      companyIntel > 0 || contactCandidates > 0,
      'Contact Intelligence tables exist but have no review state yet.',
      'Send qualified companies from Client Discovery or create Contact Intelligence snapshots.',
    ),
    buildModule(
      tableMap,
      'candidate_intelligence',
      'Candidate Intelligence',
      ['wizmatch_candidates', 'contacts', 'contact_channels'],
      { candidates, contacts, channels },
      candidates > 0 && contacts > 0,
      'No candidate/contact data is available for readiness scoring.',
      'Import candidates and ensure each has a usable CRM contact/channel.',
    ),
    buildModule(
      tableMap,
      'requirement_priority',
      'Requirement Priority',
      ['wizmatch_requirements', 'wizmatch_candidates'],
      { requirements, candidates },
      requirements > 0,
      'No open requirements exist yet.',
      'Create or upload an IT/Tech requirement, then prepare the review plan.',
    ),
    buildModule(
      tableMap,
      'review_workbench',
      'Review Workbench',
      ['wizmatch_companies', 'wizmatch_job_signals', 'wizmatch_candidates', 'wizmatch_requirements'],
      { companies, signals, candidates, requirements, companyIntel, contactCandidates },
      signals > 0 || candidates > 0 || requirements > 0 || companyIntel > 0 || contactCandidates > 0,
      'The workbench has no live action inputs yet.',
      'Populate at least one signal, candidate, requirement, or Contact Intelligence review item.',
    ),
    buildModule(
      tableMap,
      'analytics',
      'Analytics / ROI',
      ['wizmatch_job_signals', 'wizmatch_candidates', 'wizmatch_requirements', 'wizmatch_placements'],
      { signals, candidates, requirements, placements },
      signals > 0 || candidates > 0 || requirements > 0 || placements > 0,
      'Analytics is available but will be mostly zero until live Wizmatch activity exists.',
      'Validate source counts first, then review funnel and ROI recommendations.',
    ),
    buildModule(
      tableMap,
      'guardrails',
      'Guardrails',
      ['wizmatch_domain_health', 'wizmatch_suppression_list', 'wizmatch_discovery_runs'],
      { domains, suppressions, discoveryRuns },
      domains > 0 || suppressions > 0 || discoveryRuns > 0,
      'Guardrail tables are present, but no domain/suppression data has been loaded yet.',
      'Seed domain health and suppression records before increasing volume.',
    ),
  ];

  const requiredTables = tables.filter((table) => table.required);
  const missingRequired = requiredTables.filter((table) => !table.exists);
  const emptyRequired = requiredTables.filter((table) => table.exists && (table.count ?? 0) === 0);
  const moduleStatuses = modules.map((module) => module.status);
  const overallStatus = databaseStatus.status === 'error'
    ? 'blocked'
    : missingRequired.length > 0
      ? 'needs_migration_check'
      : minStatus(moduleStatuses);
  const schemaStatus = databaseStatus.status === 'error'
    ? 'blocked'
    : missingRequired.length > 0
      ? 'needs_migration_check'
      : 'ready';
  const usableFunnelStatus = databaseStatus.status === 'error'
    ? 'blocked'
    : minStatus(moduleStatuses);
  const score = databaseStatus.status === 'error'
    ? 0
    : Math.round(modules.reduce((sum, module) => sum + module.score, 0) / Math.max(1, modules.length));
  const primaryIssue = databaseStatus.status === 'error'
    ? databaseStatus.reason
    : missingRequired.length > 0
      ? `Missing required table(s): ${missingRequired.map((table) => table.table).join(', ')}.`
      : emptyRequired.length > 0
        ? `Live schema is present, but ${emptyRequired[0].label} has no rows yet.`
        : modules.find((module) => module.status !== 'ready')?.reason || 'Wizmatch live data is ready for logged-in review.';

  return {
    generatedAt: new Date().toISOString(),
    database: databaseStatus,
    overall: { status: overallStatus, schemaStatus, usableFunnelStatus, score, primaryIssue },
    tables,
    modules,
    operatorNotes: [
      'Open /wizmatch/readiness first when validating live data.',
      'Demo pages are labeled demo mode and use fixed sample data.',
      'Live pages require CRM login and protected /api/wizmatch routes.',
      'Schema readiness and usable-funnel readiness are reported separately; existing tables alone do not make the funnel usable.',
      'Empty states should explain whether data, migration, auth, or review input is missing.',
    ],
    guardedItems: GUARDED_ITEMS,
  };
}

async function readTable(pool: Pool, tenantId: string, config: TableConfig): Promise<WizmatchTableReadiness> {
  const existsResult = await pool.query<{ exists: string | null }>('SELECT to_regclass($1) AS exists', [`public.${config.table}`]);
  const exists = Boolean(existsResult.rows[0]?.exists);
  if (!exists) {
    return {
      table: config.table,
      label: config.label,
      required: config.required,
      exists: false,
      count: null,
      latestAt: null,
      status: config.required ? 'needs_migration_check' : 'needs_data',
      reason: config.required ? 'Required table is missing.' : 'Optional table is missing.',
    };
  }

  const tableName = quoteIdent(config.table);
  const createdColumn = quoteIdent(config.createdColumn || 'created_at');
  const updatedColumn = config.updatedColumn ? quoteIdent(config.updatedColumn) : null;
  const latestExpr = updatedColumn
    ? `GREATEST(COALESCE(MAX(${createdColumn}), 'epoch'::timestamp), COALESCE(MAX(${updatedColumn}), 'epoch'::timestamp))`
    : `MAX(${createdColumn})`;
  const countResult = await pool.query<{ count: number | string; latest_at: Date | string | null }>(
    `SELECT COUNT(*)::int AS count, ${latestExpr} AS latest_at FROM ${tableName} WHERE tenant_id = $1`,
    [tenantId],
  );
  const count = Number(countResult.rows[0]?.count ?? 0);
  const latestAt = countResult.rows[0]?.latest_at ? new Date(countResult.rows[0].latest_at).toISOString() : null;

  return {
    table: config.table,
    label: config.label,
    required: config.required,
    exists: true,
    count,
    latestAt,
    status: count > 0 ? 'ready' : 'needs_data',
    reason: count > 0 ? 'Live rows found.' : 'Table exists but no tenant-scoped rows were found.',
  };
}

export async function getWizmatchReadiness(pool: Pool, tenantId: string): Promise<WizmatchReadinessResult> {
  try {
    const tables = await Promise.all(TABLES.map((config) => readTable(pool, tenantId, config)));
    return evaluateWizmatchReadiness(tables, { status: 'connected', reason: 'Database query completed.' });
  } catch (error) {
    return evaluateWizmatchReadiness(
      TABLES.map((config) => ({
        table: config.table,
        label: config.label,
        required: config.required,
        exists: false,
        count: null,
        latestAt: null,
        status: 'blocked',
        reason: 'Database readiness query failed.',
      })),
      { status: 'error', reason: error instanceof Error ? error.message : 'Database readiness query failed.' },
    );
  }
}
