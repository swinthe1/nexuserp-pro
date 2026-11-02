-- =============================================================================
-- DrisPRO · ABC first, XYZ only when asked for; stock not sold, for a chosen period
--   ABC is the classification everyone uses; XYZ (how regularly an item sells) is a setting,
--   off unless a company switches it on. It is still worked out, so switching it on shows it at once.
--   Stock that has not sold: for 30, 60, 90, 180 days, a year, or since a date, for the whole company
--   or one unit, with the date each item last sold and when it first came into that stock; items that
--   came in during the period are left out unless asked for (they have not had the time to sell).
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

create or replace function app.abc_cfg(p_company uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('basis', 'value', 'months', 12, 'a', 80, 'b', 95, 'xyz', false, 'x', 0.25, 'y', 0.5, 'count_a', 30, 'count_b', 90, 'count_c', 365)
         || coalesce((select abc_settings from public.company_settings where company_id = p_company), '{}'::jsonb)
$$;

select app._patch_function('public.abc_settings_save',
  $x$     set abc_settings = jsonb_build_object('basis', c ->> 'basis', 'months', (c ->> 'months')::int, 'a', (c ->> 'a')::numeric, 'b', (c ->> 'b')::numeric,$x$,
  $x$     set abc_settings = jsonb_build_object('basis', c ->> 'basis', 'months', (c ->> 'months')::int, 'a', (c ->> 'a')::numeric, 'b', (c ->> 'b')::numeric,
                                           'xyz', coalesce((c ->> 'xyz')::boolean, false),$x$);

-- the class shown where an item is looked up: "A", or "AX" when XYZ is on
select app._patch_function('public.item_where',
  $x$'class', (select ic.abc || ic.xyz from public.item_classes ic where ic.variant_id = v.id and ic.warehouse_id is null))$x$,
  $x$'class', (select ic.abc || case when coalesce((app.abc_cfg(p_company) ->> 'xyz')::boolean, false) then ic.xyz else '' end
                                         from public.item_classes ic where ic.variant_id = v.id and ic.warehouse_id is null))$x$);

create or replace function public.stock_not_sold(p_company uuid, p_warehouse uuid default null, p_days int default 90,
                                                 p_since date default null, p_include_new boolean default false)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_from timestamptz := coalesce(p_since::timestamptz, now() - make_interval(days => greatest(coalesce(p_days, 90), 1)));
begin
  if not (app.has_permission(p_company, 'inventory.read') or app.has_permission(p_company, 'wms.read')) then
    raise exception 'Permission denied: inventory.read required' using errcode = '42501';
  end if;
  return (
    with st as (
      select sl.variant_id, sum(sl.on_hand) as on_hand, sum(sl.on_hand * coalesce(ic.avg_cost, 0)) as sv
        from public.stock_levels sl
        join public.warehouses w on w.id = sl.warehouse_id and w.warehouse_type <> 'transit'
        left join public.item_costs ic on ic.variant_id = sl.variant_id
       where sl.company_id = p_company and (p_warehouse is null or sl.warehouse_id = p_warehouse)
       group by 1 having sum(sl.on_hand) > 0),
    outs as (
      select m.variant_id, max(m.movement_date) as last_sold
        from public.stock_movements m
       where m.company_id = p_company and m.movement_type in ('pos_sale', 'delivery', 'production_consume')
         and (p_warehouse is null or m.from_warehouse_id = p_warehouse)
       group by 1),
    ins as (
      select m.variant_id, min(m.movement_date) as first_in
        from public.stock_movements m
       where m.company_id = p_company and m.to_warehouse_id is not null
         and m.movement_type in ('receipt', 'opening', 'adjustment_in', 'transfer', 'production_output', 'sales_return', 'pos_return')
         and (p_warehouse is null or m.to_warehouse_id = p_warehouse)
       group by 1),
    r as (
      select st.variant_id, st.on_hand, st.sv, o.last_sold, i.first_in
        from st left join outs o on o.variant_id = st.variant_id left join ins i on i.variant_id = st.variant_id
       where (o.last_sold is null or o.last_sold < v_from)
         and (p_include_new or i.first_in is null or i.first_in < v_from)),
    x as (
      select r.*, v.sku, v.name, v.product_id
        from r join public.product_variants v on v.id = r.variant_id
        join public.products p on p.id = v.product_id and p.product_type = 'stockable'
       order by r.sv desc limit 2000)
    select jsonb_build_object('from', v_from,
             'items', (select count(*) from r join public.product_variants v on v.id = r.variant_id join public.products p on p.id = v.product_id and p.product_type = 'stockable'),
             'stock_value', coalesce((select round(sum(r.sv), 2) from r join public.product_variants v on v.id = r.variant_id join public.products p on p.id = v.product_id and p.product_type = 'stockable'), 0),
             'rows', coalesce((select jsonb_agg(jsonb_build_object('variant_id', x.variant_id, 'sku', x.sku, 'name', x.name, 'product_id', x.product_id,
                                                                   'on_hand', x.on_hand, 'stock_value', round(x.sv, 2), 'last_sold', x.last_sold, 'first_in', x.first_in)
                                                order by x.sv desc) from x), '[]'::jsonb)));
end $$;
revoke execute on function public.stock_not_sold(uuid, uuid, int, date, boolean) from public, anon;
grant execute on function public.stock_not_sold(uuid, uuid, int, date, boolean) to authenticated;

drop function app._patch_function(text, text, text);
