import { pool } from '../db/index';
import logger from '../utils/logger';
import { resolveDefaultSeoTenantId } from './seoTenantContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BrandData {
  brand_name: string;
  industry: string;
  target_audience: string;
  unique_value_prop: string;
  primary_keywords: string;
  tone_of_voice: string;
  competitors: string;
  content_themes: string;
  cta_style: string;
  wordpress_url: string;
}

interface GeneratedContent {
  title: string;
  meta_description: string;
  h1: string;
  content_html: string;
  faq_items: Array<{ question: string; answer: string }>;
}

// ---------------------------------------------------------------------------
// Get client brand data from knowledge base
// ---------------------------------------------------------------------------
export async function getClientBrandData(clientDomain: string, tenantId?: string): Promise<BrandData | null> {
  try {
    const resolvedTenantId = tenantId ?? await resolveDefaultSeoTenantId();
    const result = await pool.query(
      `SELECT brand_name, industry, target_audience, unique_value_prop,
              primary_keywords, tone_of_voice, competitors, content_themes,
              cta_style, wordpress_url
       FROM client_knowledge_base
       WHERE client_domain = $1 AND tenant_id = $2
       LIMIT 1`,
      [clientDomain, resolvedTenantId],
    );

    if (result.rows.length === 0) {
      logger.warn(`[content-gen] No brand data found for ${clientDomain}`);
      return null;
    }

    return result.rows[0] as BrandData;
  } catch (e) {
    logger.error('[content-gen] Failed to fetch brand data:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fetch People Also Ask via Serper.dev
// ---------------------------------------------------------------------------
export async function fetchPeopleAlsoAsk(keyword: string): Promise<string[]> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    logger.warn('[content-gen] SERPER_API_KEY not set — skipping People Also Ask');
    return [];
  }

  try {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: keyword, gl: 'in' }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      logger.warn(`[content-gen] Serper API ${res.status} for PAA "${keyword}"`);
      return [];
    }

    const data = await res.json() as { peopleAlsoAsk?: Array<{ question: string }> };
    const questions = (data.peopleAlsoAsk ?? []).map(item => item.question).filter(Boolean);
    return questions.slice(0, 5);
  } catch (e) {
    logger.warn('[content-gen] Serper PAA error:', e instanceof Error ? e.message : String(e));
    return [];
  }
}

// ---------------------------------------------------------------------------
// Generate JSON-LD schema markup
// ---------------------------------------------------------------------------
export function generateSchemaMarkup(data: {
  title: string;
  description: string;
  brandName: string;
  siteUrl: string;
  faqItems: Array<{ question: string; answer: string }>;
}): string {
  const articleSchema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: data.title,
    description: data.description,
    author: { '@type': 'Organization', name: data.brandName },
    publisher: { '@type': 'Organization', name: data.brandName },
    datePublished: new Date().toISOString().split('T')[0],
    dateModified: new Date().toISOString().split('T')[0],
  };

  const faqSchema = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: data.faqItems.map(item => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };

  const orgSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: data.brandName,
    url: data.siteUrl,
  };

  return [articleSchema, faqSchema, orgSchema]
    .map(s => `<script type="application/ld+json">${JSON.stringify(s)}</script>`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Generate content for a client using Claude Sonnet
// ---------------------------------------------------------------------------
export async function generateContentForClient(
  clientDomain: string,
  keyword: string,
  pageType?: string,
  tenantId?: string,
): Promise<GeneratedContent | null> {
  const resolvedTenantId = tenantId ?? await resolveDefaultSeoTenantId();
  const brandData = await getClientBrandData(clientDomain, resolvedTenantId);
  if (!brandData) {
    logger.error(`[content-gen] No brand data for ${clientDomain} — cannot generate content`);
    return null;
  }

  const paaQuestions = await fetchPeopleAlsoAsk(keyword);
  await new Promise(r => setTimeout(r, 1500)); // rate limit between Serper and Claude

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    logger.warn('[content-gen] CLAUDE_API_KEY not set — cannot generate content');
    return null;
  }

  const today = new Date().toISOString().split('T')[0];

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(120000),
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: `You are writing SEO content for ${brandData.brand_name}.

Brand context:
- Industry: ${brandData.industry}
- Target audience: ${brandData.target_audience}
- Value proposition: ${brandData.unique_value_prop}
- Tone of voice: ${brandData.tone_of_voice}
- CTA style: ${brandData.cta_style}
- Content themes: ${brandData.content_themes}
${pageType ? `- Page type: ${pageType}` : ''}

Target keyword: ${keyword}

${paaQuestions.length > 0 ? `People Also Ask questions to include as FAQ:\n${paaQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}` : 'Generate 3-5 relevant FAQ questions for this keyword.'}

AI Overview optimization requirements:
- First sentence MUST directly answer the search query for "${keyword}"
- Include "According to ${brandData.brand_name}..." phrases for attribution
- Add a "Key Takeaway" summary at the very top of the content
- Structure with numbered steps/bullets where appropriate
- Include "Last updated: ${today}" freshness signal

Return ONLY valid JSON (no markdown):
{
  "title": "SEO title (60 chars max)",
  "meta_description": "Meta description (155 chars max) with CTA",
  "h1": "H1 heading",
  "content_html": "<h1>...</h1>full HTML content with Key Takeaway, sections, and Last updated signal",
  "faq_items": [{"question": "...", "answer": "..."}]
}`,
        }],
      }),
    });

    if (!res.ok) {
      logger.error(`[content-gen] Claude API ${res.status} for "${keyword}"`);
      return null;
    }

    const data = await res.json() as { content?: Array<{ type: string; text: string }> };
    const text = data.content?.find(c => c.type === 'text')?.text ?? '';

    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace <= firstBrace) {
      logger.error('[content-gen] Claude returned invalid JSON');
      return null;
    }

    const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1)) as GeneratedContent;

    // Generate and append schema markup
    const schemaMarkup = generateSchemaMarkup({
      title: parsed.title,
      description: parsed.meta_description,
      brandName: brandData.brand_name,
      siteUrl: brandData.wordpress_url || `https://${clientDomain}`,
      faqItems: parsed.faq_items ?? [],
    });
    parsed.content_html = (parsed.content_html ?? '') + '\n' + schemaMarkup;

    // Store in client_pages with status draft_local
    await pool.query(
      `INSERT INTO client_pages (id, project_name, page_url, page_title, client_domain, page_slug, status, page_type, meta_description, content, tenant_id)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'draft_local', $6, $7, $8, $9)`,
      [
        clientDomain,
        `https://${clientDomain}/${keyword.toLowerCase().replace(/\s+/g, '-')}/`,
        parsed.title,
        clientDomain,
        keyword.toLowerCase().replace(/\s+/g, '-'),
        pageType ?? 'ai_generated',
        parsed.meta_description,
        parsed.content_html,
        resolvedTenantId,
      ],
    );

    logger.info(`[content-gen] Generated content for "${keyword}" (${clientDomain}) — stored as draft_local`);
    return parsed;
  } catch (e) {
    logger.error(`[content-gen] Content generation failed for "${keyword}":`, e instanceof Error ? e.message : String(e));
    return null;
  }
}

