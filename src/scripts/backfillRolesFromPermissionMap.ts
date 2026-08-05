/**
 * One-time, idempotent backfill: seeds the 8 legacy PERMISSION_MAP role names
 * as `is_system = true` rows in the new `roles` table (one set per tenant),
 * populates `role_permissions` for each from a derived mapping, and maps
 * every existing `users.role` (text) to the matching new `users.role_id`.
 *
 * SAFE BY DEFAULT: dry-run only unless `--apply` is passed. Idempotent: a
 * second `--apply` run only inserts what's still missing (role lookups by
 * `(tenant_id, key)`, role_permissions by `(role_id, permission)`, and users
 * are only updated where `role_id IS NULL` — an already-mapped user is left
 * alone on rerun).
 *
 * DO NOT RUN THIS WITH --apply AGAINST PRODUCTION FROM AN AGENT SESSION.
 * This PR does not wire `role_id` into any authorization check — nothing
 * reads it yet — so running --apply changes no observable behavior today,
 * but it IS a real write to production data and therefore still needs
 * explicit owner sign-off per AGENTS.md / ge-prod-data-mutation.
 *
 * Usage (dry run — the only mode this session may execute):
 *   DATABASE_URL=... npx tsx src/scripts/backfillRolesFromPermissionMap.ts
 *
 * Usage (apply — requires explicit owner approval; NEVER run from an agent
 * session without it):
 *   DATABASE_URL=... npx tsx src/scripts/backfillRolesFromPermissionMap.ts --apply
 *
 * ---------------------------------------------------------------------
 * ON THE MAPPING BELOW — an important, honest caveat for reviewers.
 * ---------------------------------------------------------------------
 * `PERMISSION_MAP_SNAPSHOT` is a deliberate, hand-copied point-in-time
 * snapshot of src/middleware/rbac.ts's PERMISSION_MAP, NOT an import. That
 * file is a guardrail path this PR must not touch (AGENTS.md), and
 * PERMISSION_MAP isn't exported today — adding an export would itself be a
 * change to a file this PR is instructed to leave alone. If rbac.ts's map
 * changes before this script is ever run for real, update this snapshot to
 * match first.
 *
 * `PERMISSION_MAP` documents an INTENDED authorization model, but the repo's
 * own audit (see this PR's description) found only 14 of its 33 keys are
 * actually checked by any route today — contacts.ts, deals.ts, pipelines.ts
 * (except 3 admin-only maintenance routes), finance.ts, sequences.ts and
 * social.ts currently enforce NOTHING beyond "is logged in", for ANY role.
 * `LEGACY_TO_NEW` below carries forward the DOCUMENTED model (what SHOULD
 * gate each capability) rather than today's unenforced reality, because
 * that's what makes the eventual route-wiring cutover meaningful — wiring a
 * module to requirePerm and finding role_permissions already matches
 * PERMISSION_MAP's intent is the whole point of doing this now instead of
 * inventing a policy from scratch later.
 *
 * For registry keys with NO legacy counterpart at all (Finance, Billing,
 * Branding, Integrations, Settings/Team-management, and a few Pipeline/
 * Ads/Social/Sequences splits), `EXTRA_DEFAULT_GRANTS` supplies a reasonable
 * starting point instead, documented inline per key. Three of those
 * (`finance.payroll.*`, `finance.leave.approve`, `finance.pnl.view`)
 * DELIBERATELY default narrower than today's real (nonexistent) gating —
 * see the comment on EXTRA_DEFAULT_GRANTS for why.
 *
 * A human should review every default below before any future PR relies on
 * it to wire a real route.
 */
import 'dotenv/config';
import { Pool } from 'pg';
import type { Permission } from '../config/permissions';

export const SYSTEM_ROLE_KEYS = [
  'admin',
  'manager_ops',
  'manager_ads',
  'team_lead',
  'sales',
  'staff',
  'creative_assistant',
  'viewer',
] as const;
export type SystemRoleKey = typeof SYSTEM_ROLE_KEYS[number];

