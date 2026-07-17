#!/usr/bin/env bash
# Contracts / e-signature E2E harness. Boots the backend on :3000 (mock e-sign
# provider + local filesystem storage, seeded wizmatch_e2e_test DB), then runs
# the Playwright spec (which boots the admin Vite server on :5184).
# Usage: bash scripts/run-contracts-e2e.sh
set -uo pipefail
export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; nvm use 20 >/dev/null 2>&1
cd "$(dirname "$0")/.."

DB="wizmatch_e2e_test"
PORT=3000
STORE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/contracts-e2e-store.XXXXXX")"
BACKEND_LOG="${TMPDIR:-/tmp}/contracts-e2e-backend.log"

export DATABASE_URL="postgresql://localhost:5432/$DB"
export JWT_SECRET="e2e-jwt-secret"
export CONTRACTS_SIGNING_SECRET="e2e-contracts-sign-secret"
export DOCUMENSO_WEBHOOK_SECRET="e2e-webhook-secret"
export ESIGN_PROVIDER="mock" ESIGN_MOCK_AUTOSIGN="1"
export CONTRACTS_STORAGE="local" CONTRACTS_STORAGE_DIR="$STORE_DIR"
export CRM_BASE_URL="http://127.0.0.1:5184"
export DISABLE_BACKGROUND_JOBS="true" NODE_ENV="development" PORT="$PORT"

BACKEND_PID=""
cleanup() { [ -n "$BACKEND_PID" ] && kill "$BACKEND_PID" 2>/dev/null; rm -rf "$STORE_DIR"; }
trap cleanup EXIT

if lsof -ti:$PORT >/dev/null 2>&1; then
  echo "ERROR: port $PORT is in use. Stop your dev backend (or free :$PORT) and retry."; exit 1
fi

echo "== build backend =="; npm run build >/dev/null 2>&1 || { echo "BUILD FAILED"; exit 1; }
echo "== ensure db + migrate =="
createdb "$DB" 2>/dev/null || true
npm run db:migrate >/dev/null 2>&1 || { echo "MIGRATE FAILED"; exit 1; }
# is_active is an ensure*-added column the login query needs; add it up front to avoid the boot race.
psql "$DATABASE_URL" -q -c "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true" >/dev/null 2>&1

echo "== seed growth-escalators admin user =="
SEED_OUT="$(npx tsx src/scripts/seedContractsE2E.ts 2>&1)"
echo "$SEED_OUT" | grep -E 'TEST_EMAIL|TEST_PASSWORD' || { echo "SEED FAILED:"; echo "$SEED_OUT" | tail -5; exit 1; }
export E2E_PASSWORD="$(echo "$SEED_OUT" | grep -oE 'TEST_PASSWORD=.*' | head -1 | cut -d= -f2-)"
export E2E_EMAIL="$(echo "$SEED_OUT" | grep -oE 'TEST_EMAIL=.*' | head -1 | cut -d= -f2-)"
export E2E_BACKEND_URL="http://localhost:$PORT"
[ -z "$E2E_PASSWORD" ] && { echo "no password captured from seed"; exit 1; }

echo "== boot backend on :$PORT =="
node dist/index.js > "$BACKEND_LOG" 2>&1 & BACKEND_PID=$!
for i in $(seq 1 40); do
  curl -sf --max-time 3 "http://localhost:$PORT/health" >/dev/null 2>&1 && break
  kill -0 "$BACKEND_PID" 2>/dev/null || { echo "BACKEND DIED:"; tail -20 "$BACKEND_LOG"; exit 1; }
  sleep 1
done
curl -sf --max-time 3 "http://localhost:$PORT/health" >/dev/null 2>&1 || { echo "BACKEND NOT HEALTHY:"; tail -20 "$BACKEND_LOG"; exit 1; }
echo "backend healthy"

echo "== run Playwright =="
npx playwright test --config=playwright.contracts-local.config.ts
RESULT=$?
echo "== playwright exit: $RESULT =="
exit $RESULT
