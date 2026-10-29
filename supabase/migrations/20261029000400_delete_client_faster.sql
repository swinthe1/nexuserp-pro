-- =============================================================================
-- Deleting a client stopped at the server's time limit (8 s) once the client had
-- real data: the tables were tried in name order, so most of them waited for the
-- next round and the work was done several times. Now the tables that point to
-- others are emptied first (one round is usually enough), and this one function
-- may take up to ten minutes.
-- =============================================================================

create or replace function public.platform_delete_client(p_company uuid, p_confirm_name text, p_delete_users boolean default true)
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '10min' as $$
declare c public.companies; t record; v_pass int := 0; v_n bigint; v_progress boolean; v_left int; v_err text; v_rows bigint := 0;
  v_users uuid[]; v_users_deleted int := 0; u uuid; v_fast boolean := false; v_disabled text[] := '{}';
begin
  perform app.require_super_admin();
  select * into c from public.companies where id = p_company;
  if c.id is null then raise exception 'Client not found' using errcode = 'P0002'; end if;
  if btrim(coalesce(p_confirm_name, '')) <> c.name then
    raise exception 'Type the client''s name exactly to confirm' using errcode = '23514';
  end if;

  -- people who belong to no other company (never the platform administrators)
  select coalesce(array_agg(distinct m.user_id), '{}') into v_users
    from public.company_members m
   where m.company_id = c.id and m.user_id is not null
     and not exists (select 1 from public.company_members o where o.user_id = m.user_id and o.company_id <> c.id and o.deleted_at is null)
     and not coalesce((select p.is_super_admin from public.profiles p where p.id = m.user_id), false);

  perform set_config('app.allow_hard_delete', 'on', true);
  update public.profiles set last_company_id = null where last_company_id = c.id;

  -- fastest and cleanest: switch off triggers and foreign keys for this transaction (needs the right to do so)
  if coalesce(current_setting('app.purge_no_replica', true), '') <> 'on' then
    begin
      perform set_config('session_replication_role', 'replica', true);
      v_fast := true;
    exception when others then v_fast := false;
    end;
  end if;
  if v_fast then
    for t in select cl.relname as tbl from pg_class cl join pg_namespace ns on ns.oid = cl.relnamespace
              join pg_attribute a on a.attrelid = cl.oid and a.attname = 'company_id' and not a.attisdropped
             where ns.nspname = 'public' and cl.relkind = 'r' and cl.relname <> 'companies' loop
      execute format('delete from public.%I where company_id = $1', t.tbl) using c.id;
      get diagnostics v_n = row_count; v_rows := v_rows + v_n;
    end loop;
    delete from public.companies where id = c.id;
    perform set_config('session_replication_role', 'origin', true);
  end if;

  -- otherwise table by table: a table whose rows are still referenced waits for the next round;
  -- one whose own rules refuse (posted entries…) has those rules paused until the end of this transaction
  -- the whole client goes: its rows' own rules (audit notes, document totals, guards) have nothing left to do,
  -- so they are paused on every table for this transaction (each pause waits at most a few seconds for its lock)
  if not v_fast then
    perform set_config('lock_timeout', '5s', true);
    for t in select cl.relname as tbl from pg_class cl join pg_namespace ns on ns.oid = cl.relnamespace
              join pg_attribute a on a.attrelid = cl.oid and a.attname = 'company_id' and not a.attisdropped
             where ns.nspname = 'public' and cl.relkind = 'r' and cl.relname <> 'companies'
               and exists (select 1 from pg_trigger g where g.tgrelid = cl.oid and not g.tgisinternal and g.tgenabled <> 'D') loop
      begin
        execute format('alter table public.%I disable trigger user', t.tbl);
        v_disabled := v_disabled || t.tbl::text;
      exception when others then null;   -- could not pause it: its rows go the slow way
      end;
    end loop;
    perform set_config('lock_timeout', '0', true);
  end if;

  loop
    exit when v_fast;
    v_pass := v_pass + 1;
    v_progress := false; v_left := 0;
    for t in with recursive edge as (
                select distinct con.conrelid as child, con.confrelid as parent from pg_constraint con
                 join pg_namespace n on n.oid = con.connamespace
                where con.contype = 'f' and n.nspname = 'public' and con.conrelid <> con.confrelid),
              up(tbl, depth) as (
                select e.parent, 1 from edge e
                union   -- each (table, depth) once: no walking every path again
                select e.parent, u.depth + 1 from up u join edge e on e.child = u.tbl where u.depth < 30),
              lvl as (select tbl, max(depth) depth from up group by tbl)
            select cl.relname as tbl from pg_class cl join pg_namespace ns on ns.oid = cl.relnamespace
              join pg_attribute a on a.attrelid = cl.oid and a.attname = 'company_id' and not a.attisdropped
              left join lvl on lvl.tbl = cl.oid
             where ns.nspname = 'public' and cl.relkind = 'r' and cl.relname <> 'companies'
             order by coalesce(lvl.depth, 0), cl.relname loop
      begin
        execute format('delete from public.%I where company_id = $1', t.tbl) using c.id;
        get diagnostics v_n = row_count;
        if v_n > 0 then v_progress := true; v_rows := v_rows + v_n; end if;
      exception
        when foreign_key_violation then v_left := v_left + 1; v_err := t.tbl || ': ' || sqlerrm;
        when others then
          v_left := v_left + 1; v_err := t.tbl || ': ' || sqlerrm;
          if not (t.tbl = any (v_disabled)) then
            execute format('alter table public.%I disable trigger user', t.tbl);
            v_disabled := v_disabled || t.tbl::text; v_progress := true;
          end if;
      end;
    end loop;
    exit when v_left = 0;
    if not v_progress or v_pass > 40 then raise exception 'Could not delete everything (%)', v_err using errcode = '55000'; end if;
  end loop;

  if not v_fast then delete from public.companies where id = c.id; end if;
  foreach v_err in array v_disabled loop execute format('alter table public.%I enable trigger user', v_err); end loop;
  delete from public.audit_log where company_id = c.id;

  if p_delete_users then
    foreach u in array v_users loop
      begin
        delete from public.profiles where id = u;
        delete from auth.users where id = u;
        v_users_deleted := v_users_deleted + 1;
      exception when others then null;   -- an account still referenced somewhere stays
      end;
    end loop;
  end if;
  raise log 'platform_delete_client: % (%) deleted by %, % rows', c.name, c.id, auth.uid(), v_rows;
  return jsonb_build_object('rows', v_rows, 'users_deleted', v_users_deleted, 'rounds', v_pass, 'fast', v_fast);
