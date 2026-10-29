-- =============================================================================
-- The new item form asks for the quantity on the shelf right away. This puts
-- it in as an opening stock adjustment (reason: opening) in one step, at the
-- main location of the chosen warehouse, valued at the cost given (without VAT).
-- It goes through the normal posting, so approvals and the books stay the same.
-- =============================================================================

create or replace function public.product_opening_stock(p_product uuid, p_warehouse uuid, p_qty numeric, p_cost numeric default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_variant uuid; v_n int; v_id uuid; v_status text;
begin
  select company_id into v_company from public.products where id = p_product and deleted_at is null;
  if v_company is null then raise exception 'Product not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_company, 'inventory.write');
  if coalesce(p_qty, 0) <= 0 then raise exception 'The opening quantity must be more than zero' using errcode = '23514'; end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse and company_id = v_company) then
    raise exception 'Warehouse not found' using errcode = 'P0002';
  end if;
  select count(*), min(id::text)::uuid into v_n, v_variant from public.product_variants where product_id = p_product and deleted_at is null;
  if v_n <> 1 then raise exception 'An item with variants gets its opening stock per variant, with a stock adjustment' using errcode = '23514'; end if;

  v_id := public.save_document('stock_adjustments',
    jsonb_build_object('company_id', v_company, 'warehouse_id', p_warehouse, 'reason', 'opening', 'adjustment_date', current_date),
    jsonb_build_object('stock_adjustment_lines', jsonb_build_array(jsonb_build_object(
      'variant_id', v_variant, 'location_id', app.main_location(p_warehouse), 'quantity_change', p_qty,
      'unit_cost', case when coalesce(p_cost, 0) > 0 then p_cost end))));
  v_status := public.post_stock_adjustment(v_id);
  return jsonb_build_object('id', v_id, 'status', v_status);
end $$;
revoke execute on function public.product_opening_stock(uuid, uuid, numeric, numeric) from public, anon;
grant execute on function public.product_opening_stock(uuid, uuid, numeric, numeric) to authenticated;
