# Wizmatch Results-First Sourcing — Phase 1 Release Evidence

Date: 2026-07-14  
Scope: source foundation, controlled ATS/POC staging qualification and production flags-off release.

## Released

- Commit: `1112e47` (`feat(wizmatch): add results-first sourcing workflow`)
- Staging: `f8f6e053-5669-40cb-8c5c-4f8f4ac3f35f` — `SUCCESS`
- Production: `fe6ebb85-cfe2-4a48-9d86-aa6707864e25` — `SUCCESS`
- Migration: additive `0029_premium_shape.sql`

The release adds independent controls, source-run audit history, shared in-process signal ingestion,
provider/URL/fingerprint deduplication, advisory locks, source health, signal qualification and
rejection, free website POC discovery, idempotent draft-requirement promotion, ATS confirmation and
requirement-first X-Ray evidence capture. It does not send, submit or delete anything.

## Verification

- TypeScript build passed.
- Vitest passed: 47 files / 383 tests.
- Admin production build passed.
- Playwright passed: 22/22, including provider failure, signal→POC→requirement, X-Ray trigger,
  desktop, tablet and 390px mobile paths.
- Migration SQL contains no drop, truncate, delete, rename or destructive rewrite.
- `git diff --check` and scoped secret scan passed.

Controlled staging Greenhouse evidence:

- First run: 10 relevant jobs found and inserted; zero errors.
- Immediate rerun: zero inserted, 10 updated/deduplicated; zero errors.
- Qualification created the POC work; website research returned `generic_contact_only` rather than
  inventing a named person or channel.
- Promotion created one draft requirement; repeated promotion returned the same requirement.
- Authenticated desktop and mobile staging UI had zero console errors or failed API requests.
- Temporary staging authentication was rotated away after verification.

Production evidence:

- Journal advanced 27→28 and `wizmatch_source_runs` exists with zero rows.
- Pre/post counts remained 2,812 contacts, 131 companies, 311 candidates, one requirement and
  6,686 job signals.
- All new source controls are off; direct ATS execution returns 403.
- Authenticated desktop/mobile smoke passed without console or essential-request failures.

## Remaining activation gates

`THEIRSTACK_API_KEY` and `SERPAPI_API_KEY` are absent from both Railway and macOS Keychain. TheirStack
and LinkedIn X-Ray cannot be honestly exercised or enabled without those credentials. The next step
is one capped staging TheirStack import plus dedupe rerun, followed by production TheirStack and
already-qualified ATS/POC activation. X-Ray follows only against a genuine accepted requirement.