export const SYSTEM_ROLE_NAMES: Record<SystemRoleKey, string> = {
  admin: 'Admin',
  manager_ops: 'Ops Manager',
  manager_ads: 'Ads Manager',
  team_lead: 'Team Lead',
  sales: 'Sales',
  staff: 'Staff',
  creative_assistant: 'Creative Assistant',
  viewer: 'Viewer (read-only)',
};

const ALL_NON_VIEWER: SystemRoleKey[] = ['admin', 'manager_ops', 'manager_ads', 'team_lead', 'sales', 'staff', 'creative_assistant'];

// Hand-copied snapshot of src/middleware/rbac.ts's PERMISSION_MAP as of this
// PR (2026-08). See the file header for why this is a copy, not an import.
const PERMISSION_MAP_SNAPSHOT: Record<string, SystemRoleKey[]> = {
  CONTACTS_VIEW: ['admin', 'manager_ops', 'team_lead', 'sales', 'viewer'],
  CONTACTS_EXPORT: ['admin'],
  CONTACTS_BULK_DELETE: ['admin'],
  DEALS_VIEW: ['admin', 'manager_ops', 'team_lead', 'sales', 'viewer'],
  DEALS_EDIT: ['admin', 'manager_ops', 'team_lead', 'sales'],
  QUALIFICATION_VIEW: ['admin', 'manager_ops', 'team_lead', 'sales', 'viewer'],
  SEQUENCES_VIEW: ['admin', 'manager_ops', 'team_lead', 'sales', 'viewer'],
  SEQUENCES_EDIT: ['admin', 'manager_ops', 'team_lead'],
  AUTOMATIONS_VIEW: ['admin', 'manager_ops', 'team_lead', 'sales', 'viewer'],
  AUTOMATIONS_EDIT: ['admin', 'manager_ops', 'team_lead'],
  ADS_VIEW: ['admin', 'manager_ads', 'team_lead', 'creative_assistant', 'viewer'],
  ADS_MANAGE: ['admin', 'manager_ads', 'team_lead', 'creative_assistant'],
  REPORTS_VIEW: ['admin', 'manager_ops', 'manager_ads', 'viewer'],
  SOCIAL_VIEW: ['admin', 'manager_ops', 'team_lead', 'staff', 'creative_assistant', 'viewer'],
  SOCIAL_POST: ['admin', 'manager_ops', 'team_lead', 'staff', 'creative_assistant'],
  INBOX_VIEW: ['admin', 'manager_ops', 'team_lead', 'sales', 'creative_assistant', 'viewer'],
  BILLING_VIEW: ['admin'],
  HEALTH_VIEW: ['admin', 'manager_ops', 'team_lead', 'sales', 'viewer'],
  PERMISSIONS_VIEW: ['admin'],
  AUDIT_VIEW: ['admin'],
  MARKETING_VIEW: ['admin', 'manager_ads', 'viewer'],
  MARKETING_MANAGE: ['admin', 'manager_ads'],
  DISCOVERY_VIEW: ['admin', 'manager_ops', 'team_lead', 'sales', 'viewer'],
  CONTRACTS_VIEW: ['admin', 'manager_ops', 'team_lead', 'sales', 'viewer'],
  CONTRACTS_CREATE: ['admin', 'manager_ops', 'team_lead'],
  CONTRACTS_EDIT: ['admin', 'manager_ops', 'team_lead'],
  CONTRACTS_SEND: ['admin', 'manager_ops'],
  CONTRACTS_APPROVE: ['admin'],
  CONTRACTS_SIGN: ['admin', 'manager_ops', 'team_lead'],
  CONTRACTS_VOID: ['admin'],
  CONTRACTS_DOWNLOAD: ['admin', 'manager_ops', 'team_lead', 'viewer'],
  CONTRACTS_VIEW_AUDIT: ['admin', 'manager_ops'],
  CONTRACTS_MANAGE_TEMPLATES: ['admin'],
};

