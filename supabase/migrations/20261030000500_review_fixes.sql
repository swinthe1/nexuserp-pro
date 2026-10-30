-- =============================================================================
-- Fixes from the full review (October 2026)
--  * Debts (partner_aging): compensations, credit notes for an invoice and withholding tax now
--    reduce what is open, the same way the partner card counts it
--  * open items: withholding tax reduces a supplier bill
--  * cash forecast: VAT from the books (tills included) and what is still owed on filed returns;
--    weekly averages only from till sales and bank fees; repeating invoices not counted twice;
--    payments dated later move money on their date; monthly items keep their day; balances in the account's currency
--  * bank position: an entry dated after the statement is not in the books on the statement day
--  * paying supplier bills: the bills are locked, the same bill twice is refused
--  * payment terms: whole days and a percent for every part; a hand-made schedule that no longer adds up is scaled
--  * company admins change the personal details only of people who are in no other company
--  * stock on a date and the safe balance follow the books (company time zone, deleted entries)
-- =============================================================================

create or replace function public.cash_forecast(p_company uuid, p_weeks integer DEFAULT 13, p_as_of date DEFAULT CURRENT_DATE, p_estimates boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_weeks int := greatest(4, least(coalesce(p_weeks, 13), 26));
  v_end date := p_as_of + v_weeks * 7 - 1;
  v_country text; v_base text; v_vat_day int;
  v_avg_late numeric;
  v_out jsonb;
  v_vat_acc uuid; v_out_acc uuid; v_in_acc uuid; v_vat_owed numeric; v_last record; v_credit numeric; v_avg3 numeric; v_start date; vm record; v_pay numeric; v_used numeric;
begin
  perform app.require_permission(p_company, 'finance.read');
  select country_code, base_currency into v_country, v_base from public.companies where id = p_company;
  v_vat_day := case when v_country = 'AL' then 14 else 20 end;

  select coalesce(round(sum(late_days * paid_docs) / nullif(sum(paid_docs), 0), 1), 0) into v_avg_late from app.customer_lateness(p_company);

  create temp table if not exists pg_temp.cf_flows (d date, kind text, label text, partner_id uuid, partner text, amount numeric, ref uuid, overdue boolean, late numeric) on commit drop;
  truncate pg_temp.cf_flows;

  -- 1. customers: open invoices, moved by how late each customer usually pays; very old ones are left out as doubtful
  insert into pg_temp.cf_flows
  select greatest(pt.due + round(coalesce(l.late_days, v_avg_late))::int, p_as_of), 'receipt', i.number || coalesce(' · ' || pt.seq, ''), i.partner_id, bp.name,
         round(pt.open * i.exchange_rate, 2), i.id, pt.due < p_as_of, coalesce(l.late_days, v_avg_late)
    from public.sales_invoices i
    cross join lateral app.doc_parts(i.id, null, i.total, i.amount_due, i.due_date) pt
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
  select greatest(pt.due, p_as_of), 'bill', coalesce(b.vendor_invoice_number, b.number) || coalesce(' · ' || pt.seq, ''), b.vendor_id, bp.name,
         -round(pt.open * b.exchange_rate, 2), b.id, pt.due < p_as_of, null
    from public.vendor_bills b
    cross join lateral app.doc_parts(null::uuid, b.id, b.total, b.amount_due, coalesce(b.due_date, b.bill_date)) pt
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
    cross join lateral (select (lr.pay_date + make_interval(months => k))::date as d from generate_series(1, 30) k) g
   where g.d between p_as_of and v_end;

  -- 5. VAT, paid on the 20th (14th in Albania) of the next month.
  --    Filed returns: what is still owed on the VAT settlement account (a payment already made is not counted again).
  --    Months not filed yet: output VAT − input VAT from the books (invoices, bills and the tills),
  --    less any credit carried forward; months still to come use the average of the last three.
  select account_id into v_vat_acc from public.company_account_defaults where company_id = p_company and key = 'vat_settlement';
  select account_id into v_out_acc from public.company_account_defaults where company_id = p_company and key = 'vat_output';
  select account_id into v_in_acc from public.company_account_defaults where company_id = p_company and key = 'vat_input';
  select d.period_start, d.period_end, coalesce(d.carry_forward, 0) as carry into v_last
    from public.vat_declarations d
   where d.company_id = p_company and d.deleted_at is null and d.status in ('submitted', 'accepted')
   order by d.period_end desc limit 1;
  if v_vat_acc is not null then
    select coalesce(sum(jl.credit - jl.debit), 0) into v_vat_owed
      from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id
     where jl.account_id = v_vat_acc and je.status = 'posted' and je.deleted_at is null and je.entry_date <= p_as_of;
    if v_vat_owed > 0.005 and v_last.period_end is not null then
      insert into pg_temp.cf_flows values (greatest((date_trunc('month', v_last.period_end) + interval '1 month')::date + (v_vat_day - 1), p_as_of),
        'vat', to_char(v_last.period_start, 'MM.YYYY'), null, null, -round(v_vat_owed, 2), null,
        (date_trunc('month', v_last.period_end) + interval '1 month')::date + (v_vat_day - 1) < p_as_of, null);
    end if;
  end if;
  if v_out_acc is not null or v_in_acc is not null then
    create temp table if not exists pg_temp.cf_vat (m_start date, m_end date, net numeric) on commit drop;
    truncate pg_temp.cf_vat;
    insert into pg_temp.cf_vat
    select m::date, (m + interval '1 month' - interval '1 day')::date,
           coalesce((select sum(jl.credit - jl.debit)
                       from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id
                      where jl.account_id in (v_out_acc, v_in_acc) and je.company_id = p_company and je.status = 'posted' and je.deleted_at is null
                        and coalesce(je.source_doc_type, '') <> 'vat_declaration'
                        and je.entry_date between m::date and (m + interval '1 month' - interval '1 day')::date), 0)
      from generate_series(date_trunc('month', p_as_of) - interval '3 months', date_trunc('month', v_end), interval '1 month') m;
    select coalesce(avg(greatest(net, 0)), 0) into v_avg3 from pg_temp.cf_vat where m_end < date_trunc('month', p_as_of)::date;
    -- the first month not filed whose VAT is still to be paid
    v_start := greatest(coalesce((date_trunc('month', v_last.period_end) + interval '1 month')::date, '0001-01-01'::date),
                        case when extract(day from p_as_of) <= v_vat_day then (date_trunc('month', p_as_of) - interval '1 month')::date
                             else date_trunc('month', p_as_of)::date end);
    v_credit := coalesce(v_last.carry, 0);
    for vm in select * from pg_temp.cf_vat where m_start >= v_start order by m_start loop
      v_pay := case when vm.m_end < date_trunc('month', p_as_of)::date then vm.net
                    when vm.m_start <= p_as_of then greatest(vm.net, v_avg3) else v_avg3 end;
      if v_pay < 0 then v_credit := v_credit - v_pay; v_pay := 0;
      else v_used := least(v_credit, v_pay); v_pay := v_pay - v_used; v_credit := v_credit - v_used; end if;
      if v_pay > 0.005 and (vm.m_end + 1) + (v_vat_day - 1) <= v_end then
        insert into pg_temp.cf_flows values (greatest((vm.m_end + 1) + (v_vat_day - 1), p_as_of), 'vat', to_char(vm.m_start, 'MM.YYYY'), null, null,
                                             -round(v_pay, 2), null, false, null);
      end if;
    end loop;
  end if;

  -- 6. the owner's own items
  insert into pg_temp.cf_flows
  select g.d, 'plan_' || c.direction, c.name, null, null, case when c.direction = 'in' then c.amount else -c.amount end, c.id, false, null
    from public.cash_plan_items c
    cross join lateral (select (c.first_date + make_interval(months => k * c.every_months))::date as d
                          from generate_series(0, case when c.every_months = 0 then 0 else 60 end) k) g
   where c.company_id = p_company and c.is_active and g.d between p_as_of and least(coalesce(c.end_date, v_end), v_end);

  -- 7. money that moves regularly without an invoice or a bill (till sales, bank fees booked from statements):
  --    the weekly average of the last 8 weeks, carried forward
  insert into pg_temp.cf_flows
  with mv as (
    select je.id, je.entry_date, sum(jl.debit - jl.credit) as net
      from public.journal_lines jl
      join public.journal_entries je on je.id = jl.entry_id
      join public.bank_accounts ba on ba.account_id = jl.account_id and ba.company_id = p_company
     where je.company_id = p_company and je.status = 'posted' and je.deleted_at is null
       and je.entry_date between p_as_of - 56 and p_as_of - 1
       and (je.source_doc_type in ('pos_session', 'pos_order', 'safe_count')
            or exists (select 1 from public.bank_statement_lines l where l.journal_entry_id = je.id))
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
         and i.invoice_date between p_as_of - 56 and p_as_of - 1 and coalesce(i.source, '') not in ('pos', 'z_report') and i.recurring_id is null
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

  -- 9. payments already posted with a later date: the money moves on that date
  insert into pg_temp.cf_flows
  select p.payment_date, case when p.document_type = 'customer_payment' then 'receipt' else 'bill' end, p.number, p.partner_id, bp.name,
         round(p.amount * p.exchange_rate, 2) * case when p.document_type = 'customer_payment' then 1 else -1 end, p.id, false, null
    from public.payments p join public.business_partners bp on bp.id = p.partner_id
   where p.company_id = p_company and p.status = 'posted' and p.deleted_at is null and p.payment_date > p_as_of and p.payment_date <= v_end;

  with banks as (
    select ba.id, ba.name, ba.account_kind, ba.currency_code,
           coalesce((select sum(jl.debit - jl.credit) from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id
                      where jl.account_id = ba.account_id and je.status = 'posted' and je.deleted_at is null and je.entry_date <= p_as_of), 0) as balance,
           coalesce((select sum(case when jl.currency_code = ba.currency_code and jl.amount_currency is not null then jl.amount_currency else jl.debit - jl.credit end)
                       from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id
                      where jl.account_id = ba.account_id and je.status = 'posted' and je.deleted_at is null and je.entry_date <= p_as_of), 0) as balance_cur
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
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', account_kind, 'currency', currency_code, 'balance', round(balance, 2), 'balance_currency', round(balance_cur, 2)) order by account_kind, name) from banks), '[]'),
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
end $function$;

create or replace function public.bank_position(p_company uuid, p_as_of date DEFAULT CURRENT_DATE)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_out jsonb;
begin
  perform app.require_permission(p_company, 'finance.read');

  with acc as (
    select ba.id, ba.name, ba.account_kind, ba.currency_code, ba.bank_name, ba.iban, ba.account_id
      from public.bank_accounts ba
     where ba.company_id = p_company and ba.is_active and ba.deleted_at is null
  ),
  -- the account's movements in its own currency (base-currency accounts: debit − credit)
  mv as (
    select a.id as bank_id, jl.id as line_id, jl.entry_id, je.entry_date, je.number as entry_number, coalesce(jl.description, je.memo) as description,
           case when jl.currency_code = a.currency_code and jl.amount_currency is not null then jl.amount_currency else jl.debit - jl.credit end as amount
      from acc a
      join public.journal_lines jl on jl.account_id = a.account_id
      join public.journal_entries je on je.id = jl.entry_id and je.status = 'posted' and je.deleted_at is null
     where je.company_id = p_company and je.entry_date <= p_as_of
  ),
  last_st as (
    select distinct on (s.bank_account_id) s.bank_account_id, s.id, s.statement_date, s.closing_balance, s.status, s.reference
      from public.bank_statements s
     where s.company_id = p_company and s.deleted_at is null and s.statement_date <= p_as_of
     order by s.bank_account_id, s.statement_date desc, s.created_at desc
  ),
  first_day as (
    select s.bank_account_id, min(coalesce(l.transaction_date, s.statement_date)) as d
      from public.bank_statements s left join public.bank_statement_lines l on l.statement_id = s.id
     where s.company_id = p_company and s.deleted_at is null group by s.bank_account_id
  ),
  -- what the statements already explain: matched payments, matched lines, entries booked from a line
  seen as (
    select p.journal_entry_id as entry_id, null::uuid as line_id from public.bank_statement_lines l join public.payments p on p.id = l.matched_payment_id
     where l.company_id = p_company and p.journal_entry_id is not null
    union all select null, l.matched_journal_line_id from public.bank_statement_lines l where l.company_id = p_company and l.matched_journal_line_id is not null
    union all select l.journal_entry_id, null from public.bank_statement_lines l where l.company_id = p_company and l.journal_entry_id is not null
  ),
  not_in_bank as (
    select m.* from mv m
      join last_st ls on ls.bank_account_id = m.bank_id
      join first_day fd on fd.bank_account_id = m.bank_id
     where m.entry_date between fd.d and ls.statement_date
       and not exists (select 1 from seen s where s.entry_id = m.entry_id or s.line_id = m.line_id)
  ),
  not_in_books as (
    select s.bank_account_id as bank_id, l.id, l.transaction_date, l.description, l.counterparty_name, l.amount, s.id as statement_id
      from public.bank_statement_lines l join public.bank_statements s on s.id = l.statement_id
     where l.company_id = p_company and s.deleted_at is null and s.statement_date <= p_as_of
       and (
         (l.match_status = 'unmatched' and l.journal_entry_id is null)
         -- matched or booked, but the entry is dated after the statement: not in the books on the statement day
         or coalesce((select je.entry_date from public.payments p join public.journal_entries je on je.id = p.journal_entry_id where p.id = l.matched_payment_id),
                     (select je.entry_date from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id where jl.id = l.matched_journal_line_id),
                     (select je.entry_date from public.journal_entries je where je.id = l.journal_entry_id)) > s.statement_date)
  ),
  rows as (
    select a.*,
           round(coalesce((select sum(amount) from mv where mv.bank_id = a.id), 0), 2) as book_now,
           round(coalesce((select sum(debit - credit) from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id
                            where jl.account_id = a.account_id and je.status = 'posted' and je.deleted_at is null and je.entry_date <= p_as_of), 0), 2) as book_base,
           ls.id as st_id, ls.statement_date, ls.closing_balance, ls.status as st_status, ls.reference as st_reference,
           case when ls.id is not null then round(coalesce((select sum(amount) from mv where mv.bank_id = a.id and mv.entry_date <= ls.statement_date), 0), 2) end as book_at_st,
           round(coalesce((select sum(amount) from not_in_books n where n.bank_id = a.id), 0), 2) as nib_sum,
           (select count(*) from not_in_books n where n.bank_id = a.id) as nib_n,
           round(coalesce((select sum(amount) from not_in_bank n where n.bank_id = a.id), 0), 2) as nibank_sum,
           (select count(*) from not_in_bank n where n.bank_id = a.id) as nibank_n,
           round(coalesce((select sum(amount) from mv where mv.bank_id = a.id and mv.entry_date > p_as_of - 30 and amount > 0), 0), 2) as in_30,
           round(coalesce((select -sum(amount) from mv where mv.bank_id = a.id and mv.entry_date > p_as_of - 30 and amount < 0), 0), 2) as out_30
      from acc a left join last_st ls on ls.bank_account_id = a.id
  )
  select jsonb_build_object(
    'as_of', p_as_of,
    'base_currency', (select base_currency from public.companies where id = p_company),
    'accounts', coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'kind', r.account_kind, 'currency', r.currency_code, 'bank_name', r.bank_name, 'iban', r.iban, 'account_id', r.account_id,
        'book_balance', r.book_now, 'book_balance_base', r.book_base, 'in_30', r.in_30, 'out_30', r.out_30,
        'statement', case when r.st_id is not null then jsonb_build_object(
            'id', r.st_id, 'date', r.statement_date, 'closing', r.closing_balance, 'status', r.st_status, 'reference', r.st_reference,
            'days_old', p_as_of - r.statement_date,
            'book_at_date', r.book_at_st,
            'difference', round(r.closing_balance - r.book_at_st, 2),
            'not_in_books', r.nib_sum, 'not_in_books_count', r.nib_n,
            'not_in_bank', r.nibank_sum, 'not_in_bank_count', r.nibank_n,
            -- statement = books + what only the bank has − what only the books have; the rest is not explained
            'unexplained', round(r.closing_balance - r.book_at_st - r.nib_sum + r.nibank_sum, 2)) end,
        'not_in_books_items', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'date', n.transaction_date, 'description', coalesce(n.counterparty_name, n.description),
                                                                            'amount', n.amount, 'statement_id', n.statement_id) order by n.transaction_date desc)
                                          from (select * from not_in_books n where n.bank_id = r.id order by n.transaction_date desc limit 30) n), '[]'),
        'not_in_bank_items', coalesce((select jsonb_agg(jsonb_build_object('entry_id', n.entry_id, 'date', n.entry_date, 'number', n.entry_number, 'description', n.description,
                                                                          'amount', round(n.amount, 2)) order by n.entry_date desc)
                                         from (select * from not_in_bank n where n.bank_id = r.id order by n.entry_date desc limit 30) n), '[]')
      ) order by r.account_kind, r.name), '[]')
  ) into v_out
  from rows r;
  return v_out;
