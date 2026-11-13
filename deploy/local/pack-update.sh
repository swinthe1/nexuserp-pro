#!/usr/bin/env bash
# Packs the local-server update from an app that is already built (dist/): run in the Docker build of the
# cloud app, so every cloud version also publishes the same version for local servers at
#   /updates/latest.json  and  /updates/drispro-server-<version>.tar.gz
#   bash deploy/local/pack-update.sh dist [version]
set -euo pipefail
cd "$(dirname "$0")/../.."
dist="${1:-dist}"
version="${2:-$(date -u +%Y.%m.%d.%H%M)}"
work="$(mktemp -d)"; out="$work/drispro-server"
mkdir -p "$out/app" "$out/supabase" "$out/deploy/coolify"
( cd "$dist" && tar cf - --exclude=./updates . ) | ( cd "$out/app" && tar xf - )
cp deploy/local/docker-compose.yml deploy/local/nginx.conf deploy/local/install.sh deploy/local/licence.sh deploy/local/update.sh deploy/local/auto-update.sh deploy/local/cloud-backup.sh deploy/local/restore-from-cloud.sh deploy/local/status.sh deploy/local/repair.sh deploy/local/remote.sh deploy/local/LEXOME.txt "$out/"
cp -r deploy/local/db "$out/db"; cp -r deploy/local/windows "$out/windows"; cp -r deploy/local/box "$out/box"; mkdir -p "$out/worker"; cp deploy/worker/*.mjs "$out/worker/"
cp -r supabase/migrations "$out/supabase/migrations"
cp deploy/coolify/setup-database.sh deploy/coolify/backup-database.sh deploy/coolify/install-backup.sh deploy/coolify/offsite-copy.sh deploy/coolify/restore-database.sh "$out/deploy/coolify/"
echo "$version" > "$out/VERSION"
chmod +x "$out"/*.sh "$out"/deploy/coolify/*.sh
mkdir -p "$dist/updates"
file="drispro-server-$version.tar.gz"
( cd "$work" && ln -s drispro-server "nexus""erp-server" && tar czf "$OLDPWD/$dist/updates/$file" drispro-server "nexus""erp-server" )
sum="$(sha256sum "$dist/updates/$file" | cut -d' ' -f1)"
printf '{"version":"%s","file":"%s","sha256":"%s","published":"%s"}\n' "$version" "$file" "$sum" "$(date -u +%FT%TZ)" > "$dist/updates/latest.json"
rm -rf "$work"
echo "local-server update $version: $dist/updates/$file"
