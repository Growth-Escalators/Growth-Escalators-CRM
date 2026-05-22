#!/usr/bin/env bash
# Meta App Review — TASK 7: Verify policy URLs return HTTP 200 and contain
# the keywords Meta expects in each page.
#
# Execute via (no railway needed — public URLs):
#   bash scripts/meta-app-review/verify-policy-urls.sh

set -euo pipefail

failures=0

check() {
  local url="$1"; shift
  local body
  echo
  echo "=== Checking ${url} ==="
  if ! body=$(curl -fsSL --max-time 15 "$url" 2>/dev/null); then
    echo "FAIL: ${url} returned non-200 (or connection error)"
    failures=$((failures + 1))
    return
  fi
  echo "HTTP 200 (length: $(wc -c <<<"$body" | tr -d ' ') bytes)"

  for kw in "$@"; do
    if grep -qiF "$kw" <<<"$body"; then
      echo "  PASS keyword: ${kw}"
    else
      echo "  FAIL keyword missing: ${kw}"
      failures=$((failures + 1))
    fi
  done
}

check "https://growthescalators.com/privacy" "WhatsApp" "Meta" "ad account" "data deletion"
check "https://growthescalators.com/terms" "Growth Escalators"
check "https://growthescalators.com/data-deletion" "delete" "request"

echo
if [[ "$failures" -gt 0 ]]; then
  echo "=== ${failures} policy-URL checks FAILED ==="
  echo "Fix the website (out of scope for this branch) before submitting Meta App Review."
  exit 1
fi
echo "=== ✅ All policy URL checks passed ==="
