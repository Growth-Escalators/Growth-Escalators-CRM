import { pool } from '../db/index';
import logger from '../utils/logger';
import { resolveDefaultSeoTenantId } from './seoTenantContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CompetitorPage {
  position: number;
  title: string;
  link: string;
  domain: string;
  snippet: string;
}

interface CompetitorContentAnalysis {
  missing_topics: string[];
  missing_questions: string[];
  recommended_word_count: number;
  suggested_headings: string[];
  content_brief: string;
  schema_recommendations: string[];
  estimated_ranking_improvement: string;
}

// ---------------------------------------------------------------------------
// Fetch competitor pages from Serper.dev
// ---------------------------------------------------------------------------
export async function fetchCompetitorPages(keyword: string): Promise<CompetitorPage[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    logger.warn('[competitor-content] SERPER_API_KEY not set — skipping competitor fetch');
    return [];
  }

  const { checkAndIncrementSeoSerperCap } = await import('./seoWorkflowHealthService');
  if (!checkAndIncrementSeoSerperCap()) {
    logger.warn(`[competitor-content] SEO Serper daily cap reached — skipping "${keyword}"`);
    return [];
  }

  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: keyword, gl: 'in', num: 10 }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      logger.warn(`[competitor-content] Serper API ${res.status} for "${keyword}"`);
      return [];
    }

    const data = await res.json() as { organic?: Array<{ position: number; title: string; link: string; domain?: string; snippet?: string }> };
    const organics = data.organic ?? [];

    return organics.slice(0, 5).map(r => ({
      position: r.position,
      title: r.title,
      link: r.link,
      domain: r.domain ?? new URL(r.link).hostname,
      snippet: r.snippet ?? '',
    }));
  } catch (e) {
    logger.error(`[competitor-content] Serper error for "${keyword}":`, e instanceof Error ? e.message : String(e));
    return [];
  }
}

