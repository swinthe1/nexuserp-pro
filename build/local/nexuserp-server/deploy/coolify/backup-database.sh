#!/usr/bin/env bash
# NexusERP · copy of the whole database (every company, users, settings)
#
#   bash deploy/coolify/backup-database.sh <db-container> [folder] [days-to-keep]
#
# Writes <folder>/nexuserp-YYYY-MM-DD_HHMM.dump (pg_dump custom format, compressed)
# and deletes copies older than [days-to-keep] (default 14). Folder default: /root/backups
# Restore with restore-database.sh. Install the nightly run with install-backup.sh.
set -euo pipefail
container="${1:?usage: backup-database.sh <db-container> [folder] [days] [kind]}"
dir="${2:-/root/backups}"
keep="${3:-14}"
kind="${4:-nightly}"
mkdir -p "$dir"
chmod 700 "$dir"
stamp="$(date +%Y-%m-%d_%H%M)"
out="$dir/nexuserp-$stamp.dump"
tmp="$out.part"
pass="$(docker exec "$container" printenv POSTGRES_PASSWORD)"

# supabase_admin can read every schema (auth included); older images only have postgres
user=supabase_admin
docker exec -e PGPASSWORD="$pass" "$container" psql -h 127.0.0.1 -U "$user" -d postgres -tAc 'select 1' >/dev/null 2>&1 || user=postgres

# tell NexusERP how it went (the platform page shows it); a missing table just means an older database
report() { # ok file size message
  local free total
  free="$(df -B1 --output=avail "$dir" | tail -1 | tr -d ' ')"; total="$(df -B1 --output=size "$dir" | tail -1 | tr -d ' ')"
  docker exec -i -e PGPASSWORD="$pass" "$container" psql -h 127.0.0.1 -U "$user" -d postgres -q -v ON_ERROR_STOP=0 \
    -v ok="$1" -v kind="$kind" -v file="$2" -v size="${3:-0}" -v free="$free" -v total="$total" -v msg="$4" >/dev/null 2>&1 <<'SQL' || true
insert into nexus_meta.backups (ok, kind, file, size_bytes, disk_free_bytes, disk_total_bytes, message)
values (:'ok'::boolean, :'kind', nullif(:'file', ''), nullif(:'size', '0')::bigint, nullif(:'free', '')::bigint, nullif(:'total', '')::bigint, nullif(:'msg', ''));
SQL
}
trap 'report false "" 0 "the copy failed at line $LINENO"' ERR

echo "==> $(date '+%F %T') copying the database as $user"
docker exec -e PGPASSWORD="$pass" "$container" pg_dump -h 127.0.0.1 -U "$user" -d postgres -Fc -Z 6 --no-owner --no-privileges \
  --exclude-schema=_analytics --exclude-schema=_realtime --exclude-schema=supabase_functions > "$tmp"

# a copy that cannot be read back is no copy
docker exec -i "$container" pg_restore --list >/dev/null < "$tmp"
size="$(stat -c %s "$tmp")"
if [ "$size" -lt 10000 ]; then echo "!! the copy is only $size bytes; something is wrong" >&2; rm -f "$tmp"; trap - ERR; report false "" "$size" "the copy was only $size bytes"; exit 1; fi
mv "$tmp" "$out"
chmod 600 "$out"
echo "==> saved $out ($(numfmt --to=iec "$size"))"
trap - ERR
report true "$out" "$size" ""

find "$dir" -maxdepth 1 -name 'nexuserp-*.dump' -mtime +"$keep" -print -delete | sed 's/^/    removed old copy /'
echo "==> copies kept: $(find "$dir" -maxdepth 1 -name 'nexuserp-*.dump' | wc -l)"
