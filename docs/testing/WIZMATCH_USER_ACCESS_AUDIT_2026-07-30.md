# WizMatch / Growth Escalators — user access audit, 2026-07-30

**Method:** read-only production query inside `SET default_transaction_read_only=on; BEGIN; …
ROLLBACK;` via the `Postgres` service container. `DATABASE_URL` never left the container.
**No password hash, credential, token or candidate personal datum was selected or is shown.**
Staff work emails are in scope for this internal audit.

**Total: 15 accounts across 2 tenants.** Lane 4 did not report; this inventory was produced
directly by the lead.

---

## 1. WizMatch tenant (3 accounts)

| UUID | Email | Role | Active | `token_version` | Roster | Type | Recommendation |
|---|---|---|---|---|---|---|---|
| `427e6b95-68f7-42b6-83b0-ced1799139b2` | jatin@growthescalators.com | admin | ✅ | 3 | **✅ yes** | human | **KEEP** — approved pilot user |
| `115f2251-cf72-417e-bdbb-b63cd23415b3` | kanishk.khandelwal@growthescalators.com | admin | ✅ | 4 | **✅ yes** | human | **KEEP** — approved pilot user |
| `acdab2ee-7e02-4e7d-b2c1-4bcabd4f2579` | deck-sync@wizmatch | viewer | ✅ | 1 | ❌ no | machine | **MACHINE-DO-NOT-REMOVE** |

The pilot roster contains **exactly** the two admin UUIDs — verified by set equality against the
running process (`WIZMATCH_STAFFING_PILOT_USER_IDS`, 2 entries) and confirmed live:
both are admitted (ROSTER-1/2 PASS) while non-roster admins and team_leads are refused
(ROSTER-3/4 PASS). `WIZMATCH_STAFFING_PILOT_ALL_USERS=false`.

> **Consequence of defect M-1:** `deck-sync@wizmatch` is the exact `viewer` principal the F-A
> machine-sync lane exists to serve — and that lane is currently **unreachable**, so the Command
> Deck sync is broken in production today. It fails closed, so no data is exposed.

---

## 2. Growth Escalators tenant (12 accounts)

| UUID | Email | Role | Active | `tv` | Type | Recommendation |
|---|---|---|---|---|---|---|
| `e480cc54-…` | jatin@growthescalators.com | admin | ✅ | 5 | human | KEEP |
| `b49f78bb-…` | kanishk.khandelwal@growthescalators.com | admin | ✅ | 2 | human | KEEP |
| `a27b51a7-…` | sakcham@growthescalators.com | admin | ✅ | 3 | human | KEEP |
| `0ffa408a-…` | meta-reviewer@growthescalators.com | **admin** | ✅ | 1 | **test account** (`is_test_account=true`) | **REVIEW** — see §4 |
| `8b117307-…` | nimisha.daiya@growthescalators.com | staff | ✅ | 5 | human | **REVIEW NOW — H-2** |
| `91ebb3ee-…` | keshav.growthescalators@gmail.com | staff | ✅ | 3 | human (**personal Gmail**) | **REVIEW** — see §4 |
| `3abb0a04-…` | mayanksureka7808@gmail.com | creative_assistant | ✅ | 3 | human (**personal Gmail**) | **REVIEW** — see §4 |
| `8ffb87eb-…` | deck-sync@ge | viewer | ✅ | 1 | machine | **MACHINE-DO-NOT-REMOVE** |
| `2580e7ac-…` | sneha.joshi@growthescalators.com | team_lead | ❌ | 5 | former | KEEP DEACTIVATED |
| `dcdeda02-…` | tushar.jangid@growthescalators.com | team_lead | ❌ | 2 | former | KEEP DEACTIVATED |
| `b03b674e-…` | vishal.malakar@growthescalators.com | manager_ads | ❌ | 3 | former | KEEP DEACTIVATED |
| `4db4e27b-…` | kratika.gangwal@growthescalators.com | creative_assistant | ❌ | 3 | former | KEEP DEACTIVATED |

---

## 3. Verifications requested

| Check | Result |
|---|---|
| Jatin's WizMatch account | ✅ admin, active, correct tenant, on roster |
| Kanishk's WizMatch account | ✅ admin, active, correct tenant, on roster |
| **Itika** | ✅ **0 accounts** in any tenant (case-insensitive `%itika%` → 0). Deferral is real, not assumed. |
| Former employees | 4 found, **all `is_active=false`** — none can log in (AUTH-3 proves inactive login is refused) |
| Machine viewers | 2 (`deck-sync@wizmatch`, `deck-sync@ge`), both `viewer`, both outside every human roster |
| Service accounts | none beyond the two deck-sync principals |
| **Case/whitespace duplicate emails** | **NONE.** See §5. |

