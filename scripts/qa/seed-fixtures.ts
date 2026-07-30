/**
 * TEST-ONLY — synthetic QA fixture seeder for the WizMatch/CRM Playwright remediation effort.
 *
 * Populates a disposable database with deterministic, hard-coded-UUID synthetic
 * data across two tenants (`wizmatch-test`, `growth-escalators-test`). NEVER
 * run this against a real/production database — see the guard below.
 *
 * Usage:
 *   tsx scripts/qa/seed-fixtures.ts            # seed (idempotent — safe to re-run)
 *   tsx scripts/qa/seed-fixtures.ts --reset     # remove only the synthetic rows this script owns
 *
 * Env:
 *   DATABASE_URL        required. Must point at a database whose name contains
 *                        "qa" or "test" (case-insensitive) — see assertSafeTarget().
 *   QA_SEED_PASSWORD    optional. Password used for all 10 synthetic users.
 *                        Defaults to 'QaSeedPassw0rd!' (documented default, NOT a
 *                        real credential — synthetic accounts only).
 *
 * Production-safety interlock: this script refuses to run unless
 * assertSafeTarget() passes. Do not remove or weaken that check.
 */
import dotenv from 'dotenv';
dotenv.config();

import { Pool, PoolClient } from 'pg';
import { hash } from '@node-rs/argon2';

// ---------------------------------------------------------------------------
// PRODUCTION-SAFETY INTERLOCK — do not remove or weaken
// ---------------------------------------------------------------------------
function assertSafeTarget(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[qa-seed] Refusing to run: NODE_ENV=production.');
  }
  const url = process.env.DATABASE_URL || '';
  if (!url) {
    throw new Error('[qa-seed] Refusing to run: DATABASE_URL is not set.');
  }
  let dbName = '';
  try {
    dbName = new URL(url).pathname.replace(/^\//, '');
  } catch {
    throw new Error('[qa-seed] Refusing to run: DATABASE_URL is not a parseable URL.');
  }
  const lower = dbName.toLowerCase();
  if (!lower.includes('qa') && !lower.includes('test')) {
    throw new Error(
      `[qa-seed] Refusing to run: target database "${dbName}" name does not contain "qa" or "test". ` +
        'This is the production-safety interlock — point DATABASE_URL at a disposable QA/test database.',
    );
  }
}

const QA_SEED_PASSWORD = process.env.QA_SEED_PASSWORD || 'QaSeedPassw0rd!';

// ---------------------------------------------------------------------------
// DETERMINISTIC SYNTHETIC IDS — obviously-fake, readable UUIDs
// ---------------------------------------------------------------------------
const TENANT_A = '00000000-0000-4000-8000-0000000000a1'; // wizmatch-test
const TENANT_B = '00000000-0000-4000-8000-0000000000a2'; // growth-escalators-test

const USERS = {
  approvedAdmin1: '00000000-0000-4000-8000-00000000b001',
  approvedAdmin2: '00000000-0000-4000-8000-00000000b002',
  teamLead: '00000000-0000-4000-8000-00000000b003',
  staffNotOnRoster: '00000000-0000-4000-8000-00000000b004',
  nonPilotAdmin: '00000000-0000-4000-8000-00000000b005',
  viewerMachine: '00000000-0000-4000-8000-00000000b006',
  formerEmployee: '00000000-0000-4000-8000-00000000b007',
  otherTenantAdmin: '00000000-0000-4000-8000-00000000b008',
  mixedCaseEmail: '00000000-0000-4000-8000-00000000b009',
  duplicateEmailCandidate: '00000000-0000-4000-8000-00000000b010',
};

const COMPANIES = {
  acme: '00000000-0000-4000-8000-00000000c001', // root/entire_company policy
  acmeDuplicate: '00000000-0000-4000-8000-00000000c002', // duplicate-pair partner of acme
  northstar: '00000000-0000-4000-8000-00000000c003', // region policy (india)
  northstarBranch: '00000000-0000-4000-8000-00000000c004', // location policy
  meridian: '00000000-0000-4000-8000-00000000c005', // specific_signal + specific_requirement policies
};

