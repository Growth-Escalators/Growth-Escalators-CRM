import { pool } from '../db/index';
import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Bootstrap — creates outreach_leads table if it doesn't exist
// Called at server startup. Safe to call multiple times.
// ---------------------------------------------------------------------------
export async function ensureOutreachLeadsTable(): Promise<void> {
  // Create table if it doesn't exist (minimal schema — matches pre-existing prod table)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS outreach_leads (
      id              SERIAL PRIMARY KEY,
      company         VARCHAR(300) NOT NULL,
      first_name      VARCHAR(200),
      email           VARCHAR(300),
      icebreaker      TEXT,
      status          VARCHAR(50)  NOT NULL DEFAULT 'New',
      reply_category  VARCHAR(50),
      notes           TEXT,
      date_added      DATE         NOT NULL DEFAULT CURRENT_DATE,
      created_at      TIMESTAMP    NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMP    NOT NULL DEFAULT NOW()
    )
  `);

  // Add discovery-enrichment columns if they don't exist yet (idempotent migrations)
  const alterStmts = [
    `ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS phone        VARCHAR(100)`,
    `ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS website_url  TEXT`,
    `ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS address      TEXT`,
    `ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS country      VARCHAR(100)`,
    `ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS fit_score    INTEGER DEFAULT 0`,
    `ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS source       VARCHAR(100) DEFAULT 'google_places'`,
    `ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS source_detail TEXT`,
    `ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS assigned_to  VARCHAR(100)`,
    `ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS last_name    VARCHAR(200)`,
    `ALTER TABLE outreach_leads ADD COLUMN IF NOT EXISTS enriched_at  TIMESTAMP`,
  ];
  for (const stmt of alterStmts) {
    await pool.query(stmt);
  }

  await pool.query(`
    CREATE INDEX IF NOT EXISTS outreach_leads_status_idx     ON outreach_leads(status);
    CREATE INDEX IF NOT EXISTS outreach_leads_email_idx      ON outreach_leads(email);
    CREATE INDEX IF NOT EXISTS outreach_leads_created_at_idx ON outreach_leads(created_at);
  `);
  logger.info('[outreach-leads] outreach_leads table ready');

  // Create outreach_errors table for WF-01 error logging
  await pool.query(`
    CREATE TABLE IF NOT EXISTS outreach_errors (
      id              SERIAL PRIMARY KEY,
      lead_id         INTEGER,
      workflow        TEXT NOT NULL,
      error_type      VARCHAR(50) DEFAULT 'Unknown',
      error_message   TEXT NOT NULL,
      retry_count     INTEGER DEFAULT 0,
      resolved        BOOLEAN DEFAULT FALSE,
      created_at      TIMESTAMP DEFAULT NOW()
    )
  `);
  logger.info('[outreach-leads] outreach_errors table ready');
}

// ---------------------------------------------------------------------------
// Insert a single lead into outreach_leads.
// Skips if a row with the same company name already exists (case-insensitive).
// Returns { inserted: true } or { inserted: false, reason: 'duplicate' }
// ---------------------------------------------------------------------------
export async function insertOutreachLead(lead: {
  company: string;
  firstName?: string | null;
  phone?: string | null;
  websiteUrl?: string | null;
  address?: string | null;
  country?: string | null;
  fitScore?: number;
  sourceDetail?: string | null;
}): Promise<{ inserted: boolean; id?: number; reason?: string }> {
  // Deduplicate by company name
  const existing = await pool.query(
    `SELECT id FROM outreach_leads WHERE LOWER(company) = LOWER($1) LIMIT 1`,
    [lead.company],
  );
  if (existing.rows.length > 0) {
    return { inserted: false, reason: 'duplicate' };
  }

  const result = await pool.query(
    `INSERT INTO outreach_leads
       (company, first_name, phone, website_url, address, country, fit_score, source, source_detail, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'google_places', $8, 'New')
     RETURNING id`,
    [
      lead.company,
      lead.firstName ?? null,
      lead.phone ?? null,
      lead.websiteUrl ?? null,
      lead.address ?? null,
      lead.country ?? null,
      lead.fitScore ?? 0,
      lead.sourceDetail ?? null,
    ],
  );

  const id = result.rows[0]?.id as number | undefined;
  logger.info({ id, company: lead.company }, '[outreach-leads] inserted lead');
  return { inserted: true, id };
}
