#!/usr/bin/env bash
# Every night after the local copy: the newest copy of this server's database goes to the DrisPRO cloud,
# encrypted (AES-256, a key kept with the licence), in parts of 40 MB. 14 days are kept in the cloud.
# Without internet nothing is sent and it tries again the next night. Off with CLOUD_BACKUP=false in .env.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
set -a; . ./.env; set +a
[ "${CLOUD_BACKUP:-true}" = "true" ] || { echo "$(date '+%F %T') cloud copies are off"; exit 0; }
CLOUD_ANON_KEY="${CLOUD_ANON_KEY:-eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJzdXBhYmFzZSIsImlhdCI6MTc5Mjg0NTY2MCwiZXhwIjo0OTQ4NTE5MjYwLCJyb2xlIjoiYW5vbiJ9.b6G9lu0yfVwPpWlddYYql4Hf0oelvnyrF-JH_xl3jd0}"
api="${LICENCE_SERVER:-https://api.drispro.com}"
[ -n "${LICENCE:-}" ] && [ -n "${SERVER_ID:-}" ] || { echo "$(date '+%F %T') no licence yet: no cloud copy"; exit 0; }

latest="$(ls -1t /root/backups/drispro-*.dump 2>/dev/null | grep -v before-restore | head -1 || true)"
[ -n "$latest" ] || { echo "$(date '+%F %T') no local copy to send"; exit 0; }

rpc() { curl -fsS --max-time 30 -X POST "$api/rest/v1/rpc/$1" -H "apikey: $CLOUD_ANON_KEY" -H "Authorization: Bearer $CLOUD_ANON_KEY" -H 'Content-Type: application/json' -d "$2"; }
field() { printf '%s' "$1" | sed -n "s/.*\"$2\" *: *\"\\([^\"]*\\)\".*/\\1/p"; }
ticket="$(rpc licence_backup_ticket "{\"p_code\":\"$LICENCE\",\"p_server\":\"$SERVER_ID\"}")" || { echo "$(date '+%F %T') no connection to the cloud: copy not sent"; exit 0; }
token="$(field "$ticket" token)"; key="$(field "$ticket" key)"; bucket="$(field "$ticket" bucket)"; folder="$(field "$ticket" folder)"
[ -n "$token" ] && [ -n "$key" ] || { echo "$(date '+%F %T') the cloud gave no ticket: $ticket"; exit 1; }
store() { curl -fsS --max-time 900 -H "apikey: $CLOUD_ANON_KEY" -H "Authorization: Bearer $token" "$@"; }

name="$(basename "$latest").enc"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
# the key through the environment, never on the command line (where every process list shows it)
DRISPRO_KEY="$key" openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:DRISPRO_KEY -in "$latest" -out "$tmp/$name"
bytes="$(stat -c %s "$tmp/$name")"
split -b 40m -d -a 3 "$tmp/$name" "$tmp/$name.part"
parts=0
for f in "$tmp/$name".part*; do
  store -X POST "$api/storage/v1/object/$bucket/$folder/$(basename "$f")" -H 'Content-Type: application/octet-stream' -H 'x-upsert: true' --data-binary "@$f" >/dev/null
  parts=$((parts + 1))
done
rpc licence_backup_done "{\"p_code\":\"$LICENCE\",\"p_server\":\"$SERVER_ID\",\"p_file\":\"$name\",\"p_parts\":$parts,\"p_bytes\":$bytes}" >/dev/null
echo "$(date '+%F %T') sent $name to the cloud ($parts parts, $(numfmt --to=iec "$bytes"))"

# older than 14 days in the cloud: removed
keep="$(printf '%s' "$ticket" | sed -n 's/.*"keep_days" *: *\([0-9]*\).*/\1/p')"; keep="${keep:-14}"
cutoff="$(date -u -d "-$keep days" +%Y-%m-%d)"
list="$(store -X POST "$api/storage/v1/object/list/$bucket" -H 'Content-Type: application/json' -d "{\"prefix\":\"$folder/\",\"limit\":1000}")" || exit 0
old="$(printf '%s' "$list" | grep -oE '"name":"(drispro|nexuserp)-[0-9-]*_[0-9]*[^"]*"' | sed 's/"name":"//; s/"$//' | while read -r n; do d="${n#*-}"; d="${d:0:10}"; [[ "$d" < "$cutoff" ]] && printf '"%s/%s",' "$folder" "$n"; done || true)"
if [ -n "$old" ]; then store -X DELETE "$api/storage/v1/object/$bucket" -H 'Content-Type: application/json' -d "{\"prefixes\":[${old%,}]}" >/dev/null && echo "    removed copies older than $keep days"; fi
