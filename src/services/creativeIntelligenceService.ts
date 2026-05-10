import { pool } from '../db/index';
import logger from '../utils/logger';
import { sendSlackMessage } from './slackService';
import { SLACK_PERF_MARKETING_CHANNEL, SLACK_SAKCHAM } from '../config/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AdRecord {
  id: string;
  name: string;
  campaign_name?: string;
  adset_name?: string;
}

interface AdInsights {
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  frequency: number;
  roas: number;
}

// ---------------------------------------------------------------------------
// Schema migration — add creative_content & creative_tags columns
// ---------------------------------------------------------------------------
export async function ensureCreativeIntelligenceColumns(): Promise<void> {
  await pool.query(`ALTER TABLE creative_intelligence ADD COLUMN IF NOT EXISTS creative_content JSONB`).catch(() => {});
  await pool.query(`ALTER TABLE creative_intelligence ADD COLUMN IF NOT EXISTS creative_tags JSONB`).catch(() => {});
}

// ---------------------------------------------------------------------------
// Fetch creative content from Meta Graph API
// ---------------------------------------------------------------------------
async function fetchCreativeContent(adId: string, token: string): Promise<Record<string, unknown> | null> {
  try {
    const url = `https://graph.facebook.com/v19.0/${adId}?fields=creative{thumbnail_url,title,body,effective_object_story_id,object_story_spec,link_url}&access_token=${token}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return null;
    const data = await resp.json() as Record<string, unknown>;
    const creative = (data.creative ?? {}) as Record<string, unknown>;
    const objectStorySpec = (creative.object_story_spec ?? {}) as Record<string, unknown>;
    const storySpec = (objectStorySpec.link_data ?? objectStorySpec.video_data ?? {}) as Record<string, unknown>;
    return {
      headline: storySpec.name || creative.title || data.name || '',
      body: storySpec.message || creative.body || '',
      description: storySpec.description || '',
      thumbnail_url: creative.thumbnail_url || '',
      link_url: storySpec.link || creative.link_url || '',
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Analyze creative with Claude Haiku for tagging
// ---------------------------------------------------------------------------
async function analyzeCreativeWithAI(content: Record<string, unknown>): Promise<Record<string, string> | null> {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!ANTHROPIC_KEY || (!content.headline && !content.body)) return null;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `Analyze this ad creative and categorize it. Return ONLY JSON.

Headline: "${content.headline}"
Body: "${content.body}"
Description: "${content.description}"

{
  "hook": one of "problem", "solution", "curiosity", "social-proof", "urgency", "offer",
  "visual": one of "product-shot", "lifestyle", "ugc", "testimonial", "graphic", "video",
  "angle": one of "feature", "benefit", "emotion", "authority", "scarcity", "comparison",
  "cta": one of "weak", "medium", "strong"
}`,
        }],
      }),
    });

    if (!resp.ok) return null;
    const data = await resp.json() as { content?: Array<{ text: string }> };
    const text = data.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main tracker
// ---------------------------------------------------------------------------

export async function trackCreativePerformance(adAccountId: string): Promise<void> {
  logger.info(`[creative] Tracking creatives for ${adAccountId}...`);
  const token = process.env.META_ADS_TOKEN;
  if (!token) {
    logger.warn('[creative] META_ADS_TOKEN not set — skipping');
    return;
  }

  try {
    // Fetch active ads
    const adsUrl = `https://graph.facebook.com/v19.0/${adAccountId}/ads?fields=id,name,status,campaign{name},adset{name}&filtering=[{"field":"effective_status","operator":"IN","value":["ACTIVE"]}]&access_token=${token}&limit=50`;
    const adsRes = await fetch(adsUrl, { signal: AbortSignal.timeout(10000) });
    if (!adsRes.ok) {
      logger.error(`[creative] ads fetch failed ${adsRes.status}`);
      return;
    }
    const adsData = await adsRes.json() as { data?: Array<Record<string, unknown>> };
    const ads = adsData.data ?? [];

    logger.info(`[creative] Found ${ads.length} active ads for ${adAccountId}`);

    for (const ad of ads) {
      try {
        await processAd(ad, adAccountId, token);
        await new Promise(r => setTimeout(r, 300)); // Rate limit buffer
      } catch (e) {
        logger.error(`[creative] ad ${ad.id} processing failed:`, e instanceof Error ? e.message : String(e));
      }
    }
  } catch (e) {
    logger.error('[creative] trackCreativePerformance failed:', e instanceof Error ? e.message : String(e));
  }
}

