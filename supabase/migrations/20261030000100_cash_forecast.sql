-- =============================================================================
-- Cash forecast (13 weeks) and the supplier payment proposal
--  * public.cash_plan_items      : the owner's own known items (rent, loan, owner draw…)
--  * public.cash_forecast()      : cash + bank today, then week by week what comes in
--                                  and goes out, and the first week that goes negative
--  * public.payment_proposal()   : the open supplier bills, ranked, with early-payment discounts
--  * public.pay_vendor_bills()   : pays the chosen bills, one payment per supplier
-- =============================================================================

create table public.cash_plan_items (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  name         text not null check (length(trim(name)) > 0),
  direction    text not null default 'out' check (direction in ('in', 'out')),
  amount       numeric(18,2) not null check (amount > 0),
  first_date   date not null,
  every_months smallint not null default 1 check (every_months in (0, 1, 2, 3, 6, 12)),   -- 0 = once
  end_date     date,
  notes        text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid default auth.uid()
);
select app.register_table('public.cash_plan_items', 'finance', p_soft_delete => false, p_client_write => true, p_audit => true);
create index cash_plan_items_company_idx on public.cash_plan_items (company_id) where is_active;

-- how late each customer usually pays (days after the due date), from the last year of receipts
create or replace function app.customer_lateness(p_company uuid)
returns table (partner_id uuid, late_days numeric, paid_docs int)
language sql stable security definer set search_path = '' as $$
  select i.partner_id,
         greatest(0, least(120, round(sum((p.payment_date - i.due_date) * a.amount) / nullif(sum(a.amount), 0), 1))),
         count(distinct i.id)::int
    from public.payment_allocations a
    join public.payments p on p.id = a.payment_id and p.status = 'posted'
    join public.sales_invoices i on i.id = a.sales_invoice_id
   where a.company_id = p_company and i.document_type = 'sales_invoice' and i.due_date is not null
     and p.payment_date >= current_date - 365 and a.amount > 0
   group by i.partner_id
$$;

