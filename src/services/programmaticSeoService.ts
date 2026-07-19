import { pool } from '../db/index';
import logger from '../utils/logger';
import { sendSlackMessage } from './slackService';
import { SLACK_SEO_CHANNEL } from '../config/constants';
import { resolveDefaultSeoTenantId } from './seoTenantContext';

// AGeD programmatic pages — 3 categories for Indian dental professionals
const AGED_PAGES = [
  // Category 1: City membership pages
  { slug: 'geriatric-dentistry-mumbai', title: 'Geriatric Dentistry Mumbai — Join AGeD', category: 'city' },
  { slug: 'geriatric-dentistry-delhi', title: 'Geriatric Dentistry Delhi — Join AGeD', category: 'city' },
  { slug: 'geriatric-dentistry-bengaluru', title: 'Geriatric Dentistry Bengaluru — Join AGeD', category: 'city' },
  { slug: 'geriatric-dentistry-chennai', title: 'Geriatric Dentistry Chennai — Join AGeD', category: 'city' },
  { slug: 'geriatric-dentistry-hyderabad', title: 'Geriatric Dentistry Hyderabad — Join AGeD', category: 'city' },
  // Category 2: Training pages
  { slug: 'geriatric-dentistry-course-india', title: 'Geriatric Dentistry Course in India', category: 'training' },
  { slug: 'geriatric-dentistry-training-program', title: 'Training Programs for Dentists in Geriatric Care', category: 'training' },
  { slug: 'dental-care-elderly-patients-training', title: 'Treating Elderly Dental Patients — Training', category: 'training' },
  { slug: 'geriatric-dentistry-certification', title: 'Certification in Geriatric Dentistry', category: 'training' },
  { slug: 'geriatric-dentistry-workshop', title: 'Workshops and CME Programs — AGeD', category: 'training' },
  // Category 3: Awareness pages
  { slug: 'oral-health-elderly-india', title: 'Oral Health in Elderly — India', category: 'awareness' },
  { slug: 'dental-problems-aging-population', title: 'Common Dental Problems in Aging Population', category: 'awareness' },
  { slug: 'importance-geriatric-dentistry', title: 'Why Geriatric Dentistry Matters', category: 'awareness' },
  { slug: 'dental-care-senior-citizens-india', title: 'Dental Care for Senior Citizens in India', category: 'awareness' },
  { slug: 'join-aged-membership', title: 'Join AGeD — Membership Benefits for Dental Professionals', category: 'awareness' },
];

// ---------------------------------------------------------------------------
// Ensure client_pages table exists
// ---------------------------------------------------------------------------
export async function ensureClientPagesTable(): Promise<void> {
  // The client_pages table exists from Drizzle schema with different columns
  // Add the columns we need for programmatic SEO
  const alters = [
    `ALTER TABLE client_pages ADD COLUMN IF NOT EXISTS client_domain TEXT`,
    `ALTER TABLE client_pages ADD COLUMN IF NOT EXISTS page_slug TEXT`,
    `ALTER TABLE client_pages ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft'`,
    `ALTER TABLE client_pages ADD COLUMN IF NOT EXISTS page_type TEXT DEFAULT 'manual'`,
    `ALTER TABLE client_pages ADD COLUMN IF NOT EXISTS meta_description TEXT`,
    `ALTER TABLE client_pages ADD COLUMN IF NOT EXISTS content TEXT`,
  ];
  for (const s of alters) await pool.query(s).catch(() => {});
}

// ---------------------------------------------------------------------------
// Generate content using Claude Haiku
// ---------------------------------------------------------------------------
async function generatePageContent(pageTitle: string): Promise<{
  title: string; meta_description: string; h1: string; content_html: string;
} | null> {
  const apiKey = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.warn('[prog-seo] No Claude API key — using template fallback');
    return generateFallbackContent(pageTitle);
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
          content: `You are writing SEO content for AGeD — Association of Geriatric Dentistry, India's premier professional association for geriatric dental care.

Write a complete page for: ${pageTitle}

Target audience: Dental professionals in India — BDS/MDS graduates, faculty, students
Goal: Generate leads for AGeD membership, training programs, and events

Include:
1. SEO Title (60 chars max)
2. Meta description (155 chars max) — include a clear CTA
3. H1 heading
4. Introduction (150 words) — why this topic matters for dental professionals in India
5. Main content section (200 words) — what AGeD offers related to this topic
6. Benefits section — 3 bullet points for dental professionals who join/attend
7. Call to action — Join AGeD, Register for next event, or Contact us
8. FAQ (3 questions relevant to this topic)

Tone: Professional, academic, warm. Written for Indian dental professionals.
Return ONLY valid JSON: { "title": "...", "meta_description": "...", "h1": "...", "content_html": "<h1>...</h1>..." }`,
        }],
      }),
    });

    if (!res.ok) {
      logger.error(`[prog-seo] Claude API ${res.status} for ${pageTitle}`);
      return generateFallbackContent(pageTitle);
    }

    const data = await res.json() as { content?: Array<{ type: string; text: string }> };
    const text = data.content?.find(c => c.type === 'text')?.text ?? '';
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace <= firstBrace) return generateFallbackContent(pageTitle);

    return JSON.parse(text.slice(firstBrace, lastBrace + 1));
  } catch (e) {
    logger.error(`[prog-seo] Content generation failed for ${pageTitle}:`, e instanceof Error ? e.message : String(e));
    return generateFallbackContent(pageTitle);
  }
}

