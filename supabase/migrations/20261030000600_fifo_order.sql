-- =============================================================================
-- FIFO: layers that come in at the same moment (two lines of one receipt, a transfer
-- of several lots) are used up in the order they were made, not by chance
-- =============================================================================
alter table public.cost_layers add column if not exists seq bigint generated always as identity;
create index if not exists cost_layers_order_idx on public.cost_layers (company_id, variant_id, layer_at, seq) where qty_left > 0;

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
  perform app._patch_function('app.post_stock_move', $p$order by layer_at, created_at for update loop$p$, $p$order by layer_at, seq for update loop$p$);
  perform app._patch_function('public.cost_layers_of', $p$order by l.layer_at, l.created_at)$p$, $p$order by l.layer_at, l.seq)$p$);
end $$;
drop function app._patch_function(text, text, text);