// ---------------------------------------------------------------------------
// AI-optimized content wrapper
// ---------------------------------------------------------------------------
export async function generateAIOptimizedContent(
  clientDomain: string,
  keyword: string,
  tenantId?: string,
): Promise<GeneratedContent | null> {
  const resolvedTenantId = tenantId ?? await resolveDefaultSeoTenantId();
  const brandData = await getClientBrandData(clientDomain, resolvedTenantId);
  if (!brandData) {
    logger.error(`[content-gen] No brand data for ${clientDomain} — cannot generate AI-optimized content`);
    return null;
  }

  const paaQuestions = await fetchPeopleAlsoAsk(keyword);
  await new Promise(r => setTimeout(r, 1500));

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    logger.warn('[content-gen] CLAUDE_API_KEY not set — cannot generate AI-optimized content');
    return null;
  }

  const today = new Date().toISOString().split('T')[0];

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(120000),
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: `You are writing AI-optimized SEO content for ${brandData.brand_name}.

Brand context:
- Industry: ${brandData.industry}
- Target audience: ${brandData.target_audience}
- Value proposition: ${brandData.unique_value_prop}
- Tone of voice: ${brandData.tone_of_voice}

Target keyword: ${keyword}

${paaQuestions.length > 0 ? `People Also Ask questions to include as FAQ:\n${paaQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}` : 'Generate 3-5 relevant FAQ questions.'}

CRITICAL AI OPTIMIZATION INSTRUCTIONS:
- Write as if answering a direct question from an AI assistant
- Include specific numbers, dates, and facts that AI models prefer to cite
- Add a 2-sentence TL;DR at the very top
- First sentence MUST directly answer the search query
- Include "According to ${brandData.brand_name}..." attribution phrases
- Add "Key Takeaway" summary box
- Structure with numbered steps/bullets
- Include "Last updated: ${today}" freshness signal

Return ONLY valid JSON (no markdown):
{
  "title": "SEO title (60 chars max)",
  "meta_description": "Meta description (155 chars max) with CTA",
  "h1": "H1 heading",
  "content_html": "<h1>...</h1>full HTML with TL;DR at top, Key Takeaway, and structured content",
  "faq_items": [{"question": "...", "answer": "..."}]
}`,
        }],
      }),
    });

    if (!res.ok) {
      logger.error(`[content-gen] Claude API ${res.status} for AI-optimized "${keyword}"`);
      return null;
    }

    const data = await res.json() as { content?: Array<{ type: string; text: string }> };
    const text = data.content?.find(c => c.type === 'text')?.text ?? '';

    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace <= firstBrace) {
      logger.error('[content-gen] Claude returned invalid JSON for AI-optimized content');
      return null;
    }

    const parsed = JSON.parse(text.slice(firstBrace, lastBrace + 1)) as GeneratedContent;

    const schemaMarkup = generateSchemaMarkup({
      title: parsed.title,
      description: parsed.meta_description,
      brandName: brandData.brand_name,
      siteUrl: brandData.wordpress_url || `https://${clientDomain}`,
      faqItems: parsed.faq_items ?? [],
    });
    parsed.content_html = (parsed.content_html ?? '') + '\n' + schemaMarkup;

    await pool.query(
      `INSERT INTO client_pages (id, project_name, page_url, page_title, client_domain, page_slug, status, page_type, meta_description, content, tenant_id)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, 'draft_local', 'ai_optimized', $6, $7, $8)`,
      [
        clientDomain,
        `https://${clientDomain}/${keyword.toLowerCase().replace(/\s+/g, '-')}/`,
        parsed.title,
        clientDomain,
        keyword.toLowerCase().replace(/\s+/g, '-'),
        parsed.meta_description,
        parsed.content_html,
        resolvedTenantId,
      ],
    );

    logger.info(`[content-gen] Generated AI-optimized content for "${keyword}" (${clientDomain})`);
    return parsed;
  } catch (e) {
    logger.error(`[content-gen] AI-optimized generation failed for "${keyword}":`, e instanceof Error ? e.message : String(e));
    return null;
  }
}