async function processAd(ad: Record<string, unknown>, adAccountId: string, token: string): Promise<void> {
  const adId = String(ad.id);
  const adName = String(ad.name ?? 'Unknown Ad');
  const campaignName = String((ad.campaign as Record<string, unknown> | undefined)?.name ?? 'Unknown Campaign');
  const adsetName = String((ad.adset as Record<string, unknown> | undefined)?.name ?? '');

  // Fetch 7-day insights
  const insUrl = `https://graph.facebook.com/v19.0/${adId}/insights?fields=spend,impressions,clicks,ctr,cpc,actions,frequency&date_preset=last_7d&access_token=${token}`;
  const insRes = await fetch(insUrl, { signal: AbortSignal.timeout(10000) });
  if (!insRes.ok) return;

  const insData = await insRes.json() as { data?: Array<Record<string, unknown>> };
  const insRow = (insData.data ?? [])[0];
  if (!insRow) return;

  const actions = (insRow.actions as Array<{ action_type: string; value: string }> | undefined) ?? [];
  const purchaseValue = actions
    .filter(a => a.action_type === 'purchase' || a.action_type === 'omni_purchase')
    .reduce((s, a) => s + parseFloat(a.value ?? '0'), 0);
  const spend = parseFloat(String(insRow.spend ?? 0));

  const insights: AdInsights = {
    spend,
    impressions: parseFloat(String(insRow.impressions ?? 0)),
    clicks: parseFloat(String(insRow.clicks ?? 0)),
    ctr: parseFloat(String(insRow.ctr ?? 0)),
    cpc: parseFloat(String(insRow.cpc ?? 0)),
    frequency: parseFloat(String(insRow.frequency ?? 0)),
    roas: spend > 0 ? purchaseValue / spend : 0,
  };

  // Fetch creative content and AI tags
  const creativeContent = await fetchCreativeContent(adId, token);
  const creativeTags = creativeContent ? await analyzeCreativeWithAI(creativeContent) : null;

  // Upsert to creative_intelligence
  const existing = await pool.query(
    `SELECT * FROM creative_intelligence WHERE ad_id = $1`,
    [adId]
  ).catch(() => ({ rows: [] }));

  const today = new Date().toISOString().slice(0, 10);

  if (existing.rows.length === 0) {
    // New ad — insert
    await pool.query(
      `INSERT INTO creative_intelligence (ad_account_id, ad_id, ad_name, campaign_name, adset_name, first_seen, latest_roas, peak_roas, latest_ctr, peak_ctr, latest_frequency, days_running, spend_to_date, raw_metrics, fatigue_status, creative_content, creative_tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,0,$12,$13,'healthy',$14,$15)`,
      [adAccountId, adId, adName, campaignName, adsetName, today, insights.roas, insights.roas, insights.ctr, insights.ctr, insights.frequency, insights.spend, JSON.stringify(insights), creativeContent ? JSON.stringify(creativeContent) : null, creativeTags ? JSON.stringify(creativeTags) : null]
    );
  } else {
    const row = existing.rows[0] as Record<string, unknown>;
    const firstSeen = new Date(row.first_seen as string);
    const daysRunning = Math.floor((Date.now() - firstSeen.getTime()) / 86400000);
    const peakRoas = Math.max(Number(row.peak_roas ?? 0), insights.roas);
    const peakCtr = Math.max(Number(row.peak_ctr ?? 0), insights.ctr);

    // Detect fatigue
    const { status, alert } = detectFatigue({
      daysRunning,
      latestCtr: insights.ctr,
      peakCtr,
      latestRoas: insights.roas,
      peakRoas,
      frequency: insights.frequency,
    });

    const prevStatus = String(row.fatigue_status ?? 'healthy');
    const alertSent = row.alert_sent as boolean ?? false;

    // Generate creative brief if newly fatigued
    let creativeBrief = (row.creative_brief as string | null) ?? null;
    let newAlertSent = alertSent;

    if ((status === 'fatiguing' || status === 'saturated') && !alertSent && prevStatus === 'healthy') {
      creativeBrief = await generateCreativeBrief({ adName, campaignName, peakCtr, latestCtr: insights.ctr, peakRoas, latestRoas: insights.roas, daysRunning });
      await sendFatigueSlackAlert({ adName, campaignName, status, peakCtr, latestCtr: insights.ctr, peakRoas, latestRoas: insights.roas, creativeBrief });
      newAlertSent = true;
    }

    await pool.query(
      `UPDATE creative_intelligence SET
        latest_roas=$1, peak_roas=$2, latest_ctr=$3, peak_ctr=$4,
        latest_frequency=$5, days_running=$6, fatigue_status=$7,
        fatigue_detected_at=CASE WHEN $8='fatiguing' OR $8='saturated' THEN COALESCE(fatigue_detected_at,NOW()) ELSE fatigue_detected_at END,
        alert_sent=$9, creative_brief=COALESCE($10,creative_brief),
        spend_to_date=COALESCE(spend_to_date,0)+$11, raw_metrics=$12,
        creative_content=COALESCE($14,creative_content),
        creative_tags=COALESCE($15,creative_tags),
        updated_at=NOW()
       WHERE ad_id=$13`,
      [insights.roas, peakRoas, insights.ctr, peakCtr, insights.frequency, daysRunning,
       status, status, newAlertSent, creativeBrief, insights.spend, JSON.stringify(insights), adId,
       creativeContent ? JSON.stringify(creativeContent) : null, creativeTags ? JSON.stringify(creativeTags) : null]
    );
  }
}

