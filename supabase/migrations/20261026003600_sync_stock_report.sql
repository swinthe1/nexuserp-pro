-- =============================================================================
-- DrisPRO · the live link says which stock rows it could not place
-- (unknown item or warehouse), so a full stock check shows the cause, not just a count
-- =============================================================================

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

select app._patch_function('app.sync_stock',
  $x$v_lines int; v_changed int := 0; v_unknown int := 0; v_no_wh int := 0;$x$,
  $x$v_lines int; v_changed int := 0; v_unknown int := 0; v_no_wh int := 0; v_skus jsonb := '[]'; v_whs jsonb := '[]';$x$);
select app._patch_function('app.sync_stock',
  $x$      v_no_wh := v_no_wh + (select count(*) from jsonb_array_elements(p_rows) x where x ->> 'warehouse' = w.code);$x$,
  $x$      v_no_wh := v_no_wh + (select count(*) from jsonb_array_elements(p_rows) x where x ->> 'warehouse' = w.code);
      v_whs := v_whs || to_jsonb(w.code);$x$);
select app._patch_function('app.sync_stock',
  $x$      if v_variant is null then v_unknown := v_unknown + 1; continue; end if;$x$,
  $x$      if v_variant is null then
        v_unknown := v_unknown + 1;
        if jsonb_array_length(v_skus) < 5 then v_skus := v_skus || to_jsonb(r ->> 'sku'); end if;
        continue;
      end if;$x$);
select app._patch_function('app.sync_stock',
  $x$'unknown_items', v_unknown, 'unknown_warehouse', v_no_wh);$x$,
  $x$'unknown_items', v_unknown, 'unknown_warehouse', v_no_wh, 'unknown_skus', v_skus, 'unknown_warehouses', v_whs);$x$);

drop function app._patch_function(text, text, text);
