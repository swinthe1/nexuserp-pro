-- =============================================================================
-- DrisPRO · the tax calendar knows every tax a company files, and only the ones it files (audit, wave 1)
--   * VAT returns only for a company registered for VAT: a VAT number, or VAT returns already made
--     (before, a small business saw VAT "overdue")
--   * withholding tax: each month in which tax was withheld (Kosovo by the 15th, Albania by the 20th)
--   * Kosovo small business (no VAT number): the quarterly tax, by the 15th after the quarter
--   * Kosovo company with a VAT number: the profit tax instalment, by the 15th after the quarter
--   * payroll as before
--   The program does not know whether a withholding return or an instalment was filed or paid, so
--   after its date such a row says "passed" (check it), not "overdue", and stops reminding.
--   Reminders and the automatic tasks name each tax; the menu learns whether the company has VAT.
-- =============================================================================

-- registered for VAT: a VAT number in the company details, or VAT returns already made in the program
create or replace function app.company_vat_registered(p_company uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select coalesce(c.vat_number, '') <> '' from public.companies c where c.id = p_company), false)
      or exists (select 1 from public.vat_declarations v where v.company_id = p_company and v.deleted_at is null)
$$;
revoke all on function app.company_vat_registered(uuid) from public, anon;

create or replace function app.tax_deadlines(p_company uuid, p_months integer)
returns table (obligation text, period_start date, period_end date, due_date date, status text, document_id uuid, document_number text, amount numeric)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_country text; v_vat_reg boolean; v_rate numeric; m date; v_vat int; v_pay int; v_wh int;
  v_from date; v_last date; q date; v_due date; v_amt numeric;
begin
  select c.country_code into v_country from public.companies c where c.id = p_company;
  v_vat_reg := app.company_vat_registered(p_company);
  select small_business_rate into v_rate from public.company_settings where company_id = p_company;
  v_vat := case when v_country = 'XK' then 19 else 13 end;   -- days after the 1st: XK the 20th, AL the 14th
  v_pay := case when v_country = 'XK' then 14 else 19 end;   -- XK the 15th, AL the 20th
  v_wh  := v_pay;
  v_from := (date_trunc('month', current_date) - make_interval(months => greatest(p_months, 1)))::date;
  v_last := (date_trunc('month', current_date) - interval '1 month')::date;

  for m in select generate_series(v_from, v_last, interval '1 month')::date loop
    if v_vat_reg then
      return query
      select 'vat'::text, m, (m + interval '1 month - 1 day')::date, (m + interval '1 month')::date + v_vat,
             coalesce(d.status, case when (m + interval '1 month')::date + v_vat < current_date then 'overdue' else 'open' end),
             d.id, d.number, d.payable
        from (select 1) x left join lateral (select * from public.vat_declarations v where v.company_id = p_company and v.deleted_at is null
                                               and v.status <> 'rejected' and v.period_start = m limit 1) d on true;
    end if;

    return query
    select 'payroll'::text, m, (m + interval '1 month - 1 day')::date, (m + interval '1 month')::date + v_pay,
           coalesce(case when r.status in ('posted','paid') then 'declared' else r.status end,
                    case when (m + interval '1 month')::date + v_pay < current_date then 'overdue' else 'open' end),
           r.id, r.number, r.total_income_tax + r.total_employee_contrib + r.total_employer_contrib
      from (select 1) x left join lateral (select * from public.payroll_runs pr where pr.company_id = p_company and pr.deleted_at is null
                                             and pr.status <> 'cancelled' and pr.period_start = m limit 1) r on true;

    -- withholding tax: only a month in which tax was withheld
    select sum(w.amount_base) into v_amt from public.withholdings w
     where w.company_id = p_company and w.status = 'posted' and w.wh_date between m and (m + interval '1 month - 1 day')::date;
    if v_amt is not null then
      v_due := (m + interval '1 month')::date + v_wh;
      obligation := 'withholding'; period_start := m; period_end := (m + interval '1 month - 1 day')::date; due_date := v_due;
      status := case when v_due < current_date then 'passed' else 'open' end; document_id := null; document_number := null; amount := v_amt;
      return next;
    end if;
  end loop;

  -- quarters that ended inside the window (Kosovo)
  if v_country = 'XK' then
    for q in select generate_series(date_trunc('quarter', v_from)::date, date_trunc('quarter', v_last)::date, interval '3 months')::date loop
      continue when (q + interval '3 months - 1 day')::date < v_from or (q + interval '3 months - 1 day')::date > (v_last + interval '1 month - 1 day')::date;
      v_due := (q + interval '3 months')::date + 14;
      if not v_vat_reg then
        select case when v_rate is not null then round(greatest(coalesce(sum((case when e.is_credit then -1 else 1 end) * (e.base + e.vat)), 0), 0) * v_rate / 100, 2) end
          into v_amt from app.vat_entries(p_company, q, (q + interval '3 months - 1 day')::date) e where e.side = 'sale';
        obligation := 'small_business';
      else
        v_amt := null;
        obligation := 'profit_advance';
      end if;
      period_start := q; period_end := (q + interval '3 months - 1 day')::date; due_date := v_due;
      status := case when v_due < current_date then 'passed' else 'open' end; document_id := null; document_number := null; amount := v_amt;
      return next;
    end loop;
  end if;
