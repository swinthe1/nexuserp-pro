#!/usr/bin/env bash
# "Check and repair": what can be put right without a person, step by step, each one said.
#   sudo bash repair.sh
# Starts what is stopped, starts again what does not answer, adds database changes still missing,
# and checks the nightly copy and its schedule. The data is never touched.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
say() { printf '\n==> %s\n' "$*"; }
[ -f .env ] || { echo "@@error repair No DrisPRO server here (no .env): install it first"; exit 1; }
set -a; . ./.env; set +a
profiles=(); [ -n "${TUNNEL_TOKEN:-}" ] && profiles=(--profile tunnel)
fixed=0

say "Docker"
if ! docker info >/dev/null 2>&1; then
  (systemctl start docker 2>/dev/null || service docker start 2>/dev/null) ; sleep 5
  docker info >/dev/null 2>&1 && { echo "    ✓ started again"; fixed=$((fixed+1)); } || { echo "@@error repair Docker does not start: restart the computer"; exit 1; }
else echo "    ✓ works"; fi

say "Services"
health() { docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$1" 2>/dev/null || echo missing; }
for c in drispro-db drispro-auth drispro-storage drispro-rest drispro-web drispro-postier; do
  case "$(health "$c")" in healthy|running|starting) ;; *) echo "    !! $c was stopped: starting it"; fixed=$((fixed+1)) ;; esac
done
docker compose "${profiles[@]}" up -d --remove-orphans >/dev/null 2>&1 || true
for c in drispro-db drispro-auth drispro-storage drispro-rest drispro-web drispro-postier; do
  st="$(health "$c")"
  for i in $(seq 1 30); do [ "$st" = healthy ] || [ "$st" = running ] && break; sleep 2; st="$(health "$c")"; done
  if [ "$st" != healthy ] && [ "$st" != running ]; then
    echo "    !! $c is $st: starting it again"; docker restart "$c" >/dev/null 2>&1 || true; fixed=$((fixed+1))
    for i in $(seq 1 45); do st="$(health "$c")"; [ "$st" = healthy ] || [ "$st" = running ] && break; sleep 2; done
  fi
  if [ "$st" = healthy ] || [ "$st" = running ]; then echo "    ✓ ${c#drispro-}"; else echo "    ✗ ${c#drispro-} ($st)"; echo "@@error service $c"; fi
done

say "Database changes"
before="$(NO_DEMO=1 bash deploy/coolify/setup-database.sh drispro-db 2>&1)" && echo "    ✓ $(printf '%s\n' "$before" | grep -c '^   apply') added" || { printf '%s\n' "$before" | tail -5; echo "@@error database"; }

say "Nightly copy"
if [ -x /usr/local/bin/drispro-backup ] && [ -f /etc/cron.d/drispro-backup ]; then echo "    ✓ scheduled"
else NO_FIRST=1 bash deploy/coolify/install-backup.sh drispro-db >/dev/null 2>&1 && { echo "    ✓ scheduled again"; fixed=$((fixed+1)); } || echo "@@error backup"; fi
last="$(ls -1t /root/backups/drispro-*.dump 2>/dev/null | head -1)"
if [ -z "$last" ] || [ -n "$(find "$last" -mmin +2160 2>/dev/null)" ]; then
  echo "    !! no copy in the last 36 hours: making one now"
  /usr/local/bin/drispro-backup drispro-db /root/backups 14 repair 2>&1 | tail -1; fixed=$((fixed+1))
else echo "    ✓ last copy ${last##*/}"; fi

say "Every part answers"
ok=1
for t in "app /" "sign-in /auth/v1/health" "data /rest/v1/" "files /storage/v1/status"; do
  name="${t%% *}"; path="${t#* }"; code=000
  for i in $(seq 1 10); do code="$(curl -s -o /dev/null -w '%{http_code}' -H "apikey: $ANON_KEY" "http://127.0.0.1:${HTTP_PORT:-80}$path" || true)"; [ "$code" = 200 ] && break; sleep 2; done
  if [ "$code" = 200 ]; then echo "    ✓ $name"; else echo "    ✗ $name ($code)"; ok=0; fi
done
echo "@@repaired $fixed"
[ "$ok" = 1 ] && echo "@@done ok" || { echo "@@error answers"; exit 1; }
