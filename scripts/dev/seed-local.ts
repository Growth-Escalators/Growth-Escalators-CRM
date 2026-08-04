/**
 * seed-local.ts — synthetic seed data for a DISPOSABLE LOCAL database.
 *
 * Creates both tenants, one admin user per tenant, a Growth CRM slice
 * (pipeline / contacts / deals / tasks) and a WizMatch slice (companies with
 * ATS fields, root + scoped policies, hiring contacts, job signals,
 * requirements, candidates, submissions, a placement) — enough to click every
 * screen in the admin SPA without any real data.
 *
 * SAFETY
 *   1. HARD GUARD: refuses to run unless DATABASE_URL resolves to
 *      localhost / 127.0.0.1 / ::1. This is the single most important line in
 *      the file — it is what makes "run the seed" a safe instruction.
 *   2. Every identity is synthetic: `@example.invalid` addresses (a reserved
 *      TLD that can never resolve), placeholder person names, invented company
 *      names, and phone numbers whose subscriber part is all zeroes. No real
 *      person, client, domain or production row is referenced or copied.
 *   3. Claims the three one-time boot backfills so a subsequent `npm run dev`
 *      does not fire the PageSpeed / WordPress / purchase-backfill jobs that
 *      `DISABLE_BACKGROUND_JOBS` does not cover (src/index.ts:864-906).
 *
 * IDEMPOTENT: every row uses a fixed UUID and upserts, so re-running converges
 * on the same state. `wizmatch_company_policies` is insert-only (ON CONFLICT DO
 * NOTHING) because it carries an immutability trigger that raises on any UPDATE
 * touching a column other than superseded_at / superseded_by_policy_id.
 *
 * Usage:
 *   npm run dev:seed
 *   DATABASE_URL=postgresql://you@localhost:5432/ge_local_dev npm run dev:seed
 *
 * Run `npm run db:migrate` first — this script assumes a migrated schema and
 * does not create tables.
 */
import 'dotenv/config';
import { Pool, type PoolClient } from 'pg';
import { hash } from '@node-rs/argon2';

// Local-only, disposable, and deliberately printed at the end of the run.
const LOCAL_PASSWORD = 'LocalDevOnly-2026!';

const GROWTH_SLUG = 'growth-escalators';
const WIZMATCH_SLUG = 'wizmatch';

// Fixed UUIDs so every re-run targets the same rows.
const ID = {
  userGrowthAdmin: 'd0000001-0000-4000-8000-000000000001',
  userWizmatchAdmin: 'd0000001-0000-4000-8000-000000000002',

  pipelineSales: 'd0000002-0000-4000-8000-000000000001',

  crmContact: [
    'd0000003-0000-4000-8000-000000000001',
    'd0000003-0000-4000-8000-000000000002',
    'd0000003-0000-4000-8000-000000000003',
  ],
  deal: [
    'd0000004-0000-4000-8000-000000000001',
    'd0000004-0000-4000-8000-000000000002',
    'd0000004-0000-4000-8000-000000000003',
  ],
  taskList: 'd0000005-0000-4000-8000-000000000001',
  task: [
    'd0000006-0000-4000-8000-000000000001',
    'd0000006-0000-4000-8000-000000000002',
    'd0000006-0000-4000-8000-000000000003',
  ],

  company: [
    'd0000010-0000-4000-8000-000000000001',
    'd0000010-0000-4000-8000-000000000002',
    'd0000010-0000-4000-8000-000000000003',
    'd0000010-0000-4000-8000-000000000004',
  ],
  policyRoot: [
    'd0000011-0000-4000-8000-000000000001',
    'd0000011-0000-4000-8000-000000000002',
    'd0000011-0000-4000-8000-000000000003',
    'd0000011-0000-4000-8000-000000000004',
  ],
  policyScoped: 'd0000011-0000-4000-8000-000000000005',

  hiringContact: [
    'd0000012-0000-4000-8000-000000000001',
    'd0000012-0000-4000-8000-000000000002',
    'd0000012-0000-4000-8000-000000000003',
  ],
  companyContact: [
    'd0000013-0000-4000-8000-000000000001',
    'd0000013-0000-4000-8000-000000000002',
    'd0000013-0000-4000-8000-000000000003',
  ],
  companyContactRole: [
    'd0000014-0000-4000-8000-000000000001',
    'd0000014-0000-4000-8000-000000000002',
    'd0000014-0000-4000-8000-000000000003',
  ],

  signal: [
    'd0000020-0000-4000-8000-000000000001',
    'd0000020-0000-4000-8000-000000000002',
    'd0000020-0000-4000-8000-000000000003',
    'd0000020-0000-4000-8000-000000000004',
    'd0000020-0000-4000-8000-000000000005',
  ],
  requirement: [
    'd0000021-0000-4000-8000-000000000001',
    'd0000021-0000-4000-8000-000000000002',
    'd0000021-0000-4000-8000-000000000003',
    'd0000021-0000-4000-8000-000000000004',
  ],
  candidateContact: [
    'd0000022-0000-4000-8000-000000000001',
    'd0000022-0000-4000-8000-000000000002',
    'd0000022-0000-4000-8000-000000000003',
    'd0000022-0000-4000-8000-000000000004',
  ],
  candidate: [
    'd0000023-0000-4000-8000-000000000001',
    'd0000023-0000-4000-8000-000000000002',
    'd0000023-0000-4000-8000-000000000003',
    'd0000023-0000-4000-8000-000000000004',
  ],
  submission: [
    'd0000024-0000-4000-8000-000000000001',
    'd0000024-0000-4000-8000-000000000002',
    'd0000024-0000-4000-8000-000000000003',
  ],
  placement: 'd0000025-0000-4000-8000-000000000001',
};

