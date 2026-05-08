/**
 * Initial seed for the short_links table. This runs once on first boot
 * — `ensureShortLinksTable()` upserts each row with ON CONFLICT DO NOTHING,
 * so editing this list later does NOT overwrite anything an admin
 * has updated through the CRM admin UI.
 *
 * Day-to-day short link management happens in the admin Link Shortener
 * page (Create / Update / Delete) backed by `src/services/shortLinksDb.ts`.
 *
 * Use this seed only for:
 *   - bootstrapping a fresh DB
 *   - migrating slugs that used to live in the old shlink Railway service
 */

export interface ShortLinkSeed {
  slug: string;
  destination: string;
  description?: string;
  tags?: string[];
}

// Add slugs you want pre-populated on first deploy. Existing rows are
// never overwritten by this list — to change an existing slug, use the
// admin UI (Update) or run a manual UPDATE on the DB.
export const SEED_SHORT_LINKS: ShortLinkSeed[] = [
  // { slug: 'audit', destination: 'https://ecom.growthescalators.com/audit', description: 'Audit funnel landing', tags: ['funnel'] },
];
