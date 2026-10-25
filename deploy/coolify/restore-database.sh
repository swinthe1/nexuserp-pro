#!/usr/bin/env bash
# DrisPRO · put a copy back. EVERYTHING written after that copy is lost.
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
keep_acl=(--no-owner --no-privileges); [ "$user" = supabase_admin ] && keep_acl=()
docker exec -i -e PGPASSWORD="$pass" "$container" pg_restore -h 127.0.0.1 -U "$user" -d postgres --clean --if-exists "${keep_acl[@]}" \
  --schema=public --schema=app --schema=auth --schema=storage --schema=nexus_meta --single-transaction < "$file"
# sign-in and file storage must own their tables again (an older copy made without owners leaves them to the restorer)
docker exec -i -e PGPASSWORD="$pass" "$container" psql -h 127.0.0.1 -U "$user" -d postgres -q -v ON_ERROR_STOP=0 >/dev/null 2>&1 <<'SQL' || true
do $$
declare r record; s text; o text;
begin
  foreach s in array array['auth', 'storage'] loop
    o := case s when 'auth' then 'supabase_auth_admin' else 'supabase_storage_admin' end;
    if not exists (select 1 from pg_roles where rolname = o) or not exists (select 1 from pg_namespace where nspname = s) then continue; end if;
    for r in select c.oid::regclass as obj, c.relkind as k from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = s and c.relkind in ('r', 'p', 'S', 'v', 'm') and pg_get_userbyid(c.relowner) <> o
                and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype in ('a', 'i') and d.classid = 'pg_class'::regclass and c.relkind = 'S') loop
      execute format('alter %s %s owner to %I', case r.k when 'S' then 'sequence' when 'v' then 'view' when 'm' then 'materialized view' else 'table' end, r.obj, o);
    end loop;
    for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = s and pg_get_userbyid(p.proowner) <> o loop
      execute format('alter function %s owner to %I', r.f, o);
    end loop;
    for r in select t.oid::regtype as ty from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = s and t.typtype in ('e', 'd', 'c') and t.typrelid = 0 and pg_get_userbyid(t.typowner) <> o loop
      execute format('alter type %s owner to %I', r.ty, o);
    end loop;
    execute format('grant usage, create on schema %I to %I', s, o);
    execute format('grant usage on schema %I to anon, authenticated, service_role', s);
    execute format('grant all on all tables in schema %I to %I, service_role', s, o);
    execute format('grant all on all sequences in schema %I to %I, service_role', s, o);
    if exists (select 1 from pg_roles where rolname = 'postgres') then
      execute format('grant all on all tables in schema %I to postgres with grant option', s);
    end if;
  end loop;
  -- file storage: everyone reaches the tables, the row policies decide what each one sees (as Supabase sets it)
  if to_regclass('storage.objects') is not null then
    grant all on all tables in schema storage to anon, authenticated;
    grant all on all sequences in schema storage to anon, authenticated;
    grant execute on all functions in schema storage to anon, authenticated, service_role;
  end if;
  -- DrisPRO's own schemas belong to postgres, which applies the updates (a restore as supabase_admin would keep them otherwise)
  foreach s in array array['public', 'app', 'nexus_meta'] loop
    if not exists (select 1 from pg_namespace where nspname = s) then continue; end if;
    if pg_get_userbyid((select nspowner from pg_namespace where nspname = s)) = 'supabase_admin' and s <> 'public' then execute format('alter schema %I owner to postgres', s); end if;
    for r in select c.oid::regclass as obj, c.relkind as k from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = s and c.relkind in ('r', 'p', 'S', 'v', 'm') and pg_get_userbyid(c.relowner) = 'supabase_admin'
                and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype in ('a', 'i') and d.classid = 'pg_class'::regclass and c.relkind = 'S') loop
      execute format('alter %s %s owner to postgres', case r.k when 'S' then 'sequence' when 'v' then 'view' when 'm' then 'materialized view' else 'table' end, r.obj);
    end loop;
    for r in select p.oid::regprocedure as f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = s and pg_get_userbyid(p.proowner) = 'supabase_admin' and p.prokind in ('f', 'p') loop
      execute format('alter routine %s owner to postgres', r.f);
    end loop;
    for r in select t.oid::regtype as ty from pg_type t join pg_namespace n on n.oid = t.typnamespace
              where n.nspname = s and t.typtype in ('e', 'd', 'c') and t.typrelid = 0 and pg_get_userbyid(t.typowner) = 'supabase_admin' loop
      execute format('alter type %s owner to postgres', r.ty);
    end loop;
  end loop;
  if exists (select 1 from pg_roles where rolname = 'dashboard_user') and to_regclass('auth.users') is not null then
    grant all on all tables in schema auth to dashboard_user;
  end if;
end $$;
SQL
docker exec -e PGPASSWORD="$pass" "$container" psql -h 127.0.0.1 -U "$user" -d postgres -c "notify pgrst, 'reload schema';" >/dev/null || true
echo "==> done. Restart sign-in and the API (or Redeploy in Coolify) and sign in again."
