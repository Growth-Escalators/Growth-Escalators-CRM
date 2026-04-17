import { pool } from '../db/index';
import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Bootstrap funnel_configs table (idempotent)
// ---------------------------------------------------------------------------
export async function ensureFunnelConfigTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS funnel_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      is_active BOOLEAN DEFAULT TRUE,

      -- Pricing (all in INR, NULL = not offered)
      base_price INTEGER NOT NULL,
      bump1_price INTEGER,
      bump2_price INTEGER,
      bump1_label TEXT,
      bump2_label TEXT,

      -- Products
      product_name TEXT NOT NULL,
      product_labels JSONB DEFAULT '{}',

      -- Assets (NULL = not applicable)
      main_pdf_url TEXT,
      bump1_pdf_url TEXT,
      bump2_booking_url TEXT,

      -- Messaging
      wa_template_name TEXT,
      wa_msg1_template TEXT,
      wa_msg2_template TEXT,
      wa_msg3_template TEXT,
      email_subject TEXT,
      email_body TEXT,

      -- Pipeline
      pipeline_name TEXT NOT NULL,
      pipeline_stages JSONB NOT NULL,

      -- Sequence
      sequence_name TEXT,

      -- Slack
      slack_channel TEXT,
      slack_emoji TEXT DEFAULT '💰',
      slack_label TEXT DEFAULT 'New Purchase',

      -- Meta
      service_type TEXT DEFAULT 'funnel',

      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(tenant_id, slug)
    )
  `).catch(e => logger.warn(`[funnel-config] ${e instanceof Error ? e.message : String(e)}`));

  await pool.query(`CREATE INDEX IF NOT EXISTS funnel_configs_slug_idx ON funnel_configs(slug)`).catch(() => {});

  // Frontend display fields (added for config-driven checkout)
  const alterStmts = [
    `ALTER TABLE funnel_configs ADD COLUMN IF NOT EXISTS hero_headline TEXT`,
    `ALTER TABLE funnel_configs ADD COLUMN IF NOT EXISTS hero_subheadline TEXT`,
    `ALTER TABLE funnel_configs ADD COLUMN IF NOT EXISTS cta_text TEXT`,
    `ALTER TABLE funnel_configs ADD COLUMN IF NOT EXISTS accent_color TEXT DEFAULT '#F97316'`,
    `ALTER TABLE funnel_configs ADD COLUMN IF NOT EXISTS segment_options JSONB`,
    `ALTER TABLE funnel_configs ADD COLUMN IF NOT EXISTS testimonials JSONB`,
    `ALTER TABLE funnel_configs ADD COLUMN IF NOT EXISTS post_purchase_route TEXT DEFAULT '/thank-you'`,
    `ALTER TABLE funnel_configs ADD COLUMN IF NOT EXISTS brand_names JSONB`,
    `ALTER TABLE funnel_configs ADD COLUMN IF NOT EXISTS bump1_description TEXT`,
    `ALTER TABLE funnel_configs ADD COLUMN IF NOT EXISTS bump2_description TEXT`,
    `ALTER TABLE funnel_configs ADD COLUMN IF NOT EXISTS main_product_description TEXT`,
  ];
  for (const s of alterStmts) {
    await pool.query(s).catch(() => {});
  }

  logger.info('[funnel-config] Table bootstrapped');
}

// ---------------------------------------------------------------------------
// Get funnel config by slug
// ---------------------------------------------------------------------------
export async function getFunnelConfig(slug: string, tenantId?: string): Promise<FunnelConfig | null> {
  const query = tenantId
    ? `SELECT * FROM funnel_configs WHERE slug = $1 AND tenant_id = $2 AND is_active = TRUE LIMIT 1`
    : `SELECT * FROM funnel_configs WHERE slug = $1 AND is_active = TRUE LIMIT 1`;
  const params = tenantId ? [slug, tenantId] : [slug];
  const result = await pool.query(query, params);
  return result.rows.length > 0 ? (result.rows[0] as FunnelConfig) : null;
}

// ---------------------------------------------------------------------------
// List all funnel configs
// ---------------------------------------------------------------------------
export async function listFunnelConfigs(tenantId: string): Promise<FunnelConfig[]> {
  const result = await pool.query(
    `SELECT * FROM funnel_configs WHERE tenant_id = $1 ORDER BY created_at ASC`,
    [tenantId],
  );
  return result.rows as FunnelConfig[];
}

// ---------------------------------------------------------------------------
// Calculate tier amounts from config
// ---------------------------------------------------------------------------
export function calculateTierAmounts(config: FunnelConfig): { tiers: Array<{ amount: number; stage: string; label: string }> } {
  const base = config.base_price;
  const b1 = config.bump1_price ?? 0;
  const b2 = config.bump2_price ?? 0;

  const tiers: Array<{ amount: number; stage: string; label: string }> = [];

  // Base only
  tiers.push({ amount: base, stage: `Paid ₹${base}`, label: config.product_name });

  // Base + bump1
  if (b1 > 0) {
    const combo1 = base + b1;
    tiers.push({ amount: combo1, stage: `Paid ₹${combo1}`, label: `${config.product_name} + ${config.bump1_label || 'Add-on'}` });
  }

  // Base + bump2
  if (b2 > 0) {
    const combo2 = base + b2;
    tiers.push({ amount: combo2, stage: `Paid ₹${combo2}`, label: `${config.product_name} + ${config.bump2_label || 'Call'}` });
  }

  // Base + bump1 + bump2
  if (b1 > 0 && b2 > 0) {
    const combo3 = base + b1 + b2;
    tiers.push({ amount: combo3, stage: `Paid ₹${combo3}`, label: `${config.product_name} Complete Bundle` });
  }

  return { tiers };
}

// ---------------------------------------------------------------------------
// Match payment amount to stage name
// ---------------------------------------------------------------------------
export function stageForAmount(config: FunnelConfig, amount: number): string {
  const { tiers } = calculateTierAmounts(config);
  // Find closest tier (within ₹5 tolerance for payment rounding)
  for (const tier of tiers.sort((a, b) => b.amount - a.amount)) {
    if (Math.abs(amount - tier.amount) <= 5) return tier.stage;
  }
  return tiers[0]?.stage || `Paid ₹${amount}`;
}

// ---------------------------------------------------------------------------
// Get product label for a stage
// ---------------------------------------------------------------------------
export function labelForStage(config: FunnelConfig, stage: string): string {
  const { tiers } = calculateTierAmounts(config);
  const tier = tiers.find(t => t.stage === stage);
  return tier?.label || config.product_name;
}

// ---------------------------------------------------------------------------
// Seed default funnel configs (only if table is empty for tenant)
// ---------------------------------------------------------------------------
export async function seedDefaultFunnelConfigs(tenantId: string): Promise<void> {
  const existing = await pool.query(`SELECT COUNT(*)::int AS c FROM funnel_configs WHERE tenant_id = $1`, [tenantId]);
  if ((existing.rows[0] as { c: number }).c > 0) return;

  const configs = [
    {
      slug: 'ecom',
      name: 'Ecom Funnel',
      base_price: 9,
      bump1_price: 199,
      bump2_price: 499,
      bump1_label: 'Advanced D2C Growth Kit',
      bump2_label: '45-min Meta Ads Audit Call',
      product_name: 'D2C Funnel Breakdown Pack',
      product_labels: JSON.stringify({
        base: 'D2C Funnel Breakdown Pack',
        bump1: 'D2C Funnel Pack + Growth Kit',
        bump2: 'D2C Funnel Pack + Growth Audit',
        all: 'D2C Complete Bundle',
      }),
      main_pdf_url: 'https://pub-42526281354a42f3879bd56bed4ad62b.r2.dev/5%20Winning%20D2C%20Brands.pdf',
      bump1_pdf_url: 'https://pub-42526281354a42f3879bd56bed4ad62b.r2.dev/Advanced%20D2C%20Growth%20Kit%20Latest.pdf',
      bump2_booking_url: 'https://cal.com/growth-escalators/discovery-call',
      wa_template_name: 'ge_welcome_d2c',
      wa_msg1_template: 'Hi {firstName}! 🎉 Your purchase is confirmed. Here is your {productName} — download it now, it is yours forever: {mainPdfUrl}\n\nThis PDF breaks down exactly what 5 winning D2C brands are doing on Meta right now. Go through Section 2 first — that is where most brands find their biggest insight.\n\nReply anytime if you have questions. — Jatin from Growth Escalators',
      wa_msg2_template: 'Your {bump1Label} is also ready! 📦 Download it here: {bump1PdfUrl}\n\nInside you will find swipe files, ad templates, landing page frameworks, and the Meta ads checklist. Start with the checklist — it takes 10 minutes and shows you exactly where your funnel is leaking. — Jatin',
      wa_msg3_template: 'Your {bump2Label} is confirmed! 🎯\n\nBook your slot here (slots fill fast): {bump2BookingUrl}\n\nCome prepared with:\n- Your current ROAS or CPL\n- Your top 2-3 running creatives\n- Your biggest challenge right now\n\nJatin will review your live account and give you 3 specific fixes. See you on the call!',
      email_subject: 'Your {productName} is ready, {firstName} 🎯',
      email_body: 'Hi {firstName},\n\nYour purchase is confirmed! Here is everything you have access to:\n\n📄 {productName}:\n{mainPdfUrl}\n\n{bump1Section}{bump2Section}Start with the PDF — go through Section 2 first. Most people find their biggest insight there.\n\nReply to this email if you have any questions.\n\n— Jatin Agrawal\nFounder, Growth Escalators',
      pipeline_name: 'D2C Prospects',
      pipeline_stages: JSON.stringify(['Paid ₹9', 'Paid ₹208', 'Paid ₹508', 'Paid ₹707', 'Appointment Booked', 'No Show', 'Converted', 'Lost']),
      sequence_name: 'D2C Lead Nurture',
      slack_emoji: '💰',
      slack_label: 'New Ecom Purchase',
      service_type: 'ecom',
    },
    {
      slug: 'doctors',
      name: 'Doctors Funnel',
      base_price: 49,
      bump1_price: 299,
      bump2_price: 999,
      bump1_label: 'Clinic Growth Kit',
      bump2_label: '1-on-1 Practice Strategy Call',
      product_name: 'Patient Acquisition Blueprint',
      product_labels: JSON.stringify({
        base: 'Patient Acquisition Blueprint',
        bump1: 'Patient Blueprint + Clinic Growth Kit',
        bump2: 'Patient Blueprint + Strategy Call',
        all: 'Doctors Complete Bundle',
      }),
      main_pdf_url: null, // To be uploaded later
      bump1_pdf_url: null,
      bump2_booking_url: 'https://cal.com/growth-escalators/doctors-strategy',
      wa_template_name: 'ge_welcome_doctors',
      wa_msg1_template: 'Hi Dr. {firstName}! 🎉 Your purchase is confirmed. Here is your {productName}: {mainPdfUrl}\n\nThis guide shows how top clinics in India are acquiring 50+ new patients per month using digital marketing. Start with Chapter 3 — the Google Maps strategy alone can double your walk-ins.\n\nReply anytime if you have questions. — Jatin from Growth Escalators',
      wa_msg2_template: 'Your {bump1Label} is ready! 📦 Download here: {bump1PdfUrl}\n\nInside: patient communication templates, Google review automation scripts, social media content calendar for clinics, and the clinic website audit checklist.',
      wa_msg3_template: 'Your {bump2Label} is confirmed! 🎯\n\nBook your slot: {bump2BookingUrl}\n\nCome prepared with:\n- Your current monthly patient count\n- Your Google Business Profile link\n- Your biggest growth challenge\n\nJatin will review your online presence and give you 3 specific fixes.',
      email_subject: 'Your {productName} is ready, Dr. {firstName} 🎯',
      email_body: 'Hi Dr. {firstName},\n\nYour purchase is confirmed! Here is everything you have access to:\n\n📄 {productName}:\n{mainPdfUrl}\n\n{bump1Section}{bump2Section}Start with Chapter 3 — the Google Maps strategy works for 90% of clinics.\n\nReply to this email if you have any questions.\n\n— Jatin Agrawal\nFounder, Growth Escalators',
      pipeline_name: 'Doctors Pipeline',
      pipeline_stages: JSON.stringify(['Paid ₹49', 'Paid ₹348', 'Paid ₹1048', 'Paid ₹1347', 'Consultation Booked', 'No Show', 'Converted', 'Lost']),
      sequence_name: 'Doctors Nurture',
      slack_emoji: '🩺',
      slack_label: 'New Doctor Purchase',
      service_type: 'doctors',
    },
    {
      slug: 'real-estate',
      name: 'Real Estate Funnel',
      base_price: 29,
      bump1_price: 199,
      bump2_price: 799,
      bump1_label: 'RE Lead Gen Advanced Kit',
      bump2_label: 'Sales Funnel Strategy Session',
      product_name: 'Real Estate Lead Generation Playbook',
      product_labels: JSON.stringify({
        base: 'RE Lead Generation Playbook',
        bump1: 'RE Playbook + Advanced Kit',
        bump2: 'RE Playbook + Strategy Session',
        all: 'Real Estate Complete Bundle',
      }),
      main_pdf_url: null,
      bump1_pdf_url: null,
      bump2_booking_url: 'https://cal.com/growth-escalators/real-estate-strategy',
      wa_template_name: 'ge_welcome_realestate',
      wa_msg1_template: 'Hi {firstName}! 🎉 Your purchase is confirmed. Here is your {productName}: {mainPdfUrl}\n\nThis playbook shows how top real estate agents generate 100+ qualified leads per month. Start with the Facebook Lead Ads section — it has the highest ROI for real estate.\n\nReply anytime if you have questions. — Jatin from Growth Escalators',
      wa_msg2_template: 'Your {bump1Label} is ready! 📦 Download here: {bump1PdfUrl}\n\nInside: property listing templates, lead nurture sequences, site visit booking automation, and the WhatsApp follow-up scripts that convert.',
      wa_msg3_template: 'Your {bump2Label} is confirmed! 🎯\n\nBook your slot: {bump2BookingUrl}\n\nCome prepared with:\n- Your current lead source (portals, ads, referrals)\n- Your average deal size\n- Your conversion rate from lead to site visit\n\nWe will build a custom funnel strategy for your market.',
      email_subject: 'Your {productName} is ready, {firstName} 🎯',
      email_body: 'Hi {firstName},\n\nYour purchase is confirmed! Here is everything you have access to:\n\n📄 {productName}:\n{mainPdfUrl}\n\n{bump1Section}{bump2Section}Start with the Facebook Lead Ads section — it works for 95% of real estate markets in India.\n\nReply to this email if you have any questions.\n\n— Jatin Agrawal\nFounder, Growth Escalators',
      pipeline_name: 'Real Estate Pipeline',
      pipeline_stages: JSON.stringify(['Paid ₹29', 'Paid ₹228', 'Paid ₹828', 'Paid ₹1027', 'Site Visit Booked', 'No Show', 'Converted', 'Lost']),
      sequence_name: 'Real Estate Nurture',
      slack_emoji: '🏠',
      slack_label: 'New Real Estate Purchase',
      service_type: 'real_estate',
    },
  ];

  for (const c of configs) {
    await pool.query(
      `INSERT INTO funnel_configs (tenant_id, slug, name, is_active, base_price, bump1_price, bump2_price, bump1_label, bump2_label,
        product_name, product_labels, main_pdf_url, bump1_pdf_url, bump2_booking_url,
        wa_template_name, wa_msg1_template, wa_msg2_template, wa_msg3_template, email_subject, email_body,
        pipeline_name, pipeline_stages, sequence_name, slack_emoji, slack_label, service_type)
       VALUES ($1,$2,$3,TRUE,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
       ON CONFLICT (tenant_id, slug) DO NOTHING`,
      [tenantId, c.slug, c.name, c.base_price, c.bump1_price, c.bump2_price, c.bump1_label, c.bump2_label,
       c.product_name, c.product_labels, c.main_pdf_url, c.bump1_pdf_url, c.bump2_booking_url,
       c.wa_template_name, c.wa_msg1_template, c.wa_msg2_template, c.wa_msg3_template, c.email_subject, c.email_body,
       c.pipeline_name, c.pipeline_stages, c.sequence_name, c.slack_emoji, c.slack_label, c.service_type],
    );
  }

  logger.info('[funnel-config] Default funnel configs seeded (ecom, doctors, real-estate)');

  // Seed frontend fields for existing configs (idempotent — only fills NULL fields)
  const frontendSeeds = [
    { slug: 'ecom', hero_headline: 'See Exactly How India\'s Top 5 D2C Brands Build Their Funnels', hero_subheadline: 'Get the exact funnel breakdown that helps Indian brands scale past ₹10L/month on Meta', cta_text: 'Get Instant Access for ₹9', accent_color: '#F97316', segment_options: JSON.stringify([{id:'d2c',label:'I run a D2C Brand',icon:'🛍️'},{id:'agency',label:'I run an Agency',icon:'🏢'},{id:'freelancer',label:'I am a Freelancer',icon:'💻'}]), brand_names: JSON.stringify(['boAt','GIVA','Minimalist','Libas','SUGAR']), post_purchase_route: '/consulting', main_product_description: 'PDF breaking down exactly what 5 winning D2C brands are doing on Meta right now', bump1_description: 'Ad templates, landing page swipe file, Meta ads checklist, WA sequences', bump2_description: 'Live Meta account review with Jatin — 3 specific fixes for your campaigns' },
    { slug: 'doctors', hero_headline: 'How Top Doctors Get 50+ New Patients Every Month', hero_subheadline: 'The exact digital marketing playbook used by India\'s leading clinics', cta_text: 'Get Your Blueprint for ₹49', accent_color: '#10B981', segment_options: JSON.stringify([{id:'clinic_owner',label:'I own a Clinic/Hospital',icon:'🏥'},{id:'solo_practitioner',label:'I am a Solo Practitioner',icon:'👨‍⚕️'},{id:'dental',label:'I run a Dental Practice',icon:'🦷'}]), brand_names: JSON.stringify(['Apollo','Practo','PharmEasy','1mg','Pristyn Care']), post_purchase_route: '/doctors-welcome', main_product_description: 'Guide showing how top clinics acquire 50+ patients per month using digital marketing', bump1_description: 'Patient communication templates, Google review automation, social media calendar for clinics', bump2_description: 'Live review of your online presence with Jatin — 3 fixes to double your patient walk-ins' },
    { slug: 'real-estate', hero_headline: 'Generate 100+ Qualified Property Leads Every Month', hero_subheadline: 'The lead generation playbook used by India\'s top real estate agents', cta_text: 'Get Your Playbook for ₹29', accent_color: '#3B82F6', segment_options: JSON.stringify([{id:'agent',label:'I am a Real Estate Agent',icon:'🏠'},{id:'builder',label:'I am a Builder/Developer',icon:'🏗️'},{id:'broker',label:'I run a Brokerage Firm',icon:'🏢'}]), brand_names: JSON.stringify(['MagicBricks','99acres','Housing.com','NoBroker','Square Yards']), post_purchase_route: '/realestate-welcome', main_product_description: 'Playbook showing how top agents generate 100+ qualified leads per month', bump1_description: 'Property listing templates, lead nurture sequences, site visit booking automation', bump2_description: 'Custom funnel strategy session for your market — we build the plan together' },
  ];
  for (const s of frontendSeeds) {
    await pool.query(
      `UPDATE funnel_configs SET
        hero_headline = COALESCE(hero_headline, $2), hero_subheadline = COALESCE(hero_subheadline, $3),
        cta_text = COALESCE(cta_text, $4), accent_color = COALESCE(accent_color, $5),
        segment_options = COALESCE(segment_options, $6::jsonb), brand_names = COALESCE(brand_names, $7::jsonb),
        post_purchase_route = COALESCE(post_purchase_route, $8),
        main_product_description = COALESCE(main_product_description, $9),
        bump1_description = COALESCE(bump1_description, $10), bump2_description = COALESCE(bump2_description, $11)
       WHERE tenant_id = $12 AND slug = $1`,
      [s.slug, s.hero_headline, s.hero_subheadline, s.cta_text, s.accent_color, s.segment_options, s.brand_names, s.post_purchase_route, s.main_product_description, s.bump1_description, s.bump2_description, tenantId],
    ).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Replace message placeholders
// ---------------------------------------------------------------------------
export function renderTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value || '');
  }
  return result;
}

// ---------------------------------------------------------------------------
// Bootstrap purchase_delivery_log table (idempotent)
// ---------------------------------------------------------------------------
export async function ensureDeliveryLogTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS purchase_delivery_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      contact_id UUID NOT NULL,
      funnel_slug TEXT NOT NULL,

      wa_status TEXT DEFAULT 'pending',
      wa_error TEXT,
      wa_sent_at TIMESTAMP,
      wa_delivered_at TIMESTAMP,
      wa_read_at TIMESTAMP,

      email_status TEXT DEFAULT 'pending',
      email_error TEXT,
      email_sent_at TIMESTAMP,
      email_opened_at TIMESTAMP,
      email_clicked_at TIMESTAMP,

      manual_followup_needed BOOLEAN DEFAULT FALSE,
      manual_followup_done BOOLEAN DEFAULT FALSE,
      manual_followup_by UUID,

      created_at TIMESTAMP DEFAULT NOW()
    )
  `).catch(e => logger.warn(`[delivery-log] ${e instanceof Error ? e.message : String(e)}`));

  // Add retry columns (idempotent — safe for existing tables)
  await pool.query(`ALTER TABLE purchase_delivery_log ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0`).catch(() => {});
  await pool.query(`ALTER TABLE purchase_delivery_log ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP`).catch(() => {});

  await pool.query(`CREATE INDEX IF NOT EXISTS pdl_contact_idx ON purchase_delivery_log(contact_id)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS pdl_funnel_idx ON purchase_delivery_log(funnel_slug)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS pdl_manual_idx ON purchase_delivery_log(manual_followup_needed) WHERE manual_followup_needed = TRUE`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS pdl_retry_idx ON purchase_delivery_log(next_retry_at) WHERE retry_count < 3 AND next_retry_at IS NOT NULL`).catch(() => {});

  logger.info('[delivery-log] Table bootstrapped');
}

// ---------------------------------------------------------------------------
// Type definition
// ---------------------------------------------------------------------------
export interface FunnelConfig {
  id: string;
  tenant_id: string;
  slug: string;
  name: string;
  is_active: boolean;
  base_price: number;
  bump1_price: number | null;
  bump2_price: number | null;
  bump1_label: string | null;
  bump2_label: string | null;
  product_name: string;
  product_labels: Record<string, string>;
  main_pdf_url: string | null;
  bump1_pdf_url: string | null;
  bump2_booking_url: string | null;
  wa_template_name: string | null;
  wa_msg1_template: string | null;
  wa_msg2_template: string | null;
  wa_msg3_template: string | null;
  email_subject: string | null;
  email_body: string | null;
  pipeline_name: string;
  pipeline_stages: string[];
  sequence_name: string | null;
  slack_channel: string | null;
  slack_emoji: string;
  slack_label: string;
  service_type: string;
  created_at: string;
  updated_at: string;
}