function detectFatigue(params: {
  daysRunning: number; latestCtr: number; peakCtr: number;
  latestRoas: number; peakRoas: number; frequency: number;
}): { status: string; alert: string } {
  const { daysRunning, latestCtr, peakCtr, latestRoas, peakRoas, frequency } = params;
  const ctrDropPct = peakCtr > 0 ? (peakCtr - latestCtr) / peakCtr : 0;
  const roasDropPct = peakRoas > 0 ? (peakRoas - latestRoas) / peakRoas : 0;

  if (frequency >= 3.5) {
    return { status: 'saturated', alert: 'Audience saturated — frequency too high' };
  }
  if (ctrDropPct >= 0.25 && daysRunning >= 7) {
    return { status: 'fatiguing', alert: `CTR dropped ${Math.round(ctrDropPct * 100)}% from peak — entering fatigue` };
  }
  if (roasDropPct >= 0.30 && daysRunning >= 7) {
    return { status: 'fatiguing', alert: `ROAS dropped ${Math.round(roasDropPct * 100)}% from peak` };
  }
  if (daysRunning >= 21) {
    return { status: 'aging', alert: 'Creative running 21+ days — refresh recommended' };
  }
  return { status: 'healthy', alert: '' };
}

async function generateCreativeBrief(params: {
  adName: string; campaignName: string; peakCtr: number; latestCtr: number;
  peakRoas: number; latestRoas: number; daysRunning: number;
}): Promise<string> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey || apiKey.length < 10) return 'Creative brief generation pending — CLAUDE_API_KEY not set';

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        messages: [{
          role: 'user',
          content: `Ad named "${params.adName}" in campaign "${params.campaignName}" is showing fatigue.
Peak CTR: ${params.peakCtr.toFixed(2)}%, Current: ${params.latestCtr.toFixed(2)}%
Peak ROAS: ${params.peakRoas.toFixed(2)}x, Current: ${params.latestRoas.toFixed(2)}x
Days running: ${params.daysRunning}

Generate 3 alternative creative angles to test as replacements.
Format as:
1. Hook: [hook text] | Visual: [visual direction] | CTA: [call to action]
2. Hook: [hook text] | Visual: [visual direction] | CTA: [call to action]
3. Hook: [hook text] | Visual: [visual direction] | CTA: [call to action]

Keep it concise and actionable for a D2C fashion brand.`,
        }],
      }),
    });

    if (!res.ok) return `Brief generation failed — API ${res.status}`;
    const data = await res.json() as { content?: Array<{ type: string; text: string }> };
    return data.content?.find(c => c.type === 'text')?.text ?? 'No brief generated';
  } catch (e) {
    return `Brief generation failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

async function sendFatigueSlackAlert(params: {
  adName: string; campaignName: string; status: string;
  peakCtr: number; latestCtr: number; peakRoas: number; latestRoas: number;
  creativeBrief: string | null;
}): Promise<void> {
  const ctrDrop = params.peakCtr > 0 ? Math.round(((params.peakCtr - params.latestCtr) / params.peakCtr) * 100) : 0;
  const msg =
    `⚠️ *Creative Fatigue Detected*\n` +
    `Ad: ${params.adName}\n` +
    `Campaign: ${params.campaignName}\n` +
    `Status: ${params.status.toUpperCase()}\n` +
    `CTR: ${params.peakCtr.toFixed(2)}% → ${params.latestCtr.toFixed(2)}% (${ctrDrop}% drop)\n` +
    `ROAS: ${params.peakRoas.toFixed(2)}x → ${params.latestRoas.toFixed(2)}x\n\n` +
    `*Creative Brief Generated:*\n${params.creativeBrief ?? 'N/A'}\n\n` +
    `<@${SLACK_SAKCHAM}> — please brief Keshav on replacement.`;

  await sendSlackMessage(SLACK_PERF_MARKETING_CHANNEL, msg).catch(() => {});
}

// ---------------------------------------------------------------------------
// Pattern detection — aggregate creative tags to find top-performing combos
// ---------------------------------------------------------------------------
export async function getCreativePatterns(): Promise<Array<{
  hook: string; visual: string; angle: string;
  avg_roas: number; avg_ctr: number; count: number;
}>> {
  const result = await pool.query(`
    SELECT
      creative_tags->>'hook' AS hook,
      creative_tags->>'visual' AS visual,
      creative_tags->>'angle' AS angle,
      ROUND(AVG(latest_roas)::numeric, 2) AS avg_roas,
      ROUND(AVG(latest_ctr)::numeric, 2) AS avg_ctr,
      COUNT(*) AS count
    FROM creative_intelligence
    WHERE creative_tags IS NOT NULL
      AND latest_roas IS NOT NULL
    GROUP BY
      creative_tags->>'hook',
      creative_tags->>'visual',
      creative_tags->>'angle'
    HAVING COUNT(*) >= 2
    ORDER BY AVG(latest_roas) DESC
  `);
  return result.rows;
}

// ---------------------------------------------------------------------------
// Fatiguing creatives with full context for replacement planning
// ---------------------------------------------------------------------------
export async function getFatiguingCreativesWithContext(): Promise<unknown[]> {
  const result = await pool.query(`
    SELECT
      ad_id, ad_name, campaign_name,
      creative_tags,
      creative_content,
      fatigue_status,
      peak_roas, latest_roas,
      peak_ctr, latest_ctr,
      creative_brief,
      updated_at
    FROM creative_intelligence
    WHERE fatigue_status IN ('fatiguing', 'saturated')
    ORDER BY updated_at DESC
  `);
  return result.rows;
}
