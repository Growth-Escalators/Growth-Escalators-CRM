# Wizmatch Complete Build — Test Matrix

Honest accounting of what is and isn't automated-tested as of
`feat/wizmatch-complete-build`. See `docs/testing/WIZMATCH_E2E_HARDENING_REPORT.md`
for the prior pass's contact-cap/delete-archive/navigation coverage — this
file only adds what changed in this build.

## Automated coverage (this build)

| Area | Test file | What it proves |
|---|---|---|
| Route wiring | `e2e/wizmatch-e2e-hardening-navigation.spec.ts` | All 9 primary nav paths (incl. renamed Today/Companies/Hiring Contacts) resolve, legacy aliases redirect, no nav-loop, works at desktop/tablet/mobile |
| Companies discovery trigger | `e2e/wizmatch-phase0-local.spec.ts` › "Company discovery previews..." | Cost-gated preview→confirm→run flow on the Companies detail drawer, mocked backend, confirms no request fires before explicit confirmation |
| Hiring Contacts discovery queue failure | `e2e/wizmatch-phase0-local.spec.ts` › "Hiring Contacts discovery queue failure..." | A failed queue fetch shows the real error message and zero fabricated rows |
| Today empty/outage states | `e2e/wizmatch-phase0-local.spec.ts` › "Today shows empty-state guidance..." and "authenticated API outages never substitute actionable demo records" | Today renders correctly with real (non-demo) data sources; a full outage across all mocked endpoints never substitutes forbidden demo text and discloses the outage |
| Person-specific isolation (Company ↔ Hiring Contact 360) | `e2e/wizmatch-gate-a-local.spec.ts` › "Company and Hiring Contact 360..." | Two hiring contacts at the same company keep separate requirement-source attribution across both the Companies page and the Hiring Contact's own 360 drawer |
| Delivery board accessible-dialog flow | `e2e/wizmatch-gate-bc-local.spec.ts` › "Delivery board traces approval through placement..." | Full approve → consent(already granted) → record sent → interview → offer → accept → placement chain via the new dialogs, `page.on('dialog')` asserts zero native browser dialogs fire anywhere in the flow |
| 5-contact discovery cap (real backend) | `e2e/wizmatch-e2e-hardening-contact-cap.spec.ts` | Unchanged by this build; re-run against the integrated tree and still green — cap enforcement lives in `wizmatchContactDiscovery.ts`, which no page in this build bypasses |
| Requirement delete/archive (real backend) | `e2e/wizmatch-e2e-hardening-delete-archive.spec.ts` | Unchanged by this build; re-run against the integrated tree and still green |
| Backend unit/integration | `npm test` (Vitest, 48 files / 413 tests) | Unaffected by this build (no backend routes changed) — reconfirmed green after every commit in this build |
| Frontend build | `npm --prefix admin run build` | Every new/modified page compiles and code-splits correctly; reconfirmed green after every commit |
| Backend build | `npm run build` (`tsc`) | Reconfirmed green after every commit (no backend files touched in this build) |

Full local run: `npx playwright test --config=playwright.wizmatch-local.config.ts`
→ 67 passed, 15 skipped (skip reason: `WIZMATCH_E2E_TEST_PASSWORD` not set in
this environment — real-backend specs from the prior hardening pass), 0 failed,
across `chromium-desktop` / `chromium-tablet` / `chromium-mobile`.

## Explicitly NOT covered by automated tests in this build

These are real gaps, not oversights being hidden — call them out before
relying on this build as fully verified:

- **Candidates 360 drawer** (match explanation, bench/delete flow) — built
  and manually code-reviewed, but has no new Playwright spec in this pass.
- **Placements detail modal** (Economics/Invoice/Collection/Adjustments tabs)
  — built and manually code-reviewed, no new Playwright spec.
- **Reports funnel page** (`WizmatchAnalyticsPage.jsx`'s new Job Lead →
  Collection funnel, `supported`/`errored` tagging) — built and manually
  code-reviewed, no new Playwright spec.
- **Discovery run against the real backend** — the Companies "Discover
  contacts" flow is tested against a mocked backend only; it has not been
  exercised against the real `wizmatch_e2e_test` database with real (even if
  disabled) provider gates.
- **Accessibility audit (axe-core)** — `@axe-core/playwright` is not
  installed in this repo. No automated a11y scan ran against any page in this
  build. The dialogs follow the same manual accessibility pattern as the
  pre-existing `ConfirmDialog` (focus trap, Escape-to-close, `role="alertdialog"`,
  `aria-modal`), but this is a design-pattern claim, not a tested one.
- **The 26-step acceptance journey** specified in the original build
  instructions was not run end-to-end as a single scripted pass.
- **Multi-tenant / RBAC matrix** across every role × entity × action
  combination was not exhaustively re-verified in this build; existing
  role-gates (`capabilities.*` from `GET /staffing/access`) are read and
  respected by the new UI, but not independently re-tested per role here.

## Recommendation

Before calling this release-ready, at minimum: install `@axe-core/playwright`
and scan the four new/extended pages; add Playwright coverage for the
Candidates, Placements, and Reports pages built in this pass; run the
Companies discovery trigger against the real backend once.
