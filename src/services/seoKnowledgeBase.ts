import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Seed client knowledge base with real brand data
// ---------------------------------------------------------------------------
//
// RETIRED (tenant-scoping pass, Aug 2026). This used to hardcode brand data —
// names, keywords, GA4 property ids, WordPress URLs — for three specific GE
// clients (Aaroha Om, Black Panda Enterprises, AGeD) and upsert it into
// client_knowledge_base on every server boot (see src/index.ts's startup
// bootstrap chain, which calls this unconditionally). Two reasons that can't
// survive multi-tenancy, so this is a no-op rather than "add a tenantId
// param and thread it through":
//
//   1. It's another company's brand copy. There's no tenant check that makes
//      writing it safe — the moment a reseller tenant onboards, running this
//      unconditionally would plant GE-only client data in their knowledge
//      base. Gating it to the one tenant that owns those domains just moves
//      the hardcoding into an `if (tenantId === ...)`, which is the same bug
//      with an extra step.
//   2. Those three clients are scheduled for data deletion. A no-op is what
//      stops this function from resurrecting their rows on every deploy
//      restart — it would otherwise fight the deletion forever, since it
//      always runs at startup.
//
// `tenantId` is accepted (and unused) purely for call-site symmetry with the
// other SEO service entry points in this tenant-scoping pass. If a future
// tenant needs seed data for onboarding, write a tenant-scoped seed (or a
// one-off script — see the ge-prod-data-mutation skill) instead of reviving
// this function.
export async function seedClientKnowledgeBase(tenantId?: string): Promise<void> {
  void tenantId;
  logger.info('[seo-kb] seedClientKnowledgeBase is retired — no-op (see comment above)');
}
