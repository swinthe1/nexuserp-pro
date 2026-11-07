-- =============================================================================
-- "Raporti i stokut", phase 2: the stock over a period (opening, what came in and went out by kind, closing),
-- the stock that is free to sell (reserved, ordered from suppliers, on the road), the goods that do not move
-- (fast, slow, dead, new) and how many days the stock lasts at the pace of the sales.
-- =============================================================================

-- the items a stock report is about: its filters on the item (groups, producers, brands, suppliers, items, VAT, kind, active)
create or replace function app.stock_report_items(p_company uuid, p jsonb)
returns table (variant_id uuid, sku text, item text, category text, grp text, producer text, brand text, uom text, vat_rate numeric,
               product_type text, active boolean, barcode text)
language sql stable security definer set search_path = '' as $$
  select v.id, v.sku, coalesce(nullif(v.name, ''), pr.name), c.name, coalesce(pc.name, c.name), pr.manufacturer, pr.brand, u.code,
         coalesce(tc.rate, 0), pr.product_type, pr.is_active and v.is_active,
         (select b.barcode from public.product_barcodes b where b.variant_id = v.id and b.deleted_at is null order by b.is_primary desc, b.created_at limit 1)
    from public.product_variants v
    join public.products pr on pr.id = v.product_id
    left join public.product_categories c on c.id = pr.category_id
    left join public.product_categories pc on pc.id = c.parent_id
    left join public.units_of_measure u on u.id = pr.uom_id
    left join public.tax_codes tc on tc.id = pr.sales_tax_code_id
   where v.company_id = p_company and v.deleted_at is null and pr.deleted_at is null and pr.product_type <> 'service'
     and (cardinality(app.detail_ids(p, 'items')) = 0 or v.id = any (app.detail_ids(p, 'items')))
     and (cardinality(app.detail_ids(p, 'categories')) = 0 or pr.category_id = any (app.detail_ids(p, 'categories')) or c.parent_id = any (app.detail_ids(p, 'categories')))
     and (cardinality(app.detail_texts(p, 'producers')) = 0 or coalesce(pr.manufacturer, '') = any (app.detail_texts(p, 'producers')))
     and (cardinality(app.detail_texts(p, 'brands')) = 0 or coalesce(pr.brand, '') = any (app.detail_texts(p, 'brands')))
     and (cardinality(app.detail_nums(p, 'vat_rates')) = 0 or coalesce(tc.rate, 0) = any (app.detail_nums(p, 'vat_rates')))
     and (cardinality(app.detail_texts(p, 'types')) = 0 or pr.product_type = any (app.detail_texts(p, 'types')))
     and (coalesce(nullif(p ->> 'active', ''), 'active') = 'all' or (coalesce(nullif(p ->> 'active', ''), 'active') = 'active') = (pr.is_active and v.is_active))
     and (cardinality(app.detail_ids(p, 'vendors')) = 0
          or exists (select 1 from public.goods_receipt_lines gl join public.goods_receipts g on g.id = gl.receipt_id
                      where gl.variant_id = v.id and g.status = 'done' and g.deleted_at is null and g.vendor_id = any (app.detail_ids(p, 'vendors')))
          or exists (select 1 from public.replenishment_rules rr where rr.variant_id = v.id and rr.deleted_at is null and rr.preferred_vendor_id = any (app.detail_ids(p, 'vendors'))))
$$;
revoke execute on function app.stock_report_items(uuid, jsonb) from public, anon, authenticated;

