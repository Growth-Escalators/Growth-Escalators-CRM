# Wizmatch admin — staged full-detail flow (Hybrid)

**Decided:** 2026-07-10 · **Owner:** Jatin · **Status:** implemented on `feat/wizmatch-staged-flow`

## Problem

The Wizmatch admin had drifted into a compact "co-pilot / command center" theme
(`WizmatchNewPages.jsx`) that compressed every section into stacked mini-panels. You couldn't
see full information for any one section, and it wasn't the flow we wanted. The older, fuller
per-section pages still existed in the repo but were orphaned — their routes just redirected to
the compact `-new` versions.

## Decision

Restore a **staged, one-section-per-screen flow** where each stage is its own full-detail
dashboard, reachable from the sidebar. **Hybrid** approach:

- **Restore** the full standalone pages for the sections that lost the most detail:
  - Client Discovery → `WizmatchClientDiscoveryPage.jsx`
  - Candidate Intelligence → `WizmatchCandidateIntelligencePage.jsx`
  - Analytics → `WizmatchAnalyticsPage.jsx`
- **Keep** Contact Intelligence on the newer page (`WizmatchContactIntelligenceNewPage`) because
  it carries the just-built compose + throttled/compliant **send** last-mile UI.
- **Light Home** overview: the existing `WizmatchDashboardPage` KPI grid, plus a new **"Wizmatch
  funnel"** stage navigator that links into each stage in order.
- **Retire the co-pilot**: `/wizmatch/command-center-new` now redirects to the dashboard.

No do-everything cockpit. Each stage shows full detail on its own screen.

## Stage → page map

| Stage | Route | Page component |
|---|---|---|
| Home (overview) | `/wizmatch/dashboard` | `WizmatchDashboardPage` (KPIs + funnel navigator + attention queue + guardrails) |
| Client Discovery | `/wizmatch/client-discovery` | `WizmatchClientDiscoveryPage` (full, restored) |
| Requirement Priority | `/wizmatch/requirement-priority-new` | `WizmatchRequirementPriorityPage` |
| Candidate Intelligence | `/wizmatch/candidate-intelligence` | `WizmatchCandidateIntelligencePage` (full, restored) |
| Contact Intelligence | `/wizmatch/contact-intelligence-new` | `WizmatchContactIntelligenceNewPage` (keeps compose + send) |
| Analytics | `/wizmatch/analytics` | `WizmatchAnalyticsPage` (full, restored) |
| Guardrails | `/wizmatch/guardrails-new` | `WizmatchGuardrailsPage` |
| Review Workbench | `/wizmatch/review-workbench` | `WizmatchReviewWorkbenchPage` |
| Data Readiness | `/wizmatch/readiness` | `WizmatchReadinessPage` |

## What changed in code

- **`admin/src/App.jsx`** — the base routes for Client Discovery / Candidate Intelligence /
  Analytics now render the restored full pages (wrapped in `AppLayout`); their `-new` routes now
  redirect back to the base route (so stale bookmarks land on the full page).
  `/wizmatch/command-center-new` → redirect to `/wizmatch/dashboard`.
- **`admin/src/components/navEntries.js`** — the three sidebar entries point to the clean base
  routes instead of `-new`.
- **`admin/src/pages/WizmatchOperatingPages.jsx`** — `WizmatchDashboardPage` gains the "Wizmatch
  funnel" stage-navigator card.

## Verification & safety

- No API drift: every endpoint the restored pages call still exists in `src/routes/wizmatch.ts`
  (checked before repointing). The old Client Discovery page is actually *more* complete — it
  keeps the `send-to-contact-intelligence` handoff the compact version dropped.
- Same design system throughout (Tailwind `card` / `badge-*` utilities, `primary-*` scale,
  `lucide-react` icons) — no new frameworks introduced.
- `npm run admin:build` clean; `npm test` 282/282 green.
- Admin-UI only — no backend, schema, auth/RBAC, Cashfree, or deployment changes. The compact
  `-new` pages remain in the tree (still used by the `-demo` showcase routes) and can be deleted
  later once the staged flow is confirmed in use.

## Demo routes (unchanged)

`/wizmatch/*-new-demo` still render the compact pages for the demo showcase; only the live
operator routes were repointed.
