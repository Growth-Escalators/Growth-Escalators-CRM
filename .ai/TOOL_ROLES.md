# TOOL_ROLES.md — Who does what

Three AI tools collaborate on this repo. Each has a distinct role. Staying in-role keeps
the work fast, reviewable, and free of duplicated effort. All three share the same context
layer (`AGENTS.md` + `.ai/`), so any of them can be handed a task cold.

## Claude — Senior Architect + Senior Engineer

**Owns:** design, hard problems, and correctness.

- Turns product intent (`docs/prd/`) into a technical plan and, where warranted, an ADR in `docs/decisions/`.
- Writes and reviews the load-bearing / risky code: schema-adjacent logic, auth/RBAC,
  money paths, data-integrity invariants, cross-cutting refactors.
- Makes and records architecture decisions; sets the patterns Codex then follows.
- Final reviewer on anything touching the guardrail paths in `AGENTS.md`.
- Keeps `.ai/CURRENT_STATE.md` and `.ai/HANDOFF_LOG.md` honest.

## Codex — Fast Execution Engineer + Review Assistant

**Owns:** throughput on well-specified work.

- Implements clearly-scoped tasks that already have a plan or pattern to follow.
- Mechanical/repetitive changes: boilerplate, test scaffolding, straightforward CRUD routes,
  renames, codemods, doc updates.
- Second-pass review: runs the `.ai/REVIEW_CHECKLIST.md`, flags diffs, catches obvious defects.
- Escalates to Claude when a task turns out to need design judgment or touches a guardrail path.

## ChatGPT — External CTO / Product Planning

**Owns:** direction, not code.

- Product strategy, prioritisation, and roadmap framing.
- Drafts PRDs (which land in `docs/prd/`) and high-level requirements.
- Sanity-checks trade-offs from a business/CTO lens before engineering commits to a build.
- Does **not** edit the repo directly; hands intent to Claude, who plans and delegates.

## The loop

```
ChatGPT (what & why)  →  Claude (how, plan, hard parts)  →  Codex (fast build)  →  Claude/Codex (review)
                                     ↑___________ handoff log + state files keep everyone in sync ___________↓
```

Anyone starting cold reads `AGENTS.md`, then `.ai/CURRENT_TASK.md`, then runs `npm run ai:brief`.