-- p: report (movement · availability · slow · cover), from, to (movement), as_of (slow, cover), units[], split, the item filters,
--    days (the sales looked at: 30 · 60 · 90 …), slow_days, dead_days, target_days (cover: the days an order should last), classes[] (slow),
--    stock (nonzero · positive · all · negative · zero · below_min), limit
create or replace function public.stock_analysis(p_company uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_report text := coalesce(nullif(p ->> 'report', ''), 'movement');
  v_tz text := coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane');
  v_today date := (now() at time zone coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane'))::date;
  v_to date; v_from date;
  v_units uuid[] := app.detail_units(p_company, p);
  v_restricted boolean := public.my_warehouse_access(p_company) is not null;
  v_split boolean := coalesce((p ->> 'split')::boolean, false);
  v_days int := least(greatest(coalesce(nullif(p ->> 'days', '')::int, 90), 7), 730);
  v_slow int := greatest(coalesce(nullif(p ->> 'slow_days', '')::int, 60), 1);
  v_dead int := greatest(coalesce(nullif(p ->> 'dead_days', '')::int, 180), 2);
  v_target int := least(greatest(coalesce(nullif(p ->> 'target_days', '')::int, 30), 1), 365);
  v_classes text[] := app.detail_texts(p, 'classes');
  v_stock text := coalesce(nullif(p ->> 'stock', ''), 'nonzero');
  v_limit int := least(coalesce((p ->> 'limit')::int, 20000), 50000);
  v_rows jsonb; v_count int;
begin
  perform app.require_permission(p_company, 'inventory.read');
  if v_report not in ('movement', 'availability', 'slow', 'cover') then raise exception 'Unknown report: %', v_report using errcode = '22023'; end if;
  if v_stock not in ('nonzero', 'positive', 'all', 'negative', 'zero', 'below_min') then raise exception 'Unknown stock filter: %', v_stock using errcode = '22023'; end if;
  v_to := least(coalesce(nullif(p ->> 'to', '')::date, nullif(p ->> 'as_of', '')::date, v_today), v_today);
  v_from := coalesce(nullif(p ->> 'from', '')::date, date_trunc('month', v_to)::date);
  if v_report = 'availability' then v_to := v_today; end if;
  if v_from > v_to then raise exception 'Check the dates' using errcode = '22023'; end if;
  if v_to - v_from > 1100 then raise exception 'At most three years at once' using errcode = '22023'; end if;
  if v_restricted and cardinality(v_units) = 0 then return jsonb_build_object('rows', '[]'::jsonb, 'count', 0, 'truncated', false); end if;

  create temp table if not exists pg_temp.sa_items (variant_id uuid primary key, sku text, item text, category text, grp text, producer text, brand text,
    uom text, vat_rate numeric, product_type text, active boolean, barcode text) on commit drop;
  truncate pg_temp.sa_items;
  insert into pg_temp.sa_items select * from app.stock_report_items(p_company, p);
  -- the stock at the end, per item (and unit)
  create temp table if not exists pg_temp.sa_rows (variant_id uuid, unit_id uuid, qty numeric default 0, value numeric default 0,
    o_qty numeric default 0, o_value numeric default 0, x jsonb default '{}') on commit drop;
  truncate pg_temp.sa_rows;
  insert into pg_temp.sa_rows (variant_id, unit_id, qty, value)
  select s.variant_id, case when v_split then s.warehouse_id end, sum(s.qty), sum(s.value)
    from app.stock_as_of(p_company, v_to) s join pg_temp.sa_items i on i.variant_id = s.variant_id
   where cardinality(v_units) = 0 or s.warehouse_id = any (v_units)
   group by 1, 2;

  if v_report = 'movement' then
    -- the opening stock, the day before
    update pg_temp.sa_rows r set o_qty = o.qty, o_value = o.value
      from (select s.variant_id, case when v_split then s.warehouse_id end as unit_id, sum(s.qty) as qty, sum(s.value) as value
              from app.stock_as_of(p_company, v_from - 1) s join pg_temp.sa_items i on i.variant_id = s.variant_id
             where cardinality(v_units) = 0 or s.warehouse_id = any (v_units) group by 1, 2) o
     where o.variant_id = r.variant_id and o.unit_id is not distinct from r.unit_id;
    insert into pg_temp.sa_rows (variant_id, unit_id, o_qty, o_value)
    select s.variant_id, case when v_split then s.warehouse_id end, sum(s.qty), sum(s.value)
      from app.stock_as_of(p_company, v_from - 1) s join pg_temp.sa_items i on i.variant_id = s.variant_id
     where (cardinality(v_units) = 0 or s.warehouse_id = any (v_units))
       and not exists (select 1 from pg_temp.sa_rows r where r.variant_id = s.variant_id and r.unit_id is not distinct from (case when v_split then s.warehouse_id end))
     group by 1, 2;
    -- each movement of the period, as it comes into and goes out of the units looked at; between two of them it is neither
    -- when they are counted together
    with legs as (
      select m.variant_id, m.to_warehouse_id as w, m.movement_type as kind, m.quantity as q, coalesce(m.total_cost, round(m.quantity * m.unit_cost, 2)) as v, 1 as dir,
             m.from_warehouse_id as other
        from public.stock_movements m join pg_temp.sa_items i on i.variant_id = m.variant_id
       where m.company_id = p_company and m.to_warehouse_id is not null and (m.movement_date at time zone v_tz)::date between v_from and v_to
      union all
      select m.variant_id, m.from_warehouse_id, m.movement_type, m.quantity, coalesce(m.total_cost, round(m.quantity * m.unit_cost, 2)), -1, m.to_warehouse_id
        from public.stock_movements m join pg_temp.sa_items i on i.variant_id = m.variant_id
       where m.company_id = p_company and m.from_warehouse_id is not null and (m.movement_date at time zone v_tz)::date between v_from and v_to),
    mine as (
      select l.*, case when v_split then l.w end as unit_id,
             case when l.kind = 'transfer' then 'transfer'
                  when l.kind in ('receipt', 'opening') and l.dir = 1 then 'purchase'
                  when l.kind = 'purchase_return' then 'purchase_return'
                  when l.kind in ('delivery', 'pos_sale') then 'sale'
                  when l.kind in ('sales_return', 'pos_return') then 'sale_return'
                  when l.kind in ('production_output', 'production_consume') then 'production'
                  when l.kind in ('scrap', 'adjustment_out') then 'loss'
                  when l.kind in ('landed_cost', 'revaluation') then 'revaluation'
                  else 'adjustment' end as grp
        from legs l
       where (cardinality(v_units) = 0 or l.w = any (v_units))
         and not (not v_split and l.other is not null and (cardinality(v_units) = 0 or l.other = any (v_units)))),
    sums as (
      select variant_id, unit_id, jsonb_object_agg(k, val) as x from (
        select variant_id, unit_id, grp || case when dir = 1 then '_in' else '_out' end as k, jsonb_build_object('q', sum(q), 'v', sum(v)) as val
          from mine group by variant_id, unit_id, grp, dir) z
       group by variant_id, unit_id)
    merge into pg_temp.sa_rows r using sums s on s.variant_id = r.variant_id and s.unit_id is not distinct from r.unit_id
      when matched then update set x = s.x
      when not matched then insert (variant_id, unit_id, x) values (s.variant_id, s.unit_id, s.x);
  end if;

  -- the items with nothing in stock, when they are asked for
  if v_report <> 'movement' and v_stock in ('all', 'zero', 'below_min') then
      insert into pg_temp.sa_rows (variant_id, unit_id)
      select i.variant_id, u.u from pg_temp.sa_items i
        cross join (select unnest(case when v_split then (case when cardinality(v_units) > 0 then v_units else array(
          select id from public.warehouses where company_id = p_company and deleted_at is null and is_active and warehouse_type <> 'transit') end) else array[null::uuid] end) as u) u
       where not exists (select 1 from pg_temp.sa_rows r where r.variant_id = i.variant_id and r.unit_id is not distinct from u.u);
  end if;

  -- the stock free to sell, now: reserved, ordered from suppliers, on the road to the unit
  if v_report = 'availability' then
    update pg_temp.sa_rows r set x = jsonb_build_object(
      'reserved', coalesce((select sum(sl.reserved) from public.stock_levels sl where sl.variant_id = r.variant_id
                             and (sl.warehouse_id = r.unit_id or (r.unit_id is null and (cardinality(v_units) = 0 or sl.warehouse_id = any (v_units))))), 0),
      'on_order', coalesce((select sum(ic.incoming_qty) from public.v_incoming_stock ic where ic.variant_id = r.variant_id and ic.company_id = p_company
                             and (ic.warehouse_id = r.unit_id or (r.unit_id is null and (cardinality(v_units) = 0 or ic.warehouse_id = any (v_units))))), 0),
      'next_expected', (select min(ic.next_expected_date) from public.v_incoming_stock ic where ic.variant_id = r.variant_id and ic.company_id = p_company
                             and (ic.warehouse_id = r.unit_id or (r.unit_id is null and (cardinality(v_units) = 0 or ic.warehouse_id = any (v_units))))),
      'in_transit', coalesce((select sum(greatest(coalesce(tl.quantity_done, tl.quantity) - coalesce(tl.quantity_received, 0), 0))
                               from public.stock_transfer_lines tl join public.stock_transfers tr on tr.id = tl.transfer_id
                              where tl.variant_id = r.variant_id and tr.company_id = p_company and tr.status = 'in_transit' and tr.deleted_at is null
                                and (tr.to_warehouse_id = r.unit_id or (r.unit_id is null and cardinality(v_units) > 0 and tr.to_warehouse_id = any (v_units)))), 0),
      'min_qty', (select sum(rr.min_qty) from public.replenishment_rules rr where rr.variant_id = r.variant_id and rr.is_active and rr.deleted_at is null
                    and (rr.warehouse_id = r.unit_id or (r.unit_id is null and (cardinality(v_units) = 0 or rr.warehouse_id = any (v_units))))),
      'max_qty', (select sum(rr.max_qty) from public.replenishment_rules rr where rr.variant_id = r.variant_id and rr.is_active and rr.deleted_at is null
                    and (rr.warehouse_id = r.unit_id or (r.unit_id is null and (cardinality(v_units) = 0 or rr.warehouse_id = any (v_units))))));
  end if;

  -- the sales of the last days (slow goods, cover)
  if v_report in ('slow', 'cover') then
    update pg_temp.sa_rows r set x = s.x from (
      select k.variant_id, k.unit_id, jsonb_build_object(
               'sold', coalesce(sum(case when m.movement_type in ('delivery', 'pos_sale') then m.quantity when m.movement_type in ('sales_return', 'pos_return') then -m.quantity end)
                                filter (where (m.movement_date at time zone v_tz)::date > v_to - v_days), 0),
               'sold_value', coalesce(sum(case when m.movement_type in ('delivery', 'pos_sale') then coalesce(m.total_cost, m.quantity * m.unit_cost)
                                               when m.movement_type in ('sales_return', 'pos_return') then -coalesce(m.total_cost, m.quantity * m.unit_cost) end)
                                filter (where (m.movement_date at time zone v_tz)::date > v_to - v_days), 0),
               'last_sale', max((m.movement_date at time zone v_tz)::date) filter (where m.movement_type in ('delivery', 'pos_sale')),
               'first_in', (select min((f.movement_date at time zone v_tz)::date) from public.stock_movements f
                             where f.company_id = p_company and f.variant_id = k.variant_id and f.to_warehouse_id is not null
                               and (f.movement_date at time zone v_tz)::date <= v_to
                               and (k.unit_id is null or f.to_warehouse_id = k.unit_id) and (cardinality(v_units) = 0 or f.to_warehouse_id = any (v_units))),
               'on_order', coalesce((select sum(ic.incoming_qty) from public.v_incoming_stock ic where ic.variant_id = k.variant_id and ic.company_id = p_company
                             and (ic.warehouse_id = k.unit_id or (k.unit_id is null and (cardinality(v_units) = 0 or ic.warehouse_id = any (v_units))))), 0)) as x
        from pg_temp.sa_rows k
        left join public.stock_movements m on m.company_id = p_company and m.variant_id = k.variant_id
             and m.movement_type in ('delivery', 'pos_sale', 'sales_return', 'pos_return') and (m.movement_date at time zone v_tz)::date <= v_to
             and (k.unit_id is null or m.from_warehouse_id = k.unit_id or m.to_warehouse_id = k.unit_id)
             and (cardinality(v_units) = 0 or m.from_warehouse_id = any (v_units) or m.to_warehouse_id = any (v_units))
       group by k.variant_id, k.unit_id) s
     where s.variant_id = r.variant_id and s.unit_id is not distinct from r.unit_id;
  end if;

  with r as (
    select k.*, i.sku, i.item, i.category, i.grp, i.producer, i.brand, i.uom, i.vat_rate, i.product_type, i.active, i.barcode, w.name as unit, w.code as unit_code,
           round(k.qty, 3) as q, round(k.value, 2) as val
      from pg_temp.sa_rows k join pg_temp.sa_items i on i.variant_id = k.variant_id left join public.warehouses w on w.id = k.unit_id),
  shaped as (
    select r.*,
      case v_report
        when 'movement' then jsonb_build_object(
          'opening_qty', round(o_qty, 3), 'opening_value', round(o_value, 2),
          'purchase_in', coalesce((x -> 'purchase_in' ->> 'q')::numeric, 0), 'purchase_return_out', coalesce((x -> 'purchase_return_out' ->> 'q')::numeric, 0),
          'transfer_in', coalesce((x -> 'transfer_in' ->> 'q')::numeric, 0), 'transfer_out', coalesce((x -> 'transfer_out' ->> 'q')::numeric, 0),
          'production_in', coalesce((x -> 'production_in' ->> 'q')::numeric, 0), 'production_out', coalesce((x -> 'production_out' ->> 'q')::numeric, 0),
          'sale_out', coalesce((x -> 'sale_out' ->> 'q')::numeric, 0), 'sale_return_in', coalesce((x -> 'sale_return_in' ->> 'q')::numeric, 0),
          'loss_out', coalesce((x -> 'loss_out' ->> 'q')::numeric, 0),
          'adjustment_in', coalesce((x -> 'adjustment_in' ->> 'q')::numeric, 0), 'adjustment_out', coalesce((x -> 'adjustment_out' ->> 'q')::numeric, 0),
          'in_qty', coalesce((select sum((e.value ->> 'q')::numeric) from jsonb_each(x) e where e.key like '%\_in' and e.key <> 'revaluation_in'), 0),
          'out_qty', coalesce((select sum((e.value ->> 'q')::numeric) from jsonb_each(x) e where e.key like '%\_out' and e.key <> 'revaluation_out'), 0),
          'in_value', round(coalesce((select sum((e.value ->> 'v')::numeric) from jsonb_each(x) e where e.key like '%\_in' and e.key <> 'revaluation_in'), 0), 2),
          'out_value', round(coalesce((select sum((e.value ->> 'v')::numeric) from jsonb_each(x) e where e.key like '%\_out' and e.key <> 'revaluation_out'), 0), 2),
          'revaluation', round(coalesce((x -> 'revaluation_in' ->> 'v')::numeric, 0) - coalesce((x -> 'revaluation_out' ->> 'v')::numeric, 0), 2))
        when 'availability' then jsonb_build_object(
          'reserved', round((x ->> 'reserved')::numeric, 3), 'available', round(qty - (x ->> 'reserved')::numeric, 3),
          'on_order', round((x ->> 'on_order')::numeric, 3), 'in_transit', round((x ->> 'in_transit')::numeric, 3),
          'projected', round(qty - (x ->> 'reserved')::numeric + (x ->> 'on_order')::numeric + (x ->> 'in_transit')::numeric, 3),
          'next_expected', x ->> 'next_expected', 'min_qty', (x ->> 'min_qty')::numeric, 'max_qty', (x ->> 'max_qty')::numeric,
          'to_order', case when (x ->> 'max_qty') is not null
                            and qty - (x ->> 'reserved')::numeric + (x ->> 'on_order')::numeric + (x ->> 'in_transit')::numeric <= (x ->> 'min_qty')::numeric
                           then round(greatest((x ->> 'max_qty')::numeric - (qty - (x ->> 'reserved')::numeric + (x ->> 'on_order')::numeric + (x ->> 'in_transit')::numeric), 0), 3) end)
        else (select jsonb_build_object(
          'sold', round(z.sold, 3), 'sold_value', round(z.sold_value, 2), 'per_day', round(z.per_day, 3),
          'last_sale', z.last_sale, 'days_idle', v_to - coalesce(z.last_sale, z.first_in), 'first_in', z.first_in,
          'cover_days', case when z.per_day > 0 then round(greatest(r.qty, 0) / z.per_day, 1) end,
          'runout', case when z.per_day > 0 and r.qty > 0 then v_to + floor(r.qty / z.per_day)::int end,
          'on_order', round(z.on_order, 3),
          'to_order', case when z.per_day > 0 then ceil(greatest(z.per_day * v_target - greatest(r.qty, 0) - z.on_order, 0)) end,
          'class', case when z.first_in > v_to - 30 then 'new'
                        when z.last_sale is null or v_to - z.last_sale >= v_dead then 'dead'
                        when v_to - z.last_sale >= v_slow or (z.per_day > 0 and r.qty / z.per_day > 90) then 'slow' else 'fast' end,
          'cover', case when z.per_day = 0 then case when r.qty > 0 then 'no_sales' else 'none' end
                        when r.qty <= 0 then 'out' when r.qty / z.per_day < 7 then 'urgent' when r.qty / z.per_day < 14 then 'soon'
                        when r.qty / z.per_day > 90 then 'over' else 'ok' end)
          from (select coalesce((r.x ->> 'sold')::numeric, 0) as sold, coalesce((r.x ->> 'sold_value')::numeric, 0) as sold_value,
                       greatest(coalesce((r.x ->> 'sold')::numeric, 0), 0) / v_days as per_day,
                       (r.x ->> 'last_sale')::date as last_sale, (r.x ->> 'first_in')::date as first_in, coalesce((r.x ->> 'on_order')::numeric, 0) as on_order) z)
      end as m
      from r),
  kept as (
    select * from shaped s
     where (case v_stock when 'nonzero' then s.qty <> 0 or round(s.value, 2) <> 0 or (v_report = 'movement' and (s.o_qty <> 0 or s.x <> '{}'))
                         when 'positive' then s.qty > 0 when 'negative' then s.qty < 0 when 'zero' then s.qty = 0
                         when 'below_min' then (s.m ->> 'min_qty') is not null and s.qty <= (s.m ->> 'min_qty')::numeric else true end)
       and (cardinality(v_classes) = 0 or s.m ->> 'class' = any (v_classes)))
  select count(*)::int, coalesce((select jsonb_agg(q order by q ->> 'group', q ->> 'item', q ->> 'unit') from (
      select jsonb_build_object('variant_id', variant_id, 'unit_id', unit_id, 'unit', unit, 'unit_code', unit_code, 'code', sku, 'barcode', barcode,
               'item', item, 'category', category, 'group', grp, 'producer', producer, 'brand', brand, 'uom', uom, 'vat_rate', vat_rate,
               'type', product_type, 'active', active, 'qty', q, 'value', val, 'avg_cost', round(value / nullif(qty, 0), 4)) || m as q
        from kept order by grp, item, unit limit v_limit + 1) z), '[]')
    into v_count, v_rows
    from kept;
  v_count := jsonb_array_length(v_rows);
  if v_count > v_limit then
    v_rows := (select jsonb_agg(e order by i) from jsonb_array_elements(v_rows) with ordinality t (e, i) where i <= v_limit);
  end if;
  return jsonb_build_object('report', v_report, 'from', v_from, 'to', v_to, 'as_of', v_to, 'days', v_days, 'rows', v_rows,
    'count', least(v_count, v_limit), 'truncated', v_count > v_limit,
    'currency', (select base_currency from public.companies where id = p_company),
    'company', (select jsonb_build_object('name', name, 'tax_number', tax_number) from public.companies where id = p_company));
end $$;
revoke execute on function public.stock_analysis(uuid, jsonb) from public, anon;
grant execute on function public.stock_analysis(uuid, jsonb) to authenticated;
