-- =============================================================================
-- Deleting a client stopped with "Could not delete everything (warehouses: … warehouse_locations …)".
-- Table by table, a table can go only once nothing points at it any more; rows that point at each other in
-- a circle (a near-expiry markdown and its levelling document, a department and its manager…) or a link
-- that could not be emptied kept the work from finishing, and the message named the last table that waited.
--
-- Now the links between tables are checked at the end of the deletion instead of after each table (the
-- links themselves stay as strict as before for everything else: they are still checked at once unless a
-- transaction asks otherwise). Deleting a client asks for that: everything of the client goes in one pass,
-- in any order, and the links are checked once, when nothing of the client is left. If something outside
-- the client still points at it, the message says which link.
-- =============================================================================

-- every link between the tables of the app may be checked at the end of a transaction that asks for it
do $$
declare r record;
begin
  for r in select con.conname, con.conrelid::regclass as tbl from pg_constraint con
            where con.contype = 'f' and con.connamespace = 'public'::regnamespace and not con.condeferrable loop
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

-- the slow way (no right to switch the links off) checks the links once, at the end
select app._patch_function('public.platform_delete_client',
  $x$    perform set_config('lock_timeout', '0', true);
  end if;
$x$,
  $x$    perform set_config('lock_timeout', '0', true);
    set constraints all deferred;
  end if;
$x$);

select app._patch_function('public.platform_delete_client',
  $x$  if not v_fast then delete from public.companies where id = c.id; end if;$x$,
  $x$  if not v_fast then
    delete from public.companies where id = c.id;
    begin
      set constraints all immediate;
    exception when foreign_key_violation then
      raise exception 'Could not delete everything (%)', sqlerrm using errcode = '55000';
    end;
  end if;$x$);

-- when a round still stops, the message names the first table that could not go (the nearest to the cause), and how many more
select app._patch_function('public.platform_delete_client',
  $x$v_progress := false; v_left := 0;$x$,
  $x$v_progress := false; v_left := 0; v_err := null;$x$);
select app._patch_function('public.platform_delete_client',
  $x$v_err := t.tbl || ': ' || sqlerrm;$x$,
  $x$v_err := coalesce(v_err, t.tbl || ': ' || sqlerrm);$x$);
select app._patch_function('public.platform_delete_client',
  $x$raise exception 'Could not delete everything (%)', v_err using$x$,
  $x$raise exception 'Could not delete everything (%)', v_err || case when v_left > 1 then format(' +%s', v_left - 1) else '' end using$x$);

drop function app._patch_function(text, text, text);
