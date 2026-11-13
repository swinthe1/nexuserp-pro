#!/usr/bin/env bash
# This server in one line of JSON, for the DrisPRO Server program on Windows (and for people):
# every service, the address, the version, the licence, the last copy of the database, the free disk.
#   sudo bash status.sh
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
[ -f .env ] || { echo '{"installed":false}'; exit 0; }
set -a; . ./.env; set +a
j() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
svc=""
for c in drispro-db drispro-auth drispro-rest drispro-storage drispro-web drispro-postier realtime-dev.drispro-realtime; do
  st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$c" 2>/dev/null || echo missing)"
  svc="$svc${svc:+,}\"${c#realtime-dev.}\":\"$st\""
done
lic=""
pass="$(docker exec drispro-db printenv POSTGRES_PASSWORD 2>/dev/null || true)"
if [ -n "$pass" ]; then
  lic="$(docker exec -e PGPASSWORD="$pass" drispro-db psql -h 127.0.0.1 -U postgres -d postgres -tAc \
    "select json_build_object('company', c.name, 'plan', l.plan, 'until', l.valid_until, 'status', l.status) from public.licenses l join public.companies c on c.id = l.company_id where l.deployment = 'local' order by l.updated_at desc nulls last limit 1" 2>/dev/null || true)"
fi
last="$(ls -1t /root/backups/drispro-*.dump 2>/dev/null | head -1)"
lastat=""; [ -n "$last" ] && lastat="$(date -r "$last" '+%FT%T%z')"
free="$(df -BG --output=avail / | tail -1 | tr -dc 0-9)"
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${HTTP_PORT:-80}/auth/v1/health" || true)"
printf '{"installed":true,"url":"%s","port":%s,"version":"%s","answers":%s,"services":{%s},"licence":%s,"last_backup":"%s","last_backup_at":"%s","free_gb":%s,"auto_update":"%s"}\n' \
  "$(j "${PUBLIC_URL:-}")" "${HTTP_PORT:-80}" "$(j "$(cat VERSION 2>/dev/null || echo local)")" "$([ "$code" = 200 ] && echo true || echo false)" \
  "$svc" "${lic:-null}" "$(j "${last##*/}")" "$lastat" "${free:-0}" "${AUTO_UPDATE:-true}"
