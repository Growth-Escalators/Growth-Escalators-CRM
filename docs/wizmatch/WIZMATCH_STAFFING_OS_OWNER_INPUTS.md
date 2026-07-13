# Wizmatch Staffing OS — Owner Inputs

- **Status:** Provisional pilot policy pack approved; named owners and pilot records remain `TBD`
- **Updated:** 2026-07-14
- **Product contract:** [`../prd/004-wizmatch-staffing-operating-system.md`](../prd/004-wizmatch-staffing-operating-system.md)

This file stores business decisions that cannot be inferred safely from code. Claude or another agent
may propose options, but the human owner decides them. A blank field blocks only work whose behavior
materially depends on that decision.

## Safety and privacy

Do not put any of the following in this file:

- Passwords, tokens, API keys, private keys, database URLs or environment values
- Candidate resumes, personal emails, phone numbers, compensation details or other PII
- Confidential client JDs, contracts, rate cards or production exports
- Production login instructions

Use fictional examples or internal record IDs only when necessary. Keep sensitive operating data in
the approved CRM, password manager or secure document system.

## 1. Product owner and decision process

| Decision | Value |
|---|---|
| Product owner | TBD |
| Engineering approver | TBD |
| Operations owner | TBD |
| PRD 004 product direction approved? | Approved for phased local implementation on 2026-07-13 |
| Approved current implementation phase | Controlled full Gate A/B/C pilot is the same-day target; migration apply, production data, environment flags, credential operations, push and deployment remain separately gated |
| Local commit approver | TBD |
| Final schema/migration approver | TBD |
| Final production/deployment approver | TBD |
| Git-history rewrite approver/coordinator | TBD |
| How unresolved decisions are approved | TBD |

## 2. Pilot scope

| Input | Owner decision |
|---|---|
| Pilot start date | 2026-07-13 target, conditional on staging, mandatory policy sign-off and production smoke gates |
| Pilot duration | 60–90 days proposed |
| Pilot companies | Use internal CRM IDs or fictional labels; TBD |
| Number of accepted requirements | 5–10 proposed |
| Pilot skill families | SAP and Java proposed |
| Number of vetted candidates | 20–30 proposed |
| India/US operating priority | India-first SAP and Java pilot approved as implementation default; expansion remains TBD |
| Permanent, contract, or mixed | Mixed permanent and contract support approved for implementation |
| Explicit pilot exclusions | TBD |

## 3. Team roles

Record role ownership without credentials or sensitive contact details.

| Role | Assigned owner/team | Responsibilities confirmed? |
|---|---|---|
| Sales / business development | TBD | TBD |
| Account management | TBD | TBD |
| TA / delivery lead | TBD | TBD |
| Recruiter(s) | TBD | TBD |
| Operations / data quality | TBD | TBD |
| Commercial / finance | TBD | TBD |
| Product/system administration | TBD | TBD |

Approved platform-role mapping for the controlled pilot:

| Existing role | Staffing responsibility |
|---|---|
| `staff` | Recruiter; assigned requirements, evidence, matching decisions, consent and submission drafts |
| `sales` | Account owner; assigned client/requirement relationships |
| `manager_ops` | Operations and data quality |
| `team_lead` | Delivery, submission approval, offers and commercial visibility |
| `admin` | Administration, finance, placements and commercial mutations |
| `viewer` | Excluded from pilot staffing access and mutations |

Production access is restricted to `WIZMATCH_STAFFING_PILOT_USER_IDS` and fails closed when the
roster is absent. `WIZMATCH_STAFFING_PILOT_ALL_USERS=true` is the explicit post-pilot expansion.

## 4. Workflow and stage decisions

| Decision | Owner choice |
|---|---|
| Minimum facts required for a confirmed requirement | TBD |
| Minimum facts required to accept a requirement | TBD |
| Who can accept/reject requirements | Operations, team leads and admins under the pilot role map |
| Who can shortlist candidates | Assigned recruiters, operations, team leads and admins |
| Who approves candidate submissions | Team leads and admins; recruiters prepare drafts only |
| Consent/RTR policy | Exact requirement only; revocable; maximum/default validity 30 days |
| Duplicate-submission handling | TBD |
| Interview feedback ownership | TBD |
| Offer and joining confirmation owner | Team leads/admins manage offers; admins create placements |
| Placement/invoice closure owner | Admin/finance only |

Use PRD 004 state machines as the default proposal. Record only approved deviations here.

## 5. SLA decisions

| Activity | Proposed default | Approved target |
|---|---:|---:|
| Inbound client reply acknowledgement | 2 working hours | 2 working hours |
| Complete requirement intake | 4 working hours | 4 working hours |
| Requirement acceptance/recruiter assignment | Same business day | Same business day |
| First shortlist, common role | 24 hours | 24 hours |
| First shortlist, niche/SAP role | 48 hours | 48 hours |
| Submission feedback follow-up | 24 working hours | 24 working hours |
| Interview scheduling | Same business day | TBD |
| Interview feedback request | Within 2 hours | TBD |
| Requirement inactivity risk threshold | 3 business days | 3 business days |
| Client no-response escalation | 5 business days | 5 business days |

## 6. Commercial decisions

Do not store confidential client-specific terms here. Record only approved policy or non-sensitive
planning ranges.

| Decision | Owner choice |
|---|---|
| Permanent placement fee policy | Invoice begins on joining, subject to the client contract |
| Replacement/refund reserve policy | TBD |
| Contract bill/pay/margin policy | Bill rate, loaded cost, currency and period required; target gross margin >=20%; admin must record an exception below target |
| Loaded pay-cost definition | Approved all-in cost for the same period as bill rate; client-specific composition stays in the commercial record |
| Currency conversion policy/source | TBD |
| Invoice trigger | Joining for permanent placements under the client contract; contract invoicing follows the approved billing period |
| Collection/DSO owner | TBD |
| Revenue versus gross-margin reporting priority | TBD |

