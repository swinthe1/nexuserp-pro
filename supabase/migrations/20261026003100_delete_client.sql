-- =============================================================================
-- DrisPRO · delete a client completely (platform administrator only)
--
-- Removes every row of the company in every table (documents, stock, accounting,
-- users' memberships, licence, live link…), then the company. Accounts of people who
-- belonged only to this company are removed too when p_delete_users is true.
-- The caller must type the company name exactly. There is no undo apart from a backup.
-- =============================================================================
create or replace function app.tg_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_old jsonb; v_new jsonb; v_action text := tg_op; v_changed text[];
begin
  -- a purge (deleting a whole client) leaves no copies behind
  if tg_op = 'DELETE' and not app.is_client_context() and coalesce(current_setting('app.allow_hard_delete', true), '') = 'on' then return null; end if;
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;

  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into v_changed
      from jsonb_object_keys(v_new) as k
     where k not in ('updated_at', 'updated_by') and v_new -> k is distinct from v_old -> k;
    if v_changed is null then return null; end if;   -- no-op update, nothing to log
    if v_old ->> 'deleted_at' is null and v_new ->> 'deleted_at' is not null then v_action := 'SOFT_DELETE';
    elsif v_old ->> 'deleted_at' is not null and v_new ->> 'deleted_at' is null then v_action := 'RESTORE';
    end if;
  end if;

  insert into public.audit_log (company_id, table_name, record_id, action, old_data, new_data, changed_fields, actor_id)
  values (
    coalesce(v_new ->> 'company_id', v_old ->> 'company_id',
             case when tg_table_name = 'companies' then coalesce(v_new ->> 'id', v_old ->> 'id') end)::uuid,
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id')::uuid,
    v_action, v_old, v_new, v_changed, auth.uid());
  return null;
end $$;

create or replace function public.platform_delete_client(p_company uuid, p_confirm_name text, p_delete_users boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
  loop
    exit when v_fast;
    v_pass := v_pass + 1;
    v_progress := false; v_left := 0;
    for t in select cl.relname as tbl from pg_class cl join pg_namespace ns on ns.oid = cl.relnamespace
              join pg_attribute a on a.attrelid = cl.oid and a.attname = 'company_id' and not a.attisdropped
             where ns.nspname = 'public' and cl.relkind = 'r' and cl.relname <> 'companies' order by cl.relname loop
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
