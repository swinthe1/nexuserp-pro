-- =============================================================================
-- #27 again, as it was meant: fruit and vegetables (and anything else that goes off) are thrown away
-- when they spoil on the shelf. Each throw-away is recorded on the Zebra (weighed), it leaves the stock,
-- and the director sees how much is thrown away, in quantity and in value, as a share of what was sold
-- (or of what came in), for the days, stores, groups and items chosen.
--   groups that go off   a group is marked "goes off" (fruit and vegetables are marked by their name);
--                        the report and the Zebra start from those groups
--   the Zebra            finds the item by its scale PLU or by the scale's label (with the weight in it),
--                        and lists the fresh items of the store to tap when there is no label at all
--   the report           by group, by item, by store or by day: sold, came in, thrown away (quantity,
--                        kilograms, value at cost and at the selling price) and the % in quantity and value
-- =============================================================================

alter table public.product_categories add column if not exists perishable boolean not null default false;
update public.product_categories set perishable = true
 where deleted_at is null and (name ~* '(frut|perim|pem[eë]|zarzavat|fruit|vegetab|voće|povrć)');

-- ---------------------------------------------------------------- the Zebra: the scale's PLU and label
create or replace function public.find_variant_by_code(p_company uuid, p_code text)
returns table (variant_id uuid, product_id uuid, sku text, name text, units_per_scan numeric, sales_price numeric, sales_tax_code_id uuid, tracking text, matched_by text)
language sql stable set search_path = '' as $$
  select v.id, v.product_id, v.sku, v.name, b.quantity, coalesce(v.sales_price_override, p.sales_price),
         p.sales_tax_code_id, p.tracking, 'barcode'
    from public.product_barcodes b
    join public.product_variants v on v.id = b.variant_id and v.deleted_at is null and v.is_active
    join public.products p on p.id = v.product_id and p.deleted_at is null
   where b.company_id = p_company and b.barcode = btrim(p_code) and b.deleted_at is null
  union all
  select v.id, v.product_id, v.sku, v.name, 1, coalesce(v.sales_price_override, p.sales_price),
         p.sales_tax_code_id, p.tracking, 'sku'
    from public.product_variants v
    join public.products p on p.id = v.product_id and p.deleted_at is null
   where v.company_id = p_company and upper(v.sku) = upper(btrim(p_code)) and v.deleted_at is null and v.is_active
  union all
  select distinct on (v.id) v.id, v.product_id, v.sku, v.name, 1, coalesce(v.sales_price_override, p.sales_price),
         p.sales_tax_code_id, p.tracking, 'vendor_code'
    from public.vendor_products vp
    join public.product_variants v on v.id = vp.variant_id and v.deleted_at is null and v.is_active
    join public.products p on p.id = v.product_id and p.deleted_at is null
   where vp.company_id = p_company and upper(vp.vendor_sku) = upper(btrim(p_code)) and vp.deleted_at is null
  union all
  -- the PLU typed by hand (the number the scale knows the item by)
  select v.id, v.product_id, v.sku, v.name, 1, coalesce(v.sales_price_override, p.sales_price), p.sales_tax_code_id, p.tracking, 'plu'
    from public.products p
    join public.product_variants v on v.product_id = p.id and v.deleted_at is null and v.is_active
   where p.company_id = p_company and p.deleted_at is null and p.scale_plu is not null
     and btrim(p_code) ~ '^[0-9]{1,6}$' and ltrim(p.scale_plu, '0') = ltrim(btrim(p_code), '0')
  union all
  -- the scale's label: prefix, PLU, then the weight (or the price) inside the barcode
  select v.id, v.product_id, v.sku, v.name,
         case when s.cfg ->> 'value' = 'price'
              then round(substr(btrim(p_code), length(s.pre) + s.n + 1, 12 - length(s.pre) - s.n)::numeric / 100
                         / nullif(coalesce(v.sales_price_override, p.sales_price) * (1 + coalesce(t.rate, 0) / 100), 0), 3)
              else substr(btrim(p_code), length(s.pre) + s.n + 1, 12 - length(s.pre) - s.n)::numeric / 1000 end,
         coalesce(v.sales_price_override, p.sales_price), p.sales_tax_code_id, p.tracking, 'scale'
    from (select cs.scale_barcode as cfg, pre.pre, least(greatest(coalesce((cs.scale_barcode ->> 'plu_digits')::int, 5), 3), 6) as n
            from public.company_settings cs
            cross join lateral jsonb_array_elements_text(coalesce(cs.scale_barcode -> 'prefixes', '["21","22","23","24","25","26","27","28","29"]'::jsonb)) as pre(pre)
           where cs.company_id = p_company and coalesce((cs.scale_barcode ->> 'on')::boolean, true)
             and btrim(p_code) ~ '^[0-9]{13}$' and btrim(p_code) like pre.pre || '%') s
    join public.products p on p.company_id = p_company and p.deleted_at is null and p.scale_plu is not null
                          and ltrim(p.scale_plu, '0') = ltrim(substr(btrim(p_code), length(s.pre) + 1, s.n), '0')
    join public.product_variants v on v.product_id = p.id and v.deleted_at is null and v.is_active
    left join public.tax_codes t on t.id = p.sales_tax_code_id
  limit 5