## 7. Permissions and privacy

| Decision | Owner choice |
|---|---|
| Roles allowed to view candidate PII | Assigned recruiters, operations/data quality, team leads and admins |
| Roles allowed to view commercial terms | Team leads and admins |
| Export/bulk-action permissions | Admin only |
| Candidate consent retention | Retain with the candidate operational record and audit trail, subject to revocation and approved deletion/legal exceptions |
| Candidate data retention/deletion policy | 24 months after last activity, subject to approved deletion and legal-retention exceptions |
| Client JD/document access policy | Private storage; five-minute signed URLs; tenant and role checks required |
| Resume/RTR/contract access policy | Private storage; five-minute signed URLs; assigned/approved roles only |
| Audit-log retention | TBD |

## 8. Automation and cost gates

| Capability | Initial decision |
|---|---|
| Automatic client outreach | Disabled unless separately approved |
| Automatic candidate submission | Disabled |
| Paid contact discovery | Preview-first and manually approved; exact caps TBD |
| Automatic matching recalculation | Deterministic recalculation approved; no provider calls |
| Next-action reminders | Deterministic task creation approved behind Gate C; no outreach |
| Candidate availability reminders | Deterministic review tasks approved behind Gate C; no outreach |
| Cold-email sending enablement | Separate go-live approval required |

## 9. Reporting targets

| Metric | Initial target/decision |
|---|---|
| Accepted workable requirements per pod/month | Base proposal: 6; confirm |
| Qualified submissions per requirement | Base proposal: 4; confirm |
| Submission-to-interview | Base proposal: 33%; confirm after baseline |
| Interview-to-offer | Base proposal: 37.5%; confirm after baseline |
| Offer-to-start | Base proposal: 67%; confirm after baseline |
| Expected starts per pod/month after ramp | Base proposal: about 2; confirm |
| Primary north-star metrics | Accepted requirements, SLA coverage, starts, gross margin proposed |

Planning numbers are not guarantees. Calibrate them with 60–90-day cohorts and rolling averages.

## 10. Open architecture/product decisions

| Decision | Status | Owner note or decision record |
|---|---|---|
| Existing events/tasks versus dedicated staffing timeline | Gate A direction approved for local implementation | `docs/decisions/ADR-004-wizmatch-staffing-domain-spine.md` |
| Requirement-contact persistence model | Gate A direction approved for local implementation | `docs/decisions/ADR-004-wizmatch-staffing-domain-spine.md` |
| Skill taxonomy ownership | Pilot seed is admin-reviewed; operational owner remains TBD | Gate B implementation |
| Submission/interview/offer table boundaries | Approved for local implementation | `docs/decisions/ADR-004-wizmatch-staffing-domain-spine.md` |
| Private/signed document policy | Private R2 references with short-lived signed access approved for implementation | Phase 1/3 plan |
| Historical attribution/backfill policy | Pilot-only manual cleanup; unknown people/owners stay unknown; count-only preview before writes | Phase 1 plan |
| Feature-flag/dual-read strategy | Additive schema, legacy requirement status compatibility and production-off Gate A/B/C flags approved locally | `docs/decisions/ADR-004-wizmatch-staffing-domain-spine.md` |
| Post-pilot geography and operating mix | TBD | |

Non-obvious approved architecture decisions should be recorded in a numbered ADR under
`docs/decisions/`, then linked here.

## 11. Approval log

Use this only as an index to an explicit human decision; do not place secrets or production payloads
here.

| Date | Proposed guarded action | Proposal/ADR | Decision | Approver |
|---|---|---|---|---|
| 2026-07-13 | Implement Phase 1 Gate A locally and generate one additive migration | ADR-004 / PRD 004 Phase 1 | Approved by the user through “Please plan the next phase and get them done as well”; does not approve applying the migration, production writes, push, deployment, sending or paid providers | Product owner (chat instruction) |
| 2026-07-13 | Implement the complete three-phase Staffing OS locally | ADR-004 / PRD 004 / three-phase production plan | Approved through explicit “PLEASE IMPLEMENT THIS PLAN”; production migrations, production data, environment changes, credential rotation and each push to `main` still require separate approval | Product owner (chat instruction) |
| 2026-07-13 | Perform local release review and prepare progressive rollout | Release-readiness plan | Approved through explicit “PLEASE IMPLEMENT THIS PLAN”; Railway staging creation, deployment, migrations, production access, flags and push remain separate approval gates | Product owner (chat instruction) |
| 2026-07-13 | Prepare same-day controlled full Gate A–C pilot handoff | Same-day Claude handoff plan | Approved through explicit “PLEASE IMPLEMENT THIS PLAN”; Claude must pause before every guarded action and Gate C remains blocked until mandatory owner-policy sign-off | Product owner (chat instruction) |
| 2026-07-14 | Complete the fictional isolated-staging Gate C exercise and local QA repairs | Staging pilot handoff | Approved through explicit “take on the charge from here and get all this finished”; does not approve a new deployment, production access, migration, push, flags, production data, sending or paid providers | Product owner (chat instruction) |
| 2026-07-14 | Adopt provisional pilot role, access, SLA, consent, privacy and commercial policies; accept the one-time `a810d08` exception | Final Hardening and Production Launch plan / ADR-005 | Approved through explicit “PLEASE IMPLEMENT THIS PLAN”; production reads, credential rotation, migrations, push, environment changes and imports remain separately gated | Product and migration owner (chat instruction) |
