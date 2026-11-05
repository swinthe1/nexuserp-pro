-- =============================================================================
-- From the meeting with the administrative staff:
--   #25 every stock output (thrown away, damaged, expired, used inside the company, lost, stolen)
--       with its description and its value at cost and at the selling price, with and without VAT;
--       outputs never touch the sales margin
--   #27 fruit and vegetables thrown away, weighed on the Zebra: as a share of the sales of the same
--       group or item, by value and by weight
-- =============================================================================

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- two more reasons: thrown away (fruit, bread…) and used inside the company (cleaning, the staff's kitchen)
alter table public.stock_adjustments drop constraint if exists stock_adjustments_reason_check;
alter table public.stock_adjustments add constraint stock_adjustments_reason_check
  check (reason in ('opening', 'correction', 'damage', 'loss', 'theft', 'found', 'expiry', 'count', 'waste', 'internal_use'));
-- what is thrown away goes to the scrap location, like damaged and expired goods
select app._patch_function('public.post_stock_adjustment',
  $x$v_scrapping := a.reason in ('damage','expiry');$x$,
  $x$v_scrapping := a.reason in ('damage','expiry','waste');$x$);

-- the unit price of an item without VAT, its sales and purchase VAT rates
create or replace function app.item_prices(p_company uuid)
returns table (variant_id uuid, sale_net numeric, sale_rate numeric, buy_rate numeric, uom text, category_id uuid, group_id uuid)
language sql stable security definer set search_path = '' as $$
  select v.id, coalesce(v.sales_price_override, p.sales_price, 0), coalesce(ts.rate, 0), coalesce(tb.rate, ts.rate, 0), u.code,
         p.category_id, coalesce(c.parent_id, c.id)
    from public.product_variants v join public.products p on p.id = v.product_id
    left join public.tax_codes ts on ts.id = p.sales_tax_code_id
    left join public.tax_codes tb on tb.id = p.purchase_tax_code_id
    left join public.units_of_measure u on u.id = p.uom_id
    left join public.product_categories c on c.id = p.category_id
   where v.company_id = p_company
$$;
revoke execute on function app.item_prices(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 25. every output, line by line
-- p: from, to, units[], reasons[] (default: every output reason)
create or replace function public.stock_outputs(p_company uuid, p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_from date := coalesce((p ->> 'from')::date, date_trunc('month', current_date)::date);
  v_to date := coalesce((p ->> 'to')::date, current_date);
  v_units uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'units', '[]'))::uuid);
  v_reasons text[] := array(select jsonb_array_elements_text(coalesce(p -> 'reasons', '[]')));
begin
  perform app.require_permission(p_company, 'inventory.read');
  if v_to < v_from or v_to - v_from > 1100 then raise exception 'Check the dates' using errcode = '22023'; end if;
  return jsonb_build_object('currency', (select base_currency from public.companies where id = p_company), 'rows', coalesce((
    select jsonb_agg(jsonb_build_object(
             'adjustment_id', a.id, 'number', a.number, 'date', a.adjustment_date, 'reason', a.reason, 'status', a.status,
             'description', nullif(concat_ws(' · ', nullif(btrim(a.notes), ''), nullif(btrim(al.notes), '')), ''),
             'warehouse_id', a.warehouse_id, 'warehouse', w.name, 'variant_id', v.id, 'sku', v.sku, 'name', v.name, 'uom', ip.uom,
             'group_id', ip.group_id, 'category_id', ip.category_id,
             'quantity', -al.quantity_change,
             'cost_net', round(coalesce(mv.total_cost, -al.quantity_change * coalesce(ic.avg_cost, 0)), 2),
             'cost_gross', round(coalesce(mv.total_cost, -al.quantity_change * coalesce(ic.avg_cost, 0)) * (1 + ip.buy_rate / 100), 2),
             'sale_net', round(-al.quantity_change * ip.sale_net, 2),
             'sale_gross', round(-al.quantity_change * ip.sale_net * (1 + ip.sale_rate / 100), 2),
             'by', app.person_name(a.created_by))
           order by a.adjustment_date desc, a.number desc, v.name)
      from public.stock_adjustments a
      join public.stock_adjustment_lines al on al.adjustment_id = a.id and al.quantity_change < 0
      join public.product_variants v on v.id = al.variant_id
      join public.warehouses w on w.id = a.warehouse_id
      join app.item_prices(p_company) ip on ip.variant_id = v.id
      left join public.item_costs ic on ic.variant_id = v.id
      left join lateral (select sum(m.total_cost) as total_cost from public.stock_movements m
                          where m.source_doc_type = 'stock_adjustment' and m.source_doc_id = a.id and m.source_line_id = al.id) mv on true
     where a.company_id = p_company and a.deleted_at is null and a.status in ('draft', 'approved', 'posted')
       and a.reason not in ('opening', 'found') and a.adjustment_date between v_from and v_to
       and (cardinality(v_units) = 0 or a.warehouse_id = any (v_units))
       and (cardinality(v_reasons) = 0 or a.reason = any (v_reasons))), '[]'::jsonb));