// legacy PERMISSION_MAP key -> new registry key(s) it corresponds to. Built by
// reading each route file (see src/config/permissions.ts's own header for the
// full list) — using REAL confirmed `requirePermission(...)` call sites where
// they exist (marketing.ts, analytics.ts, audit.ts, esign.routes.ts) and the
// DOCUMENTED-but-unenforced model elsewhere (see file header).
const LEGACY_TO_NEW: Record<string, Permission[]> = {
  CONTACTS_VIEW: ['contacts.view'],
  CONTACTS_EXPORT: ['contacts.export'],
  CONTACTS_BULK_DELETE: ['contacts.delete'],
  DEALS_VIEW: ['deals.view', 'pipeline.view'],
  DEALS_EDIT: ['deals.edit', 'deals.create', 'pipeline.manage'],
  QUALIFICATION_VIEW: ['deals.view'],
  SEQUENCES_VIEW: ['sequences.view'],
  SEQUENCES_EDIT: ['sequences.manage', 'sequences.enrol', 'sequences.enrolments.remove'],
  AUTOMATIONS_VIEW: ['automations.view'],
  // AUTOMATIONS_EDIT has no new-registry equivalent — automationHub.ts is a
  // read-only aggregate dashboard today with no edit/trigger route.
  AUTOMATIONS_EDIT: [],
  ADS_VIEW: ['ads.view'],
  // Real: marketing.ts's approve-removal/reactivate routes use
  // requirePermission('ADS_MANAGE') today.
  ADS_MANAGE: ['ads.accounts.manage', 'ads.campaigns.manage', 'ads.settings.manage', 'ads.slack_notify', 'marketing.accounts.approve_removal'],
  // Real: every analytics.ts route uses requirePermission('REPORTS_VIEW').
  REPORTS_VIEW: ['reports.analytics.view'],
  SOCIAL_VIEW: ['social.view'],
  SOCIAL_POST: ['social.post', 'social.connect', 'social.library.manage', 'social.lead_forms.manage'],
  INBOX_VIEW: ['inbox.view'],
  // Best-effort baseline only — billing.ts's REAL gate today is the separate,
  // untouched user_permissions boolean table (billingView/billingCreate/...),
  // not PERMISSION_MAP. BILLING_VIEW is itself unwired to any billing.ts
  // route. Kept as the closest documented precedent anyway.
  BILLING_VIEW: ['billing.clients.view', 'billing.invoices.view', 'billing.retainers.view', 'billing.payments.view'],
  HEALTH_VIEW: ['system_health.view'],
  PERMISSIONS_VIEW: ['settings.team.view'],
  // Real: both GET /events and GET /export use requirePermission('AUDIT_VIEW')
  // today (export ALSO has a hardcoded `role !== 'admin'` check stacked on
  // top, but AUDIT_VIEW's array is already admin-only, so it's redundant).
  AUDIT_VIEW: ['audit.view', 'audit.export'],
  // Real: marketing.ts's GET /accounts and POST /accounts/:id/request-removal
  // use requirePermission('MARKETING_VIEW') today.
  MARKETING_VIEW: ['marketing.accounts.view', 'marketing.accounts.request_removal'],
  // Real: marketing.ts's POST /accounts and PATCH /accounts/:id (incl.
  // notify-slack) use requirePermission('MARKETING_MANAGE') today.
  MARKETING_MANAGE: ['marketing.accounts.manage'],
  DISCOVERY_VIEW: ['discovery.view'],
  CONTRACTS_VIEW: ['contracts.view'],
  // Real: esign.routes.ts's template-listing routes (GET /templates, GET
  // /templates/documenso) use requirePermission('CONTRACTS_CREATE') today,
  // not CONTRACTS_MANAGE_TEMPLATES (which is itself unused by any route).
  CONTRACTS_CREATE: ['contracts.create', 'contracts.manage_templates'],
  CONTRACTS_EDIT: ['contracts.edit'],
  CONTRACTS_SEND: ['contracts.send'],
  CONTRACTS_APPROVE: ['contracts.approve'],
  CONTRACTS_SIGN: ['contracts.sign'],
  CONTRACTS_VOID: ['contracts.void'],
  CONTRACTS_DOWNLOAD: ['contracts.download'],
  CONTRACTS_VIEW_AUDIT: ['contracts.view_audit'],
  // Vestigial in the legacy map itself — see CONTRACTS_CREATE above.
  CONTRACTS_MANAGE_TEMPLATES: [],
};

