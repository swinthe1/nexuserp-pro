#!/usr/bin/env bash
# A new version of DrisPRO on a local server: run it from the NEW unpacked package.
#   sudo bash update.sh                # the server is in /opt/drispro
#   sudo bash update.sh /path/to/server
# Keeps the data and the secrets (.env); makes a copy of the database first.
set -euo pipefail
new="$(cd "$(dirname "$0")" && pwd)"
dest="${1:-/opt/drispro}"
[ "$(id -u)" = 0 ] || { echo "Run as root: sudo bash update.sh"; exit 1; }

# a server installed under the older name (NexusERP, /opt/nexuserp): it moves to /opt/drispro once,
# with its data, secrets and copies; the old path stays as a link to the new one
o=nexuserp; olddir="/opt/$o"
if [ -d "$olddir" ] && [ ! -L "$olddir" ] && [ ! -e /opt/drispro ] && { [ "$dest" = "$olddir" ] || [ "$dest" = /opt/drispro ]; }; then
  echo "==> DrisPRO moves to /opt/drispro (the data stays as it is)"
  "/usr/local/bin/$o-backup" nexus-db /root/backups 14 before-update | tail -1 || true
  img="$(docker inspect -f '{{.Config.Image}}' nexus-db 2>/dev/null || echo ghcr.io/supabase/postgres:17.6.1.136)"
  ( cd "$olddir" && docker compose --profile tunnel down --remove-orphans )
  if docker volume inspect "${o}_db-config" >/dev/null 2>&1 && ! docker volume inspect drispro_db-config >/dev/null 2>&1; then
    docker volume create drispro_db-config >/dev/null
    docker run --rm -v "${o}_db-config":/from -v drispro_db-config:/to --entrypoint sh "$img" -c 'cp -a /from/. /to/'
  fi
  mv "$olddir" /opt/drispro && ln -s /opt/drispro "$olddir"
  [ -f /opt/drispro/nexus-config.js ] && mv /opt/drispro/nexus-config.js /opt/drispro/drispro-config.js
  rm -f "/etc/cron.d/$o-licence" "/etc/cron.d/$o-backup" "/usr/local/bin/$o-backup" "/usr/local/bin/$o-restore"
  for f in /root/backups/"$o"-*.dump; do [ -e "$f" ] && mv "$f" "/root/backups/drispro-${f##*/$o-}"; done
  for f in /var/log/"$o"-*.log; do [ -e "$f" ] && mv "$f" "/var/log/drispro-${f##*/$o-}"; done
  dest=/opt/drispro
  moved=1
fi
[ -f "$dest/.env" ] || { echo "No DrisPRO server in $dest (no .env). For a first install run install.sh."; exit 1; }
if [ "$new" != "$dest" ]; then
  echo "==> Copy before the update"
  [ -n "${moved:-}" ] || /usr/local/bin/drispro-backup drispro-db /root/backups 14 before-update | tail -1 || true
  echo "==> New files into $dest"
  # the app folder is mounted into the web container: its content is replaced, the folder stays
  mkdir -p "$dest/app" "$dest/supabase" "$dest/deploy"
  find "$dest/app" -mindepth 1 -delete
  cp -r "$new/app/." "$dest/app/"
  rm -rf "$dest/supabase/migrations"
  cp -r "$new/supabase/migrations" "$dest/supabase/migrations"
  cp -r "$new/deploy/coolify" "$dest/deploy/"
  cp -r "$new/db" "$dest/"
  [ -d "$new/windows" ] && cp -r "$new/windows" "$dest/"
  [ -d "$new/worker" ] && mkdir -p "$dest/worker" && cp "$new/worker/"*.mjs "$dest/worker/"
  [ -d "$new/box" ] && cp -r "$new/box" "$dest/" && install -m 755 "$new/box/drispro-status.sh" /usr/local/bin/drispro-status 2>/dev/null || true
  cp "$new/docker-compose.yml" "$new/nginx.conf" "$new/install.sh" "$new/licence.sh" "$new/update.sh" "$new/auto-update.sh" "$new/cloud-backup.sh" "$new/restore-from-cloud.sh" "$new/VERSION" "$new/LEXOME.txt" "$dest/" 2>/dev/null || true
  for f in status.sh repair.sh remote.sh; do [ -f "$new/$f" ] && cp "$new/$f" "$dest/"; done
  chmod +x "$dest"/*.sh 2>/dev/null || true
fi
cd "$dest"
bash install.sh
# once the server runs under the new name: the old volume copy and, from the next update on, the old path link go
docker volume inspect drispro_db-config >/dev/null 2>&1 && docker volume rm "${o}_db-config" >/dev/null 2>&1 || true
if [ -z "${moved:-}" ] && [ -L "$olddir" ] && [ "$(readlink -f "$olddir")" = /opt/drispro ]; then rm -f "$olddir"; fi
