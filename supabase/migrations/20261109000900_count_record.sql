-- =============================================================================
-- DrisPRO · the stock count record (procesverbali i inventarizimit) (9.11.2026)
--   One document for a counting session or a single count: the company, the unit, when and how it was counted,
--   the commission and the person responsible for the goods, who counted what, and the differences with their
--   value at cost and at the selling price with VAT. A posted list shows exactly what was adjusted (the quantity
--   and the cost the stock movement took); a list not yet posted shows the differences as the review computes them.
-- =============================================================================
alter table public.count_sessions add column if not exists record jsonb not null default '{}'::jsonb;
alter table public.cycle_counts add column if not exists record jsonb not null default '{}'::jsonb;
comment on column public.count_sessions.record is 'The count record: {commission: [{name, role}], keeper, notes}';
comment on column public.cycle_counts.record is 'The count record of a count outside a session: {commission: [{name, role}], keeper, notes}';

-- the commission, the person responsible for the goods and the notes
create or replace function public.count_record_save(p_session uuid, p_count uuid, p_record jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_co uuid; v jsonb;
begin
  if (p_session is null) = (p_count is null) then raise exception 'Give a counting session or a count' using errcode = '22023'; end if;
  v_co := coalesce((select company_id from public.count_sessions where id = p_session and deleted_at is null),
                   (select company_id from public.cycle_counts where id = p_count and deleted_at is null));
  if v_co is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_co, 'inventory.write');
  if jsonb_typeof(coalesce(p_record -> 'commission', '[]')) <> 'array' or jsonb_array_length(coalesce(p_record -> 'commission', '[]')) > 12 then
    raise exception 'At most 12 people in the commission' using errcode = '22023';
  end if;
  v := jsonb_build_object(
    'commission', coalesce((select jsonb_agg(jsonb_build_object('name', left(btrim(x ->> 'name'), 120), 'role', left(btrim(coalesce(x ->> 'role', '')), 80)) order by i)
                              from jsonb_array_elements(coalesce(p_record -> 'commission', '[]')) with ordinality a(x, i)
                             where length(btrim(coalesce(x ->> 'name', ''))) > 0), '[]'::jsonb),
    'keeper', nullif(left(btrim(coalesce(p_record ->> 'keeper', '')), 120), ''),
    'notes', nullif(left(btrim(coalesce(p_record ->> 'notes', '')), 2000), ''));
  if p_session is not null then update public.count_sessions set record = v where id = p_session;
  else update public.cycle_counts set record = v where id = p_count; end if;
  return v;
end $$;

