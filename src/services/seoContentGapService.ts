import { pool } from '../db/index';
import logger from '../utils/logger';
import { resolveDefaultSeoTenantId } from './seoTenantContext';

// ---------------------------------------------------------------------------
// Bootstrap content calendar table (idempotent — safe to call every run)
// ---------------------------------------------------------------------------
export async function ensureContentCalendarTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS seo_content_calendar (
      id SERIAL PRIMARY KEY,
      tenant_id UUID DEFAULT '00000000-0000-0000-0000-000000000001',
      client_domain TEXT NOT NULL,
      keyword TEXT NOT NULL,
      content_type TEXT NOT NULL DEFAULT 'blog',
      title TEXT,
      status TEXT NOT NULL DEFAULT 'planned',
      priority TEXT DEFAULT 'medium',
      source TEXT,
      source_id TEXT,
      target_publish_date DATE,
      published_url TEXT,
      assigned_to TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // Avoid duplicate entries
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS seo_content_calendar_unique_idx
    ON seo_content_calendar(client_domain, keyword, content_type)
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS seo_calendar_status_idx ON seo_content_calendar(status)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS seo_calendar_client_idx ON seo_content_calendar(client_domain)`);
}

const SERPER_API_URL = 'https://google.serper.dev/search';
const SERPER_API_KEY = process.env.SERPER_API_KEY;

interface SerperResult { title: string; link: string; snippet: string; position?: number }

async function serperSearch(query: string, num = 10): Promise<SerperResult[]> {
  if (!SERPER_API_KEY) return [];
  const { checkAndIncrementSeoSerperCap } = await import('./seoWorkflowHealthService');
  if (!checkAndIncrementSeoSerperCap()) {
    logger.warn(`[content-gap] SEO Serper daily cap reached — skipping query "${query}"`);
    return [];
  }
  try {
    const res = await fetch(SERPER_API_URL, {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, gl: 'in', hl: 'en', num }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const data = await res.json() as { organic?: SerperResult[] };
    return data.organic ?? [];
  } catch { return []; }
}

function delay(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
// Run content gap analysis for all SEO clients
// ---------------------------------------------------------------------------
export async function runContentGapAnalysis(): Promise<{ gaps: number; opportunities: number }> {
  if (!SERPER_API_KEY) {
    const msg = 'content-gap: SERPER_API_KEY not set on Railway worker — content gap analysis cannot run';
    logger.error(`[content-gap] ${msg}`);
    try {
      const { sendSlackMessage } = await import('./slackService');
      const { SLACK_SEO_CHANNEL } = await import('../config/constants');
      await sendSlackMessage(SLACK_SEO_CHANNEL, `⚠️ ${msg}`);
    } catch { /* slack non-critical */ }
    throw new Error(msg);
  }

  let gaps = 0, opportunities = 0;
  const tenantId = await resolveDefaultSeoTenantId();

  // Learning loop: historical outcome success rates per opportunity type, computed
  // once per run and used to nudge priority scores (see applySuccessRateAdjustment).
  const { computeOpportunityTypeSuccessRates, applySuccessRateAdjustment } = await import('./seoDigestService');
  const successRates = await computeOpportunityTypeSuccessRates();

  // Get all clients with keywords and domain
  const clientsR = await pool.query(`
    SELECT project_name, primary_keywords, competitors, client_domain
    FROM client_knowledge_base
    WHERE primary_keywords IS NOT NULL AND client_domain IS NOT NULL AND client_domain != '' AND tenant_id = $1
  `, [tenantId]);

  for (const client of clientsR.rows as Array<{ project_name: string; primary_keywords: string; competitors: string; client_domain: string }>) {
    const keywords = client.primary_keywords.split(',').map(k => k.trim()).filter(Boolean);
    const competitorDomains = (client.competitors || '')
      .split(',')
      .map(c => c.trim().toLowerCase().replace(/\s+/g, ''))
      .filter(Boolean)
      // Extract domain-like names
      .map(c => {
        if (c.includes('.')) return c;
        // Map known names to domains
        const domainMap: Record<string, string> = {
          'ey': 'ey.com', 'deloitte': 'deloitte.com', 'kpmg': 'kpmg.com',
          'patanjali': 'patanjali.com', 'himalaya': 'himalayawellness.in', 'forestessentials': 'forestessentialsindia.com',
          'ida(indiandentalassociation)': 'ida.org.in', 'isomr': 'isomr.org',
        };
        return domainMap[c] || null;
      })
      .filter(Boolean) as string[];

    for (const keyword of keywords.slice(0, 8)) { // Max 8 keywords per client per run
      // Check if already analyzed in last 30 days
      const existing = await pool.query(
        `SELECT id FROM content_gap_analysis WHERE project_name = $1 AND target_keyword = $2 AND analysed_at > NOW() - INTERVAL '30 days' AND tenant_id = $3 LIMIT 1`,
        [client.project_name, keyword, tenantId],
      );
      if ((existing.rows as unknown[]).length > 0) continue;

      // 1. Check client's own ranking
      await delay(2000);
      const ownResults = await serperSearch(keyword, 20);
      let ourPosition: number | null = null;
      let ourUrl: string | null = null;
      for (const r of ownResults) {
        if (r.link.includes(client.client_domain.replace(/^https?:\/\//, '').replace(/\/$/, ''))) {
          ourPosition = r.position ?? (ownResults.indexOf(r) + 1);
          ourUrl = r.link;
          break;
        }
      }

      // 2. Search competitor domains for this keyword
      const competitorUrls: string[] = [];
      const topicsMissing: string[] = [];
      const questionsMissing: string[] = [];

      for (const compDomain of competitorDomains.slice(0, 3)) {
        await delay(2000);
        const compResults = await serperSearch(`site:${compDomain} ${keyword}`, 5);
        for (const r of compResults) {
          competitorUrls.push(r.link);
          // Extract topics from titles
          const cleanTitle = r.title.replace(/[-|].*$/, '').trim();
          if (cleanTitle.length > 10 && cleanTitle.length < 100) {
            topicsMissing.push(cleanTitle);
          }
          // Check for question-format content
          if (/^(what|how|why|when|where|which|can|do|is|are)\b/i.test(r.title)) {
            questionsMissing.push(r.title.replace(/[-|].*$/, '').trim());
          }
        }
      }

      // 3. Also extract "People Also Ask" style questions from main search
      const relatedQuestions = ownResults
        .filter(r => /\?/.test(r.title) || /^(what|how|why|when)\b/i.test(r.title))
        .map(r => r.title.replace(/[-|].*$/, '').trim())
        .slice(0, 5);
      questionsMissing.push(...relatedQuestions);

      // 4. Calculate priority score
      let priorityScore = 50;
      if (ourPosition === null) priorityScore += 30; // not ranking at all
      else if (ourPosition > 20) priorityScore += 20;
      else if (ourPosition > 10) priorityScore += 10;
      if (competitorUrls.length > 3) priorityScore += 10;
      if (competitorUrls.length > 0) priorityScore += 5;
      priorityScore = Math.min(100, priorityScore);
      // Learning loop: nudge the score using how well past content_gap opportunities
      // actually performed (no-op until sampleSize >= 10 for this opportunity type).
      priorityScore = applySuccessRateAdjustment(priorityScore, successRates, 'content_gap', { min: 0, max: 100 });

      // 5. Insert into content_gap_analysis
      if (competitorUrls.length > 0 || ourPosition === null || ourPosition > 10) {
        const gapInsert = await pool.query(
          `INSERT INTO content_gap_analysis (id, project_name, target_keyword, our_url, our_position, competitor_urls, topics_missing, questions_missing, priority_score, status, analysed_at, client_domain, tenant_id)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 'open', NOW(), $9, $10)
           RETURNING id`,
          [client.project_name, keyword, ourUrl, ourPosition,
           JSON.stringify(competitorUrls), JSON.stringify([...new Set(topicsMissing)]),
           JSON.stringify([...new Set(questionsMissing)]), priorityScore, client.client_domain, tenantId],
        );
        const gapId = (gapInsert.rows as Array<{ id: string }>)[0]?.id;
        gaps++;

        // 6. Create corresponding opportunity FIRST (before the calendar insert) so
        // its id is available to link the calendar row below — this is what lets
        // the calendar's PATCH published_url handler propagate back to
        // seo_opportunities and lets the weekly digest measure the outcome.
        const impact = priorityScore >= 80 ? 'high' : priorityScore >= 60 ? 'medium' : 'low';
        const effort = ourPosition && ourPosition < 25 ? 'low' : 'medium';
        const desc = ourPosition
          ? `"${keyword}" ranks #${ourPosition} — ${competitorUrls.length} competitors cover this. Create/expand dedicated page to push into top 10.`
          : `"${keyword}" — not ranking. ${competitorUrls.length} competitors have content. Create a dedicated page.`;

        // Dedup opportunities
        const existingOpp = await pool.query(
          `SELECT id FROM seo_opportunities WHERE project_name = $1 AND description LIKE $2 AND identified_at > NOW() - INTERVAL '30 days' AND tenant_id = $3 LIMIT 1`,
          [client.project_name, `%${keyword}%`, tenantId],
        );
        let opportunityId: string | null = null;
        if ((existingOpp.rows as unknown[]).length === 0) {
          const oppInsert = await pool.query(
            `INSERT INTO seo_opportunities (id, project_name, opportunity_type, description, estimated_impact, effort_level, status, identified_at, client_domain, tenant_id)
             VALUES (gen_random_uuid(), $1, 'content_gap', $2, $3, $4, 'open', NOW(), $5, $6)
             RETURNING id`,
            [client.project_name, desc, impact, effort, client.client_domain, tenantId],
          );
          opportunityId = (oppInsert.rows as Array<{ id: string }>)[0]?.id ?? null;
          opportunities++;
        }

        // Auto-populate content calendar from gap, linked to the opportunity when one
        // was actually created (dedup hits leave opportunityId null — nothing to link).
        try {
          await pool.query(`
            INSERT INTO seo_content_calendar (client_domain, keyword, content_type, title, status, priority, source, source_id, opportunity_id)
            VALUES ($1, $2, 'blog', $3, 'planned', $4, 'content_gap', $5, $6)
            ON CONFLICT (client_domain, keyword, content_type) DO NOTHING
          `, [
            client.client_domain,
            keyword,
            `${keyword.split(' ').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} — Complete Guide`,
            priorityScore >= 80 ? 'high' : priorityScore >= 60 ? 'medium' : 'low',
            gapId,
            opportunityId,
          ]);
        } catch (calErr) {
          logger.warn(`[content-gap] calendar insert skipped: ${calErr instanceof Error ? calErr.message : String(calErr)}`);
        }
      }
    }

    logger.info(`[content-gap] ${client.project_name}: analyzed ${keywords.length} keywords`);
  }

  logger.info(`[content-gap] Complete: ${gaps} gaps, ${opportunities} opportunities`);
  return { gaps, opportunities };
}
