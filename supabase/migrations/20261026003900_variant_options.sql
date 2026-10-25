-- =============================================================================
-- DrisPRO · a light list of items for pickers (no stock sums per row), so a company
-- with tens of thousands of items loads its pickers quickly
-- =============================================================================
create or replace view public.v_variant_options with (security_invoker = true) as
select v.company_id, v.id, v.sku, v.name, v.product_id, v.is_active, p.tracking, p.product_type, u.code as uom_code,
       ic.avg_cost, coalesce(v.sales_price_override, p.sales_price) as sales_price
  from public.product_variants v
  join public.products p on p.id = v.product_id
  join public.units_of_measure u on u.id = p.uom_id
  left join public.item_costs ic on ic.company_id = v.company_id and ic.variant_id = v.id
 where v.deleted_at is null and p.deleted_at is null;
grant select on public.v_variant_options to authenticated;
