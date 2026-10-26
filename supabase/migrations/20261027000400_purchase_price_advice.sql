-- =============================================================================
-- The purchase invoice: a recommended selling price for each item
--   · the item's own target margin, else its category's (as on the "New selling prices" page)
--   · without a target: the margin the item has now, kept on the new cost
--   · the company's margin basis (on cost or on price) and its rounding step
-- =============================================================================

drop function if exists public.purchase_item_info(uuid, uuid, uuid[], uuid);
create or replace function public.purchase_item_info(p_company uuid, p_vendor uuid, p_variants uuid[], p_warehouse uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.company_settings;
begin
  perform app.require_permission(p_company, 'invoicing.read');
  if coalesce(array_length(p_variants, 1), 0) > 500 then raise exception 'At most 500 items at once' using errcode = '54000'; end if;
  select * into s from public.company_settings where company_id = p_company;
  return jsonb_build_object(
    'basis', coalesce(s.price_margin_basis, 'markup'), 'step', coalesce(s.price_round_step, 0), 'down', coalesce(s.price_suggest_down, false),
    'items', coalesce((select jsonb_object_agg(v.id, jsonb_build_object(
      'avg_cost', coalesce(ic.avg_cost, v.standard_cost, 0),
      'sales_net', coalesce(v.sales_price_override, p.sales_price, 0),
      'sales_tax', coalesce(st.rate, 0),
      'purchase_tax_code_id', p.purchase_tax_code_id,
      'tracking', p.tracking, 'track_expiry', p.track_expiry, 'stockable', p.product_type = 'stockable',
      'uom', (select u.code from public.units_of_measure u where u.id = p.uom_id),
      'stock', (select coalesce(sum(sl.on_hand), 0) from public.stock_levels sl where sl.variant_id = v.id and (p_warehouse is null or sl.warehouse_id = p_warehouse)),
      'target', coalesce(p.target_margin_pct, c.target_margin_pct),
      'target_from', case when p.target_margin_pct is not null then 'item' when c.target_margin_pct is not null then 'category' end,
      'category', c.name,
      'last', (select jsonb_build_object('price', bl.unit_price, 'discount', bl.discount_pct, 'date', b.bill_date, 'currency', b.currency_code)
                 from public.vendor_bill_lines bl join public.vendor_bills b on b.id = bl.bill_id
                where bl.variant_id = v.id and b.vendor_id = p_vendor and b.status = 'posted' and b.document_type = 'vendor_bill' and b.deleted_at is null
                order by b.bill_date desc, b.created_at desc limit 1)))
    from public.product_variants v join public.products p on p.id = v.product_id
    left join public.product_categories c on c.id = p.category_id
    left join public.item_costs ic on ic.variant_id = v.id
    left join public.tax_codes st on st.id = p.sales_tax_code_id
   where v.company_id = p_company and v.id = any (p_variants)), '{}'::jsonb));
end $$;
revoke execute on function public.purchase_item_info(uuid, uuid, uuid[], uuid) from public, anon;
grant execute on function public.purchase_item_info(uuid, uuid, uuid[], uuid) to authenticated;