const SIGNALS = {
  acmeSignal: '00000000-0000-4000-8000-00000000d001',
  northstarSignal: '00000000-0000-4000-8000-00000000d002',
  meridianSignal: '00000000-0000-4000-8000-00000000d003', // scoped by specific_signal policy
};

const REQUIREMENTS = {
  acmeRequirement: '00000000-0000-4000-8000-00000000e001', // scoped by specific_requirement policy
  meridianRequirement: '00000000-0000-4000-8000-00000000e002',
};

const CANDIDATES = {
  candidate1: '00000000-0000-4000-8000-00000000f001',
  candidate2: '00000000-0000-4000-8000-00000000f002',
  candidate3: '00000000-0000-4000-8000-00000000f003',
};

const CONTACTS = {
  candidateContact1: '00000000-0000-4000-8000-000000001001',
  candidateContact2: '00000000-0000-4000-8000-000000001002',
  candidateContact3: '00000000-0000-4000-8000-000000001003',
  companyContactHigh: '00000000-0000-4000-8000-000000001004', // acme hiring manager
  companyContactMedium: '00000000-0000-4000-8000-000000001005', // northstar contact
  companyContactLow: '00000000-0000-4000-8000-000000001006', // meridian contact
  blockedContact: '00000000-0000-4000-8000-000000001007', // do-not-contact
};

const CONTACT_CHANNELS = {
  candidateContact1: '00000000-0000-4000-8000-000000001101',
  candidateContact2: '00000000-0000-4000-8000-000000001102',
  candidateContact3: '00000000-0000-4000-8000-000000001103',
  companyContactHigh: '00000000-0000-4000-8000-000000001104',
  companyContactMedium: '00000000-0000-4000-8000-000000001105',
  companyContactLow: '00000000-0000-4000-8000-000000001106',
  blockedContact: '00000000-0000-4000-8000-000000001107',
};

const CONTACT_CANDIDATES = {
  high: '00000000-0000-4000-8000-000000001201', // confidenceScore 90
  medium: '00000000-0000-4000-8000-000000001202', // confidenceScore 50
  low: '00000000-0000-4000-8000-000000001203', // confidenceScore 10
};

const POLICIES = {
  acmeRoot: '00000000-0000-4000-8000-000000001301',
  acmeDuplicateRoot: '00000000-0000-4000-8000-000000001302',
  northstarRoot: '00000000-0000-4000-8000-000000001303',
  northstarBranchRoot: '00000000-0000-4000-8000-000000001304',
  meridianRoot: '00000000-0000-4000-8000-000000001305',
  northstarRegion: '00000000-0000-4000-8000-000000001306',
  northstarBranchLocation: '00000000-0000-4000-8000-000000001307',
  meridianSpecificSignal: '00000000-0000-4000-8000-000000001308',
  acmeSpecificRequirement: '00000000-0000-4000-8000-000000001309',
};

const DUPLICATE_PAIR = '00000000-0000-4000-8000-000000001401';

const MATCHES = {
  candidate1VsAcmeReq: '00000000-0000-4000-8000-000000001501',
  candidate2VsAcmeReq: '00000000-0000-4000-8000-000000001502',
};

const SUBMISSIONS = {
  candidate1ForAcme: '00000000-0000-4000-8000-000000001601',
};

const INTERVIEW_ROUNDS = {
  round1: '00000000-0000-4000-8000-000000001701',
};

const INTERVIEW_PARTICIPANTS = {
  interviewer: '00000000-0000-4000-8000-000000001801',
  clientParticipant: '00000000-0000-4000-8000-000000001802',
};

const PLACEMENTS = {
  candidate1AtAcme: '00000000-0000-4000-8000-000000001901',
};

const SUPPRESSION_LIST = {
  hardBounce: '00000000-0000-4000-8000-000000001a01',
};

const SUPPRESSION_EVENTS = {
  blockedContactEvent: '00000000-0000-4000-8000-000000001b01',
};

const TASKS = {
  policyReviewTask: '00000000-0000-4000-8000-000000001c01',
};

const PIPELINES = {
  wizmatchQaPipeline: '00000000-0000-4000-8000-000000001d01',
};

const DEALS = {
  acmeContractDeal: '00000000-0000-4000-8000-000000001e01',
};

