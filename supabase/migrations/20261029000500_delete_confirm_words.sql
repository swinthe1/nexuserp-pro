-- Deleting a client: two tables that point at each other (a department has a manager, the employee
-- has a department) blocked each other. When a round frees nothing, the client's links that may be
-- empty are cleared once, then the rounds go on.
-- Also: the typed name must have the same words; full stops, commas, spaces and capitals
-- do not count ("Ylli Retail sh.p.k" or "ylli retail shpk" confirm "Ylli Retail sh.p.k.").
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

do $$ begin
  perform app._patch_function('public.platform_delete_client',
    $p$if btrim(coalesce(p_confirm_name, '')) <> c.name then$p$,
    $p$if regexp_replace(lower(coalesce(p_confirm_name, '')), '[[:space:].,]+', '', 'g') = ''
     or regexp_replace(lower(coalesce(p_confirm_name, '')), '[[:space:].,]+', '', 'g') <> regexp_replace(lower(c.name), '[[:space:].,]+', '', 'g') then$p$);
  perform app._patch_function('public.platform_delete_client',
    $p$v_disabled text[] := '{}';$p$,
    $p$v_disabled text[] := '{}'; v_unlinked boolean := false; r2 record;$p$);
  perform app._patch_function('public.platform_delete_client',
    $p$    if not v_progress or v_pass > 40 then raise exception$p$,
    $p$    if not v_progress and not v_unlinked then
      -- stuck on tables that point at each other: clear this client's links that may be empty, then go on
      v_unlinked := true; v_progress := true;
      for r2 in
        select fk.conrelid::regclass::text as tbl,
               array(select a.attname::text from unnest(fk.conkey) k(n) join pg_attribute a on a.attrelid = fk.conrelid and a.attnum = k.n
                      where a.attname <> 'company_id') as own
          from pg_constraint fk join pg_namespace ns on ns.oid = fk.connamespace
         where fk.contype = 'f' and ns.nspname = 'public'
           and exists (select 1 from pg_attribute a where a.attrelid = fk.conrelid and a.attname = 'company_id' and not a.attisdropped)
           and not exists (select 1 from unnest(fk.conkey) k(n) join pg_attribute a on a.attrelid = fk.conrelid and a.attnum = k.n
                            where a.attname <> 'company_id' and a.attnotnull)
      loop
        continue when cardinality(r2.own) = 0;
        begin
          execute format('update %s set %s where company_id = $1 and (%s)', r2.tbl,
            (select string_agg(format('%I = null', x), ', ') from unnest(r2.own) x),
            (select string_agg(format('%I is not null', x), ' or ') from unnest(r2.own) x)) using c.id;
        exception when others then null;
        end;
      end loop;
      continue;
    end if;
    if not v_progress or v_pass > 40 then raise exception$p$);
end $$;
drop function app._patch_function(text, text, text);
