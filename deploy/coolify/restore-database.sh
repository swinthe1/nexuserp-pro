#!/usr/bin/env bash
# NexusERP · put a copy back. EVERYTHING written after that copy is lost.
#
#   bash deploy/coolify/restore-database.sh <db-container> <file.dump>
#
# Makes a fresh copy of the current state first (…-before-restore.dump), then restores.
set -euo pipefail
container="${1:?usage: restore-database.sh <db-container> <file.dump>}"
file="${2:?which copy? e.g. /root/backups/nexuserp-2026-10-24_0230.dump}"
[ -f "$file" ] || { echo "no such file: $file" >&2; exit 1; }
pass="$(docker exec "$container" printenv POSTGRES_PASSWORD)"
user=supabase_admin
docker exec -e PGPASSWORD="$pass" "$container" psql -h 127.0.0.1 -U "$user" -d postgres -tAc 'select 1' >/dev/null 2>&1 || user=postgres

echo "This replaces the data in $container with $file."
echo "Everything entered after that copy was made will be lost."
read -r -p "Type RESTORE to continue: " answer
[ "$answer" = "RESTORE" ] || { echo "Stopped, nothing changed."; exit 1; }

safety="$(dirname "$file")/nexuserp-$(date +%Y-%m-%d_%H%M)-before-restore.dump"
echo "==> first a copy of the current state: $safety"
docker exec -e PGPASSWORD="$pass" "$container" pg_dump -h 127.0.0.1 -U "$user" -d postgres -Fc --no-owner --no-privileges \
  --exclude-schema=_analytics --exclude-schema=_realtime --exclude-schema=supabase_functions > "$safety"

echo "==> restoring"
docker exec -e PGPASSWORD="$pass" "$container" psql -h 127.0.0.1 -U "$user" -d postgres -q -c "create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists pg_trgm with schema extensions; create extension if not exists btree_gist with schema extensions; create schema if not exists app; create schema if not exists nexus_meta;"
docker exec -i -e PGPASSWORD="$pass" "$container" pg_restore -h 127.0.0.1 -U "$user" -d postgres --clean --if-exists --no-owner --no-privileges \
  --schema=public --schema=app --schema=auth --schema=storage --schema=nexus_meta --single-transaction < "$file"
docker exec -e PGPASSWORD="$pass" "$container" psql -h 127.0.0.1 -U "$user" -d postgres -c "notify pgrst, 'reload schema';" >/dev/null || true
echo "==> done. Redeploy NexusERP in Coolify and sign in again."
