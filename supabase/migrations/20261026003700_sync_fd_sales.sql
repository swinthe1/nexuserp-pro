-- =============================================================================
-- DrisPRO · Logmicro tills that do not write sales orders (e.g. Drenas, Fushë Kosovë,
-- cafés) record each sale as a stock exit of type 'FD'. It is a till sale, not an adjustment.
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

select app._patch_function('app.sync_movements',
  $x$      ('V+', 'receipt', 'supplier'),$x$,
  $x$      ('FD', 'pos_sale', 'customer'),
      ('V+', 'receipt', 'supplier'),$x$);

drop function app._patch_function(text, text, text);
