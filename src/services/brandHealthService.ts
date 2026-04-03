import { pool } from '../db/index';
import logger from '../utils/logger';
import { fetchWithRetry } from '../utils/fetchWithRetry';
import { type GrowthOSClient, sendWhatsAppMessage } from './growthOSSetup';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrandHealthAlert {
  type: string;
  severity: 'high' | 'medium' | 'low';
  message: string;
}

export interface BrandHealthScore {
  client_name: string;
  ad_account_id: string;
  score_date: string;
  overall_score: number;
  ads_score: number;
  email_score: number;
  whatsapp_score: number;
  seo_score: number;
  retention_score: number;
  ads_detail: Record<string, unknown>;
  email_detail: Record<string, unknown>;
  whatsapp_detail: Record<string, unknown>;
  seo_detail: Record<string, unknown>;
  retention_detail: Record<string, unknown>;
  previous_score: number | null;
  score_change: number;
  alerts: BrandHealthAlert[];
}

// ---------------------------------------------------------------------------
// Main calculator
// ---------------------------------------------------------------------------

export async function calculateBrandHealth(client: GrowthOSClient): Promise<BrandHealthScore> {
  logger.info(`[brand-health] Calculating for ${client.client_name}...`);
  const today = new Date().toISOString().slice(0, 10);

  // Run all sub-scores in parallel
  const [adsResult, seoResult, whatsappResult, retentionResult, previousRow] = await Promise.all([
    calcAdsScore(client),
    calcSeoScore(client.client_name),
    calcWhatsappScore(),
    calcRetentionScore(),
    getPreviousScore(client.client_name),
  ]);

  // Email score — Brevo integration pending
  const email_score = 70;
  const email_detail = { note: 'Email analytics integration pending — Brevo not yet connected', score: 70 };

  const overall_score = Math.round(
    adsResult.score * 0.40 +
    seoResult.score * 0.15 +
    whatsappResult.score * 0.20 +
    email_score * 0.10 +
    retentionResult.score * 0.15
  );

  const previous_score = previousRow;
  const score_change = previous_score !== null ? overall_score - previous_score : 0;

  // Build alerts
  const alerts: BrandHealthAlert[] = [];
  if (adsResult.score < 50) {
    alerts.push({ type: 'ads', severity: 'high', message: 'ROAS below target — campaigns need attention' });
  }
  if (score_change < -10) {
    alerts.push({ type: 'overall', severity: 'high', message: 'Brand health dropped significantly overnight' });
  }
  if (whatsappResult.score < 40) {
    alerts.push({ type: 'whatsapp', severity: 'medium', message: 'WhatsApp sequences not running' });
  }
  if (seoResult.score < 40) {
    alerts.push({ type: 'seo', severity: 'medium', message: 'SEO data stale or workflows not running' });
  }

  const scoreRecord: BrandHealthScore = {
    client_name: client.client_name,
    ad_account_id: client.ad_account_id,
    score_date: today,
    overall_score,
    ads_score: adsResult.score,
    email_score,
    whatsapp_score: whatsappResult.score,
    seo_score: seoResult.score,
    retention_score: retentionResult.score,
    ads_detail: adsResult.detail,
    email_detail,
    whatsapp_detail: whatsappResult.detail,
    seo_detail: seoResult.detail,
    retention_detail: retentionResult.detail,
    previous_score,
    score_change,
    alerts,
  };

  await saveHealthScore(scoreRecord);
  logger.info(`[brand-health] ${client.client_name} score: ${overall_score}/100`);
  return scoreRecord;
}

// ---------------------------------------------------------------------------
// Sub-score calculators
// ---------------------------------------------------------------------------

