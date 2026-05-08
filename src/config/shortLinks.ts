/**
 * Static short-link config. Source of truth for the /s/:slug redirect handler.
 *
 * Replaces the external shlink Railway service (decommissioned 2026-05 — was
 * burning 2 GB RAM at near-zero CPU). Trade-off: adding/editing a link now
 * requires a code change + redeploy instead of an admin UI click. Worth it
 * for a CRM with a small fixed set of short links.
 *
 * To add a new short link:
 *   1. Append a row below — slug must be lowercase, [a-z0-9-], unique
 *   2. `npm run build`
 *   3. commit + push (Railway auto-deploys)
 *
 * Usage from any channel (email / WhatsApp / LinkedIn):
 *   https://links.growthescalators.com/<slug>   ← if DNS still points to web
 *   https://crm.growthescalators.com/s/<slug>   ← always works
 */

export interface ShortLink {
  /** Where the click goes */
  destination: string;
  /** Free-text description shown in the admin viewer */
  description?: string;
  /** When the link was added (YYYY-MM-DD) — informational */
  addedOn?: string;
  /** Optional tags for grouping in the admin viewer */
  tags?: string[];
}

// ---------------------------------------------------------------------------
// THE LINKS — fill in destinations before relying on these in production.
// Slugs starting with `__` are reserved/internal placeholders.
// ---------------------------------------------------------------------------
export const SHORT_LINKS: Record<string, ShortLink> = {
  // book: { destination: 'https://cal.com/jatin-ge/30min', description: 'Sales call booking', tags: ['cta'] },
  // audit: { destination: 'https://ecom.growthescalators.com/audit', description: 'Audit funnel landing', tags: ['funnel'] },
  // d2c: { destination: 'https://ecom.growthescalators.com/d2c', description: 'D2C funnel landing', tags: ['funnel'] },
  // doctor: { destination: 'https://ecom.growthescalators.com/doctor', description: 'Doctor audit funnel', tags: ['funnel'] },
  // realestate: { destination: 'https://ecom.growthescalators.com/realestate', description: 'Real estate funnel', tags: ['funnel'] },
  // 'case-studies': { destination: 'https://growthescalators.com/case-studies', description: 'Case studies page', tags: ['proof'] },
  // portfolio: { destination: 'https://growthescalators.com/portfolio', description: 'Portfolio page', tags: ['proof'] },
  // pricing: { destination: 'https://growthescalators.com/pricing', description: 'Pricing page', tags: ['site'] },
  // whatsapp: { destination: 'https://wa.me/919876543210', description: 'Direct WhatsApp DM', tags: ['cta'] },
  // linkedin: { destination: 'https://www.linkedin.com/in/jatin-agrawal-ge', description: 'LinkedIn profile', tags: ['social'] },
};

export function lookupShortLink(slug: string): ShortLink | null {
  if (!slug) return null;
  const normalised = slug.toLowerCase().trim();
  return SHORT_LINKS[normalised] ?? null;
}

export function listShortLinks(): Array<{ slug: string } & ShortLink> {
  return Object.entries(SHORT_LINKS)
    .map(([slug, v]) => ({ slug, ...v }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}
