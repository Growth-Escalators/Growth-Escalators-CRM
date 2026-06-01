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
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  role: text('role').default('staff'), // admin | manager_ops | manager_ads | sales | staff
  tokenVersion: integer('token_version').default(1),
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
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('prospects_status_idx').on(t.status),
    icpSegmentIdx: index('prospects_icp_segment_idx').on(t.icpSegment),
    createdAtIdx: index('prospects_created_at_idx').on(t.createdAt),
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
