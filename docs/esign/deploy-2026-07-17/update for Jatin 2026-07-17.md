# Update for Jatin — 2026-07-17

## Contracts & E-Signature — ✅ LIVE IN PRODUCTION

### TL;DR
Contracts & E-Signature is **live**. Along the way I found and fixed a separate bug in your last
two merged PRs (#52/#53) that had **silently broken every production deploy for ~8 hours** — so this
also un-stuck all your other deploys. Full stack verified working.

---

### ✅ Verified live
- **Deploy `cbfba28d` (commit `de31045`) — SUCCESS.** Prod is running the new code.
- `GET /api/contracts` → **401** (route mounted + auth-guarded).
- Documenso API token → **200** (`{"documents":[],"totalPages":0}`) — the CRM can talk to Documenso.
- Documenso webhook → `https://api.growthescalators.com/webhooks/documenso`, 6 events, secret aligned.
- CRM admin SPA (`crm.growthescalators.com`) → 200, Contracts page in the nav for **both** Growth
  Escalators and Wizmatch.
- All 6 CRM env vars set (`ESIGN_PROVIDER`, `DOCUMENSO_API_URL`, `DOCUMENSO_API_TOKEN`,
  `DOCUMENSO_EMBED_ORIGIN`, `DOCUMENSO_WEBHOOK_SECRET`, `CONTRACTS_SIGNING_SECRET`).

### 🐛 The real blocker I found & fixed (PR #57, merged)
Your PRs #52/#53 ("reliability hardening") shipped a migration-runner bug: it holds a
`pg_advisory_lock` on a dedicated DB client but releases it in unreachable code, so
`await pool.end()` hangs forever, `migrate.js` never exits, and the start command's
`&& node dist/index.js` never runs — every deploy died on a **silent healthcheck failure** and prod
was pinned to the 02:21 code. Fix: release the lock client before `pool.end()`. Verified: migrate
exits cleanly, the full `migrate && index` chain serves `/health` in ~2s, 713 tests pass.

### 🔑 Your Documenso admin
- URL: https://documenso-production-71b3.up.railway.app — login `jatin@growthescalators.com` / your password.
- Account was verified directly in the DB (Railway blocks outbound SMTP, so the verification email
  couldn't send). This is fine: the CRM emails signers their links over Brevo's HTTP API, and the
  provider now tells Documenso `sendEmail:false`, so Documenso's mailer isn't used in the flow.

### 📄 How to use it — see the usage guide
[`HOW-TO-USE-CONTRACTS.md`](./HOW-TO-USE-CONTRACTS.md)

### ⚠️ Security — still outstanding (please action)
Your **live production secrets** (Anthropic, Meta, Cashfree, GitHub PAT, R2, Brevo, JWT, Purelymail,
WhatsApp, …) are readable in the Railway config and the same set is committed in
`wizmatch-railway-env.txt`. Please **rotate them** and **scrub that file from git history.**