end $function$;

create or replace function public.pay_vendor_bills(p_company uuid, p_bank uuid, p_date date, p_items jsonb, p_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_bank public.bank_accounts; g record; v_pay uuid; v_status text; v_out jsonb := '[]'; v_bad text;
begin
  perform app.require_permission(p_company, 'invoicing.write');
  select * into v_bank from public.bank_accounts where id = p_bank and company_id = p_company and is_active and deleted_at is null;
  if v_bank.id is null then raise exception 'Choose the bank or cash account to pay from' using errcode = '23514'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Choose at least one bill' using errcode = '23514'; end if;

  if (select count(*) from jsonb_array_elements(p_items) it) <> (select count(distinct it ->> 'bill') from jsonb_array_elements(p_items) it) then
    raise exception 'The same bill is chosen twice' using errcode = '23514';
  end if;
  -- two people paying the same bills at once: the second waits, then sees what is still open
  perform 1 from public.vendor_bills b where b.id in (select (it ->> 'bill')::uuid from jsonb_array_elements(p_items) it) order by b.id for update;

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
end $function$;

-- Debts: open the way the partner card counts it
create or replace function public.partner_aging(p_company uuid, p_kind text, p_as_of date default current_date)
returns table (partner_id uuid, partner_name text, not_due numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, d90_plus numeric,
               unapplied numeric, total numeric, oldest_due date, documents int)
language sql stable security invoker set search_path = '' as $$
  with raw as (
    select i.id as inv, null::uuid as bill, i.partner_id, i.due_date, i.document_type, i.total, i.exchange_rate,
           i.total - coalesce((select sum(a.amount) from public.payment_allocations a join public.payments p on p.id = a.payment_id
                                where a.sales_invoice_id = i.id and p.status = 'posted' and p.payment_date <= p_as_of), 0)
                   - coalesce((select sum(cl.amount) from public.compensation_lines cl join public.compensations c on c.id = cl.compensation_id
                                where cl.sales_invoice_id = i.id and c.status = 'posted' and c.comp_date <= p_as_of), 0)
                   - case when i.document_type = 'sales_invoice' then coalesce((select sum(cn.total) from public.sales_invoices cn where cn.original_invoice_id = i.id
                                and cn.document_type = 'credit_note' and cn.status = 'posted' and cn.deleted_at is null and cn.invoice_date <= p_as_of), 0) else 0 end as open_doc,
           case when i.document_type = 'credit_note' then -1 else 1 end as sgn
      from public.sales_invoices i
     where p_kind = 'ar' and i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and i.invoice_date <= p_as_of
       and not (i.document_type = 'credit_note' and i.original_invoice_id is not null)
    union all
    select null, b.id, b.vendor_id, b.due_date, b.document_type, b.total, b.exchange_rate,
           b.total - coalesce((select sum(a.amount) from public.payment_allocations a join public.payments p on p.id = a.payment_id
                                where a.vendor_bill_id = b.id and p.status = 'posted' and p.payment_date <= p_as_of), 0)
                   - coalesce((select sum(cl.amount) from public.compensation_lines cl join public.compensations c on c.id = cl.compensation_id
                                where cl.vendor_bill_id = b.id and c.status = 'posted' and c.comp_date <= p_as_of), 0)
                   - case when b.document_type = 'vendor_bill' then coalesce((select sum(w.amount) from public.withholdings w
                                where w.bill_id = b.id and w.status = 'posted' and w.wh_date <= p_as_of), 0)
                                + coalesce((select sum(cn.total) from public.vendor_bills cn where cn.original_bill_id = b.id
                                and cn.document_type = 'vendor_credit' and cn.status = 'posted' and cn.deleted_at is null and cn.bill_date <= p_as_of), 0) else 0 end,
           case when b.document_type = 'vendor_credit' then -1 else 1 end
      from public.vendor_bills b
     where p_kind = 'ap' and b.company_id = p_company and b.status = 'posted' and b.deleted_at is null and b.bill_date <= p_as_of
       and not (b.document_type = 'vendor_credit' and b.original_bill_id is not null)
  ),
  docs as (
    select r.partner_id, pt.due as due_date, r.document_type, round(pt.open * r.exchange_rate, 2) * r.sgn as open_base
      from raw r cross join lateral app.doc_parts(r.inv, r.bill, r.total, r.open_doc, r.due_date) pt
  ),
  unapplied as (
    select p.partner_id, -sum(round(p.unallocated * p.exchange_rate, 2)) as amount
      from public.payments p
     where p.company_id = p_company and p.status = 'posted' and p.payment_date <= p_as_of and p.unallocated > 0
       and p.document_type = case when p_kind = 'ar' then 'customer_payment' else 'vendor_payment' end
     group by p.partner_id
  ),
  agg as (
    select d.partner_id,
           sum(case when d.document_type in ('credit_note','vendor_credit') or d.due_date >= p_as_of then d.open_base else 0 end) as not_due,
           sum(case when d.document_type not in ('credit_note','vendor_credit') and p_as_of - d.due_date between 1 and 30 then d.open_base else 0 end) as d1_30,
           sum(case when d.document_type not in ('credit_note','vendor_credit') and p_as_of - d.due_date between 31 and 60 then d.open_base else 0 end) as d31_60,
           sum(case when d.document_type not in ('credit_note','vendor_credit') and p_as_of - d.due_date between 61 and 90 then d.open_base else 0 end) as d61_90,
           sum(case when d.document_type not in ('credit_note','vendor_credit') and p_as_of - d.due_date > 90 then d.open_base else 0 end) as d90_plus,
           min(d.due_date) filter (where d.open_base > 0) as oldest_due,
           count(*) filter (where d.open_base <> 0) as documents
      from docs d where d.open_base <> 0 group by d.partner_id
  )
  select bp.id, bp.name, coalesce(a.not_due, 0), coalesce(a.d1_30, 0), coalesce(a.d31_60, 0), coalesce(a.d61_90, 0), coalesce(a.d90_plus, 0),
         coalesce(u.amount, 0),
         coalesce(a.not_due, 0) + coalesce(a.d1_30, 0) + coalesce(a.d31_60, 0) + coalesce(a.d61_90, 0) + coalesce(a.d90_plus, 0) + coalesce(u.amount, 0),
         a.oldest_due, coalesce(a.documents, 0)::int
    from public.business_partners bp
    left join agg a on a.partner_id = bp.id
    left join unapplied u on u.partner_id = bp.id
   where bp.company_id = p_company and (a.partner_id is not null or u.partner_id is not null)
   order by 9 desc
$$;

-- open items: withholding tax reduces a supplier bill
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
do $$ begin
  perform app._patch_function('app.open_items',
    $p$                        where cl.vendor_bill_id = b.id and c.status = 'posted' and c.comp_date <= p_date), 0)$p$,
    $p$                        where cl.vendor_bill_id = b.id and c.status = 'posted' and c.comp_date <= p_date), 0)
           - case when b.document_type = 'vendor_bill' then coalesce((select sum(w.amount) from public.withholdings w
                        where w.bill_id = b.id and w.status = 'posted' and w.wh_date <= p_date), 0) else 0 end$p$);
  -- the safe balance leaves out deleted entries, like the books
  perform app._patch_function('app.safe_balance',
    $p$   where jl.account_id = app.safe_account(p_safe) and je.status = 'posted'$p$,
    $p$   where jl.account_id = app.safe_account(p_safe) and je.status = 'posted' and je.deleted_at is null$p$);
