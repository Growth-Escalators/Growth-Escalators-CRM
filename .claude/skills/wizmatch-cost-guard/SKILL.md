---
name: wizmatch-cost-guard
description: Use when touching anything that can spend money in Wizmatch discovery/enrichment — adding or enabling a paid provider (Apollo, Snov, Serper), changing the discovery cascade, adjusting budgets/caps, or investigating a cost anomaly. Triggers include "enable apollo/snov", "add an enrichment provider", "why did discovery cost money", "change the discovery budget", "a run showed real spend", "check wizmatch costs". Skips: free/self-hosted paths that don't spend (Reacher self-hosted), sending (use wizmatch-go-live-sending), unrelated features.
---

# Wizmatch cost guard

Discovery is designed to cost **~₹0–1 per run**. Real spend only happens if a paid provider is
enabled or a budget is raised. This skill keeps money paths deliberate. Reference:
[`src/services/wizmatchCostGuard.ts`](../../../src/services/wizmatchCostGuard.ts),
[`src/services/wizmatchContactDiscovery.ts`](../../../src/services/wizmatchContactDiscovery.ts).
Cost unit: **cents = paise (INR)**.

## The cost model (defaults)
| Provider | Cost | Default state |
|---|---|---|
| Reacher (self-hosted) | ₹0 (`REACHER_COST_CENTS=0`) | always used |
| Serper / googleFallback | ₹1 (`100` paise) | only if `WIZMATCH_GOOGLE_FALLBACK_ENABLED` |
| Apollo | ₹15 (`1500` paise) | **OFF** (`WIZMATCH_ENABLE_APOLLO`) |
| Snov | ₹10 (`1000` paise) | **OFF** (`WIZMATCH_ENABLE_SNOV`) |

Budgets: monthly `WIZMATCH_MONTHLY_DISCOVERY_BUDGET_CENTS` default `500000` (₹5,000), daily
`WIZMATCH_DAILY_DISCOVERY_BUDGET_CENTS` default `50000` (₹500). The cascade is free-first: website →
Serper (only if no role-relevant hit) → Apollo (gated) → Snov (gated) → generic guess.

## Rules
1. **Apollo/Snov stay OFF** unless the user explicitly asks to enable them — enabling is a money
   decision, pause and confirm.
2. **Free runs must not lock a company in the paid cooldown.** `paid_provider` should be true only
   when `apollo>0 || snov>0`. A ₹1 Serper call alone does not make a run "paid".
3. **Raising a budget/cap is a money change** — confirm with the user, don't do it silently.
4. **Cost anomaly?** A run that shows spend with Apollo/Snov off is a bug — investigate the
   `paid_provider` flagging (this is the class of bug behind the Infosys cooldown lock; fix via
   `ge-prod-data-mutation`).

## Never
- Never enable Apollo/Snov without an explicit human go.
- Never raise a discovery budget/cap silently.
- Never flag a free run as `paid_provider=true` (it wrongly burns the 30-day cooldown).
