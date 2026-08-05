// ---------------------------------------------------------------------------
// Permission registry — single source of truth for the tenant-customizable
// RBAC foundation (see src/db/schema.ts's `roles` / `role_permissions` /
// `user_permission_overrides` tables and src/services/permissionResolver.ts).
//
// WHY THIS EXISTS. Today's authorization is split across two mostly-disused
// systems: `PERMISSION_MAP` in src/middleware/rbac.ts (33 keys, only 14 ever
// checked by a route) and the `user_permissions` table (28 boolean columns,
// 17 read by nothing). Neither is a full map of what this API actually does.
// This registry IS that map — every key below was derived by reading the
// route file it corresponds to (contacts.ts, deals.ts, pipelines.ts,
// finance.ts, billing.ts, ads.ts, marketing.ts, social.ts, sequences.ts,
// automationHub.ts, esign.routes.ts, audit.ts, analytics.ts, reports.ts,
// permissions.ts, team.ts, tenantBranding.ts, tenantIntegrations.ts,
// integrations.ts, inbox.ts, discover.ts, healthRoute.ts/systemHealth.ts) —
// not invented from generic CRUD guesses. Where a route does something more
// specific than plain view/create/edit (export a CSV, mark an invoice paid,
// send a real WhatsApp message, pause a live ad campaign, approve a leave
// request, escalate a teammate's role), that specific verb gets its own key
// so a future admin UI and the resolver can reason about it precisely.
//
// SCOPE OF THIS FILE, deliberately narrow: this is ONLY the registry. Nothing
// here is wired into any route yet (that is later, separate, per-module work
// done in PERMISSION_SHADOW_MODE). Nothing here changes `PERMISSION_MAP` or
// `user_permissions` — both keep working exactly as today until the cutover.
//
// `dangerous: true` marks a capability whose blast radius goes beyond normal
// CRUD — money movement, legal/contractual action, real external sends
// (WhatsApp/Slack/email to a real recipient), irreversible deletes, exports
// of PII/financial data, or privilege escalation. An eventual admin UI should
// visually flag these and probably require a second confirmation to grant.
//
// A few keys below (`inbox.view`, `discovery.view`, `system_health.view`,
// and deals.view absorbing what used to be `QUALIFICATION_VIEW`) exist to
// give the backfill script (src/scripts/backfillRolesFromPermissionMap.ts) a
// complete target for every legacy PERMISSION_MAP key, even the ones no
// route currently checks — see that script's MAPPING table for the exact
// legacy-key -> registry-key correspondence used to reproduce today's
// role/permission behavior without drift.
// ---------------------------------------------------------------------------

export interface PermissionMeta {
  module: string;
  label: string;
  dangerous?: true;
}