create or replace function public.cash_forecast(p_company uuid, p_weeks int default 13, p_as_of date default current_date, p_estimates boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_weeks int := greatest(4, least(coalesce(p_weeks, 13), 26));
  v_end date := p_as_of + v_weeks * 7 - 1;
  v_country text; v_base text; v_vat_day int;
  v_avg_late numeric;
  v_out jsonb;
begin
  perform app.require_permission(p_company, 'finance.read');
  select country_code, base_currency into v_country, v_base from public.companies where id = p_company;
  v_vat_day := case when v_country = 'AL' then 14 else 20 end;

  select coalesce(round(sum(late_days * paid_docs) / nullif(sum(paid_docs), 0), 1), 0) into v_avg_late from app.customer_lateness(p_company);

  create temp table if not exists pg_temp.cf_flows (d date, kind text, label text, partner_id uuid, partner text, amount numeric, ref uuid, overdue boolean, late numeric) on commit drop;
  truncate pg_temp.cf_flows;

  -- 1. customers: open invoices, moved by how late each customer usually pays; very old ones are left out as doubtful
  insert into pg_temp.cf_flows
  select greatest(i.due_date + round(coalesce(l.late_days, v_avg_late))::int, p_as_of), 'receipt', i.number, i.partner_id, bp.name,
         round(i.amount_due * i.exchange_rate, 2), i.id, i.due_date < p_as_of, coalesce(l.late_days, v_avg_late)
    from public.sales_invoices i
    join public.business_partners bp on bp.id = i.partner_id
    left join app.customer_lateness(p_company) l on l.partner_id = i.partner_id
   where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and i.document_type = 'sales_invoice'
     and i.amount_due > 0 and coalesce(i.due_date, i.invoice_date) >= p_as_of - 180;

  -- 2. invoices that repeat (subscriptions, rent we charge…)
  insert into pg_temp.cf_flows
  with recursive occ as (
    select r.id, r.partner_id, r.name, r.next_date as d, r.every_months, r.day_of_month, r.end_date, r.currency_code, r.payment_term_id, 0 as n
      from public.recurring_invoices r where r.company_id = p_company and r.is_active and r.next_date <= v_end
    union all
    select o.id, o.partner_id, o.name, app.recurring_next(o.d, o.every_months, o.day_of_month), o.every_months, o.day_of_month, o.end_date,
           o.currency_code, o.payment_term_id, o.n + 1
      from occ o where o.n < 30 and app.recurring_next(o.d, o.every_months, o.day_of_month) <= v_end
  )
  select x.d, 'recurring_in', x.name, x.partner_id, x.partner, x.amount, x.id, false, x.late from (
    select greatest(o.d + coalesce(pt.due_days, 0) + round(coalesce(l.late_days, v_avg_late))::int, p_as_of) as d, o.name, o.partner_id, bp.name as partner,
           round((select coalesce(sum(round(round((li ->> 'quantity')::numeric * (li ->> 'unit_price')::numeric * (1 - coalesce((li ->> 'discount_pct')::numeric, 0) / 100), 2)
                   * (1 + coalesce(t.rate, 0) / 100), 2)), 0)
                    from public.recurring_invoices r cross join jsonb_array_elements(r.lines) li
                    left join public.tax_codes t on t.id = nullif(li ->> 'tax_code_id', '')::uuid where r.id = o.id)
                 * coalesce(app.exchange_rate(p_company, o.currency_code, p_as_of), 1), 2) as amount,
           o.id, coalesce(l.late_days, v_avg_late) as late
      from occ o
      join public.business_partners bp on bp.id = o.partner_id
      left join public.payment_terms pt on pt.id = o.payment_term_id
      left join app.customer_lateness(p_company) l on l.partner_id = o.partner_id
     where o.end_date is null or o.d <= o.end_date
  ) x where x.d <= v_end and x.amount > 0;

  -- 3. suppliers: open bills on their due date (overdue ones now)
  insert into pg_temp.cf_flows
  select greatest(coalesce(b.due_date, b.bill_date), p_as_of), 'bill', coalesce(b.vendor_invoice_number, b.number), b.vendor_id, bp.name,
         -round(b.amount_due * b.exchange_rate, 2), b.id, coalesce(b.due_date, b.bill_date) < p_as_of, null
    from public.vendor_bills b
    join public.business_partners bp on bp.id = b.vendor_id
   where b.company_id = p_company and b.status = 'posted' and b.deleted_at is null and b.document_type = 'vendor_bill' and b.amount_due > 0;

  -- 4. salaries: a run not yet paid on its pay day, then the last run's cost every month
  insert into pg_temp.cf_flows
  select greatest(r.pay_date, p_as_of), 'payroll', r.number, null, null, -round(r.total_employer_cost, 2), r.id, r.pay_date < p_as_of, null
    from public.payroll_runs r
   where r.company_id = p_company and r.deleted_at is null and r.status in ('approved', 'posted') and r.pay_date is not null and r.total_employer_cost > 0;
  insert into pg_temp.cf_flows
  select g.d::date, 'payroll', to_char(g.d, 'MM.YYYY'), null, null, -round(lr.total_employer_cost, 2), lr.id, false, null
    from (select * from public.payroll_runs r
           where r.company_id = p_company and r.deleted_at is null and r.status in ('approved', 'posted', 'paid') and r.pay_date is not null and r.total_employer_cost > 0
           order by r.pay_date desc limit 1) lr
    cross join lateral generate_series(lr.pay_date + interval '1 month', v_end::timestamp, interval '1 month') g(d)
   where g.d::date >= p_as_of;

  -- 5. VAT: each month's VAT is paid on the 20th (14th in Albania) of the next month.
  --    A filed return gives the exact amount; a month with no return uses its documents,
  --    and months still to come use the average of the last three.
  insert into pg_temp.cf_flows
  with months as (
    select m::date as m_start, (m + interval '1 month' - interval '1 day')::date as m_end,
           (m + interval '1 month')::date + (v_vat_day - 1) as due
      from generate_series(date_trunc('month', p_as_of - 62), date_trunc('month', v_end), interval '1 month') m
  ),
  docs as (
    select mo.m_start, mo.m_end, mo.due,
           coalesce((select sum(i.tax_total * i.exchange_rate * case when i.document_type = 'credit_note' then -1 else 1 end) from public.sales_invoices i
                      where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and i.invoice_date between mo.m_start and mo.m_end), 0)
         - coalesce((select sum(b.tax_total * b.exchange_rate * case when b.document_type = 'vendor_credit' then -1 else 1 end) from public.vendor_bills b
                      where b.company_id = p_company and b.status = 'posted' and b.deleted_at is null and b.bill_date between mo.m_start and mo.m_end), 0) as net,
           (select d.status from public.vat_declarations d where d.company_id = p_company and d.deleted_at is null
              and d.period_start <= mo.m_start and d.period_end >= mo.m_end order by d.created_at desc limit 1) as decl_status,
           (select coalesce(d.payable, d.net_vat) from public.vat_declarations d where d.company_id = p_company and d.deleted_at is null
              and d.period_start <= mo.m_start and d.period_end >= mo.m_end order by d.created_at desc limit 1) as decl_payable
      from months mo
  ),
  avg3 as (select coalesce(avg(greatest(net, 0)), 0) as v from docs where m_end < date_trunc('month', p_as_of)::date and m_start >= (date_trunc('month', p_as_of) - interval '3 months')::date)
  select greatest(d.due, p_as_of), 'vat', to_char(d.m_start, 'MM.YYYY'), null, null,
         -round(case when d.decl_status is not null then greatest(coalesce(d.decl_payable, 0), 0)
                     when d.m_end >= p_as_of then greatest(d.net, (select v from avg3), 0)
                     else greatest(d.net, 0) end, 2),
         null, d.due < p_as_of, null
    from docs d
   where coalesce(d.decl_status, '') <> 'paid' and d.due <= v_end
     and (d.due >= p_as_of or (d.decl_status is not null and d.due >= p_as_of - 62));
  delete from pg_temp.cf_flows where kind = 'vat' and amount = 0;

  -- 6. the owner's own items
  insert into pg_temp.cf_flows
  select g.d::date, 'plan_' || c.direction, c.name, null, null, case when c.direction = 'in' then c.amount else -c.amount end, c.id, false, null
    from public.cash_plan_items c
    cross join lateral generate_series(c.first_date::timestamp,
                                        least(coalesce(c.end_date, v_end), v_end)::timestamp,
                                        case when c.every_months = 0 then interval '100 years' else make_interval(months => c.every_months) end) g(d)
   where c.company_id = p_company and c.is_active and g.d::date >= p_as_of;

  -- 7. money that moves without an invoice or a bill (till sales, Z reports, expenses paid on the spot…):
  --    the weekly average of the last 8 weeks, carried forward
  insert into pg_temp.cf_flows
  with mv as (
    select je.id, je.entry_date, sum(jl.debit - jl.credit) as net
      from public.journal_lines jl
      join public.journal_entries je on je.id = jl.entry_id
      join public.bank_accounts ba on ba.account_id = jl.account_id and ba.company_id = p_company
     where je.company_id = p_company and je.status = 'posted' and je.deleted_at is null
       and je.entry_date between p_as_of - 56 and p_as_of - 1
       and je.source_doc_type is not null
       and je.source_doc_type not in ('customer_payment', 'vendor_payment', 'payroll_run', 'vat_declaration', 'safe_movement', 'year_carry', 'year_close', 'migration')
     group by je.id, je.entry_date
  ),
  span as (select greatest(1, least(8, ceil((p_as_of - min(entry_date))::numeric / 7))) as w from mv),
  avgw as (select round(coalesce(sum(net) filter (where net > 0), 0) / (select w from span), 2) as cash_in,
                  round(coalesce(sum(net) filter (where net < 0), 0) / (select w from span), 2) as cash_out from mv)
  select p_as_of + (w - 1) * 7, k.kind, null, null, null, k.amount, null, false, null
    from generate_series(1, v_weeks) w
    cross join avgw
    cross join lateral (values ('sales_in', avgw.cash_in), ('other_out', avgw.cash_out)) k(kind, amount)
   where k.amount <> 0;

  -- 8. invoices and bills not made yet: the weekly average of the last 8 weeks, landing after the usual terms
  --    (customers: terms + how late they pay; suppliers: terms). Can be switched off.
  if p_estimates then
    insert into pg_temp.cf_flows
    with s as (
      select coalesce(sum(i.total_base), 0) / 8 as weekly,
             coalesce(avg(coalesce(i.due_date, i.invoice_date) - i.invoice_date), 0) as term
        from public.sales_invoices i
       where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and i.document_type = 'sales_invoice'
         and i.invoice_date between p_as_of - 56 and p_as_of - 1 and coalesce(i.source, '') not in ('pos', 'z_report')
    ),
    b as (
      select coalesce(sum(b.total_base), 0) / 8 as weekly,
             coalesce(avg(coalesce(b.due_date, b.bill_date) - b.bill_date), 0) as term
        from public.vendor_bills b
       where b.company_id = p_company and b.status = 'posted' and b.deleted_at is null and b.document_type = 'vendor_bill'
         and b.bill_date between p_as_of - 56 and p_as_of - 1 and b.pay_bank_account_id is null
    )
    select p_as_of + (w - 1) * 7, k.kind, null, null, null, k.amount, null, false, null
      from generate_series(1, v_weeks) w cross join s cross join b
      cross join lateral (values ('future_sales', round(s.weekly, 2), round(s.term + v_avg_late)),
                                 ('future_bills', -round(b.weekly, 2), round(b.term))) k(kind, amount, lag_days)
     where k.amount <> 0 and (w - 1) * 7 >= k.lag_days;
  end if;

  with banks as (
    select ba.id, ba.name, ba.account_kind, ba.currency_code,
           coalesce((select sum(jl.debit - jl.credit) from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id
                      where jl.account_id = ba.account_id and je.status = 'posted' and je.deleted_at is null and je.entry_date <= p_as_of), 0) as balance
      from public.bank_accounts ba
     where ba.company_id = p_company and ba.is_active and ba.deleted_at is null
  ),
  opening as (select coalesce(sum(balance), 0) as v from banks),
  wk as (
    select w as week, p_as_of + (w - 1) * 7 as start_d, p_as_of + w * 7 - 1 as end_d from generate_series(1, v_weeks) w
  ),
  per as (
    select wk.week, wk.start_d, wk.end_d,
           coalesce(sum(f.amount) filter (where f.kind = 'receipt'), 0) as receipts,
           coalesce(sum(f.amount) filter (where f.kind = 'recurring_in'), 0) as recurring_in,
           coalesce(sum(f.amount) filter (where f.kind = 'plan_in'), 0) as plan_in,
           coalesce(sum(f.amount) filter (where f.kind = 'bill'), 0) as bills,
           coalesce(sum(f.amount) filter (where f.kind = 'payroll'), 0) as payroll,
           coalesce(sum(f.amount) filter (where f.kind = 'vat'), 0) as vat,
           coalesce(sum(f.amount) filter (where f.kind = 'plan_out'), 0) as plan_out,
           coalesce(sum(f.amount) filter (where f.kind = 'sales_in'), 0) as sales_in,
           coalesce(sum(f.amount) filter (where f.kind = 'other_out'), 0) as other_out,
           coalesce(sum(f.amount) filter (where f.kind = 'future_sales'), 0) as future_sales,
           coalesce(sum(f.amount) filter (where f.kind = 'future_bills'), 0) as future_bills,
           coalesce(sum(f.amount) filter (where f.amount > 0), 0) as inflow,
           coalesce(sum(f.amount) filter (where f.amount < 0), 0) as outflow,
           coalesce(sum(f.amount), 0) as net
      from wk left join pg_temp.cf_flows f on f.d between wk.start_d and wk.end_d
     group by wk.week, wk.start_d, wk.end_d
  ),
  run as (
    select per.*, (select v from opening) + sum(per.net) over (order by per.week) as closing from per
  ),
  ar as (select coalesce(sum(round(amount_due * exchange_rate, 2)), 0) as v from public.sales_invoices
          where company_id = p_company and status = 'posted' and deleted_at is null and document_type = 'sales_invoice' and amount_due > 0),
  ap as (select coalesce(sum(round(amount_due * exchange_rate, 2)), 0) as v from public.vendor_bills
          where company_id = p_company and status = 'posted' and deleted_at is null and document_type = 'vendor_bill' and amount_due > 0),
  s90 as (select coalesce(sum(total_base), 0) as v from public.sales_invoices
           where company_id = p_company and status = 'posted' and deleted_at is null and document_type = 'sales_invoice' and invoice_date > p_as_of - 90),
  b90 as (select coalesce(sum(total_base), 0) as v from public.vendor_bills
           where company_id = p_company and status = 'posted' and deleted_at is null and document_type = 'vendor_bill' and bill_date > p_as_of - 90)
  select jsonb_build_object(
    'as_of', p_as_of, 'weeks_count', v_weeks, 'estimates', p_estimates, 'currency', v_base,
    'opening', (select v from opening),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', account_kind, 'currency', currency_code, 'balance', round(balance, 2)) order by account_kind, name) from banks), '[]'),
    'weeks', (select jsonb_agg(to_jsonb(run) - 'start_d' - 'end_d' || jsonb_build_object('start', start_d, 'end', end_d, 'closing', round(closing, 2)) order by week) from run),
    'first_negative_week', (select min(week) from run where closing < 0),
    'lowest', (select jsonb_build_object('week', week, 'closing', round(closing, 2)) from run order by closing, week limit 1),
    'overdue_in', coalesce((select sum(amount) from pg_temp.cf_flows where kind = 'receipt' and overdue), 0),
    'overdue_out', coalesce((select -sum(amount) from pg_temp.cf_flows where kind = 'bill' and overdue), 0),
    'doubtful', coalesce((select sum(round(i.amount_due * i.exchange_rate, 2)) from public.sales_invoices i
                           where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and i.document_type = 'sales_invoice'
                             and i.amount_due > 0 and coalesce(i.due_date, i.invoice_date) < p_as_of - 180), 0),
    'avg_late_days', v_avg_late,
    'ar_open', (select v from ar), 'ap_open', (select v from ap),
    'dso', case when (select v from s90) > 0 then round((select v from ar) / (select v from s90) * 90) end,
    'dpo', case when (select v from b90) > 0 then round((select v from ap) / (select v from b90) * 90) end,
    'customers', coalesce((select jsonb_agg(c order by c.amount desc) from (
        select f.partner_id as id, f.partner as name, sum(f.amount) as amount, max(f.late) as late_days, count(*) as docs,
               bool_or(f.overdue) as overdue
          from pg_temp.cf_flows f where f.kind = 'receipt' and f.d <= v_end group by f.partner_id, f.partner order by 3 desc limit 10) c), '[]'),
    'flows', coalesce((select jsonb_agg(jsonb_build_object('date', f.d, 'week', (f.d - p_as_of) / 7 + 1, 'kind', f.kind, 'label', f.label,
                                                          'partner_id', f.partner_id, 'partner', f.partner, 'amount', f.amount, 'ref', f.ref, 'overdue', f.overdue)
                                        order by f.d, f.amount)
                         from pg_temp.cf_flows f where f.d <= v_end and f.kind not in ('sales_in', 'other_out', 'future_sales', 'future_bills')), '[]')
  ) into v_out;
  return v_out;
end $$;

-- the supplier bills to pay, best first: overdue, then early-payment discounts still open, then by due date
create or replace function public.payment_proposal(p_company uuid, p_as_of date default current_date)
returns table (bill_id uuid, number text, vendor_invoice_number text, vendor_id uuid, vendor_name text, vendor_iban text,
               bill_date date, due_date date, days_overdue int, currency_code text, total numeric, open_amount numeric, open_base numeric,
               discount_amount numeric, discount_until date, reason text, priority int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'invoicing.read');
  return query
  select b.id, b.number, b.vendor_invoice_number, b.vendor_id, bp.name, bp.bank_iban, b.bill_date, b.due_date,
         greatest(p_as_of - coalesce(b.due_date, b.bill_date), 0)::int,
         b.currency_code::text, b.total, b.amount_due, round(b.amount_due * b.exchange_rate, 2),
         case when pt.discount_pct > 0 and b.bill_date + pt.discount_days >= p_as_of then round(b.amount_due * pt.discount_pct / 100, 2) else 0 end,
         case when pt.discount_pct > 0 and b.bill_date + pt.discount_days >= p_as_of then b.bill_date + pt.discount_days end,
         x.reason,
         case x.reason when 'overdue' then 1 when 'discount' then 2 when 'due_soon' then 3 else 4 end
    from public.vendor_bills b
    join public.business_partners bp on bp.id = b.vendor_id
    left join public.payment_terms pt on pt.id = coalesce(b.payment_term_id, bp.payment_term_id)
    cross join lateral (select case
        when coalesce(b.due_date, b.bill_date) < p_as_of then 'overdue'
        when pt.discount_pct > 0 and b.bill_date + pt.discount_days >= p_as_of then 'discount'
        when coalesce(b.due_date, b.bill_date) <= p_as_of + 7 then 'due_soon'
        else 'later' end as reason) x
   where b.company_id = p_company and b.status = 'posted' and b.deleted_at is null and b.document_type = 'vendor_bill' and b.amount_due > 0
   order by 17, coalesce(b.due_date, b.bill_date), b.amount_due desc;
end $$;

-- pays the chosen bills from one bank or cash account: one payment per supplier
-- p_items: [{"bill": uuid, "amount": numeric (optional, defaults to what is open)}]
create or replace function public.pay_vendor_bills(p_company uuid, p_bank uuid, p_date date, p_items jsonb, p_reference text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_bank public.bank_accounts; g record; v_pay uuid; v_status text; v_out jsonb := '[]'; v_bad text;
begin
  perform app.require_permission(p_company, 'invoicing.write');
  select * into v_bank from public.bank_accounts where id = p_bank and company_id = p_company and is_active and deleted_at is null;
  if v_bank.id is null then raise exception 'Choose the bank or cash account to pay from' using errcode = '23514'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Choose at least one bill' using errcode = '23514'; end if;

  create temp table if not exists pg_temp.pv_items (bill uuid, vendor uuid, amount numeric, ref text) on commit drop;
  truncate pg_temp.pv_items;
  insert into pg_temp.pv_items
  select b.id, b.vendor_id, round(least(coalesce(nullif(it ->> 'amount', '')::numeric, b.amount_due), b.amount_due), 2), coalesce(b.vendor_invoice_number, b.number)
    from jsonb_array_elements(p_items) it
    join public.vendor_bills b on b.id = (it ->> 'bill')::uuid
   where b.company_id = p_company and b.status = 'posted' and b.deleted_at is null and b.document_type = 'vendor_bill' and b.amount_due > 0;
  if (select count(*) from pg_temp.pv_items) <> jsonb_array_length(p_items) then
    raise exception 'Some of the bills are already paid or no longer open; refresh the list' using errcode = '23514';
  end if;
  if exists (select 1 from pg_temp.pv_items where amount <= 0) then raise exception 'Amounts must be above zero' using errcode = '23514'; end if;
  select string_agg(distinct b.currency_code, ', ') into v_bad from pg_temp.pv_items i join public.vendor_bills b on b.id = i.bill where b.currency_code <> v_bank.currency_code;
  if v_bad is not null then
    raise exception 'Bills in % must be paid from an account in that currency; % is in %', v_bad, v_bank.name, v_bank.currency_code using errcode = '23514';
  end if;

  for g in select i.vendor, sum(i.amount) as amount, string_agg(i.ref, ', ' order by i.ref) as refs from pg_temp.pv_items i group by i.vendor loop
    insert into public.payments (company_id, document_type, partner_id, payment_date, method, amount, currency_code, bank_account_id, reference)
    values (p_company, 'vendor_payment', g.vendor, p_date, case when v_bank.account_kind = 'cash' then 'cash' else 'bank_transfer' end,
            g.amount, v_bank.currency_code, v_bank.id, left(coalesce(nullif(trim(p_reference), ''), g.refs), 200))
    returning id into v_pay;
    insert into public.payment_allocations (company_id, payment_id, vendor_bill_id, amount)
    select p_company, v_pay, i.bill, i.amount from pg_temp.pv_items i where i.vendor = g.vendor;
    v_status := public.post_payment(v_pay);
    v_out := v_out || jsonb_build_object('id', v_pay, 'number', (select number from public.payments where id = v_pay),
                                         'vendor', (select name from public.business_partners where id = g.vendor), 'amount', g.amount, 'status',
                                         (select status from public.payments where id = v_pay));
  end loop;
  return jsonb_build_object('payments', v_out, 'count', jsonb_array_length(v_out), 'total', (select sum(amount) from pg_temp.pv_items));
end $$;

revoke execute on function app.customer_lateness(uuid) from public, anon, authenticated;
revoke execute on function public.cash_forecast(uuid, int, date, boolean), public.payment_proposal(uuid, date),
                           public.pay_vendor_bills(uuid, uuid, date, jsonb, text) from public, anon;
grant execute on function public.cash_forecast(uuid, int, date, boolean), public.payment_proposal(uuid, date),
                          public.pay_vendor_bills(uuid, uuid, date, jsonb, text) to authenticated;
