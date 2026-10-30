-- =============================================================================
-- FIFO: freight, customs and a billed price difference go to the layer of the receipt
-- they belong to (while it is still in stock), not spread over all the stock of the item.
-- The value of the item and of its layers stays the same total.
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
  -- landed cost: p_source_line is the receipt line
  perform app._patch_function('app.post_value_adjustment',
    $p$  update public.item_costs set total_value = total_value + p_amount, avg_cost = v_avg where id = ic.id;$p$,
    $p$  perform set_config('app.fifo_target', coalesce((select string_agg(cl.id::text, ',') from public.cost_layers cl
                                                       join public.stock_movements m on m.id = cl.movement_id
                                                      where m.source_line_id = p_source_line and cl.variant_id = p_variant and cl.qty_left > 0), ''), true);
  update public.item_costs set total_value = total_value + p_amount, avg_cost = v_avg where id = ic.id;
  perform set_config('app.fifo_target', '', true);$p$);
  -- price difference on the bill: the receipt lines of the same order line
  perform app._patch_function('app.post_price_variance',
    $p$  update public.item_costs set total_value = greatest(total_value + p_amount, 0), avg_cost = v_avg where id = ic.id;$p$,
    $p$  perform set_config('app.fifo_target', coalesce((select string_agg(cl.id::text, ',') from public.cost_layers cl
                                                       join public.stock_movements m on m.id = cl.movement_id
                                                       join public.goods_receipt_lines gl on gl.id = m.source_line_id
                                                       join public.vendor_bill_lines bl on bl.id = p_line and bl.po_line_id = gl.po_line_id
                                                      where cl.variant_id = p_variant and cl.qty_left > 0), ''), true);
  update public.item_costs set total_value = greatest(total_value + p_amount, 0), avg_cost = v_avg where id = ic.id;
  perform set_config('app.fifo_target', '', true);$p$);
end $$;
drop function app._patch_function(text, text, text);

-- the layers follow the value: to the named receipt's layers when there are any, otherwise over all of them
create or replace function app.tg_fifo_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_qty numeric; v_val numeric; v_target uuid[]; v_tq numeric; v_diff numeric;
begin
  if not exists (select 1 from public.company_settings where company_id = new.company_id and costing_method = 'fifo') then return null; end if;
  if new.qty_on_hand <= 0 then
    update public.cost_layers set qty_left = 0 where company_id = new.company_id and variant_id = new.variant_id and qty_left > 0;
    return null;
  end if;
  select coalesce(sum(qty_left), 0), coalesce(sum(qty_left * unit_cost), 0) into v_qty, v_val
    from public.cost_layers where company_id = new.company_id and variant_id = new.variant_id and qty_left > 0;
  v_diff := new.total_value - v_val;
  if v_qty <= 0 or abs(v_diff) <= 0.01 then return null; end if;
  v_target := string_to_array(nullif(current_setting('app.fifo_target', true), ''), ',')::uuid[];
  if v_target is not null then
    select coalesce(sum(qty_left), 0) into v_tq from public.cost_layers where id = any (v_target) and qty_left > 0;
    -- a lower cost may not take a layer below zero: then the whole stock carries it
    if v_tq > 0 and not exists (select 1 from public.cost_layers where id = any (v_target) and qty_left > 0 and unit_cost + v_diff / v_tq < 0) then
      update public.cost_layers set unit_cost = unit_cost + v_diff / v_tq where id = any (v_target) and qty_left > 0;
      return null;
    end if;
  end if;
  update public.cost_layers set unit_cost = greatest(unit_cost + v_diff / v_qty, 0)
   where company_id = new.company_id and variant_id = new.variant_id and qty_left > 0;
  return null;
end $$;
