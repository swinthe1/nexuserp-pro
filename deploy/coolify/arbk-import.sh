#!/usr/bin/env bash
# The Kosovo business register (ARBK open data) into DrisPRO.
#   bash deploy/coolify/arbk-import.sh /root/arbk.xlsx       (the "Bizneset_….xlsx" from arbk.rks-gov.net/OpenData)
#   bash deploy/coolify/arbk-import.sh /root/arbk.csv        (already converted)
# Safe to run again: only what changed is written; partners that closed are flagged to their companies.
set -euo pipefail
cd "$(dirname "$0")/../.."
src="${1:?give the ARBK file (xlsx or csv)}"
[ -f "$src" ] || { echo "No file $src"; exit 1; }
ENV=/root/.drispro-deploy.env
if [ -f "$ENV" ]; then . "$ENV"; fi
db="${DRISPRO_DB:-$(docker ps --format '{{.Names}}' | grep -E '^supabase-db' | head -1 || true)}"
[ -n "$db" ] || { echo "The database container was not found"; exit 1; }
csv="$src"
if [[ "$src" == *.xlsx ]]; then
  csv="$(mktemp --suffix=.csv)"; trap 'rm -f "$csv"' EXIT
  echo "reading $src"
  python3 deploy/coolify/arbk_xlsx_to_csv.py "$src" "$csv"
fi
pass="$(docker exec "$db" printenv POSTGRES_PASSWORD)"
echo "loading into the database"
docker exec -i -e PGPASSWORD="$pass" "$db" psql -h 127.0.0.1 -U postgres -d postgres -q -v ON_ERROR_STOP=1 \
  -c "truncate app.business_registry_load" \
  -c "\copy app.business_registry_load (nui,name,trade_name,legal_form,activity,sector,employees,size,city,status,registered,dissolved_on) from stdin with (format csv, header true)" < "$csv"
docker exec -e PGPASSWORD="$pass" "$db" psql -h 127.0.0.1 -U postgres -d postgres -At -v ON_ERROR_STOP=1 -c "select 'ARBK register: ' || app.registry_apply()::text"