async function calcAdsScore(client: GrowthOSClient): Promise<{ score: number; detail: Record<string, unknown> }> {
  try {
    const token = process.env.META_ADS_TOKEN;
    if (!token) return { score: 50, detail: { note: 'META_ADS_TOKEN not set' } };

    const url = `https://graph.facebook.com/v19.0/${client.ad_account_id}/campaigns?fields=name,status,insights.date_preset(last_7d){spend,actions,impressions,clicks,ctr,cpc}&access_token=${token}&limit=20`;
    const res = await fetchWithRetry(url);
    if (!res.ok) return { score: 50, detail: { error: `Meta API ${res.status}` } };

    const data = await res.json() as { data?: Array<Record<string, unknown>> };
    const campaigns = (data.data ?? []).filter((c: Record<string, unknown>) => c.status === 'ACTIVE');

    if (campaigns.length === 0) return { score: 30, detail: { note: 'No active campaigns' } };

    let totalSpend = 0, totalClicks = 0, totalImpressions = 0, totalPurchaseValue = 0;

    for (const camp of campaigns) {
      const ins = (camp.insights as Record<string, unknown> | undefined);
      const rows = (ins?.data as Array<Record<string, unknown>> | undefined) ?? [];
      for (const row of rows) {
        totalSpend += parseFloat(String(row.spend ?? 0));
        totalClicks += parseFloat(String(row.clicks ?? 0));
        totalImpressions += parseFloat(String(row.impressions ?? 0));
        const actions = (row.actions as Array<{ action_type: string; value: string }> | undefined) ?? [];
        for (const a of actions) {
          if (a.action_type === 'purchase') totalPurchaseValue += parseFloat(a.value ?? '0');
          if (a.action_type === 'omni_purchase') totalPurchaseValue += parseFloat(a.value ?? '0');
        }
      }
    }

    const roas = totalSpend > 0 ? totalPurchaseValue / totalSpend : 0;
    const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    const target = client.target_roas;

    let roas_score: number;
    if (roas >= target) roas_score = 100;
    else if (roas >= target * 0.8) roas_score = 70;
    else if (roas >= target * 0.6) roas_score = 40;
    else roas_score = 10;

    let ctr_score: number;
    if (ctr >= 2) ctr_score = 100;
    else if (ctr >= 1.5) ctr_score = 70;
    else if (ctr >= 1) ctr_score = 40;
    else ctr_score = 20;

    const spend_efficiency = totalSpend > 0 ? 70 : 30; // basic check

    const score = Math.round(roas_score * 0.5 + ctr_score * 0.3 + spend_efficiency * 0.2);

    return {
      score: Math.min(100, Math.max(0, score)),
      detail: { roas: roas.toFixed(2), ctr: ctr.toFixed(2), spend: totalSpend.toFixed(0), active_campaigns: campaigns.length, roas_score, ctr_score },
    };
  } catch (e) {
    logger.error('[brand-health] ads score failed:', e instanceof Error ? e.message : String(e));
    return { score: 50, detail: { error: 'Ads data fetch failed', note: String(e) } };
  }
}

async function calcSeoScore(clientName: string): Promise<{ score: number; detail: Record<string, unknown> }> {
  try {
    const [weeklyRes, rankRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM seo_weekly_metrics`).catch(() => ({ rows: [{ total: '0' }] })),
      pool.query(`SELECT COUNT(*) AS improved, SUM(CASE WHEN (previous_position - current_position) > 0 THEN 1 ELSE 0 END) AS gains FROM keyword_rankings WHERE recorded_date >= CURRENT_DATE - 7`).catch(() => ({ rows: [{ improved: '0', gains: '0' }] })),
    ]);

    const weeklyTotal = Number((weeklyRes.rows[0] as { total: string }).total ?? 0);
    const improved = Number((rankRes.rows[0] as { improved: string; gains: string })?.improved ?? 0);
    const gains = Number((rankRes.rows[0] as { improved: string; gains: string })?.gains ?? 0);

    if (weeklyTotal === 0 && improved === 0) {
      return { score: 50, detail: { note: `No SEO data for ${clientName} — neutral score`, weekly_records: 0 } };
    }

    const base = weeklyTotal > 0 ? 60 : 40;
    const gainBonus = Math.min(20, gains * 2);
    const score = Math.min(100, base + gainBonus);

    return { score, detail: { weekly_records: weeklyTotal, keywords_tracked: improved, position_gains: gains } };
  } catch (e) {
    return { score: 50, detail: { note: 'SEO data unavailable', error: String(e) } };
  }
}

async function calcWhatsappScore(): Promise<{ score: number; detail: Record<string, unknown> }> {
  try {
    const [msgRes, seqRes, errRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS cnt FROM messages WHERE direction = 'outbound' AND sent_at >= NOW() - INTERVAL '7 days'`).catch(() => ({ rows: [{ cnt: '0' }] })),
      pool.query(`SELECT COUNT(*) AS cnt FROM sequence_enrolments WHERE status = 'active'`).catch(() => ({ rows: [{ cnt: '0' }] })),
      pool.query(`SELECT COUNT(*) AS cnt FROM jobs WHERE status = 'failed' AND created_at >= NOW() - INTERVAL '24 hours'`).catch(() => ({ rows: [{ cnt: '0' }] })),
    ]);

    const msgsSent = Number((msgRes.rows[0] as { cnt: string }).cnt ?? 0);
    const activeSeqs = Number((seqRes.rows[0] as { cnt: string }).cnt ?? 0);
    const errors = Number((errRes.rows[0] as { cnt: string }).cnt ?? 0);

    let score: number;
    if (errors > 5) score = 30;
    else if (activeSeqs > 0 && msgsSent > 0) score = 85;
    else if (activeSeqs > 0) score = 65;
    else if (msgsSent > 0) score = 55;
    else score = 40;

    return { score, detail: { messages_sent_7d: msgsSent, active_sequences: activeSeqs, job_errors_24h: errors } };
  } catch (e) {
    return { score: 50, detail: { note: 'WhatsApp data unavailable', error: String(e) } };
  }
}

