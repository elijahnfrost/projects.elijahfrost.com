#!/usr/bin/env bash
# Creates or updates the Vercel-recommended A record for projects.elijahfrost.com.
# Requires: CF_ZONE_ID and either CF_API_TOKEN or CF_AUTH_EMAIL+CF_GLOBAL_API_KEY
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi
: "${CF_ZONE_ID:?Set CF_ZONE_ID}"
BASE="https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records"
if [[ -n "${CF_AUTH_EMAIL:-}" && -n "${CF_GLOBAL_API_KEY:-}" ]]; then
  H=(-H "X-Auth-Email: ${CF_AUTH_EMAIL}" -H "X-Auth-Key: ${CF_GLOBAL_API_KEY}" -H "Content-Type: application/json")
elif [[ -n "${CF_API_TOKEN:-}" ]]; then
  H=(-H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json")
else
  echo "Set CF_API_TOKEN or CF_AUTH_EMAIL + CF_GLOBAL_API_KEY" >&2
  exit 1
fi
RECORD_IP="76.76.21.21"

EXISTING="$(curl -sS -G "${BASE}" --data-urlencode "type=A" --data-urlencode "name=projects.elijahfrost.com" "${H[@]}")"
ID="$(echo "$EXISTING" | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(j.success&&j.result[0]?j.result[0].id:'')")"

BODY="$(node -e "console.log(JSON.stringify({type:'A',name:'projects',content:'${RECORD_IP}',ttl:1,proxied:true}))")"

if [[ -n "$ID" ]]; then
  curl -sS -X PUT "${BASE}/${ID}" "${H[@]}" -d "$BODY" | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!j.success) { console.error(j); process.exit(1);} console.log('Updated DNS record', j.result&&j.result.name);"
else
  curl -sS -X POST "${BASE}" "${H[@]}" -d "$BODY" | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!j.success) { console.error(j); process.exit(1);} console.log('Created DNS record', j.result&&j.result.name);"
fi