$$;

-- the fresh items a store has, to tap on the Zebra when they carry no label
create or replace function public.waste_items(p_company uuid, p_warehouse uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.has_permission(p_company, 'wms.read') or app.has_permission(p_company, 'inventory.read')) then
    raise exception 'Permission denied: inventory.read required' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('variant_id', v.id, 'sku', v.sku, 'name', v.name, 'uom', u.code, 'plu', nullif(ltrim(p.scale_plu, '0'), ''),
           'on_hand', coalesce((select sum(sl.on_hand) from public.stock_levels sl where sl.variant_id = v.id and sl.warehouse_id = p_warehouse), 0)) order by v.name)
      from public.products p
      join public.product_categories c on c.id = p.category_id and c.perishable
      join public.product_variants v on v.product_id = p.id and v.is_active and v.deleted_at is null
      left join public.units_of_measure u on u.id = p.uom_id
     where p.company_id = p_company and p.deleted_at is null and p.is_active and p.product_type = 'stockable'), '[]'::jsonb);
end $$;
revoke execute on function public.waste_items(uuid, uuid) from public, anon;
grant execute on function public.waste_items(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- the report
-- p: from, to, by (group | item | unit | day), units[], groups[] (empty + fresh_only: the groups that go off),
--    items[], reasons[] (default waste, damage, expiry), fresh_only (default true)
create or replace function public.waste_report(p_company uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_from date := coalesce((p ->> 'from')::date, date_trunc('month', current_date)::date);
  v_to date := coalesce((p ->> 'to')::date, current_date);
  v_by text := coalesce(nullif(p ->> 'by', ''), 'group');
  v_units uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'units', '[]'))::uuid);
  v_groups uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'groups', '[]'))::uuid);
  v_items uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'items', '[]'))::uuid);
  v_reasons text[] := coalesce(nullif(array(select jsonb_array_elements_text(coalesce(p -> 'reasons', '[]'))), '{}'), array['waste', 'damage', 'expiry']);
  v_fresh boolean := coalesce((p ->> 'fresh_only')::boolean, true);
  v_rows jsonb; v_tot jsonb;