async function calcRetentionScore(): Promise<{ score: number; detail: Record<string, unknown> }> {
  try {
    const [thisWeekRes, lastWeekRes, convRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS cnt FROM contacts WHERE created_at >= NOW() - INTERVAL '7 days'`).catch(() => ({ rows: [{ cnt: '0' }] })),
      pool.query(`SELECT COUNT(*) AS cnt FROM contacts WHERE created_at >= NOW() - INTERVAL '14 days' AND created_at < NOW() - INTERVAL '7 days'`).catch(() => ({ rows: [{ cnt: '0' }] })),
      pool.query(`SELECT COUNT(*) AS total, SUM(CASE WHEN stage = 'won' THEN 1 ELSE 0 END) AS won FROM deals`).catch(() => ({ rows: [{ total: '0', won: '0' }] })),
    ]);

    const thisWeek = Number((thisWeekRes.rows[0] as { cnt: string }).cnt ?? 0);
    const lastWeek = Number((lastWeekRes.rows[0] as { cnt: string }).cnt ?? 0);
    const totalDeals = Number((convRes.rows[0] as { total: string; won: string }).total ?? 0);
    const wonDeals = Number((convRes.rows[0] as { total: string; won: string }).won ?? 0);

    const growthRate = lastWeek > 0 ? ((thisWeek - lastWeek) / lastWeek) * 100 : 0;
    const convRate = totalDeals > 0 ? (wonDeals / totalDeals) * 100 : 0;

    const growthScore = growthRate >= 10 ? 100 : growthRate >= 0 ? 70 : 40;
    const convScore = convRate >= 20 ? 100 : convRate >= 10 ? 70 : convRate > 0 ? 50 : 30;
    const score = Math.round(growthScore * 0.6 + convScore * 0.4);

    return { score: Math.min(100, Math.max(0, score)), detail: { contacts_this_week: thisWeek, contacts_last_week: lastWeek, growth_rate_pct: growthRate.toFixed(1), conversion_rate_pct: convRate.toFixed(1) } };
  } catch (e) {
    return { score: 50, detail: { note: 'Retention data unavailable', error: String(e) } };
  }
}

async function getPreviousScore(clientName: string): Promise<number | null> {
  try {
    const r = await pool.query(
      `SELECT overall_score FROM brand_health_scores WHERE client_name = $1 AND score_date < CURRENT_DATE ORDER BY score_date DESC LIMIT 1`,
      [clientName]
    );
    if (r.rows[0]) return Number((r.rows[0] as { overall_score: number }).overall_score);
    return null;
  } catch {
    return null;
  }
}

async function saveHealthScore(score: BrandHealthScore): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO brand_health_scores (client_name, ad_account_id, score_date, overall_score, ads_score, email_score, whatsapp_score, seo_score, retention_score, ads_detail, email_detail, whatsapp_detail, seo_detail, retention_detail, previous_score, score_change, alerts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT DO NOTHING`,
      [
        score.client_name, score.ad_account_id, score.score_date, score.overall_score,
        score.ads_score, score.email_score, score.whatsapp_score, score.seo_score, score.retention_score,
        JSON.stringify(score.ads_detail), JSON.stringify(score.email_detail),
        JSON.stringify(score.whatsapp_detail), JSON.stringify(score.seo_detail),
        JSON.stringify(score.retention_detail),
        score.previous_score, score.score_change, JSON.stringify(score.alerts),
      ]
    );
  } catch (e) {
    logger.error('[brand-health] save failed:', e);
  }
}

// ---------------------------------------------------------------------------
// WhatsApp delivery
// ---------------------------------------------------------------------------

export async function sendHealthScoreWhatsApp(score: BrandHealthScore, founderWA: string): Promise<void> {
  if (!founderWA) return;

  const s = score.overall_score;
  const emoji = s >= 80 ? '🚀' : s >= 60 ? '✅' : s >= 40 ? '⚠️' : '🔴';

  let changeStr = '';
  if (score.score_change > 0) changeStr = `↑ ${score.score_change} from yesterday\n`;
  else if (score.score_change < 0) changeStr = `↓ ${Math.abs(score.score_change)} from yesterday\n`;

  let alertSection = '';
  if (score.alerts.length > 0) {
    alertSection = '\n⚠️ *Needs Attention:*\n' + score.alerts.map(a => `• ${a.message}`).join('\n');
  } else {
    alertSection = '\n✅ All systems healthy today';
  }

  const date = new Date().toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

  const msg =
    `🏥 *Brand Health — ${score.client_name}*\n` +
    `${date}\n\n` +
    `Overall: *${s}/100* ${emoji}\n` +
    changeStr +
    `\n📊 Ads: ${score.ads_score}/100\n` +
    `🔍 SEO: ${score.seo_score}/100\n` +
    `💬 WhatsApp: ${score.whatsapp_score}/100\n` +
    `📧 Email: ${score.email_score}/100\n` +
    `🔄 Retention: ${score.retention_score}/100` +
    alertSection;

  await sendWhatsAppMessage(founderWA, msg);
}
