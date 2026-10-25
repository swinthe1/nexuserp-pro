#!/usr/bin/env bash
# A new version of DrisPRO on a local server: run it from the NEW unpacked package.
#   sudo bash update.sh                # the server is in /opt/nexuserp
#   sudo bash update.sh /path/to/server
# Keeps the data and the secrets (.env); makes a copy of the database first.
set -euo pipefail
new="$(cd "$(dirname "$0")" && pwd)"
dest="${1:-/opt/nexuserp}"
[ "$(id -u)" = 0 ] || { echo "Run as root: sudo bash update.sh"; exit 1; }
[ -f "$dest/.env" ] || { echo "No DrisPRO server in $dest (no .env). For a first install run install.sh."; exit 1; }
if [ "$new" != "$dest" ]; then
  echo "==> Copy before the update"
  /usr/local/bin/nexuserp-backup nexus-db /root/backups 14 before-update | tail -1 || true
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
fi
cd "$dest"
bash install.sh
