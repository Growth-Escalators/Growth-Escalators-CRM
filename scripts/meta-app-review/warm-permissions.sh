#!/usr/bin/env bash
# Meta App Review — TASK 6: Fire one fresh API call per required permission
# to refresh the 30-day usage window before submission.
#
# Permissions exercised:
#   a) whatsapp_business_messaging — real text msg to +918740888851
#   b) ads_read                    — GET act_*/insights
#   c) ads_management              — re-pause a paused campaign (idempotent)
#   d) business_management         — GET me/businesses
#   e) pages_show_list             — GET me/accounts
#   f) pages_read_engagement       — GET <page>/posts with insights
#
# Execute via:
#   railway run --service web bash scripts/meta-app-review/warm-permissions.sh <paused_campaign_id>
#
# Any non-2xx → STOP and report blocker.

set -euo pipefail
: "${META_ACCESS_TOKEN:?META_ACCESS_TOKEN must be set — run via 'railway run --service web ...'}"

PAUSED_CAMPAIGN_ID="${1:?usage: $0 <paused_campaign_id> (run verify-paused-campaign.sh first)}"

GRAPH_VERSION="v21.0"
AD_ACCOUNT="act_689363376592426"
WA_PHONE_NUMBER_ID="1108264215695554"
JATIN_PHONE="918740888851"   # +91 8740888851

OUTDIR="/tmp/meta-review-warmup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUTDIR"
echo "=== Warm-up outputs will be saved to ${OUTDIR} ==="

# Fail fast on any non-2xx, but capture body to file before failing.
call() {
  local label="$1" url="$2"; shift 2
  local outfile="${OUTDIR}/${label}.json"
  echo "=== ${label} ==="
  local http_code
  http_code=$(curl -sS -o "$outfile" -w "%{http_code}" "$@" "$url")
  echo "HTTP ${http_code}"
  if [[ "$http_code" != 2* ]]; then
    echo "BLOCKER: ${label} returned ${http_code}. Response saved to ${outfile}." >&2
    cat "$outfile" >&2
    exit 2
  fi
  # Even a 200 can carry an error envelope — Meta does this sometimes.
  if jq -e '.error' "$outfile" > /dev/null 2>&1; then
    echo "BLOCKER: ${label} returned an error envelope:" >&2
    jq '.error' "$outfile" >&2
    exit 2
  fi
  jq -C '.' "$outfile" | head -20
  echo
}

# a) whatsapp_business_messaging — REAL message to Jatin's number
echo "=== (a) whatsapp_business_messaging → REAL message to +${JATIN_PHONE} ==="
call "a_wa_messaging" "https://graph.facebook.com/${GRAPH_VERSION}/${WA_PHONE_NUMBER_ID}/messages" \
  -X POST \
  -H "Authorization: Bearer ${META_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  --data "$(cat <<JSON
{"messaging_product":"whatsapp","to":"${JATIN_PHONE}","type":"text","text":{"body":"Meta App Review automated health check — please ignore. Sent at $(date -Iseconds)."}}
JSON
)"

# b) ads_read
call "b_ads_read" "https://graph.facebook.com/${GRAPH_VERSION}/${AD_ACCOUNT}/insights?date_preset=last_7d&fields=spend,impressions,clicks&access_token=${META_ACCESS_TOKEN}"

# c) ads_management — idempotent re-pause
call "c_ads_management" "https://graph.facebook.com/${GRAPH_VERSION}/${PAUSED_CAMPAIGN_ID}" \
  -X POST \
  -H "Authorization: Bearer ${META_ACCESS_TOKEN}" \
  -d "status=PAUSED"

# d) business_management
call "d_business_management" "https://graph.facebook.com/${GRAPH_VERSION}/me/businesses?fields=id,name,verification_status&access_token=${META_ACCESS_TOKEN}"

# e) pages_show_list
call "e_pages_show_list" "https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?access_token=${META_ACCESS_TOKEN}"

# f) pages_read_engagement
# Resolve Paraiso page id — first from env override, else first page in me/accounts
PARAISO_PAGE_ID="${PARAISO_PAGE_ID:-}"
if [[ -z "$PARAISO_PAGE_ID" ]]; then
  PARAISO_PAGE_ID=$(jq -r '.data[0].id' "${OUTDIR}/e_pages_show_list.json")
  echo "Resolved Paraiso page id from me/accounts: ${PARAISO_PAGE_ID}"
fi

call "f_pages_read_engagement" "https://graph.facebook.com/${GRAPH_VERSION}/${PARAISO_PAGE_ID}/posts?fields=insights.metric(post_impressions,post_reactions_by_type_total)&limit=5&access_token=${META_ACCESS_TOKEN}"

echo "=== ✅ All six permissions warmed ==="
echo "Response bodies (redact access_token before sharing): ${OUTDIR}/"
