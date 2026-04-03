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

    // Seed default clients
    await pool.query(`
      INSERT INTO growth_os_clients (client_name, ad_account_id, founder_whatsapp, founder_name, monthly_ad_spend, target_roas, industry, competitors)
      VALUES
        ('Paraiso', 'act_689363376592426', '917733888883', 'Jatin', 150000, 3.0, 'D2C Fashion / Lifestyle', '["Style Jaipur","Fab India"]'),
        ('GE Agency', 'act_323237510625803', '917733888883', 'Jatin', 50000, 3.0, 'marketing', '[]')
      ON CONFLICT (client_name) DO NOTHING;
    `);

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
}

export async function getActiveGrowthOSClients(): Promise<GrowthOSClient[]> {
  try {
    const result = await pool.query(`SELECT * FROM growth_os_clients WHERE is_active = true ORDER BY client_name`);
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
    }));
  } catch (e) {
    logger.error('[growth-os] getActiveGrowthOSClients failed:', e);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Shared WhatsApp send utility
// ---------------------------------------------------------------------------
export async function sendWhatsAppMessage(to: string, text: string): Promise<boolean> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID ?? process.env.META_PHONE_NUMBER_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;

  if (!phoneNumberId || !accessToken) {
    logger.warn('[growth-os] WhatsApp not configured — WHATSAPP_PHONE_NUMBER_ID or META_ACCESS_TOKEN missing');
    return false;
  }

  const phone = to.replace(/\D/g, '');

  try {
    const res = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: text },
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      logger.error(`[growth-os] WhatsApp send failed ${res.status}:`, err.slice(0, 200));
      return false;
    }
    logger.info(`[growth-os] WhatsApp sent to ${phone}`);
    return true;
  } catch (e) {
    logger.error('[growth-os] WhatsApp send error:', e instanceof Error ? e.message : String(e));
    return false;
  }
}
