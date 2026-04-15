import { pool } from '../db/index';
import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Seed client knowledge base with real brand data
// ---------------------------------------------------------------------------
export async function seedClientKnowledgeBase(): Promise<void> {
  // Ensure unique constraint on client_domain (added by ensureSeoTables)
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS client_kb_domain_uniq ON client_knowledge_base(client_domain) WHERE client_domain IS NOT NULL`).catch(() => {});

  const clients = [
    {
      client_domain: 'aarohaom.com',
      brand_name: 'Aaroha Om',
      industry: 'Ayurvedic wellness, spiritual products',
      target_audience: 'Health-conscious Indians 25-50, interested in holistic healing',
      unique_value_prop: 'Authentic ayurvedic formulations with modern accessibility',
      primary_keywords: 'ayurvedic treatment, wellness products, herbal remedies, spiritual wellness, aarohaom',
      tone_of_voice: 'Warm, trustworthy, rooted in tradition yet modern',
      competitors: 'Patanjali, Himalaya, Forest Essentials',
      content_themes: 'Ayurveda benefits, ingredient spotlights, wellness tips, seasonal health guides',
      cta_style: "Gentle discovery — 'Explore our range', 'Learn more'",
      ga4_property_id: '506144010',
      gsc_domain: 'sc-domain:aarohaom.com',
      wordpress_url: 'https://aarohaom.com',
      target_monthly_traffic: 5000,
    },
    {
      client_domain: 'blackpandaenterprises.com',
      brand_name: 'Black Panda Enterprises',
      industry: 'B2B consulting — India market entry, Fractional GCC, US healthcare AI',
      target_audience: 'US/UK companies wanting to enter India, healthcare AI companies, enterprise decision makers',
      unique_value_prop: 'End-to-end India market entry with fractional GCC setup expertise',
      primary_keywords: 'India market entry, fractional GCC, global capability centre India, healthcare AI India, business expansion India',
      tone_of_voice: 'Professional, authoritative, data-driven, enterprise-focused',
      competitors: 'EY, Deloitte, KPMG',
      content_themes: 'India market insights, GCC setup guides, regulatory landscape, cost comparison, case studies',
      cta_style: "High-intent B2B — 'Schedule a consultation', 'Download our guide'",
      ga4_property_id: '513868257',
      gsc_domain: 'sc-domain:blackpandaenterprises.com',
      wordpress_url: 'https://blackpandaenterprises.com',
      target_monthly_traffic: 2000,
    },
    {
      client_domain: 'ageddentistry.org',
      brand_name: 'AGeD — Association of Geriatric Dentistry',
      industry: 'Professional dental association — Geriatric Dentistry training and research in India',
      target_audience: 'Dental professionals, BDS/MDS graduates, dental college faculty, dental students, aged care facility administrators in India',
      unique_value_prop: "India's first and only association dedicated to Geriatric Dentistry — interdisciplinary collaboration between dental, medical, and allied sciences",
      primary_keywords: 'geriatric dentistry india, geriatric dentistry course, dental care for elderly, geriatric dentistry training, aged care dentistry, geriatric dentistry membership',
      tone_of_voice: 'Professional, academic, compassionate, authoritative — speaking to dental professionals and researchers',
      competitors: 'IDA (Indian Dental Association), ISOMR, individual dental colleges offering geriatric modules',
      content_themes: 'Geriatric dentistry education, oral health in elderly, membership benefits, research opportunities, training workshops, dental care for aging India',
      cta_style: "Professional — 'Join as Member', 'Register for Training', 'Attend Symposium'",
      ga4_property_id: '514956819',
      gsc_domain: 'sc-domain:ageddentistry.org',
      wordpress_url: 'https://ageddentistry.org',
      target_monthly_traffic: 1000,
    },
  ];

  for (const c of clients) {
    // Check if this client already exists (by client_domain or project_name containing the domain)
    const existing = await pool.query(
      `SELECT id FROM client_knowledge_base WHERE client_domain = $1 OR project_name ILIKE '%' || $1 || '%' LIMIT 1`,
      [c.client_domain],
    );

    if ((existing.rows as unknown[]).length > 0) {
      // Update existing row
      await pool.query(`
        UPDATE client_knowledge_base SET
          client_domain=$1, brand_name=$2, industry=$3, target_audience=$4, unique_value_prop=$5,
          primary_keywords=$6, tone_of_voice=$7, competitors=$8, content_themes=$9, cta_style=$10,
          ga4_property_id=$11, gsc_domain=$12, wordpress_url=$13, target_monthly_traffic=$14, updated_at=NOW()
        WHERE client_domain = $1 OR project_name ILIKE '%' || $1 || '%'
      `, [c.client_domain, c.brand_name, c.industry, c.target_audience, c.unique_value_prop,
          c.primary_keywords, c.tone_of_voice, c.competitors, c.content_themes, c.cta_style,
          c.ga4_property_id, c.gsc_domain, c.wordpress_url, c.target_monthly_traffic]);
    } else {
      // Insert new row — project_name is NOT NULL in Drizzle schema, use domain as fallback
      await pool.query(`
        INSERT INTO client_knowledge_base (project_name, client_domain, brand_name, industry, target_audience, unique_value_prop,
          primary_keywords, tone_of_voice, competitors, content_themes, cta_style,
          ga4_property_id, gsc_domain, wordpress_url, target_monthly_traffic)
        VALUES ($1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      `, [c.client_domain, c.brand_name, c.industry, c.target_audience, c.unique_value_prop,
          c.primary_keywords, c.tone_of_voice, c.competitors, c.content_themes, c.cta_style,
          c.ga4_property_id, c.gsc_domain, c.wordpress_url, c.target_monthly_traffic]);
    }
  }

  logger.info('[seo-kb] Client knowledge base seeded with 3 clients');
}