end $$;
drop function app._patch_function(text, text, text);

-- stock on a date: the day in the company's time zone, as the books use it
create or replace function app.stock_as_of(p_company uuid, p_as_of date)
returns table (variant_id uuid, warehouse_id uuid, qty numeric, value numeric, last_out date, last_in date)
language sql stable security definer set search_path = '' as $$
  with tz as (select coalesce(timezone, 'Europe/Tirane') as z from public.companies where id = p_company),
  m as (
    select sm.variant_id, sm.to_warehouse_id as warehouse_id, sm.quantity as q, coalesce(sm.total_cost, round(sm.quantity * sm.unit_cost, 2)) as v,
           null::date as out_d, case when sm.quantity > 0 then (sm.movement_date at time zone (select z from tz))::date end as in_d
      from public.stock_movements sm
     where sm.company_id = p_company and sm.to_warehouse_id is not null and (sm.movement_date at time zone (select z from tz))::date <= p_as_of
    union all
    select sm.variant_id, sm.from_warehouse_id, -sm.quantity, -coalesce(sm.total_cost, round(sm.quantity * sm.unit_cost, 2)),
           case when sm.movement_type in ('delivery','pos_sale','production_consume') then (sm.movement_date at time zone (select z from tz))::date end, null
      from public.stock_movements sm
     where sm.company_id = p_company and sm.from_warehouse_id is not null and (sm.movement_date at time zone (select z from tz))::date <= p_as_of
  )
  select variant_id, warehouse_id, sum(q), sum(v), max(out_d), max(in_d) from m group by variant_id, warehouse_id
