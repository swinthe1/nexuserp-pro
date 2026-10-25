#!/usr/bin/env bash
# Makes the package for a local server: drispro-server-<version>.tar.gz (and .zip)
#   bash deploy/local/make-bundle.sh [version]
set -euo pipefail
cd "$(dirname "$0")/../.."
version="${1:-$(date +%Y.%m.%d)}"
out="build/local/drispro-server"
rm -rf build/local && mkdir -p "$out"
# the app reads where its server is at start (drispro-config.js), so one build serves every server
VITE_SUPABASE_URL=http://local-server VITE_SUPABASE_ANON_KEY=local-server npx vite build --outDir "$out/app" --emptyOutDir >/dev/null
cp deploy/local/docker-compose.yml deploy/local/nginx.conf deploy/local/install.sh deploy/local/licence.sh deploy/local/update.sh deploy/local/auto-update.sh deploy/local/cloud-backup.sh deploy/local/restore-from-cloud.sh deploy/local/LEXOME.txt deploy/UDHEZUES-AUTOMATIZIMET.txt "$out/"
cp -r deploy/local/db "$out/db"
cp -r deploy/local/windows "$out/windows"
mkdir -p "$out/worker" && cp deploy/worker/*.mjs "$out/worker/"
cp -r deploy/local/box "$out/box"
mkdir -p "$out/supabase" "$out/deploy/coolify"
cp -r supabase/migrations "$out/supabase/migrations"
cp deploy/coolify/setup-database.sh deploy/coolify/backup-database.sh deploy/coolify/install-backup.sh deploy/coolify/restore-database.sh "$out/deploy/coolify/"
echo "$version" > "$out/VERSION"
chmod +x "$out"/*.sh "$out"/box/*.sh "$out"/deploy/coolify/*.sh
( cd build/local && tar czf "drispro-server-$version.tar.gz" drispro-server && zip -qr "drispro-server-$version.zip" drispro-server )
ls -la build/local/*.tar.gz build/local/*.zip
