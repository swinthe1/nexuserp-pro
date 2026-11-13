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
fi
# this server's id: made once (or given by the Windows installer, which checked the licence with it already)
[ -n "${SERVER_ID:-}" ] || SERVER_ID="$(cat /proc/sys/kernel/random/uuid)"
grep -q '^SERVER_ID=.' .env || echo "SERVER_ID=$SERVER_ID" >> .env
grep -q '^LICENCE=.' .env || { sed -i '/^LICENCE=/d' .env; echo "LICENCE=$LICENCE" >> .env; }

pass="$(docker exec drispro-db printenv POSTGRES_PASSWORD)"
sql() { docker exec -i -e PGPASSWORD="$pass" -e PGOPTIONS='-c client_min_messages=warning' drispro-db psql -h 127.0.0.1 -U postgres -d postgres -v ON_ERROR_STOP=1 -q -t -A "$@"; }

# the administrator signs in like everyone else: a user name and a 6-digit PIN (the account under it has an
# email no one types and a password no one knows). Asked until it is there, also when an earlier try failed.
uid_of() { sql -v email="$1" <<<"select id from auth.users where lower(email) = lower(:'email');"; }
has_login() { [ -n "${ADMIN_EMAIL:-}" ] && [ "$(sql -v email="$ADMIN_EMAIL" <<<"select count(*) from app.user_logins l join auth.users u on u.id = l.user_id where lower(u.email) = lower(:'email');")" != 0 ]; }
pin_problem() { sql -v pin="$1" <<<"select app.check_login_pin(:'pin');" 2>&1 >/dev/null | sed -n 's/^ERROR: *//p' || true; }
if ! has_login && [ -n "${ADMIN_USER:-}" ] && [ -n "${ADMIN_PIN:-}" ]; then
  # given by the Windows installer (or in the environment): checked, not asked
  ADMIN_USER="$(echo "$ADMIN_USER" | tr '[:upper:]' '[:lower:]' | tr -d ' ')"
  [[ "$ADMIN_USER" =~ ^[a-z0-9][a-z0-9._-]{2,29}$ ]] || { echo "@@error admin_user The user name is 3 to 30 letters or digits (a dot, a dash or _ also)"; exit 3; }
  err="$(pin_problem "$ADMIN_PIN")"; [ -z "$err" ] || { echo "@@error admin_pin $err"; exit 3; }
elif ! has_login; then
  [ -t 0 ] || { echo "No administrator yet: run  bash licence.sh  on this server"; exit 1; }
  echo "    The administrator of this server (signs in with a user name and a PIN, like everyone):"
  while :; do
    read -rp "    User name (e.g. arben.krasniqi): " ADMIN_USER
    ADMIN_USER="$(echo "$ADMIN_USER" | tr '[:upper:]' '[:lower:]' | tr -d ' ')"
    [[ "$ADMIN_USER" =~ ^[a-z0-9][a-z0-9._-]{2,29}$ ]] && break
    echo "    3 to 30 letters or digits (a dot, a dash or _ also): again"
  done
  while :; do
    read -rsp "    PIN, 6 digits (it does not show while typed): " ADMIN_PIN; echo
    err="$(pin_problem "$ADMIN_PIN")"
    [ -z "$err" ] || { echo "    $err: again"; continue; }
    read -rsp "    The same PIN again: " again; echo
    [ "$again" = "$ADMIN_PIN" ] && break
    echo "    the two are not the same: again"
  done
  read -rp "    Full name: " ADMIN_NAME
fi
if ! has_login; then
  [ -n "${ADMIN_EMAIL:-}" ] || ADMIN_EMAIL="${ADMIN_USER}@admin.drispro.local"
  sql -v email="$ADMIN_EMAIL" -v password="$(openssl rand -hex 24)" -v name="${ADMIN_NAME:-}" -v username="$ADMIN_USER" -v pin="$ADMIN_PIN" <<'SQL' >/dev/null
select app.create_auth_user(:'email', :'password', :'name');
update public.profiles set full_name = coalesce(nullif(:'name', ''), full_name) where lower(email) = lower(:'email');
select app.set_user_login((select id from auth.users where lower(email) = lower(:'email')), :'username', :'pin', null);
SQL
  echo "    administrator: $ADMIN_USER (signs in with this user name and the PIN)"
fi
# written once the account is there, so a failed try asks again next time
[ -n "${ADMIN_EMAIL:-}" ] && { sed -i '/^ADMIN_EMAIL=/d' .env; echo "ADMIN_EMAIL=$ADMIN_EMAIL" >> .env; }

version="$(cat VERSION 2>/dev/null || echo local)"
body="$(printf '{"p_code":"%s","p_server":"%s","p_url":"%s","p_version":"%s"}' "$LICENCE" "$SERVER_ID" "${PUBLIC_URL:-}" "$version")"
res="$(curl -sS --max-time 20 -X POST "$LICENCE_SERVER/rest/v1/rpc/licence_check" -H "apikey: $CLOUD_ANON_KEY" -H "Authorization: Bearer $CLOUD_ANON_KEY" \
       -H 'Content-Type: application/json' -d "$body" -w '\n%{http_code}' 2>&1)" || { echo "    $(date '+%F %T') no connection to $LICENCE_SERVER: licence unchanged"; echo "@@warn licence_offline"; exit 1; }
code="${res##*$'\n'}"; json="${res%$'\n'*}"
if [ "$code" != 200 ]; then echo "    $(date '+%F %T') licence refused ($code): $(echo "$json" | head -c 300)"; echo "@@error licence $(echo "$json" | sed -n 's/.*"message" *: *"\([^"]*\)".*/\1/p' | head -c 200)"; exit 4; fi
sql -v admin="$ADMIN_EMAIL" -v lic="$json" >/dev/null <<'SQL'
select app.apply_licence(:'lic'::jsonb, :'admin');
SQL
echo "    $(date '+%F %T') licence $LICENCE: $(echo "$json" | sed -n 's/.*"plan" *: *"\([^"]*\)".*/\1/p') until $(echo "$json" | sed -n 's/.*"valid_until" *: *"\([^"]*\)".*/\1/p')"