$$;

-- payment terms: whole days, and every part has a percent
create or replace function app.instalments_valid(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select p is null or (
    jsonb_typeof(p) = 'array' and jsonb_array_length(p) between 2 and 24
    and not exists (select 1 from jsonb_array_elements(p) e
                     where coalesce(jsonb_typeof(e -> 'pct'), '') <> 'number' or coalesce(jsonb_typeof(e -> 'days'), '') <> 'number'
                        or (e ->> 'pct')::numeric <= 0 or (e ->> 'days')::numeric < 0
                        or (e ->> 'days')::numeric <> trunc((e ->> 'days')::numeric))
    and (select sum((e ->> 'pct')::numeric) from jsonb_array_elements(p) e) = 100
    and (select bool_and(d >= coalesce(prev, -1)) from (
           select (e ->> 'days')::numeric as d, lag((e ->> 'days')::numeric) over (order by o) as prev
             from jsonb_array_elements(p) with ordinality x(e, o)) y)
  )
$$;

-- posting a document whose hand-made schedule no longer adds up: scale it to the new total
create or replace function app.tg_instalments_on_post()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sum numeric; v_n int; v_left numeric; r record; k int := 0;
begin
  if new.status = 'posted' and old.status is distinct from 'posted' and new.document_type in ('sales_invoice', 'vendor_bill') then
    select sum(amount), count(*) into v_sum, v_n from public.document_instalments
     where (tg_table_name = 'sales_invoices' and sales_invoice_id = new.id) or (tg_table_name = 'vendor_bills' and vendor_bill_id = new.id);
    if v_sum is null then
      if tg_table_name = 'sales_invoices' then perform app.make_instalments(new.id, null); else perform app.make_instalments(null, new.id); end if;
    elsif abs(v_sum - new.total) > 0.005 then
      if new.total <= 0 then
        delete from public.document_instalments where (tg_table_name = 'sales_invoices' and sales_invoice_id = new.id) or (tg_table_name = 'vendor_bills' and vendor_bill_id = new.id);
      else
        v_left := new.total;
        for r in select id, amount from public.document_instalments
                  where (tg_table_name = 'sales_invoices' and sales_invoice_id = new.id) or (tg_table_name = 'vendor_bills' and vendor_bill_id = new.id)
                  order by seq loop
          k := k + 1;
          update public.document_instalments set amount = case when k = v_n then v_left else round(r.amount * new.total / v_sum, 2) end where id = r.id;
          v_left := v_left - round(r.amount * new.total / v_sum, 2);
        end loop;
      end if;
    end if;
  end if;
  return null;
end $$;

-- a company admin changes the personal details only of people who are in no other company
create or replace function app.member_profile_allowed(p_company uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user = auth.uid()
      or app.is_super_admin()
      or (p_company is not null and app.has_permission(p_company, 'admin.write')
          and exists (select 1 from public.company_members m where m.company_id = p_company and m.user_id = p_user and m.deleted_at is null and m.status <> 'removed')
          and not exists (select 1 from public.company_members m where m.user_id = p_user and m.company_id <> p_company and m.deleted_at is null and m.status <> 'removed')
          and not coalesce((select is_super_admin from public.profiles where id = p_user), false))
$$;

-- lookups that grow
create index if not exists push_outbox_subscription_idx on app.push_outbox (subscription_id);
create index if not exists assistant_jobs_conversation_idx on app.assistant_jobs (conversation_id);
create index if not exists sync_agent_logs_company_idx on public.sync_agent_logs (company_id);
create index if not exists portal_links_company_idx on public.portal_links (company_id);

-- numbering that restarts every year must show the year, or the numbers of two years collide
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
do $$ begin
  perform app._patch_function('public.save_numbering',
    $p$  if p_reset_policy not in ('yearly','never') then raise exception 'Restart numbering every year or never' using errcode = '23514'; end if;$p$,
    $p$  if p_reset_policy not in ('yearly','never') then raise exception 'Restart numbering every year or never' using errcode = '23514'; end if;
  if p_reset_policy = 'yearly' and not p_include_year then
    raise exception 'Numbering that restarts every year must show the year, or the numbers of two years would be the same' using errcode = '23514';
  end if;$p$);
end $$;
drop function app._patch_function(text, text, text);
