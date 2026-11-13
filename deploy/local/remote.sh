#!/usr/bin/env bash
# The outside address of this server (https://<name>.dris-ks.com): asked from DrisPRO with the licence,
# made by the cloud, then the tunnel is started here. Nothing to open on the router.
#   sudo bash remote.sh [--wait SECONDS]     (install.sh and licence.sh run it; every night too)
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
set -a; . ./.env; set +a
wait_s=0; [ "${1:-}" = "--wait" ] && wait_s="${2:-90}"
CLOUD_ANON_KEY="${CLOUD_ANON_KEY:-eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc5Mjg0NTY2MCwiZXhwIjo0OTQ4NTE5MjYwLCJyb2xlIjoiYW5vbiJ9.b6G9lu0yfVwPpWlddYYql4Hf0oelvnyrF-JH_xl3jd0}"
LICENCE_SERVER="${LICENCE_SERVER:-https://api.erp.dris-ks.com}"
[ -n "${LICENCE:-}" ] && [ -n "${SERVER_ID:-}" ] || { echo "    outside address: no licence yet"; exit 0; }
[ "${REMOTE_ACCESS:-true}" = "true" ] || { echo "    outside address: turned off on this server (REMOTE_ACCESS=false)"; docker rm -f drispro-tunnel >/dev/null 2>&1; exit 0; }
setenv() { sed -i "/^$1=/d" .env; printf '%s=%s\n' "$1" "$2" >> .env; }
field() { printf '%s' "$1" | sed -n "s/.*\"$2\" *: *\"\([^\"]*\)\".*/\1/p"; }

deadline=$(( $(date +%s) + wait_s ))
while :; do
  res="$(curl -sS --max-time 20 -X POST "$LICENCE_SERVER/rest/v1/rpc/licence_tunnel" -H "apikey: $CLOUD_ANON_KEY" -H "Authorization: Bearer $CLOUD_ANON_KEY" \
         -H 'Content-Type: application/json' -d "{\"p_code\":\"$LICENCE\",\"p_server\":\"$SERVER_ID\"}" 2>/dev/null)" || res=''
  status="$(field "$res" status)"
  [ "$status" = pending ] && [ "$(date +%s)" -lt "$deadline" ] && { sleep 10; continue; }
  break
done
case "$status" in
  ready)
    token="$(field "$res" token)"; url="$(field "$res" url)"
    if [ "${TUNNEL_TOKEN:-}" != "$token" ] || ! docker ps --format '{{.Names}}' | grep -qx drispro-tunnel; then
      setenv TUNNEL_TOKEN "$token"; setenv REMOTE_URL "$url"
      TUNNEL_TOKEN="$token" docker compose --profile tunnel up -d tunnel >/dev/null 2>&1 || { echo "    !! the tunnel did not start"; echo "@@warn tunnel_start"; exit 1; }
    fi
    echo "    outside address: $url"; echo "@@remote $url" ;;
  off)
    docker rm -f drispro-tunnel >/dev/null 2>&1; sed -i '/^TUNNEL_TOKEN=/d;/^REMOTE_URL=/d' .env
    echo "    outside address: turned off by DrisPRO" ;;
  pending) echo "    outside address: $(field "$res" hostname) is being made; it starts by itself within the hour" ;;
  failed) echo "    outside address: not made yet ($(field "$res" error | head -c 160)); tried again later" ;;
  *) echo "    outside address: no answer from DrisPRO now; tried again tonight" ;;
esac
exit 0