// Registry keys with NO legacy PERMISSION_MAP counterpart at all. Grouped by
// module with the reasoning for each default. `ALL_NON_VIEWER` mirrors
// today's REAL (unenforced) reality for a route file that currently checks
// nothing — see the file header. Narrower defaults are called out inline.
const EXTRA_DEFAULT_GRANTS: Partial<Record<Permission, SystemRoleKey[]>> = {
  // contacts.ts / deals.ts: zero gating today, for any of these routes.
  'contacts.import': ALL_NON_VIEWER,
  'contacts.bulk': ALL_NON_VIEWER,
  'deals.bulk': ALL_NON_VIEWER,
  'deals.export': ALL_NON_VIEWER,
  // pipelines.ts: REAL inline gate — `user?.role !== 'admin'` on
  // /diagnose, /backfill-all, /backfill-from-deals.
  'pipeline.backfill': ['admin'],

  // finance.ts: zero gating today, for any route.
  'finance.expenses.view': ALL_NON_VIEWER,
  'finance.expenses.manage': ALL_NON_VIEWER,
  'finance.expenses.export': ALL_NON_VIEWER,
  'finance.income.view': ALL_NON_VIEWER,
  'finance.income.manage': ALL_NON_VIEWER,
  'finance.attendance.manage': ALL_NON_VIEWER,
  'finance.leave.view': ALL_NON_VIEWER,
  'finance.leave.request': ALL_NON_VIEWER,
  'finance.reports.view': ALL_NON_VIEWER,
  // DELIBERATE EXCEPTION: unlike everything else in this file, these four do
  // NOT mirror today's (nonexistent) gate. finance.ts checks nothing, so
  // "parity" would mean every role including staff/creative_assistant can
  // see payroll and P&L — that's the exact gap this PR's registry flags via
  // `dangerous: true`, not a behavior worth preserving by default. Narrowed
  // to admin + manager_ops as a more responsible starting point; a human
  // must confirm this before any future PR wires finance.ts to requirePerm.
  'finance.payroll.view': ['admin', 'manager_ops'],
  'finance.payroll.manage': ['admin', 'manager_ops'],
  'finance.leave.approve': ['admin', 'manager_ops'],
  'finance.pnl.view': ['admin', 'manager_ops'],

  // billing.ts: real gate is the separate, untouched user_permissions
  // boolean table — this is a best-effort baseline, not exact parity.
  'billing.clients.manage': ['admin', 'manager_ops'],
  'billing.invoices.create': ['admin', 'manager_ops'],
  'billing.invoices.edit': ['admin', 'manager_ops'],
  'billing.invoices.delete': ['admin', 'manager_ops'],
  'billing.invoices.send': ['admin', 'manager_ops'],
  'billing.invoices.mark_paid': ['admin', 'manager_ops'],
  'billing.invoices.export': ['admin', 'manager_ops'],
  'billing.mrr.view': ['admin', 'manager_ops'],
  'billing.retainers.manage': ['admin', 'manager_ops'],

  // reports.ts: real gate is also the user_permissions boolean table
  // (`reportsView`/`isOwner`) — best-effort baseline mirroring REPORTS_VIEW's
  // role set for view/download; send is narrowed since it's a real outbound
  // WhatsApp message to a client (`client_reports.send` is dangerous).
  'client_reports.view': ['admin', 'manager_ops', 'manager_ads', 'viewer'],
  'client_reports.download': ['admin', 'manager_ops', 'manager_ads', 'viewer'],
  'client_reports.send': ['admin', 'manager_ops'],

  // permissions.ts: real gate is `userPermissions.isOwner` (not role-based)
  // for every write route — admin is the closest role equivalent.
  'settings.team.invite': ['admin'],
  'settings.team.role_change': ['admin'],
  'settings.team.permissions_edit': ['admin'],
  'settings.team.deactivate': ['admin'],

  // tenantBranding.ts: general fields are open to any authenticated user on
  // GET, PUT has no role check today (any authenticated user) EXCEPT the
  // owner-only financial-field subset (OWNER_ONLY_FIELDS, isOwner-gated).
  'branding.view': ['admin', 'manager_ops'],
  'branding.edit': ['admin', 'manager_ops'],
  'branding.view_financial': ['admin'],
  'branding.edit_financial': ['admin'],

  // integrations.ts is mounted with requireAuth + requireRole('admin') for
  // its ENTIRE router (real, confirmed). tenantIntegrations.ts's GETs are
  // open to any authenticated user; its PUT/DELETE are isOwner-gated. Merged
  // key defaults to the more permissive read (tenantIntegrations.ts is what
  // a normal user hits to view connected integrations) and admin-only manage.
  'integrations.view': ALL_NON_VIEWER,
  'integrations.manage': ['admin'],
};

