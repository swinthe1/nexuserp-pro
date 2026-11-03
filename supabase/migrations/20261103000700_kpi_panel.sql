-- =============================================================================
-- DrisPRO · The manager's panel (from the shop's own manager handbook, point 16)
--   One call gives the period's figures for the whole company or one store, compared with the
--   period before and with the same days last year:
--     · plan reached          sales ÷ the month's target (by the days of the period)
--     · customers             the receipts and invoices
--     · average receipt       sales ÷ customers
--     · gross margin          (sales − cost of the goods) ÷ sales
--     · losses                what counts, damage, theft and expiry took, at cost, ÷ sales
--     · stock turnover        cost of the goods sold ÷ the average stock
--     · sales per hour worked sales ÷ the hours on the attendance sheet
--     · till discipline       voids and cash differences per shift
--   (a month, or the month so far, is compared with the same days of the month before)
--   with the days of the period, the hours of the day at the tills and every store side by side.
--   Monthly sales targets per store (or for the whole company) are kept here too.
--   All amounts without VAT.
-- =============================================================================

create table if not exists public.sales_targets (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  warehouse_id uuid,                                       -- null: the whole company
  month        date not null check (month = date_trunc('month', month)::date),
  amount       numeric(18,2) not null check (amount > 0),  -- sales without VAT
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id)
);
create unique index if not exists sales_targets_one on public.sales_targets (company_id, coalesce(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid), month);
select app.register_table('public.sales_targets', 'sales', p_soft_delete => false, p_client_write => false);

