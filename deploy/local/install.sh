#!/usr/bin/env bash
# DrisPRO on a local server (Ubuntu/Debian, or Ubuntu inside WSL on Windows).
#
#   sudo bash install.sh                    # install or start again (keeps the data)
#   sudo LICENCE=NXS-XXXX-XXXX-XXXX bash install.sh
# Options (environment):
#   LICENCE        the client's licence code (from the Platform); asked for when missing
#   PUBLIC_URL     the address people open, e.g. http://192.168.1.20 (found by itself)
#   HTTP_PORT      port of the app on this server (80)
#   TUNNEL_TOKEN   a Cloudflare tunnel token, to open the server from outside the shop too
#   LICENCE_SERVER where licences are checked (https://api.erp.dris-ks.com)
#
# What it does: installs Docker if needed, makes the secrets once (.env), starts the database,
# sign-in, API, live updates, file storage and the app, creates the database from the migrations,
# checks the licence, and sets up the nightly copy of the database.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
say() { printf '\n==> %s\n' "$*"; }
die() { printf '\n!! %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "Run as root: sudo bash install.sh"

say "1/7 Docker"
if ! command -v docker >/dev/null 2>&1; then
  command -v curl >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq curl; }
  curl -fsSL https://get.docker.com | sh
fi
docker info >/dev/null 2>&1 || { (systemctl start docker 2>/dev/null || service docker start 2>/dev/null || (dockerd >/var/log/dockerd.log 2>&1 &)); sleep 5; }
docker info >/dev/null 2>&1 || die "Docker does not start. Restart the server and run this again."
docker compose version >/dev/null 2>&1 || die "docker compose is missing (install docker-compose-plugin)."
command -v openssl >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq openssl; }

say "2/7 Settings and secrets"
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt() { # role, secret
  local h p s
  h="$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)"
  p="$(printf '{"role":"%s","iss":"supabase","iat":%s,"exp":%s}' "$1" "$(date +%s)" "$(( $(date +%s) + 20*365*24*3600 ))" | b64url)"
  s="$(printf '%s.%s' "$h" "$p" | openssl dgst -sha256 -hmac "$2" -binary | b64url)"
  printf '%s.%s.%s' "$h" "$p" "$s"
}
if [ ! -f .env ]; then
  ip="$(hostname -I 2>/dev/null | awk '{print $1}')"; ip="${ip:-127.0.0.1}"
  port="${HTTP_PORT:-80}"
  url="${PUBLIC_URL:-http://$ip$([ "$port" = 80 ] || echo ":$port")}"
  secret="$(openssl rand -hex 32)"
  umask 077
  cat > .env <<EOF
# DrisPRO local server: made once by install.sh. Keep it safe; it holds the keys of this database.
PUBLIC_URL=$url
EXTRA_URLS=$url/**
HTTP_PORT=$port
POSTGRES_PASSWORD=$(openssl rand -hex 24)
JWT_SECRET=$secret
JWT_EXPIRY=3600
SECRET_KEY_BASE=$(openssl rand -hex 48)
ANON_KEY=$(jwt anon "$secret")
SERVICE_ROLE_KEY=$(jwt service_role "$secret")
DISABLE_SIGNUP=false
MAILER_AUTOCONFIRM=true
SMTP_ADMIN_EMAIL=admin@drispro.local
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
TUNNEL_TOKEN=${TUNNEL_TOKEN:-}
LICENCE=${LICENCE:-}
LICENCE_SERVER=${LICENCE_SERVER:-https://api.erp.dris-ks.com}
# new versions every night at 04:15 (false = only by hand with update.sh)
AUTO_UPDATE=true
# the nightly copy also goes to the DrisPRO cloud, encrypted (false = only on this server)
CLOUD_BACKUP=true
UPDATE_SERVER=https://erp.dris-ks.com
EOF
  umask 022
  echo "    made .env (address $url)"
else
  echo "    .env already here: kept"
fi
set -a; . ./.env; set +a
if [ -n "${TUNNEL_TOKEN_NEW:-}" ]; then sed -i "s|^TUNNEL_TOKEN=.*|TUNNEL_TOKEN=$TUNNEL_TOKEN_NEW|" .env; TUNNEL_TOKEN="$TUNNEL_TOKEN_NEW"; fi
printf "// made by install.sh: this DrisPRO runs on this server\nwindow.__DRISPRO__ = { url: 'same-origin', anonKey: '%s', local: true }\n" "$ANON_KEY" > drispro-config.js
mkdir -p data/db data/storage

say "3/7 Starting the services (the first time downloads about 1.5 GB)"
profiles=(); [ -n "${TUNNEL_TOKEN:-}" ] && profiles=(--profile tunnel)
docker compose "${profiles[@]}" up -d --remove-orphans

say "4/7 Waiting for the database, sign-in and storage"
for svc in drispro-db drispro-auth drispro-storage; do
  for i in $(seq 1 90); do
    st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$svc" 2>/dev/null || echo missing)"
    [ "$st" = healthy ] && break
    sleep 2
  done
  [ "$st" = healthy ] || { docker logs --tail 30 "$svc" >&2 || true; die "$svc did not start ($st)"; }
  echo "    $svc ready"
done

say "5/7 The DrisPRO database"
NO_DEMO=1 bash deploy/coolify/setup-database.sh drispro-db | grep -v '^   skip' || die "The database could not be made; send the lines above to the developer."
docker restart drispro-rest drispro-web >/dev/null

say "6/7 Licence"
bash "$here/licence.sh" || echo "    !! the licence could not be checked now; the server works and tries again every night"
# the postier reads the licence and the server id written just now
docker compose "${profiles[@]}" up -d postier >/dev/null 2>&1 || true

say "7/7 Nightly copy of the database (02:30, 14 days kept in /root/backups)"
NO_FIRST=1 bash deploy/coolify/install-backup.sh drispro-db >/dev/null && echo "    done"
# the licence is checked again every night, after the copy
cat > /etc/cron.d/drispro-licence <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
45 3 * * * root bash $here/licence.sh >> /var/log/drispro-licence.log 2>&1
0 4 * * * root bash $here/cloud-backup.sh >> /var/log/drispro-cloud-backup.log 2>&1
15 4 * * * root bash $here/auto-update.sh >> /var/log/drispro-update.log 2>&1
EOF
chmod 644 /etc/cron.d/drispro-licence

echo
echo "DrisPRO is running: $PUBLIC_URL"
echo "Open it on this network (browser or the DrisPRO program, choose \"Local server\" and type this address)."
echo "Sign in with the administrator: $(grep "^ADMIN_EMAIL=" .env | cut -d= -f2)"
[ -n "${TUNNEL_TOKEN:-}" ] && echo "From outside: the address of your Cloudflare tunnel."
exit 0