end $$;
revoke execute on function public.stock_outputs(uuid, jsonb) from public, anon;
grant execute on function public.stock_outputs(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- 27. thrown away against the sales
-- p: from, to, by (group | item), units[], groups[], reasons[] (default waste, damage, expiry)
create or replace function public.waste_vs_sales(p_company uuid, p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_from date := coalesce((p ->> 'from')::date, date_trunc('month', current_date)::date);
  v_to date := coalesce((p ->> 'to')::date, current_date);
  v_by text := coalesce(nullif(p ->> 'by', ''), 'group');
  v_units uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'units', '[]'))::uuid);
  v_groups uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'groups', '[]'))::uuid);
  v_reasons text[] := coalesce(nullif(array(select jsonb_array_elements_text(coalesce(p -> 'reasons', '[]'))), '{}'), array['waste', 'damage', 'expiry']);
  v_rows jsonb;
begin
  perform app.require_permission(p_company, 'inventory.read');
  if v_by not in ('group', 'item') then raise exception 'Cannot group by %', v_by using errcode = '22023'; end if;
  if v_to < v_from or v_to - v_from > 1100 then raise exception 'Check the dates' using errcode = '22023'; end if;

  with ip as (select * from app.item_prices(p_company)),
  s as (
    select f.variant_id, sum(f.qty) as qty, sum(f.net) as net
      from app.analysis_sales(p_company, v_from, v_to) f
     where cardinality(v_units) = 0 or f.warehouse_id = any (v_units)
     group by f.variant_id),
  w as (
    select al.variant_id, sum(-al.quantity_change) as qty,
           sum(coalesce((select sum(m.total_cost) from public.stock_movements m where m.source_doc_type = 'stock_adjustment' and m.source_doc_id = a.id and m.source_line_id = al.id),
                        -al.quantity_change * coalesce((select avg_cost from public.item_costs where variant_id = al.variant_id), 0))) as cost
      from public.stock_adjustments a join public.stock_adjustment_lines al on al.adjustment_id = a.id and al.quantity_change < 0
     where a.company_id = p_company and a.status = 'posted' and a.deleted_at is null and a.reason = any (v_reasons)
       and a.adjustment_date between v_from and v_to and (cardinality(v_units) = 0 or a.warehouse_id = any (v_units))
     group by al.variant_id),
  j as (
    select coalesce(s.variant_id, w.variant_id) as variant_id, coalesce(s.qty, 0) as sold_qty, coalesce(s.net, 0) as sold_net,
           coalesce(w.qty, 0) as waste_qty, coalesce(w.cost, 0) as waste_cost, coalesce(w.qty, 0) * ip.sale_net as waste_sale,
           ip.group_id, ip.uom
      from s full join w on w.variant_id = s.variant_id
      join ip on ip.variant_id = coalesce(s.variant_id, w.variant_id)
     where cardinality(v_groups) = 0 or ip.group_id = any (v_groups) or ip.category_id = any (v_groups)),
  g as (
    select case when v_by = 'item' then variant_id::text else coalesce(group_id::text, 'none') end as key,
           sum(sold_qty) as sold_qty, sum(sold_net) as sold_net, sum(waste_qty) as waste_qty, sum(waste_cost) as waste_cost, sum(waste_sale) as waste_sale,
           -- weight: only what is sold by the kilogram adds up as kilograms
           sum(sold_qty) filter (where lower(uom) in ('kg', 'kgm')) as sold_kg, sum(waste_qty) filter (where lower(uom) in ('kg', 'kgm')) as waste_kg,
           min(uom) as uom
      from j group by 1 having sum(waste_qty) <> 0 or sum(sold_net) <> 0)
  select jsonb_agg(jsonb_build_object(
           'key', g.key,
           'label', case when v_by = 'item' then (select name from public.product_variants where id::text = g.key)
                         when g.key = 'none' then null else (select name from public.product_categories where id::text = g.key) end,
           'code', case when v_by = 'item' then (select sku from public.product_variants where id::text = g.key) end,
           'uom', case when v_by = 'item' then g.uom end,
           'sold_qty', round(g.sold_qty, 3), 'sold_net', round(g.sold_net, 2), 'sold_kg', round(g.sold_kg, 3),
           'waste_qty', round(g.waste_qty, 3), 'waste_kg', round(g.waste_kg, 3), 'waste_cost', round(g.waste_cost, 2), 'waste_sale', round(g.waste_sale, 2),
           'pct_value', round(100 * g.waste_sale / nullif(g.sold_net, 0), 2),
           'pct_weight', round(100 * g.waste_kg / nullif(g.sold_kg, 0), 2))
         order by g.waste_sale desc nulls last)
    into v_rows from g;
  return jsonb_build_object('rows', coalesce(v_rows, '[]'::jsonb), 'currency', (select base_currency from public.companies where id = p_company), 'reasons', to_jsonb(v_reasons));
