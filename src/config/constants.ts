// ---------------------------------------------------------------------------
// Centralized constants — env-first with hardcoded fallbacks
// ---------------------------------------------------------------------------

// -- Slack Channel IDs -------------------------------------------------------
export const SLACK_SOD_EOD_CHANNEL = process.env.SLACK_SOD_EOD_CHANNEL ?? 'C08EMRX2HHN';
export const SLACK_GENERAL_CHANNEL = process.env.SLACK_GENERAL_CHANNEL ?? 'C07489V0RB2';
export const SLACK_SALES_BD_CHANNEL = process.env.SLACK_SALES_BD_CHANNEL ?? 'C0AMPEF302G';
export const SLACK_PERF_MARKETING_CHANNEL = process.env.SLACK_PERF_MARKETING_CHANNEL ?? 'C0ALLQG0SUS';
export const SLACK_SEO_CHANNEL = process.env.SLACK_SEO_CHANNEL ?? 'C09TUDJPS2X';
export const SLACK_OUTREACH_CHANNEL = process.env.SLACK_OUTREACH_CHANNEL ?? 'C0AMPEF302G'; // defaults to #sales-bd until dedicated #outreach channel is created

// -- Slack User IDs ----------------------------------------------------------
export const SLACK_JATIN = process.env.SLACK_JATIN ?? 'U073Y677JBB';
export const SLACK_SAKCHAM = process.env.SLACK_SAKCHAM ?? 'U09TY8RGN30';
export const SLACK_KESHAV = process.env.SLACK_KESHAV ?? 'U073Y6S4K4H';

// -- Meta Graph API ----------------------------------------------------------
export const META_API_BASE = process.env.META_API_BASE ?? 'https://graph.facebook.com/v19.0';

// -- Billing -----------------------------------------------------------------
export const COMPANY_GSTIN = process.env.COMPANY_GSTIN ?? '08DRYPA4899F2ZZ';
export const DEFAULT_SAC_CODE = process.env.DEFAULT_SAC_CODE ?? '9983';

// -- Spend Alerts ------------------------------------------------------------
export const SPEND_ALERT_COOLDOWN_HOURS = Number(process.env.SPEND_ALERT_COOLDOWN_HOURS ?? '6');

// -- Blocker Alerts ----------------------------------------------------------
export const BLOCKER_THRESHOLD_DAYS = Number(process.env.BLOCKER_THRESHOLD_DAYS ?? '2');
export const CRITICAL_THRESHOLD_DAYS = Number(process.env.CRITICAL_THRESHOLD_DAYS ?? '5');

// -- Tenant Slug (for single-tenant queries) ---------------------------------
export const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG ?? 'growth-escalators';
