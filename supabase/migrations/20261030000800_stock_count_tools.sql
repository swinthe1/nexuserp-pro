-- =============================================================================
-- Stock counting, the way a shop or a warehouse does it on the day
--  * count_review    : before confirming, every difference with its value (gains, losses, net)
--  * count_recount   : send the big differences back to be counted again (the first count is kept)
--  * count_import    : counted quantities from a spreadsheet (code or barcode, shelf, quantity)
--  * shrinkage_report: what went missing or was found over a period, by reason, item and unit
-- =============================================================================

alter table public.cycle_count_lines add column if not exists recount boolean not null default false;
alter table public.cycle_count_lines add column if not exists first_counted_qty numeric;

-- what the confirmation would book, line by line, with the value at the current cost
create or replace function public.count_review(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.cycle_counts; v_out jsonb;
begin
  select * into c from public.cycle_counts where id = p_id and deleted_at is null;
  if c.id is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
  perform app.require_any_permission(c.company_id, array['inventory.read', 'wms.read']);
  with d as (
    select cl.id, cl.variant_id, v.sku, v.name, loc.code as location, lt.lot_number as lot, cl.counted_qty, cl.first_counted_qty, cl.recount,
           -- the stock now, less what moved after the line was counted: the same figure the confirmation uses
           coalesce((select sl.on_hand from public.stock_levels sl where sl.variant_id = cl.variant_id and sl.location_id = cl.location_id
                       and sl.lot_id is not distinct from cl.lot_id), 0)
           - coalesce((select sum(case when m.to_location_id = cl.location_id then m.quantity else -m.quantity end)
                         from public.stock_movements m
                        where m.company_id = cl.company_id and m.variant_id = cl.variant_id and m.lot_id is not distinct from cl.lot_id
                          and cl.location_id in (m.from_location_id, m.to_location_id)
                          and m.created_at > coalesce(cl.counted_at, c.created_at)), 0) as expected,
           coalesce(ic.avg_cost, 0) as unit_cost
      from public.cycle_count_lines cl
      join public.product_variants v on v.id = cl.variant_id
      join public.warehouse_locations loc on loc.id = cl.location_id
      left join public.lots lt on lt.id = cl.lot_id
      left join public.item_costs ic on ic.company_id = cl.company_id and ic.variant_id = cl.variant_id
     where cl.cycle_count_id = c.id
  ),
  x as (
    select d.*, d.counted_qty - d.expected as delta, round((d.counted_qty - d.expected) * d.unit_cost, 2) as value,
           case when d.expected <> 0 then round((d.counted_qty - d.expected) / abs(d.expected) * 100, 1) end as pct
      from d where d.counted_qty is not null
  )
  select jsonb_build_object(
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'variant_id', variant_id, 'sku', sku, 'name', name, 'location', location, 'lot', lot,
                                                          'expected', expected, 'counted', counted_qty, 'first_counted', first_counted_qty, 'recount', recount,
                                                          'delta', delta, 'pct', pct, 'unit_cost', unit_cost, 'value', value)
                                        order by abs(value) desc, sku)
                         from x where delta <> 0), '[]'),
    'counted', (select count(*) from x),
    'not_counted', (select count(*) from d where d.counted_qty is null),
    'differences', (select count(*) from x where delta <> 0),
    'gains', coalesce((select sum(value) from x where value > 0), 0),
    'losses', coalesce((select sum(value) from x where value < 0), 0),
    'net', coalesce((select sum(value) from x), 0),
    'counted_value', coalesce((select round(sum(counted_qty * unit_cost), 2) from x), 0)
  ) into v_out;
  return v_out;
end $$;

-- the big differences go back to be counted again; whoever counts does not see the first figure on a blind count
create or replace function public.count_recount(p_id uuid, p_min_value numeric default null, p_min_pct numeric default null, p_lines uuid[] default null)
returns int language plpgsql security definer set search_path = '' as $$
declare c public.cycle_counts; v_review jsonb; v_ids uuid[]; v_n int;
begin
  select * into c from public.cycle_counts where id = p_id and deleted_at is null for update;
  if c.id is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
  perform app.require_permission(c.company_id, 'wms.write');
  if c.status <> 'review' then raise exception 'Only a count waiting for review can be sent back' using errcode = '55000'; end if;
  if p_lines is not null then
    v_ids := p_lines;
  else
    if p_min_value is null and p_min_pct is null then raise exception 'Say how big a difference must be: a value or a percent' using errcode = '23514'; end if;
    v_review := public.count_review(p_id);
    select array_agg((l ->> 'id')::uuid) into v_ids from jsonb_array_elements(v_review -> 'lines') l
     where (p_min_value is not null and abs((l ->> 'value')::numeric) >= p_min_value)
        or (p_min_pct is not null and (l ->> 'pct') is not null and abs((l ->> 'pct')::numeric) >= p_min_pct)
        or (p_min_pct is not null and (l ->> 'pct') is null);
  end if;
  update public.cycle_count_lines
     set first_counted_qty = coalesce(first_counted_qty, counted_qty), counted_qty = null, recount = true, counted_by = null, counted_at = null
   where cycle_count_id = c.id and id = any (coalesce(v_ids, '{}'));
  get diagnostics v_n = row_count;
  if v_n > 0 then update public.cycle_counts set status = 'in_progress' where id = c.id; end if;
  return v_n;
end $$;