// ---------------------------------------------------------------------------
// Analyze competitor content using Claude Sonnet
// ---------------------------------------------------------------------------
export async function analyzeCompetitorContent(
  keyword: string,
  clientDomain: string,
  competitors: CompetitorPage[],
  tenantId?: string,
): Promise<CompetitorContentAnalysis | null> {
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    logger.warn('[competitor-content] CLAUDE_API_KEY not set — skipping analysis');
    return null;
  }

  const resolvedTenantId = tenantId ?? await resolveDefaultSeoTenantId();

  // Get client's current position for this keyword
  let currentPosition: number | null = null;
  try {
    const posResult = await pool.query(
      `SELECT current_position FROM keyword_rankings
       WHERE client_domain = $1 AND keyword = $2 AND tenant_id = $3
       ORDER BY recorded_date DESC LIMIT 1`,
      [clientDomain, keyword, resolvedTenantId],
    );
    const pos = (posResult.rows[0] as Record<string, string> | undefined)?.current_position;
    currentPosition = pos != null ? Number(pos) : null;
  } catch { /* ignore */ }

  const competitorSummary = competitors
    .map((c, i) => `${i + 1}. [Pos ${c.position}] ${c.title}\n   ${c.link}\n   ${c.snippet}`)
    .join('\n\n');

  // Learning loop: give the model historical context on how well this class of
  // opportunity has actually performed, when there's enough data to trust it.
  const { computeOpportunityTypeSuccessRates, formatHistoricalPerformanceNote } = await import('./seoDigestService');
  const successRates = await computeOpportunityTypeSuccessRates();
  const historicalNote = formatHistoricalPerformanceNote('content_gap', successRates);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `Analyze the top competitors for the keyword "${keyword}" and provide a content gap analysis.

Client domain: ${clientDomain}
Client's current ranking: ${currentPosition != null ? `Position ${currentPosition}` : 'Not ranking'}

Top 5 competitor pages:
${competitorSummary}
${historicalNote}

Based on the competitor titles and snippets, identify what topics, questions, and content elements are likely covered by competitors but potentially missing from the client's content.

Return ONLY valid JSON (no markdown):
{
  "missing_topics": ["topic1", "topic2", "topic3"],
  "missing_questions": ["question1", "question2", "question3"],
  "recommended_word_count": 1500,
  "suggested_headings": ["H2: heading1", "H2: heading2", "H3: heading3"],
  "content_brief": "200-word content brief describing what the ideal page should cover...",
  "schema_recommendations": ["FAQPage schema", "Article schema", "HowTo schema"],
  "estimated_ranking_improvement": "Could improve from position X to Y with comprehensive content"
}`,
        }],
      }),
    });

    if (!res.ok) {
      logger.error(`[competitor-content] Claude API ${res.status} for "${keyword}"`);
      return null;
    }

    const data = await res.json() as { content?: Array<{ type: string; text: string }> };
    const text = data.content?.find(c => c.type === 'text')?.text ?? '';

    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace <= firstBrace) {
      logger.error('[competitor-content] Claude returned invalid JSON');
      return null;
    }

    return JSON.parse(text.slice(firstBrace, lastBrace + 1)) as CompetitorContentAnalysis;
  } catch (e) {
    logger.error(`[competitor-content] Claude analysis failed for "${keyword}":`, e instanceof Error ? e.message : String(e));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main cron: run competitor content analysis for improvable keywords
// ---------------------------------------------------------------------------
export async function runCompetitorContentAnalysis(): Promise<{ analyzed: number; errors: number }> {
  let analyzed = 0;
  let errors = 0;
  const tenantId = await resolveDefaultSeoTenantId();

  try {
    // Keywords ranked 5-30 have the most improvement potential
    const result = await pool.query(`
      SELECT DISTINCT ON (keyword) keyword, client_domain, current_position
      FROM keyword_rankings
      WHERE current_position IS NOT NULL
        AND current_position BETWEEN 5 AND 30
        AND tenant_id = $1
      ORDER BY keyword, recorded_date DESC
      LIMIT 10
    `, [tenantId]);

    const keywords = result.rows as Array<{ keyword: string; client_domain: string; current_position: string }>;
    if (keywords.length === 0) {
      logger.info('[competitor-content] No keywords in position 5-30 — skipping');
      return { analyzed: 0, errors: 0 };
    }

    logger.info(`[competitor-content] Analyzing ${keywords.length} keywords with improvement potential`);

    // Learning loop: historical outcome success rates per opportunity type, computed
    // once per run and used to nudge priority scores (see applySuccessRateAdjustment).
    const { computeOpportunityTypeSuccessRates, applySuccessRateAdjustment } = await import('./seoDigestService');
    const successRates = await computeOpportunityTypeSuccessRates();

    for (const kw of keywords) {
      try {
        const competitors = await fetchCompetitorPages(kw.keyword);
        if (competitors.length === 0) {
          logger.warn(`[competitor-content] No competitors found for "${kw.keyword}"`);
          errors++;
          continue;
        }

        await new Promise(r => setTimeout(r, 1500)); // rate limit between Serper and Claude

        const analysis = await analyzeCompetitorContent(kw.keyword, kw.client_domain, competitors, tenantId);
        if (!analysis) {
          errors++;
          continue;
        }

        // Priority: higher for closer-to-top keywords, nudged by how well past
        // content_gap opportunities have actually performed (no-op below sampleSize 10).
        const rawPriorityScore = Math.max(0, 30 - Number(kw.current_position)) * 3;
        const priorityScore = applySuccessRateAdjustment(rawPriorityScore, successRates, 'content_gap', { min: 0 });

        // Store in content_gap_analysis table
        await pool.query(
          `INSERT INTO content_gap_analysis
            (id, project_name, target_keyword, our_position, competitor_urls,
             topics_missing, questions_missing, word_count_gap, priority_score, status, analysed_at, tenant_id)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 'pending', NOW(), $9)`,
          [
            kw.client_domain,
            kw.keyword,
            Number(kw.current_position),
            JSON.stringify(competitors.map(c => c.link)),
            JSON.stringify(analysis.missing_topics),
            JSON.stringify(analysis.missing_questions),
            analysis.recommended_word_count,
            priorityScore,
            tenantId,
          ],
        );

        analyzed++;
        logger.info(`[competitor-content] Analyzed "${kw.keyword}" (pos ${kw.current_position}) — ${analysis.missing_topics.length} missing topics`);

        await new Promise(r => setTimeout(r, 2000)); // rate limit between keywords
      } catch (e) {
        logger.error(`[competitor-content] Error analyzing "${kw.keyword}":`, e instanceof Error ? e.message : String(e));
        errors++;
      }
    }
  } catch (e) {
    logger.error('[competitor-content] runCompetitorContentAnalysis failed:', e instanceof Error ? e.message : String(e));
    errors++;
  }

  logger.info(`[competitor-content] Complete — ${analyzed} analyzed, ${errors} errors`);
  return { analyzed, errors };
}
