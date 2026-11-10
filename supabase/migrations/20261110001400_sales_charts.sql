-- =============================================================================
-- DrisPRO · the figures behind the new charts (10.11.2026)
--   · sales_daily: each day's sales at the tills and on invoices, what the goods cost, receipts (calendar, dashboard lines)
--   · sales_charts: 24 months (this year against last year), each hour of each weekday, the categories of a month
--   · purchase_months: 24 months of purchases (this year against last year)
--   · finance_waterfall: from the sales to the net profit, with the biggest costs one by one
--   The cost of the goods only for those who may see it (inventory.costs); a person who works in some units sees those units.
-- =============================================================================

-- the tills and the invoices a person may see, as lines with their day, hour, net, cost and category
create or replace function app.sales_lines_for(p_company uuid, p_from date, p_to date)
 returns table (d date, hr int, src text, order_id uuid, net numeric, cost numeric, gross numeric, variant_id uuid)
 language plpgsql stable security definer set search_path to ''
as $function$
declare tz text; v_mine uuid[]; v_regs uuid[];
begin
  select coalesce(c.timezone, 'Europe/Tirane') into tz from public.companies c where c.id = p_company;
  v_mine := app.my_warehouses(p_company);
  if v_mine is not null then
    select coalesce(array_agg(r.id), '{}') into v_regs from public.pos_registers r where r.company_id = p_company and r.warehouse_id = any (v_mine);
  end if;
  return query
    select (o.order_at at time zone tz)::date, extract(hour from o.order_at at time zone tz)::int, 'till'::text, o.id,
           case when o.is_refund then -abs(l.line_subtotal) else l.line_subtotal end,
           case when o.is_refund then -abs(l.quantity) else l.quantity end * coalesce(l.unit_cost, 0),
           case when o.is_refund then -abs(l.line_total) else l.line_total end,
           l.variant_id
      from public.pos_orders o join public.pos_order_lines l on l.pos_order_id = o.id
     where o.company_id = p_company and o.status = 'paid' and o.deleted_at is null and o.sales_invoice_id is null
       and (v_regs is null or o.register_id = any (v_regs))
       and o.order_at >= p_from::timestamp at time zone tz and o.order_at < (p_to + 1)::timestamp at time zone tz
    union all
    select i.invoice_date, null::int, 'invoice'::text, i.id,
           s.sgn * round(il.line_subtotal * coalesce(i.exchange_rate, 1), 2),
           s.sgn * il.quantity * coalesce(ic.avg_cost, 0),
           s.sgn * round((il.line_subtotal + coalesce(il.tax_amount, 0)) * coalesce(i.exchange_rate, 1), 2),
           il.variant_id
      from public.sales_invoices i
      cross join lateral (select case when i.document_type = 'credit_note' then -1 else 1 end as sgn) s
      join public.sales_invoice_lines il on il.invoice_id = i.id
      left join public.item_costs ic on ic.company_id = i.company_id and ic.variant_id = il.variant_id
     where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and not i.is_opening and v_mine is null
       and i.invoice_date between p_from and p_to;
end
$function$;
revoke all on function app.sales_lines_for(uuid, date, date) from public, anon, authenticated;

create or replace function app.charts_guard(p_company uuid)
 returns boolean language plpgsql stable security definer set search_path to ''
as $function$
begin
  if not (app.has_permission(p_company, 'sales.read') or app.has_permission(p_company, 'pos.read') or app.is_super_admin()) then
    raise exception 'Not allowed to see the sales' using errcode = '42501';
  end if;
  return app.has_permission(p_company, 'inventory.costs') or app.is_super_admin();
end
$function$;
revoke all on function app.charts_guard(uuid) from public, anon, authenticated;

-- each day: net at the tills and on invoices (without VAT), with VAT, what the goods cost, receipts
create or replace function public.sales_daily(p_company uuid, p_from date, p_to date)
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare v_costs boolean;
begin
  v_costs := app.charts_guard(p_company);
  if p_to - p_from > 400 then raise exception 'At most 400 days at a time'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'd', g.d::date, 'till', coalesce(x.till, 0), 'invoices', coalesce(x.invoices, 0), 'gross', coalesce(x.gross, 0),
      'cost', case when v_costs then coalesce(x.cost, 0) end, 'receipts', coalesce(x.receipts, 0)) order by g.d)
    from generate_series(p_from, p_to, interval '1 day') g(d)
    left join (
      select l.d, round(sum(l.net) filter (where l.src = 'till'), 2) as till, round(sum(l.net) filter (where l.src = 'invoice'), 2) as invoices,
             round(sum(l.gross), 2) as gross, round(sum(l.cost), 2) as cost,
             count(distinct l.order_id) filter (where l.src = 'till' and l.net > 0) as receipts
        from app.sales_lines_for(p_company, p_from, p_to) l group by l.d) x on x.d = g.d::date), '[]'::jsonb);
end
$function$;