// Deterministic channel-row ids derived from the owning contact id, so the
// contact_channels unique index (contact_id, channel_type, channel_value) and
// the fixed-id upsert never disagree.
function channelId(contactId: string, suffix: string): string {
  // Rewrite only the second UUID group. The first and last groups are what make
  // each contact id distinct, so both must survive or two different contacts
  // would derive the same channel id.
  const parts = contactId.split('-');
  parts[1] = `0c0${suffix}`;
  return parts.join('-');
}

/**
 * THE GUARD. Nothing in this file runs against a non-local database.
 *
 * Checked on the parsed URL host rather than a substring match, so a
 * production connection string that merely mentions "localhost" in a query
 * parameter or password cannot slip through.
 */
function assertLocalDatabase(connectionString: string | undefined): string {
  if (!connectionString || !connectionString.trim()) {
    console.error('\n[seed-local] DATABASE_URL is not set.');
    console.error('             Create a .env first: cp scripts/dev/env.local.example .env\n');
    process.exit(1);
  }

  let host: string;
  try {
    host = new URL(connectionString).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    console.error('\n[seed-local] DATABASE_URL is not a parseable connection URL. Refusing to run.\n');
    process.exit(1);
  }

  const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
  if (!LOCAL_HOSTS.has(host)) {
    console.error('\n[seed-local] REFUSING TO RUN — DATABASE_URL does not point at a local database.');
    console.error(`             Resolved host: ${host}`);
    console.error('             This script only ever runs against localhost / 127.0.0.1 / ::1.');
    console.error('             Seeding a shared or production database is never the right move.\n');
    process.exit(1);
  }

  return connectionString;
}

// Tenant-feature-gating PR — `plan` now drives getTenantFeatures()'s
// per-plan defaults (src/services/tenantFeatures.ts), so it must match the
// tenant's real slug, not always 'agency_internal' (that bug pre-dates this
// PR — plan was never read by anything before, so it didn't matter; it does
// now, since a locally-seeded wizmatch tenant with the wrong plan would get
// wizmatch:false and silently break local Wizmatch testing).
async function upsertTenant(client: PoolClient, slug: string, name: string, plan: string): Promise<string> {
  const result = await client.query<{ id: string }>(
    `INSERT INTO tenants (name, slug, plan, is_active)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, plan = EXCLUDED.plan, is_active = true
     RETURNING id`,
    [name, slug, plan],
  );
  return result.rows[0].id;
}

async function upsertUser(
  client: PoolClient,
  id: string,
  tenantId: string,
  name: string,
  email: string,
  passwordHash: string,
): Promise<void> {
  // Login resolves on (email, tenant slug) and does not lower-case the stored
  // column, so the email must go in already normalised or login silently 401s.
  await client.query(
    `INSERT INTO users (id, tenant_id, name, email, password_hash, role, token_version, is_active)
     VALUES ($1, $2, $3, $4, $5, 'admin', 1, true)
     ON CONFLICT (id) DO UPDATE SET
       tenant_id = EXCLUDED.tenant_id,
       name = EXCLUDED.name,
       email = EXCLUDED.email,
       password_hash = EXCLUDED.password_hash,
       role = 'admin',
       is_active = true`,
    [id, tenantId, name, email.trim().toLowerCase(), passwordHash],
  );
}

