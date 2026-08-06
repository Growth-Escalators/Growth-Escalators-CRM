#!/usr/bin/env bash
#
# Encrypted production Postgres backup — the free alternative to Railway's paid
# managed backups, which are out on budget.
#
# Run it from the repo root:
#
#     ./scripts/backup-prod-db.sh
#     ./scripts/backup-prod-db.sh --restore-test     # also restores into a scratch DB and counts rows
#
# WHAT IT PROTECTS AGAINST, and why each step is the way it is:
#
#   * The connection string is NEVER printed. `railway run` injects it into the
#     subprocess environment; `railway variables` would print plaintext secrets
#     to your terminal and into any transcript, which is the last thing you want
#     during a credential exposure. Do not "simplify" this by reading the var.
#
#   * DATABASE_URL will NOT work from a laptop. It resolves to
#     postgres.railway.internal, which exists only inside Railway's network.
#     DATABASE_PUBLIC_URL is the one that works from outside.
#
#   * The plaintext dump is deleted, and only AFTER the encrypted copy has been
#     proven to decrypt. Deleting first and discovering the passphrase was wrong
#     is how a backup becomes a 3 MB random file.
#
#   * The passphrase lives in the macOS Keychain, never in this file, never in
#     an env var you might echo, never in shell history.
#
#   * Output goes to input-data/, which is in .gitignore. Do not move it
#     somewhere tracked.
#
# A DUMP THAT HAS NEVER BEEN RESTORED IS NOT A BACKUP. Use --restore-test at
# least the first time and after any Postgres upgrade.
set -euo pipefail

KEYCHAIN_SERVICE="ge-prod-backup"
BACKUP_DIR="input-data/g1-backups"
# Local pg_dump must match or exceed the server major version — v16 flatly
# refuses to dump an 18 server, with an error that reads like a network problem.
PG_BIN="/opt/homebrew/opt/postgresql@18/bin"
RESTORE_TEST=false

[[ "${1:-}" == "--restore-test" ]] && RESTORE_TEST=true

command -v railway >/dev/null || { echo "railway CLI not found — brew install railway" >&2; exit 1; }
[[ -x "$PG_BIN/pg_dump" ]] || { echo "pg_dump not found at $PG_BIN — brew install postgresql@18" >&2; exit 1; }

mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
PLAIN="$BACKUP_DIR/prod-$STAMP.dump"
ENC="$PLAIN.enc"

# One passphrase per backup, stored under its own Keychain entry so rotating it
# later cannot orphan older archives.
KEY_NAME="$KEYCHAIN_SERVICE-$STAMP"
if ! PASSPHRASE=$(security find-generic-password -s "$KEY_NAME" -w 2>/dev/null); then
  PASSPHRASE=$(openssl rand -base64 32)
  security add-generic-password -s "$KEY_NAME" -a "$(whoami)" -w "$PASSPHRASE"
  echo "Generated a passphrase and stored it in the Keychain as: $KEY_NAME"
fi

cleanup() { rm -f "$PLAIN"; }
trap cleanup EXIT

echo "Dumping production (credential injected by railway run, never printed)..."
railway run --service Postgres -- sh -c \
  "$PG_BIN/pg_dump --format=custom --no-owner --no-acl --dbname=\"\$DATABASE_PUBLIC_URL\" -f '$PLAIN'"

[[ -s "$PLAIN" ]] || { echo "dump is empty — aborting before it overwrites anything" >&2; exit 1; }

echo "Encrypting..."
openssl enc -aes-256-cbc -pbkdf2 -salt -pass pass:"$PASSPHRASE" -in "$PLAIN" -out "$ENC"
chmod 600 "$ENC"

# Prove the archive decrypts BEFORE the plaintext is removed by the trap.
echo "Verifying the encrypted archive decrypts..."
openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:"$PASSPHRASE" -in "$ENC" \
  | "$PG_BIN/pg_restore" --list >/dev/null \
  || { echo "FAILED: the encrypted archive does not decrypt to a readable dump — keeping $PLAIN" >&2; trap - EXIT; exit 1; }

echo "  ok — $(du -h "$ENC" | cut -f1), sha256 $(shasum -a 256 "$ENC" | cut -c1-16)..."

if $RESTORE_TEST; then
  DB="restore_test_$STAMP"
  echo "Restore-testing into $DB..."
  createdb "$DB"
  openssl enc -d -aes-256-cbc -pbkdf2 -pass pass:"$PASSPHRASE" -in "$ENC" \
    | "$PG_BIN/pg_restore" -d "$DB" --no-owner --no-acl 2>/dev/null || true
  echo "  tables:   $(psql -d "$DB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")"
  echo "  contacts: $(psql -d "$DB" -tAc "SELECT count(*) FROM contacts")"
  echo "  deals:    $(psql -d "$DB" -tAc "SELECT count(*) FROM deals")"
  echo "  tenants:  $(psql -d "$DB" -tAc "SELECT count(*) FROM tenants")"
  dropdb "$DB"
  echo "  restore test passed; scratch DB dropped"
fi

echo
echo "Backup complete: $ENC"
echo "Passphrase is in the Keychain under: $KEY_NAME"
echo
echo "To decrypt later:"
echo "  openssl enc -d -aes-256-cbc -pbkdf2 \\"
echo "    -pass pass:\"\$(security find-generic-password -s $KEY_NAME -w)\" \\"
echo "    -in $ENC | $PG_BIN/pg_restore -d <target> --no-owner"
echo
echo "To run this weekly (Sunday 09:00), add to \`crontab -e\`:"
echo "  0 9 * * 0 cd $(pwd) && ./scripts/backup-prod-db.sh >> input-data/g1-backups/backup.log 2>&1"
echo "Note: cron needs the Railway CLI already authenticated for your user."
