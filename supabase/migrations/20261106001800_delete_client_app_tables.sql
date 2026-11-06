-- =============================================================================
-- Deleting a client stopped with "pos_registers: … atk_jobs_register_id_fkey on table atk_jobs": the
-- deletion went through the tables of the app (schema public) only, while a few kept tables of the client
-- (the fiscal requests sent to ATK for a register, the fiscal device numbers used) sit in the internal schema
-- and point at them. Those of the client now go first; their links may be checked at the end, too.
-- =============================================================================

do $$
declare r record;
begin
  for r in select con.conname, con.conrelid::regclass as tbl from pg_constraint con
            where con.contype = 'f' and con.connamespace = 'app'::regnamespace and not con.condeferrable
              and con.confrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace) loop
    begin
      execute format('alter table %s alter constraint %I deferrable initially immediate', r.tbl, r.conname);
    exception when others then raise notice 'link % on % stays as it was: %', r.conname, r.tbl, sqlerrm;
    end;
  end loop;
end $$;

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;

select app._patch_function('public.platform_delete_client',
  $x$  update public.profiles set last_company_id = null where last_company_id = c.id;
$x$,
  $x$  update public.profiles set last_company_id = null where last_company_id = c.id;

  -- the client's rows in the internal tables that belong to a client (they point at the client): first
  for t in select cl.relname as tbl from pg_class cl
            join pg_attribute a on a.attrelid = cl.oid and a.attname = 'company_id' and not a.attisdropped
           where cl.relnamespace = 'app'::regnamespace and cl.relkind = 'r'
             and exists (select 1 from pg_constraint k where k.conrelid = cl.oid and k.contype = 'f' and k.confrelid = 'public.companies'::regclass) loop
    execute format('delete from app.%I where company_id = $1', t.tbl) using c.id;
    get diagnostics v_n = row_count; v_rows := v_rows + v_n;
  end loop;
$x$);

drop function app._patch_function(text, text, text);