async function upsertContact(
  client: PoolClient,
  id: string,
  tenantId: string,
  firstName: string,
  lastName: string,
  companyName: string | null,
  opts: { status?: string; source?: string; tags?: string[] } = {},
): Promise<void> {
  // lastActivityAt is bumped on every contact write — the CRM sorts by it.
  await client.query(
    `INSERT INTO contacts (id, tenant_id, first_name, last_name, company_name, status, source, tags, last_activity_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
     ON CONFLICT (id) DO UPDATE SET
       tenant_id = EXCLUDED.tenant_id,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       company_name = EXCLUDED.company_name,
       status = EXCLUDED.status,
       source = EXCLUDED.source,
       tags = EXCLUDED.tags,
       last_activity_at = NOW(),
       updated_at = NOW()`,
    [
      id, tenantId, firstName, lastName, companyName,
      opts.status ?? 'lead', opts.source ?? 'local_seed', opts.tags ?? ['local_seed'],
    ],
  );
}

async function upsertChannel(
  client: PoolClient,
  contactId: string,
  tenantId: string,
  channelType: 'email' | 'phone' | 'whatsapp',
  rawValue: string,
  isPrimary = true,
): Promise<void> {
  // Same normalisation findOrCreateContact applies, so seeded rows dedup against
  // anything the app later writes: email lower-cased, phone digits-only with a
  // 91 country prefix.
  const value = channelType === 'email'
    ? rawValue.trim().toLowerCase()
    : (() => {
        const digits = rawValue.replace(/\D/g, '');
        return digits.startsWith('91') ? digits : `91${digits}`;
      })();

  const suffix = channelType === 'email' ? '1' : channelType === 'phone' ? '2' : '3';
  await client.query(
    `INSERT INTO contact_channels (id, tenant_id, contact_id, channel_type, channel_value, is_primary, verified)
     VALUES ($1, $2, $3, $4, $5, $6, false)
     ON CONFLICT (id) DO UPDATE SET
       tenant_id = EXCLUDED.tenant_id,
       channel_value = EXCLUDED.channel_value,
       is_primary = EXCLUDED.is_primary`,
    [channelId(contactId, suffix), tenantId, contactId, channelType, value, isPrimary],
  );
}