---

## 4. Items recommended for REVIEW (none is a defect)

1. **`meta-reviewer@growthescalators.com` — an active `admin` flagged `is_test_account=true`.**
   A test account holding full admin in the Growth tenant. It is not in the WizMatch tenant and not
   on the pilot roster, so it has no WizMatch reach. Worth confirming it is still needed and whether
   admin is the right tier. **Medium-Low.**
2. **Two personal Gmail identities with active access** (`staff` and `creative_assistant`). Neither
   is in the WizMatch tenant. Corporate-identity policy question, not a technical fault. **Low.**
3. **`deck-sync@ge` is not a valid RFC email** (no TLD). Harmless — the login path treats email as
   an opaque key — but it means that principal cannot receive mail or a password reset. **Low.**

None of these affects the two-user WizMatch pilot.

---

## 5. Duplicate-email analysis — no defect

A naive `GROUP BY lower(email) HAVING count(*) > 1` returns two hits:
`jatin@growthescalators.com` (×2) and `kanishk.khandelwal@growthescalators.com` (×2).

**These are legitimate, not duplicates.** Each person holds exactly one account per tenant, and
uniqueness is correctly enforced at `(tenant_id, email)` — `users_tenant_email_unique`. There are
**no** case-variant or whitespace-variant duplicates within any tenant.

**Operational consequence worth restating:** because both operators exist in *two* tenants and
**login is tenant-scoped** (the handler requires `t.slug = tenantSlug`, resolved from the request,
else `DEFAULT_TENANT_SLUG`), an operator who signs in on the wrong slug silently lands in the wrong
tenant. Verified: correct credentials against the wrong slug return **401** (AUTH-5 PASS). This is
also why defect **H-1** matters more here than it would in a single-tenant deployment.

---

## 6. Session revocation and deactivation — the supported mechanism

Verified from code and proven empirically against a local build of the same commit.

**Deactivation** (`src/routes/permissions.ts:309`) performs both actions in one statement:
`SET is_active = false, token_version = COALESCE(token_version, 1) + 1`.

Enforcement points:
- **Login** refuses inactive users — `src/routes/auth.ts:83`,
  `AND (u.is_active IS NULL OR u.is_active = true)`. *(NULL is treated as active — see M-3.)*
- **Every authenticated request** re-checks `token_version` — `src/middleware/auth.ts:81`; a
  mismatch returns 401, and the lookup **fails closed** on a database error.
- Propagation is bounded by a 30 s cache (`TOKEN_VERSION_CACHE_TTL_MS`, L-1).

**Proven live (local, synthetic):** `REVOKE-1` — a `token_version` bump turned a working session
from 200 to 401. `REVOKE-2` — full deactivation killed the live session **and** blocked re-login
(200 → 401, re-login 401). `AUTH-3` — an inactive user cannot log in.

**Conclusion: session revocation is effective *via the supported API path*** — a deactivated former
employee cannot log in and cannot continue using an existing token beyond ~30 seconds. Two
qualifications found by other lanes and folded in here:

- **H-3 — the standalone offboarding scripts are not equivalent.**
  `src/scripts/removeVishal.ts:93-97` and `removeNimisha.ts:97-101` set `role='deactivated'` and
  `token_version=-1` but **never touch `is_active`**. Login gates on `is_active`, *not* role — so a
  person offboarded only via a script can log back in with a known password and get a fresh token.
  Vishal's row matches the API path (correct mechanism used); the scripts remain a live hazard.
- **H-4 — `optionalAuth` does not re-check `token_version`.** `src/middleware/auth.ts:105-126`
  validates only that the claim exists, never comparing it to the database, and is mounted on
  `/api/outreach/leads` (`src/index.ts:281`). A revoked session keeps working there until natural
  JWT expiry (up to 7 days). Deliberate per the in-code comment; 0 % test coverage.

- **H-2 — `nimisha.daiya@…` is still active** despite a dedicated offboarding script existing in
  the repo since 2026-05-10, with no trace of it having run. **Whether she has left is unverified;
  confirm employment status before acting.**

**Caveat (M-3):** `is_active` is not in `schema.ts` and is created by no migration — it is added at
runtime by a fire-and-forget `ALTER TABLE … IF NOT EXISTS … .catch(() => {})` at
`permissions.ts:21`. On a database built from migrations alone the column is absent, and the login
guard treats its absence/NULL as *active*. Production has the column; a fresh environment or DR
restore may not.

---

## 7. Not covered

Per-user last-login/activity timestamps, API-key or webhook principals outside `users`, and
Railway/Vercel/GitHub platform access were **not** audited — out of scope for this lane and not
inferable from the `users` table.
