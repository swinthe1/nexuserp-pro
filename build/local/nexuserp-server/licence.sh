#!/usr/bin/env bash
# Checks this server's licence with DrisPRO (the cloud) and applies it here: plan, users, dates,
# suspended or not. The first time it also makes the company, owned by the administrator.
# Runs from install.sh and every night (cron). Without internet nothing changes here and the
# licence stays as it was until its end date.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
set -a; . ./.env; set +a
# the cloud's public key (anon role: it can only call the public licence functions)
CLOUD_ANON_KEY="${CLOUD_ANON_KEY:-eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc5Mjg0NTY2MCwiZXhwIjo0OTQ4NTE5MjYwLCJyb2xlIjoiYW5vbiJ9.b6G9lu0yfVwPpWlddYYql4Hf0oelvnyrF-JH_xl3jd0}"
LICENCE_SERVER="${LICENCE_SERVER:-https://api.erp.dris-ks.com}"

if [ -z "${LICENCE:-}" ]; then
  [ -t 0 ] || { echo "No licence code in .env (LICENCE=...)"; exit 1; }
  read -rp "Licence code (NXS-....-....-....): " LICENCE
  echo "LICENCE=$LICENCE" >> .env
fi
if [ -z "${SERVER_ID:-}" ]; then
  SERVER_ID="$(cat /proc/sys/kernel/random/uuid)"; echo "SERVER_ID=$SERVER_ID" >> .env
fi
if [ -z "${ADMIN_EMAIL:-}" ]; then
  [ -t 0 ] || { echo "No administrator in .env (ADMIN_EMAIL=...)"; exit 1; }
  read -rp "Administrator email (signs in first on this server): " ADMIN_EMAIL
  read -rsp "Administrator password (at least 8 characters): " ADMIN_PASSWORD; echo
  read -rp "Administrator name: " ADMIN_NAME
  echo "ADMIN_EMAIL=$ADMIN_EMAIL" >> .env
elif ! grep -q '^ADMIN_EMAIL=' .env; then echo "ADMIN_EMAIL=$ADMIN_EMAIL" >> .env
fi
grep -q '^LICENCE=.' .env || { sed -i '/^LICENCE=/d' .env; echo "LICENCE=$LICENCE" >> .env; }

pass="$(docker exec nexus-db printenv POSTGRES_PASSWORD)"
sql() { docker exec -i -e PGPASSWORD="$pass" -e PGOPTIONS='-c client_min_messages=warning' nexus-db psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -t -A "$@"; }

# the administrator's account, made once
if [ -n "${ADMIN_PASSWORD:-}" ]; then
  sql -v email="$ADMIN_EMAIL" -v password="$ADMIN_PASSWORD" -v name="${ADMIN_NAME:-}" <<'SQL' >/dev/null
select app.create_auth_user(:'email', :'password', :'name');
update public.profiles set full_name = coalesce(nullif(:'name', ''), full_name) where lower(email) = lower(:'email');
SQL
  echo "    administrator: $ADMIN_EMAIL"
fi

version="$(cat VERSION 2>/dev/null || echo local)"
body="$(printf '{"p_code":"%s","p_server":"%s","p_url":"%s","p_version":"%s"}' "$LICENCE" "$SERVER_ID" "${PUBLIC_URL:-}" "$version")"
res="$(curl -sS --max-time 20 -X POST "$LICENCE_SERVER/rest/v1/rpc/licence_check" -H "apikey: $CLOUD_ANON_KEY" -H "Authorization: Bearer $CLOUD_ANON_KEY" \
       -H 'Content-Type: application/json' -d "$body" -w '\n%{http_code}' 2>&1)" || { echo "    $(date '+%F %T') no connection to $LICENCE_SERVER: licence unchanged"; exit 1; }
code="${res##*$'\n'}"; json="${res%$'\n'*}"
if [ "$code" != 200 ]; then echo "    $(date '+%F %T') licence refused ($code): $(echo "$json" | head -c 300)"; exit 1; fi
sql -v admin="$ADMIN_EMAIL" -v lic="$json" >/dev/null <<'SQL'
select app.apply_licence(:'lic'::jsonb, :'admin');
SQL
echo "    $(date '+%F %T') licence $LICENCE: $(echo "$json" | sed -n 's/.*"plan" *: *"\([^"]*\)".*/\1/p') until $(echo "$json" | sed -n 's/.*"valid_until" *: *"\([^"]*\)".*/\1/p')"