-- 24 months to the month of p_month; the hours and weekdays and the categories of that month
create or replace function public.sales_charts(p_company uuid, p_month date default current_date)
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare v_costs boolean; m0 date := date_trunc('month', p_month)::date; m1 date; tz text; v_today date;
begin
  v_costs := app.charts_guard(p_company);
  select coalesce(c.timezone, 'Europe/Tirane') into tz from public.companies c where c.id = p_company;
  v_today := (now() at time zone tz)::date;
  m1 := least((m0 + interval '1 month - 1 day')::date, v_today);
  return jsonb_build_object(
    'costs', v_costs,
    'month', m0,
    'months', (select coalesce(jsonb_agg(jsonb_build_object('month', to_char(g.m, 'YYYY-MM'), 'till', coalesce(x.till, 0), 'invoices', coalesce(x.invoices, 0),
                        'cost', case when v_costs then coalesce(x.cost, 0) end) order by g.m), '[]'::jsonb)
                 from generate_series(m0 - interval '23 months', m0, interval '1 month') g(m)
                 left join (select date_trunc('month', l.d) as m, round(sum(l.net) filter (where l.src = 'till'), 2) as till,
                                   round(sum(l.net) filter (where l.src = 'invoice'), 2) as invoices, round(sum(l.cost), 2) as cost
                              from app.sales_lines_for(p_company, (m0 - interval '23 months')::date, m1) l group by 1) x on x.m = g.m),
    -- the tills only: the hour of an invoice says nothing about the shop
    'hours', (select coalesce(jsonb_agg(jsonb_build_object('dow', x.dow, 'hour', x.hr, 'net', x.net)), '[]'::jsonb) from (
                 select extract(isodow from l.d)::int as dow, l.hr, round(sum(l.net), 2) as net
                   from app.sales_lines_for(p_company, m0, m1) l where l.src = 'till' group by 1, 2) x),
    'dow_days', (select coalesce(jsonb_object_agg(x.dow, x.n), '{}'::jsonb) from (
                 select extract(isodow from g.d)::int as dow, count(*) as n from generate_series(m0, m1, interval '1 day') g(d) group by 1) x),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'net', x.net, 'cost', case when v_costs then x.cost end) order by x.net desc), '[]'::jsonb) from (
                 select coalesce(pc.name, c.name) as name, round(sum(l.net), 2) as net, round(sum(l.cost), 2) as cost
                   from app.sales_lines_for(p_company, m0, m1) l
                   left join public.product_variants v on v.id = l.variant_id
                   left join public.products p on p.id = v.product_id
                   left join public.product_categories c on c.id = p.category_id
                   left join public.product_categories pc on pc.id = c.parent_id
                  group by 1 having round(sum(l.net), 2) <> 0) x)
  );
end
$function$;

-- 24 months of purchases (posted supplier invoices minus credit notes, without VAT)
create or replace function public.purchase_months(p_company uuid, p_to date default current_date)
 returns jsonb language sql stable set search_path to ''
as $function$
  with bills as (
    select b.bill_date, case when b.document_type = 'vendor_credit' then -1 else 1 end * round(b.subtotal * b.exchange_rate, 2) as net
      from public.vendor_bills b where b.company_id = p_company and b.status = 'posted' and b.deleted_at is null and not b.is_opening
       and b.bill_date >= (date_trunc('month', p_to) - interval '23 months')::date and b.bill_date <= p_to)
  select coalesce(jsonb_agg(jsonb_build_object('month', to_char(g.m, 'YYYY-MM'), 'spend', coalesce((select sum(net) from bills where date_trunc('month', bill_date) = g.m), 0)) order by g.m), '[]'::jsonb)
    from generate_series(date_trunc('month', p_to) - interval '23 months', date_trunc('month', p_to), interval '1 month') g(m)
$function$;

-- from the sales to the net profit, out of the accounts: the four biggest costs one by one, the rest together
create or replace function public.finance_waterfall(p_company uuid, p_from date, p_to date)
 returns jsonb language sql stable set search_path to ''
as $function$
  with b as (select * from public.account_balances(p_company, p_from, p_to)),
  exp as (select b.name, sum(b.debit - b.credit) as amount from b where b.account_type = 'expense' and b.account_subtype <> 'cogs' group by b.name having sum(b.debit - b.credit) <> 0),
  ranked as (select e.*, row_number() over (order by e.amount desc) as rn from exp e)
  select jsonb_build_object(
    'revenue', -coalesce((select sum(debit - credit) from b where account_type = 'revenue' and account_subtype = 'revenue'), 0),
    'other_income', -coalesce((select sum(debit - credit) from b where account_type = 'revenue' and account_subtype <> 'revenue'), 0),
    'cogs', coalesce((select sum(debit - credit) from b where account_subtype = 'cogs'), 0),
    'expenses', coalesce((select jsonb_agg(jsonb_build_object('name', x.name, 'amount', x.amount) order by x.ord) from (
        select r.name, r.amount, r.rn as ord from ranked r where r.rn <= 4
        union all
        select null, sum(r.amount), 5 from ranked r where r.rn > 4 having count(*) > 0) x), '[]'::jsonb),
    'net_profit', -coalesce((select sum(debit - credit) from b where account_type in ('revenue', 'expense')), 0))
$function$;

grant execute on function public.sales_daily(uuid, date, date), public.sales_charts(uuid, date), public.purchase_months(uuid, date), public.finance_waterfall(uuid, date, date) to authenticated;
revoke execute on function public.sales_daily(uuid, date, date), public.sales_charts(uuid, date), public.purchase_months(uuid, date), public.finance_waterfall(uuid, date, date) from public, anon;