end $$;
revoke execute on function public.platform_delete_client(uuid, text, boolean) from public, anon;
grant execute on function public.platform_delete_client(uuid, text, boolean) to authenticated;

-- Every link between tables gets an index on its own column(s), so checking "does anything still point
-- here?" (on delete, on cancel) reads a few rows instead of the whole table. Only filled values are
-- indexed, so the many links that are mostly empty cost almost nothing.
do $$
declare r record; v_cols text; v_where text; v_name text;
begin
  for r in
    select c.conname, c.conrelid, c.conrelid::regclass as tbl,
           array(select a.attname from unnest(c.conkey) with ordinality k(n, o) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n
                  where a.attname <> 'company_id' order by k.o) as own
      from pg_constraint c join pg_namespace ns on ns.oid = c.connamespace
     where c.contype = 'f' and ns.nspname = 'public'
  loop
    continue when cardinality(r.own) = 0;
    continue when exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
                           where i.indrelid = r.conrelid and a.attname = r.own[1]);
    v_cols := (select string_agg(format('%I', x), ', ') from unnest(r.own) x);
    v_where := (select string_agg(format('%I is not null', x), ' and ') from unnest(r.own) x);
    v_name := 'fk_' || substr(md5(r.conrelid::text || r.conname), 1, 20);
    execute format('create index if not exists %I on %s (%s) where %s', v_name, r.tbl, v_cols, v_where);
  end loop;
end $$;