async function seedGrowthCrm(client: PoolClient, tenantId: string): Promise<void> {
  await client.query(
    `INSERT INTO pipelines (id, tenant_id, name, slug, stages, color, is_active, sort_order)
     VALUES ($1, $2, 'Local Sales', 'local-sales', $3::jsonb, '#F97316', true, 0)
     ON CONFLICT (id) DO UPDATE SET
       tenant_id = EXCLUDED.tenant_id,
       name = EXCLUDED.name,
       stages = EXCLUDED.stages,
       is_active = true`,
    [
      ID.pipelineSales,
      tenantId,
      JSON.stringify(['lead', 'qualified', 'proposal', 'won', 'lost']),
    ],
  );

  const crmPeople = [
    { first: 'Ivy', last: 'Testrecord', company: 'Example Retail Co', status: 'lead', email: 'test-lead-one@example.invalid', phone: '910000000101' },
    { first: 'Jonah', last: 'Sampleton', company: 'Example Logistics Co', status: 'qualified', email: 'test-lead-two@example.invalid', phone: '910000000102' },
    { first: 'Kit', last: 'Placeholderson', company: 'Example Wellness Co', status: 'customer', email: 'test-lead-three@example.invalid', phone: '910000000103' },
  ];

  for (const [i, person] of crmPeople.entries()) {
    await upsertContact(client, ID.crmContact[i], tenantId, person.first, person.last, person.company, {
      status: person.status,
      tags: ['local_seed', 'crm'],
    });
    await upsertChannel(client, ID.crmContact[i], tenantId, 'email', person.email);
    await upsertChannel(client, ID.crmContact[i], tenantId, 'phone', person.phone, false);
  }

  const deals = [
    { title: 'Example Retail Co — retainer', stage: 'lead', value: '45000.00' },
    { title: 'Example Logistics Co — audit', stage: 'proposal', value: '120000.00' },
    { title: 'Example Wellness Co — renewal', stage: 'won', value: '250000.00' },
  ];

  for (const [i, deal] of deals.entries()) {
    // NOTE: no `source` / `probability` here. Those columns are NOT created by
    // any migration — src/index.ts:721 adds them with ALTER TABLE ... ADD COLUMN
    // IF NOT EXISTS at boot, so on a freshly migrated database they do not exist
    // yet and referencing them fails the whole transaction.
    await client.query(
      `INSERT INTO deals (id, tenant_id, contact_id, pipeline_id, title, stage, value, notes, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'Seeded by scripts/dev/seed-local.ts', NOW())
       ON CONFLICT (id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         contact_id = EXCLUDED.contact_id,
         pipeline_id = EXCLUDED.pipeline_id,
         title = EXCLUDED.title,
         stage = EXCLUDED.stage,
         value = EXCLUDED.value,
         updated_at = NOW()`,
      [ID.deal[i], tenantId, ID.crmContact[i], ID.pipelineSales, deal.title, deal.stage, deal.value],
    );
  }

  await client.query(
    `INSERT INTO task_lists (id, tenant_id, owner_id, name, position)
     VALUES ($1, $2, $3, 'Local QA list', 0)
     ON CONFLICT (id) DO UPDATE SET
       tenant_id = EXCLUDED.tenant_id,
       owner_id = EXCLUDED.owner_id,
       name = EXCLUDED.name,
       updated_at = NOW()`,
    [ID.taskList, tenantId, ID.userGrowthAdmin],
  );

  const tasks = [
    { title: 'Walk the contacts list end to end', status: 'open', due: '3 days' },
    { title: 'Check the deals board drag-and-drop', status: 'open', due: '5 days' },
    { title: 'Confirm task completion writes back', status: 'done', due: '-1 days' },
  ];

  for (const [i, task] of tasks.entries()) {
    await client.query(
      `INSERT INTO tasks (id, tenant_id, contact_id, list_id, title, description, status, due_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'Seeded by scripts/dev/seed-local.ts', $6, NOW() + $7::interval, NOW())
       ON CONFLICT (id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         title = EXCLUDED.title,
         status = EXCLUDED.status,
         due_at = EXCLUDED.due_at,
         updated_at = NOW()`,
      [ID.task[i], tenantId, ID.crmContact[i], ID.taskList, task.title, task.status, task.due],
    );
  }
}

