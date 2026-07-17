# Blockers — Contracts & E-Signature

No genuine blockers. (A technical issue is only a blocker after root-cause investigation + ≥3
attempts + no safe workaround, and it prevents a mandatory acceptance criterion — see the spec §13.)

## Non-blocking flags
- **Committed secrets** in `wizmatch-railway-env.txt` (repo root) — live keys. User: flag-only. Needs
  rotation + git-history scrub (gated). Not blocking this feature.
- **Local Node v24 vs repo-pinned Node 20** — fall back to `nvm use 20` if any build/test misbehaves.
- **Real R2/Documenso creds** not required locally — mock + local Docker cover verification; real-cred
  steps documented in DEPLOYMENT.md.
