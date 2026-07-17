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
  real,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (t) => ({
    tenantEmailIdx: uniqueIndex('users_tenant_email_unique').on(t.tenantId, t.email),
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
  invoiceNumber: text('invoice_number').notNull().unique(),
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
});

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
export const invoiceSeries = pgTable('invoice_series', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  seriesType: text('series_type').notNull(), // 'gst' | 'non_gst'
  financialYear: text('financial_year').notNull(),
  lastNumber: integer('last_number').default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

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

// ===========================================================================
// SEO AUTOMATION TABLES (Phase 2 upgrade)
// ===========================================================================

// ---------------------------------------------------------------------------
// TABLE 36 — client_knowledge_base
// ---------------------------------------------------------------------------
export const clientKnowledgeBase = pgTable('client_knowledge_base', {
  id: uuid('id').primaryKey().defaultRandom(),
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
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ---------------------------------------------------------------------------
// TABLE 37 — client_pages
// ---------------------------------------------------------------------------
export const clientPages = pgTable('client_pages', {
  id: uuid('id').primaryKey().defaultRandom(),
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
  createdAt: timestamp('created_at').defaultNow(),
});

// ---------------------------------------------------------------------------
// TABLE 38 — keyword_rankings
// ---------------------------------------------------------------------------
export const keywordRankings = pgTable(
  'keyword_rankings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectName: text('project_name').notNull(),
    keyword: text('keyword').notNull(),
    currentPosition: numeric('current_position'),
    previousPosition: numeric('previous_position'),
    positionChange: numeric('position_change'),
    searchVolume: integer('search_volume').default(0),
    urlRanking: text('url_ranking'),
    featuredSnippet: boolean('featured_snippet').default(false),
    recordedDate: date('recorded_date').notNull(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    projectKeywordIdx: index('keyword_rankings_project_keyword_idx').on(t.projectName, t.keyword),
    recordedDateIdx: index('keyword_rankings_recorded_date_idx').on(t.recordedDate),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 39 — backlink_data
// ---------------------------------------------------------------------------
export const backlinkData = pgTable(
  'backlink_data',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectName: text('project_name').notNull(),
    sourceUrl: text('source_url'),
    targetUrl: text('target_url'),
    domainAuthority: numeric('domain_authority').default('0'),
    anchorText: text('anchor_text'),
    linkType: text('link_type'),
    firstSeen: date('first_seen'),
    lastSeen: date('last_seen'),
    status: text('status').default('active'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (t) => ({
    projectIdx: index('backlink_data_project_idx').on(t.projectName),
    statusIdx: index('backlink_data_status_idx').on(t.status),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 40 — content_gap_analysis
// ---------------------------------------------------------------------------
export const contentGapAnalysis = pgTable(
  'content_gap_analysis',
  {
    id: uuid('id').primaryKey().defaultRandom(),
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
    analysedAt: timestamp('analysed_at').defaultNow(),
  },
  (t) => ({
    projectKeywordIdx: index('content_gap_project_keyword_idx').on(t.projectName, t.targetKeyword),
    priorityScoreIdx: index('content_gap_priority_score_idx').on(t.priorityScore),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 41 — seo_opportunities
// ---------------------------------------------------------------------------
export const seoOpportunities = pgTable(
  'seo_opportunities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectName: text('project_name').notNull(),
    opportunityType: text('opportunity_type'),
    description: text('description'),
    estimatedImpact: text('estimated_impact'),
    effortLevel: text('effort_level'),
    status: text('status').default('open'),
    identifiedAt: timestamp('identified_at').defaultNow(),
  },
  (t) => ({
    projectStatusIdx: index('seo_opportunities_project_status_idx').on(t.projectName, t.status),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 42 — site_health_metrics
// ---------------------------------------------------------------------------
export const siteHealthMetrics = pgTable(
  'site_health_metrics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectName: text('project_name').notNull(),
    pagespeedMobile: numeric('pagespeed_mobile'),
    pagespeedDesktop: numeric('pagespeed_desktop'),
    lcp: numeric('lcp'),
    fid: numeric('fid'),
    cls: numeric('cls'),
    brokenLinksCount: integer('broken_links_count').default(0),
    indexedPagesCount: integer('indexed_pages_count').default(0),
    crawlErrorsCount: integer('crawl_errors_count').default(0),
    checkedAt: timestamp('checked_at').defaultNow(),
  },
  (t) => ({
    projectCheckedAtIdx: index('site_health_project_checked_at_idx').on(t.projectName, t.checkedAt),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 43 — brand_mentions
// ---------------------------------------------------------------------------
export const brandMentions = pgTable(
  'brand_mentions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectName: text('project_name').notNull(),
    mentionUrl: text('mention_url'),
    mentionText: text('mention_text'),
    hasLink: boolean('has_link').default(false),
    domainAuthority: numeric('domain_authority').default('0'),
    discoveredAt: timestamp('discovered_at').defaultNow(),
  },
  (t) => ({
    projectIdx: index('brand_mentions_project_idx').on(t.projectName),
  }),
);

// ---------------------------------------------------------------------------
// TABLE 44 — prospects  (outbound lead-gen, Phase 1)
// ---------------------------------------------------------------------------
export const prospects = pgTable(
  'prospects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
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
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (t) => ({
    tenantIdIdx: index('wizmatch_companies_tenant_idx').on(t.tenantId),
    domainIdx: index('wizmatch_companies_domain_idx').on(t.domain),
    primeIdx: index('wizmatch_companies_prime_idx').on(t.isPrime),
    tenantNameUniq: uniqueIndex('wizmatch_companies_tenant_name_idx').on(t.tenantId, t.name),
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
  },
  (t) => ({
    tenantEmailIdx: index('wizmatch_suppression_tenant_email_idx').on(t.tenantId, t.email),
    contactIdx: index('wizmatch_suppression_contact_idx').on(t.contactId),
    tenantEmailUniq: uniqueIndex('wizmatch_suppression_tenant_email_uniq_idx').on(t.tenantId, t.email),
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