// All synthetic tenant ids — used by the reset path to scope deletes.
const SYNTHETIC_TENANT_IDS = [TENANT_A, TENANT_B];

// ---------------------------------------------------------------------------
// Generic upsert helper — INSERT ... ON CONFLICT (id) DO UPDATE, so re-running
// this script never changes row counts (idempotent).
// ---------------------------------------------------------------------------
async function upsert(client: PoolClient, table: string, row: Record<string, unknown>): Promise<void> {
  const columns = Object.keys(row);
  const values = Object.values(row);
  const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
  const updates = columns
    .filter((c) => c !== 'id')
    .map((c) => `"${c}" = EXCLUDED."${c}"`)
    .join(', ');
  const sql = `
    INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')})
    VALUES (${placeholders})
    ON CONFLICT (id) DO UPDATE SET ${updates || columns[0] + ' = EXCLUDED.' + columns[0]}
  `;
  await client.query(sql, values);
}

async function seed(client: PoolClient): Promise<void> {
  const passwordHash = await hash(QA_SEED_PASSWORD);

  // --- tenants ---------------------------------------------------------
  await upsert(client, 'tenants', {
    id: TENANT_A,
    name: 'Wizmatch QA Test Tenant',
    slug: 'wizmatch-test',
    plan: 'wizmatch_staffing',
    is_active: true,
  });
  await upsert(client, 'tenants', {
    id: TENANT_B,
    name: 'Growth Escalators QA Test Tenant',
    slug: 'growth-escalators-test',
    plan: 'agency_internal',
    is_active: true,
  });

  // --- users (10, all @example.invalid) --------------------------------
  const userRows: Array<{ id: string; tenantId: string; name: string; email: string; role: string }> = [
    { id: USERS.approvedAdmin1, tenantId: TENANT_A, name: 'QA Approved Admin One', email: 'qa-admin-1@example.invalid', role: 'admin' },
    { id: USERS.approvedAdmin2, tenantId: TENANT_A, name: 'QA Approved Admin Two', email: 'qa-admin-2@example.invalid', role: 'admin' },
    { id: USERS.teamLead, tenantId: TENANT_A, name: 'QA Team Lead', email: 'qa-team-lead@example.invalid', role: 'team_lead' },
    { id: USERS.staffNotOnRoster, tenantId: TENANT_A, name: 'QA Staff (Not On Roster)', email: 'qa-staff@example.invalid', role: 'staff' },
    { id: USERS.nonPilotAdmin, tenantId: TENANT_A, name: 'QA Non-Pilot Admin', email: 'qa-nonpilot-admin@example.invalid', role: 'admin' },
    { id: USERS.viewerMachine, tenantId: TENANT_A, name: 'QA Viewer Machine Account', email: 'qa-viewer-machine@example.invalid', role: 'viewer' },
    { id: USERS.formerEmployee, tenantId: TENANT_A, name: 'QA Former Employee', email: 'qa-former-employee@example.invalid', role: 'staff' },
    { id: USERS.otherTenantAdmin, tenantId: TENANT_B, name: 'QA Other-Tenant Admin', email: 'qa-other-tenant-admin@example.invalid', role: 'admin' },
    { id: USERS.mixedCaseEmail, tenantId: TENANT_A, name: 'QA Mixed Case Email User', email: 'Test-Mixed-Case@Example.Invalid', role: 'staff' },
    { id: USERS.duplicateEmailCandidate, tenantId: TENANT_A, name: 'QA Duplicate Email Collision Candidate', email: 'test-mixed-case@example.invalid', role: 'staff' },
  ];
  for (const u of userRows) {
    await upsert(client, 'users', {
      id: u.id,
      tenant_id: u.tenantId,
      name: u.name,
      email: u.email,
      password_hash: passwordHash,
      role: u.role,
      token_version: 1,
    });
  }

  // is_active / is_test_account are RUNTIME columns (added by a fire-and-forget
  // ALTER in src/routes/permissions.ts — see lane2-infra.md M-3 finding), not
  // part of the migrated schema. Only set is_active if the column exists on
  // this DB (it will if the app has booted at least once against it).
  const isActiveCol = await client.query(
    `select 1 from information_schema.columns where table_name='users' and column_name='is_active'`,
  );
  if (isActiveCol.rowCount) {
    await client.query(`UPDATE users SET is_active = true WHERE id = ANY($1::uuid[])`, [
      userRows.filter((u) => u.id !== USERS.formerEmployee).map((u) => u.id),
    ]);
    await client.query(`UPDATE users SET is_active = false WHERE id = $1`, [USERS.formerEmployee]);
  } else {
    console.warn(
      '[qa-seed] users.is_active column does not exist on this DB (pure migration replay) — ' +
        'skipping active/inactive flags. Boot the app once against this DB (permissions.ts ALTER) before relying on is_active.',
    );
  }

  // --- core CRM contacts + channels --------------------------------------
  const contactRows: Array<{ id: string; firstName: string; lastName: string; companyName: string | null; doNotContact: boolean }> = [
    { id: CONTACTS.candidateContact1, firstName: 'Aria', lastName: 'CandidateOne', companyName: null, doNotContact: false },
    { id: CONTACTS.candidateContact2, firstName: 'Beau', lastName: 'CandidateTwo', companyName: null, doNotContact: false },
    { id: CONTACTS.candidateContact3, firstName: 'Cleo', lastName: 'CandidateThree', companyName: null, doNotContact: false },
    { id: CONTACTS.companyContactHigh, firstName: 'Dana', lastName: 'HighConfidence', companyName: 'Acme WizMatch Test Company', doNotContact: false },
    { id: CONTACTS.companyContactMedium, firstName: 'Evan', lastName: 'MediumConfidence', companyName: 'Northstar Synthetic Staffing', doNotContact: false },
    { id: CONTACTS.companyContactLow, firstName: 'Farah', lastName: 'LowConfidence', companyName: 'Meridian QA Technologies', doNotContact: false },
    { id: CONTACTS.blockedContact, firstName: 'Gale', lastName: 'BlockedContact', companyName: 'Acme WizMatch Test Company', doNotContact: true },
  ];
  for (const c of contactRows) {
    await upsert(client, 'contacts', {
      id: c.id,
      tenant_id: TENANT_A,
      first_name: c.firstName,
      last_name: c.lastName,
      company_name: c.companyName,
      status: 'lead',
      do_not_contact: c.doNotContact,
      last_activity_at: new Date(),
    });
  }

  const channelRows: Array<{ id: string; contactId: string; value: string }> = [
    { id: CONTACT_CHANNELS.candidateContact1, contactId: CONTACTS.candidateContact1, value: 'aria.candidateone.qa@example.invalid' },
    { id: CONTACT_CHANNELS.candidateContact2, contactId: CONTACTS.candidateContact2, value: 'beau.candidatetwo.qa@example.invalid' },
    { id: CONTACT_CHANNELS.candidateContact3, contactId: CONTACTS.candidateContact3, value: 'cleo.candidatethree.qa@example.invalid' },
    { id: CONTACT_CHANNELS.companyContactHigh, contactId: CONTACTS.companyContactHigh, value: 'dana.acme.qa@example.invalid' },
    { id: CONTACT_CHANNELS.companyContactMedium, contactId: CONTACTS.companyContactMedium, value: 'evan.northstar.qa@example.invalid' },
    { id: CONTACT_CHANNELS.companyContactLow, contactId: CONTACTS.companyContactLow, value: 'farah.meridian.qa@example.invalid' },
    { id: CONTACT_CHANNELS.blockedContact, contactId: CONTACTS.blockedContact, value: 'gale.blocked.qa@example.invalid' },
  ];
  for (const ch of channelRows) {
    await upsert(client, 'contact_channels', {
      id: ch.id,
      tenant_id: TENANT_A,
      contact_id: ch.contactId,
      channel_type: 'email',
      channel_value: ch.value.toLowerCase().trim(),
      is_primary: true,
      verified: true,
    });
  }

  // --- wizmatch companies --------------------------------------------------
  const companyRows: Array<{ id: string; name: string }> = [
    { id: COMPANIES.acme, name: 'Acme WizMatch Test Company' },
    { id: COMPANIES.acmeDuplicate, name: 'Acme WizMatch Test Company 2' },
    { id: COMPANIES.northstar, name: 'Northstar Synthetic Staffing' },
    { id: COMPANIES.northstarBranch, name: 'Northstar Synthetic Staffing 2' },
    { id: COMPANIES.meridian, name: 'Meridian QA Technologies' },
  ];
  for (const co of companyRows) {
    await upsert(client, 'wizmatch_companies', {
      id: co.id,
      tenant_id: TENANT_A,
      name: co.name,
      country: 'US',
      is_prime: false,
    });
  }

  // --- wizmatch job signals -------------------------------------------------
  await upsert(client, 'wizmatch_job_signals', {
    id: SIGNALS.acmeSignal,
    tenant_id: TENANT_A,
    company_id: COMPANIES.acme,
    job_title: 'Senior Node.js Engineer',
    source: 'manual',
    status: 'scored',
  });
  await upsert(client, 'wizmatch_job_signals', {
    id: SIGNALS.northstarSignal,
    tenant_id: TENANT_A,
    company_id: COMPANIES.northstar,
    job_title: 'Staffing Coordinator',
    source: 'manual',
    status: 'new',
  });
  await upsert(client, 'wizmatch_job_signals', {
    id: SIGNALS.meridianSignal,
    tenant_id: TENANT_A,
    company_id: COMPANIES.meridian,
    job_title: 'QA Automation Engineer',
    source: 'manual',
    status: 'scored',
  });

  // --- wizmatch requirements --------------------------------------------
  await upsert(client, 'wizmatch_requirements', {
    id: REQUIREMENTS.acmeRequirement,
    tenant_id: TENANT_A,
    company_id: COMPANIES.acme,
    title: 'Senior Node.js Engineer - C2C',
    region: 'us',
    employment_type: 'contract_c2c',
    source_job_signal_id: SIGNALS.acmeSignal,
    created_by: USERS.teamLead,
  });
  await upsert(client, 'wizmatch_requirements', {
    id: REQUIREMENTS.meridianRequirement,
    tenant_id: TENANT_A,
    company_id: COMPANIES.meridian,
    title: 'QA Automation Engineer - Contract',
    region: 'india',
    employment_type: 'contract',
    source_job_signal_id: SIGNALS.meridianSignal,
    created_by: USERS.teamLead,
  });

  // --- wizmatch_contact_candidates (high/medium/low confidence) ------------
  await upsert(client, 'wizmatch_contact_candidates', {
    id: CONTACT_CANDIDATES.high,
    tenant_id: TENANT_A,
    company_id: COMPANIES.acme,
    crm_contact_id: CONTACTS.companyContactHigh,
    name: 'Dana HighConfidence',
    title: 'VP Engineering',
    role_category: 'hiring_manager',
    email: 'dana.acme.qa@example.invalid',
    confidence_score: 90,
    ranking_score: 90,
    status: 'approved',
    approved_by: USERS.approvedAdmin1,
  });
  await upsert(client, 'wizmatch_contact_candidates', {
    id: CONTACT_CANDIDATES.medium,
    tenant_id: TENANT_A,
    company_id: COMPANIES.northstar,
    crm_contact_id: CONTACTS.companyContactMedium,
    name: 'Evan MediumConfidence',
    title: 'Talent Acquisition Lead',
    role_category: 'recruiter',
    email: 'evan.northstar.qa@example.invalid',
    confidence_score: 50,
    ranking_score: 50,
    status: 'needs_review',
  });
  await upsert(client, 'wizmatch_contact_candidates', {
    id: CONTACT_CANDIDATES.low,
    tenant_id: TENANT_A,
    company_id: COMPANIES.meridian,
    crm_contact_id: CONTACTS.companyContactLow,
    name: 'Farah LowConfidence',
    title: 'Office Manager',
    role_category: 'other',
    email: 'farah.meridian.qa@example.invalid',
    confidence_score: 10,
    ranking_score: 10,
    status: 'new',
  });

  // --- wizmatch_company_policies -------------------------------------------
  // Root (entire_company) policies — required to define all three axes.
  const rootPolicies: Array<{ id: string; companyId: string; relationshipType: string }> = [
    { id: POLICIES.acmeRoot, companyId: COMPANIES.acme, relationshipType: 'existing_prospect' },
    { id: POLICIES.acmeDuplicateRoot, companyId: COMPANIES.acmeDuplicate, relationshipType: 'new_prospect' },
    { id: POLICIES.northstarRoot, companyId: COMPANIES.northstar, relationshipType: 'new_prospect' },
    { id: POLICIES.northstarBranchRoot, companyId: COMPANIES.northstarBranch, relationshipType: 'new_prospect' },
    { id: POLICIES.meridianRoot, companyId: COMPANIES.meridian, relationshipType: 'new_prospect' },
  ];
  for (const p of rootPolicies) {
    await upsert(client, 'wizmatch_company_policies', {
      id: p.id,
      tenant_id: TENANT_A,
      company_id: p.companyId,
      scope_type: 'entire_company',
      scope_key: 'entire_company',
      outreach_eligibility: 'eligible',
      external_hiring_policy: 'accepts_external_vendors',
      relationship_type: p.relationshipType,
      source: 'human',
      actor_user_id: USERS.approvedAdmin1,
    });
  }

  // Region policy — Northstar, india.
  await upsert(client, 'wizmatch_company_policies', {
    id: POLICIES.northstarRegion,
    tenant_id: TENANT_A,
    company_id: COMPANIES.northstar,
    scope_type: 'region',
    scope_key: 'region:india',
    scope_ref_label: 'india',
    outreach_eligibility: 'needs_review',
    reason_code: 'regional_review',
    reason: 'QA synthetic: india region needs manual review before further outreach.',
    source: 'human',
    actor_user_id: USERS.teamLead,
  });

  // Location policy — Northstar branch office.
  await upsert(client, 'wizmatch_company_policies', {
    id: POLICIES.northstarBranchLocation,
    tenant_id: TENANT_A,
    company_id: COMPANIES.northstarBranch,
    scope_type: 'location',
    scope_key: 'location:Bengaluru-HQ',
    scope_ref_label: 'Bengaluru-HQ',
    relationship_type: 'vendor_partner',
    reason_code: 'location_override',
    reason: 'QA synthetic: Bengaluru-HQ location treated as vendor partner.',
    source: 'human',
    actor_user_id: USERS.teamLead,
  });

  // Specific-signal policy — Meridian, scoped to one job signal.
  await upsert(client, 'wizmatch_company_policies', {
    id: POLICIES.meridianSpecificSignal,
    tenant_id: TENANT_A,
    company_id: COMPANIES.meridian,
    scope_type: 'specific_signal',
    scope_key: `specific_signal:${SIGNALS.meridianSignal}`,
    signal_id: SIGNALS.meridianSignal,
    outreach_eligibility: 'blocked',
    reason_code: 'client_request',
    reason: 'QA synthetic: client asked to pause outreach on this specific signal only.',
    evidence_kind: 'human_text',
    evidence_text: 'QA seed synthetic evidence — client requested pause via call.',
    source: 'human',
    actor_user_id: USERS.approvedAdmin2,
  });

  // Specific-requirement policy — Acme, scoped to one requirement.
  await upsert(client, 'wizmatch_company_policies', {
    id: POLICIES.acmeSpecificRequirement,
    tenant_id: TENANT_A,
    company_id: COMPANIES.acme,
    scope_type: 'specific_requirement',
    scope_key: `specific_requirement:${REQUIREMENTS.acmeRequirement}`,
    requirement_id: REQUIREMENTS.acmeRequirement,
    outreach_eligibility: 'needs_review',
    reason_code: 'compliance_review',
    reason: 'QA synthetic: this requirement needs compliance sign-off before submissions.',
    source: 'human',
    actor_user_id: USERS.approvedAdmin1,
  });

  // --- wizmatch_company_duplicates ------------------------------------------
  await upsert(client, 'wizmatch_company_duplicates', {
    id: DUPLICATE_PAIR,
    tenant_id: TENANT_A,
    company_a_id: COMPANIES.acme, // must be < company_b_id per CHECK constraint
    company_b_id: COMPANIES.acmeDuplicate,
    similarity: '0.9700',
    detection_rule: 'normalised_name',
    resolution: 'pending',
  });

  // --- wizmatch candidates -------------------------------------------------
  const candidateRows: Array<{ id: string; contactId: string; skills: string[]; location: string; experienceYears: number }> = [
    { id: CANDIDATES.candidate1, contactId: CONTACTS.candidateContact1, skills: ['node.js', 'typescript'], location: 'Bengaluru, India', experienceYears: 6 },
    { id: CANDIDATES.candidate2, contactId: CONTACTS.candidateContact2, skills: ['selenium', 'playwright'], location: 'Pune, India', experienceYears: 4 },
    { id: CANDIDATES.candidate3, contactId: CONTACTS.candidateContact3, skills: ['react', 'node.js'], location: 'Remote', experienceYears: 8 },
  ];
  for (const c of candidateRows) {
    await upsert(client, 'wizmatch_candidates', {
      id: c.id,
      tenant_id: TENANT_A,
      contact_id: c.contactId,
      skills: c.skills,
      location: c.location,
      visa_status: 'unknown',
      experience_years: c.experienceYears,
      source: 'manual',
      availability_status: 'available',
    });
  }

  // --- wizmatch_candidate_requirement_matches -------------------------------
  await upsert(client, 'wizmatch_candidate_requirement_matches', {
    id: MATCHES.candidate1VsAcmeReq,
    tenant_id: TENANT_A,
    requirement_id: REQUIREMENTS.acmeRequirement,
    candidate_id: CANDIDATES.candidate1,
    score: 85,
    human_decision: 'shortlisted',
    reviewed_by: USERS.teamLead,
  });
  await upsert(client, 'wizmatch_candidate_requirement_matches', {
    id: MATCHES.candidate2VsAcmeReq,
    tenant_id: TENANT_A,
    requirement_id: REQUIREMENTS.acmeRequirement,
    candidate_id: CANDIDATES.candidate2,
    score: 45,
    human_decision: 'unreviewed',
  });

  // --- wizmatch_submissions --------------------------------------------
  await upsert(client, 'wizmatch_submissions', {
    id: SUBMISSIONS.candidate1ForAcme,
    tenant_id: TENANT_A,
    requirement_id: REQUIREMENTS.acmeRequirement,
    candidate_id: CANDIDATES.candidate1,
    match_id: MATCHES.candidate1VsAcmeReq,
    status: 'sent',
    version: 1,
    prepared_by: USERS.teamLead,
    approved_by: USERS.approvedAdmin1,
    first_sent_at: new Date(),
    last_sent_at: new Date(),
  });

  // --- wizmatch_interview_rounds / participants -----------------------------
  const scheduledAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // +7 days
  await upsert(client, 'wizmatch_interview_rounds', {
    id: INTERVIEW_ROUNDS.round1,
    tenant_id: TENANT_A,
    submission_id: SUBMISSIONS.candidate1ForAcme,
    round_number: 1,
    round_type: 'client',
    status: 'scheduled',
    scheduled_at: scheduledAt,
    created_by: USERS.teamLead,
  });
  await upsert(client, 'wizmatch_interview_participants', {
    id: INTERVIEW_PARTICIPANTS.interviewer,
    tenant_id: TENANT_A,
    interview_round_id: INTERVIEW_ROUNDS.round1,
    user_id: USERS.teamLead,
    name: 'QA Team Lead',
    role: 'interviewer',
  });
  await upsert(client, 'wizmatch_interview_participants', {
    id: INTERVIEW_PARTICIPANTS.clientParticipant,
    tenant_id: TENANT_A,
    interview_round_id: INTERVIEW_ROUNDS.round1,
    name: 'Dana HighConfidence (Synthetic Client)',
    email: 'dana.acme.qa@example.invalid',
    role: 'client_interviewer',
  });

  // --- wizmatch_placements ---------------------------------------------
  await upsert(client, 'wizmatch_placements', {
    id: PLACEMENTS.candidate1AtAcme,
    tenant_id: TENANT_A,
    candidate_id: CANDIDATES.candidate1,
    job_signal_id: SIGNALS.acmeSignal,
    company_id: COMPANIES.acme,
    requirement_id: REQUIREMENTS.acmeRequirement,
    submission_id: SUBMISSIONS.candidate1ForAcme,
    placement_type: 'contract_c2c',
    bill_rate_hourly: 50,
    pay_rate_hourly: 35,
    margin_hourly: 15,
    currency: 'USD',
    status: 'submitted',
  });

  // --- wizmatch_suppression_list (suppression rows) -------------------------
  await upsert(client, 'wizmatch_suppression_list', {
    id: SUPPRESSION_LIST.hardBounce,
    tenant_id: TENANT_A,
    email: 'suppressed.contact.qa@example.invalid',
    reason: 'hard_bounce',
    source_channel: 'email',
  });

  // --- wizmatch_suppression_events (blocked contacts, contact-grain) --------
  await upsert(client, 'wizmatch_suppression_events', {
    id: SUPPRESSION_EVENTS.blockedContactEvent,
    tenant_id: TENANT_A,
    grain: 'contact',
    contact_id: CONTACTS.blockedContact,
    company_id: COMPANIES.acme,
    reason_code: 'do_not_contact',
    source: 'human',
    actor_user_id: USERS.approvedAdmin1,
  });

  // --- tasks -------------------------------------------------------------
  await upsert(client, 'tasks', {
    id: TASKS.policyReviewTask,
    tenant_id: TENANT_A,
    contact_id: CONTACTS.companyContactHigh,
    title: 'QA: review Acme WizMatch policy exception',
    description: 'Synthetic QA task — verify the specific-requirement policy override for Acme.',
    assigned_to: 'qa-team-lead@example.invalid',
    status: 'open',
  });

  // --- pipelines + deals (pipeline records) ---------------------------------
  await upsert(client, 'pipelines', {
    id: PIPELINES.wizmatchQaPipeline,
    tenant_id: TENANT_A,
    name: 'Wizmatch QA Pipeline',
    slug: 'wizmatch-qa-pipeline',
    stages: JSON.stringify([{ key: 'sourced' }, { key: 'submitted' }, { key: 'placed' }]),
  });
  await upsert(client, 'deals', {
    id: DEALS.acmeContractDeal,
    tenant_id: TENANT_A,
    contact_id: CONTACTS.companyContactHigh,
    pipeline_id: PIPELINES.wizmatchQaPipeline,
    title: 'Acme WizMatch Test Company — Node Engineer Contract',
    stage: 'submitted',
    value: '5000.00',
  });
}

