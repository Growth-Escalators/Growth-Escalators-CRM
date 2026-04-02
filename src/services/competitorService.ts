import { pool } from '../db/index';
import logger from '../utils/logger';
import { type GrowthOSClient, sendWhatsAppMessage } from './growthOSSetup';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CompetitorAnalysis {
  trending_formats: string[];
  new_offers: string[];
  insights: string;
  recommendations: string[];
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

export async function runCompetitorPulse(client: GrowthOSClient): Promise<void> {
  logger.info(`[competitor] Running pulse for ${client.client_name}...`);

  const competitors = Array.isArray(client.competitors) ? client.competitors : [];
  if (competitors.length === 0) {
    logger.info(`[competitor] No competitors configured for ${client.client_name} — skipping`);
    return;
  }

  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekStartStr = weekStart.toISOString().slice(0, 10);

  const allAnalyses: Array<{ name: string; analysis: CompetitorAnalysis; adsFound: number }> = [];

  for (const competitorName of competitors) {
    try {
      const { adTexts, adsFound, pageId } = await fetchCompetitorAds(String(competitorName));
      const analysis = await analyzeWithClaude(String(competitorName), client.client_name, client.industry, adTexts);

      await pool.query(
        `INSERT INTO competitor_pulse (client_name, competitor_name, competitor_page_id, week_start, ads_found, trending_formats, new_offers, insights, recommendations, raw_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          client.client_name, competitorName, pageId, weekStartStr, adsFound,
          JSON.stringify(analysis.trending_formats), JSON.stringify(analysis.new_offers),
          analysis.insights, JSON.stringify(analysis.recommendations),
          JSON.stringify({ ad_texts_sample: adTexts.slice(0, 5) }),
        ]
      );

      allAnalyses.push({ name: String(competitorName), analysis, adsFound });
      await new Promise(r => setTimeout(r, 1000));
    } catch (e) {
      logger.error(`[competitor] ${competitorName} failed:`, e instanceof Error ? e.message : String(e));
    }
  }

  if (allAnalyses.length > 0 && client.founder_whatsapp) {
    await sendCompetitorWhatsApp(client, allAnalyses, weekStartStr);
  }
}

// ---------------------------------------------------------------------------
// Meta Ad Library fetch
// ---------------------------------------------------------------------------

async function fetchCompetitorAds(competitorName: string): Promise<{ adTexts: string[]; adsFound: number; pageId: string | null }> {
  try {
    const encoded = encodeURIComponent(competitorName);
    const url = `https://www.facebook.com/ads/library/api/?search_type=page&q=${encoded}&ad_type=ALL&country=IN&fields=ad_archive_id,start_date,ad_creative_bodies,page_name,page_id&limit=20`;

    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      logger.warn(`[competitor] Ad Library ${res.status} for ${competitorName}`);
      return { adTexts: [], adsFound: 0, pageId: null };
    }

    const data = await res.json() as { data?: Array<Record<string, unknown>>; error?: Record<string, unknown> };
    if (data.error) {
      logger.warn(`[competitor] Ad Library error for ${competitorName}:`, data.error);
      return { adTexts: [], adsFound: 0, pageId: null };
    }

    const ads = data.data ?? [];
    const adTexts: string[] = [];
    let pageId: string | null = null;

    for (const ad of ads) {
      if (!pageId) pageId = String(ad.page_id ?? '');
      const bodies = ad.ad_creative_bodies as string[] | undefined;
      if (bodies && bodies.length > 0) {
        adTexts.push(...bodies.filter(Boolean).slice(0, 3));
      }
    }

    return { adTexts: adTexts.slice(0, 15), adsFound: ads.length, pageId };
  } catch (e) {
    logger.error(`[competitor] fetchCompetitorAds failed for ${competitorName}:`, e instanceof Error ? e.message : String(e));
    return { adTexts: [], adsFound: 0, pageId: null };
  }
}

// ---------------------------------------------------------------------------
// Claude analysis
// ---------------------------------------------------------------------------

async function analyzeWithClaude(
  competitorName: string,
  clientName: string,
  industry: string,
  adTexts: string[]
): Promise<CompetitorAnalysis> {
  const fallback: CompetitorAnalysis = {
    trending_formats: ['Static image ads', 'Video testimonials'],
    new_offers: ['No specific offers detected'],
    insights: `${competitorName} is actively running Meta ads. ${adTexts.length > 0 ? `Found ${adTexts.length} ad texts.` : 'Limited ad text data available.'}`,
    recommendations: ['Monitor competitor frequency', 'Test different ad formats'],
  };

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey || apiKey.length < 10) return fallback;
  if (adTexts.length === 0) return fallback;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: `These are recent Meta ads from ${competitorName}, a competitor of ${clientName} in the ${industry} space.
Ad texts:
${adTexts.join('\n\n')}

Analyze and return ONLY valid JSON (no markdown):
{
  "trending_formats": ["format1", "format2"],
  "new_offers": ["offer1", "offer2"],
  "insights": "2-3 sentence strategic observation",
  "recommendations": ["rec1", "rec2", "rec3"]
}`,
        }],
      }),
    });

    if (!res.ok) return fallback;
    const data = await res.json() as { content?: Array<{ type: string; text: string }> };
    const text = data.content?.find(c => c.type === 'text')?.text ?? '';

    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace <= firstBrace) return fallback;

    const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1)) as CompetitorAnalysis;
    return {
      trending_formats: parsed.trending_formats ?? fallback.trending_formats,
      new_offers: parsed.new_offers ?? fallback.new_offers,
      insights: parsed.insights ?? fallback.insights,
      recommendations: parsed.recommendations ?? fallback.recommendations,
    };
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// WhatsApp delivery
// ---------------------------------------------------------------------------

async function sendCompetitorWhatsApp(
  client: GrowthOSClient,
  analyses: Array<{ name: string; analysis: CompetitorAnalysis; adsFound: number }>,
  weekStartStr: string
): Promise<void> {
  if (!client.founder_whatsapp) return;

  const date = new Date(weekStartStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

  // Aggregate across all competitors
  const allFormats = [...new Set(analyses.flatMap(a => a.analysis.trending_formats))].slice(0, 4);
  const allOffers = [...new Set(analyses.flatMap(a => a.analysis.new_offers))].slice(0, 4);
  const allRecs = [...new Set(analyses.flatMap(a => a.analysis.recommendations))].slice(0, 4);

  const msg =
    `🔍 *Competitor Pulse — ${client.client_name}*\n` +
    `Week of ${date}\n\n` +
    `Monitored ${analyses.length} competitor${analyses.length > 1 ? 's' : ''}.\n` +
    analyses.map(a => `• ${a.name}: ${a.adsFound} ads running`).join('\n') +
    `\n\n🔥 Trending formats this week:\n` +
    allFormats.map(f => `• ${f}`).join('\n') +
    `\n\n💰 New offers spotted:\n` +
    allOffers.map(o => `• ${o}`).join('\n') +
    `\n\n💡 Recommendations:\n` +
    allRecs.map(r => `• ${r}`).join('\n');

  await sendWhatsAppMessage(client.founder_whatsapp, msg);
}
