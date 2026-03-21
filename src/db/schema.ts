import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  numeric,
  date,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

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
  },
  (t) => ({
    tenantIdIdx: index('events_tenant_id_idx').on(t.tenantId),
    contactIdIdx: index('events_contact_id_idx').on(t.contactId),
    eventTypeIdx: index('events_event_type_idx').on(t.eventType),
    occurredAtIdx: index('events_occurred_at_idx').on(t.occurredAt),
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
  title: text('title').notNull(),
  description: text('description'),
  assignedTo: text('assigned_to'),
  dueAt: timestamp('due_at'),
  status: text('status').default('open'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

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
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

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
