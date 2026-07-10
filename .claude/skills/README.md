# Skills index

**Skills** are trigger-activated procedures. Each lives in `<name>/SKILL.md` with a `description`
(the trigger — the phrases/situations that load it) and a body (the exact safe steps for that task).
When you say something that matches a trigger, the skill loads **before** the work starts, so the
safe/repeatable path is un-skippable — for any agent (Claude Code, Codex) or a fresh chat.

## How to use one
- **Automatically:** just phrase the task. "Remove Rahul from the CRM" → `ge-prod-data-mutation` fires.
- **Explicitly:** type `/<skill-name>` (e.g. `/wizmatch-daily-ops`).
- **On claude.ai (web/desktop):** upload a skill folder under Settings → Capabilities → Skills
  (needs a paid plan + code execution). Zip a folder so `SKILL.md` is at its root.

---

## The skills

### 🔴 Data & flow safety — the highest-stakes paths
| Skill | Fires when you… | Protects |
|---|---|---|
| [ge-prod-data-mutation](ge-prod-data-mutation/SKILL.md) | write to live Postgres (offboard, unblock, reset cooldown, backfill, flip a flag) | count-first → reassign → transaction → confirm; no orphaned rows |
| [wizmatch-go-live-sending](wizmatch-go-live-sending/SKILL.md) | enable/expand real cold-email sending | domain reputation + CAN-SPAM; supervised internal test before real sends |
| [ge-cashfree-edge](ge-cashfree-edge/SKILL.md) | touch Cashfree (edge fn, processor, webhook, order tags) | real money; 5 known gotchas |

### 🟠 Recurring build patterns — do it the repo's way
| Skill | Fires when you… | Protects |
|---|---|---|
| [ge-add-contact-path](ge-add-contact-path/SKILL.md) | add code that creates/updates a contact | dedup normalisation + `lastActivityAt` bump |
| [ge-add-route](ge-add-route/SKILL.md) | add an Express endpoint | service/route split + auth |
| [ge-add-migration](ge-add-migration/SKILL.md) | change core CRM schema (`schema.ts`) | generated (not hand-edited) migrations |
| [ge-add-ensure-table](ge-add-ensure-table/SKILL.md) | add a feature/tenant table (Wizmatch, SEO, outreach) | ensure-hook pattern, not `schema.ts` |
| [wizmatch-add-cron](wizmatch-add-cron/SKILL.md) | add/change a worker background job | master gate + `WIZMATCH_API_BASE_URL` (not localhost) |
| [ge-add-wizmatch-admin-page](ge-add-wizmatch-admin-page/SKILL.md) | add an admin page for one tenant | product scoping so it doesn't leak across tenants |
| [ge-add-slack-alert](ge-add-slack-alert/SKILL.md) | add/change a Slack notification | `allowDuringPause` discipline; hands off `sodEodService` |

### 🟡 Operations & guardrails — day-to-day + spend/deploy
| Skill | Fires when you… | Protects |
|---|---|---|
| [wizmatch-daily-ops](wizmatch-daily-ops/SKILL.md) | run the Wizmatch daily loop / "what needs review" | the 8-step routine, guardrails stay blocked |
| [wizmatch-cost-guard](wizmatch-cost-guard/SKILL.md) | touch discovery/enrichment cost paths | Apollo/Snov stay OFF; budgets respected |
| [ge-manage-railway-env](ge-manage-railway-env/SKILL.md) | change a Railway/Vercel env var | right service, never-print-secrets, verify effect |
| [ge-morning-check](ge-morning-check/SKILL.md) | start a session / "is prod ok" | catch overnight regressions in 5 min |
| [ge-debug-prod-down](ge-debug-prod-down/SKILL.md) | prod is reported broken (P0) | outside-in triage playbook |
| [ge-manual-qa](ge-manual-qa/SKILL.md) | after an admin/D2C deploy | walk high-value UI paths (no e2e coverage) |
| [ge-release-check](ge-release-check/SKILL.md) | about to push to `main` | build+test loop (no staging; push = deploy) |
| [ge-ai-context-update](ge-ai-context-update/SKILL.md) | finish a unit of work | keep `.ai/` context layer honest for the next agent |

> `_unused/` holds dormant/vendor skills (incl. `skill-builder`, which can author new ones).

---

## Adding a new skill
1. `mkdir .claude/skills/<name>` and write `SKILL.md` with `name` + `description` frontmatter.
2. **Write the `description` from real past phrasings** — a trigger that doesn't match how you
   actually talk never fires. Include a `Skips:` clause so it doesn't over-trigger.
3. Body = the exact steps + a **Never** list for the failure modes.
4. Reference the real files/flags it guards (with repo-relative links) so it stays honest.
5. Add a row to this index.