end $$;
revoke execute on function public.waste_vs_sales(uuid, jsonb) from public, anon;
grant execute on function public.waste_vs_sales(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- 27. thrown away, from the Zebra
-- p: company_id, warehouse_id, reason (waste | damage | expiry | internal_use), note, lines: [{variant_id, lot_id, quantity}]
-- one adjustment for the batch; posted at once by the stock manager, otherwise it waits for them
create or replace function public.waste_submit(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_co uuid := (p ->> 'company_id')::uuid; v_wh uuid := (p ->> 'warehouse_id')::uuid; v_reason text := coalesce(nullif(p ->> 'reason', ''), 'waste');
  v_adj uuid; v_status text; l jsonb; x record; v_var uuid; v_lot uuid; v_qty numeric; v_left numeric; v_take numeric; v_n int := 0; v_name text;
begin
  if v_co is null or not app.expiry_can(v_co, 'propose') then raise exception 'Permission denied: you may not take stock off the shelf' using errcode = '42501'; end if;
  if v_reason not in ('waste', 'damage', 'expiry', 'internal_use') then raise exception 'Choose why the goods go out' using errcode = '22023'; end if;
  if not exists (select 1 from public.warehouses where id = v_wh and company_id = v_co and deleted_at is null) then raise exception 'Choose the store' using errcode = '23514'; end if;
  if jsonb_typeof(p -> 'lines') <> 'array' or jsonb_array_length(p -> 'lines') = 0 then raise exception 'Scan what is thrown away' using errcode = '23514'; end if;

  insert into public.stock_adjustments (company_id, warehouse_id, adjustment_date, reason, notes)
  values (v_co, v_wh, (now() at time zone coalesce((select timezone from public.companies where id = v_co), 'Europe/Tirane'))::date, v_reason,
          left(nullif(btrim(p ->> 'note'), ''), 200))
  returning id into v_adj;

  for l in select * from jsonb_array_elements(p -> 'lines') loop
    v_var := (l ->> 'variant_id')::uuid; v_lot := nullif(l ->> 'lot_id', '')::uuid; v_qty := (l ->> 'quantity')::numeric;
    select name into v_name from public.product_variants where id = v_var and company_id = v_co;
    if v_name is null then raise exception 'Item not found' using errcode = 'P0002'; end if;
    if coalesce(v_qty, 0) <= 0 then raise exception 'Enter how much of % is thrown away', v_name using errcode = '23514'; end if;
    v_left := v_qty;
    for x in select sl.location_id, sl.on_hand from public.stock_levels sl
              where sl.company_id = v_co and sl.warehouse_id = v_wh and sl.variant_id = v_var and sl.on_hand > 0 and (v_lot is null or sl.lot_id = v_lot)
              order by sl.on_hand desc loop
      exit when v_left <= 0;
      v_take := least(v_left, x.on_hand);
      insert into public.stock_adjustment_lines (company_id, adjustment_id, variant_id, location_id, lot_id, quantity_change, notes)
      values (v_co, v_adj, v_var, x.location_id, v_lot, -v_take, left(nullif(btrim(l ->> 'note'), ''), 200));
      v_left := v_left - v_take;
    end loop;
    if v_left > 0 then
      raise exception 'Only % of % in stock here', trim(to_char(v_qty - v_left, 'FM999G999G990D###')), v_name using errcode = '23514';
    end if;
    v_n := v_n + 1;
  end loop;

  if app.has_permission(v_co, 'inventory.write') then
    v_status := public.post_stock_adjustment(v_adj);
  else
    v_status := 'draft';
    perform app.notify_permission(v_co, 'inventory.write', 'approval',
      'Goods thrown away to confirm: ' || (select number from public.stock_adjustments where id = v_adj),
      v_n || ' · ' || (select name from public.warehouses where id = v_wh), '/inventory/adjustments/' || v_adj);
  end if;
  return jsonb_build_object('adjustment_id', v_adj, 'number', (select number from public.stock_adjustments where id = v_adj), 'status', v_status, 'lines', v_n);
end $$;
revoke execute on function public.waste_submit(jsonb) from public, anon;
grant execute on function public.waste_submit(jsonb) to authenticated;

drop function app._patch_function(text, text, text);
