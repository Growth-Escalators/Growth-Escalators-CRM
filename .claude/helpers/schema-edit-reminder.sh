#!/usr/bin/env bash
# PostToolUse / Write|Edit|MultiEdit hook: sticky reminder when
# src/db/schema.ts is edited. Drizzle requires regenerating the
# migration SQL before the change can land in prod Postgres.

set -u
input=$(cat)
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')

# Match exact schema file (absolute or repo-relative)
case "$file_path" in
  */src/db/schema.ts|src/db/schema.ts)
    echo "schema.ts edited — run \`npm run db:generate\` before committing. Skill: ge-add-migration." >&2
    exit 2
    ;;
esac
exit 0
