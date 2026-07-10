---
name: wizmatch-daily-ops
description: Use to run the Wizmatch staffing daily operating loop, or to answer "what needs my review today" on the Wizmatch product. Triggers include "wizmatch daily check", "run the wizmatch loop", "what's waiting for review", "wizmatch morning routine", "where are we on discovery/candidates/companies", "anything to approve in the workbench". Skips: Growth CRM ops (that's the other tenant), code changes, prod-down triage (use ge-debug-prod-down).
---

# Wizmatch daily operating loop

Wizmatch has a fixed daily rhythm. The full SOP is in
[`docs/wizmatch-daily-operations.md`](../../../docs/wizmatch-daily-operations.md); this skill runs
it as a routine so the loop is repeatable by anyone (you, Codex, a teammate) — not a memory test.
Data map: [`docs/wizmatch/DATAFLOW.md`](../../../docs/wizmatch/DATAFLOW.md).

**Scope:** the demand/outreach funnel (find hiring companies → email the right person). The
candidate-supply side (intake → match → place) is separate and not driven here.

## The loop (work top to bottom)

1. **Data readiness.** Confirm signals are flowing, not stalled. Signals stuck at `status='new'`
   usually mean the scoring worker couldn't reach the web service — check `WIZMATCH_API_BASE_URL`
   (not localhost). See `wizmatch-add-cron`.

2. **Score companies / clients.** Review newly scored companies and hiring urgency. Qualification
   tiers map: A/B/C/Reject → **Strong / Maybe / Skip**.

3. **Review candidate fit** (supply side, light touch): confirm any new matches look sane before
   they surface to outreach.

4. **Contact discovery.** Confirm discovery ran at expected cost (**~₹0–1 per run**; Apollo/Snov stay
   OFF). If a run shows real spend, stop and check `wizmatch-cost-guard`. Confidence tiers map:
   high/medium/low → **Verified / Likely / Guess**.

5. **Review workbench.** Work the queue of approved-and-waiting contacts in priority order:
   hiring urgency → fit tier → contact confidence → age. Approve / reject each.

6. **Guardrails that stay blocked** (confirm, don't "fix"):
   - Companies intentionally cooldown-locked stay locked (don't force-rerun to burn budget).
   - Sending stays OFF unless `WIZMATCH_SENDING_ENABLED=true` was deliberately set — see
     `wizmatch-go-live-sending`. Never send from this loop by reflex.

7. **Healthy daily close.** Note anything that needs a human decision (a stuck company, a data
   unblock — route to `ge-prod-data-mutation`; a cost anomaly — route to `wizmatch-cost-guard`).

## Report back in this shape
> "Signals: flowing. Scored overnight: N companies. Candidate fits to review: N. Discovery: ran
> at ₹X (Apollo/Snov off ✓). Workbench: N approved & waiting. Guardrails: N companies correctly
> locked, sending OFF. Needs a human: <list or none>."