// ---------------------------------------------------------------------------
// RESET — removes only the synthetic rows this script owns, scoped to the two
// synthetic tenant ids. Deletes in FK-safe (child-first) order, then the
// tenant rows themselves last.
// ---------------------------------------------------------------------------
async function reset(client: PoolClient): Promise<void> {
  // Child-first (FK-safe) order. wizmatch_placements references submissions,
  // requirements, candidates, job_signals AND companies, so it must be
  // deleted before all five of those parents.
  const tenantScoped = [
    'wizmatch_interview_participants',
    'wizmatch_interview_rounds',
    'wizmatch_placements',
    'wizmatch_submission_events',
    'wizmatch_submission_recipients',
    'wizmatch_submissions',
    'wizmatch_candidate_requirement_matches',
    'wizmatch_match_snapshots',
    'wizmatch_company_policy_events',
    'wizmatch_company_policies',
    'wizmatch_company_duplicates',
    'wizmatch_suppression_events',
    'wizmatch_suppression_list',
    'wizmatch_contact_candidates',
    'wizmatch_requirements',
    'wizmatch_job_signals',
    'wizmatch_candidates',
    'wizmatch_companies',
    'tasks',
    'deals',
    'pipelines',
    'contact_channels',
    'contacts',
    'users',
  ];
  for (const table of tenantScoped) {
    await client.query(`DELETE FROM "${table}" WHERE tenant_id = ANY($1::uuid[])`, [SYNTHETIC_TENANT_IDS]);
  }
  await client.query(`DELETE FROM "tenants" WHERE id = ANY($1::uuid[])`, [SYNTHETIC_TENANT_IDS]);
}

async function main(): Promise<void> {
  assertSafeTarget();
  const doReset = process.argv.includes('--reset');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (doReset) {
      console.log('[qa-seed] Resetting synthetic fixtures...');
      await reset(client);
      console.log('[qa-seed] Reset complete.');
    } else {
      console.log('[qa-seed] Seeding synthetic fixtures...');
      await seed(client);
      console.log('[qa-seed] Seed complete.');
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[qa-seed] Failed, rolled back:', error);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();
