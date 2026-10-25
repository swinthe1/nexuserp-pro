-- =============================================================================
-- DrisPRO · stock per store / warehouse (dashboard card "Stoku sipas njësive")
-- For each active warehouse: stock value at average cost, items in stock, items
-- without a cost (they count as 0 €), items below zero and open low-stock alerts.
-- Runs as the caller (RLS decides what they see).
-- =============================================================================
create or replace function public.stock_by_warehouse(p_company uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x.value desc, x.code), '[]'::jsonb) from (
    select w.id, w.code, w.name, w.warehouse_type as type,
           coalesce(round(sum(sl.on_hand * coalesce(ic.avg_cost, 0)) filter (where sl.on_hand > 0), 2), 0) as value,
           count(distinct sl.variant_id) filter (where sl.on_hand > 0) as items,
           count(distinct sl.variant_id) filter (where sl.on_hand > 0 and coalesce(ic.avg_cost, 0) = 0) as items_without_cost,
           count(distinct sl.variant_id) filter (where sl.on_hand < 0) as items_negative,
           (select count(*) from public.stock_alerts a where a.company_id = p_company and a.warehouse_id = w.id and a.status in ('open', 'acknowledged')) as low_stock
      from public.warehouses w
      left join public.stock_levels sl on sl.company_id = w.company_id and sl.warehouse_id = w.id
      left join public.item_costs ic on ic.company_id = sl.company_id and ic.variant_id = sl.variant_id
     where w.company_id = p_company and w.deleted_at is null and w.is_active
     group by w.id, w.code, w.name, w.warehouse_type) x
$$;
revoke execute on function public.stock_by_warehouse(uuid) from public, anon;
grant execute on function public.stock_by_warehouse(uuid) to authenticated;
