# CURRENT_TASK.md

## Active task

**Entity-first UI/UX + complete-build push is live (commit `2d8ddd6`, Railway deployment
`baec1d83`, `SUCCESS`) — a navigation/UX/safety-tooling release, not a pilot-scope change. The
Wizmatch results-first sourcing pilot task below is still the substantive product work in front of
Jatin/Kanishk; this push doesn't change what they need to do next.**

Work directly in `/Users/jatinagrawal/repo-comparison/v2` on `main` (now equal to `origin/main`).
The `v2-wizmatch-phase0-trust` worktree referenced below may be stale relative to `main` post-push —
re-verify its branch position before resuming work there.

## Prior active task (still relevant — pilot data review)

**Wizmatch results-first sourcing — provider release is live for the Jatin/Kanishk production
pilot. Review genuine signals and configure approved ATS boards; enable X-Ray only after the first
genuine accepted, skill-reviewed requirement exists.**

Work only in `/Users/jatinagrawal/repo-comparison/v2-wizmatch-phase0-trust` on
`codex/wizmatch-phase0-trust`. Preserve the unrelated dirty workspace at
`/Users/jatinagrawal/repo-comparison/v2`.

## Verified release candidate

- `c293b88` adds SearchAPI.io public research, shared POC/X-Ray allowance, provider-account status,
  real free TheirStack preview, hiring-team evidence, requirement-specific X-Ray queries and honest
  provider UI.
- `142eb51` handles free-credit account reporting, excludes up to 500 seen TheirStack job IDs before
  paid retrieval, and retries one transient SearchAPI timeout/429/5xx response.
- No schema or migration changed. No credential value entered Git, docs, `.ai`, screenshots or
  command output.
- Final local suite: TypeScript build; 47 files / 395 Vitest tests; admin production build; 22/22
  Wizmatch Playwright scenarios; `git diff --check` clean.

## Isolated staging evidence

- Deployment `d3b0e543-87db-4fe3-87e2-703bebcbc350` is `SUCCESS`; health/database are green.
- Supplied temporary credentials validate: TheirStack reports 200 credits; SearchAPI.io reports
  100 starting free credits. Values remain secret.
- TheirStack imported 29 public India target-role signals across two capped runs: all 29 have
  distinct provider IDs and matching SAP/Java/JavaScript/frontend title evidence. One provider
  repeat updated the existing row rather than creating a duplicate; the release now excludes seen
  IDs before retrieval.
- ATS refreshed 10 controlled Greenhouse jobs with no new duplicates or errors.
- POC research produced six named public candidates and correctly left them
  `identified_channel_pending`; no email/phone was guessed.
- Requirement-first X-Ray produced 10 requirement-linked leads. All 10 remain unreviewed and cannot
  enter canonical matching until a recruiter validates evidence.
- Authenticated live Signals UI passed desktop, tablet and 390px mobile with all provider cards,
  shared allowance, no horizontal overflow, no console errors and no 5xx responses.
- Legacy Wizmatch automation, sending, paid discovery and Google fallback remain off. No outreach,
  consent, submission or production business record was created.

## Production activation

- `05a5c5a` is live. Code deployment `5e8d1302-2c50-4a2b-b7b3-4f3e1e160023` and provider-flag
  deployment `8d68a585-5277-4be4-8e90-cc830e1b4036` both reached `SUCCESS`.
- Source master, TheirStack, ATS and POC discovery are active. SearchAPI/TheirStack accounts validate;
  X-Ray is configured but off. Legacy automation, sending, paid discovery and Google fallback are off.
- The first production TheirStack run fetched/inserted 15 genuine public target-role signals with no
  errors or duplicates. Their 15 provider IDs are distinct. ATS ran safely but polled zero companies
  because no production company has an approved ATS board yet.
- Production Signals UI passed desktop/tablet/390px with no overflow, console errors or 5xx. Health
  and database are green; sampled traffic had zero 5xx, p95 73 ms and healthy CPU/memory.

## Exact next action

Jatin/Kanishk review the 15 signals in Job Signals, qualify useful ones, run Find POC, verify a genuine
contact channel and promote only real demand. Configure ATS type/slug/board URL on approved Company
360 records. Once one genuine requirement is accepted and has reviewed mandatory skills, enable
`WIZMATCH_XRAY_CANDIDATE_ENABLED=true` and run one manual requirement-first search.

Never add users, enable pilot-all, sending, paid discovery, Google fallback, legacy automation,
automatic requirements, outreach, consent, shortlist or submission. Never delete production data.
