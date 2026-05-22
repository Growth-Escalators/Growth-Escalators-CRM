#!/usr/bin/env bash
# Meta App Review — TASK 5: Create a real WhatsApp Business message template
# via the Graph API. This single call satisfies the whatsapp_business_management
# permission warm-up requirement.
#
# Execute via:
#   railway run --service web bash scripts/meta-app-review/create-template.sh
#
# Note: Meta returns the template id immediately but template approval is async.
# A "PENDING" status response is acceptable — the review only requires the API
# call to have been made within the last 30 days.

set -euo pipefail
: "${META_ACCESS_TOKEN:?META_ACCESS_TOKEN must be set — run via 'railway run --service web ...'}"

WABA_ID="4298194920429018"
GRAPH_VERSION="v21.0"
TEMPLATE_NAME="ge_app_review_health_check_v1"

echo "=== Creating WhatsApp template ${TEMPLATE_NAME} on WABA ${WABA_ID} ==="
curl -sS -X POST "https://graph.facebook.com/${GRAPH_VERSION}/${WABA_ID}/message_templates" \
  -H "Authorization: Bearer ${META_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d @- <<JSON | tee /tmp/template_response.json
{
  "name": "${TEMPLATE_NAME}",
  "language": "en_US",
  "category": "UTILITY",
  "components": [
    {
      "type": "BODY",
      "text": "Hi {{1}}, this is a confirmation that your inquiry has been received. Our team will respond within 24 hours."
    }
  ]
}
JSON
echo

# Detect Meta API errors (template name collision is OK — already exists)
if jq -e '.error' /tmp/template_response.json > /dev/null 2>&1; then
  CODE=$(jq -r '.error.code' /tmp/template_response.json)
  MSG=$(jq -r '.error.message' /tmp/template_response.json)
  # Error code 100 / message includes "exists" → treat as success (idempotent)
  if [[ "$MSG" == *"exists"* ]] || [[ "$MSG" == *"already"* ]]; then
    echo "Template already exists (idempotent — counts as success for review)."
    exit 0
  fi
  echo "BLOCKER: Meta template creation failed: [${CODE}] ${MSG}" >&2
  exit 2
fi

TID=$(jq -r '.id // empty' /tmp/template_response.json)
STATUS=$(jq -r '.status // empty' /tmp/template_response.json)
echo "Template created: id=${TID} status=${STATUS}"
