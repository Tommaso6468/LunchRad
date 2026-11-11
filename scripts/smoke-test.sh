#!/usr/bin/env bash
# Post-deploy check: the app answers and the security headers are in place.
# Usage: scripts/smoke-test.sh https://lunchrad-staging.example.workers.dev
set -euo pipefail

BASE_URL="${1:?usage: smoke-test.sh <base-url>}"
BASE_URL="${BASE_URL%/}"
fail() { echo "::error::$1"; exit 1; }

health=$(curl -fsS --retry 5 --retry-delay 3 "$BASE_URL/api/health") || fail "health check failed"
[[ "$health" == '{"status":"ok"}' ]] || fail "unexpected health response: $health"

headers=$(curl -fsS -D - -o /dev/null "$BASE_URL/")
for h in "content-security-policy: default-src 'none'" \
         "strict-transport-security:" \
         "x-content-type-options: nosniff" \
         "x-frame-options: deny" \
         "cache-control: no-store"; do
  grep -qi "^$h" <<<"$headers" || fail "missing or wrong header on /: $h"
done
grep -qi "^content-security-policy:.*unsafe-" <<<"$headers" && fail "CSP contains an unsafe- directive"

echo "Smoke test passed for $BASE_URL"