begin
  perform app.require_permission(p_company, 'inventory.read');
  if v_by not in ('group', 'item', 'unit', 'day') then raise exception 'Cannot group by %', v_by using errcode = '22023'; end if;
  if v_to < v_from or v_to - v_from > 1100 then raise exception 'Check the dates' using errcode = '22023'; end if;

  create temporary table if not exists _wr (variant_id uuid, unit uuid, d date, sold_qty numeric, sold_net numeric, in_qty numeric, in_cost numeric,
                                            waste_qty numeric, waste_cost numeric, internal boolean) on commit drop;
  truncate _wr;
  -- sold (the till and the invoices, returns taken off)
  insert into _wr
  select f.variant_id, f.warehouse_id, f.d, sum(f.qty), sum(f.net), 0, 0, 0, 0, false
    from app.analysis_sales(p_company, v_from, v_to) f
   where cardinality(v_units) = 0 or f.warehouse_id = any (v_units)
   group by 1, 2, 3;
  -- came in: bought, made, brought from another store. A transfer between two of the stores looked at is
  -- the store's own goods (shown store by store, never added twice in the totals)
  insert into _wr
  select m.variant_id, m.to_warehouse_id, m.movement_date::date, 0, 0, sum(m.quantity), sum(m.total_cost), 0, 0,
         m.movement_type = 'transfer' and (cardinality(v_units) = 0 or m.from_warehouse_id = any (v_units))
    from public.stock_movements m
   where m.company_id = p_company and m.movement_type in ('receipt', 'production_output', 'transfer')
     and m.to_warehouse_id is not null and m.reversed_movement_id is null
     and m.movement_date >= v_from::timestamp and m.movement_date < (v_to + 1)::timestamp
     and (cardinality(v_units) = 0 or m.to_warehouse_id = any (v_units))
     and not (m.movement_type = 'transfer' and (m.from_warehouse_id is null or m.from_warehouse_id = m.to_warehouse_id))
   group by 1, 2, 3, 10;
  -- thrown away
  insert into _wr
  select al.variant_id, a.warehouse_id, a.adjustment_date, 0, 0, 0, 0, sum(-al.quantity_change),
         sum(coalesce((select sum(m.total_cost) from public.stock_movements m where m.source_doc_type = 'stock_adjustment' and m.source_doc_id = a.id and m.source_line_id = al.id),
                      -al.quantity_change * coalesce((select avg_cost from public.item_costs where variant_id = al.variant_id), 0))), false
    from public.stock_adjustments a join public.stock_adjustment_lines al on al.adjustment_id = a.id and al.quantity_change < 0
   where a.company_id = p_company and a.status = 'posted' and a.deleted_at is null and a.reason = any (v_reasons)
     and a.adjustment_date between v_from and v_to and (cardinality(v_units) = 0 or a.warehouse_id = any (v_units))
   group by 1, 2, 3;

  with ip as (select * from app.item_prices(p_company)),
  j as (
    select w.*, ip.group_id, ip.uom, ip.sale_net,
           -- kilograms: sold by the kilogram, by the gram, or a piece of known weight
           case when lower(ip.uom) in ('kg', 'kgm') then 1 when lower(ip.uom) in ('g', 'gr', 'grm') then 0.001
                else nullif(pr.weight_kg, 0) end as kg
      from _wr w join ip on ip.variant_id = w.variant_id
      join public.product_variants pv on pv.id = w.variant_id join public.products pr on pr.id = pv.product_id
      left join public.product_categories c on c.id = pr.category_id
      left join public.product_categories cp on cp.id = c.parent_id
     where (cardinality(v_items) = 0 or w.variant_id = any (v_items))
       and (case when cardinality(v_groups) > 0 then ip.group_id = any (v_groups) or ip.category_id = any (v_groups)
                 when v_fresh then coalesce(c.perishable, false) or coalesce(cp.perishable, false) else true end)),
  g as (
    select case v_by when 'item' then variant_id::text when 'unit' then unit::text when 'day' then d::text else coalesce(group_id::text, 'none') end as key,
           sum(sold_qty) as sold_qty, sum(sold_net) as sold_net,
           sum(in_qty) filter (where not internal or v_by = 'unit') as in_qty, sum(in_cost) filter (where not internal or v_by = 'unit') as in_cost,
           sum(waste_qty) as waste_qty, sum(waste_cost) as waste_cost, sum(waste_qty * sale_net) as waste_sale,
           sum(sold_qty * kg) as sold_kg, sum(in_qty * kg) filter (where not internal or v_by = 'unit') as in_kg, sum(waste_qty * kg) as waste_kg,
           bool_and(kg is not null) filter (where sold_qty <> 0 or waste_qty <> 0 or in_qty <> 0) as all_kg, min(uom) as uom
      from j group by 1
     having sum(waste_qty) <> 0 or sum(sold_qty) <> 0 or sum(in_qty) <> 0),
  r as (
    select g.*,
           -- the quantity: kilograms when every item has them, else the item's own unit (one item)
           case when coalesce(all_kg, false) then waste_kg else waste_qty end as wq,
           case when coalesce(all_kg, false) then sold_kg else sold_qty end as sq,
           case when coalesce(all_kg, false) then in_kg else in_qty end as iq
      from g)
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', r.key,
           'label', case v_by when 'item' then (select name from public.product_variants where id::text = r.key)
                              when 'unit' then (select name from public.warehouses where id::text = r.key)
                              when 'day' then r.key
                              else (select name from public.product_categories where id::text = r.key) end,
           'code', case when v_by = 'item' then (select sku from public.product_variants where id::text = r.key) end,
           'unit_of_qty', case when coalesce(r.all_kg, false) then 'kg' when v_by = 'item' then r.uom end,
           'sold_qty', round(r.sq, 3), 'sold_net', round(r.sold_net, 2), 'in_qty', round(r.iq, 3), 'in_cost', round(r.in_cost, 2),
           'waste_qty', round(r.wq, 3), 'waste_cost', round(r.waste_cost, 2), 'waste_sale', round(r.waste_sale, 2),
           'pct_qty_sold', round(100 * r.wq / nullif(r.sq, 0), 2), 'pct_value_sold', round(100 * r.waste_sale / nullif(r.sold_net, 0), 2),
           'pct_qty_in', round(100 * r.wq / nullif(r.iq, 0), 2), 'pct_value_in', round(100 * r.waste_cost / nullif(r.in_cost, 0), 2),
           'comparable', coalesce(r.all_kg, false) or v_by = 'item')
         order by case when v_by = 'day' then r.key end, r.waste_sale desc nulls last), '[]'::jsonb),
         (select jsonb_build_object('sold_net', round(sum(t.sold_net), 2), 'in_cost', round(sum(t.in_cost), 2), 'waste_cost', round(sum(t.waste_cost), 2),
           'waste_sale', round(sum(t.waste_sale), 2), 'sold_kg', round(sum(t.sold_kg), 3), 'in_kg', round(sum(t.in_kg), 3), 'waste_kg', round(sum(t.waste_kg), 3),
           'pct_qty_sold', round(100 * sum(t.waste_kg) / nullif(sum(t.sold_kg), 0), 2), 'pct_value_sold', round(100 * sum(t.waste_sale) / nullif(sum(t.sold_net), 0), 2),
           'pct_qty_in', round(100 * sum(t.waste_kg) / nullif(sum(t.in_kg), 0), 2), 'pct_value_in', round(100 * sum(t.waste_cost) / nullif(sum(t.in_cost), 0), 2))
            -- the totals in kilograms (what has no weight is left out of the quantity); a transfer between the stores counts once
            from (select sum(sold_net) as sold_net, sum(in_cost) filter (where not internal) as in_cost, sum(waste_cost) as waste_cost,
                         sum(waste_qty * sale_net) as waste_sale, sum(sold_qty * kg) as sold_kg, sum(in_qty * kg) filter (where not internal) as in_kg,
                         sum(waste_qty * kg) as waste_kg from j) t)
    into v_rows, v_tot from r;
  return jsonb_build_object('rows', v_rows, 'totals', v_tot, 'currency', (select base_currency from public.companies where id = p_company),
    'reasons', to_jsonb(v_reasons), 'fresh_groups', (select coalesce(jsonb_agg(id), '[]'::jsonb) from public.product_categories where company_id = p_company and perishable and deleted_at is null));
end $$;
revoke execute on function public.waste_report(uuid, jsonb) from public, anon;
grant execute on function public.waste_report(uuid, jsonb) to authenticated;
