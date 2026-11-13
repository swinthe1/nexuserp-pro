#!/usr/bin/env bash
# Creates the DrisPRO database inside a Supabase that runs in Coolify, and loads the demo company.
#
# Run on the VPS as root, from the project folder:
#   bash deploy/coolify/setup-database.sh                 # finds the Supabase database container itself
#   bash deploy/coolify/setup-database.sh supabase-db-xxxx  # or name it (docker ps | grep supabase-db)
# Options (environment):
#   NO_DEMO=1    create the schema only, without the demo company
#
# Safe to run again: migrations already applied are skipped, and the demo is loaded only into an empty database.
set -euo pipefail
cd "$(dirname "$0")/../.."

container="${1:-}"
if [ -z "$container" ]; then
  mapfile -t found < <(docker ps --format '{{.Names}}' | grep -E '^supabase-db' || true)
  if [ "${#found[@]}" -eq 0 ]; then
    echo "No running Supabase database container (supabase-db-…) found. Start the Supabase service in Coolify first." >&2; exit 1
  fi
  if [ "${#found[@]}" -gt 1 ]; then
    echo "More than one Supabase database is running:" >&2; printf '  %s\n' "${found[@]}" >&2
    echo "Run again with the one for DrisPRO, e.g.: bash $0 ${found[0]}" >&2; exit 1
  fi
  container="${found[0]}"
fi
echo "==> Using database container: $container"

pass="$(docker exec "$container" printenv POSTGRES_PASSWORD)"
psql_as() { # user, then psql args
  local user="$1"; shift
  docker exec -i -e PGPASSWORD="$pass" -e PGOPTIONS='-c client_min_messages=warning' "$container" psql -h 127.0.0.1 -U "$user" -d postgres -v ON_ERROR_STOP=1 -q "$@"
}

echo "==> Waiting for the database"
for i in $(seq 1 60); do psql_as postgres -tAc 'select 1' >/dev/null 2>&1 && break; sleep 2; done
psql_as postgres -tAc 'select 1' >/dev/null

# a database made under the older name (NexusERP) keeps its bookkeeping in nexus_meta: it is renamed
# (after a copy is put back, that schema is the true one and replaces a newer, now stale drispro_meta)
psql_as postgres <<'SQL'
do $$
declare v_old text := 'nexus' || '_meta'; r record;
begin
  if not exists (select 1 from pg_namespace where nspname = v_old) then return; end if;
  if to_regclass(v_old || '.applied_migrations') is null then execute format('drop schema %I cascade', v_old); return; end if;
  if exists (select 1 from pg_namespace where nspname = 'drispro_meta') then execute 'drop schema drispro_meta cascade'; end if;
  execute format('alter schema %I rename to drispro_meta', v_old);
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'app') and (case when p.prokind = 'f' then pg_get_functiondef(p.oid) end) like '%' || v_old || '.%' loop
    execute replace(pg_get_functiondef(r.oid), v_old || '.', 'drispro_meta.');
  end loop;
end $$;
SQL
psql_as postgres -c "create schema if not exists drispro_meta; create table if not exists drispro_meta.applied_migrations (name text primary key, applied_at timestamptz not null default now());"

echo "==> Applying migrations"
# the list of what is already there is read once, not asked again for every file
applied="$(psql_as postgres -tAc "select name from drispro_meta.applied_migrations")"
skipped=0
for f in supabase/migrations/*.sql; do
  name="$(basename "$f")"
  if printf '%s\n' "$applied" | grep -qxF "$name"; then skipped=$((skipped + 1)); continue; fi
  echo "   apply $name"
  docker cp "$f" "$container:/tmp/$name"
  # one transaction per file, recorded only when it succeeds
  psql_as postgres -1 -o /dev/null -f "/tmp/$name" -c "insert into drispro_meta.applied_migrations (name) values ('$name')"
  docker exec "$container" rm -f "/tmp/$name"
done
echo "   $skipped already there"

# PostgREST caches the database layout; tell it to reload
psql_as postgres -c "notify pgrst, 'reload schema';" >/dev/null || true

if [ "${NO_DEMO:-0}" = "1" ]; then
  echo "==> Schema ready (no demo data). Open the app and sign up to create your company."
  exit 0
fi

companies="$(psql_as postgres -tAc 'select count(*) from public.companies')"
if [ "$companies" != "0" ]; then
  echo "==> The database already has companies; the demo is not loaded again."
  exit 0
fi

echo "==> Loading the demo company (Ylli Retail sh.p.k. and Ylli Kosova L.L.C.)"
docker cp supabase/seed/demo.sql "$container:/tmp/demo.sql"
if psql_as supabase_admin -tAc 'select 1' >/dev/null 2>&1; then
  psql_as supabase_admin -o /dev/null -f /tmp/demo.sql
else
  psql_as postgres -o /dev/null -f /tmp/demo.sql
fi
docker exec "$container" rm -f /tmp/demo.sql
psql_as postgres -c "notify pgrst, 'reload schema';" >/dev/null || true

echo
echo "Done. Sign in to the app as arta@ylli.al with the password demo1234 (other logins: docs/DEMO_DATA.md)."
