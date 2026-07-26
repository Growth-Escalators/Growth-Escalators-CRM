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
export const SLACK_SOCIAL_MEDIA_CHANNEL = process.env.SLACK_SOCIAL_MEDIA_CHANNEL ?? 'C0BA1F33BL0';

// -- Slack User IDs ----------------------------------------------------------
export const SLACK_JATIN = process.env.SLACK_JATIN ?? 'U073Y677JBB';
export const SLACK_SAKCHAM = process.env.SLACK_SAKCHAM ?? 'U09TY8RGN30';
export const SLACK_KESHAV = process.env.SLACK_KESHAV ?? 'U073Y6S4K4H';
export const SLACK_KANISHK = process.env.SLACK_KANISHK ?? 'U0B9APK7C76';
export const SLACK_KRATIKA = process.env.SLACK_KRATIKA ?? 'U0B90Q27QKD';
export const SLACK_SNEHA = process.env.SLACK_SNEHA ?? 'U0BA1DYGD6U';

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

// -- SEO: GSC "Request Indexing" queue ----------------------------------------
// There is no supported API for requesting indexing on ordinary pages (Google's
// Indexing API is restricted to Job Posting / Livestream structured data) — so
// this is a human-in-the-loop queue: we track candidate URLs and remind Jatin
// to click "Request Indexing" himself in the GSC UI. See seoIndexingQueueService.ts.
export const SEO_INDEXING_SITEMAP_URL = process.env.SEO_INDEXING_SITEMAP_URL ?? 'https://growthescalators.com/sitemap.xml';
// Keep well under GSC's per-day URL Inspection quota (~10-12/day) since this is
// a *weekly* batch — don't hand Jatin a wall of 50 links at once.
export const SEO_INDEXING_WEEKLY_LIMIT = Number(process.env.SEO_INDEXING_WEEKLY_LIMIT ?? '10');

// -- Wizmatch Staffing Module ------------------------------------------------
export const WIZMATCH_TENANT_ID = process.env.WIZMATCH_TENANT_ID ?? '';
export const WIZMATCH_LEADS_CHANNEL = process.env.WIZMATCH_LEADS_CHANNEL ?? '';
export const WIZMATCH_DAILY_CHANNEL = process.env.WIZMATCH_DAILY_CHANNEL ?? '';
export const WIZMATCH_SYSTEM_CHANNEL = process.env.WIZMATCH_SYSTEM_CHANNEL ?? '';
export const WIZMATCH_PHYSICAL_ADDRESS = process.env.WIZMATCH_PHYSICAL_ADDRESS ?? 'Wizmatch LLC, Newark, DE, USA';
export const WIZMATCH_UNSUBSCRIBE_HMAC_SECRET = process.env.WIZMATCH_UNSUBSCRIBE_HMAC_SECRET ?? '';
export const WIZMATCH_MEETING_URL = process.env.WIZMATCH_MEETING_URL ?? 'https://cal.com/wizmatch/intro';

// Branding for generated documents (RTR, requirement sheets). Override per-env.
export const WIZMATCH_BRAND_NAME = process.env.WIZMATCH_BRAND_NAME ?? 'Wizmatch';
export const WIZMATCH_BRAND_TAGLINE = process.env.WIZMATCH_BRAND_TAGLINE ?? 'IT Staffing & Consulting — US & India';
export const WIZMATCH_BRAND_EMAIL = process.env.WIZMATCH_BRAND_EMAIL ?? 'team@getwizmatch.com';
export const WIZMATCH_BRAND_WEBSITE = process.env.WIZMATCH_BRAND_WEBSITE ?? 'getwizmatch.com';
export const WIZMATCH_BRAND_PHONE = process.env.WIZMATCH_BRAND_PHONE ?? '';
export const WIZMATCH_BRAND_ACCENT = process.env.WIZMATCH_BRAND_ACCENT ?? '#3b82f6';

// ── Region / India-only sourcing ────────────────────────────────────────────
// Wizmatch sources IN-market hiring only. When WIZMATCH_INDIA_ONLY is true
// (default), ingestion (ATS poller + X-Ray) drops confident-US jobs and the
// Signals list defaults to an India-only view. Set WIZMATCH_INDIA_ONLY=false to
// restore the earlier US+India behaviour. No infra change is required to deploy.
export const WIZMATCH_INDIA_ONLY = process.env.WIZMATCH_INDIA_ONLY !== 'false';

// India city/region markers. Kept in sync with detectRegion() in
// src/services/wizmatchScoring.ts — a location matching any of these is India.
export const INDIA_LOCATION_MARKERS: readonly string[] = [
  'india', 'bharat', 'bangalore', 'bengaluru', 'hyderabad', 'pune', 'chennai',
  'mumbai', 'delhi', 'new delhi', 'gurgaon', 'gurugram', 'noida', 'kolkata',
  'ahmedabad', 'kochi', 'cochin', 'coimbatore', 'indore', 'chandigarh', 'jaipur',
  'trivandrum', 'thiruvananthapuram', 'nagpur', 'visakhapatnam', 'vizag',
  'mysuru', 'mysore', 'karnataka', 'telangana', 'maharashtra', 'tamil nadu', 'ncr',
];

// Confident-US markers (well-known US-only city/state/country tokens). Used ONLY
// to EXCLUDE clearly-US rows — deliberately omits ambiguous 2-letter state codes
// to avoid false positives. Blank/remote/ambiguous is never treated as US.
export const US_LOCATION_MARKERS: readonly string[] = [
  'united states', 'u.s.a', 'usa', 'u.s.', 'america',
  'new york', 'nyc', 'san francisco', 'bay area', 'silicon valley', 'seattle',
  'austin', 'dallas', 'houston', 'denver', 'boston', 'chicago', 'atlanta',
  'los angeles', 'san jose', 'sunnyvale', 'mountain view', 'palo alto',
  'washington', 'phoenix', 'miami', 'san diego', 'portland', 'philadelphia',
  'texas', 'california', 'florida', 'illinois', 'massachusetts',
  'remote - us', 'us remote', 'remote (us', 'united states of america',
];

/** True when the free-text location matches an India city/region marker. */
export function isIndiaLocation(location?: string | null): boolean {
  if (!location) return false;
  const l = location.toLowerCase();
  return INDIA_LOCATION_MARKERS.some((m) => l.includes(m));
}

/**
 * True only when the location is *confidently* US — matches a US marker and does
 * NOT match an India marker. Blank / remote / ambiguous → false (never excluded
 * by the India-only rules). India markers always win.
 */
export function isConfidentUsLocation(location?: string | null): boolean {
  if (!location) return false;
  const l = location.toLowerCase();
  if (isIndiaLocation(l)) return false;
  return US_LOCATION_MARKERS.some((m) => l.includes(m));
}

/**
 * India-only ingestion rule: keep India + ambiguous/remote/blank, drop only
 * confident-US. When WIZMATCH_INDIA_ONLY is off, everything passes.
 */
export function passesIndiaOnlyIngestion(location?: string | null): boolean {
  if (!WIZMATCH_INDIA_ONLY) return true;
  return !isConfidentUsLocation(location);
}
