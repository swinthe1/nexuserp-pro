-- =============================================================================
-- A transfer between units never sends what the sending unit does not have: even where the company
-- lets the tills sell below zero (so a sale never stops), moving goods to another unit needs them on
-- the shelf. The message says how much there is.
-- =============================================================================

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
  perform app._patch_function('app.post_stock_move',
    $o$    v_allow_negative := v_allow_negative or coalesce(current_setting('app.pos_allow_negative', true), '') = 'on';$o$,
    $n$    v_allow_negative := v_allow_negative or coalesce(current_setting('app.pos_allow_negative', true), '') = 'on';
    -- goods sent to another unit must be there: no transfer below zero, whatever the company allows the tills
    if p_type = 'transfer' then v_allow_negative := false; end if;$n$);
  perform app._patch_function('app.post_stock_move',
    $o$    if coalesce(v_onhand, 0) < p_qty and not v_allow_negative then
      raise exception$o$,
    $n$    if coalesce(v_onhand, 0) < p_qty and not v_allow_negative and p_type = 'transfer' then
      raise exception 'Not enough % at % to transfer: % on hand, % to send', v_prod.sku, v_from.code,
                      trim_scale(greatest(coalesce(v_onhand, 0), 0)), trim_scale(p_qty) using errcode = 'P0001';
    end if;
    if coalesce(v_onhand, 0) < p_qty and not v_allow_negative then
      raise exception$n$);
end $$;
drop function app._patch_function(text, text, text);
