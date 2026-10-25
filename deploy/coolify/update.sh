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
  read -rp "Coolify address [http://localhost:8000]: " url; url="${url:-http://localhost:8000}"
  read -rsp "API token (not shown): " token; echo
  read -rp "UUID of the NexusERP app: " uuid
  db="$(docker ps --format '{{.Names}}' | grep -E '^supabase-db' | head -1 || true)"
  read -rp "Database container [$db]: " c; db="${c:-$db}"
  umask 077
  printf 'COOLIFY_URL=%q\nCOOLIFY_TOKEN=%q\nCOOLIFY_APP=%q\nNEXUS_DB=%q\n' "$url" "$token" "$uuid" "$db" > "$ENV"
  echo "Saved in $ENV (readable by root only)."
  exit 0
fi

db_given="${NEXUS_DB:-}"
if [ -f "$ENV" ]; then . "$ENV"; fi
db="${db_given:-${NEXUS_DB:-}}"

echo "==> 1/2 Database"
NO_DEMO=1 bash deploy/coolify/setup-database.sh $db

echo "==> 2/2 Redeploy in Coolify"
if [ -z "${COOLIFY_TOKEN:-}" ] || [ -z "${COOLIFY_APP:-}" ]; then
  echo "    Not set up yet: press Redeploy in Coolify yourself this time."
  echo "    To make it automatic, run once:  bash /root/nexuserp-pro/deploy/coolify/update.sh --setup"
  exit 0
fi
code=$(curl -s -o /tmp/nexus-deploy.out -w '%{http_code}' -H "Authorization: Bearer $COOLIFY_TOKEN" \
  "${COOLIFY_URL%/}/api/v1/deploy?uuid=$COOLIFY_APP&force=false")
if [ "$code" = "200" ]; then
  echo "    Redeploy started. In 2-3 minutes open the app and press Ctrl+Shift+R."
else
  echo "    Coolify answered $code: $(head -c 300 /tmp/nexus-deploy.out)"
  echo "    Press Redeploy in Coolify yourself, and check the token with: bash /root/nexuserp-pro/deploy/coolify/update.sh --setup"
  exit 1
fi
