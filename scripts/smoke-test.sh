#!/usr/bin/env bash
# Post-deploy check: the app answers and the security headers are in place.
# Usage: scripts/smoke-test.sh https://lunchrad-staging.example.workers.dev
set -euo pipefail

BASE_URL="${1:?usage: smoke-test.sh <base-url>}"
BASE_URL="${BASE_URL%/}"
fail() { echo "::error::$1"; exit 1; }

[[ "$BASE_URL" =~ ^https://[a-z0-9.-]+$ ]] || fail "BASE_URL must be https://<host> without a path, got: $BASE_URL"
echo "Smoke testing $BASE_URL"

# A brand-new workers.dev hostname can take a minute or two to resolve and
# get a certificate, so retry for up to ~2 minutes and log every attempt.
health=""
for attempt in $(seq 1 24); do
  code=$(curl -sS -m 10 -o /tmp/health.json -w '%{http_code}' "$BASE_URL/api/health" 2>/tmp/health.err) || code="error: $(tr -d '\n' </tmp/health.err)"
  echo "attempt $attempt: $code"
  if [[ "$code" == "200" ]]; then
    health=$(cat /tmp/health.json)
    break
  fi
  sleep 5
done
[[ -n "$health" ]] || fail "health check failed after 24 attempts (last: $code)"
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