function generateFallbackContent(pageTitle: string): {
  title: string; meta_description: string; h1: string; content_html: string;
} {
  return {
    title: `${pageTitle} | AGeD India`,
    meta_description: `${pageTitle} — Join AGeD, India's premier association for geriatric dentistry. Training, research, and professional development for dental professionals.`,
    h1: pageTitle,
    content_html: `<h1>${pageTitle}</h1>
<p>AGeD — the Association of Geriatric Dentistry — is India's first and only professional body dedicated to advancing geriatric dental care. We bring together dental professionals, researchers, and educators committed to improving oral health outcomes for India's aging population.</p>
<h2>What AGeD Offers</h2>
<p>As a member, you gain access to specialized training programs, continuing dental education workshops, research collaboration opportunities, and a network of dental professionals focused on geriatric care. Our programs are designed for BDS and MDS graduates, dental faculty, and practitioners looking to expand their expertise in elderly dental care.</p>
<h2>Why Join AGeD</h2>
<ul>
<li><strong>Professional Growth:</strong> Specialized training in geriatric dentistry — a rapidly growing field in India</li>
<li><strong>Research Opportunities:</strong> Collaborate on cutting-edge research in elderly oral health</li>
<li><strong>Network:</strong> Connect with India's leading geriatric dentistry professionals</li>
</ul>
<h2>Get Involved</h2>
<p>Join AGeD today and be part of India's geriatric dentistry movement. Visit our membership page to register, or contact us to learn about upcoming events and training programs.</p>`,
  };
}

// ---------------------------------------------------------------------------
// Publish to WordPress as draft
// ---------------------------------------------------------------------------
async function publishToWordPress(
  pageData: { title: string; content_html: string; meta_description: string },
  slug: string,
): Promise<{ wpPageId: number; url: string } | null> {
  const wpBaseUrl = process.env.WP_AGEDDENTISTRY_URL || 'https://ageddentistry.org';
  const wpUrl = `${wpBaseUrl}/wp-json/wp/v2/pages`;
  const user = process.env.WP_AGEDDENTISTRY_USER;
  const pass = process.env.WP_AGEDDENTISTRY_PASS || process.env.WP_AGEDDENTISTRY_PASSWORD;

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
  const tenantId = await resolveDefaultSeoTenantId();

  let generated = 0, wpPublished = 0, errors = 0;

  for (const pageDef of AGED_PAGES) {
    const slug = pageDef.slug;
    const location = pageDef.title; // Used as the page title for generation
    try {

      // Check if already generated
      try {
        const existing = await pool.query(
          `SELECT id FROM client_pages WHERE client_domain = 'ageddentistry.org' AND page_slug = $1 AND tenant_id = $2`,
          [slug, tenantId],
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

      // Store in client_pages (existing Drizzle table with UUID PK)
      await pool.query(
        `INSERT INTO client_pages (id, project_name, page_url, page_title, wp_post_id, client_domain, page_slug, status, page_type, meta_description, content, tenant_id)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 'programmatic_seo', $8, $9, $10)`,
        [
          'ageddentistry.org',
          wpResult?.url ?? `https://ageddentistry.org/${slug}/`,
          content.title,
          wpResult?.wpPageId ?? null,
          'ageddentistry.org', slug,
          wpResult ? 'draft_wp' : 'draft_local',
          content.meta_description, content.content_html,
          tenantId,
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
      `. Review at: /seo`,
    ).catch(() => {});
  }

  return { generated, wpPublished, errors };
}

// ---------------------------------------------------------------------------
// Publish pending pages to WordPress (ones stored as draft_local)
// ---------------------------------------------------------------------------
export async function publishPendingToWordPress(): Promise<{ published: number; failed: number; urls: string[] }> {
  await ensureClientPagesTable();
  const tenantId = await resolveDefaultSeoTenantId();

  const result = await pool.query(
    `SELECT id, page_title, page_slug, content, meta_description
     FROM client_pages
     WHERE client_domain = 'ageddentistry.org' AND status = 'draft_local' AND tenant_id = $1
     ORDER BY id`,
    [tenantId],
  );

  let published = 0, failed = 0;
  const urls: string[] = [];

  // Deduplicate by slug (keep first occurrence)
  const seen = new Set<string>();
  const pages = (result.rows as Array<Record<string, unknown>>).filter(p => {
    const slug = p.page_slug as string;
    if (seen.has(slug)) return false;
    seen.add(slug);
    return true;
  });

  for (const page of pages) {
    try {
      const wpResult = await publishToWordPress(
        { title: page.page_title as string, content_html: page.content as string, meta_description: page.meta_description as string },
        page.page_slug as string,
      );

      if (wpResult) {
        // Update ALL rows with this slug (handles duplicates)
        await pool.query(
          `UPDATE client_pages SET status = 'draft_wp', wp_post_id = $1, page_url = $2
           WHERE client_domain = 'ageddentistry.org' AND page_slug = $3 AND tenant_id = $4`,
          [wpResult.wpPageId, wpResult.url, page.page_slug, tenantId],
        );
        published++;
        urls.push(wpResult.url);
        logger.info(`[prog-seo] Published to WP: ${page.page_title} → ${wpResult.url}`);
      } else {
        failed++;
      }

      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      logger.error(`[prog-seo] WP publish failed for ${page.page_slug}:`, e instanceof Error ? e.message : String(e));
      failed++;
    }
  }

  if (published > 0) {
    const wpAdmin = (process.env.WP_AGEDDENTISTRY_URL || 'https://ageddentistry.org') + '/wp-admin/edit.php?post_type=page';
    await sendSlackMessage(SLACK_SEO_CHANNEL,
      `🚀 *SEO*: Published ${published} programmatic pages to ageddentistry.org as drafts.\nReview at: ${wpAdmin}`,
    ).catch(() => {});
  }

  return { published, failed, urls };
}
