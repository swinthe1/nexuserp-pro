-- =============================================================================
-- DrisPRO · restaurant, the missing pieces
--   * paying a table with a discount card / points (already passed on) and a discount given by
--     hand, which is checked against the till's discount limit like at the shop till
--   * the floor plan: where each table stands in its room, and its shape
--   * the waiters' report: bills, guests, takings, discounts and cancelled items per waiter
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

-- a discount given by hand is a manual discount (the till's limit applies), a card's is not
select app._patch_function('public.restaurant_pay',
  $x$'manual_pct', 0, 'description', tl.name)$x$,
  $x$'manual_pct', coalesce((select (y ->> 'manual_pct')::numeric from jsonb_array_elements(coalesce(p -> 'discounts', '[]'::jsonb)) y
                                                                            where (y ->> 'line_id')::uuid = tl.id or (y ->> 'variant_id')::uuid = tl.variant_id limit 1), 0),
                                                  'description', tl.name)$x$);

-- the floor plan: position in percent of the room (null = not placed yet) and shape
alter table public.restaurant_tables
  add column pos_x numeric(5,2) check (pos_x between 0 and 100),
  add column pos_y numeric(5,2) check (pos_y between 0 and 100),
  add column shape text not null default 'square' check (shape in ('square', 'round', 'long'));

select app._patch_function('public.restaurant_floor',
  $x$jsonb_build_object('id', tb.id, 'name', tb.name, 'seats', tb.seats)$x$,
  $x$jsonb_build_object('id', tb.id, 'name', tb.name, 'seats', tb.seats, 'x', tb.pos_x, 'y', tb.pos_y, 'shape', tb.shape)$x$);

drop function app._patch_function(text, text, text);

-- the waiters' report for a period (one store, or all)
create or replace function public.restaurant_waiter_report(p_company uuid, p_from date, p_to date, p_warehouse uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_tz text := coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane');
begin
  perform app.require_permission(p_company, 'pos.read');
  perform app.require_feature(p_company, 'restaurant');
  return coalesce((select jsonb_agg(x order by x.total desc nulls last) from (
    with bills as (
      select po.waiter_id, po.table_order_id, po.total, coalesce(po.discount_total, 0) + coalesce(po.loyalty_discount, 0) as discount, po.order_at
        from public.pos_orders po
        join public.table_orders o on o.id = po.table_order_id
       where po.company_id = p_company and po.table_order_id is not null and not po.is_refund and po.deleted_at is null
         and (po.order_at at time zone v_tz)::date between p_from and p_to
         and (p_warehouse is null or o.warehouse_id = p_warehouse)),
    tabs as (
      select o.waiter_id, count(*) as tabs, sum(o.guests) as guests,
             avg(extract(epoch from (o.closed_at - o.opened_at)) / 60) filter (where o.closed_at is not null) as minutes
        from public.table_orders o
       where o.company_id = p_company and o.status = 'paid'
         and (o.closed_at at time zone v_tz)::date between p_from and p_to
         and (p_warehouse is null or o.warehouse_id = p_warehouse)
       group by o.waiter_id),
    voids as (
      select l.waiter_id, count(*) as voided, sum(l.quantity * l.unit_price) as voided_value
        from public.table_order_lines l join public.table_orders o on o.id = l.table_order_id
       where l.company_id = p_company and l.status = 'void' and l.sent_at is not null
         and (l.sent_at at time zone v_tz)::date between p_from and p_to
         and (p_warehouse is null or o.warehouse_id = p_warehouse)
       group by l.waiter_id)
    select w.waiter_id, coalesce(pr.full_name, pr.email, '—') as waiter,
           coalesce(b.bills, 0) as bills, coalesce(tb.tabs, 0) as tables, coalesce(tb.guests, 0) as guests,
           coalesce(b.total, 0) as total, coalesce(b.discount, 0) as discount,
           case when coalesce(tb.guests, 0) > 0 then round(coalesce(b.total, 0) / tb.guests, 2) end as per_guest,
           round(tb.minutes)::int as avg_minutes, coalesce(v.voided, 0) as voided, coalesce(v.voided_value, 0) as voided_value
      from (select waiter_id from bills union select waiter_id from tabs union select waiter_id from voids) w
      left join (select waiter_id, count(*) as bills, sum(total) as total, sum(discount) as discount from bills group by waiter_id) b on b.waiter_id = w.waiter_id
      left join tabs tb on tb.waiter_id = w.waiter_id
      left join voids v on v.waiter_id = w.waiter_id
      left join public.profiles pr on pr.id = w.waiter_id) x), '[]'::jsonb);
end $$;
revoke execute on function public.restaurant_waiter_report(uuid, date, date, uuid) from public, anon;
grant execute on function public.restaurant_waiter_report(uuid, date, date, uuid) to authenticated;