create or replace function app.kpi_can_set_targets(p_company uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_permission(p_company, 'reports.read')
     and (app.has_permission(p_company, 'sales.write') or app.has_permission(p_company, 'pos.approve'))
$$;
revoke execute on function app.kpi_can_set_targets(uuid) from public, anon, authenticated;

-- the target of a month for a store (or the company): an amount, or nothing to remove it
create or replace function public.kpi_target_save(p_company uuid, p_warehouse uuid, p_month date, p_amount numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare v_month date := date_trunc('month', p_month)::date;
begin
  if not app.kpi_can_set_targets(p_company) then
    raise exception 'Permission denied: only a manager sets the sales targets' using errcode = '42501';
  end if;
  if p_warehouse is not null and not exists (select 1 from public.warehouses where id = p_warehouse and company_id = p_company) then
    raise exception 'Store not found' using errcode = 'P0002';
  end if;
  if coalesce(p_amount, 0) <= 0 then
    delete from public.sales_targets where company_id = p_company and warehouse_id is not distinct from p_warehouse and month = v_month;
    return;
  end if;
  insert into public.sales_targets (company_id, warehouse_id, month, amount) values (p_company, p_warehouse, v_month, round(p_amount, 2))
  on conflict (company_id, coalesce(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid), month)
  do update set amount = excluded.amount;
end $$;

-- the target for some days: each month's target by its share of days; a company without its own
-- target uses the sum of its stores' targets
create or replace function app.kpi_target(p_company uuid, p_from date, p_to date, p_warehouse uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  with m as (
    select t.warehouse_id, t.amount
           * ((least(p_to, (t.month + interval '1 month' - interval '1 day')::date) - greatest(p_from, t.month) + 1)::numeric
              / extract(day from (t.month + interval '1 month' - interval '1 day'))::numeric) as part
      from public.sales_targets t
     where t.company_id = p_company and t.month <= p_to and (t.month + interval '1 month' - interval '1 day')::date >= p_from
  )
  select round(case
    when p_warehouse is not null then (select sum(part) from m where warehouse_id = p_warehouse)
    else coalesce((select sum(part) from m where warehouse_id is null), (select sum(part) from m where warehouse_id is not null)) end, 2)
$$;
revoke execute on function app.kpi_target(uuid, date, date, uuid) from public, anon, authenticated;

-- the figures of one period (p_full: also stock, hours and the tills)
create or replace function app.kpi_figures(p_company uuid, p_from date, p_to date, p_warehouse uuid, p_full boolean default true)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text := coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane');
  s record; v_lost numeric; v_found numeric; v_stock_a numeric; v_stock_b numeric; v_hours numeric; v_target numeric;
  v_shifts int; v_voids int; v_void_amt numeric; v_diff numeric; v_diff_shifts int; r jsonb;
begin
  select coalesce(sum(net), 0) as sales, coalesce(sum(cost), 0) as cost,
         count(distinct doc_id) filter (where doc_type not in ('credit_note', 'cost_correction')) as receipts,
         coalesce(sum(qty) filter (where doc_type not in ('credit_note', 'cost_correction')), 0) as items
    into s from app.sales_facts(p_company, p_from, p_to) f
   where p_warehouse is null or f.warehouse_id = p_warehouse;
  v_target := app.kpi_target(p_company, p_from, p_to, p_warehouse);
  r := jsonb_build_object('sales', round(s.sales, 2), 'cost', round(s.cost, 2), 'margin', round(s.sales - s.cost, 2),
    'margin_pct', round(100 * (s.sales - s.cost) / nullif(s.sales, 0), 1), 'receipts', s.receipts, 'items', round(s.items, 2),
    'avg_receipt', round(s.sales / nullif(s.receipts, 0), 2), 'items_per_receipt', round(s.items / nullif(s.receipts, 0), 1),
    'target', v_target, 'plan_pct', round(100 * s.sales / nullif(v_target, 0), 1));
  if not p_full then return r; end if;

  -- losses: what the stock adjustments (counts, damage, theft, expiry) took out, less what they found
  select coalesce(sum(m.total_cost) filter (where m.from_warehouse_id is not null and m.to_warehouse_id is null), 0),
         coalesce(sum(m.total_cost) filter (where m.to_warehouse_id is not null and m.from_warehouse_id is null), 0)
    into v_lost, v_found
    from public.stock_adjustments a
    join public.stock_movements m on m.company_id = a.company_id and m.source_doc_type = 'stock_adjustment' and m.source_doc_id = a.id
   where a.company_id = p_company and a.status = 'posted' and a.deleted_at is null and a.reason <> 'opening'
     and a.adjustment_date between p_from and p_to
     and (p_warehouse is null or coalesce(m.from_warehouse_id, m.to_warehouse_id) = p_warehouse);

  -- stock at cost the evening before and at the end, for the turnover
  select coalesce(sum(value), 0) into v_stock_a from app.stock_as_of(p_company, p_from - 1) where p_warehouse is null or warehouse_id = p_warehouse;
  select coalesce(sum(value), 0) into v_stock_b from app.stock_as_of(p_company, p_to) where p_warehouse is null or warehouse_id = p_warehouse;

  -- hours worked (the attendance sheet is not kept by store)
  if p_warehouse is null then
    select sum(hours_worked) into v_hours from public.attendance_records where company_id = p_company and work_date between p_from and p_to;
  end if;

  -- the tills: shifts, voids and cash differences
  select count(*), coalesce(sum(abs(z.cash_difference)), 0), count(*) filter (where coalesce(z.cash_difference, 0) <> 0)
    into v_shifts, v_diff, v_diff_shifts
    from public.pos_sessions ps join public.pos_registers g on g.id = ps.register_id
    left join public.z_reports z on z.session_id = ps.id
   where ps.company_id = p_company and (ps.opened_at at time zone v_tz)::date between p_from and p_to
     and (p_warehouse is null or g.warehouse_id = p_warehouse);
  select count(*), coalesce(sum(l.amount), 0) into v_voids, v_void_amt
    from public.pos_till_log l join public.pos_registers g on g.id = l.register_id
   where l.company_id = p_company and l.kind like 'void%' and (l.at at time zone v_tz)::date between p_from and p_to
     and (p_warehouse is null or g.warehouse_id = p_warehouse);

  return r || jsonb_build_object(
    'losses', round(v_lost - v_found, 2), 'lost', round(v_lost, 2), 'found', round(v_found, 2),
    'losses_pct', round(100 * (v_lost - v_found) / nullif(s.sales, 0), 2),
    'stock_start', round(v_stock_a, 2), 'stock_end', round(v_stock_b, 2),
    -- (stock below zero, sold before it was received, says nothing about turnover)
    'turnover', round(s.cost / nullif(greatest((v_stock_a + v_stock_b) / 2, 0), 0), 2),
    'stock_days', round(nullif(greatest((v_stock_a + v_stock_b) / 2, 0), 0) / nullif(s.cost / (p_to - p_from + 1), 0), 0),
    'hours', round(v_hours, 1), 'sales_per_hour', round(s.sales / nullif(v_hours, 0), 2),
    'shifts', v_shifts, 'voids', v_voids, 'void_amount', round(v_void_amt, 2), 'voids_per_shift', round(v_voids::numeric / nullif(v_shifts, 0), 1),
    'cash_diff', round(v_diff, 2), 'diff_shifts', v_diff_shifts);
end $$;
revoke execute on function app.kpi_figures(uuid, date, date, uuid, boolean) from public, anon, authenticated;

-- the manager's panel
create or replace function public.kpi_panel(p_company uuid, p_from date, p_to date, p_warehouse uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz text; v_len int; v_prev_from date; v_prev_to date; v_ly_from date; v_ly_to date; v_mine uuid[];
begin
  if not (app.has_permission(p_company, 'sales.read') and app.has_permission(p_company, 'reports.read')) then
    raise exception 'Permission denied: sales.read and reports.read required' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose a period' using errcode = '22023'; end if;
  if p_to - p_from > 366 then raise exception 'Choose a period of at most a year' using errcode = '22023'; end if;
  -- someone who works only in some stores sees those stores (the first one when none is chosen)
  v_mine := app.my_warehouses(p_company);
  if v_mine is not null then
    if p_warehouse is null then p_warehouse := v_mine[1]; else perform app.check_warehouse(p_company, p_warehouse); end if;
  end if;
  v_tz := coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane');
  v_len := p_to - p_from + 1;
  -- the period before: a month (or the month so far) against the same days of the month before, otherwise as many days just before
  if extract(day from p_from) = 1 and date_trunc('month', p_from) = date_trunc('month', p_to) then
    v_prev_from := (p_from - interval '1 month')::date;
    v_prev_to := case when p_to = (date_trunc('month', p_to) + interval '1 month' - interval '1 day')::date then p_from - 1
                      else least((p_to - interval '1 month')::date, p_from - 1) end;
  elsif extract(isodow from p_from) = 1 and v_len between 2 and 7 then   -- a week, or the week so far: the same days a week before
    v_prev_from := p_from - 7; v_prev_to := p_to - 7;
  else
    v_prev_to := p_from - 1; v_prev_from := p_from - v_len;
  end if;
  v_ly_from := (p_from - interval '1 year')::date; v_ly_to := (p_to - interval '1 year')::date;

  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'warehouse_id', p_warehouse, 'my_stores', to_jsonb(v_mine), 'previous', jsonb_build_object('from', v_prev_from, 'to', v_prev_to),
    'last_year_range', jsonb_build_object('from', v_ly_from, 'to', v_ly_to),
    'can_set_targets', app.kpi_can_set_targets(p_company),
    'now', app.kpi_figures(p_company, p_from, p_to, p_warehouse),
    'before', app.kpi_figures(p_company, v_prev_from, v_prev_to, p_warehouse),
    'last_year', app.kpi_figures(p_company, v_ly_from, v_ly_to, p_warehouse, false),
    -- day by day, with the day's share of the target
    'days', (select coalesce(jsonb_agg(jsonb_build_object('date', d, 'sales', coalesce(x.sales, 0), 'receipts', coalesce(x.receipts, 0),
                       'target', app.kpi_target(p_company, d, d, p_warehouse)) order by d), '[]'::jsonb)
               from generate_series(p_from, p_to, interval '1 day') g(dd)
               cross join lateral (select g.dd::date as d) dd
               left join (select doc_date, round(sum(net), 2) as sales,
                                 count(distinct doc_id) filter (where doc_type not in ('credit_note', 'cost_correction')) as receipts
                            from app.sales_facts(p_company, p_from, p_to) f where p_warehouse is null or f.warehouse_id = p_warehouse
                           group by doc_date) x on x.doc_date = dd.d),
    -- the tills by the hour of the day
    'hours', (select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'sales', sales, 'receipts', receipts) order by h), '[]'::jsonb)
                from (select extract(hour from o.order_at at time zone v_tz)::int as h,
                             round(sum(o.total - o.tax_total), 2) as sales,  -- a refund is negative
                             count(*) filter (where not o.is_refund) as receipts
                        from public.pos_orders o join public.pos_registers g on g.id = o.register_id
                       where o.company_id = p_company and o.status = 'paid' and o.deleted_at is null
                         and (o.order_at at time zone v_tz)::date between p_from and p_to
                         and (p_warehouse is null or g.warehouse_id = p_warehouse)
                       group by 1) hh),
    -- every store side by side (only for the whole company)
    'stores', case when p_warehouse is null then (
      select coalesce(jsonb_agg(jsonb_build_object('warehouse_id', w.id, 'name', w.name) || app.kpi_figures(p_company, p_from, p_to, w.id) order by w.name), '[]'::jsonb)
        from public.warehouses w
       where w.company_id = p_company and w.deleted_at is null
         and (exists (select 1 from public.pos_registers g where g.warehouse_id = w.id and g.deleted_at is null)
              or exists (select 1 from public.sales_targets t where t.warehouse_id = w.id and t.month <= p_to and t.month >= date_trunc('month', p_from)::date)))
      else '[]'::jsonb end,
    -- the targets of the months in the period
    'targets', (select coalesce(jsonb_agg(jsonb_build_object('warehouse_id', t.warehouse_id, 'month', t.month, 'amount', t.amount) order by t.month), '[]'::jsonb)
                  from public.sales_targets t
                 where t.company_id = p_company and t.month between date_trunc('month', p_from)::date and p_to));
end $$;

revoke execute on function public.kpi_panel(uuid, date, date, uuid), public.kpi_target_save(uuid, uuid, date, numeric) from public, anon;
grant execute on function public.kpi_panel(uuid, date, date, uuid), public.kpi_target_save(uuid, uuid, date, numeric) to authenticated;
