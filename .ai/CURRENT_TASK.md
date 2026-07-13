# CURRENT_TASK.md

## Active task

**Wizmatch Staffing OS — prepare and execute a controlled same-day Gate A–C pilot from the clean
release worktree. Local implementation and release-integrity review are complete. The exact next
action is separately approved creation of an isolated Railway `staging` environment and empty
Postgres instance.**

Work only in `/Users/jatinagrawal/repo-comparison/v2-wizmatch-phase0-trust` on
`codex/wizmatch-phase0-trust`. Preserve the unrelated dirty workspace at
`/Users/jatinagrawal/repo-comparison/v2`.

Nothing from this branch has been pushed, deployed, migrated, sent, spent, written to production,
or used to rotate a credential.

### Verified local release candidate

- Phase 0 trust/hardening and Gate A: `1997e31`.
- Gate B canonical skills/matching: `a5ac3e8`.
- Gate C delivery/commercial close: `48b1a88`.
- Delivery reference-integrity repair: `605d6cd`.
- Additive migrations `0025`–`0028`; no destructive SQL found.
- `npm run build` passed.
- `npm test` passed: 43 files / 349 tests.
- `npm run admin:build` passed.
- Wizmatch Playwright passed 16/16 mocked Chromium scenarios.
- Production-off bundle hid Gate A/B/C navigation and redirected guarded routes.

### Same-day execution sequence — pause at every guarded action

1. Obtain explicit approval to create isolated Railway `staging` and an empty Postgres instance.
2. Verify staging has no production database/data, worker, sending, paid-provider or staffing flags.
3. Obtain separate approval to apply the complete migration journal to staging.
4. Obtain separate approval to deploy this clean worktree directly to staging.
5. Run the fictional Company A / Person A SAP / Person B Java workflow through match, consent,
   submission record, interview, offer, placement, invoice link and collection reporting.
6. Require human owner sign-off for roles, SLAs, consent, permissions, privacy and commercial rules
   before Gate C production activation. Do not invent missing decisions.
7. Obtain separate approvals for credential rotation, production count-only preview, production
   migrations, the exact push to `main`, every Gate A/B/C server/Vite flag change and every pilot
   data write.
8. Permit named pilot users after the Gate C smoke test; team-wide release requires 48 hours of
   stable monitored operation.

### Infrastructure truth

- Railway project `GE-Backend-Server` currently has only `production`, with `web` and Postgres.
- Production `web` is on `b05ac015eff8444edc217563fdb93ac5ef836639` and reported `SUCCESS` in
  the latest read-only inspection.
- There is no staging environment and no worker service.
- `railway.worker.json` is referenced by deployment documentation but is absent from this worktree;
  worker automation is a post-pilot implementation unit.
- Gate A/B/C server and Vite flags are absent in production.

### Approval boundaries

The same-day pilot directive does not pre-authorize a guarded operation. Stop immediately before
each migration, Railway environment/configuration change, credential operation, production-data
access/write, push/deployment, feature-flag activation, sending or paid-provider action and request
an explicit confirmation for that exact action.

Canonical context starts at `docs/wizmatch/README.md`. The reusable Claude prompt is
`docs/wizmatch/WIZMATCH_STAFFING_OS_CLAUDE_CODE_KICKOFF.md`.
