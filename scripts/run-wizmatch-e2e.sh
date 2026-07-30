#!/usr/bin/env bash
# WizMatch real-backend E2E harness — closes failure-matrix finding M-2.
#
# M-2 recorded that 15 real-backend Playwright tests "cannot be un-skipped":
# WIZMATCH_E2E_TEST_PASSWORD was confirmed visible to node, yet the specs still
# reported `skipped`, and the cause was never established.
#
# THE CAUSE IS NOT A CODE DEFECT. The specs and playwright.wizmatch-local.config.ts
# are correct as written. `export VAR=...` in one shell invocation followed by
# `npx playwright test` in a SEPARATE invocation loses the variable — each command
# starts a fresh shell, and only the working directory persists. The original
# diagnosis verified the variable in one shell and ran the tests in another, so it
# was measuring two different processes.
#
# Verified both directions during the 2026-07-30 QA run:
#   same invocation      -> tests EXECUTE (fail on a missing backend, not skip)
#   variable absent      -> 2 skipped
#
# This script exists so the working path is executable rather than described:
# everything below runs in ONE process, so the credential cannot be lost between
# setting it and using it.
#
# Usage: bash scripts/run-wizmatch-e2e.sh
#
# SAFETY: every value here is synthetic and local-only. This never points at
# production, never sends email, and never invokes a paid or real provider —
# every send/spend/provider flag is pinned off below.
set -uo pipefail
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; nvm use 20 >/dev/null 2>&1
cd "$(dirname "$0")/.."

DB="${WIZMATCH_E2E_DB:-wizmatch_e2e_test}"
DB_HOST="${WIZMATCH_E2E_DB_HOST:-localhost}"
DB_PORT="${WIZMATCH_E2E_DB_PORT:-5432}"
PORT=3000
BACKEND_LOG="${TMPDIR:-/tmp}/wizmatch-e2e-backend.log"

# Refuse to run against anything that is not obviously a disposable test DB.
# A typo here would otherwise point a WRITING test suite at real data.
case "$DB" in
  *test*|*qa*|*e2e*) ;;
  *) echo "REFUSING: database '$DB' is not obviously disposable (needs 'test', 'qa' or 'e2e' in the name)." >&2; exit 2 ;;
esac

export DATABASE_URL="postgresql://${DB_HOST}:${DB_PORT}/${DB}"
export NODE_ENV="development" PORT="$PORT"
export JWT_SECRET="wizmatch-e2e-local-only-jwt-secret"
export DISABLE_BACKGROUND_JOBS="true"

# The credential the hardening specs gate on. Synthetic, local-only, and
# exported in the SAME process that runs Playwright — this is the whole point.
export WIZMATCH_E2E_TEST_PASSWORD="${WIZMATCH_E2E_TEST_PASSWORD:-WizmatchE2ePassw0rd!}"
export WIZMATCH_E2E_TEST_EMAIL="${WIZMATCH_E2E_TEST_EMAIL:-e2e.wizmatch.test@example.invalid}"
export WIZMATCH_E2E_BACKEND_URL="http://127.0.0.1:${PORT}"

# Pilot surfaces on (the flag-on configuration the live pilot runs — and the one
# in which failure-matrix M-1 reproduces).
export WIZMATCH_COMPANY_POLICY_ENABLED="true"
export WIZMATCH_DECISION_WORKBENCH_ENABLED="true"
export WIZMATCH_STAFFING_PILOT_ALL_USERS="true"
export WIZMATCH_STAFFING_GATE_A_ENABLED="true"

# Every send / spend / provider path pinned OFF. Each of these fails closed when
# unset; they are set explicitly anyway so the harness states its own posture
# rather than depending on a default.
export WIZMATCH_SENDING_ENABLED="false"
export AUTOMATED_EMAILS_ENABLED="false"
export WIZMATCH_AUTO_PREP_ENABLED="false"
export WIZMATCH_OUTREACH_ADAPTER_ENABLED="false"
export WIZMATCH_PAID_DISCOVERY_ENABLED="false"
export WIZMATCH_ENABLE_APOLLO="false"
export WIZMATCH_ENABLE_SNOV="false"
export WIZMATCH_GOOGLE_FALLBACK_ENABLED="false"
export OUTREACH_PROVIDER="mock"
export WIZMATCH_POLICY_ENFORCEMENT_MODE="shadow"

BACKEND_PID=""
cleanup() { [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null; }
trap cleanup EXIT

echo "[e2e] booting backend on :$PORT against $DB (log: $BACKEND_LOG)"
npx tsx src/index.ts >"$BACKEND_LOG" 2>&1 &
BACKEND_PID=$!

for _ in $(seq 1 40); do
  curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1 && break
  sleep 1
done
if ! curl -sf "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
  echo "[e2e] backend did not come up — last 40 log lines:" >&2
  tail -40 "$BACKEND_LOG" >&2
  exit 1
fi
echo "[e2e] backend healthy"

RESULT_LOG="${TMPDIR:-/tmp}/wizmatch-e2e-playwright.log"
npx playwright test --config=playwright.wizmatch-local.config.ts "$@" 2>&1 | tee "$RESULT_LOG"
STATUS=${PIPESTATUS[0]}

# M-2's requested regression guard: a skipped real-backend test must not be
# allowed to read as a pass. The headline counts previously overstated coverage
# precisely because 15 tests skipped silently.
SKIPPED=$(grep -oE '[0-9]+ skipped' "$RESULT_LOG" | tail -1 | grep -oE '^[0-9]+' || true)
if [ -n "${SKIPPED:-}" ] && [ "$SKIPPED" -gt 0 ]; then
  echo "" >&2
  echo "[e2e] FAIL: $SKIPPED test(s) skipped. A skipped real-backend test is not a pass." >&2
  echo "[e2e] If this is the credential gate, the variable was lost between shells — that is M-2." >&2
  exit 3
fi

exit "$STATUS"
