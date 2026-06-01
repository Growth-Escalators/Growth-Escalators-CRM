#!/usr/bin/env bash
# Meta App Review — TASK 4: Verify at least one PAUSED campaign exists in
# the Paraiso ad account. Required for the ads_management warm-up call to
# be idempotent + non-destructive.
#
# Execute via:
#   railway run --service web bash scripts/meta-app-review/verify-paused-campaign.sh
#
# Outputs:
#   /tmp/paused_campaigns.json — full Graph API response
#   stdout — count + first campaign id (use as input to warm-permissions.sh)

set -euo pipefail
: "${META_ACCESS_TOKEN:?META_ACCESS_TOKEN must be set — run via 'railway run --service web ...'}"

AD_ACCOUNT="act_689363376592426"
GRAPH_VERSION="v21.0"

echo "=== Querying PAUSED campaigns in $AD_ACCOUNT ==="
curl -sS -G "https://graph.facebook.com/${GRAPH_VERSION}/${AD_ACCOUNT}/campaigns" \
  --data-urlencode "fields=id,name,status,effective_status,updated_time" \
  --data-urlencode 'effective_status=["PAUSED"]' \
  --data-urlencode "access_token=${META_ACCESS_TOKEN}" \
  | tee /tmp/paused_campaigns.json
echo

COUNT=$(jq -r '.data | length' /tmp/paused_campaigns.json)
echo "=== Found ${COUNT} PAUSED campaigns ==="

if [[ "$COUNT" == "0" ]]; then
  echo "BLOCKER: no PAUSED campaigns found in Paraiso. Reviewer needs at least one to demo the pause/unpause flow." >&2
  exit 2
fi

FIRST_ID=$(jq -r '.data[0].id' /tmp/paused_campaigns.json)
FIRST_NAME=$(jq -r '.data[0].name' /tmp/paused_campaigns.json)
echo "First paused campaign: ${FIRST_ID} (\"${FIRST_NAME}\")"
echo
echo "Use this campaign id for Task 6c (ads_management warm-up):"
echo "  railway run --service web bash scripts/meta-app-review/warm-permissions.sh ${FIRST_ID}"
