import {
  BD_MARKETING,
  BD_D2C,
  BD_TECHNOLOGY,
  BD_STAFFING,
  BD_GENERAL,
} from '../config/constants';

/**
 * Service-based lead routing.
 *
 * The CRM has no generic assignment engine — `contacts.assigned_to` is only set
 * today by Meta Lead Ads form mappings (lead_form_mappings.assigned_to). This
 * fills that gap for website leads without inventing a second CRM concept: it
 * resolves to the same `assigned_to` text column everything else reads.
 *
 * Owners come from env (BD_MARKETING etc.) so no employee identity is hardcoded
 * here or duplicated across files. An unset owner falls through to the general
 * queue rather than assigning to nobody silently.
 */

export type BdBucket = 'marketing' | 'd2c' | 'technology' | 'staffing' | 'general';

interface AssignmentInput {
  /** Selected service / interest, if the form captured one. */
  service?: string | null;
  /** Free-text source tag, e.g. 'roofing-landing', 'staffing-page'. */
  source?: string | null;
  /** Landing page route, e.g. '/shopify-development-agency'. */
  landingPage?: string | null;
  /** International market, set only by the offshore staffing forms. */
  market?: string | null;
  /** Explicit form type when the website already knows the bucket. */
  formType?: string | null;
}

const BUCKET_OWNERS: Record<BdBucket, string> = {
  marketing: BD_MARKETING,
  d2c: BD_D2C,
  technology: BD_TECHNOLOGY,
  staffing: BD_STAFFING,
  general: BD_GENERAL,
};

// Ordered most-specific first. Staffing is checked before technology because
// "offshore developers" is a staffing enquiry, not a build enquiry.
const RULES: Array<{ bucket: BdBucket; patterns: RegExp }> = [
  {
    bucket: 'staffing',
    patterns:
      /staffing|offshore|resource|recruit|hiring|talent|augmentation|fulfilment|fulfillment|contract.?to.?hire|bench/i,
  },
  {
    bucket: 'd2c',
    patterns: /shopify|d2c|ecommerce|e-commerce|jewellery|jewelry|fashion|apparel|skincare|beauty|kurti|retention|aov/i,
  },
  {
    bucket: 'technology',
    patterns:
      /web(site)?.?(dev|design|redesign)|software|saas|app.?dev|custom.?software|development.?compan|white.?label.?(web|software|shopify)/i,
  },
  {
    bucket: 'marketing',
    patterns:
      /marketing|seo|ads?|ppc|paid|performance|social|lead.?gen|branding|meta.?ads|google.?ads|growth|advertis/i,
  },
];

/**
 * Pick the BD bucket for a submission. Pure and side-effect free so it is
 * directly unit-testable without a database.
 */
export function resolveBucket(input: AssignmentInput): BdBucket {
  // An international market is always an offshore staffing enquiry.
  if (input.market) return 'staffing';

  const haystack = [input.formType, input.service, input.source, input.landingPage]
    .filter(Boolean)
    .join(' ');

  if (!haystack.trim()) return 'general';

  for (const rule of RULES) {
    if (rule.patterns.test(haystack)) return rule.bucket;
  }
  return 'general';
}

/**
 * Resolve the assignee for a submission.
 *
 * Returns `null` rather than a placeholder when no owner is configured — the
 * caller surfaces the lead to the general queue and the notification says so.
 * Assigning to a made-up identifier would be worse than assigning to nobody.
 */
export function assignLead(input: AssignmentInput): { bucket: BdBucket; assignedTo: string | null } {
  const bucket = resolveBucket(input);
  const owner = BUCKET_OWNERS[bucket] || BUCKET_OWNERS.general || '';
  return { bucket, assignedTo: owner || null };
}

/** Human-readable owner label for the WhatsApp template's {{3}} variable. */
export function assigneeDisplayName(assignedTo: string | null): string {
  if (!assignedTo) return 'our team';
  // `assigned_to` may hold an email or a username; show the readable part only,
  // never a raw identifier and never an email address in a WhatsApp message.
  const local = assignedTo.includes('@') ? assignedTo.split('@')[0] : assignedTo;
  const cleaned = local.replace(/[._-]+/g, ' ').trim();
  if (!cleaned) return 'our team';
  return cleaned
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