end $$;

-- the name of an obligation and its period, for reminders and tasks (Albanian, as the other automatic tasks)
create or replace function app.tax_obligation_title(p_obligation text, p_period date)
returns text language sql immutable set search_path = '' as $$
  select case p_obligation
           when 'vat' then 'Deklarata e TVSH-së për ' || to_char(p_period, 'MM/YYYY')
           when 'payroll' then 'Deklarata e pagave për ' || to_char(p_period, 'MM/YYYY')
           when 'withholding' then 'Deklarata e tatimit në burim për ' || to_char(p_period, 'MM/YYYY')
           when 'small_business' then 'Tatimi i biznesit të vogël, tremujori ' || extract(quarter from p_period) || '/' || extract(year from p_period)
           when 'profit_advance' then 'Kësti i tatimit në fitim, tremujori ' || extract(quarter from p_period) || '/' || extract(year from p_period)
           else p_obligation end
$$;

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- the automatic task names the tax and goes to the accountant (payroll: to HR)
select app._patch_function('app.tasks_run',
  $x$case when r.obligation = 'vat' then 'Përgatit deklaratën e TVSH-së për ' else 'Përgatit deklaratën e pagave për ' end || to_char(r.period_start, 'MM/YYYY'),
                       app.first_with_role(p_company, case when r.obligation = 'vat' then array['accountant','finance_manager','company_admin'] else array['hr_manager','accountant','company_admin'] end),$x$,
  $x$'Përgatit: ' || app.tax_obligation_title(r.obligation, r.period_start),
                       app.first_with_role(p_company, case when r.obligation = 'payroll' then array['hr_manager','accountant','company_admin'] else array['accountant','finance_manager','company_admin'] end),$x$);

-- the daily reminder names the tax and opens its page
select app._patch_function('public.run_daily_reminders',
  $x$      v_n := v_n + app.remind(c.id, case when o.obligation = 'vat' then array['finance_manager','accountant','company_admin'] else array['hr_manager','finance_manager','company_admin'] end,
                              case when o.obligation = 'vat' then 'VAT return ' else 'Payroll declaration ' end || to_char(o.period_start, 'MM/YYYY')
                                || case when o.due_date < current_date then ' is overdue' else ' due ' || to_char(o.due_date, 'DD Mon') end,
                              case when o.document_number is not null then o.document_number || ' is ' || o.status end,
                              case when o.obligation = 'vat' then '/tax' else '/hr/payroll' end, null, null);$x$,
  $x$      v_n := v_n + app.remind(c.id, case when o.obligation = 'payroll' then array['hr_manager','finance_manager','company_admin'] else array['finance_manager','accountant','company_admin'] end,
                              case when o.obligation in ('vat', 'payroll')
                                   then case when o.obligation = 'vat' then 'VAT return ' else 'Payroll declaration ' end || to_char(o.period_start, 'MM/YYYY')
                                        || case when o.due_date < current_date then ' is overdue' else ' due ' || to_char(o.due_date, 'DD Mon') end
                                   else app.tax_obligation_title(o.obligation, o.period_start) || ': afati ' || to_char(o.due_date, 'DD.MM.YYYY') end,
                              case when o.document_number is not null then o.document_number || ' is ' || o.status end,
                              case o.obligation when 'payroll' then '/hr/payroll' when 'withholding' then '/tax/withholding'
                                                when 'small_business' then '/tax/small-business' when 'profit_advance' then '/tax/income-tax' else '/tax' end, null, null);$x$);

-- the screens learn whether the company is registered for VAT (menu: VAT returns or small business tax)
select app._patch_function('public.get_my_context',
  $x$'business_type', c.business_type,$x$,
  $x$'business_type', c.business_type, 'vat_registered', app.company_vat_registered(c.id),$x$);

drop function app._patch_function(text, text, text);
