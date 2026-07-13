# Wizmatch Staffing OS — Staging Gate C pilot and browser QA

- **Date:** 2026-07-14
- **Environment:** isolated Railway `staging`
- **Production impact:** none
- **Data:** fictional pilot records only

## Result

The full traceable chain passed in staging:

```text
Company A → Person A/SAP and Person B/Java → canonical match → shortlist → exact consent
→ approved fictional manual submission record → interview → offer → placement
→ invoice link → payment/collection → margin analytics
```

Two distinct chains completed:

| Chain | Model | Outcome | Commercial evidence |
|---|---|---|---|
| Rahul → SAP ABAP / Person A | Permanent | Placed | 250000 permanent fee |
| Priya → Java / Person B | Contract | Placed | 2000 bill, 1500 loaded cost, 500 / 25% margin |

Staging analytics returned 2 starts, 570000 invoiced, 570000 collected and 250500 gross margin.
Placement, invoice and collection remained separate records. One dispute, replacement and refund
were opened and resolved against the fictional permanent-placement evidence.

## Guard and negative checks

- Unauthenticated Delivery Board request returned 401.
- Consent for the Java requirement did not authorize Rahul's SAP submission.
- A second active submission for the same requirement/candidate was rejected.
- A second placement for the same submission was rejected.
- SAP/Java candidate pairs remained requirement-specific; cross-role pairs were blocked.
- No actual email, outreach, provider, AI, R2 upload, paid action or background job ran.

## Findings and repairs

1. The earlier Gate B report did not correspond to durable canonical skill rows. Live tables were
   empty and every recalculated pair was location-blocked. Fictional staging evidence was corrected
   through the product APIs: taxonomy seed, requirement skills, candidate skills, verification and
   reconciled pilot location. The correct pairs then ranked independently.
2. The old Placements page rendered the permanent fee stored for compatibility as an hourly margin.
   Commit `ef2112f` displays permanent fees separately from contract hourly margins and keeps
   currency labels. Three regression tests cover permanent, contract and aggregate presentation.
   It was deployed to isolated staging as Railway deployment
   `52508e6f-8fdd-475c-a58e-84d31b82d142`, which reached terminal `SUCCESS`.
3. R2 is not required for manual consent evidence. It remains required only for exercising private
   document upload/signed-access behavior. R2 and Anthropic stayed intentionally unset.

## Browser evidence

- Live Delivery rendered both placed chains with exact consent, one interview and one offer each.
- Relationships and Requirements preserved Person A/SAP and Person B/Java separately.
- Talent Matching rendered all four candidate/requirement pairs independently.
- My Work, Placements, Analytics and System loaded without observed console errors.
- Delivery at 390×844 reported no page-level horizontal overflow.
- Signed-out direct navigation preserved `tenant=wizmatch` and the exact `/wizmatch/delivery`
  return path.
- Post-deploy authenticated Placements smoke returned page and placements API HTTP 200, rendered
  two started placements, and visually confirmed `₹500/hr contract margin` for Priya plus
  `₹2,50,000 permanent fee` for Rahul. Aggregate copy separates contract margin from permanent
  fees. Neither `₹2,50,000/hr` nor the legacy `$250000/hr margin` appeared.
- Post-deploy `/health` returned HTTP 200 with `status: healthy` and `database: ok`.

## Credential hygiene

An ephemeral staging-only password appeared in an internal browser automation snapshot. It was
treated as compromised immediately: the staging password was rotated, `token_version` was bumped,
the browser/session was revoked, the in-memory value was cleared and all temporary session files
were removed. No credential value is stored in this report or the repository.

## Verification

- `npm run build` — passed.
- `npm test` — 44 files / 352 tests passed.
- `npm run admin:build` — passed.
- `npx playwright test --config=playwright.wizmatch-local.config.ts` — 16/16 passed.
- `git diff --check` — passed.

## Remaining approval gates

1. Complete mandatory owner decisions for production roles, SLAs, consent, permissions, privacy,
   permanent-fee, replacement/refund and contract-margin policies.
2. Record the migration owner's accept/reject decision for proposed ADR-005 before any push.
3. Separately approve production count-only preview, migrations, push to `main`, Gate A/B/C flags
   and approved pilot-data import.
