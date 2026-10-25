#!/usr/bin/env bash
# One step for a new version: database changes, then a redeploy of the app in Coolify.
# Run on the VPS from the unpacked project (Perditeso-serverin.bat does it for you):
#   bash deploy/coolify/update.sh            # update
#   bash deploy/coolify/update.sh --setup    # once: remember the Coolify token so the redeploy is automatic
set -euo pipefail
cd "$(dirname "$0")/../.."
ENV=/root/.nexuserp-deploy.env

if [ "${1:-}" = "--setup" ]; then
  echo "Coolify: Keys & Tokens -> API tokens -> Create (permission: deploy). Copy the token."
  echo "The app's UUID is in its address in Coolify: .../application/<UUID>"
  read -rp "Coolify address [http://31.97.47.9:8000]: " url; url="${url:-http://31.97.47.9:8000}"
  read -rsp "API token (not shown): " token; echo
  read -rp "UUID of the NexusERP app: " uuid
  db="$(docker ps --format '{{.Names}}' | grep -E '^supabase-db' | head -1 || true)"
  read -rp "Database container [$db]: " c; db="${c:-$db}"
  umask 077
  printf 'COOLIFY_URL=%q\nCOOLIFY_TOKEN=%q\nCOOLIFY_APP=%q\nNEXUS_DB=%q\n' "$url" "$token" "$uuid" "$db" > "$ENV"
  echo "Saved in $ENV (readable by root only)."
  exit 0
fi

# keys the cloud keeps for everyone, typed here and never shown:
#   bash deploy/coolify/update.sh --whatsapp   (Meta WhatsApp: token and phone number ID)
#   bash deploy/coolify/update.sh --ai         (Anthropic API key, for reading supplier invoices)
if [ "${1:-}" = "--whatsapp" ] || [ "${1:-}" = "--ai" ]; then
  if [ -f "$ENV" ]; then . "$ENV"; fi
  db="${NEXUS_DB:-$(docker ps --format '{{.Names}}' | grep -E '^supabase-db' | head -1 || true)}"
  pass="$(docker exec "$db" printenv POSTGRES_PASSWORD)"
  put() { docker exec -i -e PGPASSWORD="$pass" "$db" psql -h 127.0.0.1 -U postgres -d postgres -q -v ON_ERROR_STOP=1 -v k="$1" -v v="$2" >/dev/null <<'SQL'
insert into app.server_secrets (key, value) values (:'k', :'v') on conflict (key) do update set value = excluded.value;
SQL
  }
  if [ "$1" = "--whatsapp" ]; then
    read -rsp "WhatsApp permanent access token (not shown): " v; echo; [ -n "$v" ] && put whatsapp_token "$v"
    read -rp "WhatsApp phone number ID: " v; [ -n "$v" ] && put whatsapp_phone_id "$v"
  else
    read -rsp "Anthropic API key (not shown): " v; echo; [ -n "$v" ] && put anthropic_api_key "$v"
  fi
  docker restart drispro-postier >/dev/null 2>&1 || true
  echo "Saved. The postier uses it from now on."
  exit 0
fi

db_given="${NEXUS_DB:-}"
if [ -f "$ENV" ]; then . "$ENV"; fi
db="${db_given:-${NEXUS_DB:-}}"

if [ -z "$db" ]; then db="$(docker ps --format '{{.Names}}' | grep -E '^supabase-db' | head -1 || true)"; fi

echo "==> 1/3 Disk and copies"
avail_kb="$(df -Pk /root | awk 'NR==2 {print $4}')"; use="$(df -P /root | awk 'NR==2 {print $5}')"
echo "    disk: $(numfmt --to=iec $((avail_kb * 1024))) free ($use used)"
if [ "$avail_kb" -lt 1048576 ]; then
  echo "!!  less than 1 GB free: the update stops here. Free some space first (old copies in /root/backups, docker system prune)." >&2; exit 1
