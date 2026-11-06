-- =============================================================================
-- Units step 4: each unit at a glance on the dashboard — sales at the till today and this month, receipts,
-- tills open now, stock value and items running low — for the units this person may see.
-- =============================================================================

create or replace function public.units_today(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_access uuid[];
begin
  perform app.require_permission(p_company, 'pos.read');
  v_access := public.my_warehouse_access(p_company);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', w.id, 'code', w.code, 'name', w.name, 'kind', w.warehouse_type, 'city', w.city,
             'sales_today', coalesce(s.today, 0), 'receipts_today', coalesce(s.receipts, 0), 'sales_month', coalesce(s.month, 0),
             'tills', (select count(*) from public.pos_registers r where r.warehouse_id = w.id and r.is_active and r.deleted_at is null),
             'tills_open', (select count(*) from public.pos_sessions ss join public.pos_registers r on r.id = ss.register_id
                             where r.warehouse_id = w.id and ss.status = 'open' and ss.deleted_at is null),
             'stock_value', (select coalesce(sum(l.stock_value), 0) from public.v_stock_levels l where l.warehouse_id = w.id),
             'low', (select count(*) from public.v_low_stock x where x.warehouse_id = w.id))
           order by w.warehouse_type <> 'store', w.code)
      from public.warehouses w
      left join lateral (
        select sum(case when o.is_refund then -abs(o.total) else o.total end) filter (where o.order_at >= date_trunc('day', now())) as today,
               count(*) filter (where o.order_at >= date_trunc('day', now()) and not o.is_refund) as receipts,
               sum(case when o.is_refund then -abs(o.total) else o.total end) as month
          from public.pos_orders o join public.pos_registers r on r.id = o.register_id
         where r.warehouse_id = w.id and o.status = 'paid' and o.deleted_at is null and o.order_at >= date_trunc('month', now())) s on true
     where w.company_id = p_company and w.deleted_at is null and w.is_active and w.warehouse_type <> 'transit'
       and (v_access is null or w.id = any (v_access))), '[]'::jsonb);
end $$;
revoke execute on function public.units_today(uuid) from public, anon;
grant execute on function public.units_today(uuid) to authenticated;
