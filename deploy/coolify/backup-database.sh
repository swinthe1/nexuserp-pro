#!/usr/bin/env bash
# DrisPRO · copy of the whole database (every company, users, settings)
#
#   bash deploy/coolify/backup-database.sh <db-container> [folder] [days-to-keep]
#
# Writes <folder>/drispro-YYYY-MM-DD_HHMM.dump (pg_dump custom format, compressed)
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
out="$dir/drispro-$stamp.dump"
tmp="$out.part"
pass="$(docker exec "$container" printenv POSTGRES_PASSWORD)"

# supabase_admin can read every schema (auth included); older images only have postgres
user=supabase_admin
docker exec -e PGPASSWORD="$pass" "$container" psql -h 127.0.0.1 -U "$user" -d postgres -tAc 'select 1' >/dev/null 2>&1 || user=postgres

# tell DrisPRO how it went (the platform page shows it); a missing table just means an older database
report() { # ok file size message
  local free total
  free="$(df -B1 --output=avail "$dir" | tail -1 | tr -d ' ')"; total="$(df -B1 --output=size "$dir" | tail -1 | tr -d ' ')"
  docker exec -i -e PGPASSWORD="$pass" "$container" psql -h 127.0.0.1 -U "$user" -d postgres -q -v ON_ERROR_STOP=0 \
    -v ok="$1" -v kind="$kind" -v file="$2" -v size="${3:-0}" -v free="$free" -v total="$total" -v msg="$4" >/dev/null 2>&1 <<'SQL' || true
insert into drispro_meta.backups (ok, kind, file, size_bytes, disk_free_bytes, disk_total_bytes, message)
values (:'ok'::boolean, :'kind', nullif(:'file', ''), nullif(:'size', '0')::bigint, nullif(:'free', '')::bigint, nullif(:'total', '')::bigint, nullif(:'msg', ''));
SQL
}
trap 'report false "" 0 "the copy failed at line $LINENO"' ERR

echo "==> $(date '+%F %T') copying the database as $user"
# as supabase_admin the copy keeps who owns what and who may read what (needed by sign-in and storage)
keep_acl=(--no-owner --no-privileges); [ "$user" = supabase_admin ] && keep_acl=()
docker exec -e PGPASSWORD="$pass" "$container" pg_dump -h 127.0.0.1 -U "$user" -d postgres -Fc -Z 6 "${keep_acl[@]}" \
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

# the same copy outside this server, encrypted (only once /root/.drispro-offsite is set up; see offsite-copy.sh)
if [ -f /root/.drispro-offsite ]; then
  if /usr/local/bin/drispro-offsite "$out"; then report true "$out" "$size" "sent outside the server"
  else report false "$out" "$size" "the copy outside the server failed"; fi
fi

find "$dir" -maxdepth 1 -name 'drispro-*.dump' -mtime +"$keep" -print -delete | sed 's/^/    removed old copy /'
echo "==> copies kept: $(find "$dir" -maxdepth 1 -name 'drispro-*.dump' | wc -l)"