export const PERMISSIONS = {
  // ---------------------------------------------------------------------
  // Contacts (src/routes/contacts.ts)
  // ---------------------------------------------------------------------
  'contacts.view':   { module: 'Contacts', label: 'View contacts' },
  'contacts.create': { module: 'Contacts', label: 'Add contacts' },
  // Covers PATCH /:id, contact notes (add/edit/delete), and adding a channel
  // (email/phone) to a contact — all simple contact-detail mutations.
  'contacts.edit':   { module: 'Contacts', label: 'Edit contacts (incl. notes, channels)' },
  // POST /bulk-delete — there is no single-contact delete route today.
  'contacts.delete': { module: 'Contacts', label: 'Bulk-delete contacts', dangerous: true },
  'contacts.export': { module: 'Contacts', label: 'Export contacts to CSV', dangerous: true },
  // POST /import — bulk CSV ingestion of new contacts.
  'contacts.import': { module: 'Contacts', label: 'Bulk-import contacts from CSV' },
  // POST /bulk-tag, /bulk-assign, /bulk-email, /bulk-sequence.
  'contacts.bulk':   { module: 'Contacts', label: 'Bulk actions (tag, reassign, email, enrol)' },

  // ---------------------------------------------------------------------
  // Pipeline/Deals (src/routes/deals.ts, src/routes/pipelines.ts)
  // ---------------------------------------------------------------------
  // Also covers what used to be the never-wired legacy QUALIFICATION_VIEW —
  // deal/lead qualification status is surfaced on the same deal records.
  'deals.view':   { module: 'Pipeline/Deals', label: 'View deals / pipeline' },
  'deals.create': { module: 'Pipeline/Deals', label: 'Create deals' },
  // PATCH /:id, POST /:id/activities (activity log entries on a deal).
  'deals.edit':   { module: 'Pipeline/Deals', label: 'Edit deals, log activities' },
  // POST /bulk-create, /bulk-update, /add-or-update.
  'deals.bulk':   { module: 'Pipeline/Deals', label: 'Bulk create/update deals' },
  'deals.export': { module: 'Pipeline/Deals', label: 'Export deals to CSV', dangerous: true },
  // GET /, /:id/stage-config, /:id/analytics, /:id/deals, /diagnose, /_health.
  'pipeline.view':   { module: 'Pipeline/Deals', label: 'View pipeline configuration' },
  // POST / (create pipeline), PATCH /:id, POST /reorder, POST /duplicate/:id,
  // DELETE /:id — structural changes to the pipeline itself, distinct from
  // editing an individual deal.
  'pipeline.manage': { module: 'Pipeline/Deals', label: 'Manage pipeline stages/settings' },
  // POST /backfill-all, /backfill-from-deals — one-off data-repair jobs.
  'pipeline.backfill': { module: 'Pipeline/Deals', label: 'Run pipeline data backfills', dangerous: true },

  // ---------------------------------------------------------------------
  // Finance (src/routes/finance.ts)
  // ---------------------------------------------------------------------
  'finance.expenses.view':   { module: 'Finance', label: 'View expenses' },
  // POST/PATCH/DELETE /expenses, GET/POST/DELETE /categories.
  'finance.expenses.manage': { module: 'Finance', label: 'Add/edit/delete expenses & categories' },
  'finance.expenses.export': { module: 'Finance', label: 'Export expenses to CSV', dangerous: true },
  'finance.income.view':     { module: 'Finance', label: 'View income records' },
  'finance.income.manage':   { module: 'Finance', label: 'Add/edit/delete income records' },
  // GET /team-payroll — salary/compensation data.
  'finance.payroll.view':    { module: 'Finance', label: 'View team payroll', dangerous: true },
  // POST/DELETE /team-payroll.
  'finance.payroll.manage':  { module: 'Finance', label: 'Add/remove payroll entries', dangerous: true },
  // GET/POST /attendance, /attendance/calendar — marking/viewing attendance.
  'finance.attendance.manage': { module: 'Finance', label: 'Mark & view team attendance' },
  // GET /leaves, /leaves/pending-count — viewing leave requests/balances.
  'finance.leave.view':    { module: 'Finance', label: 'View leave requests' },
  // POST /leaves — submitting a leave request.
  'finance.leave.request': { module: 'Finance', label: 'Submit a leave request' },
  // PATCH /leaves/:id — approve/reject someone else's leave request.
  'finance.leave.approve': { module: 'Finance', label: 'Approve/reject leave requests', dangerous: true },
  // GET /pnl — profit & loss statement.
  'finance.pnl.view':      { module: 'Finance', label: 'View profit & loss statement', dangerous: true },
  // GET /dashboard, GET /vendors, POST /generate-monthly.
  'finance.reports.view':  { module: 'Finance', label: 'View finance dashboard & reports' },

  // ---------------------------------------------------------------------
  // Billing (src/routes/billing.ts)
  // ---------------------------------------------------------------------
  'billing.clients.view':   { module: 'Billing', label: 'View billing clients' },
  'billing.clients.manage': { module: 'Billing', label: 'Add/edit/delete billing clients' },
  // GET /invoices, /invoices/:id, /monthly-tracker, /stats, /next-invoice-number.
  'billing.invoices.view':      { module: 'Billing', label: 'View invoices' },
  // POST /invoices, POST /generate-monthly.
  'billing.invoices.create':    { module: 'Billing', label: 'Create invoices' },
  'billing.invoices.edit':      { module: 'Billing', label: 'Edit invoices' },
  'billing.invoices.delete':    { module: 'Billing', label: 'Delete invoices', dangerous: true },
  // POST /invoices/:id/send — emails the invoice to a real client.
  'billing.invoices.send':      { module: 'Billing', label: 'Send invoices to clients', dangerous: true },
  // POST /invoices/:id/payment, PATCH /invoices/:id/payment-status.
  'billing.invoices.mark_paid': { module: 'Billing', label: 'Record invoice payments', dangerous: true },
  // GET /invoices/export, GET /invoices/:id/pdf.
  'billing.invoices.export':    { module: 'Billing', label: 'Export/download invoices', dangerous: true },
  // GET /mrr — recurring-revenue figures.
  'billing.mrr.view':       { module: 'Billing', label: 'View MRR / recurring revenue', dangerous: true },
  'billing.retainers.view':   { module: 'Billing', label: 'View retainers' },
  // POST/PATCH/DELETE /retainers, generate-invoice, generate-pending.
  'billing.retainers.manage': { module: 'Billing', label: 'Add/edit/delete retainers' },
  'billing.payments.view':    { module: 'Billing', label: 'View recorded payments' },

  // ---------------------------------------------------------------------
  // Ads/Marketing (src/routes/ads.ts, src/routes/marketing.ts)
  // ---------------------------------------------------------------------
  // GET /accounts, /managed-accounts, /campaigns, /insights, /adsets, /ads,
  // /creative-intelligence, /creative-patterns, /creative-fatigue, /settings.
  'ads.view':             { module: 'Ads/Marketing', label: 'View ad accounts, campaigns, insights' },
  // POST/PATCH/DELETE /managed-accounts.
  'ads.accounts.manage':  { module: 'Ads/Marketing', label: 'Add/remove managed ad accounts' },
  // POST /campaigns/:id/status — pauses/activates a LIVE Meta ad campaign.
  'ads.campaigns.manage': { module: 'Ads/Marketing', label: 'Pause/activate live ad campaigns', dangerous: true },
  'ads.settings.manage':  { module: 'Ads/Marketing', label: 'Edit ad module settings' },
  // POST /slack-digest, /slack-alert — sends a real Slack message.
  'ads.slack_notify':     { module: 'Ads/Marketing', label: 'Trigger Slack ad-performance alerts' },
  // GET /accounts, /accounts/:id/history (marketing.ts's own account-request workflow).
  'marketing.accounts.view':   { module: 'Ads/Marketing', label: 'View marketing/ad-account requests' },
  // POST /accounts, PATCH /accounts/:id, PATCH /accounts/:id/notify-slack.
  'marketing.accounts.manage': { module: 'Ads/Marketing', label: 'Add/edit marketing ad accounts' },
  // POST /accounts/:id/request-removal — low-bar, self-service request.
  'marketing.accounts.request_removal': { module: 'Ads/Marketing', label: 'Request removal of an ad account' },
  // POST /accounts/:id/approve-removal, /accounts/:id/reactivate.
  'marketing.accounts.approve_removal': { module: 'Ads/Marketing', label: 'Approve ad-account removal/reactivation', dangerous: true },

  // ---------------------------------------------------------------------
  // Sequences (src/routes/sequences.ts)
  // ---------------------------------------------------------------------
  'sequences.view':   { module: 'Sequences', label: 'View sequences & enrolments' },
  // POST / (create), PATCH /:id (edit/enable/disable).
  'sequences.manage': { module: 'Sequences', label: 'Create/edit sequences' },
  // POST /enrol — enrols a contact into a live outbound sequence.
  'sequences.enrol':  { module: 'Sequences', label: 'Enrol contacts into a sequence' },
  // DELETE /enrolments/:id — cancel/unenroll.
  'sequences.enrolments.remove': { module: 'Sequences', label: 'Remove a contact from a sequence' },

  // ---------------------------------------------------------------------
  // Automations (src/routes/automationHub.ts)
  // ---------------------------------------------------------------------
  // Today this route file is a read-only aggregate dashboard (GET
  // /hub-stats) over sequences/jobs/funnels — there is no distinct edit/
  // trigger action to gate yet.
  'automations.view': { module: 'Automations', label: 'View automation hub dashboard' },

  // ---------------------------------------------------------------------
  // Social (src/routes/social.ts)
  // ---------------------------------------------------------------------
  // GET /accounts, /lead-forms/status, /posts, /calendar, /library.
  'social.view':    { module: 'Social', label: 'View social accounts & posts' },
  // POST /accounts/connect-facebook, DELETE /accounts/:id — connecting or
  // disconnecting a real third-party social account.
  'social.connect': { module: 'Social', label: 'Connect/disconnect social accounts' },
  // POST /posts, DELETE /posts/:id — publishing/removing a LIVE post.
  'social.post':    { module: 'Social', label: 'Publish/delete social posts' },
  // POST /upload, DELETE /library/:key.
  'social.library.manage': { module: 'Social', label: 'Manage social media library' },
  // POST /lead-forms/accounts/:id/subscribe.
  'social.lead_forms.manage': { module: 'Social', label: 'Subscribe ad accounts to lead forms' },

  // ---------------------------------------------------------------------
  // Contracts (src/modules/esign/esign.routes.ts) — already fully RBAC'd via
  // PERMISSION_MAP's CONTRACTS_* keys; mirrored here 1:1 since that file is
  // the best-designed precedent in the codebase for this granularity.
  // ---------------------------------------------------------------------
  'contracts.view':             { module: 'Contracts', label: 'View contracts' },
  'contracts.view_audit':       { module: 'Contracts', label: 'View contract audit trail' },
  'contracts.create':           { module: 'Contracts', label: 'Create contracts' },
  'contracts.edit':             { module: 'Contracts', label: 'Edit / generate / upload contracts' },
  'contracts.send':             { module: 'Contracts', label: 'Send contracts for signature', dangerous: true },
  'contracts.approve':          { module: 'Contracts', label: 'Approve contracts', dangerous: true },
  'contracts.sign':             { module: 'Contracts', label: 'Sign contracts (internal signer)', dangerous: true },
  'contracts.void':             { module: 'Contracts', label: 'Void contracts', dangerous: true },
  'contracts.download':         { module: 'Contracts', label: 'Download contract files' },
  'contracts.manage_templates': { module: 'Contracts', label: 'Manage contract templates' },

  // ---------------------------------------------------------------------
  // Reports (src/routes/analytics.ts, src/routes/reports.ts)
  // ---------------------------------------------------------------------
  // GET /lead-sources, /funnel, /trends, /revenue-trend, /mrr-trend,
  // /team-performance, /attribution — tenant-wide dashboards.
  'reports.analytics.view': { module: 'Reports', label: 'View analytics dashboards' },
  // GET /clients, /generate, /generate-monthly — per-client report generation.
  'client_reports.view':     { module: 'Reports', label: 'View/generate per-client reports' },
  // GET /pdf, /monthly-pdf.
  'client_reports.download': { module: 'Reports', label: 'Download client report PDFs' },
  // POST /send-pdf — sends a real PDF to a real client's WhatsApp number.
  'client_reports.send':     { module: 'Reports', label: 'Send client reports via WhatsApp', dangerous: true },

  // ---------------------------------------------------------------------
  // Audit (src/routes/audit.ts)
  // ---------------------------------------------------------------------
  'audit.view':   { module: 'Audit', label: 'View audit log' },
  'audit.export': { module: 'Audit', label: 'Export audit log', dangerous: true },

  // ---------------------------------------------------------------------
  // Settings/Team-management (src/routes/permissions.ts, src/routes/team.ts)
  // ---------------------------------------------------------------------
  // GET /users, /users/:userId, and team.ts's GET / (assignee dropdown list).
  'settings.team.view':    { module: 'Settings/Team-management', label: 'View team members' },
  // POST /users — invite/create a teammate.
  'settings.team.invite':  { module: 'Settings/Team-management', label: 'Invite new teammates' },
  // PATCH /users/:userId/role — change a teammate's role (privilege change).
  'settings.team.role_change': { module: 'Settings/Team-management', label: "Change a teammate's role", dangerous: true },
  // PUT /users/:userId — edits the 28 user_permissions booleans + isOwner.
  'settings.team.permissions_edit': { module: 'Settings/Team-management', label: "Edit a teammate's permission overrides", dangerous: true },
  // DELETE /users/:userId — deactivates (offboards) a teammate.
  'settings.team.deactivate': { module: 'Settings/Team-management', label: 'Deactivate a teammate', dangerous: true },

  // ---------------------------------------------------------------------
  // Branding (src/routes/tenantBranding.ts)
  // ---------------------------------------------------------------------
  'branding.view': { module: 'Branding', label: 'View white-label branding config' },
  'branding.edit': { module: 'Branding', label: 'Edit branding (logo, colors, copy)' },
  // The gstin/bankName/bankAccountName/bankAccountNumber/bankIfsc subset,
  // gated by `isOwner` today (OWNER_ONLY_FIELDS in tenantBranding.ts).
  'branding.view_financial': { module: 'Branding', label: 'View legal/financial identity (GSTIN, bank details)', dangerous: true },
  'branding.edit_financial': { module: 'Branding', label: 'Edit legal/financial identity (GSTIN, bank details)', dangerous: true },

  // ---------------------------------------------------------------------
  // Integrations (src/routes/tenantIntegrations.ts, src/routes/integrations.ts)
  // ---------------------------------------------------------------------
  // GET / (both files), GET /:provider, GET /meta.
  'integrations.view':   { module: 'Integrations', label: 'View connected integrations' },
  // PUT /:provider, DELETE /:provider, POST /meta/refresh, DELETE /meta.
  'integrations.manage': { module: 'Integrations', label: 'Connect/disconnect/refresh integrations' },

  // ---------------------------------------------------------------------
  // Small additional modules kept only so the backfill script has a
  // complete target for every legacy PERMISSION_MAP key — see that script's
  // MAPPING table. None of these are wired into a route by this PR.
  // ---------------------------------------------------------------------
  'inbox.view':         { module: 'Inbox', label: 'View unified inbox / conversations' },
  'discovery.view':     { module: 'Discovery', label: 'View lead discovery search results' },
  'system_health.view': { module: 'System Health', label: 'View system/integration health' },
} as const satisfies Record<string, PermissionMeta>;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS: readonly Permission[] = Object.keys(PERMISSIONS) as Permission[];

/** Groups the registry by module, in insertion order — what an admin UI renders from directly. */
export function permissionsByModule(): Array<{ module: string; permissions: Array<{ key: Permission } & PermissionMeta> }> {
  const order: string[] = [];
  const grouped = new Map<string, Array<{ key: Permission } & PermissionMeta>>();
  for (const key of ALL_PERMISSIONS) {
    const meta = PERMISSIONS[key];
    if (!grouped.has(meta.module)) {
      grouped.set(meta.module, []);
      order.push(meta.module);
    }
    grouped.get(meta.module)!.push({ key, ...meta });
  }
  return order.map((module) => ({ module, permissions: grouped.get(module)! }));
}

export function isPermission(value: string): value is Permission {
  return Object.prototype.hasOwnProperty.call(PERMISSIONS, value);
}
