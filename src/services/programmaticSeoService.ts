import { pool } from '../db/index';
import logger from '../utils/logger';
import { sendSlackMessage } from './slackService';
import { SLACK_SEO_CHANNEL } from '../config/constants';

const AGED_DENTISTRY_LOCATIONS = [
  'Sydney', 'Melbourne', 'Brisbane', 'Perth', 'Adelaide',
  'Canberra', 'Gold Coast', 'Newcastle', 'Wollongong', 'Hobart',
];

// ---------------------------------------------------------------------------
// Ensure client_pages table exists
// ---------------------------------------------------------------------------
export async function ensureClientPagesTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_pages (
      id SERIAL PRIMARY KEY,
      client_domain TEXT NOT NULL,
      page_title TEXT,
      page_slug TEXT,
      page_url TEXT,
      status TEXT DEFAULT 'draft',
      page_type TEXT DEFAULT 'manual',
      wp_page_id INTEGER,
      meta_description TEXT,
      content TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `).catch(() => {});
}

// ---------------------------------------------------------------------------
// Generate content using Claude Haiku
// ---------------------------------------------------------------------------
async function generatePageContent(location: string): Promise<{
  title: string; meta_description: string; h1: string; content_html: string;
} | null> {
  const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.warn('[prog-seo] No Claude API key — using template fallback');
    return generateFallbackContent(location);
  }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: AbortSignal.timeout(30000),
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{
          role: 'user',
          content: `You are writing SEO content for Aged Dentistry, a specialized dental service for elderly patients and aged care facilities in Australia.

Write a complete page for: Aged Care Dental Services in ${location}

Include:
1. SEO Title (60 chars max): Aged Care Dental Services in ${location} | Aged Dentistry
2. Meta description (155 chars max): compassionate, includes location + service + CTA
3. H1: Aged Care Dental Services in ${location}
4. Introduction (150 words): Why elderly dental care matters in ${location}
5. Our Services section (200 words): what we offer for aged care facilities
6. Why Choose Aged Dentistry (3 bullet points)
7. FAQ section (3 Q&As specific to ${location})
8. Call to action paragraph

Tone: Compassionate, reassuring, professional.
Return ONLY valid JSON: { "title": "...", "meta_description": "...", "h1": "...", "content_html": "<h1>...</h1>..." }`,
        }],
      }),
    });

    if (!res.ok) {
      logger.error(`[prog-seo] Claude API ${res.status} for ${location}`);
      return generateFallbackContent(location);
    }

    const data = await res.json() as { content?: Array<{ type: string; text: string }> };
    const text = data.content?.find(c => c.type === 'text')?.text ?? '';
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace <= firstBrace) return generateFallbackContent(location);

    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  } catch (e) {
    logger.error(`[prog-seo] Content generation failed for ${location}:`, e instanceof Error ? e.message : String(e));
    return generateFallbackContent(location);
  }
}

function generateFallbackContent(location: string): {
  title: string; meta_description: string; h1: string; content_html: string;
} {
  return {
    title: `Aged Care Dental Services in ${location} | Aged Dentistry`,
    meta_description: `Professional dental care for elderly patients and aged care facilities in ${location}. Compassionate, specialized service. Book a visit today.`,
    h1: `Aged Care Dental Services in ${location}`,
    content_html: `<h1>Aged Care Dental Services in ${location}</h1>
<p>Aged Dentistry provides specialized dental care designed specifically for elderly patients and aged care facilities in ${location}. Our team understands the unique oral health challenges faced by seniors and delivers compassionate, professional treatment in a comfortable environment.</p>
<h2>Our Services in ${location}</h2>
<p>We offer comprehensive dental services tailored for aged care residents including preventive check-ups, denture care and repair, emergency dental treatment, oral hygiene programs, and regular dental assessments for facility residents. Our mobile dental team visits aged care facilities across ${location} on a regular schedule.</p>
<h2>Why Choose Aged Dentistry</h2>
<ul>
<li><strong>Specialized Expertise:</strong> Our dentists are trained specifically in geriatric dental care</li>
<li><strong>Mobile Service:</strong> We come to your facility in ${location} — no transport stress for residents</li>
<li><strong>Compassionate Care:</strong> Patient, gentle approach designed for elderly patients</li>
</ul>
<h2>Frequently Asked Questions</h2>
<h3>How often should elderly residents have dental check-ups?</h3>
<p>We recommend dental check-ups every 6 months for aged care residents in ${location}. Regular visits help prevent serious issues and maintain oral comfort.</p>
<h3>Do you visit aged care facilities in ${location}?</h3>
<p>Yes, our mobile dental team provides on-site visits to aged care facilities throughout the ${location} area. Contact us to arrange a schedule for your facility.</p>
<h3>What dental services do you provide for residents with dementia?</h3>
<p>We have specialized protocols for patients with cognitive impairments, including gentle examination techniques, familiar environment care, and coordination with facility care teams.</p>
<h2>Book a Visit</h2>
<p>Contact Aged Dentistry today to arrange dental care for your ${location} aged care facility. Call us or fill out our online form to get started.</p>`,
  };
}

// ---------------------------------------------------------------------------
// Publish to WordPress as draft
// ---------------------------------------------------------------------------
async function publishToWordPress(
  pageData: { title: string; content_html: string; meta_description: string },
  slug: string,
): Promise<{ wpPageId: number; url: string } | null> {
  const wpUrl = 'https://ageddentistry.org/wp-json/wp/v2/pages';
  const user = process.env.WP_AGEDDENTISTRY_USER;
  const pass = process.env.WP_AGEDDENTISTRY_PASSWORD;

  if (!user || !pass) {
    logger.warn('[prog-seo] WordPress credentials not set — storing locally only');
    return null;
  }

  try {
    const auth = Buffer.from(`${user}:${pass}`).toString('base64');
    const res = await fetch(wpUrl, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', 'Authorization': `Basic ${auth}` },
      body: JSON.stringify({
        title: pageData.title,
        content: pageData.content_html,
        status: 'draft',
        slug,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      logger.error(`[prog-seo] WP publish failed: ${res.status} — ${err.slice(0, 100)}`);
      return null;
    }

    const wpData = await res.json() as { id: number; link: string };
    return { wpPageId: wpData.id, url: wpData.link };
  } catch (e) {
    logger.error(`[prog-seo] WP publish error:`, e instanceof Error ? e.message : String(e));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Generate all location pages
// ---------------------------------------------------------------------------
export async function generateLocationPages(): Promise<{ generated: number; wpPublished: number; errors: number }> {
  await ensureClientPagesTable();

  let generated = 0, wpPublished = 0, errors = 0;

  for (const location of AGED_DENTISTRY_LOCATIONS) {
    try {
      const slug = `aged-care-dental-${location.toLowerCase().replace(/\s+/g, '-')}`;

      // Check if already generated
      try {
        const existing = await pool.query(
          `SELECT id FROM client_pages WHERE client_domain = 'ageddentistry.org' AND page_slug = $1`,
          [slug],
        );
        if (existing.rows.length > 0) {
          logger.info(`[prog-seo] ${location} already exists — skipping`);
          continue;
        }
      } catch { /* table may not exist yet — proceed */ }

      logger.info(`[prog-seo] Generating content for ${location}...`);
      const content = await generatePageContent(location);
      if (!content) { logger.error(`[prog-seo] No content for ${location}`); errors++; continue; }

      // Publish to WordPress
      const wpResult = await publishToWordPress(content, slug);

      // Store in client_pages
      await pool.query(
        `INSERT INTO client_pages (client_domain, page_title, page_slug, page_url, status, page_type, wp_page_id, meta_description, content)
         VALUES ($1, $2, $3, $4, $5, 'programmatic_seo', $6, $7, $8)`,
        [
          'ageddentistry.org', content.title, slug,
          wpResult?.url ?? `https://ageddentistry.org/${slug}/`,
          wpResult ? 'draft_wp' : 'draft_local',
          wpResult?.wpPageId ?? null, content.meta_description, content.content_html,
        ],
      );

      if (wpResult) wpPublished++;
      generated++;
      logger.info(`[prog-seo] Generated: ${location} — ${wpResult?.url ?? 'local only'}`);

      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.error(`[prog-seo] ${location} failed: ${msg}`);
      console.error(`[prog-seo] FULL ERROR for ${location}:`, e);
      errors++;
    }
  }

  // Slack notification
  if (generated > 0) {
    await sendSlackMessage(SLACK_SEO_CHANNEL,
      `🚀 *SEO*: Generated ${generated} programmatic location pages for Aged Dentistry` +
      (wpPublished > 0 ? ` (${wpPublished} published to WordPress as drafts)` : ' (stored locally — WP credentials needed)') +
      `. Review at: /crm/seo`,
    ).catch(() => {});
  }

  return { generated, wpPublished, errors };
}