/** Pure — the full permission set a given system role should start with. */
export function computePermissionsForRole(roleKey: SystemRoleKey): Permission[] {
  const set = new Set<Permission>();
  for (const [legacyKey, roles] of Object.entries(PERMISSION_MAP_SNAPSHOT)) {
    if (!roles.includes(roleKey)) continue;
    for (const perm of LEGACY_TO_NEW[legacyKey] ?? []) set.add(perm);
  }
  for (const [perm, roles] of Object.entries(EXTRA_DEFAULT_GRANTS) as Array<[Permission, SystemRoleKey[]]>) {
    if (roles.includes(roleKey)) set.add(perm);
  }
  return [...set];
}

export interface SystemRoleSeed {
  key: SystemRoleKey;
  name: string;
  permissions: Permission[];
}

/** Pure — the 8 system-role seeds, ready to write into `roles` + `role_permissions` per tenant. */
export function buildSystemRoleSeeds(): SystemRoleSeed[] {
  return SYSTEM_ROLE_KEYS.map((key) => ({
    key,
    name: SYSTEM_ROLE_NAMES[key],
    permissions: computePermissionsForRole(key),
  }));
}

export interface UserRoleMappingResult {
  mapped: Array<{ userId: string; roleKey: SystemRoleKey; roleId: string }>;
  unrecognized: Array<{ userId: string; role: string | null }>;
  alreadyMapped: Array<{ userId: string }>;
}

/**
 * Pure — decides, for each user row, whether it should be newly mapped to a
 * role_id, is already mapped (left alone), or carries a role string this
 * script doesn't recognise (flagged, never silently skipped past reporting).
 */