async function seedWizmatch(client: PoolClient, tenantId: string): Promise<void> {
  // --- Companies. Three carry a full ATS triple (ats_type/ats_slug/
  // ats_board_url), which is what the "ATS-ready" counters in the UI require;
  // the fourth deliberately has none so the empty-state renders too.
  const companies = [
    { name: 'Northwind Staffing Partners', domain: 'northwind.example.invalid', atsType: 'greenhouse', atsSlug: 'northwindstaffing', employees: 480, industry: 'Technology Services', state: 'WA' },
    { name: 'Vertex Analytics Group', domain: 'vertex.example.invalid', atsType: 'lever', atsSlug: 'vertexanalytics', employees: 1200, industry: 'Data & Analytics', state: 'NY' },
    { name: 'Harborline Systems', domain: 'harborline.example.invalid', atsType: 'ashby', atsSlug: 'harborline', employees: 260, industry: 'Industrial Software', state: 'MA' },
    { name: 'Cobalt Peak Industries', domain: 'cobaltpeak.example.invalid', atsType: null, atsSlug: null, employees: 75, industry: 'Manufacturing', state: 'OH' },
  ];

  for (const [i, c] of companies.entries()) {
    const boardUrl = c.atsType && c.atsSlug
      ? `https://boards.${c.atsType}.example.invalid/${c.atsSlug}`
      : null;
    await client.query(
      `INSERT INTO wizmatch_companies
         (id, tenant_id, name, domain, ats_type, ats_slug, ats_board_url,
          employee_count, industry, state, country, is_prime, notes, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'US', $11, 'Synthetic local seed record.', NOW())
       ON CONFLICT (id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         name = EXCLUDED.name,
         domain = EXCLUDED.domain,
         ats_type = EXCLUDED.ats_type,
         ats_slug = EXCLUDED.ats_slug,
         ats_board_url = EXCLUDED.ats_board_url,
         employee_count = EXCLUDED.employee_count,
         updated_at = NOW()`,
      [ID.company[i], tenantId, c.name, c.domain, c.atsType, c.atsSlug, boardUrl,
       c.employees, c.industry, c.state, i === 0],
    );
  }

  // --- Root policies. wizmatch_company_policies enforces ~17 CHECK constraints;
  // an entire_company row must set all three of outreach_eligibility /
  // external_hiring_policy / relationship_type (root_defines_all_chk), and
  // scope_key must equal 'entire_company' exactly (scope_key_root_chk).
  //
  // INSERT-ONLY: the table has a BEFORE UPDATE trigger that raises on any
  // change outside superseded_at / superseded_by_policy_id, so DO NOTHING is
  // the only re-runnable option here.
  const rootPolicies = [
    { eligibility: 'eligible', hiring: 'accepts_external_vendors', relationship: 'new_prospect', reason: 'policy_confirmed_open' },
    { eligibility: 'needs_review', hiring: 'unknown', relationship: 'existing_prospect', reason: 'policy_unknown_cold_start' },
    { eligibility: 'eligible', hiring: 'preferred_vendors_only', relationship: 'existing_client', reason: 'policy_confirmed_open' },
    { eligibility: 'blocked', hiring: 'no_external_agencies', relationship: 'competitor', reason: 'policy_confirmed_closed' },
  ];

  for (const [i, p] of rootPolicies.entries()) {
    await client.query(
      `INSERT INTO wizmatch_company_policies
         (id, tenant_id, company_id, scope_type, scope_key,
          outreach_eligibility, external_hiring_policy, relationship_type,
          reason_code, reason, source, is_permanent, block_class, is_non_overridable)
       VALUES ($1, $2, $3, 'entire_company', 'entire_company', $4, $5, $6, $7,
               'Seeded by scripts/dev/seed-local.ts', 'import', false, 'standard', false)
       ON CONFLICT (id) DO NOTHING`,
      [ID.policyRoot[i], tenantId, ID.company[i], p.eligibility, p.hiring, p.relationship, p.reason],
    );
  }

  // A scoped override. `paused` requires a review_date (paused_review_date_chk),
  // and a region scope_ref_label must be 'india' or 'us' (region_label_chk).
  await client.query(
    `INSERT INTO wizmatch_company_policies
       (id, tenant_id, company_id, scope_type, scope_key, scope_ref_label,
        outreach_eligibility, reason_code, reason, source, review_date)
     VALUES ($1, $2, $3, 'region', 'region:us', 'us', 'paused',
             'policy_paused_pending_review', 'Seeded scoped override for local QA.',
             'human', CURRENT_DATE + 30)
     ON CONFLICT (id) DO NOTHING`,
    [ID.policyScoped, tenantId, ID.company[0]],
  );

  // --- Hiring contacts. The person lives on contacts + contact_channels;
  // wizmatch_company_contacts is only the company<->contact join, and the role
  // is a further row on wizmatch_company_contact_roles.
  const hiringPeople = [
    { first: 'Ada', last: 'Testcase', company: 0, role: 'talent_acquisition', seniority: 'manager', email: 'test-hiring-one@example.invalid', phone: '910000000201' },
    { first: 'Bram', last: 'Fixture', company: 1, role: 'hiring_manager', seniority: 'director', email: 'test-hiring-two@example.invalid', phone: '910000000202' },
    { first: 'Cleo', last: 'Sample', company: 2, role: 'vendor_manager', seniority: 'lead', email: 'test-hiring-three@example.invalid', phone: '910000000203' },
  ];

  for (const [i, p] of hiringPeople.entries()) {
    await upsertContact(client, ID.hiringContact[i], tenantId, p.first, p.last, companies[p.company].name, {
      status: 'lead',
      tags: ['local_seed', 'wizmatch_hiring_contact'],
    });
    await upsertChannel(client, ID.hiringContact[i], tenantId, 'email', p.email);
    await upsertChannel(client, ID.hiringContact[i], tenantId, 'phone', p.phone, false);

    await client.query(
      `INSERT INTO wizmatch_company_contacts
         (id, tenant_id, company_id, contact_id, relationship_stage, seniority,
          source_type, source_confidence, last_activity_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', $5, 'manual', 90, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         company_id = EXCLUDED.company_id,
         contact_id = EXCLUDED.contact_id,
         seniority = EXCLUDED.seniority,
         last_activity_at = NOW(),
         updated_at = NOW()`,
      [ID.companyContact[i], tenantId, ID.company[p.company], ID.hiringContact[i], p.seniority],
    );

    await client.query(
      `INSERT INTO wizmatch_company_contact_roles (id, tenant_id, company_contact_id, role, active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         company_contact_id = EXCLUDED.company_contact_id,
         role = EXCLUDED.role,
         active = true`,
      [ID.companyContactRole[i], tenantId, ID.companyContact[i], p.role],
    );
  }

  // --- Job signals across the documented status ladder, so every filter tab in
  // the signals UI has at least one row.
  const signals = [
    { company: 0, title: 'Senior Java Engineer (Contract)', status: 'new', score: 0, source: 'greenhouse', employment: 'C2C', location: 'Seattle, WA', days: 2 },
    { company: 0, title: 'Data Platform Engineer', status: 'scored', score: 72, source: 'greenhouse', employment: 'W2', location: 'Remote, US', days: 9 },
    { company: 1, title: 'Analytics Engineer', status: 'enriched', score: 81, source: 'lever', employment: 'contract', location: 'New York, NY', days: 14 },
    { company: 2, title: 'Embedded Systems Developer', status: 'matched', score: 88, source: 'ashby', employment: 'FTE', location: 'Boston, MA', days: 21 },
    { company: 2, title: 'QA Automation Lead', status: 'replied_positive', score: 91, source: 'manual', employment: 'C2C', location: 'Remote, US', days: 34 },
  ];

  for (const [i, s] of signals.entries()) {
    await client.query(
      `INSERT INTO wizmatch_job_signals
         (id, tenant_id, company_id, job_title, job_url, source, provider_id,
          posted_at, first_seen_at, last_seen_at, days_open, employment_type,
          keywords, location, score, score_breakdown, status, raw_text)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
               NOW() - $8::interval, NOW() - $8::interval, NOW(), $9, $10,
               $11, $12, $13, $14::jsonb, $15, 'Synthetic local seed posting body.')
       ON CONFLICT (id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         company_id = EXCLUDED.company_id,
         job_title = EXCLUDED.job_title,
         days_open = EXCLUDED.days_open,
         score = EXCLUDED.score,
         status = EXCLUDED.status,
         last_seen_at = NOW()`,
      [
        ID.signal[i], tenantId, ID.company[s.company], s.title,
        `https://jobs.example.invalid/local-seed/${i + 1}`,
        s.source, `local-seed-${i + 1}`,
        `${s.days} days`, s.days, s.employment,
        ['local_seed', s.employment.toLowerCase()], s.location,
        s.score, JSON.stringify({ seeded: true, base: s.score }), s.status,
      ],
    );
  }

  // --- Requirements across the staffing stage ladder.
  const requirements = [
    { company: 0, title: 'Senior Java Engineer — 2 positions', stage: 'draft', status: 'draft', priority: 'normal', signal: 0 },
    { company: 0, title: 'Data Platform Engineer — urgent', stage: 'qualifying', status: 'draft', priority: 'urgent', signal: 1 },
    { company: 1, title: 'Analytics Engineer — contract', stage: 'sourcing', status: 'sheet_ready', priority: 'high', signal: 2 },
    { company: 2, title: 'Embedded Systems Developer', stage: 'submitted', status: 'shared', priority: 'normal', signal: 3 },
  ];

  for (const [i, r] of requirements.entries()) {
    await client.query(
      `INSERT INTO wizmatch_requirements
         (id, tenant_id, company_id, title, raw_jd, required_skills, nice_to_have_skills,
          min_experience, max_experience, location, work_mode, employment_type, region,
          budget_min, budget_max, budget_currency, budget_period, positions, priority,
          mask_client, status, attribution_status, stage, stage_entered_at,
          received_at, last_activity_at, source_job_signal_id, created_by, updated_at)
       VALUES ($1, $2, $3, $4, 'Synthetic local seed job description.',
               $5, $6, 4, 9, 'Remote, US', 'remote', 'contract_c2c', 'us',
               60, 95, 'USD', 'hourly', 2, $7,
               true, $8, 'attributed', $9, NOW(), NOW() - interval '6 days', NOW(),
               $10, $11, NOW())
       ON CONFLICT (id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         company_id = EXCLUDED.company_id,
         title = EXCLUDED.title,
         priority = EXCLUDED.priority,
         status = EXCLUDED.status,
         stage = EXCLUDED.stage,
         last_activity_at = NOW(),
         updated_at = NOW()`,
      [
        ID.requirement[i], tenantId, ID.company[r.company], r.title,
        ['java', 'spring', 'sql'], ['kafka', 'aws'],
        r.priority, r.status, r.stage,
        ID.signal[r.signal], ID.userWizmatchAdmin,
      ],
    );
  }

  // --- Candidates. wizmatch_candidates has no `status` column — the
  // status-ish field is availability_status.
  const candidates = [
    { first: 'Dara', last: 'Placeholder', email: 'test-candidate-one@example.invalid', phone: '910000000301', skills: ['java', 'spring', 'sql'], visa: 'H1B', years: 7, rate: 72, availability: 'available' },
    { first: 'Eli', last: 'Mockdata', email: 'test-candidate-two@example.invalid', phone: '910000000302', skills: ['python', 'dbt', 'snowflake'], visa: 'GC', years: 5, rate: 65, availability: 'submitted' },
    { first: 'Fenn', last: 'Stubb', email: 'test-candidate-three@example.invalid', phone: '910000000303', skills: ['c', 'rtos', 'embedded'], visa: 'USC', years: 11, rate: 88, availability: 'interviewing' },
    { first: 'Gia', last: 'Dummyrec', email: 'test-candidate-four@example.invalid', phone: '910000000304', skills: ['playwright', 'typescript', 'ci'], visa: 'OPT', years: 3, rate: 48, availability: 'benched' },
  ];

  for (const [i, c] of candidates.entries()) {
    await upsertContact(client, ID.candidateContact[i], tenantId, c.first, c.last, null, {
      status: 'candidate',
      tags: ['local_seed', 'wizmatch_candidate'],
    });
    await upsertChannel(client, ID.candidateContact[i], tenantId, 'email', c.email);
    await upsertChannel(client, ID.candidateContact[i], tenantId, 'phone', c.phone, false);

    await client.query(
      `INSERT INTO wizmatch_candidates
         (id, tenant_id, contact_id, skills, location, visa_status, experience_years,
          rate_hourly, rate_currency, rate_period, availability_date, availability_status,
          source, linkedin_url, match_score, is_wizmatch_certified, updated_at)
       VALUES ($1, $2, $3, $4, 'Remote, US', $5, $6, $7, 'USD', 'hourly',
               CURRENT_DATE + 14, $8, 'manual', $9, $10, $11, NOW())
       ON CONFLICT (id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         contact_id = EXCLUDED.contact_id,
         skills = EXCLUDED.skills,
         visa_status = EXCLUDED.visa_status,
         rate_hourly = EXCLUDED.rate_hourly,
         availability_status = EXCLUDED.availability_status,
         match_score = EXCLUDED.match_score,
         updated_at = NOW()`,
      [
        ID.candidate[i], tenantId, ID.candidateContact[i], c.skills, c.visa, c.years,
        c.rate, c.availability,
        `https://www.linkedin.example.invalid/in/local-seed-${i + 1}`,
        70 + i * 5, i === 0,
      ],
    );
  }

  // --- Submissions. The partial unique index only covers non-terminal statuses,
  // so one (requirement, candidate) pair may repeat once it is withdrawn/closed.
  const submissions = [
    { requirement: 2, candidate: 1, status: 'draft' },
    { requirement: 3, candidate: 2, status: 'submitted' },
    { requirement: 3, candidate: 0, status: 'interviewing' },
  ];

  for (const [i, s] of submissions.entries()) {
    await client.query(
      `INSERT INTO wizmatch_submissions
         (id, tenant_id, requirement_id, candidate_id, status, version,
          submission_payload, prepared_by, prepared_at, first_sent_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 1, $6::jsonb, $7, NOW() - interval '2 days',
               CASE WHEN $5 = 'draft' THEN NULL ELSE NOW() - interval '1 day' END, NOW())
       ON CONFLICT (id) DO UPDATE SET
         tenant_id = EXCLUDED.tenant_id,
         requirement_id = EXCLUDED.requirement_id,
         candidate_id = EXCLUDED.candidate_id,
         status = EXCLUDED.status,
         updated_at = NOW()`,
      [
        ID.submission[i], tenantId, ID.requirement[s.requirement], ID.candidate[s.candidate],
        s.status, JSON.stringify({ seeded: true, note: 'Synthetic local seed submission.' }),
        ID.userWizmatchAdmin,
      ],
    );
  }

  // --- One live placement. The delivery service writes placement_type as
  // 'contract' / 'permanent' (not the wider documented set) and gates invoice
  // actions on status IN ('started','ended').
  await client.query(
    `INSERT INTO wizmatch_placements
       (id, tenant_id, candidate_id, job_signal_id, company_id, requirement_id, submission_id,
        placement_type, bill_rate_hourly, pay_rate_hourly, margin_hourly, currency,
        contract_start_date, contract_end_date, contract_length_months, status, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
             'contract', 110, 88, 22, 'USD',
             CURRENT_DATE - 20, CURRENT_DATE + 160, 6, 'started', NOW())
     ON CONFLICT (id) DO UPDATE SET
       tenant_id = EXCLUDED.tenant_id,
       candidate_id = EXCLUDED.candidate_id,
       company_id = EXCLUDED.company_id,
       status = EXCLUDED.status,
       updated_at = NOW()`,
    [ID.placement, tenantId, ID.candidate[2], ID.signal[3], ID.company[2],
     ID.requirement[3], ID.submission[1]],
  );
}

