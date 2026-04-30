#!/usr/bin/env bash
# PostToolUse / Write|Edit|MultiEdit hook: sticky pointer when
# any Cashfree path is edited. Real-money flow — the ge-cashfree-edge
# skill captures order_tags / signature / idempotency invariants.

set -u
input=$(cat)
file_path=$(printf '%s' "$input" | jq -r '.tool_input.file_path // ""')

case "$file_path" in
  */src/routes/cashfree.ts|src/routes/cashfree.ts \
  |*/src/services/cashfreeEventProcessor.ts|src/services/cashfreeEventProcessor.ts \
  |*/client/api/cashfree/*|client/api/cashfree/*)
    echo "Cashfree path edited — load skill ge-cashfree-edge before continuing. Real-money path." >&2
    exit 2
    ;;
esac
exit 0
