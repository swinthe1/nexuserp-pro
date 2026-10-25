#!/usr/bin/env bash
# Puts this server's data back from the DrisPRO cloud copies, e.g. on a NEW server after the old one broke.
# First: install the new server (install.sh) with the same licence code; the platform owner moves the
# licence to it ("Move to another server"). Then:
#   sudo bash restore-from-cloud.sh            # the newest copy
#   sudo bash restore-from-cloud.sh list       # which copies there are
#   sudo bash restore-from-cloud.sh <name>     # a given copy (name from the list)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
set -a; . ./.env; set +a
CLOUD_ANON_KEY="${CLOUD_ANON_KEY:-eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc5Mjg0NTY2MCwiZXhwIjo0OTQ4NTE5MjYwLCJyb2xlIjoiYW5vbiJ9.b6G9lu0yfVwPpWlddYYql4Hf0oelvnyrF-JH_xl3jd0}"
api="${LICENCE_SERVER:-https://api.erp.dris-ks.com}"
rpc() { curl -fsS --max-time 30 -X POST "$api/rest/v1/rpc/$1" -H "apikey: $CLOUD_ANON_KEY" -H "Authorization: Bearer $CLOUD_ANON_KEY" -H 'Content-Type: application/json' -d "$2"; }
field() { printf '%s' "$1" | sed -n "s/.*\"$2\" *: *\"\\([^\"]*\\)\".*/\\1/p"; }
# this server must hold the licence first
rpc licence_check "{\"p_code\":\"$LICENCE\",\"p_server\":\"$SERVER_ID\"}" >/dev/null || { echo "The licence is not on this server yet. Ask the platform owner to move it, then run this again."; exit 1; }
ticket="$(rpc licence_backup_ticket "{\"p_code\":\"$LICENCE\",\"p_server\":\"$SERVER_ID\"}")"
token="$(field "$ticket" token)"; key="$(field "$ticket" key)"; bucket="$(field "$ticket" bucket)"; folder="$(field "$ticket" folder)"
store() { curl -fsS --max-time 900 -H "apikey: $CLOUD_ANON_KEY" -H "Authorization: Bearer $token" "$@"; }
list="$(store -X POST "$api/storage/v1/object/list/$bucket" -H 'Content-Type: application/json' -d "{\"prefix\":\"$folder/\",\"limit\":1000}")"
copies="$(printf '%s' "$list" | grep -o '"name":"[^"]*\.enc\.part000"' | sed 's/"name":"//; s/\.part000"$//' | sort)"
[ -n "$copies" ] || { echo "No copies of this licence in the cloud."; exit 1; }
if [ "${1:-}" = list ]; then printf '%s\n' "$copies"; exit 0; fi
pick="${1:-$(printf '%s\n' "$copies" | tail -1)}"
printf '%s\n' "$copies" | grep -qx "$pick" || { echo "No copy named $pick (see: restore-from-cloud.sh list)"; exit 1; }
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
echo "==> downloading $pick"
for p in $(printf '%s' "$list" | grep -o "\"name\":\"$pick\.part[0-9]*\"" | sed 's/"name":"//; s/"$//' | sort); do
  store -o "$tmp/$p" "$api/storage/v1/object/authenticated/$bucket/$folder/$p"
done
cat "$tmp/$pick".part* > "$tmp/$pick"
dump="/root/backups/${pick%.enc}"
mkdir -p /root/backups
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "pass:$key" -in "$tmp/$pick" -out "$dump"
chmod 600 "$dump"
echo "==> decrypted into $dump"
bash deploy/coolify/restore-database.sh nexus-db "$dump"
docker restart nexus-rest nexus-auth >/dev/null
echo "==> done: the data of $pick is back on this server"
