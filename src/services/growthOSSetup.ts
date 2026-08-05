import { pool } from '../db/index';
import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// ensureGrowthOSTables — bootstraps all Growth OS tables on startup
// ---------------------------------------------------------------------------

export async function ensureGrowthOSTables(): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS growth_os_clients (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_name TEXT NOT NULL UNIQUE,
        ad_account_id TEXT NOT NULL,
        founder_whatsapp TEXT,
        founder_name TEXT,
        monthly_ad_spend NUMERIC,
        target_roas NUMERIC DEFAULT 2.5,
        competitors JSONB,
        industry TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS brand_health_scores (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_name TEXT NOT NULL,
        ad_account_id TEXT NOT NULL,
        score_date DATE NOT NULL,
        overall_score INTEGER,
        ads_score INTEGER,
        email_score INTEGER,
        whatsapp_score INTEGER,
        seo_score INTEGER,
        retention_score INTEGER,
        ads_detail JSONB,
        email_detail JSONB,
        whatsapp_detail JSONB,
        seo_detail JSONB,
        retention_detail JSONB,
        previous_score INTEGER,
        score_change INTEGER,
        alerts JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS money_on_table (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_name TEXT NOT NULL,
        ad_account_id TEXT NOT NULL,
        week_start DATE NOT NULL,
        cart_abandonment_opportunity NUMERIC,
        winback_opportunity NUMERIC,
        whatsapp_optin_opportunity NUMERIC,
        email_sequence_opportunity NUMERIC,
        upsell_opportunity NUMERIC,
        total_opportunity NUMERIC,
        detail JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS creative_intelligence (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        ad_account_id TEXT NOT NULL,
        ad_id TEXT NOT NULL UNIQUE,
        ad_name TEXT NOT NULL,
        campaign_name TEXT,
        adset_name TEXT,
        first_seen DATE,
        latest_roas NUMERIC,
        peak_roas NUMERIC,
        latest_ctr NUMERIC,
        peak_ctr NUMERIC,
        latest_frequency NUMERIC,
        days_running INTEGER,
        fatigue_status TEXT DEFAULT 'healthy',
        fatigue_detected_at TIMESTAMP,
        alert_sent BOOLEAN DEFAULT FALSE,
        creative_brief TEXT,
        spend_to_date NUMERIC,
        raw_metrics JSONB,
        updated_at TIMESTAMP DEFAULT NOW(),
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS competitor_pulse (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_name TEXT NOT NULL,
        competitor_name TEXT,
        competitor_page_id TEXT,
        week_start DATE NOT NULL,
        ads_found INTEGER,
        trending_formats JSONB,
        new_offers JSONB,
        insights TEXT,
        recommendations JSONB,
        raw_data JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS copilot_conversations (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_name TEXT NOT NULL,
        wa_phone TEXT NOT NULL,
        message TEXT NOT NULL,
        response TEXT NOT NULL,
        tokens_used INTEGER,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // -------------------------------------------------------------------
    // Tenant isolation fix (security audit, 2026-08-03): none of the 6
    // tables above ever had a tenant_id column — any authenticated user of
    // ANY tenant could read/write every other tenant's Growth OS data via
    // src/routes/growthOS.ts, and calculateMoneyOnTable() pooled every
    // tenant's payments/contacts/sequences into one number.
    //
    // Nullable for now (NOT a DB NOT NULL constraint yet) — same posture as
    // migration 0035 for the SEO tables: add nullable, backfill, tighten
    // later once verified. "Must have a tenant" is enforced at the
    // application layer instead: every INSERT into these 6 tables (routes/
    // growthOS.ts, opportunityService.ts, brandHealthService.ts,
    // creativeIntelligenceService.ts, competitorService.ts,
    // copilotService.ts) now sets tenant_id explicitly.
    //
    // Backfill assumption — NEEDS HUMAN VERIFICATION BEFORE MERGE: every
    // pre-existing row is assumed to belong to the growth-escalators
    // tenant. That's the only tenant this module has ever been wired to as
    // far as this fix could verify (single hardcoded WhatsApp number, no
    // per-tenant routing anywhere in this module) — but absence of evidence
    // that other tenants' data ever flowed through here is not proof
    // it didn't.
    await pool.query(`ALTER TABLE growth_os_clients ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id)`);
    await pool.query(`ALTER TABLE brand_health_scores ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id)`);
    await pool.query(`ALTER TABLE money_on_table ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id)`);
    await pool.query(`ALTER TABLE creative_intelligence ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id)`);
    await pool.query(`ALTER TABLE competitor_pulse ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id)`);
    await pool.query(`ALTER TABLE copilot_conversations ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id)`);

    const defaultTenantResult = await pool.query(`SELECT id FROM tenants WHERE slug = 'growth-escalators' LIMIT 1`);
    const defaultTenantId = (defaultTenantResult.rows[0] as { id?: string } | undefined)?.id ?? null;

    // Seed default clients — stamped with the default tenant at insert time
    // so freshly-seeded rows never rely on the backfill pass below.
    await pool.query(`
      INSERT INTO growth_os_clients (client_name, ad_account_id, founder_whatsapp, founder_name, monthly_ad_spend, target_roas, industry, competitors, tenant_id)
      VALUES
        ('Paraiso', 'act_689363376592426', '917733888883', 'Jatin', 150000, 3.0, 'D2C Fashion / Lifestyle', '["Style Jaipur","Fab India"]', $1),
        ('GE Agency', 'act_323237510625803', '917733888883', 'Jatin', 50000, 3.0, 'marketing', '[]', $1)
      ON CONFLICT (client_name) DO NOTHING;
    `, [defaultTenantId]);

    if (defaultTenantId) {
      await pool.query(`UPDATE growth_os_clients SET tenant_id = $1 WHERE tenant_id IS NULL`, [defaultTenantId]);
      await pool.query(`UPDATE brand_health_scores SET tenant_id = $1 WHERE tenant_id IS NULL`, [defaultTenantId]);
      await pool.query(`UPDATE money_on_table SET tenant_id = $1 WHERE tenant_id IS NULL`, [defaultTenantId]);
      await pool.query(`UPDATE creative_intelligence SET tenant_id = $1 WHERE tenant_id IS NULL`, [defaultTenantId]);
      await pool.query(`UPDATE competitor_pulse SET tenant_id = $1 WHERE tenant_id IS NULL`, [defaultTenantId]);
      await pool.query(`UPDATE copilot_conversations SET tenant_id = $1 WHERE tenant_id IS NULL`, [defaultTenantId]);
    } else {
      logger.warn('[growth-os] growth-escalators tenant not found — skipping tenant_id backfill');
    }

    // Ensure Paraiso has latest config (ON CONFLICT above skips existing rows)
    await pool.query(`
      UPDATE growth_os_clients
      SET target_roas = 3.0,
          industry = 'D2C Fashion / Lifestyle',
          competitors = '["Style Jaipur","Fab India"]'::jsonb
      WHERE client_name = 'Paraiso'
        AND (target_roas != 3.0 OR industry != 'D2C Fashion / Lifestyle');
    `);

    logger.info('[growth-os] Tables bootstrapped successfully');
  } catch (e) {
    logger.error('[growth-os] Table bootstrap failed:', e);
  }
}

// ---------------------------------------------------------------------------
// GrowthOSClient type
// ---------------------------------------------------------------------------
export interface GrowthOSClient {
  id: string;
  client_name: string;
  ad_account_id: string;
  founder_whatsapp: string | null;
  founder_name: string | null;
  monthly_ad_spend: number;
  target_roas: number;
  competitors: string[];
  industry: string;
  is_active: boolean;
  tenant_id: string | null;
}

// `tenantId` is OPTIONAL BY DESIGN, same posture as jobQueue.ts's
// JobTenantScope: system-internal callers (worker.ts's scheduled crons) sweep
// every active client across every tenant, unscoped, on purpose. Only the
// HTTP layer (routes/growthOS.ts, mounted with requireAuth) passes a scope,
// derived from req.user.tenantId — that's what closes the aggregation-pooling
// risk for admin-triggered manual runs (POST /health/generate, etc).
export async function getActiveGrowthOSClients(tenantId?: string): Promise<GrowthOSClient[]> {
  try {
    const result = tenantId
      ? await pool.query(`SELECT * FROM growth_os_clients WHERE is_active = true AND tenant_id = $1 ORDER BY client_name`, [tenantId])
      : await pool.query(`SELECT * FROM growth_os_clients WHERE is_active = true ORDER BY client_name`);
    return (result.rows as Array<Record<string, unknown>>).map(r => ({
      id: r.id as string,
      client_name: r.client_name as string,
      ad_account_id: r.ad_account_id as string,
      founder_whatsapp: r.founder_whatsapp as string | null,
      founder_name: r.founder_name as string | null,
      monthly_ad_spend: Number(r.monthly_ad_spend ?? 0),
      target_roas: Number(r.target_roas ?? 2.5),
      competitors: (r.competitors as string[] | null) ?? [],
      industry: (r.industry as string) ?? 'general',
      is_active: r.is_active as boolean,
      tenant_id: (r.tenant_id as string | null) ?? null,
    }));
  } catch (e) {
    logger.error('[growth-os] getActiveGrowthOSClients failed:', e);
    return [];
  }
}