-- the lines of one list: what was adjusted when posted, the review's figures before
create or replace function app.count_record_lines(p_count uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with c as (select * from public.cycle_counts where id = p_count),
  d as (
    select cl.id, v.sku, v.name, u.code as unit, loc.code as location, lt.lot_number as lot, cl.counted_qty as counted,
           case when c.status = 'posted' then coalesce(al.quantity_change, 0)
                else cl.counted_qty - (coalesce((select sl.on_hand from public.stock_levels sl where sl.variant_id = cl.variant_id and sl.location_id = cl.location_id
                                                   and sl.lot_id is not distinct from cl.lot_id), 0)
                                       - coalesce((select sum(case when m.to_location_id = cl.location_id then m.quantity else -m.quantity end)
                                                     from public.stock_movements m
                                                    where m.company_id = cl.company_id and m.variant_id = cl.variant_id and m.lot_id is not distinct from cl.lot_id
                                                      and cl.location_id in (m.from_location_id, m.to_location_id)
                                                      and m.movement_date > coalesce(cl.counted_at, c.created_at)), 0)) end as delta,
           coalesce((select mv.unit_cost from public.stock_movements mv where mv.source_doc_type = 'stock_adjustment' and mv.source_line_id = al.id
                      order by mv.created_at desc limit 1), ic.avg_cost, 0) as unit_cost,
           round(coalesce(v.sales_price_override, p.sales_price, 0) * (1 + coalesce(tc.rate, 0) / 100), 2) as unit_price
      from c join public.cycle_count_lines cl on cl.cycle_count_id = c.id
      join public.product_variants v on v.id = cl.variant_id
      join public.products p on p.id = v.product_id
      left join public.units_of_measure u on u.id = p.uom_id
      left join public.tax_codes tc on tc.id = p.sales_tax_code_id
      join public.warehouse_locations loc on loc.id = cl.location_id
      left join public.lots lt on lt.id = cl.lot_id
      left join public.item_costs ic on ic.company_id = cl.company_id and ic.variant_id = cl.variant_id
      left join public.stock_adjustment_lines al on al.adjustment_id = c.adjustment_id and al.variant_id = cl.variant_id
                                                and al.location_id = cl.location_id and al.lot_id is not distinct from cl.lot_id
     where cl.counted_qty is not null)
  select coalesce(jsonb_agg(jsonb_build_object('sku', sku, 'name', name, 'unit', unit, 'location', location, 'lot', lot,
                                               'expected', counted - delta, 'counted', counted, 'delta', delta,
                                               'unit_cost', round(unit_cost, 4), 'value', round(delta * unit_cost, 2), 'counted_value', round(counted * unit_cost, 2),
                                               'unit_price', unit_price, 'sale_value', round(delta * unit_price, 2))
                            order by location, sku), '[]'::jsonb)
    from d
$$;
revoke execute on function app.count_record_lines(uuid) from public, anon, authenticated;

-- the record itself
create or replace function public.count_record(p_session uuid default null, p_count uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.count_sessions; c public.cycle_counts; v_co uuid; v_wh uuid; v_ids uuid[]; v_lines jsonb; v_out jsonb;
begin
  if (p_session is null) = (p_count is null) then raise exception 'Give a counting session or a count' using errcode = '22023'; end if;
  if p_session is not null then
    select * into s from public.count_sessions where id = p_session and deleted_at is null;
    if s.id is null then raise exception 'Counting session not found' using errcode = 'P0002'; end if;
    v_co := s.company_id; v_wh := s.warehouse_id;
    v_ids := array(select id from public.cycle_counts where session_id = s.id and deleted_at is null and status <> 'cancelled' order by created_at);
  else
    select * into c from public.cycle_counts where id = p_count and deleted_at is null;
    if c.id is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
    v_co := c.company_id; v_wh := c.warehouse_id; v_ids := array[c.id];
  end if;
  perform app.require_permission(v_co, 'inventory.write');   -- it shows what the program expected: the manager's document
  select coalesce(jsonb_agg(x order by x ->> 'location', x ->> 'sku'), '[]'::jsonb) into v_lines
    from unnest(v_ids) i, jsonb_array_elements(app.count_record_lines(i)) x;

  v_out := jsonb_build_object(
    'company', (select jsonb_build_object('name', coalesce(legal_name, name), 'trade_name', name, 'business_number', business_number, 'vat_number', vat_number,
                                          'tax_number', tax_number, 'address', concat_ws(', ', nullif(address_line1, ''), nullif(city, '')), 'currency', base_currency)
                  from public.companies where id = v_co),
    'warehouse', (select jsonb_build_object('code', code, 'name', name) from public.warehouses where id = v_wh),
    'kind', case when p_session is not null then 'session' else 'count' end,
    'name', coalesce(s.name, c.number),
    'numbers', (select jsonb_agg(number order by created_at) from public.cycle_counts where id = any (v_ids)),
    'started_at', coalesce(s.created_at, c.created_at),
    'first_count_at', (select min(cl.counted_at) from public.cycle_count_lines cl where cl.cycle_count_id = any (v_ids)),
    'last_count_at', (select max(cl.counted_at) from public.cycle_count_lines cl where cl.cycle_count_id = any (v_ids)),
    'closed_at', s.closed_at,
    'posted', not exists (select 1 from public.cycle_counts where id = any (v_ids) and status <> 'posted'),
    'adjustments', (select jsonb_agg(jsonb_build_object('number', a.number, 'status', a.status) order by a.number)
                      from public.cycle_counts oc join public.stock_adjustments a on a.id = oc.adjustment_id where oc.id = any (v_ids)),
    'blind', not exists (select 1 from public.cycle_counts where id = any (v_ids) and not blind_count),
    'cart_minutes', s.cart_minutes,
    'record', coalesce(s.record, c.record, '{}'::jsonb),
    'counters', coalesce((select jsonb_agg(jsonb_build_object('name', q.name, 'items', q.items) order by q.items desc)
                            from (select coalesce(p.full_name, p.email) as name, count(distinct l.id) as items
                                    from public.cycle_count_lines l
                                    left join public.cycle_count_entries e on e.line_id = l.id
                                    join public.profiles p on p.id = coalesce(e.user_id, l.counted_by)
                                   where l.cycle_count_id = any (v_ids) and l.counted_qty is not null
                                   group by 1) q), '[]'::jsonb),
    'totals', (select jsonb_build_object(
                 'lines', count(*), 'items', count(distinct x ->> 'sku'),
                 'differences', count(*) filter (where (x ->> 'delta')::numeric <> 0),
                 'shortages', count(*) filter (where (x ->> 'delta')::numeric < 0),
                 'surpluses', count(*) filter (where (x ->> 'delta')::numeric > 0),
                 'counted_value', coalesce(sum((x ->> 'counted_value')::numeric), 0),
                 'shortage_value', coalesce(sum((x ->> 'value')::numeric) filter (where (x ->> 'delta')::numeric < 0), 0),
                 'surplus_value', coalesce(sum((x ->> 'value')::numeric) filter (where (x ->> 'delta')::numeric > 0), 0),
                 'net', coalesce(sum((x ->> 'value')::numeric), 0),
                 'shortage_sale', coalesce(sum((x ->> 'sale_value')::numeric) filter (where (x ->> 'delta')::numeric < 0), 0),
                 'surplus_sale', coalesce(sum((x ->> 'sale_value')::numeric) filter (where (x ->> 'delta')::numeric > 0), 0))
                 from jsonb_array_elements(v_lines) x),
    'lines', v_lines,
    'made_at', now(),
    'made_by', (select coalesce(full_name, email) from public.profiles where id = auth.uid()));
  if not app.has_permission(v_co, 'inventory.costs') then
    v_out := app.scrub_costs(v_out, '{unit_cost,value,counted_value,shortage_value,surplus_value,net}'::text[]);
  end if;
  return v_out;
end $$;

revoke execute on function public.count_record_save(uuid, uuid, jsonb), public.count_record(uuid, uuid) from public, anon;
grant execute on function public.count_record_save(uuid, uuid, jsonb), public.count_record(uuid, uuid) to authenticated;