export function summarizeUserRoleMapping(
  userRows: Array<{ id: string; role: string | null; roleId: string | null }>,
  roleKeyToId: Map<SystemRoleKey, string>,
): UserRoleMappingResult {
  const result: UserRoleMappingResult = { mapped: [], unrecognized: [], alreadyMapped: [] };
  for (const row of userRows) {
    if (row.roleId) {
      result.alreadyMapped.push({ userId: row.id });
      continue;
    }
    const roleKey = row.role as SystemRoleKey | null;
    const roleId = roleKey ? roleKeyToId.get(roleKey) : undefined;
    if (roleKey && roleId) {
      result.mapped.push({ userId: row.id, roleKey, roleId });
    } else {
      result.unrecognized.push({ userId: row.id, role: row.role });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// DB-touching CLI wrapper — everything above this line is pure and unit-
// tested without a database (src/__tests__/backfillRolesFromPermissionMap.test.ts).
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required.');
  const apply = process.argv.includes('--apply');

  const pool = new Pool({ connectionString });
  try {
    const { rows: tenants } = await pool.query<{ id: string; slug: string }>('SELECT id, slug FROM tenants ORDER BY slug');
    const seeds = buildSystemRoleSeeds();
    const overallSummary: Array<Record<string, unknown>> = [];

    for (const tenant of tenants) {
      const { rows: existingRoles } = await pool.query<{ id: string; key: string }>(
        'SELECT id, key FROM roles WHERE tenant_id = $1 AND key = ANY($2::text[])',
        [tenant.id, SYSTEM_ROLE_KEYS as unknown as string[]],
      );
      const roleKeyToId = new Map<SystemRoleKey, string>(existingRoles.map((r) => [r.key as SystemRoleKey, r.id]));
      const rolesToCreate = seeds.filter((s) => !roleKeyToId.has(s.key));

      const { rows: userRows } = await pool.query<{ id: string; role: string | null; role_id: string | null }>(
        'SELECT id, role, role_id FROM users WHERE tenant_id = $1',
        [tenant.id],
      );
      // For users whose role would map to a role not yet created, the
      // mapping summary below is computed against a PROJECTED roleKeyToId
      // (as if rolesToCreate had already been inserted) so the dry-run
      // report is accurate about what --apply would actually do.
      const projectedRoleKeyToId = new Map(roleKeyToId);
      for (const s of rolesToCreate) projectedRoleKeyToId.set(s.key, `<new:${s.key}>`);
      const mapping = summarizeUserRoleMapping(
        userRows.map((r) => ({ id: r.id, role: r.role, roleId: r.role_id })),
        projectedRoleKeyToId,
      );

      overallSummary.push({
        tenant: tenant.slug,
        rolesAlreadyPresent: existingRoles.map((r) => r.key),
        rolesToCreate: rolesToCreate.map((s) => s.key),
        usersAlreadyMapped: mapping.alreadyMapped.length,
        usersToMap: mapping.mapped.length,
        usersWithUnrecognizedRole: mapping.unrecognized,
      });

      if (mapping.unrecognized.length > 0) {
        console.warn(
          `[backfill-roles] tenant=${tenant.slug}: ${mapping.unrecognized.length} user(s) have a role string that does not match any of the 8 system roles — NOT mapped:`,
          mapping.unrecognized,
        );
      }

      if (!apply) continue;

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const seed of rolesToCreate) {
          const { rows } = await client.query<{ id: string }>(
            `INSERT INTO roles (tenant_id, key, name, is_system) VALUES ($1, $2, $3, true)
             ON CONFLICT (tenant_id, key) DO NOTHING
             RETURNING id`,
            [tenant.id, seed.key, seed.name],
          );
          if (rows[0]) roleKeyToId.set(seed.key, rows[0].id);
        }
        for (const seed of seeds) {
          const roleId = roleKeyToId.get(seed.key);
          if (!roleId) continue; // shouldn't happen — every seed was either pre-existing or just created above
          for (const permission of seed.permissions) {
            await client.query(
              `INSERT INTO role_permissions (role_id, permission) VALUES ($1, $2) ON CONFLICT (role_id, permission) DO NOTHING`,
              [roleId, permission],
            );
          }
        }
        const finalMapping = summarizeUserRoleMapping(
          userRows.map((r) => ({ id: r.id, role: r.role, roleId: r.role_id })),
          roleKeyToId,
        );
        for (const m of finalMapping.mapped) {
          await client.query('UPDATE users SET role_id = $1 WHERE id = $2 AND role_id IS NULL', [m.roleId, m.userId]);
        }
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    }

    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry_run', tenants: overallSummary }, null, 2));
    if (!apply) {
      console.log('\nDry run only — no row written. Pass --apply (with explicit owner approval, per AGENTS.md / ge-prod-data-mutation) to write.');
    }
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[backfill-roles] failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