-- counted quantities from a spreadsheet: [{"code": "...", "location": "A-01", "qty": 12, "lot": "L123"}]
-- the code can be the item code or a barcode; without a shelf, the shelf where the item is (if only one)
create or replace function public.count_import(p_id uuid, p_rows jsonb, p_add boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.cycle_counts; r record; v record; v_loc uuid; v_lot uuid; v_ok int := 0; v_err jsonb := '[]'; v_n int := 0; v_qty numeric;
begin
  select * into c from public.cycle_counts where id = p_id and deleted_at is null;
  if c.id is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
  perform app.require_permission(c.company_id, 'wms.write');
  if c.status <> 'in_progress' then raise exception 'Count % is %', c.number, replace(c.status, '_', ' ') using errcode = '55000'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Rows must be a list' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'At most 5,000 rows at a time' using errcode = '54000'; end if;

  for r in select x.e, x.o from jsonb_array_elements(p_rows) with ordinality x(e, o) loop
    v_n := v_n + 1;
    begin
      v_qty := nullif(replace(btrim(r.e ->> 'qty'), ',', '.'), '')::numeric;
      if v_qty is null or v_qty < 0 then raise exception 'no quantity'; end if;
      select * into v from public.find_variant_by_code(c.company_id, btrim(r.e ->> 'code')) limit 1;
      if v.variant_id is null then raise exception 'unknown code'; end if;
      v_lot := null;
      if nullif(btrim(r.e ->> 'lot'), '') is not null then
        select id into v_lot from public.lots where company_id = c.company_id and variant_id = v.variant_id and lot_number = btrim(r.e ->> 'lot');
        if v_lot is null then raise exception 'unknown lot'; end if;
      elsif v.tracking <> 'none' then raise exception 'needs a lot';
      end if;
      v_loc := null;
      if nullif(btrim(r.e ->> 'location'), '') is not null then
        select id into v_loc from public.warehouse_locations where company_id = c.company_id and warehouse_id = c.warehouse_id and code = btrim(r.e ->> 'location');
        if v_loc is null then raise exception 'unknown shelf'; end if;
      else
        select case when count(distinct cl.location_id) = 1 then min(cl.location_id::text)::uuid end into v_loc
          from public.cycle_count_lines cl where cl.cycle_count_id = c.id and cl.variant_id = v.variant_id;
        if v_loc is null then
          select case when count(*) = 1 then min(l.id::text)::uuid end into v_loc
            from public.warehouse_locations l where l.warehouse_id = c.warehouse_id and l.location_type = 'internal' and l.is_active and l.deleted_at is null;
        end if;
        if v_loc is null then raise exception 'needs a shelf'; end if;
      end if;
      perform public.count_item(c.id, v.variant_id, v_loc, v_qty, v_lot, not p_add);
      v_ok := v_ok + 1;
    exception when others then
      v_err := v_err || jsonb_build_object('row', r.o, 'code', r.e ->> 'code', 'reason', case sqlerrm
                 when 'no quantity' then 'no_quantity' when 'unknown code' then 'unknown_code' when 'unknown lot' then 'unknown_lot'
                 when 'needs a lot' then 'needs_lot' when 'unknown shelf' then 'unknown_shelf' when 'needs a shelf' then 'needs_shelf' else sqlerrm end);
    end;
  end loop;
  return jsonb_build_object('rows', v_n, 'ok', v_ok, 'errors', v_err);
end $$;

-- what went missing or was found, by reason, item and unit (from posted stock adjustments)
create or replace function public.shrinkage_report(p_company uuid, p_from date, p_to date)
returns table (reason text, warehouse_id uuid, warehouse text, variant_id uuid, sku text, name text, category text,
               qty_lost numeric, qty_found numeric, value_lost numeric, value_found numeric, adjustments int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'inventory.read');
  return query
  select a.reason, w.id, w.name, v.id, v.sku, v.name, pc.name,
         coalesce(sum(m.quantity) filter (where m.from_warehouse_id is not null and m.to_warehouse_id is null), 0),
         coalesce(sum(m.quantity) filter (where m.to_warehouse_id is not null and m.from_warehouse_id is null), 0),
         coalesce(sum(m.total_cost) filter (where m.from_warehouse_id is not null and m.to_warehouse_id is null), 0),
         coalesce(sum(m.total_cost) filter (where m.to_warehouse_id is not null and m.from_warehouse_id is null), 0),
         count(distinct a.id)::int
    from public.stock_adjustments a
    join public.stock_movements m on m.company_id = a.company_id and m.source_doc_type = 'stock_adjustment' and m.source_doc_id = a.id
    join public.product_variants v on v.id = m.variant_id
    join public.products p on p.id = v.product_id
    left join public.product_categories pc on pc.id = p.category_id
    left join public.warehouses w on w.id = coalesce(m.from_warehouse_id, m.to_warehouse_id)
   where a.company_id = p_company and a.status = 'posted' and a.deleted_at is null and a.reason <> 'opening'
     and a.adjustment_date between p_from and p_to
   group by a.reason, w.id, w.name, v.id, v.sku, v.name, pc.name;
end $$;

revoke execute on function public.count_review(uuid), public.count_recount(uuid, numeric, numeric, uuid[]), public.count_import(uuid, jsonb, boolean),
                           public.shrinkage_report(uuid, date, date) from public, anon;
grant execute on function public.count_review(uuid), public.count_recount(uuid, numeric, numeric, uuid[]), public.count_import(uuid, jsonb, boolean),
                          public.shrinkage_report(uuid, date, date) to authenticated;

-- indexes that only repeat the start of a unique index
drop index if exists public.journal_lines_entry_idx;
drop index if exists public.sales_invoice_lines_invoice_id_idx;
