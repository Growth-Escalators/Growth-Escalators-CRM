import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  serial,
  timestamp,
  jsonb,
  numeric,
  date,
  real,
  index,
  uniqueIndex,
  foreignKey,
  check,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import {
  WIZMATCH_LIVE_STATES_SQL_LIST,
  WIZMATCH_ALL_STATES_SQL_LIST,
} from '../config/wizmatchOutreachStates';

// ---------------------------------------------------------------------------
// TABLE 1 — tenants
// ---------------------------------------------------------------------------
export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  plan: text('plan').default('agency_internal'),
  settings: jsonb('settings').default({}),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

// ---------------------------------------------------------------------------
// TABLE 2 — contacts
// ---------------------------------------------------------------------------
export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    firstName: text('first_name').notNull(),
    lastName: text('last_name'),
    companyName: text('company_name'),
    score: integer('score').default(0),
    status: text('status').default('lead'),
    source: text('source'),
    sourceDetail: text('source_detail'),
    assignedTo: text('assigned_to'),
    businessType: text('business_type'),
    tags: text('tags').array().default([]),
    notes: text('notes'),
    metadata: jsonb('metadata').default({}),
    optedInWa: boolean('opted_in_wa').default(false),
    optedInEmail: boolean('opted_in_email').default(false),
    doNotContact: boolean('do_not_contact').default(false),
    lastContactedAt: timestamp('last_contacted_at'),
    lastActivityAt: timestamp('last_activity_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    tenantIdIdx: index('contacts_tenant_id_idx').on(t.tenantId),
    statusIdx: index('contacts_status_idx').on(t.status),
    // Additive, non-partial — required as a composite-FK parent target for
    // WizMatch outbound-policy tables (PRD-005 §10.10.1). Cannot fail or
    // reject a write: `id` is already the primary key.
    tenantIdIdUniq: uniqueIndex('contacts_tenant_id_id_uniq').on(t.tenantId, t.id),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 3 — contact_channels
// ---------------------------------------------------------------------------
export const contactChannels = pgTable(
  'contact_channels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    contactId: uuid('contact_id').notNull().references(() => contacts.id),
    // channelType values: whatsapp | email | phone | linkedin | instagram
    channelType: text('channel_type').notNull(),
    channelValue: text('channel_value').notNull(),
    isPrimary: boolean('is_primary').default(false),
    verified: boolean('verified').default(false),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    contactIdIdx: index('contact_channels_contact_id_idx').on(t.contactId),
    uniqueChannel: uniqueIndex('contact_channels_unique_idx').on(
      t.contactId,
      t.channelType,
      t.channelValue,
    ),
    // Additive, non-partial — composite-FK parent target for
    // wizmatch_suppression_list.contact_channel_id (PRD-005 §10.10.1).
    tenantIdIdUniq: uniqueIndex('contact_channels_tenant_id_id_uniq').on(t.tenantId, t.id),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 4A — pipelines
// ---------------------------------------------------------------------------
export const pipelines = pgTable(
  'pipelines',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    stages: jsonb('stages').notNull().default([]),
    color: text('color').default('#F97316'),
    isActive: boolean('is_active').default(true),
    sortOrder: integer('sort_order').default(0),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    tenantIdIdx: index('pipelines_tenant_id_idx').on(t.tenantId),
    tenantSlugIdx: uniqueIndex('pipelines_tenant_slug_idx').on(t.tenantId, t.slug),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 4 — deals
// ---------------------------------------------------------------------------
export const deals = pgTable(
  'deals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    contactId: uuid('contact_id').notNull().references(() => contacts.id),
    pipelineId: uuid('pipeline_id').references(() => pipelines.id),
    title: text('title').notNull(),
    stage: text('stage').default('lead'),
    value: numeric('value', { precision: 12, scale: 2 }),
    dealValue: integer('deal_value'),
    serviceType: text('service_type'),
    assignedTo: text('assigned_to'),
    lostReason: text('lost_reason'),
    wonNotes: text('won_notes'),
    notes: text('notes'),
    expectedCloseDate: date('expected_close_date'),
    closedAt: timestamp('closed_at'),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    tenantIdIdx: index('deals_tenant_id_idx').on(t.tenantId),
    contactIdIdx: index('deals_contact_id_idx').on(t.contactId),
    pipelineIdIdx: index('deals_pipeline_id_idx').on(t.pipelineId),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 5 — clients
// ---------------------------------------------------------------------------
export const clients = pgTable(
  'clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    contactId: uuid('contact_id').notNull().references(() => contacts.id),
    dealId: uuid('deal_id').notNull().references(() => deals.id),
    businessName: text('business_name').notNull(),
    retainerAmount: numeric('retainer_amount', { precision: 12, scale: 2 }).default('0'),
    performanceFeePct: numeric('performance_fee_pct', { precision: 5, scale: 2 }).default('0'),
    revenueThreshold: numeric('revenue_threshold', { precision: 12, scale: 2 }),
    services: text('services').array().default([]),
    onboardingStatus: text('onboarding_status').default('pending'),
    reportingDay: integer('reporting_day').default(1),
    startedAt: date('started_at'),
    endedAt: date('ended_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    tenantIdIdx: index('clients_tenant_id_idx').on(t.tenantId),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 6 — events
// THIS TABLE IS APPEND ONLY - NEVER UPDATE OR DELETE ROWS
// ---------------------------------------------------------------------------
export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    contactId: uuid('contact_id').references(() => contacts.id),
    dealId: uuid('deal_id').references(() => deals.id),
    eventType: text('event_type').notNull(),
    channel: text('channel'),
    direction: text('direction'),
    payload: jsonb('payload').default({}),
    sourceId: text('source_id'),
    occurredAt: timestamp('occurred_at').defaultNow(),
    createdAt: timestamp('created_at').defaultNow(),
    // Nullable marker stamped once a cron/consumer has handled this event
    // (e.g. the pipeline-placement cron). Lets scans filter on an indexed
    // column instead of an ever-growing NOT EXISTS anti-join.
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (t) => ({
    tenantIdIdx: index('events_tenant_id_idx').on(t.tenantId),
    contactIdIdx: index('events_contact_id_idx').on(t.contactId),
    eventTypeIdx: index('events_event_type_idx').on(t.eventType),
    occurredAtIdx: index('events_occurred_at_idx').on(t.occurredAt),
    typeProcessedIdx: index('events_type_processed_idx').on(t.eventType, t.processedAt),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 7 — messages
// ---------------------------------------------------------------------------
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    contactId: uuid('contact_id').notNull().references(() => contacts.id),
    eventId: uuid('event_id').references(() => events.id),
    channel: text('channel').notNull(),
    direction: text('direction').notNull(),
    externalId: text('external_id'),
    templateName: text('template_name'),
    content: text('content').notNull(),
    messageType: text('message_type').default('text'),
    mediaUrl: text('media_url'),
    status: text('status').default('sent'),
    metadata: jsonb('metadata').default({}),
    sentAt: timestamp('sent_at').defaultNow(),
  },
  (t) => ({
    contactIdIdx: index('messages_contact_id_idx').on(t.contactId),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 8 — sequences
// ---------------------------------------------------------------------------
export const sequences = pgTable('sequences', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  channel: text('channel').notNull(),
  steps: jsonb('steps').default([]),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

// ---------------------------------------------------------------------------
// TABLE 9 — sequence_enrolments
// Most important index: (status, nextStepAt) — used for queue polling
// ---------------------------------------------------------------------------
export const sequenceEnrolments = pgTable(
  'sequence_enrolments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    contactId: uuid('contact_id').notNull().references(() => contacts.id),
    sequenceId: uuid('sequence_id').notNull().references(() => sequences.id),
    currentStep: integer('current_step').default(0),
    status: text('status').default('active'),
    nextStepAt: timestamp('next_step_at').notNull(),
    enrolledAt: timestamp('enrolled_at').defaultNow(),
    completedAt: timestamp('completed_at'),
  },
  (t) => ({
    contactIdIdx: index('seq_enrolments_contact_id_idx').on(t.contactId),
    statusNextStepIdx: index('seq_enrolments_status_next_step_idx').on(t.status, t.nextStepAt),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 10 — bookings
// ---------------------------------------------------------------------------
export const bookings = pgTable('bookings', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  contactId: uuid('contact_id').references(() => contacts.id),
  dealId: uuid('deal_id').references(() => deals.id),
  calBookingUid: text('cal_booking_uid').unique().notNull(),
  status: text('status').default('confirmed'),
  scheduledAt: timestamp('scheduled_at').notNull(),
  qualificationAnswers: jsonb('qualification_answers').default({}),
  qualificationScore: integer('qualification_score').default(0),
  qualificationTier: text('qualification_tier'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ---------------------------------------------------------------------------
// TABLE 11 — jobs  (queue polling index: status + processAfter)
// ---------------------------------------------------------------------------
export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    jobType: text('job_type').notNull(),
    status: text('status').default('pending'),
    payload: jsonb('payload').default({}),
    idempotencyKey: text('idempotency_key').unique().notNull(),
    attempts: integer('attempts').default(0),
    maxAttempts: integer('max_attempts').default(3),
    lastError: text('last_error'),
    processAfter: timestamp('process_after').defaultNow(),
    processingStartedAt: timestamp('processing_started_at'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    jobTypeIdx: index('jobs_job_type_idx').on(t.jobType),
    statusIdx: index('jobs_status_idx').on(t.status),
    statusProcessAfterIdx: index('jobs_status_process_after_idx').on(t.status, t.processAfter),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 12 — processed_events  (idempotency guard for incoming webhooks)
// ---------------------------------------------------------------------------
export const processedEvents = pgTable('processed_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  eventId: text('event_id').unique().notNull(),
  source: text('source').notNull(),
  processedAt: timestamp('processed_at').defaultNow(),
});

// ---------------------------------------------------------------------------
// TABLE 13 — wa_templates
// ---------------------------------------------------------------------------
export const waTemplates = pgTable(
  'wa_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    templateName: text('template_name').notNull(),
    category: text('category').notNull(),
    language: text('language').default('en'),
    variableCount: integer('variable_count').default(0),
    status: text('status').default('pending'),
    submittedAt: timestamp('submitted_at'),
    approvedAt: timestamp('approved_at'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    uniqueTenantTemplate: uniqueIndex('wa_templates_tenant_name_idx').on(
      t.tenantId,
      t.templateName,
    ),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 14 — tasks
// ---------------------------------------------------------------------------
export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  contactId: uuid('contact_id').references(() => contacts.id),
  dealId: uuid('deal_id').references(() => deals.id),
  listId: uuid('list_id'),
  title: text('title').notNull(),
  description: text('description'),
  assignedTo: text('assigned_to'),
  dueAt: timestamp('due_at'),
  status: text('status').default('open'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ---------------------------------------------------------------------------
// TABLE 14a — task_lists (Microsoft To-Do-style user-created lists)
// ---------------------------------------------------------------------------
export const taskLists = pgTable(
  'task_lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    position: integer('position').default(0),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    tenantOwnerIdx: index('task_lists_tenant_owner_idx').on(t.tenantId, t.ownerId),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 14b — task_checklist_items (subitems hanging off a task)
// ---------------------------------------------------------------------------
export const taskChecklistItems = pgTable(
  'task_checklist_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    isDone: boolean('is_done').default(false),
    position: integer('position').default(0),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    taskIdx: index('task_checklist_items_task_idx').on(t.taskId),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 15 — funnels  (round-robin booking rotation)
// ---------------------------------------------------------------------------
export const funnels = pgTable(
  'funnels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    isActive: boolean('is_active').default(true),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    tenantIdIdx: index('funnels_tenant_idx').on(t.tenantId),
    tenantSlugIdx: uniqueIndex('funnels_tenant_slug_idx').on(t.tenantId, t.slug),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 16 — funnel_members
// ---------------------------------------------------------------------------
export const funnelMembers = pgTable(
  'funnel_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    funnelId: uuid('funnel_id').notNull().references(() => funnels.id),
    memberName: text('member_name').notNull(),
    calcomUrl: text('calcom_url').notNull(),
    weight: integer('weight').default(50),
    totalAssigned: integer('total_assigned').default(0),
    lastAssignedAt: timestamp('last_assigned_at'),
    isActive: boolean('is_active').default(true),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    funnelIdIdx: index('funnel_members_funnel_idx').on(t.funnelId),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 17 — users  (CRM admin panel login)
// ---------------------------------------------------------------------------
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    role: text('role').default('staff'), // admin | manager_ops | manager_ads | team_lead | sales | staff | creative_assistant | viewer (read-only)
    tokenVersion: integer('token_version').default(1),
    // QA 2026-07-30 (failure-matrix M-3) — this column is LOAD-BEARING for
    // authentication (`src/routes/auth.ts:83`, `:169`, `:258` all gate login on
    // it, and it is how `DELETE /api/permissions/users/:userId` deactivates a
    // departed employee) but existed in no migration and no schema. It was
    // created only by a fire-and-forget, error-swallowing runtime ALTER at
    // `src/routes/permissions.ts:21`. A database built from migrations alone —
    // a DR restore, or any new environment — therefore came up WITHOUT it, and
    // because login references it in raw SQL, login fails outright there until
    // that unawaited ALTER happens to land. Modelled here and backed by
    // migration 0038 so the column exists by migration, matching the shape the
    // runtime ALTER used (`boolean DEFAULT true`, nullable) so the two agree on
    // every existing database. Nullable is deliberate: login reads
    // `is_active IS NULL OR is_active = true`.
    isActive: boolean('is_active').default(true),
    // Platform-superadmin primitive (Phase-1 hardening, security audit finding
    // 2026-08-03): there is otherwise NO cross-tenant concept anywhere in this
    // codebase — every prior instance of cross-tenant visibility has been an
    // accidental bug (see Phase-0 fixes: PRs #109/#110/#111), not a designed
    // feature. This column is the explicit, opt-in, audited replacement for
    // that accident: a GE-staff account flagged here may be granted cross-
    // tenant support access via `requirePlatformSuperadmin` (src/middleware/
    // rbac.ts), and every actual cross-tenant access it performs must be
    // logged via `auditEvents` (see `auditSuperadminCrossTenantAccess`).
    // `notNull().default(false)` deliberately, unlike the nullable `isActive`
    // precedent above — a security gate should have exactly one falsy
    // representation, not two (`NULL` and `false`) that every call site has to
    // remember to treat as equivalent.
    isPlatformSuperadmin: boolean('is_platform_superadmin').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    // Tenant-customizable RBAC foundation (see src/config/permissions.ts,
    // src/services/permissionResolver.ts). Nullable and NOT backfilled by
    // this migration — every user's authorization continues to flow through
    // the existing `role` text column + PERMISSION_MAP
    // (src/middleware/rbac.ts) exactly as today. Backfilling this column is a
    // separate, explicitly-approved follow-up
    // (src/scripts/backfillRolesFromPermissionMap.ts), and nothing reads it
    // yet — adding it here is additive-only schema, not a behavior change.
    roleId: uuid('role_id').references(() => roles.id),
  },
  (t) => ({
    tenantEmailIdx: uniqueIndex('users_tenant_email_unique').on(t.tenantId, t.email),
    // Additive, non-partial — composite-FK parent target for every WizMatch
    // reference into `users` (PRD-005 §10.10.1, ADR-006 D-14). Cannot fail or
    // reject a write: `id` is already the primary key. Guarded-path change on
    // a table shared with the Growth tenant — owner sign-off required at G1,
    // not at PR 2 (this PR only writes and measures it).
    tenantIdIdUniq: uniqueIndex('users_tenant_id_id_uniq').on(t.tenantId, t.id),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 18 — funnel_assignments  (audit log of every redirect)
// ---------------------------------------------------------------------------
export const funnelAssignments = pgTable(
  'funnel_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    funnelId: uuid('funnel_id').notNull().references(() => funnels.id),
    funnelMemberId: uuid('funnel_member_id').notNull().references(() => funnelMembers.id),
    assignedAt: timestamp('assigned_at').defaultNow(),
    visitorIp: text('visitor_ip'),
    metadata: jsonb('metadata').default({}),
  },
  (t) => ({
    funnelIdIdx: index('funnel_assignments_funnel_idx').on(t.funnelId),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 19 — contact_notes
// ---------------------------------------------------------------------------
export const contactNotes = pgTable('contact_notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull(),
  contactId: uuid('contact_id').notNull(),
  content: text('content').notNull(),
  createdBy: text('created_by').notNull().default('jatin'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ---------------------------------------------------------------------------
// TABLE 20 — email_templates
// ---------------------------------------------------------------------------
export const emailTemplates = pgTable(
  'email_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    displayName: text('display_name'),
    type: text('type').default('sequence'),
    subject: text('subject').notNull(),
    fromName: text('from_name').default('Jatin from Growth Escalators'),
    bodyHtml: text('body_html'),
    bodyText: text('body_text'),
    variables: jsonb('variables').default([]),
    brevoTemplateId: integer('brevo_template_id'),
    brevoSynced: boolean('brevo_synced').default(false),
    brevoSyncedAt: timestamp('brevo_synced_at'),
    isActive: boolean('is_active').default(true),
    openRate: real('open_rate'),
    sentCount: integer('sent_count').default(0),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    tenantIdIdx: index('email_templates_tenant_idx').on(t.tenantId),
    tenantNameIdx: uniqueIndex('email_templates_tenant_name_idx').on(t.tenantId, t.name),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 21 — user_permissions
// ---------------------------------------------------------------------------
export const userPermissions = pgTable('user_permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  // Contacts module
  contactsView: boolean('contacts_view').default(false),
  contactsCreate: boolean('contacts_create').default(false),
  contactsEdit: boolean('contacts_edit').default(false),
  contactsDelete: boolean('contacts_delete').default(false),
  contactsExport: boolean('contacts_export').default(false),
  contactsBulk: boolean('contacts_bulk').default(false),
  // Pipeline module
  pipelineView: boolean('pipeline_view').default(false),
  pipelineCreate: boolean('pipeline_create').default(false),
  pipelineEdit: boolean('pipeline_edit').default(false),
  pipelineDelete: boolean('pipeline_delete').default(false),
  pipelineManage: boolean('pipeline_manage').default(false),
  // Billing module
  billingView: boolean('billing_view').default(false),
  billingCreate: boolean('billing_create').default(false),
  billingEdit: boolean('billing_edit').default(false),
  billingMarkPaid: boolean('billing_mark_paid').default(false),
  billingViewMrr: boolean('billing_view_mrr').default(false),
  billingDownload: boolean('billing_download').default(false),
  billingManageClients: boolean('billing_manage_clients').default(false),
  // Automations module
  automationsView: boolean('automations_view').default(false),
  automationsTrigger: boolean('automations_trigger').default(false),
  // Reports module
  reportsView: boolean('reports_view').default(false),
  reportsMetaAds: boolean('reports_meta_ads').default(false),
  // Settings module
  settingsUsers: boolean('settings_users').default(false),
  settingsPipelines: boolean('settings_pipelines').default(false),
  settingsTemplates: boolean('settings_templates').default(false),
  settingsBilling: boolean('settings_billing').default(false),
  // System
  isOwner: boolean('is_owner').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ---------------------------------------------------------------------------
// TABLE 22 — billing_clients
// ---------------------------------------------------------------------------
export const billingClients = pgTable('billing_clients', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  contactPerson: text('contact_person'),
  email: text('email'),
  phone: text('phone'),
  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  city: text('city'),
  state: text('state'),
  stateCode: text('state_code'),
  pincode: text('pincode'),
  country: text('country').default('India'),
  isGst: boolean('is_gst').default(false),
  gstin: text('gstin'),
  taxType: text('tax_type'), // 'igst' | 'cgst_sgst' | null
  retainerAmount: integer('retainer_amount'), // in paise
  serviceDescription: text('service_description'),
  services: text('services').array().default([]), // ['SEO', 'Meta Ads', ...] — structured tags for filtering/reporting
  sacCode: text('sac_code').default('9983'),
  invoiceDayOfMonth: integer('invoice_day_of_month').default(1),
  currency: text('currency').default('INR'),
  isActive: boolean('is_active').default(true),
  notes: text('notes'),
  crmContactId: uuid('crm_contact_id'),
  metaAdAccountId: text('meta_ad_account_id'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ---------------------------------------------------------------------------
// TABLE 23 — invoices
// ---------------------------------------------------------------------------
export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  clientId: uuid('client_id').notNull().references(() => billingClients.id),
  invoiceNumber: text('invoice_number').notNull(),
  invoiceType: text('invoice_type').notNull(), // 'gst' | 'non_gst'
  status: text('status').default('draft'), // draft | sent | paid | partially_paid | overdue | cancelled
  invoiceDate: timestamp('invoice_date').notNull(),
  dueDate: timestamp('due_date').notNull(),
  sentAt: timestamp('sent_at'),
  paidAt: timestamp('paid_at'),
  subtotal: integer('subtotal').notNull(), // in paise
  discountType: text('discount_type'), // 'fixed' | 'percent' | null
  discountPercent: real('discount_percent').default(0), // only populated when type='percent'
  discountAmount: integer('discount_amount').default(0), // resolved paise amount deducted from subtotal
  discountLabel: text('discount_label'),
  cgstRate: real('cgst_rate').default(0),
  cgstAmount: integer('cgst_amount').default(0),
  sgstRate: real('sgst_rate').default(0),
  sgstAmount: integer('sgst_amount').default(0),
  igstRate: real('igst_rate').default(0),
  igstAmount: integer('igst_amount').default(0),
  totalAmount: integer('total_amount').notNull(), // in paise
  amountPaid: integer('amount_paid').default(0),
  amountDue: integer('amount_due').notNull(),
  amountInWords: text('amount_in_words'),
  clientGstin: text('client_gstin'),
  clientState: text('client_state'),
  clientStateCode: text('client_state_code'),
  companyGstin: text('company_gstin'),
  taxType: text('tax_type'), // 'igst' | 'cgst_sgst' | null
  serviceDescription: text('service_description'),
  sacCode: text('sac_code').default('9983'),
  notes: text('notes'),
  paymentNote: text('payment_note'),
  isRecurring: boolean('is_recurring').default(false),
  recurringSourceId: uuid('recurring_source_id'),
  financialYear: text('financial_year'),
  seriesNumber: integer('series_number'),
  createdBy: text('created_by').default('jatin'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => ({
  // invoiceNumber used to be a bare column-level UNIQUE constraint (global
  // across all tenants) despite invoiceNumberService.ts embedding a
  // tenant-derived prefix into the string (see #160) — two tenants whose
  // derived short codes happened to collide would race the same uniqueness
  // slot. Scoping the constraint to (tenant_id, invoice_number) matches the
  // real invariant and mirrors invoice_series_tenant_type_fy_uniq_idx below.
  tenantInvoiceNumberUniq: uniqueIndex('invoices_tenant_invoice_number_uniq_idx').on(t.tenantId, t.invoiceNumber),
}));

// ---------------------------------------------------------------------------
// TABLE 24 — invoice_line_items
// ---------------------------------------------------------------------------
export const invoiceLineItems = pgTable('invoice_line_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id),
  description: text('description').notNull(),
  sacCode: text('sac_code').default('9983'),
  quantity: real('quantity').default(1),
  unit: text('unit').default('Month'),
  rate: integer('rate').notNull(), // in paise
  amount: integer('amount').notNull(), // in paise
  sortOrder: integer('sort_order').default(0),
});

// ---------------------------------------------------------------------------
// TABLE 25 — payments
// ---------------------------------------------------------------------------
export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id),
  clientId: uuid('client_id').notNull().references(() => billingClients.id),
  amount: integer('amount').notNull(), // in paise
  paymentDate: timestamp('payment_date').notNull(),
  paymentMode: text('payment_mode'), // 'bank_transfer' | 'upi' | 'cheque' | 'cash' | 'other'
  reference: text('reference'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ---------------------------------------------------------------------------
// TABLE 26 — invoice_series
// ---------------------------------------------------------------------------
export const invoiceSeries = pgTable(
  'invoice_series',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    seriesType: text('series_type').notNull(), // 'gst' | 'non_gst'
    financialYear: text('financial_year').notNull(),
    lastNumber: integer('last_number').default(0),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    // invoiceNumberService's getNextInvoiceNumber() upserts via
    // ON CONFLICT (tenant_id, series_type, financial_year) — that target
    // constraint did not exist until this migration, so the upsert either
    // relied on an untracked hand-added index in prod, or every invoice
    // creation was one Postgres error away from failing outright, or (worst
    // case) concurrent invoice creations could both insert a fresh row and
    // produce duplicate GST serial numbers on real legal documents.
    tenantTypeYearUniq: uniqueIndex('invoice_series_tenant_type_fy_uniq_idx').on(t.tenantId, t.seriesType, t.financialYear),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 27 — social_accounts
// ---------------------------------------------------------------------------
export const socialAccounts = pgTable('social_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  platform: text('platform').notNull(), // 'facebook' | 'instagram'
  accountId: text('account_id').notNull(),
  accountName: text('account_name').notNull(),
  accessToken: text('access_token').notNull(), // AES-256 encrypted
  thumbnailUrl: text('thumbnail_url'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

// ---------------------------------------------------------------------------
// TABLE 28 — social_posts
// ---------------------------------------------------------------------------
export const socialPosts = pgTable('social_posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  socialAccountId: uuid('social_account_id').notNull().references(() => socialAccounts.id),
  platform: text('platform'),
  content: text('content').notNull(),
  mediaUrls: text('media_urls').array(),
  scheduledAt: timestamp('scheduled_at'),
  status: text('status').default('draft'), // 'draft' | 'scheduled' | 'published' | 'failed'
  publishedAt: timestamp('published_at'),
  externalPostId: text('external_post_id'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow(),
});

// ---------------------------------------------------------------------------
// TABLE 29 — discovery_searches
// ---------------------------------------------------------------------------
export const discoverySearches = pgTable(
  'discovery_searches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    query: text('query').notNull(),
    location: text('location').notNull(),
    country: text('country').notNull().default('UK'),
    radiusMeters: integer('radius_meters').default(10000),
    maxResults: integer('max_results').default(20),
    totalFound: integer('total_found').default(0),
    qualifiedCount: integer('qualified_count').default(0),
    importedCount: integer('imported_count').default(0),
    apiCallsUsed: integer('api_calls_used').default(0),
    costUsd: numeric('cost_usd', { precision: 8, scale: 4 }).default('0'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    tenantIdIdx: index('discovery_searches_tenant_idx').on(t.tenantId),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 30 — discovery_results
// ---------------------------------------------------------------------------
export const discoveryResults = pgTable(
  'discovery_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    searchId: uuid('search_id').notNull().references(() => discoverySearches.id),
    placeId: text('place_id').notNull(),
    companyName: text('company_name').notNull(),
    websiteUrl: text('website_url'),
    phoneNumber: text('phone_number'),
    address: text('address'),
    rating: numeric('rating', { precision: 3, scale: 1 }),
    reviewCount: integer('review_count').default(0),
    fitScore: integer('fit_score').default(0),
    // Qualified | Review | Disqualified | Already in pipeline
    qualificationStatus: text('qualification_status').default('Review'),
    disqualificationReason: text('disqualification_reason'),
    imported: boolean('imported').default(false),
    importedContactId: uuid('imported_contact_id'),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    searchIdIdx: index('discovery_results_search_idx').on(t.searchId),
    tenantIdIdx: index('discovery_results_tenant_idx').on(t.tenantId),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 31 — discovery_api_usage  (monthly cost tracking)
// ---------------------------------------------------------------------------
export const discoveryApiUsage = pgTable(
  'discovery_api_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    monthYear: text('month_year').notNull(), // e.g. "2026-03"
    apiCalls: integer('api_calls').default(0),
    costUsd: numeric('cost_usd', { precision: 8, scale: 4 }).default('0'),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    uniqueMonth: uniqueIndex('discovery_usage_tenant_month_idx').on(t.tenantId, t.monthYear),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 32 — marketing_accounts
// ---------------------------------------------------------------------------
export const marketingAccounts = pgTable('marketing_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  accountId: text('account_id').notNull(),
  accountName: text('account_name').notNull(),
  clientName: text('client_name'),
  isActive: boolean('is_active').default(true),
  removalRequestedAt: timestamp('removal_requested_at'),
  removalRequestedBy: uuid('removal_requested_by'),
  removalApprovedAt: timestamp('removal_approved_at'),
  notes: text('notes'),
  lastAlertSentAt: timestamp('last_alert_sent_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ---------------------------------------------------------------------------
// TABLE 33 — ads_insights_cache
// ---------------------------------------------------------------------------
export const adsInsightsCache = pgTable(
  'ads_insights_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    accountId: text('account_id').notNull(),
    dateRange: text('date_range').notNull(),
    level: text('level').notNull(),
    data: jsonb('data').default({}),
    fetchedAt: timestamp('fetched_at').defaultNow(),
    expiresAt: timestamp('expires_at').notNull(),
  },
  (t) => ({
    cacheIdx: index('ads_cache_account_range_level_idx').on(t.accountId, t.dateRange, t.level),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 34 — audit_events
// ---------------------------------------------------------------------------
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    userId: uuid('user_id').references(() => users.id),
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    metadata: jsonb('metadata').default({}),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    tenantIdx: index('audit_events_tenant_idx').on(t.tenantId),
    userIdx: index('audit_events_user_idx').on(t.userId),
    actionIdx: index('audit_events_action_idx').on(t.action),
    createdAtIdx: index('audit_events_created_at_idx').on(t.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 35 — password_reset_tokens
// ---------------------------------------------------------------------------
export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  token: text('token').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// ---------------------------------------------------------------------------
// TABLE 35a — user_invites
//
// Invite-by-email (replaces the old "generate a temp password, print it once,
// admin copies it into Slack/WhatsApp" flow — see src/routes/permissions.ts's
// POST /users). Deliberately its own table rather than a new `users` column:
// a user's "pending" state is fully derived from "does a row exist here",
// which needs zero backfill/migration story for the ~all existing users who
// have none. `tokenHash` stores a SHA-256 of the mailed token (mirrors
// src/modules/esign/contract-signing-link.ts's hashSigningToken) rather than
// the raw value — a link sent by email is more likely to end up in a log/
// screenshot than the 6-digit `password_reset_tokens` code, so hashing it at
// rest costs nothing and is strictly safer.
//
// Lifecycle: created on invite/resend (deleting any prior row for the same
// user first — same "delete old, insert new" shape as
// password_reset_tokens's forgot-password flow, and what makes "resend
// invalidates the old link" true for free). Deleted on accept. A user has at
// most one outstanding row at a time; its mere existence IS the "pending"
// flag the admin UI reads (see GET /api/permissions/users's LEFT JOIN).
// ---------------------------------------------------------------------------
export const userInvites = pgTable(
  'user_invites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    userIdx: uniqueIndex('user_invites_user_id_uniq').on(t.userId),
    tenantIdx: index('user_invites_tenant_id_idx').on(t.tenantId),
  }),
);

// ===========================================================================
// SEO AUTOMATION TABLES (Phase 2 upgrade)
// ===========================================================================

// ---------------------------------------------------------------------------
// TABLE 36 — client_knowledge_base
// ---------------------------------------------------------------------------
// H18 (Fable review) — this and the other 9 SEO automation tables below had
// no tenant_id at all; see migration 0035 header comment for the full finding.
// Also reconciles column drift: ensureSeoTables()/ensureClientPagesTable()
// (src/services/seoWorkflowHealthService.ts, programmaticSeoService.ts) have
// been `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`-ing extra columns onto these
// live tables for years without schema.ts ever knowing about them.
export const clientKnowledgeBase = pgTable(
  'client_knowledge_base',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    // Nullable on purpose — see the seo_sites docblock. Reads still go via
    // project_name/client_domain until every service has migrated.
    siteId: uuid('site_id').references(() => seoSites.id),
    projectName: text('project_name').notNull(),
    brandSummary: text('brand_summary'),
    idealCustomer: text('ideal_customer'),
    uniqueValueProposition: text('unique_value_proposition'),
    keyDifferentiators: jsonb('key_differentiators').default([]),
    proofPoints: jsonb('proof_points').default([]),
    brandVoice: text('brand_voice'),
    wordsAlwaysUse: jsonb('words_always_use').default([]),
    wordsNeverUse: jsonb('words_never_use').default([]),
    credentials: jsonb('credentials').default([]),
    topServices: jsonb('top_services').default([]),
    competitorDomains: jsonb('competitor_domains').default([]),
    targetKeywordsPriority: jsonb('target_keywords_priority').default([]),
    contentExamples: text('content_examples'),
    // Drift columns — live via ensureSeoTables().
    clientDomain: text('client_domain'),
    brandName: text('brand_name'),
    industry: text('industry'),
    targetAudience: text('target_audience'),
    uniqueValueProp: text('unique_value_prop'),
    primaryKeywords: text('primary_keywords'),
    toneOfVoice: text('tone_of_voice'),
    competitors: text('competitors'),
    contentThemes: text('content_themes'),
    ctaStyle: text('cta_style'),
    ga4PropertyId: text('ga4_property_id'),
    gscDomain: text('gsc_domain'),
    wordpressUrl: text('wordpress_url'),
    targetMonthlyTraffic: integer('target_monthly_traffic'),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    tenantIdIdx: index('client_knowledge_base_tenant_id_idx').on(t.tenantId),
    siteIdIdx: index('client_knowledge_base_site_id_idx').on(t.siteId),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 37 — client_pages
// ---------------------------------------------------------------------------
export const clientPages = pgTable(
  'client_pages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    // Nullable on purpose — see the seo_sites docblock. Reads still go via
    // project_name/client_domain until every service has migrated.
    siteId: uuid('site_id').references(() => seoSites.id),
    projectName: text('project_name').notNull(),
    pageUrl: text('page_url').notNull(),
    pageTitle: text('page_title'),
    targetKeyword: text('target_keyword'),
    wordCount: integer('word_count').default(0),
    internalLinksIn: jsonb('internal_links_in').default([]),
    internalLinksOut: jsonb('internal_links_out').default([]),
    publishedDate: timestamp('published_date'),
    lastUpdated: timestamp('last_updated'),
    wpPostId: integer('wp_post_id'),
    indexed: boolean('indexed').default(false),
    // Drift columns — live via ensureClientPagesTable() (programmaticSeoService.ts).
    clientDomain: text('client_domain'),
    pageSlug: text('page_slug'),
    status: text('status').default('draft'),
    pageType: text('page_type').default('manual'),
    metaDescription: text('meta_description'),
    content: text('content'),
    createdAt: timestamp('created_at').defaultNow(),
    // Approval metadata (migration 0045). A staged page change must carry who
    // approved it and when — `publishApprovedChange()` refuses to publish a row
    // whose approved_by/approved_at are unset, which is what makes the
    // hard-stop-before-publish rule enforced code rather than convention.
    // Deliberately reusing the existing (currently never-written)
    // `published_date` / `last_updated` columns instead of adding
    // `published_at` / `updated_at`, to avoid two near-identical column pairs.
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at'),
    rejectedReason: text('rejected_reason'),
  },
  (t) => ({
    tenantIdIdx: index('client_pages_tenant_id_idx').on(t.tenantId),
    siteIdIdx: index('client_pages_site_id_idx').on(t.siteId),
    // NOTE: a UNIQUE (tenant_id, client_domain, page_slug) index is NOT added
    // here on purpose. Duplicates demonstrably exist in prod — that is why
    // publishPendingToWordPress() dedupes in JavaScript — so creating the index
    // would abort the migration and, since Railway migrates on boot, stop the
    // API from starting. It needs a DELETE-dedupe first, which is irreversible
    // data loss against a database that currently has no backups. Deferred to
    // its own migration + explicit sign-off (needed by Phase 3, not Phase 1).
  }),
);

// ---------------------------------------------------------------------------
// TABLE 38 — keyword_rankings
// ---------------------------------------------------------------------------
export const keywordRankings = pgTable(
  'keyword_rankings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    // Nullable on purpose — see the seo_sites docblock. Reads still go via
    // project_name/client_domain until every service has migrated.
    siteId: uuid('site_id').references(() => seoSites.id),
    projectName: text('project_name').notNull(),
    keyword: text('keyword').notNull(),
    currentPosition: numeric('current_position'),
    previousPosition: numeric('previous_position'),
    positionChange: numeric('position_change'),
    searchVolume: integer('search_volume').default(0),
    urlRanking: text('url_ranking'),
    featuredSnippet: boolean('featured_snippet').default(false),
    recordedDate: date('recorded_date').notNull(),
    // Drift columns — live via ensureSeoTables().
    clientDomain: text('client_domain'),
    checkedAt: timestamp('checked_at').defaultNow(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    projectKeywordIdx: index('keyword_rankings_project_keyword_idx').on(t.projectName, t.keyword),
    recordedDateIdx: index('keyword_rankings_recorded_date_idx').on(t.recordedDate),
    tenantIdIdx: index('keyword_rankings_tenant_id_idx').on(t.tenantId),
    siteIdIdx: index('keyword_rankings_site_id_idx').on(t.siteId),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 39 — backlink_data
// ---------------------------------------------------------------------------
export const backlinkData = pgTable(
  'backlink_data',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    // Nullable on purpose — see the seo_sites docblock. Reads still go via
    // project_name/client_domain until every service has migrated.
    siteId: uuid('site_id').references(() => seoSites.id),
    projectName: text('project_name').notNull(),
    sourceUrl: text('source_url'),
    targetUrl: text('target_url'),
    domainAuthority: numeric('domain_authority').default('0'),
    anchorText: text('anchor_text'),
    linkType: text('link_type'),
    firstSeen: date('first_seen'),
    lastSeen: date('last_seen'),
    status: text('status').default('active'),
    // Drift columns — live via ensureSeoTables().
    clientDomain: text('client_domain'),
    checkedAt: timestamp('checked_at').defaultNow(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    projectIdx: index('backlink_data_project_idx').on(t.projectName),
    statusIdx: index('backlink_data_status_idx').on(t.status),
    tenantIdIdx: index('backlink_data_tenant_id_idx').on(t.tenantId),
    siteIdIdx: index('backlink_data_site_id_idx').on(t.siteId),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 40 — content_gap_analysis
// ---------------------------------------------------------------------------
export const contentGapAnalysis = pgTable(
  'content_gap_analysis',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    projectName: text('project_name').notNull(),
    targetKeyword: text('target_keyword').notNull(),
    ourUrl: text('our_url'),
    ourPosition: numeric('our_position'),
    competitorUrls: jsonb('competitor_urls').default([]),
    topicsMissing: jsonb('topics_missing').default([]),
    questionsMissing: jsonb('questions_missing').default([]),
    entitiesMissing: jsonb('entities_missing').default([]),
    wordCountGap: integer('word_count_gap').default(0),
    priorityScore: numeric('priority_score').default('0'),
    status: text('status').default('pending'),
    // Drift column — live via ensureSeoTables().
    clientDomain: text('client_domain'),
    analysedAt: timestamp('analysed_at').defaultNow(),
  },
  (t) => ({
    projectKeywordIdx: index('content_gap_project_keyword_idx').on(t.projectName, t.targetKeyword),
    priorityScoreIdx: index('content_gap_priority_score_idx').on(t.priorityScore),
    tenantIdIdx: index('content_gap_analysis_tenant_id_idx').on(t.tenantId),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 41 — seo_opportunities
// ---------------------------------------------------------------------------
export const seoOpportunities = pgTable(
  'seo_opportunities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    // Nullable on purpose — see the seo_sites docblock. Reads still go via
    // project_name/client_domain until every service has migrated.
    siteId: uuid('site_id').references(() => seoSites.id),
    projectName: text('project_name').notNull(),
    opportunityType: text('opportunity_type'),
    description: text('description'),
    estimatedImpact: text('estimated_impact'),
    effortLevel: text('effort_level'),
    status: text('status').default('open'),
    identifiedAt: timestamp('identified_at').defaultNow(),
    // Drift columns — live via ensureSeoTables().
    createdAt: timestamp('created_at').defaultNow(),
    clientDomain: text('client_domain'),
    clickupTaskId: text('clickup_task_id'),
    clickupTaskUrl: text('clickup_task_url'),
    priorityScore: integer('priority_score').default(0),
    publishedUrl: text('published_url'),
    outcome: text('outcome'),
    outcomeMeasuredAt: timestamp('outcome_measured_at'),
    keyword: text('keyword'),
    notes: text('notes'),
  },
  (t) => ({
    projectStatusIdx: index('seo_opportunities_project_status_idx').on(t.projectName, t.status),
    tenantIdIdx: index('seo_opportunities_tenant_id_idx').on(t.tenantId),
    siteIdIdx: index('seo_opportunities_site_id_idx').on(t.siteId),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 42 — site_health_metrics
// ---------------------------------------------------------------------------
export const siteHealthMetrics = pgTable(
  'site_health_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    // Nullable on purpose — see the seo_sites docblock. Reads still go via
    // project_name/client_domain until every service has migrated.
    siteId: uuid('site_id').references(() => seoSites.id),
    projectName: text('project_name').notNull(),
    pagespeedMobile: numeric('pagespeed_mobile'),
    pagespeedDesktop: numeric('pagespeed_desktop'),
    lcp: numeric('lcp'),
    fid: numeric('fid'),
    cls: numeric('cls'),
    brokenLinksCount: integer('broken_links_count').default(0),
    indexedPagesCount: integer('indexed_pages_count').default(0),
    crawlErrorsCount: integer('crawl_errors_count').default(0),
    // Drift column — live via ensureSeoTables().
    clientDomain: text('client_domain'),
    checkedAt: timestamp('checked_at').defaultNow(),
  },
  (t) => ({
    projectCheckedAtIdx: index('site_health_project_checked_at_idx').on(t.projectName, t.checkedAt),
    tenantIdIdx: index('site_health_metrics_tenant_id_idx').on(t.tenantId),
    siteIdIdx: index('site_health_metrics_site_id_idx').on(t.siteId),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 43 — brand_mentions
// ---------------------------------------------------------------------------
// No client_domain drift column here — ensureSeoTables() never added one to
// this table, and it has zero code touch-points anywhere in the app today.
export const brandMentions = pgTable(
  'brand_mentions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    projectName: text('project_name').notNull(),
    mentionUrl: text('mention_url'),
    mentionText: text('mention_text'),
    hasLink: boolean('has_link').default(false),
    domainAuthority: numeric('domain_authority').default('0'),
    discoveredAt: timestamp('discovered_at').defaultNow(),
  },
  (t) => ({
    projectIdx: index('brand_mentions_project_idx').on(t.projectName),
    tenantIdIdx: index('brand_mentions_tenant_id_idx').on(t.tenantId),
  }),
);

// ---------------------------------------------------------------------------
// seo_weekly_metrics — GSC/GA4 weekly rollups. Existed only as a raw
// `CREATE TABLE IF NOT EXISTS` in ensureSeoTables() (src/services/
// seoWorkflowHealthService.ts) with no Drizzle definition at all. Added here
// so schema.ts reflects the live DB shape (H18, migration 0035).
// ---------------------------------------------------------------------------
export const seoWeeklyMetrics = pgTable(
  'seo_weekly_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    // Nullable on purpose — see the seo_sites docblock. Reads still go via
    // project_name/client_domain until every service has migrated.
    siteId: uuid('site_id').references(() => seoSites.id),
    projectName: text('project_name'),
    clientDomain: text('client_domain'),
    clientName: text('client_name'),
    weekStart: date('week_start'),
    weekStartDate: date('week_start_date'),
    totalClicks: integer('total_clicks').default(0),
    totalImpressions: integer('total_impressions').default(0),
    avgPosition: numeric('avg_position'),
    avgCtr: numeric('avg_ctr'),
    totalSessions: integer('total_sessions').default(0),
    ga4Sessions: integer('ga4_sessions').default(0),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    domainWeekIdx: index('seo_weekly_metrics_domain_week_idx').on(t.clientDomain, t.weekStart),
    tenantIdIdx: index('seo_weekly_metrics_tenant_id_idx').on(t.tenantId),
    siteIdIdx: index('seo_weekly_metrics_site_id_idx').on(t.siteId),
  }),
);

// ---------------------------------------------------------------------------
// seo_alerts_log — SEO monitoring alerts. Same story as seo_weekly_metrics:
// raw `CREATE TABLE IF NOT EXISTS` only, no Drizzle definition until now
// (H18, migration 0035).
// ---------------------------------------------------------------------------
export const seoAlertsLog = pgTable(
  'seo_alerts_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    // Nullable on purpose — see the seo_sites docblock. Reads still go via
    // project_name/client_domain until every service has migrated.
    siteId: uuid('site_id').references(() => seoSites.id),
    projectName: text('project_name').notNull(),
    alertType: text('alert_type'),
    message: text('message'),
    severity: text('severity').default('info'),
    resolved: boolean('resolved').default(false),
    createdAt: timestamp('created_at').defaultNow(),
    clientDomain: text('client_domain'),
  },
  (t) => ({
    createdIdx: index('seo_alerts_log_created_idx').on(t.createdAt),
    tenantIdIdx: index('seo_alerts_log_tenant_id_idx').on(t.tenantId),
    siteIdIdx: index('seo_alerts_log_site_id_idx').on(t.siteId),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 44 — prospects  (outbound lead-gen, Phase 1)
// ---------------------------------------------------------------------------
export const prospects = pgTable(
  'prospects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    firstName: text('first_name'),
    lastName: text('last_name'),
    title: text('title'),
    company: text('company'),
    companySize: text('company_size'),
    linkedinUrl: text('linkedin_url'),
    email: text('email'),
    emailStatus: text('email_status').notNull().default('unverified'),
    icpSegment: text('icp_segment'),
    status: text('status').notNull().default('new'),
    channel: text('channel'),
    source: text('source'),
    // CRM bridge — filled when a prospect is converted to a CRM contact + deal.
    crmContactId: uuid('crm_contact_id'),
    crmDealId: uuid('crm_deal_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('prospects_status_idx').on(t.status),
    icpSegmentIdx: index('prospects_icp_segment_idx').on(t.icpSegment),
    createdAtIdx: index('prospects_created_at_idx').on(t.createdAt),
    crmContactIdx: index('prospects_crm_contact_idx').on(t.crmContactId),
    tenantIdIdx: index('prospects_tenant_id_idx').on(t.tenantId),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 45 — signals
// ---------------------------------------------------------------------------
export const signals = pgTable(
  'signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    prospectId: uuid('prospect_id').notNull().references(() => prospects.id, { onDelete: 'cascade' }),
    signalType: text('signal_type').notNull(),
    signalDetail: text('signal_detail'),
    signalDate: timestamp('signal_date'),
    isFresh: boolean('is_fresh').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    prospectIdx: index('signals_prospect_id_idx').on(t.prospectId),
    signalTypeIdx: index('signals_signal_type_idx').on(t.signalType),
    isFreshIdx: index('signals_is_fresh_idx').on(t.isFresh),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 46 — replies
// ---------------------------------------------------------------------------
export const replies = pgTable(
  'replies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    prospectId: uuid('prospect_id').notNull().references(() => prospects.id, { onDelete: 'cascade' }),
    channel: text('channel'),
    body: text('body'),
    classification: text('classification'),
    receivedAt: timestamp('received_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    prospectIdx: index('replies_prospect_id_idx').on(t.prospectId),
    receivedAtIdx: index('replies_received_at_idx').on(t.receivedAt),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 47 — outbound_events  (status-transition audit trail; separate from
// `events` above which is for CRM contact/deal channel activity)
// ---------------------------------------------------------------------------
export const outboundEvents = pgTable(
  'outbound_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    prospectId: uuid('prospect_id').notNull().references(() => prospects.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    note: text('note'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    prospectIdx: index('outbound_events_prospect_id_idx').on(t.prospectId),
    createdAtIdx: index('outbound_events_created_at_idx').on(t.createdAt),
  }),
);

// ===========================================================================
// WIZMATCH STAFFING MODULE TABLES
// US + India IT-staffing outbound module — 6 new tables, all tenant-scoped.
// All UUID PKs/FKs (no SERIAL) to match the repo convention.
// ===========================================================================

// ---------------------------------------------------------------------------
// TABLE 48 — wizmatch_companies
// ---------------------------------------------------------------------------
export const wizmatchCompanies = pgTable(
  'wizmatch_companies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    domain: text('domain'),
    atsType: text('ats_type'), // greenhouse | lever | ashby | workday | icims | taleo | successfactors | none
    atsBoardUrl: text('ats_board_url'),
    atsSlug: text('ats_slug'),
    employeeCount: integer('employee_count'),
    industry: text('industry'),
    h1bSponsorCount: integer('h1b_sponsor_count').default(0),
    state: text('state'),
    country: text('country').default('US'),
    linkedinUrl: text('linkedin_url'),
    isPrime: boolean('is_prime').default(false),
    primeMsaStatus: text('prime_msa_status').default('none'), // none | in_progress | signed
    primeMsaSignedAt: timestamp('prime_msa_signed_at'),
    primeContactId: uuid('prime_contact_id').references(() => contacts.id),
    notes: text('notes'),
    // PRD-005 §10.8 / ADR-006 D-14 — the account owner for `existing_client` /
    // `vendor_partner` / `prime_partner` relationship routing (§8.7). Nullable
    // and ON DELETE SET NULL so teammate offboarding is never blocked by a
    // WizMatch-local foreign key.
    accountOwnerUserId: uuid('account_owner_user_id'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    tenantIdIdx: index('wizmatch_companies_tenant_idx').on(t.tenantId),
    domainIdx: index('wizmatch_companies_domain_idx').on(t.domain),
    primeIdx: index('wizmatch_companies_prime_idx').on(t.isPrime),
    tenantNameUniq: uniqueIndex('wizmatch_companies_tenant_name_idx').on(t.tenantId, t.name),
    // Additive, non-partial — composite-FK parent target for every WizMatch
    // outbound-policy table referencing a company (PRD-005 §10.10.1).
    tenantIdIdUniq: uniqueIndex('wizmatch_companies_tenant_id_id_uniq').on(t.tenantId, t.id),
    accountOwnerFk: foreignKey({
      columns: [t.tenantId, t.accountOwnerUserId],
      foreignColumns: [users.tenantId, users.id],
      name: 'wizmatch_companies_account_owner_fk',
    }).onDelete('set null'),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 49 — wizmatch_job_signals
// ---------------------------------------------------------------------------
export const wizmatchJobSignals = pgTable(
  'wizmatch_job_signals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    companyId: uuid('company_id').references(() => wizmatchCompanies.id),
    jobTitle: text('job_title').notNull(),
    jobUrl: text('job_url'),
    source: text('source').notNull(), // jobspy | greenhouse | lever | ashby | dice | manual
    providerId: text('provider_id'),
    identityFingerprint: text('identity_fingerprint'),
    postedAt: timestamp('posted_at'),
    firstSeenAt: timestamp('first_seen_at').defaultNow(),
    lastSeenAt: timestamp('last_seen_at').defaultNow(),
    daysOpen: integer('days_open').default(0),
    repostCount: integer('repost_count').default(0),
    salaryRange: text('salary_range'),
    employmentType: text('employment_type'), // C2C | W2 | 1099 | contract | FTE | unknown
    keywords: text('keywords').array().default([]),
    location: text('location'),
    rawText: text('raw_text'),
    score: integer('score').default(0),
    scoreBreakdown: jsonb('score_breakdown').default({}),
    status: text('status').default('new'), // new | scored | enriched | matched | drafted | sent | replied_positive | replied_other | dead | placed
    contactId: uuid('contact_id').references(() => contacts.id),
    companyVolumeCount: integer('company_volume_count').default(0),
    matchedCandidateIds: uuid('matched_candidate_ids').array().default([]),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    tenantScoreIdx: index('wizmatch_job_signals_tenant_score_idx').on(t.tenantId, t.score),
    statusIdx: index('wizmatch_job_signals_status_idx').on(t.status),
    companyIdx: index('wizmatch_job_signals_company_idx').on(t.companyId),
    keywordsIdx: index('wizmatch_job_signals_keywords_idx').on(t.keywords),
    tenantJobUrlUniq: uniqueIndex('wizmatch_job_signals_tenant_job_url_idx').on(t.tenantId, t.jobUrl),
    tenantProviderUniq: uniqueIndex('wizmatch_job_signals_tenant_provider_idx')
      .on(t.tenantId, t.source, t.providerId)
      .where(sql`${t.providerId} IS NOT NULL`),
    tenantFingerprintUniq: uniqueIndex('wizmatch_job_signals_tenant_fingerprint_idx')
      .on(t.tenantId, t.identityFingerprint)
      .where(sql`${t.identityFingerprint} IS NOT NULL`),
    // Additive, non-partial — composite-FK parent target for
    // wizmatch_company_policies.signal_id (PRD-005 §10.10.1).
    tenantIdIdUniq: uniqueIndex('wizmatch_job_signals_tenant_id_id_uniq').on(t.tenantId, t.id),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 50 — wizmatch_candidates
// ---------------------------------------------------------------------------
export const wizmatchCandidates = pgTable(
  'wizmatch_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    contactId: uuid('contact_id').notNull().references(() => contacts.id),
    skills: text('skills').array().notNull(),
    location: text('location'),
    visaStatus: text('visa_status'), // H1B | GC | USC | OPT | TN | H4EAD | unknown
    experienceYears: integer('experience_years'),
    rateHourly: integer('rate_hourly'),
    rateCurrency: text('rate_currency').default('USD'),
    ratePeriod: text('rate_period').default('hourly'),
    normalizedAnnualRate: integer('normalized_annual_rate'),
    normalizationCurrency: text('normalization_currency'),
    conversionRate: numeric('conversion_rate', { precision: 18, scale: 6 }),
    conversionSource: text('conversion_source'),
    conversionDate: date('conversion_date'),
    availabilityDate: date('availability_date'),
    availabilityStatus: text('availability_status').default('available'), // available | submitted | interviewing | placed | benched
    source: text('source'), // xray | github | naukri | bench_network | referral | manual
    linkedinUrl: text('linkedin_url'),
    githubUrl: text('github_url'),
    resumeUrl: text('resume_url'),
    matchScore: integer('match_score'),
    isWizmatchCertified: boolean('is_wizmatch_certified').default(false),
    indiaSpecific: jsonb('india_specific').default({}),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    tenantIdIdx: index('wizmatch_candidates_tenant_idx').on(t.tenantId),
    skillsIdx: index('wizmatch_candidates_skills_idx').on(t.skills),
    availabilityIdx: index('wizmatch_candidates_availability_idx').on(t.availabilityStatus),
    visaIdx: index('wizmatch_candidates_visa_idx').on(t.visaStatus),
    sourceIdx: index('wizmatch_candidates_source_idx').on(t.source),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 51 — wizmatch_placements
// ---------------------------------------------------------------------------
export const wizmatchPlacements = pgTable(
  'wizmatch_placements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    dealId: uuid('deal_id').references(() => deals.id),
    candidateId: uuid('candidate_id').references(() => wizmatchCandidates.id),
    jobSignalId: uuid('job_signal_id').references(() => wizmatchJobSignals.id),
    companyId: uuid('company_id').references(() => wizmatchCompanies.id),
    primeCompanyId: uuid('prime_company_id').references(() => wizmatchCompanies.id),
    placementType: text('placement_type'), // contract_c2c | contract_w2 | contract_1099 | permanent
    billRateHourly: integer('bill_rate_hourly'),
    payRateHourly: integer('pay_rate_hourly'),
    marginHourly: integer('margin_hourly'),
    currency: text('currency').default('USD'),
    contractStartDate: date('contract_start_date'),
    contractEndDate: date('contract_end_date'),
    contractLengthMonths: integer('contract_length_months'),
    permFeePercentage: numeric('perm_fee_percentage', { precision: 5, scale: 2 }),
    permCtcAnnual: integer('perm_ctc_annual'),
    permFeeAmount: integer('perm_fee_amount'),
    status: text('status').default('submitted'), // submitted | interviewing | offered | started | ended | lost
    rtrDocumentUrl: text('rtr_document_url'),
    contractDocumentUrl: text('contract_document_url'),
    requirementId: uuid('requirement_id').references(() => wizmatchRequirements.id),
    submissionId: uuid('submission_id').references(() => wizmatchSubmissions.id),
    offerId: uuid('offer_id').references(() => wizmatchOffers.id),
    billingClientId: uuid('billing_client_id').references(() => billingClients.id),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('wizmatch_placements_tenant_status_idx').on(t.tenantId, t.status),
    candidateIdx: index('wizmatch_placements_candidate_idx').on(t.candidateId),
    companyIdx: index('wizmatch_placements_company_idx').on(t.companyId),
    primeIdx: index('wizmatch_placements_prime_idx').on(t.primeCompanyId),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 52 — wizmatch_domain_health
// ---------------------------------------------------------------------------
export const wizmatchDomainHealth = pgTable(
  'wizmatch_domain_health',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    domain: text('domain').notNull(),
    inboxAddresses: text('inbox_addresses').array().default([]),
    lastCheckAt: timestamp('last_check_at'),
    spfOk: boolean('spf_ok'),
    dkimOk: boolean('dkim_ok'),
    dmarcOk: boolean('dmarc_ok'),
    blacklisted: boolean('blacklisted').default(false),
    blacklistSources: text('blacklist_sources').array().default([]),
    replyRate7d: real('reply_rate_7d').default(0),
    bounceRate7d: real('bounce_rate_7d').default(0),
    sends7d: integer('sends_7d').default(0),
    status: text('status').default('healthy'), // healthy | warn | paused | blacklisted
    pausedReason: text('paused_reason'),
    pausedAt: timestamp('paused_at'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    statusIdx: index('wizmatch_domain_health_status_idx').on(t.status),
    tenantDomainUniq: uniqueIndex('wizmatch_domain_health_tenant_domain_idx').on(t.tenantId, t.domain),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 53 — wizmatch_suppression_list
// ---------------------------------------------------------------------------
export const wizmatchSuppressionList = pgTable(
  'wizmatch_suppression_list',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    contactId: uuid('contact_id').references(() => contacts.id),
    email: text('email'),
    reason: text('reason').notNull(), // unsubscribe | hard_bounce | complaint | do_not_contact | manual
    sourceChannel: text('source_channel'), // email | linkedin | sms | phone
    suppressedAt: timestamp('suppressed_at').defaultNow(),
    notes: text('notes'),
    // PRD-005 §10.8 / ADR-006 D-4 — marks a channel invalid inside the
    // WizMatch-owned suppression table rather than adding columns to the
    // shared core `contact_channels`. `suppression_scope` is deliberately
    // NOT added (D-4/D-15) — this table stays exact email/channel grain and
    // the existing UNIQUE(tenant_id, email) index below is untouched.
    contactChannelId: uuid('contact_channel_id'),
    channelInvalid: boolean('channel_invalid').notNull().default(false),
  },
  (t) => ({
    tenantEmailIdx: index('wizmatch_suppression_tenant_email_idx').on(t.tenantId, t.email),
    contactIdx: index('wizmatch_suppression_contact_idx').on(t.contactId),
    tenantEmailUniq: uniqueIndex('wizmatch_suppression_tenant_email_uniq_idx').on(t.tenantId, t.email),
    contactChannelFk: foreignKey({
      columns: [t.tenantId, t.contactChannelId],
      foreignColumns: [contactChannels.tenantId, contactChannels.id],
      name: 'wizmatch_suppression_list_contact_channel_fk',
    }).onDelete('set null'),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 54 — wizmatch_requirements
// A client-supplied job requirement (typed or uploaded JD) that we reformat
// into our own branded requirement sheet (PDF) to broadcast to sub-vendors.
// ---------------------------------------------------------------------------
export const wizmatchRequirements = pgTable(
  'wizmatch_requirements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    companyId: uuid('company_id').references(() => wizmatchCompanies.id), // end client (nullable / maskable)
    title: text('title').notNull(),
    rawJd: text('raw_jd'), // original pasted/extracted JD text
    requiredSkills: text('required_skills').array().default([]),
    niceToHaveSkills: text('nice_to_have_skills').array().default([]),
    minExperience: integer('min_experience'), // years
    maxExperience: integer('max_experience'),
    location: text('location'),
    workMode: text('work_mode'), // onsite | remote | hybrid
    employmentType: text('employment_type'), // contract_c2c | contract_w2 | contract | permanent | ...
    region: text('region').default('india'), // india | us
    budgetMin: integer('budget_min'),
    budgetMax: integer('budget_max'),
    budgetCurrency: text('budget_currency').default('INR'),
    budgetPeriod: text('budget_period').default('monthly'), // hourly | monthly | annual
    normalizedBudgetMinAnnual: integer('normalized_budget_min_annual'),
    normalizedBudgetMaxAnnual: integer('normalized_budget_max_annual'),
    normalizationCurrency: text('normalization_currency'),
    conversionRate: numeric('conversion_rate', { precision: 18, scale: 6 }),
    conversionSource: text('conversion_source'),
    conversionDate: date('conversion_date'),
    positions: integer('positions').default(1),
    priority: text('priority').default('normal'), // low | normal | high | urgent
    maskClient: boolean('mask_client').default(true), // hide end-client name on the vendor sheet
    sourceFileUrl: text('source_file_url'), // uploaded JD file in R2
    sheetUrl: text('sheet_url'), // generated branded PDF in R2
    vendorNotes: text('vendor_notes'),
    status: text('status').default('draft'), // draft | sheet_ready | shared | closed
    attributionStatus: text('attribution_status').notNull().default('needs_attribution'), // needs_attribution | attributed
    stage: text('stage').notNull().default('draft'), // Phase 1 operating stage; legacy status remains during compatibility rollout
    stageEnteredAt: timestamp('stage_entered_at').defaultNow(),
    receivedAt: timestamp('received_at'),
    acceptedAt: timestamp('accepted_at'),
    lastActivityAt: timestamp('last_activity_at').defaultNow(),
    nextAction: text('next_action'),
    nextActionDueAt: timestamp('next_action_due_at'),
    slaDueAt: timestamp('sla_due_at'),
    closureReason: text('closure_reason'),
    sourceJobSignalId: uuid('source_job_signal_id').references(() => wizmatchJobSignals.id),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('wizmatch_requirements_tenant_status_idx').on(t.tenantId, t.status),
    companyIdx: index('wizmatch_requirements_company_idx').on(t.companyId),
    regionIdx: index('wizmatch_requirements_region_idx').on(t.region),
    stageIdx: index('wizmatch_requirements_stage_idx').on(t.tenantId, t.stage),
    nextActionIdx: index('wizmatch_requirements_next_action_idx').on(t.tenantId, t.nextActionDueAt),
    // Additive, non-partial — composite-FK parent target for
    // wizmatch_company_policies.requirement_id (PRD-005 §10.10.1).
    tenantIdIdUniq: uniqueIndex('wizmatch_requirements_tenant_id_id_uniq').on(t.tenantId, t.id),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 54A — wizmatch_company_contacts
// Durable tenant-scoped relationship between a company and canonical CRM contact.
// ---------------------------------------------------------------------------
export const wizmatchCompanyContacts = pgTable(
  'wizmatch_company_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    companyId: uuid('company_id').notNull().references(() => wizmatchCompanies.id),
    contactId: uuid('contact_id').notNull().references(() => contacts.id),
    relationshipStage: text('relationship_stage').notNull().default('active'), // active | inactive | do_not_contact
    businessUnit: text('business_unit'),
    seniority: text('seniority'),
    ownerUserId: uuid('owner_user_id').references(() => users.id),
    sourceType: text('source_type').notNull().default('manual'),
    sourceId: text('source_id'),
    sourceConfidence: integer('source_confidence'),
    lastActivityAt: timestamp('last_activity_at').defaultNow(),
    nextAction: text('next_action'),
    nextActionDueAt: timestamp('next_action_due_at'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    tenantCompanyIdx: index('wizmatch_company_contacts_tenant_company_idx').on(t.tenantId, t.companyId),
    tenantContactIdx: index('wizmatch_company_contacts_tenant_contact_idx').on(t.tenantId, t.contactId),
    nextActionIdx: index('wizmatch_company_contacts_next_action_idx').on(t.tenantId, t.nextActionDueAt),
    relationshipUniq: uniqueIndex('wizmatch_company_contacts_relationship_idx').on(t.tenantId, t.companyId, t.contactId),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 54B — wizmatch_company_contact_roles
// A person may carry several durable roles without overwriting prior meaning.
// ---------------------------------------------------------------------------
export const wizmatchCompanyContactRoles = pgTable(
  'wizmatch_company_contact_roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    companyContactId: uuid('company_contact_id').notNull().references(() => wizmatchCompanyContacts.id),
    role: text('role').notNull(),
    active: boolean('active').notNull().default(true),
    addedBy: uuid('added_by').references(() => users.id),
    addedAt: timestamp('added_at').defaultNow(),
    deactivatedBy: uuid('deactivated_by').references(() => users.id),
    deactivatedAt: timestamp('deactivated_at'),
  },
  (t) => ({
    tenantRelationshipIdx: index('wizmatch_company_contact_roles_relationship_idx').on(t.tenantId, t.companyContactId),
    roleUniq: uniqueIndex('wizmatch_company_contact_roles_unique_idx').on(t.tenantId, t.companyContactId, t.role),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 54C — wizmatch_requirement_contacts
// Explicit attribution: which person supplied or manages which requirement.
// ---------------------------------------------------------------------------
export const wizmatchRequirementContacts = pgTable(
  'wizmatch_requirement_contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    requirementId: uuid('requirement_id').notNull().references(() => wizmatchRequirements.id),
    companyContactId: uuid('company_contact_id').notNull().references(() => wizmatchCompanyContacts.id),
    role: text('role').notNull().default('source'),
    isPrimarySource: boolean('is_primary_source').notNull().default(false),
    active: boolean('active').notNull().default(true),
    receivedChannel: text('received_channel'),
    notes: text('notes'),
    attributedBy: uuid('attributed_by').references(() => users.id),
    attributedAt: timestamp('attributed_at').defaultNow(),
    deactivatedBy: uuid('deactivated_by').references(() => users.id),
    deactivatedAt: timestamp('deactivated_at'),
  },
  (t) => ({
    tenantRequirementIdx: index('wizmatch_requirement_contacts_requirement_idx').on(t.tenantId, t.requirementId),
    companyContactIdx: index('wizmatch_requirement_contacts_company_contact_idx').on(t.companyContactId),
    attributionUniq: uniqueIndex('wizmatch_requirement_contacts_unique_idx').on(t.tenantId, t.requirementId, t.companyContactId, t.role),
    primarySourceUniq: uniqueIndex('wizmatch_requirement_contacts_primary_idx')
      .on(t.tenantId, t.requirementId)
      .where(sql`${t.active} = true AND ${t.isPrimarySource} = true`),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 54D — wizmatch_requirement_assignments
// Separate account, delivery and recruiter ownership with preserved history.
// ---------------------------------------------------------------------------
export const wizmatchRequirementAssignments = pgTable(
  'wizmatch_requirement_assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    requirementId: uuid('requirement_id').notNull().references(() => wizmatchRequirements.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    role: text('role').notNull(), // account_owner | delivery_owner | recruiter
    active: boolean('active').notNull().default(true),
    assignedBy: uuid('assigned_by').references(() => users.id),
    assignedAt: timestamp('assigned_at').defaultNow(),
    unassignedBy: uuid('unassigned_by').references(() => users.id),
    unassignedAt: timestamp('unassigned_at'),
  },
  (t) => ({
    tenantRequirementIdx: index('wizmatch_requirement_assignments_requirement_idx').on(t.tenantId, t.requirementId),
    tenantUserIdx: index('wizmatch_requirement_assignments_user_idx').on(t.tenantId, t.userId),
    activeAssignmentUniq: uniqueIndex('wizmatch_requirement_assignments_active_idx')
      .on(t.tenantId, t.requirementId, t.userId, t.role)
      .where(sql`${t.active} = true`),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 54E — wizmatch_staffing_events
// Append-only business timeline. Later gates add candidate/delivery links.
// ---------------------------------------------------------------------------
export const wizmatchStaffingEvents = pgTable(
  'wizmatch_staffing_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    eventType: text('event_type').notNull(),
    channel: text('channel'),
    direction: text('direction'),
    source: text('source').notNull().default('staffing_os'),
    sourceId: text('source_id'),
    companyId: uuid('company_id').references(() => wizmatchCompanies.id),
    contactId: uuid('contact_id').references(() => contacts.id),
    companyContactId: uuid('company_contact_id').references(() => wizmatchCompanyContacts.id),
    requirementId: uuid('requirement_id').references(() => wizmatchRequirements.id),
    candidateId: uuid('candidate_id').references(() => wizmatchCandidates.id),
    matchId: uuid('match_id').references(() => wizmatchCandidateRequirementMatches.id),
    submissionId: uuid('submission_id').references(() => wizmatchSubmissions.id),
    placementId: uuid('placement_id').references(() => wizmatchPlacements.id),
    payload: jsonb('payload').notNull().default({}),
    occurredAt: timestamp('occurred_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    tenantOccurredIdx: index('wizmatch_staffing_events_occurred_idx').on(t.tenantId, t.occurredAt),
    requirementIdx: index('wizmatch_staffing_events_requirement_idx').on(t.tenantId, t.requirementId, t.occurredAt),
    companyIdx: index('wizmatch_staffing_events_company_idx').on(t.tenantId, t.companyId, t.occurredAt),
    companyContactIdx: index('wizmatch_staffing_events_company_contact_idx').on(t.tenantId, t.companyContactId, t.occurredAt),
    candidateIdx: index('wizmatch_staffing_events_candidate_idx').on(t.tenantId, t.candidateId, t.occurredAt),
    submissionIdx: index('wizmatch_staffing_events_submission_idx').on(t.tenantId, t.submissionId, t.occurredAt),
    placementIdx: index('wizmatch_staffing_events_placement_idx').on(t.tenantId, t.placementId, t.occurredAt),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 54F — wizmatch_task_links
// Keeps the shared task system while adding foreign-key-backed staffing context.
// ---------------------------------------------------------------------------
export const wizmatchTaskLinks = pgTable(
  'wizmatch_task_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    taskId: uuid('task_id').notNull().references(() => tasks.id),
    companyId: uuid('company_id').references(() => wizmatchCompanies.id),
    contactId: uuid('contact_id').references(() => contacts.id),
    companyContactId: uuid('company_contact_id').references(() => wizmatchCompanyContacts.id),
    requirementId: uuid('requirement_id').references(() => wizmatchRequirements.id),
    candidateId: uuid('candidate_id').references(() => wizmatchCandidates.id),
    submissionId: uuid('submission_id').references(() => wizmatchSubmissions.id),
    jobSignalId: uuid('job_signal_id').references(() => wizmatchJobSignals.id),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    tenantTaskUniq: uniqueIndex('wizmatch_task_links_task_idx').on(t.tenantId, t.taskId),
    requirementIdx: index('wizmatch_task_links_requirement_idx').on(t.tenantId, t.requirementId),
    companyIdx: index('wizmatch_task_links_company_idx').on(t.tenantId, t.companyId),
    candidateIdx: index('wizmatch_task_links_candidate_idx').on(t.tenantId, t.candidateId),
    submissionIdx: index('wizmatch_task_links_submission_idx').on(t.tenantId, t.submissionId),
    jobSignalIdx: index('wizmatch_task_links_job_signal_idx').on(t.tenantId, t.jobSignalId),
  }),
);

// ---------------------------------------------------------------------------
// RESULTS-FIRST SOURCING — provider run audit, quota, and requirement trace.
// ---------------------------------------------------------------------------
export const wizmatchSourceRuns = pgTable(
  'wizmatch_source_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    provider: text('provider').notNull(), // theirstack | ats | xray | poc_discovery
    trigger: text('trigger').notNull().default('manual'), // manual | scheduled
    status: text('status').notNull().default('running'), // running | succeeded | partial | failed | skipped | blocked
    requirementId: uuid('requirement_id').references(() => wizmatchRequirements.id),
    companyId: uuid('company_id').references(() => wizmatchCompanies.id),
    query: jsonb('query').notNull().default({}),
    cursorBefore: text('cursor_before'),
    cursorAfter: text('cursor_after'),
    fetchedCount: integer('fetched_count').notNull().default(0),
    insertedCount: integer('inserted_count').notNull().default(0),
    updatedCount: integer('updated_count').notNull().default(0),
    rejectedCount: integer('rejected_count').notNull().default(0),
    duplicateCount: integer('duplicate_count').notNull().default(0),
    quotaConsumed: integer('quota_consumed').notNull().default(0),
    errorMessage: text('error_message'),
    requestedBy: uuid('requested_by').references(() => users.id),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    finishedAt: timestamp('finished_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    tenantCreatedIdx: index('wizmatch_source_runs_tenant_created_idx').on(t.tenantId, t.createdAt),
    tenantProviderIdx: index('wizmatch_source_runs_tenant_provider_idx').on(t.tenantId, t.provider, t.createdAt),
    requirementIdx: index('wizmatch_source_runs_requirement_idx').on(t.tenantId, t.requirementId),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 55 — wizmatch_company_intelligence
// Phase 2 persistence for Contact Intelligence qualification/review state.
// Paid enrichment stays disabled by service guardrails until a later approved phase.
// ---------------------------------------------------------------------------
export const wizmatchCompanyIntelligence = pgTable(
  'wizmatch_company_intelligence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    companyId: uuid('company_id').notNull().references(() => wizmatchCompanies.id),
    qualificationTier: text('qualification_tier').default('C'), // A | B | C | Reject
    qualificationScore: integer('qualification_score').default(0),
    targetRegion: text('target_region').default('india'), // india | us
    isItStaffingFit: boolean('is_it_staffing_fit').default(false),
    status: text('status').default('new'), // new | qualified | needs_review | discovery_blocked | discovered | rejected | suppressed | cooldown
    reviewStatus: text('review_status').default('needs_review'), // needs_review | approved | rejected | watchlist
    reviewAction: text('review_action'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at'),
    rejectionReason: text('rejection_reason'),
    reviewNotes: text('review_notes'),
    lastQualifiedAt: timestamp('last_qualified_at'),
    lastDiscoveredAt: timestamp('last_discovered_at'),
    nextRefreshAt: timestamp('next_refresh_at'),
    costCentsTotal: integer('cost_cents_total').default(0),
    sourceSummary: jsonb('source_summary').default({}),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('wizmatch_ci_tenant_status_idx').on(t.tenantId, t.status),
    tenantReviewIdx: index('wizmatch_ci_tenant_review_idx').on(t.tenantId, t.reviewStatus),
    tierIdx: index('wizmatch_ci_tier_idx').on(t.qualificationTier),
    nextRefreshIdx: index('wizmatch_ci_next_refresh_idx').on(t.nextRefreshAt),
    tenantCompanyUniq: uniqueIndex('wizmatch_ci_tenant_company_idx').on(t.tenantId, t.companyId),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 56 — wizmatch_contact_candidates
// Reviewable contact candidates from internal CRM reuse/free discovery.
// Outreach cannot be sent from this table without the existing manual review flow.
// ---------------------------------------------------------------------------
export const wizmatchContactCandidates = pgTable(
  'wizmatch_contact_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    companyIntelligenceId: uuid('company_intelligence_id').references(() => wizmatchCompanyIntelligence.id),
    companyId: uuid('company_id').notNull().references(() => wizmatchCompanies.id),
    crmContactId: uuid('crm_contact_id').references(() => contacts.id),
    name: text('name').notNull(),
    title: text('title'),
    roleCategory: text('role_category'),
    email: text('email'),
    phone: text('phone'),
    linkedinUrl: text('linkedin_url'),
    location: text('location'),
    region: text('region').default('india'), // india | us
    source: text('source').default('internal_crm'), // internal_crm | prior_signal | website_manual | manual_seed
    sourceUrl: text('source_url'),
    deliverabilityStatus: text('deliverability_status').default('unverified'),
    rankingScore: integer('ranking_score').default(0),
    relationshipScore: integer('relationship_score').default(0),
    confidenceScore: integer('confidence_score').default(0),
    status: text('status').default('needs_review'), // new | needs_review | approved | rejected | do_not_contact | linked_to_crm | stale
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at'),
    reviewedBy: uuid('reviewed_by').references(() => users.id),
    reviewedAt: timestamp('reviewed_at'),
    rejectionReason: text('rejection_reason'),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('wizmatch_cc_tenant_status_idx').on(t.tenantId, t.status),
    companyStatusIdx: index('wizmatch_cc_company_status_idx').on(t.companyId, t.status),
    intelligenceIdx: index('wizmatch_cc_intelligence_idx').on(t.companyIntelligenceId),
    crmContactIdx: index('wizmatch_cc_crm_contact_idx').on(t.crmContactId),
    scoreIdx: index('wizmatch_cc_score_idx').on(t.rankingScore),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 57 — wizmatch_discovery_runs
// Audit/cost log for discovery attempts. Phase 1/2 rows must be zero-cost internal/free runs.
// ---------------------------------------------------------------------------
export const wizmatchDiscoveryRuns = pgTable(
  'wizmatch_discovery_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    companyIntelligenceId: uuid('company_intelligence_id').references(() => wizmatchCompanyIntelligence.id),
    companyId: uuid('company_id').notNull().references(() => wizmatchCompanies.id),
    runType: text('run_type').default('internal_reuse'),
    source: text('source').default('internal_crm'),
    status: text('status').default('queued'), // queued | running | succeeded | partial | failed | skipped | blocked_by_cap
    costCents: integer('cost_cents').default(0),
    paidProvider: boolean('paid_provider').default(false),
    requestedBy: uuid('requested_by').references(() => users.id),
    startedAt: timestamp('started_at'),
    finishedAt: timestamp('finished_at'),
    inputSnapshot: jsonb('input_snapshot').default({}),
    resultCounts: jsonb('result_counts').default({}),
    errorMessage: text('error_message'),
    metadata: jsonb('metadata').default({}),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    tenantStatusIdx: index('wizmatch_dr_tenant_status_idx').on(t.tenantId, t.status),
    companyIdx: index('wizmatch_dr_company_idx').on(t.companyId),
    intelligenceIdx: index('wizmatch_dr_intelligence_idx').on(t.companyIntelligenceId),
    sourceIdx: index('wizmatch_dr_source_idx').on(t.source),
    createdAtIdx: index('wizmatch_dr_created_at_idx').on(t.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// GATE B — canonical skills and persistent candidate/requirement decisions
// ---------------------------------------------------------------------------
export const wizmatchSkills = pgTable('wizmatch_skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  family: text('family').notNull(),
  specialization: text('specialization').notNull(),
  platformVersion: text('platform_version'),
  canonicalLabel: text('canonical_label').notNull(),
  active: boolean('active').notNull().default(true),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantLabelUniq: uniqueIndex('wizmatch_skills_tenant_label_idx').on(t.tenantId, t.canonicalLabel),
  familyIdx: index('wizmatch_skills_family_idx').on(t.tenantId, t.family, t.specialization),
}));

export const wizmatchSkillAliases = pgTable('wizmatch_skill_aliases', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  skillId: uuid('skill_id').notNull().references(() => wizmatchSkills.id),
  rawAlias: text('raw_alias').notNull(),
  normalizedAlias: text('normalized_alias').notNull(),
  provenance: text('provenance').notNull().default('manual'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at').defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  tenantAliasUniq: uniqueIndex('wizmatch_skill_aliases_tenant_alias_idx').on(t.tenantId, t.normalizedAlias),
  skillIdx: index('wizmatch_skill_aliases_skill_idx').on(t.tenantId, t.skillId),
}));

export const wizmatchRequirementSkills = pgTable('wizmatch_requirement_skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  requirementId: uuid('requirement_id').notNull().references(() => wizmatchRequirements.id),
  skillId: uuid('skill_id').notNull().references(() => wizmatchSkills.id),
  importance: text('importance').notNull().default('mandatory'),
  minimumYears: integer('minimum_years'),
  evidence: text('evidence'),
  allowBroadFamily: boolean('allow_broad_family').notNull().default(false),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantRequirementIdx: index('wizmatch_requirement_skills_requirement_idx').on(t.tenantId, t.requirementId),
  requirementSkillUniq: uniqueIndex('wizmatch_requirement_skills_unique_idx').on(t.tenantId, t.requirementId, t.skillId),
}));

export const wizmatchCandidateSkills = pgTable('wizmatch_candidate_skills', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  candidateId: uuid('candidate_id').notNull().references(() => wizmatchCandidates.id),
  skillId: uuid('skill_id').notNull().references(() => wizmatchSkills.id),
  experienceYears: integer('experience_years'),
  lastUsedAt: date('last_used_at'),
  evidence: text('evidence'),
  confidence: integer('confidence'),
  verified: boolean('verified').notNull().default(false),
  verifiedBy: uuid('verified_by').references(() => users.id),
  verifiedAt: timestamp('verified_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantCandidateIdx: index('wizmatch_candidate_skills_candidate_idx').on(t.tenantId, t.candidateId),
  candidateSkillUniq: uniqueIndex('wizmatch_candidate_skills_unique_idx').on(t.tenantId, t.candidateId, t.skillId),
}));

export const wizmatchCandidateRequirementMatches = pgTable('wizmatch_candidate_requirement_matches', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  requirementId: uuid('requirement_id').notNull().references(() => wizmatchRequirements.id),
  candidateId: uuid('candidate_id').notNull().references(() => wizmatchCandidates.id),
  scoreVersion: text('score_version').notNull().default('gate-b-v1'),
  score: integer('score').notNull().default(0),
  dimensions: jsonb('dimensions').notNull().default({}),
  blockers: jsonb('blockers').notNull().default([]),
  missingEvidence: jsonb('missing_evidence').notNull().default([]),
  humanDecision: text('human_decision').notNull().default('unreviewed'),
  decisionReason: text('decision_reason'),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
  reviewedAt: timestamp('reviewed_at'),
  snapshotVersion: integer('snapshot_version').notNull().default(1),
  recalculatedAt: timestamp('recalculated_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  pairUniq: uniqueIndex('wizmatch_matches_pair_idx').on(t.tenantId, t.requirementId, t.candidateId),
  requirementScoreIdx: index('wizmatch_matches_requirement_score_idx').on(t.tenantId, t.requirementId, t.score),
  candidateIdx: index('wizmatch_matches_candidate_idx').on(t.tenantId, t.candidateId),
}));

export const wizmatchMatchSnapshots = pgTable('wizmatch_match_snapshots', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  matchId: uuid('match_id').notNull().references(() => wizmatchCandidateRequirementMatches.id),
  requirementId: uuid('requirement_id').notNull().references(() => wizmatchRequirements.id),
  candidateId: uuid('candidate_id').notNull().references(() => wizmatchCandidates.id),
  version: integer('version').notNull(),
  scoreVersion: text('score_version').notNull(),
  inputEvidence: jsonb('input_evidence').notNull(),
  outputEvidence: jsonb('output_evidence').notNull(),
  score: integer('score').notNull(),
  blockers: jsonb('blockers').notNull().default([]),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  matchVersionUniq: uniqueIndex('wizmatch_match_snapshots_version_idx').on(t.tenantId, t.matchId, t.version),
  pairIdx: index('wizmatch_match_snapshots_pair_idx').on(t.tenantId, t.requirementId, t.candidateId),
}));

// ---------------------------------------------------------------------------
// GATE C — consent, delivery and commercial close
// ---------------------------------------------------------------------------
export const wizmatchCandidateConsents = pgTable('wizmatch_candidate_consents', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  candidateId: uuid('candidate_id').notNull().references(() => wizmatchCandidates.id),
  requirementId: uuid('requirement_id').notNull().references(() => wizmatchRequirements.id),
  status: text('status').notNull().default('requested'),
  consentType: text('consent_type').notNull().default('rtr'),
  terms: jsonb('terms').notNull().default({}),
  documentReference: text('document_reference'),
  requestedBy: uuid('requested_by').references(() => users.id),
  requestedAt: timestamp('requested_at').notNull().defaultNow(),
  grantedAt: timestamp('granted_at'),
  expiresAt: timestamp('expires_at'),
  revokedAt: timestamp('revoked_at'),
  revocationReason: text('revocation_reason'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  pairIdx: index('wizmatch_consents_pair_idx').on(t.tenantId, t.requirementId, t.candidateId),
  activeConsentUniq: uniqueIndex('wizmatch_consents_active_idx').on(t.tenantId, t.requirementId, t.candidateId)
    .where(sql`${t.status} IN ('requested','granted')`),
}));

export const wizmatchSubmissions = pgTable('wizmatch_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  requirementId: uuid('requirement_id').notNull().references(() => wizmatchRequirements.id),
  candidateId: uuid('candidate_id').notNull().references(() => wizmatchCandidates.id),
  matchId: uuid('match_id').references(() => wizmatchCandidateRequirementMatches.id),
  consentId: uuid('consent_id').references(() => wizmatchCandidateConsents.id),
  status: text('status').notNull().default('draft'),
  version: integer('version').notNull().default(1),
  resendCount: integer('resend_count').notNull().default(0),
  submissionPayload: jsonb('submission_payload').notNull().default({}),
  preparedBy: uuid('prepared_by').references(() => users.id),
  preparedAt: timestamp('prepared_at').notNull().defaultNow(),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  firstSentAt: timestamp('first_sent_at'),
  lastSentAt: timestamp('last_sent_at'),
  withdrawnAt: timestamp('withdrawn_at'),
  withdrawalReason: text('withdrawal_reason'),
  nextAction: text('next_action'),
  nextActionDueAt: timestamp('next_action_due_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  requirementIdx: index('wizmatch_submissions_requirement_idx').on(t.tenantId, t.requirementId, t.status),
  candidateIdx: index('wizmatch_submissions_candidate_idx').on(t.tenantId, t.candidateId),
  activePairUniq: uniqueIndex('wizmatch_submissions_active_pair_idx').on(t.tenantId, t.requirementId, t.candidateId)
    .where(sql`${t.status} NOT IN ('withdrawn','rejected','closed')`),
}));

export const wizmatchSubmissionRecipients = pgTable('wizmatch_submission_recipients', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  submissionId: uuid('submission_id').notNull().references(() => wizmatchSubmissions.id),
  companyContactId: uuid('company_contact_id').references(() => wizmatchCompanyContacts.id),
  name: text('name').notNull(),
  email: text('email'),
  role: text('role').notNull().default('recipient'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({ submissionIdx: index('wizmatch_submission_recipients_submission_idx').on(t.tenantId, t.submissionId) }));

export const wizmatchSubmissionEvents = pgTable('wizmatch_submission_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  submissionId: uuid('submission_id').notNull().references(() => wizmatchSubmissions.id),
  eventType: text('event_type').notNull(),
  version: integer('version').notNull(),
  actorUserId: uuid('actor_user_id').references(() => users.id),
  payload: jsonb('payload').notNull().default({}),
  occurredAt: timestamp('occurred_at').notNull().defaultNow(),
}, (t) => ({ submissionVersionUniq: uniqueIndex('wizmatch_submission_events_version_idx').on(t.tenantId, t.submissionId, t.version) }));

export const wizmatchInterviewRounds = pgTable('wizmatch_interview_rounds', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  submissionId: uuid('submission_id').notNull().references(() => wizmatchSubmissions.id),
  roundNumber: integer('round_number').notNull(),
  roundType: text('round_type').notNull().default('client'),
  status: text('status').notNull().default('scheduled'),
  scheduledAt: timestamp('scheduled_at'),
  timezone: text('timezone').default('Asia/Kolkata'),
  feedback: text('feedback'),
  outcome: text('outcome'),
  nextAction: text('next_action'),
  nextActionDueAt: timestamp('next_action_due_at'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({ roundUniq: uniqueIndex('wizmatch_interview_rounds_number_idx').on(t.tenantId, t.submissionId, t.roundNumber) }));

export const wizmatchInterviewParticipants = pgTable('wizmatch_interview_participants', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  interviewRoundId: uuid('interview_round_id').notNull().references(() => wizmatchInterviewRounds.id),
  companyContactId: uuid('company_contact_id').references(() => wizmatchCompanyContacts.id),
  userId: uuid('user_id').references(() => users.id),
  name: text('name').notNull(),
  email: text('email'),
  role: text('role').notNull().default('participant'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({ roundIdx: index('wizmatch_interview_participants_round_idx').on(t.tenantId, t.interviewRoundId) }));

export const wizmatchOffers = pgTable('wizmatch_offers', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  submissionId: uuid('submission_id').notNull().references(() => wizmatchSubmissions.id),
  revision: integer('revision').notNull(),
  status: text('status').notNull().default('draft'),
  amount: integer('amount'),
  currency: text('currency').notNull().default('INR'),
  period: text('period').notNull().default('annual'),
  startDate: date('start_date'),
  expiresAt: timestamp('expires_at'),
  terms: jsonb('terms').notNull().default({}),
  createdBy: uuid('created_by').references(() => users.id),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({ revisionUniq: uniqueIndex('wizmatch_offers_revision_idx').on(t.tenantId, t.submissionId, t.revision) }));

export const wizmatchStaffingCommercials = pgTable('wizmatch_staffing_commercials', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  placementId: uuid('placement_id').notNull().references(() => wizmatchPlacements.id),
  model: text('model').notNull(),
  originalAmount: integer('original_amount'),
  originalCurrency: text('original_currency').notNull(),
  originalPeriod: text('original_period').notNull(),
  billAmount: integer('bill_amount'),
  payAmount: integer('pay_amount'),
  loadedCost: integer('loaded_cost'),
  grossMarginAmount: integer('gross_margin_amount'),
  grossMarginPercent: numeric('gross_margin_percent', { precision: 7, scale: 2 }),
  normalizedCurrency: text('normalized_currency'),
  conversionRate: numeric('conversion_rate', { precision: 18, scale: 6 }),
  conversionSource: text('conversion_source'),
  conversionDate: date('conversion_date'),
  replacementEndsAt: date('replacement_ends_at'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({ placementUniq: uniqueIndex('wizmatch_staffing_commercials_placement_idx').on(t.tenantId, t.placementId) }));

export const wizmatchStaffingAdjustments = pgTable('wizmatch_staffing_adjustments', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  placementId: uuid('placement_id').notNull().references(() => wizmatchPlacements.id),
  invoiceId: uuid('invoice_id').references(() => invoices.id),
  paymentId: uuid('payment_id').references(() => payments.id),
  type: text('type').notNull(),
  status: text('status').notNull().default('open'),
  amount: integer('amount'),
  currency: text('currency'),
  reason: text('reason').notNull(),
  resolvedAt: timestamp('resolved_at'),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({ placementIdx: index('wizmatch_staffing_adjustments_placement_idx').on(t.tenantId, t.placementId, t.status) }));

// ---------------------------------------------------------------------------
// Contracts & E-Signature (Documenso signing engine — see docs/esign/)
// Tenant-scoped by tenant_id. Documents live in private R2 (r2:// refs), never
// as blobs. contract_events is append-only; sent contracts are immutable
// (edits = void + clone to v{n+1}). See src/modules/esign/.
// ---------------------------------------------------------------------------

// TABLE — contract_templates
export const contractTemplates = pgTable('contract_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category'), // 'msa' | 'nda' | 'sow' | 'rtr' | 'onboarding' | ...
  sourceType: text('source_type').notNull().default('documenso_template'), // 'documenso_template' | 'uploaded_pdf' | 'generated'
  documensoTemplateId: text('documenso_template_id'),
  currentVersion: integer('current_version').notNull().default(1),
  isActive: boolean('is_active').notNull().default(true),
  metadata: jsonb('metadata').notNull().default({}),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index('contract_templates_tenant_idx').on(t.tenantId),
  activeIdx: index('contract_templates_active_idx').on(t.tenantId, t.isActive),
}));

// TABLE — contracts
export const contracts = pgTable('contracts', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  clientCompanyId: uuid('client_company_id').references(() => billingClients.id),
  templateId: uuid('template_id').references(() => contractTemplates.id),
  parentContractId: uuid('parent_contract_id'), // versioning lineage (clone-on-void); no FK to avoid self-cycle
  title: text('title').notNull(),
  referenceNumber: text('reference_number').notNull(),
  version: integer('version').notNull().default(1),
  status: text('status').notNull().default('DRAFT'), // see contract-state-machine.ts
  provider: text('provider').notNull().default('documenso'),
  documensoDocumentId: text('documenso_document_id'),
  sourceFileKey: text('source_file_key'), // r2:// ref
  generatedFileKey: text('generated_file_key'),
  completedFileKey: text('completed_file_key'),
  auditCertificateFileKey: text('audit_certificate_file_key'),
  sourceDocumentHash: text('source_document_hash'), // sha256 hex
  generatedDocumentHash: text('generated_document_hash'),
  completedDocumentHash: text('completed_document_hash'),
  auditCertificateHash: text('audit_certificate_hash'),
  requiresCountersignature: boolean('requires_countersignature').notNull().default(false),
  metadata: jsonb('metadata').notNull().default({}),
  createdBy: uuid('created_by').references(() => users.id),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at'),
  sentBy: uuid('sent_by').references(() => users.id),
  sentAt: timestamp('sent_at'),
  completedAt: timestamp('completed_at'),
  expiresAt: timestamp('expires_at'),
  voidedAt: timestamp('voided_at'),
  voidReason: text('void_reason'),
  failureReason: text('failure_reason'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  tenantStatusIdx: index('contracts_tenant_status_idx').on(t.tenantId, t.status),
  clientIdx: index('contracts_client_idx').on(t.tenantId, t.clientCompanyId),
  refUniq: uniqueIndex('contracts_reference_number_uniq').on(t.tenantId, t.referenceNumber),
  documensoIdx: index('contracts_documenso_doc_idx').on(t.documensoDocumentId),
}));

// TABLE — contract_recipients
export const contractRecipients = pgTable('contract_recipients', {
  id: uuid('id').primaryKey().defaultRandom(),
  contractId: uuid('contract_id').notNull().references(() => contracts.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  contactId: uuid('contact_id').references(() => contacts.id),
  crmUserId: uuid('crm_user_id').references(() => users.id),
  name: text('name').notNull(),
  email: text('email').notNull(),
  phone: text('phone'),
  companyName: text('company_name'),
  designation: text('designation'),
  signingRole: text('signing_role').notNull().default('client_signer'), // 'client_signer' | 'internal_countersigner'
  signingOrder: integer('signing_order').notNull().default(1),
  status: text('status').notNull().default('pending'), // pending | viewed | signed | rejected
  documensoRecipientId: text('documenso_recipient_id'),
  signingTokenHash: text('signing_token_hash'), // sha256 of the issued HMAC signing-link token (revocation/lookup)
  viewedAt: timestamp('viewed_at'),
  signedAt: timestamp('signed_at'),
  rejectedAt: timestamp('rejected_at'),
  rejectionReason: text('rejection_reason'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => ({
  contractIdx: index('contract_recipients_contract_idx').on(t.contractId, t.signingOrder),
  tenantIdx: index('contract_recipients_tenant_idx').on(t.tenantId),
  documensoIdx: index('contract_recipients_documenso_idx').on(t.documensoRecipientId),
}));

// TABLE — contract_consents (electronic-signing consent, server-recorded)
export const contractConsents = pgTable('contract_consents', {
  id: uuid('id').primaryKey().defaultRandom(),
  contractId: uuid('contract_id').notNull().references(() => contracts.id),
  recipientId: uuid('recipient_id').notNull().references(() => contractRecipients.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  consentText: text('consent_text').notNull(),
  consentVersion: text('consent_version').notNull(),
  electronicTransactionConsent: boolean('electronic_transaction_consent').notNull().default(false),
  reviewedDocument: boolean('reviewed_document').notNull().default(false),
  intentToSign: boolean('intent_to_sign').notNull().default(false),
  authorityConfirmed: boolean('authority_confirmed').notNull().default(false),
  documentHashAtConsent: text('document_hash_at_consent'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  acceptedAt: timestamp('accepted_at').notNull().defaultNow(),
}, (t) => ({
  contractIdx: index('contract_consents_contract_idx').on(t.contractId),
  recipientIdx: index('contract_consents_recipient_idx').on(t.recipientId),
}));

// TABLE — contract_events (append-only audit trail; idempotent on external events)
export const contractEvents = pgTable('contract_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  contractId: uuid('contract_id').notNull().references(() => contracts.id),
  recipientId: uuid('recipient_id').references(() => contractRecipients.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  externalEventId: text('external_event_id'),
  eventType: text('event_type').notNull(),
  eventSource: text('event_source').notNull().default('crm'), // 'crm' | 'documenso'
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  metadata: jsonb('metadata').notNull().default({}),
  eventHash: text('event_hash'),
  occurredAt: timestamp('occurred_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => ({
  contractIdx: index('contract_events_contract_idx').on(t.contractId, t.occurredAt),
  externalUniq: uniqueIndex('contract_events_external_uniq').on(t.eventSource, t.externalEventId)
    .where(sql`${t.externalEventId} IS NOT NULL`),
}));

// ---------------------------------------------------------------------------
// TABLE — seo_content_calendar
// Previously an ensure*-pattern table only (created via CREATE TABLE IF NOT
// EXISTS in seoContentGapService.ts / seoWorkflowHealthService.ts, never
// tracked in schema.ts). Brought into drizzle here (seo-learning-loop,
// migration 0035) so the new opportunity_id FK link is tracked like any
// other column — this is what lets a published calendar row's outcome be
// measured against the seo_opportunities row it was created from. Column
// shape otherwise matches the live ensureContentCalendarTable() DDL exactly.
// ---------------------------------------------------------------------------
export const seoContentCalendar = pgTable(
  'seo_content_calendar',
  {
    id: serial('id').primaryKey(),
    // Was `.default('00000000-…0001')` — a sentinel that is NOT a real row in
    // `tenants`, so every calendar row written before migration 0045 pointed at
    // a tenant that does not exist. Migration 0045 backfills those to the
    // growth-escalators tenant BEFORE adding this FK; adding the FK without
    // that backfill aborts the migration, and Railway applies migrations on
    // boot, so the API would fail to start (this is how 0035 broke prod).
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    // Nullable on purpose — see the seo_sites docblock. Reads still go via
    // project_name/client_domain until every service has migrated.
    siteId: uuid('site_id').references(() => seoSites.id),
    clientDomain: text('client_domain').notNull(),
    keyword: text('keyword').notNull(),
    contentType: text('content_type').notNull().default('blog'),
    title: text('title'),
    status: text('status').notNull().default('planned'),
    priority: text('priority').default('medium'),
    source: text('source'),
    sourceId: text('source_id'),
    opportunityId: uuid('opportunity_id').references(() => seoOpportunities.id),
    targetPublishDate: date('target_publish_date'),
    publishedUrl: text('published_url'),
    assignedTo: text('assigned_to'),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    // The 3-column unique index (client_domain, keyword, content_type) is GONE
    // as of migration 0047 — this is the "LATER migration" the previous note
    // here promised.
    //
    // It was kept through 0045 because running code still did
    // `ON CONFLICT (client_domain, keyword, content_type)`, and dropping it in
    // the same migration that added the 4-column one would have made every
    // in-flight POST throw `no unique or exclusion constraint matching` until
    // the new code deployed. That condition no longer holds: every writer now
    // targets the tenant-scoped index (routes/seo.ts, seoContentDecayService,
    // seoContentGapService — grep confirms zero 3-column targets remain).
    //
    // Keeping it any longer was not neutral. While it existed, two tenants
    // could not both hold a calendar entry for the same
    // (domain, keyword, content_type) — the second one's INSERT would either
    // overwrite the first tenant's row or fail outright, depending on which
    // target the writer named. Dropping it is what actually lets two agencies
    // work the same keyword on the same domain independently.
    tenantUniqueIdx: uniqueIndex('seo_content_calendar_tenant_unique_idx').on(
      t.tenantId, t.clientDomain, t.keyword, t.contentType,
    ),
    tenantIdIdx: index('seo_content_calendar_tenant_id_idx').on(t.tenantId),
    siteIdIdx: index('seo_content_calendar_site_id_idx').on(t.siteId),
    statusIdx: index('seo_calendar_status_idx').on(t.status),
    clientIdx: index('seo_calendar_client_idx').on(t.clientDomain),
  }),
);

// ===========================================================================
// WIZMATCH OUTBOUND POLICY MODULE — PRD-005 §10, ADR-006, ADR-007
// Migration 0037. Schema + resolver only — no caller migrates in this PR
// (PRD-005 §22.2). All tables tenant-scoped; every cross-table entity
// reference is a composite FK (tenant_id, ref_id) -> parent (tenant_id, id)
// per ADR-006 D-14 / PRD-005 §10.10. `WIZMATCH_LIVE_STATES_SQL_LIST` /
// `WIZMATCH_ALL_STATES_SQL_LIST` are the one exported constant every
// enrolment-state CHECK and partial-index predicate below derives from
// (PRD-005 §20.1, resolves review H-6's "four copies of the predicate").
// ===========================================================================

// ---------------------------------------------------------------------------
// TABLE — wizmatch_company_policies (PRD-005 §10.1, ADR-006 D-1..D-7, D-17, D-18)
// ---------------------------------------------------------------------------
export const wizmatchCompanyPolicies = pgTable(
  'wizmatch_company_policies',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    companyId: uuid('company_id').notNull(),
    // entire_company | region | business_unit | location | specific_signal | specific_requirement
    scopeType: text('scope_type').notNull(),
    // Canonical, normalised — built only by buildScopeKey(). Sole carrier of scope identity.
    scopeKey: text('scope_key').notNull(),
    signalId: uuid('signal_id'),
    requirementId: uuid('requirement_id'),
    scopeRefLabel: text('scope_ref_label'),
    // eligible | needs_review | paused | blocked. NULL on a scoped row = inherit.
    outreachEligibility: text('outreach_eligibility'),
    // accepts_external_vendors | fte_vendors_only | contract_vendors_only | preferred_vendors_only |
    // msp_vms_only | direct_hiring_only | no_external_agencies | unknown. NULL = inherit.
    externalHiringPolicy: text('external_hiring_policy'),
    // new_prospect | existing_prospect | existing_client | vendor_partner | prime_partner |
    // former_client | competitor | irrelevant. NULL = inherit.
    relationshipType: text('relationship_type'),
    reasonCode: text('reason_code'),
    reason: text('reason'),
    // human_text | source_url | email_reply_ref | provider_event_ref | legal_document_ref | automated_detection
    evidenceKind: text('evidence_kind'),
    evidenceText: text('evidence_text'),
    evidenceUrl: text('evidence_url'),
    evidenceRef: text('evidence_ref'),
    // human | import | deterministic_rule | provider
    source: text('source').notNull(),
    actorUserId: uuid('actor_user_id'),
    isPermanent: boolean('is_permanent').notNull().default(false),
    // standard | compliance | legal
    blockClass: text('block_class').notNull().default('standard'),
    isNonOverridable: boolean('is_non_overridable').notNull().default(false),
    reviewDate: date('review_date'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Supersession metadata only — the ONLY two columns a service update path
    // may ever touch (ADR-006 D-10). Enforced by the immutability trigger
    // appended as raw SQL in the 0037 guard block (§10.11.2).
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    supersededByPolicyId: uuid('superseded_by_policy_id'),
  },
  (t) => ({
    // Non-partial — required as the composite-FK target for the self-reference
    // and for wizmatch_company_policy_events (§10.10).
    tenantIdIdUniq: uniqueIndex('wizmatch_company_policies_tenant_id_id_uniq').on(t.tenantId, t.id),
    activeScopeUniq: uniqueIndex('wizmatch_company_policies_active_scope_uniq')
      .on(t.tenantId, t.companyId, t.scopeKey)
      .where(sql`${t.supersededAt} IS NULL`),
    tenantEligibilityIdx: index('wizmatch_company_policies_tenant_eligibility_idx')
      .on(t.tenantId, t.outreachEligibility)
      .where(sql`${t.supersededAt} IS NULL`),
    tenantCompanyIdx: index('wizmatch_company_policies_tenant_company_idx')
      .on(t.tenantId, t.companyId)
      .where(sql`${t.supersededAt} IS NULL`),
    reviewDateIdx: index('wizmatch_company_policies_review_date_idx')
      .on(t.tenantId, t.reviewDate)
      .where(sql`${t.reviewDate} IS NOT NULL AND ${t.supersededAt} IS NULL`),

    companyFk: foreignKey({
      columns: [t.tenantId, t.companyId],
      foreignColumns: [wizmatchCompanies.tenantId, wizmatchCompanies.id],
      name: 'wizmatch_company_policies_company_fk',
    }).onDelete('cascade'),
    signalFk: foreignKey({
      columns: [t.tenantId, t.signalId],
      foreignColumns: [wizmatchJobSignals.tenantId, wizmatchJobSignals.id],
      name: 'wizmatch_company_policies_signal_fk',
    }).onDelete('cascade'),
    requirementFk: foreignKey({
      columns: [t.tenantId, t.requirementId],
      foreignColumns: [wizmatchRequirements.tenantId, wizmatchRequirements.id],
      name: 'wizmatch_company_policies_requirement_fk',
    }).onDelete('cascade'),
    actorFk: foreignKey({
      columns: [t.tenantId, t.actorUserId],
      foreignColumns: [users.tenantId, users.id],
      name: 'wizmatch_company_policies_actor_fk',
    }).onDelete('set null'),
    // Self composite FK — supersession pointer only.
    supersededByFk: foreignKey({
      columns: [t.tenantId, t.supersededByPolicyId],
      foreignColumns: [t.tenantId, t.id],
      name: 'wizmatch_company_policies_superseded_by_fk',
    }).onDelete('set null'),

    // -- scope identity (ADR-006 D-2, resolves review H-5) --
    // D-R2 (owner-ratified, code review revoking PR 8B CODE_READY) — the
    // canonical set is defined once in src/modules/outreach/policyTypes.ts's
    // SCOPE_TYPES tuple; this CHECK is the database-layer half of failing
    // closed on an unrecognised scope_type (the application-layer half is
    // policyService.ts's validatePolicyWrite, which imports the same
    // SCOPE_TYPES rather than re-declaring it). Placed first in this block to
    // match the file's "scope identity" grouping — every other CHECK here
    // already assumes scope_type is one of these six values.
    scopeTypeChk: check(
      'wizmatch_company_policies_scope_type_chk',
      sql`scope_type IN ('entire_company','region','business_unit','location','specific_signal','specific_requirement')`,
    ),
    scopeKeyRootChk: check(
      'wizmatch_company_policies_scope_key_root_chk',
      sql`(scope_type = 'entire_company') = (scope_key = 'entire_company')`,
    ),
    signalRefChk: check(
      'wizmatch_company_policies_signal_ref_chk',
      sql`(scope_type = 'specific_signal') = (signal_id IS NOT NULL)`,
    ),
    requirementRefChk: check(
      'wizmatch_company_policies_requirement_ref_chk',
      sql`(scope_type = 'specific_requirement') = (requirement_id IS NOT NULL)`,
    ),
    labelRefChk: check(
      'wizmatch_company_policies_label_ref_chk',
      sql`(scope_type IN ('region','business_unit','location')) = (scope_ref_label IS NOT NULL)`,
    ),
    scopeKeyPrefixChk: check(
      'wizmatch_company_policies_scope_key_prefix_chk',
      sql`scope_type = 'entire_company' OR scope_key LIKE scope_type || ':%'`,
    ),
    scopeKeySignalAgreementChk: check(
      'wizmatch_company_policies_scope_key_signal_agreement_chk',
      sql`scope_type <> 'specific_signal' OR scope_key = 'specific_signal:' || signal_id::text`,
    ),
    scopeKeyRequirementAgreementChk: check(
      'wizmatch_company_policies_scope_key_requirement_agreement_chk',
      sql`scope_type <> 'specific_requirement' OR scope_key = 'specific_requirement:' || requirement_id::text`,
    ),
    scopeKeyLabelAgreementChk: check(
      'wizmatch_company_policies_scope_key_label_agreement_chk',
      sql`scope_type NOT IN ('region','business_unit','location') OR scope_key = scope_type || ':' || scope_ref_label`,
    ),
    pausedReviewDateChk: check(
      'wizmatch_company_policies_paused_review_date_chk',
      sql`outreach_eligibility <> 'paused' OR review_date IS NOT NULL`,
    ),
    regionLabelChk: check(
      'wizmatch_company_policies_region_label_chk',
      sql`scope_type <> 'region' OR scope_ref_label IN ('india','us')`,
    ),
    // -- inheritance (ADR-006 D-3) --
    rootDefinesAllChk: check(
      'wizmatch_company_policies_root_defines_all_chk',
      sql`scope_type <> 'entire_company' OR (outreach_eligibility IS NOT NULL AND external_hiring_policy IS NOT NULL AND relationship_type IS NOT NULL)`,
    ),
    scopedOverridesOneChk: check(
      'wizmatch_company_policies_scoped_overrides_one_chk',
      sql`scope_type = 'entire_company' OR (outreach_eligibility IS NOT NULL OR external_hiring_policy IS NOT NULL OR relationship_type IS NOT NULL)`,
    ),
    // -- block metadata (ADR-006 D-5, D-17, resolves review H-7/H-8) --
    nonOverridableOnBlockedChk: check(
      'wizmatch_company_policies_non_overridable_on_blocked_chk',
      sql`is_non_overridable = false OR outreach_eligibility = 'blocked'`,
    ),
    blockClassOnBlockedChk: check(
      'wizmatch_company_policies_block_class_on_blocked_chk',
      sql`block_class = 'standard' OR outreach_eligibility = 'blocked'`,
    ),
    blockClassOverrideChk: check(
      'wizmatch_company_policies_block_class_override_chk',
      sql`block_class = 'standard' OR is_non_overridable = true`,
    ),
    // -- evidence (ADR-006 D-7, resolves review H-2/invariant 5) --
    evidenceRequiredChk: check(
      'wizmatch_company_policies_evidence_required_chk',
      sql`(is_permanent = false AND is_non_overridable = false) OR (evidence_kind IS NOT NULL AND (evidence_text IS NOT NULL OR evidence_url IS NOT NULL OR evidence_ref IS NOT NULL))`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// TABLE — wizmatch_company_policy_events (PRD-005 §10.2) — append-only, no UPDATE/DELETE path
// ---------------------------------------------------------------------------
export const wizmatchCompanyPolicyEvents = pgTable(
  'wizmatch_company_policy_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    companyId: uuid('company_id').notNull(),
    policyId: uuid('policy_id').notNull(),
    previousPolicyId: uuid('previous_policy_id'),
    fromState: jsonb('from_state'),
    toState: jsonb('to_state'),
    reasonCode: text('reason_code').notNull(),
    reason: text('reason'),
    evidenceKind: text('evidence_kind'),
    evidenceText: text('evidence_text'),
    evidenceUrl: text('evidence_url'),
    evidenceRef: text('evidence_ref'),
    actorUserId: uuid('actor_user_id'),
    source: text('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantCompanyIdx: index('wizmatch_company_policy_events_tenant_company_idx').on(t.tenantId, t.companyId),
    tenantPolicyIdx: index('wizmatch_company_policy_events_tenant_policy_idx').on(t.tenantId, t.policyId),
    companyFk: foreignKey({
      columns: [t.tenantId, t.companyId],
      foreignColumns: [wizmatchCompanies.tenantId, wizmatchCompanies.id],
      name: 'wizmatch_company_policy_events_company_fk',
    }).onDelete('cascade'),
    policyFk: foreignKey({
      columns: [t.tenantId, t.policyId],
      foreignColumns: [wizmatchCompanyPolicies.tenantId, wizmatchCompanyPolicies.id],
      name: 'wizmatch_company_policy_events_policy_fk',
    }).onDelete('restrict'),
    previousPolicyFk: foreignKey({
      columns: [t.tenantId, t.previousPolicyId],
      foreignColumns: [wizmatchCompanyPolicies.tenantId, wizmatchCompanyPolicies.id],
      name: 'wizmatch_company_policy_events_previous_policy_fk',
    }).onDelete('set null'),
    actorFk: foreignKey({
      columns: [t.tenantId, t.actorUserId],
      foreignColumns: [users.tenantId, users.id],
      name: 'wizmatch_company_policy_events_actor_fk',
    }).onDelete('set null'),
  }),
);

// ---------------------------------------------------------------------------
// TABLE — wizmatch_company_duplicates (PRD-005 §10.3)
// ---------------------------------------------------------------------------
export const wizmatchCompanyDuplicates = pgTable(
  'wizmatch_company_duplicates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    companyAId: uuid('company_a_id').notNull(),
    companyBId: uuid('company_b_id').notNull(),
    similarity: numeric('similarity', { precision: 5, scale: 4 }),
    // domain | normalised_name
    detectionRule: text('detection_rule').notNull(),
    // pending | merged | confirmed_separate
    resolution: text('resolution').notNull().default('pending'),
    resolvedBy: uuid('resolved_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantResolutionIdx: index('wizmatch_company_duplicates_tenant_resolution_idx').on(t.tenantId, t.resolution),
    pairUniq: uniqueIndex('wizmatch_company_duplicates_pair_uniq').on(t.tenantId, t.companyAId, t.companyBId),
    companyAFk: foreignKey({
      columns: [t.tenantId, t.companyAId],
      foreignColumns: [wizmatchCompanies.tenantId, wizmatchCompanies.id],
      name: 'wizmatch_company_duplicates_company_a_fk',
    }).onDelete('cascade'),
    companyBFk: foreignKey({
      columns: [t.tenantId, t.companyBId],
      foreignColumns: [wizmatchCompanies.tenantId, wizmatchCompanies.id],
      name: 'wizmatch_company_duplicates_company_b_fk',
    }).onDelete('cascade'),
    resolvedByFk: foreignKey({
      columns: [t.tenantId, t.resolvedBy],
      foreignColumns: [users.tenantId, users.id],
      name: 'wizmatch_company_duplicates_resolved_by_fk',
    }).onDelete('set null'),
    orderedPairChk: check('wizmatch_company_duplicates_ordered_pair_chk', sql`company_a_id < company_b_id`),
    detectionRuleChk: check(
      'wizmatch_company_duplicates_detection_rule_chk',
      sql`detection_rule IN ('domain','normalised_name')`,
    ),
    resolutionChk: check(
      'wizmatch_company_duplicates_resolution_chk',
      sql`resolution IN ('pending','merged','confirmed_separate')`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// TABLE — wizmatch_reply_mailboxes (PRD-005 §10.4, ADR-007 D-7)
// ---------------------------------------------------------------------------
export const wizmatchReplyMailboxes = pgTable(
  'wizmatch_reply_mailboxes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    // imap | ms365 | google
    provider: text('provider').notNull(),
    address: text('address').notNull(),
    domain: text('domain'),
    // Non-secret settings only. A write-time validator (service layer) rejects
    // keys matching /pass|secret|token|key|credential/i.
    providerConfig: jsonb('provider_config').notNull().default({}),
    // Opaque, scheme-prefixed pointer resolved at runtime — never a credential value.
    secretRef: text('secret_ref').notNull(),
    active: boolean('active').notNull().default(true),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantAddressUniq: uniqueIndex('wizmatch_reply_mailboxes_tenant_address_uniq').on(t.tenantId, t.address),
    providerChk: check('wizmatch_reply_mailboxes_provider_chk', sql`provider IN ('imap','ms365','google')`),
  }),
);

// ---------------------------------------------------------------------------
// TABLE — wizmatch_outreach_batches (PRD-005 §10.5)
// ---------------------------------------------------------------------------
export const wizmatchOutreachBatches = pgTable(
  'wizmatch_outreach_batches',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    name: text('name').notNull(),
    provider: text('provider').notNull().default('smartlead_csv'),
    // fte_permanent | contract_c2h | vendor_empanelment | msp_vms | reengagement
    campaignFamily: text('campaign_family').notNull(),
    // fte_permanent | contract | c2h | vendor_empanelment | msp_vms | reengagement
    campaignType: text('campaign_type').notNull(),
    // cold_email | account_managed | research_only
    outreachMode: text('outreach_mode').notNull(),
    externalCampaignRef: text('external_campaign_ref'),
    // draft | exported | importing | closed
    status: text('status').notNull().default('draft'),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    exportedAt: timestamp('exported_at', { withTimezone: true }),
    exportedRowCount: integer('exported_row_count'),
    omittedRowCount: integer('omitted_row_count'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Non-partial — composite-FK target for enrolments.batch_id and events.batch_id.
    tenantIdIdUniq: uniqueIndex('wizmatch_outreach_batches_tenant_id_id_uniq').on(t.tenantId, t.id),
    tenantStatusIdx: index('wizmatch_outreach_batches_tenant_status_idx').on(t.tenantId, t.status),
    approvedByFk: foreignKey({
      columns: [t.tenantId, t.approvedBy],
      foreignColumns: [users.tenantId, users.id],
      name: 'wizmatch_outreach_batches_approved_by_fk',
    }).onDelete('set null'),
    createdByFk: foreignKey({
      columns: [t.tenantId, t.createdBy],
      foreignColumns: [users.tenantId, users.id],
      name: 'wizmatch_outreach_batches_created_by_fk',
    }).onDelete('set null'),
    campaignFamilyChk: check(
      'wizmatch_outreach_batches_campaign_family_chk',
      sql`campaign_family IN ('fte_permanent','contract_c2h','vendor_empanelment','msp_vms','reengagement')`,
    ),
    campaignTypeChk: check(
      'wizmatch_outreach_batches_campaign_type_chk',
      sql`campaign_type IN ('fte_permanent','contract','c2h','vendor_empanelment','msp_vms','reengagement')`,
    ),
    outreachModeChk: check(
      'wizmatch_outreach_batches_outreach_mode_chk',
      sql`outreach_mode IN ('cold_email','account_managed','research_only')`,
    ),
    statusChk: check(
      'wizmatch_outreach_batches_status_chk',
      sql`status IN ('draft','exported','importing','closed')`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// TABLE — wizmatch_outreach_enrolments (PRD-005 §10.6, ADR-006 D-6, D-9)
// ---------------------------------------------------------------------------
export const wizmatchOutreachEnrolments = pgTable(
  'wizmatch_outreach_enrolments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    companyId: uuid('company_id').notNull(),
    // Nullable — research_only work is company-level and may have no contact yet.
    contactId: uuid('contact_id'),
    // Lowercased, trimmed email captured at enrolment time; NULL when no contact.
    enrolmentEmailKey: text('enrolment_email_key'),
    batchId: uuid('batch_id').notNull(),
    campaignFamily: text('campaign_family').notNull(),
    campaignType: text('campaign_type').notNull(),
    outreachMode: text('outreach_mode').notNull(),
    externalLeadRef: text('external_lead_ref'),
    // 15 states — 8 live, 7 terminal. See src/config/wizmatchOutreachStates.ts.
    state: text('state').notNull(),
    stateAt: timestamp('state_at', { withTimezone: true }).notNull().defaultNow(),
    releasedByUserId: uuid('released_by_user_id'),
    releaseReason: text('release_reason'),
    // Policy decision at export time — never retroactively rewritten by a later policy change.
    policySnapshot: jsonb('policy_snapshot'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Non-partial — composite-FK target for wizmatch_outreach_events.enrolment_id.
    tenantIdIdUniq: uniqueIndex('wizmatch_outreach_enrolments_tenant_id_id_uniq').on(t.tenantId, t.id),
    tenantCompanyIdx: index('wizmatch_outreach_enrolments_tenant_company_idx').on(t.tenantId, t.companyId),
    tenantStateIdx: index('wizmatch_outreach_enrolments_tenant_state_idx').on(t.tenantId, t.state),

    companyFk: foreignKey({
      columns: [t.tenantId, t.companyId],
      foreignColumns: [wizmatchCompanies.tenantId, wizmatchCompanies.id],
      name: 'wizmatch_outreach_enrolments_company_fk',
    }).onDelete('cascade'),
    contactFk: foreignKey({
      columns: [t.tenantId, t.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
      name: 'wizmatch_outreach_enrolments_contact_fk',
    }).onDelete('set null'),
    batchFk: foreignKey({
      columns: [t.tenantId, t.batchId],
      foreignColumns: [wizmatchOutreachBatches.tenantId, wizmatchOutreachBatches.id],
      name: 'wizmatch_outreach_enrolments_batch_fk',
    }).onDelete('restrict'),
    createdByFk: foreignKey({
      columns: [t.tenantId, t.createdBy],
      foreignColumns: [users.tenantId, users.id],
      name: 'wizmatch_outreach_enrolments_created_by_fk',
    }).onDelete('set null'),
    releasedByFk: foreignKey({
      columns: [t.tenantId, t.releasedByUserId],
      foreignColumns: [users.tenantId, users.id],
      name: 'wizmatch_outreach_enrolments_released_by_fk',
    }).onDelete('set null'),

    stateChk: check(
      'wizmatch_outreach_enrolments_state_chk',
      sql.raw(`state IN (${WIZMATCH_ALL_STATES_SQL_LIST})`),
    ),
    manuallyReleasedChk: check(
      'wizmatch_outreach_enrolments_manually_released_chk',
      sql`state <> 'manually_released' OR (released_by_user_id IS NOT NULL AND release_reason IS NOT NULL)`,
    ),

    // §10.6.2 overlap constraints — all four LIVE-state predicates derive
    // from the same exported WIZMATCH_LIVE_STATES_SQL_LIST constant.
    batchContactUniq: uniqueIndex('wizmatch_outreach_enrolments_batch_contact_uniq').on(
      t.tenantId,
      t.batchId,
      t.contactId,
    ),
    // 1. ONE live cold-email enrolment per company, across ALL families.
    companyColdEmailLockUniq: uniqueIndex('wizmatch_outreach_enrolments_company_cold_email_lock_uniq')
      .on(t.tenantId, t.companyId)
      .where(sql.raw(`outreach_mode = 'cold_email' AND state IN (${WIZMATCH_LIVE_STATES_SQL_LIST})`)),
    // 2. ONE live enrolment per contact row, any mode.
    contactLiveUniq: uniqueIndex('wizmatch_outreach_enrolments_contact_live_uniq')
      .on(t.tenantId, t.contactId)
      .where(sql.raw(`contact_id IS NOT NULL AND state IN (${WIZMATCH_LIVE_STATES_SQL_LIST})`)),
    // 2b. ONE live enrolment per human, keyed on the normalised email (resolves review H-12).
    enrolmentEmailKeyLiveUniq: uniqueIndex('wizmatch_outreach_enrolments_email_key_live_uniq')
      .on(t.tenantId, t.enrolmentEmailKey)
      .where(sql.raw(`enrolment_email_key IS NOT NULL AND state IN (${WIZMATCH_LIVE_STATES_SQL_LIST})`)),
    // 3. No duplicate live non-cold work for the same company + family + mode.
    companyFamilyModeLiveUniq: uniqueIndex('wizmatch_outreach_enrolments_company_family_mode_live_uniq')
      .on(t.tenantId, t.companyId, t.campaignFamily, t.outreachMode)
      .where(sql.raw(`state IN (${WIZMATCH_LIVE_STATES_SQL_LIST})`)),
  }),
);

// ---------------------------------------------------------------------------
// TABLE — wizmatch_outreach_events (PRD-005 §10.7, ADR-007 D-3)
// ---------------------------------------------------------------------------
export const wizmatchOutreachEvents = pgTable(
  'wizmatch_outreach_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    enrolmentId: uuid('enrolment_id').notNull(),
    batchId: uuid('batch_id').notNull(),
    provider: text('provider').notNull(),
    eventType: text('event_type').notNull(),
    eventAt: timestamp('event_at', { withTimezone: true }).notNull(),
    actorUserId: uuid('actor_user_id'),
    externalEventId: text('external_event_id'),
    externalMessageId: text('external_message_id'),
    externalLeadRef: text('external_lead_ref'),
    idempotencyKey: text('idempotency_key').notNull(),
    // provider_event_id | provider_message_id | lead_ref_composite | fallback_hash | internal_transition
    keySource: text('key_source').notNull(),
    raw: jsonb('raw'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idempotencyUniq: uniqueIndex('wizmatch_outreach_events_idempotency_uniq').on(
      t.tenantId,
      t.provider,
      t.idempotencyKey,
    ),
    tenantEnrolmentIdx: index('wizmatch_outreach_events_tenant_enrolment_idx').on(t.tenantId, t.enrolmentId),

    enrolmentFk: foreignKey({
      columns: [t.tenantId, t.enrolmentId],
      foreignColumns: [wizmatchOutreachEnrolments.tenantId, wizmatchOutreachEnrolments.id],
      name: 'wizmatch_outreach_events_enrolment_fk',
    }).onDelete('cascade'),
    batchFk: foreignKey({
      columns: [t.tenantId, t.batchId],
      foreignColumns: [wizmatchOutreachBatches.tenantId, wizmatchOutreachBatches.id],
      name: 'wizmatch_outreach_events_batch_fk',
    }).onDelete('restrict'),
    actorFk: foreignKey({
      columns: [t.tenantId, t.actorUserId],
      foreignColumns: [users.tenantId, users.id],
      name: 'wizmatch_outreach_events_actor_fk',
    }).onDelete('set null'),

    eventTypeChk: check(
      'wizmatch_outreach_events_event_type_chk',
      sql`event_type IN (
        'sent','bounced','replied','unsubscribed','completed',
        'awaiting_action','positive_reply','referral_received','conversation_open',
        'closed','disqualified','company_blocked','contact_invalid','manually_released',
        'gate_denied'
      )`,
    ),
    manuallyReleasedActorChk: check(
      'wizmatch_outreach_events_manually_released_actor_chk',
      sql`event_type <> 'manually_released' OR actor_user_id IS NOT NULL`,
    ),
    keySourceChk: check(
      'wizmatch_outreach_events_key_source_chk',
      sql`key_source IN ('provider_event_id','provider_message_id','lead_ref_composite','fallback_hash','internal_transition')`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// TABLE — wizmatch_suppression_events (PRD-005 §10.9.1, ADR-006 D-4/D-15) — append-only
// This table is HISTORY ONLY and is never consulted as effective suppression
// state — a resolver that read it would reintroduce the multi-row-per-email
// ambiguity D-4 exists to prevent. Effective state lives in
// wizmatch_suppression_list (email/channel grain), contacts.do_not_contact
// (person grain) and wizmatch_company_policies (company grain).
// ---------------------------------------------------------------------------
export const wizmatchSuppressionEvents = pgTable(
  'wizmatch_suppression_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    // email | contact | company
    grain: text('grain').notNull(),
    email: text('email'),
    contactId: uuid('contact_id'),
    contactChannelId: uuid('contact_channel_id'),
    companyId: uuid('company_id'),
    enrolmentId: uuid('enrolment_id'),
    reasonCode: text('reason_code').notNull(),
    evidenceKind: text('evidence_kind'),
    evidenceText: text('evidence_text'),
    evidenceUrl: text('evidence_url'),
    evidenceRef: text('evidence_ref'),
    source: text('source').notNull(),
    actorUserId: uuid('actor_user_id'),
    externalEventRef: text('external_event_ref'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tenantGrainIdx: index('wizmatch_suppression_events_tenant_grain_idx').on(t.tenantId, t.grain),
    tenantEmailIdx: index('wizmatch_suppression_events_tenant_email_idx').on(t.tenantId, t.email),
    tenantCompanyIdx: index('wizmatch_suppression_events_tenant_company_idx').on(t.tenantId, t.companyId),

    contactFk: foreignKey({
      columns: [t.tenantId, t.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
      name: 'wizmatch_suppression_events_contact_fk',
    }).onDelete('set null'),
    contactChannelFk: foreignKey({
      columns: [t.tenantId, t.contactChannelId],
      foreignColumns: [contactChannels.tenantId, contactChannels.id],
      name: 'wizmatch_suppression_events_contact_channel_fk',
    }).onDelete('set null'),
    companyFk: foreignKey({
      columns: [t.tenantId, t.companyId],
      foreignColumns: [wizmatchCompanies.tenantId, wizmatchCompanies.id],
      name: 'wizmatch_suppression_events_company_fk',
    }).onDelete('set null'),
    enrolmentFk: foreignKey({
      columns: [t.tenantId, t.enrolmentId],
      foreignColumns: [wizmatchOutreachEnrolments.tenantId, wizmatchOutreachEnrolments.id],
      name: 'wizmatch_suppression_events_enrolment_fk',
    }).onDelete('set null'),
    actorFk: foreignKey({
      columns: [t.tenantId, t.actorUserId],
      foreignColumns: [users.tenantId, users.id],
      name: 'wizmatch_suppression_events_actor_fk',
    }).onDelete('set null'),

    grainChk: check('wizmatch_suppression_events_grain_chk', sql`grain IN ('email','contact','company')`),
    grainEmailChk: check(
      'wizmatch_suppression_events_grain_email_chk',
      sql`grain <> 'email' OR email IS NOT NULL`,
    ),
    grainContactChk: check(
      'wizmatch_suppression_events_grain_contact_chk',
      sql`grain <> 'contact' OR contact_id IS NOT NULL`,
    ),
    grainCompanyChk: check(
      'wizmatch_suppression_events_grain_company_chk',
      sql`grain <> 'company' OR company_id IS NOT NULL`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Saved views — named filter/sort/column presets for the admin list pages.
//
// These lived in localStorage (`wizmatch:presets:<pageId>`), which meant a view
// died with the browser that made it and could never be shared. The whole point
// of a saved view in a staffing tool is that "Hot ATS leads" means the same
// thing to everyone on the team, so it has to be tenant-scoped storage, not
// per-device storage.
//
// `query` is the URL query string the page already round-trips through
// useTableControls (e.g. "score=8..&status=scored&sort=score:desc"). Storing the
// query string rather than a parsed structure keeps this table agnostic to each
// page's filter spec — a page can add or rename a filter without a migration,
// and an unknown key simply doesn't match anything.
//
// `isShared=false` is a private view: visible only to its owner. `true` makes it
// visible to the whole tenant. Deliberately not a per-user ACL — that is a
// permissions system, and nobody has asked for one.
// ---------------------------------------------------------------------------
export const savedViews = pgTable(
  'saved_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    ownerUserId: uuid('owner_user_id').notNull().references(() => users.id),
    // Matches useTableControls' `pageId` (e.g. 'wizmatch-requirements').
    pageId: text('page_id').notNull(),
    name: text('name').notNull(),
    query: text('query').notNull(),
    isShared: boolean('is_shared').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    // The read path is always "views for this tenant, on this page".
    tenantPageIdx: index('saved_views_tenant_page_idx').on(t.tenantId, t.pageId),
    ownerIdx: index('saved_views_owner_idx').on(t.tenantId, t.ownerUserId),
    // One name per person per page — saving over your own view updates it
    // rather than silently creating a second row with the same name, which is
    // what the localStorage version did (it filtered by name before pushing).
    // Scoped to the owner, not the tenant, so my "Hot leads" does not collide
    // with yours.
    ownerPageNameUniq: uniqueIndex('saved_views_owner_page_name_uniq').on(
      t.tenantId, t.ownerUserId, t.pageId, t.name,
    ),
  }),
);

// ---------------------------------------------------------------------------
// TABLE — tenant_branding
//
// White-label mechanism: one row per tenant carrying the display name/logo/
// colors the admin SPA renders instead of Growth Escalators' own branding,
// PLUS (below) the legal/financial identity that client-facing documents
// (invoices, performance report PDFs) render instead of Growth Escalators'
// own identity. Genuinely 1:1 with tenants (unlike every other tenant-scoped
// table, which is many-rows-per-tenant), hence the bare unique index on
// tenantId rather than a composite one.
//
// Read access is split by sensitivity, not by column group:
//   - displayName/logoUrl/primaryColor/accentColor/faviconUrl and the legal/
//     contact fields (legalEntityName, registeredAddress, supportEmail,
//     supportPhone, website) are readable by any authenticated tenant member —
//     they're either UI chrome or the kind of thing that's already printed on
//     an outbound document anyway.
//   - gstin and the bank* fields are financial/tax identifiers entered by the
//     tenant owner for that tenant's own invoices; the GET handler in
//     src/routes/tenantBranding.ts strips them from the response for any
//     caller who isn't isOwner.
// Only an owner (userPermissions.isOwner) may write any of this — see
// src/routes/tenantBranding.ts.
// ---------------------------------------------------------------------------
export const tenantBranding = pgTable(
  'tenant_branding',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    displayName: text('display_name').notNull(),
    logoUrl: text('logo_url'),
    primaryColor: text('primary_color'),
    accentColor: text('accent_color'),
    faviconUrl: text('favicon_url'),
    // -- Legal / financial identity for client-facing documents (reseller
    // -- readiness — see docs/decisions for the ADR). All nullable: a tenant
    // -- with nothing configured here must not silently inherit Growth
    // -- Escalators' identity — the invoice/report generation routes block
    // -- instead of falling back. Growth Escalators' own row is backfilled
    // -- with its real values by seedTenantBrandingDefaults() so its own
    // -- documents are unaffected by this table gaining new columns.
    legalEntityName: text('legal_entity_name'),
    registeredAddress: text('registered_address'),
    gstin: text('gstin'), // owner-only on read; nullable — non-Indian tenants won't have one
    bankName: text('bank_name'), // the banking institution, e.g. "ICICI Bank" — owner-only on read
    bankAccountName: text('bank_account_name'), // owner-only on read
    bankAccountNumber: text('bank_account_number'), // owner-only on read
    bankIfsc: text('bank_ifsc'), // owner-only on read
    supportEmail: text('support_email'),
    supportPhone: text('support_phone'),
    website: text('website'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    tenantIdUniq: uniqueIndex('tenant_branding_tenant_id_uniq').on(t.tenantId),
  }),
);

// ---------------------------------------------------------------------------
// Tenant integrations — per-tenant credential store for external services
// (SMTP, Meta, etc). Phase 3 of the white-label effort: today the app has one
// global Meta token, one WhatsApp number, and hand-enumerated
// PURELYMAIL_*_1..6 env vars for outbound email, which only works for a single
// tenant. This table lets a second tenant plug in their own channels without
// a code change.
//
// `encryptedCredentials` is a ciphertext blob (AES-256-GCM, see
// src/services/credentialEncryption.ts) — the plaintext secret is NEVER
// stored here and NEVER returned by the API; only `status`/`metadata` are
// safe to expose to a tenant member. `provider` is a plain text column (not a
// Postgres enum) matching this schema's existing convention for enum-like
// fields. One row per (tenant, provider) — a tenant can connect multiple
// providers, but only one integration per provider at a time.
// ---------------------------------------------------------------------------
export const tenantIntegrations = pgTable(
  'tenant_integrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    // e.g. 'email_smtp' | 'meta' | 'google' — plain text, not pgEnum (matches
    // repo convention; see `status` columns elsewhere in this file).
    provider: text('provider').notNull(),
    // AES-256-GCM ciphertext (versioned, self-describing string — see
    // credentialEncryption.ts). Nullable: a row can exist in 'disconnected'
    // state with no secret stored yet.
    encryptedCredentials: text('encrypted_credentials'),
    // Non-secret config only (e.g. display name, connected-by, last-checked-at).
    metadata: jsonb('metadata').default({}),
    // 'connected' | 'disconnected' | 'error'
    status: text('status').notNull().default('disconnected'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    tenantIdIdx: index('tenant_integrations_tenant_id_idx').on(t.tenantId),
    tenantProviderUniq: uniqueIndex('tenant_integrations_tenant_id_provider_uniq').on(
      t.tenantId, t.provider,
    ),
  }),
);

// ---------------------------------------------------------------------------
// TABLE — plans (subscription billing — reselling this CRM to other agencies)
//
// A plan is provider-agnostic: it does not name Cashfree or Razorpay. The
// provider is chosen per-subscription (see `subscriptions.paymentProvider`
// below) via the PaymentGatewayAdapter factory in
// src/services/paymentGateway/index.ts, so the same plan can be sold through
// either gateway without a schema change.
//
// `price`/`currency`: `price` is an integer in the currency's BASE unit (e.g.
// rupees, not paise) — never assume a subunit or INR anywhere reading this
// column; always pair it with the row's own `currency`.
//
// `featureEntitlements` maps to the `TenantFeatureFlags` shape in
// src/services/tenantFeatures.ts (wizmatch/seo/crmAutomation/gstBilling/d2c).
// Left as untyped jsonb — no table in this file uses Drizzle's `.$type<>()`,
// so a typed jsonb column would be a new precedent; the shape is documented
// here and enforced at the call site instead (see
// applyPlanEntitlementsToTenant in tenantFeatures.ts).
//
// `limits` is a free-form jsonb bag (e.g. `{ "seats": 5 }`) — there is no
// existing seat/limit concept in this codebase to match, so this is
// intentionally unopinionated until a real limit is enforced somewhere.
// ---------------------------------------------------------------------------
export const plans = pgTable('plans', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  price: integer('price').notNull(),
  currency: text('currency').notNull(),
  featureEntitlements: jsonb('feature_entitlements').notNull().default({}),
  limits: jsonb('limits').notNull().default({}),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// TABLE — subscriptions (a tenant's billing relationship to one plan)
//
// `status` values: created | active | paused | cancelled | expired — mirrors
// PaymentGatewayAdapter.getSubscriptionStatus()'s return union, so a status
// read from the adapter needs no translation before being written here. Plus
// one extra value written only by the webhook processor: 'failed', for a
// failed recurring-charge event (NormalizedSubscriptionEvent's
// 'subscription.failed') — distinct from a hard 'cancelled', and not part of
// getSubscriptionStatus()'s own enum since that call answers "what is this
// subscription's state at the gateway right now", not "did the last charge
// attempt fail".
//
// `paymentProvider` values: cashfree | razorpay — mirrors SubscriptionProvider
// from src/services/paymentGateway/types.ts.
//
// `providerSubscriptionId` is unique PER PROVIDER, not globally — two
// different gateways could in principle mint colliding ids, so the unique
// index below is composite on (paymentProvider, providerSubscriptionId),
// matching how the webhook route looks a subscription up (it always knows
// the provider from the URL param before it has the id).
// ---------------------------------------------------------------------------
export const subscriptions = pgTable(
  'subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    planId: uuid('plan_id').notNull().references(() => plans.id),
    status: text('status').notNull().default('created'),
    paymentProvider: text('payment_provider').notNull(),
    providerSubscriptionId: text('provider_subscription_id').notNull(),
    renewalDate: timestamp('renewal_date'),
    currency: text('currency').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    tenantIdx: index('subscriptions_tenant_idx').on(t.tenantId),
    providerSubscriptionUniq: uniqueIndex('subscriptions_provider_subscription_uniq').on(
      t.paymentProvider, t.providerSubscriptionId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// TABLE — seo_sites (the SEO site registry)
//
// Every SEO table before this one keys on the *string* `project_name` /
// `client_domain`. That worked while SEO was single-tenant with three
// hand-maintained domains hardcoded in nine different files. It does not work
// once a reseller tenant registers its own client's site: two tenants can
// legitimately both work on `example.com`, and a string key cannot tell them
// apart.
//
// `seo_sites` is the registry those strings become foreign keys to. Note the
// deliberate migration shape (see migration 0046): the legacy string columns
// are NOT renamed or dropped. ~135 raw SQL statements across 22 files read
// them, and Railway applies migrations on boot, so a rename is a guaranteed
// outage. Instead every SEO table gains a NULLABLE `site_id`, gets backfilled
// where the domain resolves, and reads migrate service-by-service. Making it
// NOT NULL is a later migration, after the last string read is gone.
//
// `adapter_config` holds NON-SECRET config only (site URL, theme snippet
// location, default author id). Credentials live in `tenant_integrations`,
// encrypted; `credential_provider` is the pointer into it — a `provider` value,
// not a secret. See AGENTS.md credential hygiene.
// ---------------------------------------------------------------------------
export const seoSites = pgTable(
  'seo_sites',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    // Nullable: GE's own properties (growthescalators.com) are sites without a
    // paying client row behind them. A reseller's sites will normally set it.
    clientId: uuid('client_id').references(() => clients.id),
    // Human label shown in the admin ("Dr Dubay — main site").
    label: text('label').notNull(),
    // Bare registrable domain, no scheme, no trailing slash, lowercased —
    // normalised by seoSiteRegistry.normaliseDomain() on every write, because
    // the unique index below is the only thing stopping the same site being
    // registered twice as `Example.com` and `example.com/`.
    domain: text('domain').notNull(),
    // 'git' | 'wordpress' | 'shopify' | 'unknown' — plain text, not pgEnum, to
    // match the repo convention for status-like columns. The SiteAdapter
    // factory (src/modules/site/providers/) resolves this to a provider, and
    // callers branch on that provider's CAPABILITIES, never on this string.
    platform: text('platform').notNull().default('unknown'),
    // Non-secret adapter config only. Never a password, token, or app key.
    adapterConfig: jsonb('adapter_config').default({}),
    // Pointer into tenant_integrations.provider — e.g. 'wordpress'. Not a
    // secret; the secret it points at is encrypted in that table.
    credentialProvider: text('credential_provider'),
    // e.g. 'sc-domain:example.com' or 'https://example.com/'.
    gscProperty: text('gsc_property'),
    ga4PropertyId: text('ga4_property_id'),
    // 'low' | 'standard' | 'high' — drives how much verification a change
    // needs before it can be approved.
    riskProfile: text('risk_profile').notNull().default('standard'),
    // Named checks a change must pass before it can reach `awaiting_approval`.
    requiredChecks: text('required_checks').array().default([]),
    // Deliberately defaults FALSE and stays false for the pilot. The
    // human-approval hard stop is the entire safety story for a system that
    // edits live client websites; a column that can switch it off is exactly
    // the thing that must not default on.
    autoPublishAllowed: boolean('auto_publish_allowed').notNull().default(false),
    // How long an outcome must be observed before it can be scored and
    // promoted into the playbook. The delayed-promotion window is the IP.
    observationWindowDays: integer('observation_window_days').notNull().default(21),
    // 'active' | 'paused' | 'archived'. Crons skip anything not 'active'.
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    tenantIdIdx: index('seo_sites_tenant_id_idx').on(t.tenantId),
    // The isolation guarantee: two tenants may each register example.com, but
    // neither can register it twice.
    tenantDomainUniq: uniqueIndex('seo_sites_tenant_id_domain_uniq').on(t.tenantId, t.domain),
  }),
);

// ---------------------------------------------------------------------------
// TABLE — roles (foundation for tenant-customizable RBAC)
//
// Additive-only, not wired into any route yet. Today's authorization still
// runs entirely on `users.role` (plain text) + PERMISSION_MAP
// (src/middleware/rbac.ts) — this table exists so a tenant can eventually
// define its own roles instead of being locked into the 8 GE-shaped,
// hardcoded ones. See src/config/permissions.ts for the permission-key
// registry these roles are composed from, and
// src/services/permissionResolver.ts for how a user's effective permissions
// are computed. `is_system` distinguishes the 8 built-in roles seeded by
// src/scripts/backfillRolesFromPermissionMap.ts (mirroring PERMISSION_MAP's
// existing role names: admin, manager_ops, manager_ads, team_lead, sales,
// staff, creative_assistant, viewer) from any tenant-authored custom role —
// an eventual admin UI should block renaming/deleting system roles, since
// the legacy-parity cutover depends on their `key` staying stable.
// ---------------------------------------------------------------------------
export const roles = pgTable(
  'roles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    tenantKeyUniq: uniqueIndex('roles_tenant_key_unique').on(t.tenantId, t.key),
  }),
);

// ---------------------------------------------------------------------------
// TABLE — site_changes (migration 0050)
//
// One row per PROPOSED edit to a live client website. This is the table the
// human-approval hard stop is enforced on.
//
// WHY NOT EXTEND `client_pages`. Three reasons, each sufficient on its own:
//  1. `client_pages` is a page INVENTORY — one row per page that exists. A
//     change is a proposal EVENT: many per page over time, each with its own
//     approval identity and timestamps, and a terminal `superseded` state when
//     a newer proposal replaces it. Folding an event log into an inventory
//     table loses the history that the 14–28 day outcome scoring reads.
//  2. `client_pages.page_url` is NOT NULL, so a change to a page that does not
//     exist yet would need a fabricated URL. The programmatic-SEO code already
//     fabricates one (`https://…/${slug}/` before WordPress has assigned
//     anything) — that is a workaround, not a pattern to institutionalise.
//  3. Not every change is a page. A 301, a robots.txt edit and a Shopify
//     metafield are all changes with no page row to hang off — hence
//     `change_kind` below and a NULLABLE `page_url`.
//
// `site_id` is NOT NULL here, unlike the nullable `site_id` retrofitted onto
// the ten legacy SEO tables: this table is new, so there is no pre-existing
// row that predates the registry and nothing to backfill.
// ---------------------------------------------------------------------------
export const siteChanges = pgTable(
  'site_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    siteId: uuid('site_id').notNull().references(() => seoSites.id),

    // 'page_create' | 'page_update' | 'redirect' | 'robots_txt' | 'metafield'.
    // Plain text, not pgEnum — repo convention for status-like columns.
    changeKind: text('change_kind').notNull().default('page_update'),
    // Nullable on purpose — see reason 3 in the docblock above.
    pageUrl: text('page_url'),

    // See nextSiteChangeStatus() in src/services/siteChangeService.ts — that
    // pure function is the ONLY thing allowed to compute a new value here, and
    // its exhaustive switch is the authoritative list of legal values.
    status: text('status').notNull().default('proposed'),

    // Optimistic-concurrency token. The approval UI sends the version it
    // rendered; a write whose version no longer matches is rejected rather
    // than silently overwriting a decision someone else just made. Without
    // this, two operators with the page open both click approve and the second
    // one's stale view wins.
    version: integer('version').notNull().default(1),

    // The vendor-neutral SiteChangeInput (title/metaTitle/metaDescription/
    // canonicalUrl/bodyHtml/structuredData/redirectFrom). Stored whole so the
    // approval UI can render exactly what was proposed, months later, even if
    // the generating service has changed shape since.
    payload: jsonb('payload').notNull().default({}),

    // ---- staging (provider-side, pre-publish) ----
    // Opaque provider handle: a git branch name, a WP draft post id, a Shopify
    // unpublished page id.
    stagedRef: text('staged_ref'),
    // Only ever set when the provider's capabilities.stagesRemoteDraft.
    previewUrl: text('preview_url'),
    // Only ever set when the provider's capabilities.producesReviewableDiff.
    // Text, not jsonb: it is a unified diff meant to be rendered verbatim.
    diff: text('diff'),
    stagedAt: timestamp('staged_at'),

    // ---- verification ----
    verifyPassed: boolean('verify_passed'),
    // SiteVerifyIssue[] — severity/code/message. Kept even on a pass, because
    // warnings are exactly what an approver needs to see before deciding.
    verifyIssues: jsonb('verify_issues').notNull().default([]),
    verifiedAt: timestamp('verified_at'),

    // ---- the human decision (the hard stop) ----
    // The CHECK constraint below is the database-level half of the invariant:
    // no row can sit in an approved-or-later status without both of these set.
    // assertSiteChangeApproved() is the application-level half. Two independent
    // enforcement points, because this is the one invariant whose failure means
    // the system edited a client's live website with nobody's consent.
    approvedBy: uuid('approved_by').references(() => users.id),
    approvedAt: timestamp('approved_at'),
    rejectedBy: uuid('rejected_by').references(() => users.id),
    rejectedAt: timestamp('rejected_at'),
    // Free-text reason captured at approve/reject time. Required by the UI on
    // reject; optional on approve.
    decisionReason: text('decision_reason'),

    // ---- publish ----
    // Set once when a publish attempt starts, and reused verbatim on retry so
    // a provider with capabilities.supportsIdempotentPublish can recognise the
    // same request. UNIQUE (nulls distinct) so a second concurrent attempt
    // cannot claim a different id for the same change.
    publishRequestId: uuid('publish_request_id'),
    publishedAt: timestamp('published_at'),
    liveUrl: text('live_url'),
    // Provider-side id of the published object (WP post id, Shopify page id).
    externalRef: text('external_ref'),
    // The full SitePublishResult union, including the git handoff branch and
    // compare URL — the human doing the merge needs those, and they have no
    // natural column.
    publishResult: jsonb('publish_result'),
    lastError: text('last_error'),
    lastErrorAt: timestamp('last_error_at'),

    // ---- outcome ----
    // When the drift sweep confirmed this change actually went live. THIS is
    // what starts the observation-window clock that outcome scoring reads —
    // not publishedAt. A publish that silently failed to render must not be
    // scored as if it shipped, which is the whole point of the sweep.
    verifiedLiveAt: timestamp('verified_live_at'),
    supersededByChangeId: uuid('superseded_by_change_id'),

    // 'cron' | 'admin' | 'agent' — where the proposal came from.
    source: text('source').notNull().default('admin'),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    tenantIdIdx: index('site_changes_tenant_id_idx').on(t.tenantId),
    siteIdIdx: index('site_changes_site_id_idx').on(t.siteId),
    // The approval queue's own query: one tenant's changes in one status,
    // newest first.
    tenantStatusIdx: index('site_changes_tenant_status_idx').on(t.tenantId, t.status),
    // Drives the drift sweep's "was this URL changed by us recently?" join.
    sitePageIdx: index('site_changes_site_page_idx').on(t.siteId, t.pageUrl),
    publishRequestIdUniq: uniqueIndex('site_changes_publish_request_id_uniq').on(t.publishRequestId),
    // Self-reference, declared here rather than inline because the table is
    // still being defined at column-declaration time.
    supersededByFk: foreignKey({
      columns: [t.supersededByChangeId],
      foreignColumns: [t.id],
      name: 'site_changes_superseded_by_change_id_fkey',
    }),
    // The hard stop, in the database. A row can only reach an approved-or-later
    // status with a recorded human and a recorded time. An UPDATE that sets
    // status='approved' without them fails outright rather than quietly
    // producing a publishable change.
    approvalRequiresApprover: check(
      'site_changes_approved_requires_approver',
      sql`${t.status} NOT IN ('approved', 'publishing', 'published', 'handoff_required', 'publish_failed')
          OR (${t.approvedBy} IS NOT NULL AND ${t.approvedAt} IS NOT NULL)`,
    ),
  }),
);

// ---------------------------------------------------------------------------
// TABLE — seo_site_snapshots (migration 0048)
//
// Append-only record of what each tracked URL actually looked like, each time
// the drift sweep read it. This is the table behind the differentiator: the
// detector for "the client edited the page behind the agency's back".
//
// NEVER STORE FULL HTML HERE. `elements` holds the extracted SEO surface
// (SeoElements in src/modules/site/liveSnapshot.ts) plus a hash — roughly
// 400 bytes a row. Full HTML would be ~80 KB a row, which for three sites
// sweeping daily is ~17 GB/year against a few MB. The hash is what makes the
// common case (nothing changed) a single integer comparison rather than a
// document diff.
// ---------------------------------------------------------------------------
export const seoSiteSnapshots = pgTable(
  'seo_site_snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    siteId: uuid('site_id').notNull().references(() => seoSites.id),
    pageUrl: text('page_url').notNull(),
    fetchedAt: timestamp('fetched_at').notNull().defaultNow(),
    // 404/410 is a legitimate, meaningful reading (drift_kind 'page_gone'),
    // not an error to discard — so it is stored like any other status.
    httpStatus: integer('http_status').notNull(),
    // sha256 of the extracted elements, from hashSeoElements().
    contentHash: text('content_hash').notNull(),
    // SeoElements: metaTitle/metaDescription/canonicalUrl/robots/h1/h1Count/
    // jsonLdTypes/wordCount/internalLinkCount/externalLinkCount.
    elements: jsonb('elements').notNull().default({}),

    // NULL when nothing changed since the previous snapshot. Otherwise:
    // 'verified_live' (matched one of our approved, recently-published
    // changes), 'unexpected_edit' (changed with no approved change behind it —
    // the sellable one), 'page_gone', 'noindex_added', 'canonical_changed',
    // 'structured_data_removed'.
    driftKind: text('drift_kind'),
    // 'info' | 'warning' | 'critical'. noindex/canonical/JSON-LD loss are
    // higher severity than a copy edit because they cost rankings silently.
    driftSeverity: text('drift_severity'),
    // Which SeoElements fields differed, from diffSeoElements().
    changedFields: text('changed_fields').array().default([]),
    // Set only for 'verified_live' — the approved change this drift matched.
    matchedChangeId: uuid('matched_change_id').references(() => siteChanges.id),
    // Set once a Slack/email alert has gone out, so a persistent drift alerts
    // once rather than every sweep.
    alertedAt: timestamp('alerted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    tenantIdIdx: index('seo_site_snapshots_tenant_id_idx').on(t.tenantId),
    siteIdIdx: index('seo_site_snapshots_site_id_idx').on(t.siteId),
    // The sweep's hot path: the most recent snapshot for one URL on one site.
    sitePageFetchedIdx: index('seo_site_snapshots_site_page_fetched_idx').on(t.siteId, t.pageUrl, t.fetchedAt),
    // The admin's "what drifted on my sites?" query.
    tenantDriftIdx: index('seo_site_snapshots_tenant_drift_idx').on(t.tenantId, t.driftKind),
  }),
);

// ---------------------------------------------------------------------------
// TABLE — seo_api_usage (migration 0049)
//
// The per-tenant/per-site spend ledger behind seoCostGuard.ts. That file has
// carried an explicit "INTENTIONALLY MISSING" note since Phase 1 saying its
// usage fetch could not be written because this table did not exist and adding
// it needs a migration. This is that table.
//
// It replaces an in-memory, process-lifetime global counter
// (`checkAndIncrementSeoSerperCap`), which was fine for one internal tenant and
// cannot survive being sold per site: a single shared counter lets tenants
// starve each other, resets on every deploy, and gives no way to quote an
// agency a fixed price without absorbing unbounded tail risk.
//
// One row per billable call — deliberately append-only rather than a running
// per-day counter. A counter cannot answer "what did this client actually cost
// us last month", which is the question that makes the add-on priceable, and a
// counter that resets on deploy is exactly what this replaces.
// ---------------------------------------------------------------------------
export const seoApiUsage = pgTable(
  'seo_api_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    // Nullable: some spend is genuinely tenant-level, not attributable to one
    // site (a GSC token refresh, an account-wide quota probe). Recording those
    // against an arbitrary site would corrupt per-site cost, which is the
    // number the pricing rests on.
    siteId: uuid('site_id').references(() => seoSites.id),
    // 'serper' | 'pagespeed' | 'gsc' | 'ga4' | 'llm' | 'publish' — plain text,
    // matching the repo convention and seoCostGuard's own free-form labels.
    provider: text('provider').notNull(),
    // e.g. 'serper_search' | 'pagespeed_check' | 'gsc_pull' | 'publish'.
    operation: text('operation').notNull(),
    // Usually 1. Present because some providers bill per batch, and counting
    // requests when the vendor counts records would undercount the cap.
    calls: integer('calls').notNull().default(1),
    // Integer paise/cents — never a float. Money in floating point accumulates
    // error exactly where a cap is supposed to be exact.
    costCents: integer('cost_cents').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    // Drives every aggregate in SeoCostGuardUsage: the month/day cost sums and
    // the tenant-scoped per-provider daily call counts.
    tenantCreatedIdx: index('seo_api_usage_tenant_created_idx').on(t.tenantId, t.createdAt),
    // The per-site caps (siteDaySerperCalls, siteDayPublishes).
    siteCreatedIdx: index('seo_api_usage_site_created_idx').on(t.siteId, t.createdAt),
    tenantProviderCreatedIdx: index('seo_api_usage_tenant_provider_created_idx').on(
      t.tenantId, t.provider, t.createdAt,
    ),
  }),
);

// ---------------------------------------------------------------------------
// TABLE — seo_page_metrics (per-URL Search Console performance)
//
// WHY A NEW TABLE. `seo_weekly_metrics` is a DOMAIN-level weekly rollup — one
// row per (site, week) holding site-wide clicks/impressions. `keyword_rankings`
// is per-QUERY. Neither is per-URL, so the drift sweep had no way to answer
// "which pages does Google actually send this site traffic for?" and its third
// URL source — the one that catches pages the agency never touched, and so the
// one that catches a client editing a page nobody on the agency side is
// watching — was left unimplemented (see siteDriftService.ts's header).
//
// This table is that source. It is written by the GSC pull's `page`-dimension
// query and read by `collectCandidateUrls` as "top N by impressions".
//
// ONE ROW PER (site, url, recorded_date), enforced by the unique index. The
// pull is idempotent within a day: re-running it UPDATEs rather than appending,
// so a cron that fires twice (retry, manual kick) cannot double-count or leave
// two rows for the same day competing to be "the" reading.
//
// `site_id` is NOT NULL here, unlike the older SEO tables where it is nullable
// pending their string-key migration. This table is new, has no legacy rows,
// and is written only from inside the per-site loop where the id is always
// known — so there is no state in which a null would be correct.
// ---------------------------------------------------------------------------
export const seoPageMetrics = pgTable(
  'seo_page_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
    siteId: uuid('site_id').notNull().references(() => seoSites.id),
    pageUrl: text('page_url').notNull(),
    // The GSC query window's END date, matching keyword_rankings.recorded_date
    // — GSC data lags ~2 days, so this is "the last day this reading covers",
    // not the day the cron ran.
    recordedDate: date('recorded_date').notNull(),
    clicks: integer('clicks').notNull().default(0),
    impressions: integer('impressions').notNull().default(0),
    avgPosition: numeric('avg_position'),
    avgCtr: numeric('avg_ctr'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    // Idempotency key for the daily pull's ON CONFLICT DO UPDATE.
    siteUrlDateUniq: uniqueIndex('seo_page_metrics_site_url_date_unique').on(
      t.tenantId, t.siteId, t.recordedDate, t.pageUrl,
    ),
    // Serves the only read: newest recorded_date for a site, highest
    // impressions first, limit N.
    siteDateImpressionsIdx: index('seo_page_metrics_site_date_impressions_idx').on(
      t.tenantId, t.siteId, t.recordedDate, t.impressions,
    ),
  }),
);

// ---------------------------------------------------------------------------
// TABLE — role_permissions (join table: permission keys granted by a role)
//
// `permission` is free text matching a key from the `PERMISSIONS` registry
// (src/config/permissions.ts), not a DB enum — the registry is the single
// source of truth for valid keys and is expected to grow; a DB enum would
// need its own migration for every new permission. Composite primary key —
// no surrogate id needed for a pure join row.
// ---------------------------------------------------------------------------
export const rolePermissions = pgTable(
  'role_permissions',
  {
    roleId: uuid('role_id').notNull().references(() => roles.id),
    permission: text('permission').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.roleId, t.permission] }),
  }),
);

// ---------------------------------------------------------------------------
// TABLE — user_permission_overrides (per-user grant/revoke on top of a role)
//
// Effective permissions = the user's role's role_permissions, UNION any
// 'grant' overrides here, MINUS any 'revoke' overrides here — see
// getEffectivePermissions in src/services/permissionResolver.ts. One row per
// (user, permission): a user can only have a single standing override for a
// given permission at a time, enforced by the unique index below.
// ---------------------------------------------------------------------------
export const userPermissionOverrides = pgTable(
  'user_permission_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id),
    permission: text('permission').notNull(),
    effect: text('effect').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    createdBy: uuid('created_by').references(() => users.id),
  },
  (t) => ({
    userPermissionUniq: uniqueIndex('user_permission_overrides_user_permission_unique').on(
      t.userId, t.permission,
    ),
    effectChk: check('user_permission_overrides_effect_chk', sql`effect IN ('grant','revoke')`),
  }),
);