/**
 * Pre-claim the one-time boot backfills. src/index.ts:864-906 fires these on a
 * timer regardless of DISABLE_BACKGROUND_JOBS, and the PageSpeed one makes an
 * unauthenticated outbound request to Google with no env kill switch. Claiming
 * the rows here is the only way to keep a local boot fully offline.
 */
async function claimBootBackfills(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS boot_backfills_completed (
      name VARCHAR(200) PRIMARY KEY,
      completed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  for (const name of [
    'comprehensive-purchase-backfill',
    'initial-pagespeed-check',
    'initial-programmatic-seo-pages',
  ]) {
    await client.query(
      `INSERT INTO boot_backfills_completed (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
      [name],
    );
  }
}

async function main(): Promise<void> {
  const connectionString = assertLocalDatabase(process.env.DATABASE_URL);

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  let growthTenantId = '';
  let wizmatchTenantId = '';

  try {
    await client.query('BEGIN');

    const passwordHash = await hash(LOCAL_PASSWORD);

    growthTenantId = await upsertTenant(client, GROWTH_SLUG, 'Growth Escalators', 'agency_internal');
    wizmatchTenantId = await upsertTenant(client, WIZMATCH_SLUG, 'Wizmatch', 'wizmatch_internal');
    console.log(`[seed-local] tenants ready  growth-escalators=${growthTenantId}  wizmatch=${wizmatchTenantId}`);

    await upsertUser(client, ID.userGrowthAdmin, growthTenantId, 'Local Admin One', 'test-admin-one@example.invalid', passwordHash);
    await upsertUser(client, ID.userWizmatchAdmin, wizmatchTenantId, 'Local Admin Two', 'test-admin-two@example.invalid', passwordHash);
    console.log('[seed-local] admin users ready (1 per tenant)');

    await seedGrowthCrm(client, growthTenantId);
    console.log('[seed-local] growth CRM: 1 pipeline, 3 contacts (+6 channels), 3 deals, 1 task list, 3 tasks');

    await seedWizmatch(client, wizmatchTenantId);
    console.log('[seed-local] wizmatch: 4 companies (3 ATS-ready), 5 policies, 3 hiring contacts, 5 signals, 4 requirements, 4 candidates, 3 submissions, 1 placement');

    await claimBootBackfills(client);
    console.log('[seed-local] boot backfills pre-claimed (no outbound PageSpeed/WordPress call on next boot)');

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('\n[seed-local] FAILED — transaction rolled back, nothing was written.');
    console.error(error instanceof Error ? error.message : error);
    client.release();
    await pool.end();
    process.exit(1);
  }

  client.release();
  await pool.end();

  console.log('\n============================================================');
  console.log(' LOCAL SEED COMPLETE — synthetic data, disposable database');
  console.log('============================================================');
  console.log(' Sign in at http://localhost:5174/login');
  console.log('');
  console.log('   Growth Escalators tenant');
  console.log('     email     test-admin-one@example.invalid');
  console.log(`     password  ${LOCAL_PASSWORD}`);
  console.log('');
  console.log('   Wizmatch tenant');
  console.log('     email     test-admin-two@example.invalid');
  console.log(`     password  ${LOCAL_PASSWORD}`);
  console.log('');
  console.log(' Paste into .env so the WizMatch screens resolve their tenant:');
  console.log(`   WIZMATCH_TENANT_ID=${wizmatchTenantId}`);
  console.log('');
  console.log(' These credentials are local-only and safe to print. Never reuse');
  console.log(' this password anywhere that is not a disposable local database.');
  console.log('============================================================\n');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[seed-local] failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