fi
# the nightly copy is always installed with the newest script; a copy is made before every update
NO_FIRST=1 bash deploy/coolify/install-backup.sh "$db" >/dev/null
/usr/local/bin/nexuserp-backup "$db" /root/backups 14 before-update | tail -2 | sed 's/^/    /'

echo "==> 2/3 Database"
NO_DEMO=1 bash deploy/coolify/setup-database.sh $db
# the API's signing secret, so the cloud can give local servers their tickets for cloud copies
auth="$(docker ps --format '{{.Names}}' | grep -E '^supabase-auth' | head -1 || true)"
if [ -n "$auth" ]; then
  jwt="$(docker exec "$auth" printenv GOTRUE_JWT_SECRET 2>/dev/null || true)"
  if [ -n "$jwt" ]; then
    pass="$(docker exec "$db" printenv POSTGRES_PASSWORD)"
    docker exec -i -e PGPASSWORD="$pass" "$db" psql -h 127.0.0.1 -U postgres -d postgres -q -v ON_ERROR_STOP=1 -v s="$jwt" >/dev/null <<'SQL' && echo "    cloud copies of local servers: ready"
insert into app.server_secrets (key, value) values ('jwt_secret', :'s') on conflict (key) do update set value = excluded.value;
SQL
  fi
fi

# the postier: sends email and WhatsApp and runs the timed work (Node from the storage image)
if [ -n "${jwt:-}" ]; then
  store="$(docker ps --format '{{.Names}}' | grep -E '^supabase-storage' | head -1 || true)"
  img="$([ -n "$store" ] && docker inspect -f '{{.Config.Image}}' "$store" 2>/dev/null || true)"
  if [ -n "$img" ]; then
    b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
    h="$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)"
    p="$(printf '{"role":"service_role","iss":"supabase","iat":%s,"exp":%s}' "$(date +%s)" "$(( $(date +%s) + 10*365*24*3600 ))" | b64url)"
    key="$h.$p.$(printf '%s.%s' "$h" "$p" | openssl dgst -sha256 -hmac "$jwt" -binary | b64url)"
    mkdir -p /root/drispro-postier && cp deploy/worker/*.mjs /root/drispro-postier/
    docker rm -f drispro-postier >/dev/null 2>&1 || true
    docker run -d --name drispro-postier --restart unless-stopped -v /root/drispro-postier:/worker:ro \
      -e API_URL="${NEXUS_API:-https://api.erp.dris-ks.com}" -e SERVICE_KEY="$key" -e MODE=cloud \
      --entrypoint node "$img" /worker/postier.mjs >/dev/null && echo "    postier (email, WhatsApp, timed work): running"
  fi
fi

echo "==> 3/3 Redeploy in Coolify"
if [ -z "${COOLIFY_TOKEN:-}" ] || [ -z "${COOLIFY_APP:-}" ]; then
  echo "    Not set up yet: press Redeploy in Coolify yourself this time."
  echo "    To make it automatic, run once:  bash /root/nexuserp-pro/deploy/coolify/update.sh --setup"
  exit 0
fi
# newer Coolify (4.5+) wants POST, older ones GET
code=$(curl -s -o /tmp/nexus-deploy.out -w '%{http_code}' -X POST -H "Authorization: Bearer $COOLIFY_TOKEN" \
  "${COOLIFY_URL%/}/api/v1/deploy?uuid=$COOLIFY_APP&force=false")
if [ "$code" = "405" ]; then
  code=$(curl -s -o /tmp/nexus-deploy.out -w '%{http_code}' -H "Authorization: Bearer $COOLIFY_TOKEN" \
    "${COOLIFY_URL%/}/api/v1/deploy?uuid=$COOLIFY_APP&force=false")
fi
if [ "$code" = "200" ] || [ "$code" = "201" ]; then
  echo "    Redeploy started. In 2-3 minutes open the app and press Ctrl+Shift+R."
else
  echo "    Coolify answered $code: $(head -c 300 /tmp/nexus-deploy.out)"
  echo "    Press Redeploy in Coolify yourself, and check the token with: bash /root/nexuserp-pro/deploy/coolify/update.sh --setup"
  exit 1
fi
