-- =============================================================================
-- Year-end close, withholding tax, corporate income tax
--   * year_end_check / year_close / year_reopen: the checklist before closing a
--     fiscal year, the closing entry (revenue and expenses to 109, then 109 to
--     108 on the first day of the next year) and the lock of its months.
--     The closing entry counts only as an opening balance, so the year's own
--     reports (profit and loss, trial balance) still show the year.
--   * withholding tax: kinds with their rates (seeded per country, editable),
--     withheld on a supplier's bill (the bill is that much less to pay, the
--     tax is owed to the tax office), and the monthly list for the declaration
--   * corporate income tax: the yearly worksheet (accounting profit, expenses
--     that are not deductible, other adjustments, losses carried, advances)
--     and its entry in the books
-- =============================================================================

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- three more posting accounts
do $$
declare v_keys text[];
begin
  select array_agg(distinct m[1]) into v_keys
    from pg_constraint c, regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m
   where c.conrelid = 'public.company_account_defaults'::regclass and c.conname = 'company_account_defaults_key_check';
  v_keys := array(select distinct unnest(v_keys || array['withholding_payable', 'cit_payable', 'cit_expense']) order by 1);
  alter table public.company_account_defaults drop constraint company_account_defaults_key_check;
  execute format('alter table public.company_account_defaults add constraint company_account_defaults_key_check check (key = any (%L::text[]))', v_keys);
end $$;

-- the accounts these need, added to charts made before them
create or replace function app.ensure_tax_accounts(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.accounts (company_id, code, name, account_type, account_subtype, cash_flow_category, parent_id)
  select p_company, x.code, x.name, x.t, x.st, 'operating',
         (select id from public.accounts p where p.company_id = p_company and p.code = left(x.code, 1) and p.deleted_at is null)
    from (values ('4428', 'Withholding tax payable', 'liability', 'tax'),
                 ('444',  'Corporate income tax payable', 'liability', 'tax'),
                 ('691',  'Corporate income tax', 'expense', 'other_expense')) x(code, name, t, st)
   where not exists (select 1 from public.accounts a where a.company_id = p_company and a.code = x.code and a.deleted_at is null);
  insert into public.company_account_defaults (company_id, key, account_id)
  select p_company, d.key, a.id from (values ('withholding_payable', '4428'), ('cit_payable', '444'), ('cit_expense', '691')) d(key, code)
    join public.accounts a on a.company_id = p_company and a.code = d.code and a.deleted_at is null
  on conflict do nothing;
end $$;

-- =============================================================================
-- 1. Year-end close
-- =============================================================================
alter table public.fiscal_years
  add column if not exists closed_at timestamptz,
  add column if not exists closed_by uuid references public.profiles(id) on delete set null,
  add column if not exists result numeric(18,2),
  add column if not exists close_entry_id uuid,
  add column if not exists carry_entry_id uuid,
  add column if not exists reopen_reason text;

-- the closing entry is an opening balance for later periods, never a movement of the year it closes
create or replace function public.account_balances(p_company uuid, p_from date, p_to date, p_cost_center uuid default null)
returns table(account_id uuid, code text, name text, account_type text, account_subtype text, parent_id uuid, is_postable boolean,
              cash_flow_category text, opening numeric, debit numeric, credit numeric, closing numeric)
language sql stable set search_path = '' as $$
  with mv as (
    select jl.account_id,
           sum(case when e.entry_date < p_from then jl.debit - jl.credit else 0 end) as opening,
           sum(case when e.entry_date between p_from and p_to and coalesce(e.source_doc_type, '') <> 'year_close' then jl.debit else 0 end) as debit,
           sum(case when e.entry_date between p_from and p_to and coalesce(e.source_doc_type, '') <> 'year_close' then jl.credit else 0 end) as credit
      from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
     where jl.company_id = p_company and e.status in ('posted','reversed') and e.entry_date <= p_to
       and (p_cost_center is null or jl.cost_center_id = p_cost_center)
     group by jl.account_id)
  select a.id, a.code, a.name, a.account_type, a.account_subtype, a.parent_id, a.is_postable, a.cash_flow_category,
         coalesce(mv.opening, 0), coalesce(mv.debit, 0), coalesce(mv.credit, 0),
         coalesce(mv.opening, 0) + coalesce(mv.debit, 0) - coalesce(mv.credit, 0)
    from public.accounts a left join mv on mv.account_id = a.id
   where a.company_id = p_company and a.deleted_at is null
   order by a.code
$$;

do $$ begin
  if position('year_close' in pg_get_functiondef('public.finance_overview'::regproc)) = 0 then perform app._patch_function('public.finance_overview',
  $o$and a.account_type in ('revenue','expense')
                           and e.entry_date >= m$o$,
  $n$and a.account_type in ('revenue','expense') and coalesce(e.source_doc_type, '') <> 'year_close'
                           and e.entry_date >= m$n$); end if;
end $$;

-- the closing entry is checked when the transaction ends, after the year's months were closed by the same step
do $$ begin
  if position('year_close' in pg_get_functiondef('app.tg_journal_entry_validate'::regproc)) = 0 then
    perform app._patch_function('app.tg_journal_entry_validate',
      $o$elsif v_period <> 'open' and e.reversed_by_id is null then$o$,
      $n$elsif v_period <> 'open' and e.reversed_by_id is null and coalesce(e.source_doc_type, '') <> 'year_close' then$n$);
  end if;
end $$;

-- what is still open in a year, before it is closed
create or replace function public.year_end_check(p_year uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare y public.fiscal_years; v_co uuid; v_res numeric; v_rev numeric; v_exp numeric; v_months int; v_emp boolean; v_next uuid; v_prev text;
begin
  select * into y from public.fiscal_years where id = p_year and deleted_at is null;
  if y.id is null then raise exception 'Fiscal year not found' using errcode = 'P0002'; end if;
  v_co := y.company_id;
  perform app.require_permission(v_co, 'finance.read');

  select coalesce(sum(case when a.account_type = 'revenue' then jl.credit - jl.debit end), 0),
         coalesce(sum(case when a.account_type = 'expense' then jl.debit - jl.credit end), 0)
    into v_rev, v_exp
    from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id join public.accounts a on a.id = jl.account_id
   where jl.company_id = v_co and e.status in ('posted','reversed') and e.entry_date between y.start_date and y.end_date
     and coalesce(e.source_doc_type, '') <> 'year_close' and a.account_type in ('revenue','expense');
  v_res := v_rev - v_exp;
  v_months := (extract(year from age(least(y.end_date, current_date), y.start_date)) * 12 + extract(month from age(least(y.end_date, current_date), y.start_date)) + 1)::int;
  v_emp := exists (select 1 from public.employees where company_id = v_co and deleted_at is null);
  select id into v_next from public.fiscal_years where company_id = v_co and start_date = y.end_date + 1 and deleted_at is null;
  select string_agg(name, ', ' order by start_date) into v_prev from public.fiscal_years
   where company_id = v_co and end_date < y.start_date and status <> 'closed' and deleted_at is null
     and exists (select 1 from public.journal_entries e where e.company_id = v_co and e.entry_date between fiscal_years.start_date and fiscal_years.end_date
                  and e.status in ('posted','reversed'));

  return jsonb_build_object(
    'id', y.id, 'name', y.name, 'start', y.start_date, 'end', y.end_date, 'status', y.status, 'closed_at', y.closed_at,
    'closed_by', (select full_name from public.profiles where id = y.closed_by), 'result_closed', y.result,
    'ended', y.end_date < current_date, 'next_year', v_next, 'earlier_open', v_prev,
    'revenue', v_rev, 'expenses', v_exp, 'result', v_res,
    'locked_periods', (select count(*) from public.fiscal_periods where fiscal_year_id = y.id and status = 'locked'),
    'later_closed', exists (select 1 from public.fiscal_years where company_id = v_co and start_date > y.end_date and status = 'closed' and deleted_at is null),
    'checks', jsonb_build_array(
      jsonb_build_object('key', 'draft_entries', 'block', true, 'href', '/finance/journal',
        'count', (select count(*) from public.journal_entries where company_id = v_co and status = 'draft' and deleted_at is null and entry_date between y.start_date and y.end_date)),
      jsonb_build_object('key', 'draft_invoices', 'href', '/sales/invoices',
        'count', (select count(*) from public.sales_invoices where company_id = v_co and status = 'draft' and deleted_at is null and invoice_date between y.start_date and y.end_date)),
      jsonb_build_object('key', 'draft_bills', 'href', '/procurement/bills',
        'count', (select count(*) from public.vendor_bills where company_id = v_co and status = 'draft' and deleted_at is null and bill_date between y.start_date and y.end_date)),
      jsonb_build_object('key', 'open_receipts', 'href', '/inventory/receipts',
        'count', (select count(*) from public.goods_receipts where company_id = v_co and status <> 'done' and status <> 'cancelled' and deleted_at is null and receipt_date between y.start_date and y.end_date)),
      jsonb_build_object('key', 'open_deliveries', 'href', '/sales/deliveries',
        'count', (select count(*) from public.deliveries where company_id = v_co and status not in ('done', 'cancelled') and deleted_at is null and scheduled_date between y.start_date and y.end_date)),
      jsonb_build_object('key', 'open_pos', 'href', '/pos',
        'count', (select count(*) from public.pos_sessions where company_id = v_co and status = 'open' and deleted_at is null and opened_at::date <= y.end_date)),
      jsonb_build_object('key', 'depreciation', 'href', '/finance/assets',
        'count', (select count(distinct dl.asset_id) from public.asset_depreciation_lines dl join public.fixed_assets fa on fa.id = dl.asset_id
                   where dl.company_id = v_co and dl.status = 'planned' and fa.status = 'active' and dl.period_date <= y.end_date)),
      jsonb_build_object('key', 'payroll', 'href', '/hr/payroll',
        'count', case when not v_emp then 0 else greatest(0, v_months - (select count(distinct date_trunc('month', period_start)) from public.payroll_runs
                   where company_id = v_co and status in ('posted', 'paid') and deleted_at is null and period_start between y.start_date and y.end_date)) end),
      jsonb_build_object('key', 'vat', 'href', '/tax/declarations',
        'count', case when not exists (select 1 from public.vat_declarations where company_id = v_co and deleted_at is null) then 0
                 else greatest(0, v_months - (select count(*) from public.vat_declarations where company_id = v_co and deleted_at is null
                   and status in ('submitted', 'accepted') and period_start between y.start_date and y.end_date)) end),
      jsonb_build_object('key', 'bank', 'href', '/finance/bank',
        'count', (select count(*) from public.bank_statement_lines where company_id = v_co and match_status = 'unmatched' and transaction_date between y.start_date and y.end_date)),
      jsonb_build_object('key', 'cit', 'href', '/tax/income-tax?year=' || extract(year from y.start_date),
        'count', case when exists (select 1 from public.cit_returns r where r.company_id = v_co and r.year = extract(year from y.start_date)::int and r.booked_at is not null)
                        or v_res <= 0 then 0 else 1 end)
    ));
end $$;

create or replace function public.year_close(p_year uuid, p_carry boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare y public.fiscal_years; v_co uuid; v_lines jsonb := '[]'::jsonb; r record; v_sum numeric := 0; v_je uuid; v_carry uuid; v_next uuid;
        v_cye uuid; v_re uuid;
begin
  select * into y from public.fiscal_years where id = p_year and deleted_at is null for update;
  if y.id is null then raise exception 'Fiscal year not found' using errcode = 'P0002'; end if;
  v_co := y.company_id;
  perform app.require_permission(v_co, 'finance.approve');
  if y.status = 'closed' then raise exception 'The year % is already closed', y.name using errcode = '55000'; end if;
  if y.end_date >= current_date then raise exception 'The year % has not ended yet', y.name using errcode = '55000'; end if;
  if exists (select 1 from public.journal_entries where company_id = v_co and status = 'draft' and deleted_at is null and entry_date between y.start_date and y.end_date) then
    raise exception 'Post or delete the draft journal entries of % first', y.name using errcode = '55000';
  end if;
  if exists (select 1 from public.fiscal_periods where fiscal_year_id = y.id and status <> 'open') then
    -- the last month must take the closing entry
    update public.fiscal_periods set status = 'open' where fiscal_year_id = y.id and status = 'closed' and y.end_date between start_date and end_date;
    if exists (select 1 from public.fiscal_periods where fiscal_year_id = y.id and y.end_date between start_date and end_date and status <> 'open') then
      raise exception 'The last month of % is locked', y.name using errcode = '55000';
    end if;
  end if;
  v_cye := app.acct(v_co, 'current_year_earnings');
  v_re := app.acct(v_co, 'retained_earnings');

  -- every revenue and expense account back to zero; the difference is the year's result
  for r in select jl.account_id, sum(jl.debit - jl.credit) bal
             from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id join public.accounts a on a.id = jl.account_id
            where jl.company_id = v_co and e.status in ('posted','reversed') and e.entry_date between y.start_date and y.end_date
              and coalesce(e.source_doc_type, '') <> 'year_close' and a.account_type in ('revenue','expense')
            group by jl.account_id having sum(jl.debit - jl.credit) <> 0 loop
    v_lines := v_lines || jsonb_build_object('account_id', r.account_id, 'amount', -r.bal);
    v_sum := v_sum + r.bal;
  end loop;
  if v_sum <> 0 or jsonb_array_length(v_lines) > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', v_cye, 'amount', v_sum, 'description', 'Result of ' || y.name);
    v_je := app.gl_post(v_co, 'GEN', y.end_date, 'year_close', y.id, 'CLOSE ' || y.name, 'Closing of ' || y.name, v_lines, 'year_close');
  end if;

  -- the result moves to the results of earlier years on the first day of the next year
  if p_carry and v_sum <> 0 then
    select id into v_next from public.fiscal_years where company_id = v_co and start_date = y.end_date + 1 and deleted_at is null;
    if v_next is null then
      insert into public.fiscal_years (company_id, name, start_date, end_date)
      values (v_co, 'FY ' || extract(year from y.end_date + 1), y.end_date + 1, (y.end_date + interval '1 year')::date) returning id into v_next;
      insert into public.fiscal_periods (company_id, fiscal_year_id, period_no, name, start_date, end_date)
      select v_co, v_next, m + 1, to_char(y.end_date + 1 + make_interval(months => m), 'Mon YYYY'),
             (y.end_date + 1 + make_interval(months => m))::date, (y.end_date + 1 + make_interval(months => m + 1) - interval '1 day')::date
        from generate_series(0, 11) m;
    end if;
    -- the first open day of the next year (its first months may already be closed)
    v_carry := app.gl_post(v_co, 'GEN', app.first_open_date(v_co, y.end_date + 1), 'year_carry', y.id, 'CARRY ' || y.name, 'Result of ' || y.name || ' to earlier years',
      jsonb_build_array(jsonb_build_object('account_id', v_cye, 'amount', -v_sum), jsonb_build_object('account_id', v_re, 'amount', v_sum)), 'year_carry');
  end if;

  update public.fiscal_periods set status = 'closed' where fiscal_year_id = y.id and status = 'open';
  update public.fiscal_years set status = 'closed', closed_at = now(), closed_by = auth.uid(), result = -v_sum,
         close_entry_id = v_je, carry_entry_id = v_carry, reopen_reason = null where id = y.id;
  return jsonb_build_object('result', -v_sum, 'close_entry', v_je, 'carry_entry', v_carry);
end $$;

create or replace function public.year_reopen(p_year uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare y public.fiscal_years; v_co uuid; e record; v_new uuid;
begin
  select * into y from public.fiscal_years where id = p_year and deleted_at is null for update;
  if y.id is null then raise exception 'Fiscal year not found' using errcode = 'P0002'; end if;
  v_co := y.company_id;
  perform app.require_permission(v_co, 'finance.approve');
  if y.status <> 'closed' then raise exception 'The year % is not closed', y.name using errcode = '55000'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Write why the year is reopened' using errcode = '23514'; end if;
  if exists (select 1 from public.fiscal_years where company_id = v_co and start_date > y.end_date and status = 'closed' and deleted_at is null) then
    raise exception 'Reopen the later years first' using errcode = '55000';
  end if;
  if exists (select 1 from public.fiscal_periods where fiscal_year_id = y.id and status = 'locked') then
    raise exception 'Some months of % are locked and cannot be reopened', y.name using errcode = '55000';
  end if;
  update public.fiscal_periods set status = 'open' where fiscal_year_id = y.id and status = 'closed';
  -- take back the carry, then the closing entry
  for e in select je.* from public.journal_entries je where je.id in (y.carry_entry_id, y.close_entry_id) and je.status = 'posted'
            order by je.entry_date desc loop
    v_new := app.gl_post(v_co, 'GEN', case when e.source_doc_type = 'year_carry' then app.first_open_date(v_co, e.entry_date) else e.entry_date end, e.source_doc_type, y.id, 'REOPEN ' || y.name, 'Reopened ' || y.name || ': ' || btrim(p_reason),
      (select jsonb_agg(jsonb_build_object('account_id', l.account_id, 'amount', l.credit - l.debit, 'partner_id', l.partner_id)) from public.journal_lines l where l.entry_id = e.id),
      'reopen:' || e.id, null, e.id);
    update public.journal_entries set status = 'reversed', reversed_by_id = v_new where id = e.id;
  end loop;
  update public.fiscal_years set status = 'open', closed_at = null, closed_by = null, result = null, close_entry_id = null, carry_entry_id = null,
         reopen_reason = btrim(p_reason) where id = y.id;
end $$;

-- =============================================================================
-- 2. Withholding tax
-- =============================================================================
create table public.withholding_codes (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  code        text not null,
  name        text not null,
  rate        numeric(6,3) not null check (rate >= 0 and rate <= 100),
  is_active   boolean not null default true,
  sort        int not null default 0
);
select app.register_table('public.withholding_codes', 'tax', p_soft_delete => true);
create unique index withholding_codes_key on public.withholding_codes (company_id, code) where deleted_at is null;

create table public.withholdings (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  bill_id         uuid not null,
  vendor_id       uuid not null,
  code_id         uuid not null,
  wh_date         date not null,
  base            numeric(18,2) not null check (base > 0),
  rate            numeric(6,3) not null,
  amount          numeric(18,2) not null check (amount > 0),
  currency_code   char(3) not null,
  amount_base     numeric(18,2) not null,
  status          text not null default 'posted' check (status in ('posted', 'cancelled')),
  journal_entry_id uuid,
  reversal_entry_id uuid,
  cancel_reason   text,
  foreign key (company_id, bill_id) references public.vendor_bills(company_id, id),
  foreign key (company_id, vendor_id) references public.business_partners(company_id, id),
  foreign key (company_id, code_id) references public.withholding_codes(company_id, id)
);
select app.register_table('public.withholdings', 'invoicing', p_read_module => 'invoicing', p_soft_delete => false, p_client_write => false);
create index withholdings_bill_idx on public.withholdings (bill_id);
create index withholdings_date_idx on public.withholdings (company_id, wh_date);

-- the usual kinds and rates of the country; the company can change them
create or replace function public.withholding_setup(p_company uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_cc text;
begin
  perform app.require_permission(p_company, 'invoicing.read');
  if not exists (select 1 from public.withholding_codes where company_id = p_company) then
    select country_code into v_cc from public.companies where id = p_company;
    insert into public.withholding_codes (company_id, code, name, rate, sort)
    select p_company, x.code, x.name, x.rate, x.sort from (values
      ('XK', 'INT', 'Interest', 10, 1), ('XK', 'ROY', 'Royalties', 10, 2), ('XK', 'RENT', 'Rent', 9, 3),
      ('XK', 'NONRES', 'Services of non-residents', 5, 4), ('XK', 'IND', 'Individuals, farmers and collectors of recycled materials', 1, 5),
      ('AL', 'DIV', 'Dividends', 8, 1), ('AL', 'INT', 'Interest', 15, 2), ('AL', 'ROY', 'Royalties', 15, 3), ('AL', 'RENT', 'Rent', 15, 4),
      ('AL', 'SERV', 'Services of individuals and non-residents', 15, 5)) x(cc, code, name, rate, sort)
     where x.cc = coalesce(v_cc, 'XK');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name, 'rate', rate, 'is_active', is_active) order by sort, code)
                     from public.withholding_codes where company_id = p_company and deleted_at is null), '[]'::jsonb);
end $$;

do $$ begin
  if position('withholdings' in pg_get_functiondef('app.refresh_payment_status'::regproc)) = 0 then perform app._patch_function('app.refresh_payment_status',
  $o$where cl.vendor_bill_id = b.id and c.status = 'posted'), 0)$o$,
  $n$where cl.vendor_bill_id = b.id and c.status = 'posted'), 0)
                            + coalesce((select sum(w.amount) from public.withholdings w where w.bill_id = b.id and w.status = 'posted'), 0)$n$); end if;
end $$;

-- withhold tax on a supplier's bill: {bill_id, code_id, base?, date?}
create or replace function public.withholding_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.vendor_bills; k public.withholding_codes; v_base numeric; v_amt numeric; v_date date; v_id uuid; v_je uuid; v_ab numeric; bp record;
begin
  select * into b from public.vendor_bills where id = (p ->> 'bill_id')::uuid and deleted_at is null;
  if b.id is null then raise exception 'Bill not found' using errcode = 'P0002'; end if;
  perform app.require_permission(b.company_id, 'invoicing.write');
  if b.status <> 'posted' or b.document_type <> 'vendor_bill' then raise exception 'Tax can be withheld only on a posted bill' using errcode = '55000'; end if;
  select * into k from public.withholding_codes where id = (p ->> 'code_id')::uuid and company_id = b.company_id and deleted_at is null;
  if k.id is null then raise exception 'Choose the kind of withholding' using errcode = '23514'; end if;
  v_base := round(coalesce(nullif(p ->> 'base', '')::numeric, b.subtotal), 2);
  if v_base <= 0 then raise exception 'Enter the amount the tax is withheld on' using errcode = '23514'; end if;
  v_amt := round(v_base * k.rate / 100, 2);
  if v_amt <= 0 then raise exception 'The tax withheld is zero' using errcode = '23514'; end if;
  if v_amt > b.amount_due then raise exception 'Only % is left to pay on this bill', b.amount_due using errcode = '23514'; end if;
  v_date := coalesce(nullif(p ->> 'date', '')::date, current_date);
  v_ab := round(v_amt * coalesce(b.exchange_rate, 1), 2);
  perform app.ensure_tax_accounts(b.company_id);
  select * into bp from public.business_partners where id = b.vendor_id;

  insert into public.withholdings (company_id, bill_id, vendor_id, code_id, wh_date, base, rate, amount, currency_code, amount_base)
  values (b.company_id, b.id, b.vendor_id, k.id, v_date, v_base, k.rate, v_amt, b.currency_code, v_ab) returning id into v_id;
  v_je := app.gl_post(b.company_id, 'GEN', app.first_open_date(b.company_id, v_date), 'withholding', v_id, b.number,
    'Withholding tax ' || k.code || ' · ' || bp.name || ' · ' || b.number,
    jsonb_build_array(
      jsonb_build_object('account_id', coalesce(bp.payable_account_id, app.acct(b.company_id, 'payable')), 'amount', v_ab, 'partner_id', bp.id,
                         'currency_code', b.currency_code, 'amount_currency', v_amt),
      jsonb_build_object('account_id', app.acct(b.company_id, 'withholding_payable'), 'amount', -v_ab, 'partner_id', bp.id)),
    'main', b.currency_code, null);
  update public.withholdings set journal_entry_id = v_je where id = v_id;
  perform app.refresh_payment_status('vendor_bills', b.id);
  return jsonb_build_object('id', v_id, 'amount', v_amt, 'currency', b.currency_code);
end $$;

create or replace function public.withholding_cancel(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare w public.withholdings; v_je uuid;
begin
  select * into w from public.withholdings where id = p_id for update;
  if w.id is null then raise exception 'Withholding not found' using errcode = 'P0002'; end if;
  perform app.require_permission(w.company_id, 'invoicing.write');
  if w.status <> 'posted' then raise exception 'It is already cancelled' using errcode = '55000'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'Write why it is cancelled' using errcode = '23514'; end if;
  if w.journal_entry_id is not null then
    v_je := app.gl_post(w.company_id, 'GEN', app.first_open_date(w.company_id, current_date), 'withholding', w.id, 'WHT-REV',
      'Cancelled withholding: ' || btrim(p_reason),
      (select jsonb_agg(jsonb_build_object('account_id', l.account_id, 'amount', l.credit - l.debit, 'partner_id', l.partner_id,
                                           'currency_code', l.currency_code, 'amount_currency', -l.amount_currency))
         from public.journal_lines l where l.entry_id = w.journal_entry_id),
      'reversal', w.currency_code, w.journal_entry_id);
    update public.journal_entries set status = 'reversed', reversed_by_id = v_je where id = w.journal_entry_id;
  end if;
  update public.withholdings set status = 'cancelled', reversal_entry_id = v_je, cancel_reason = btrim(p_reason) where id = w.id;
  perform app.refresh_payment_status('vendor_bills', w.bill_id);
end $$;

-- the list for the monthly declaration
create or replace function public.withholding_report(p_company uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_cc text;
begin
  perform app.require_permission(p_company, 'invoicing.read');
  select country_code into v_cc from public.companies where id = p_company;
  return jsonb_build_object(
    'from', p_from, 'to', p_to, 'country', v_cc,
    'due', (date_trunc('month', p_to) + interval '1 month')::date + case when v_cc = 'AL' then 19 else 14 end,
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'date', w.wh_date, 'bill_id', w.bill_id, 'bill', b.number, 'their_number', b.vendor_invoice_number,
              'vendor_id', w.vendor_id, 'vendor', bp.name, 'tax_number', bp.tax_number, 'code', k.code, 'kind', k.name,
              'base', round(w.base * coalesce(b.exchange_rate, 1), 2), 'rate', w.rate, 'amount', w.amount_base) order by w.wh_date, b.number)
             from public.withholdings w join public.vendor_bills b on b.id = w.bill_id join public.business_partners bp on bp.id = w.vendor_id
             join public.withholding_codes k on k.id = w.code_id
            where w.company_id = p_company and w.status = 'posted' and w.wh_date between p_from and p_to), '[]'::jsonb),
    'totals', coalesce((select jsonb_agg(jsonb_build_object('code', k.code, 'kind', k.name, 'rate', k.rate, 'count', x.n, 'base', x.base, 'amount', x.amount) order by k.sort, k.code)
             from (select w.code_id, count(*) n, sum(round(w.base * coalesce(b.exchange_rate, 1), 2)) base, sum(w.amount_base) amount
                     from public.withholdings w join public.vendor_bills b on b.id = w.bill_id
                    where w.company_id = p_company and w.status = 'posted' and w.wh_date between p_from and p_to group by 1) x
             join public.withholding_codes k on k.id = x.code_id), '[]'::jsonb));
end $$;

-- =============================================================================
-- 3. Corporate income tax
-- =============================================================================
alter table public.accounts add column if not exists tax_nondeductible boolean not null default false;

create table public.cit_returns (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  year             int not null,
  rate             numeric(6,3),
  adjustments      jsonb not null default '[]'::jsonb,   -- [{label, amount}]: + added, − taken off
  losses           numeric(18,2) not null default 0,     -- losses of earlier years used this year
  advances         numeric(18,2),                        -- advance payments made in the year (null = from the books)
  notes            text,
  tax              numeric(18,2),
  journal_entry_id uuid,
  booked_at        timestamptz,
  unique (company_id, year)
);
select app.register_table('public.cit_returns', 'tax', p_soft_delete => false, p_client_write => false);

create or replace function app.cit_compute(p_company uuid, p_year int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare y public.fiscal_years; r public.cit_returns; v_cc text; v_cur text; v_rev numeric; v_exp numeric; v_cit numeric; v_nd jsonb; v_nd_sum numeric;
        v_adj numeric; v_taxable numeric; v_rate numeric; v_rate_note text; v_tax numeric; v_adv numeric; v_adv_books numeric; v_from date; v_to date;
begin
  select * into y from public.fiscal_years where company_id = p_company and extract(year from start_date) = p_year and deleted_at is null order by start_date limit 1;
  v_from := coalesce(y.start_date, make_date(p_year, 1, 1)); v_to := coalesce(y.end_date, make_date(p_year, 12, 31));
  select * into r from public.cit_returns where company_id = p_company and year = p_year;
  select country_code, base_currency into v_cc, v_cur from public.companies where id = p_company;

  with mv as (
    select a.id, a.code, a.name, a.account_type, a.tax_nondeductible, a.id = (select account_id from public.company_account_defaults where company_id = p_company and key = 'cit_expense') is_cit,
           sum(jl.debit - jl.credit) bal
      from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id join public.accounts a on a.id = jl.account_id
     where jl.company_id = p_company and e.status in ('posted','reversed') and e.entry_date between v_from and v_to
       and coalesce(e.source_doc_type, '') <> 'year_close' and a.account_type in ('revenue','expense')
     group by a.id)
  select coalesce(-sum(bal) filter (where account_type = 'revenue'), 0), coalesce(sum(bal) filter (where account_type = 'expense' and not is_cit), 0),
         coalesce(sum(bal) filter (where is_cit), 0),
         coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'amount', bal) order by code) filter (where tax_nondeductible and account_type = 'expense' and not is_cit and bal <> 0), '[]'::jsonb),
         coalesce(sum(bal) filter (where tax_nondeductible and account_type = 'expense' and not is_cit), 0)
    into v_rev, v_exp, v_cit, v_nd, v_nd_sum from mv;

  v_adj := coalesce((select sum((x ->> 'amount')::numeric) from jsonb_array_elements(coalesce(r.adjustments, '[]'::jsonb)) x), 0);
  v_taxable := greatest(0, v_rev - v_exp + v_nd_sum + v_adj - coalesce(r.losses, 0));
  -- the usual rate of the country; the company can set another
  if v_cc = 'AL' then
    v_rate := case when v_rev <= 14000000 and v_cur = 'ALL' then 0 else 15 end;
    v_rate_note := case when v_rate = 0 then 'Income up to 14 000 000 lekë: 0 %' else 'Albania: 15 %' end;
  else
    v_rate := 10; v_rate_note := 'Kosovo: 10 %';
  end if;
  v_tax := round(v_taxable * coalesce(r.rate, v_rate) / 100, 2);
  select coalesce(sum(jl.debit), 0) into v_adv_books
    from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
   where jl.company_id = p_company and e.status in ('posted','reversed') and e.entry_date between v_from and v_to
     and jl.account_id = (select account_id from public.company_account_defaults where company_id = p_company and key = 'cit_payable')
     and coalesce(e.source_doc_type, '') not in ('cit', 'year_close');
  v_adv := coalesce(r.advances, v_adv_books);

  return jsonb_build_object('year', p_year, 'from', v_from, 'to', v_to, 'currency', v_cur, 'country', v_cc, 'year_status', y.status,
    'revenue', v_rev, 'expenses', v_exp, 'profit', v_rev - v_exp, 'booked_tax', v_cit,
    'nondeductible', v_nd, 'nondeductible_total', v_nd_sum,
    'adjustments', coalesce(r.adjustments, '[]'::jsonb), 'adjustments_total', v_adj, 'losses', coalesce(r.losses, 0),
    'taxable', v_taxable, 'suggested_rate', v_rate, 'rate_note', v_rate_note, 'rate', coalesce(r.rate, v_rate), 'rate_set', r.rate is not null,
    'tax', v_tax, 'advances', v_adv, 'advances_books', v_adv_books, 'advances_set', r.advances is not null,
    'payable', v_tax - v_adv, 'notes', r.notes, 'journal_entry_id', r.journal_entry_id, 'booked_at', r.booked_at, 'booked_amount', r.tax);
end $$;

create or replace function public.cit_worksheet(p_company uuid, p_year int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'tax.read');
  return app.cit_compute(p_company, p_year)
    || jsonb_build_object('company', app.print_company(p_company),
                          'printed_by', (select full_name from public.profiles where id = auth.uid()), 'printed_at', now());
end $$;

-- {rate, adjustments, losses, advances, notes}: a field that is null or missing goes back to its default
create or replace function public.cit_save(p_company uuid, p_year int, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'tax.write');
  insert into public.cit_returns (company_id, year, rate, adjustments, losses, advances, notes)
  values (p_company, p_year, nullif(p ->> 'rate', '')::numeric, coalesce(p -> 'adjustments', '[]'::jsonb),
          coalesce(nullif(p ->> 'losses', '')::numeric, 0), nullif(p ->> 'advances', '')::numeric, nullif(btrim(p ->> 'notes'), ''))
  on conflict (company_id, year) do update set rate = excluded.rate, adjustments = excluded.adjustments, losses = excluded.losses,
     advances = excluded.advances, notes = excluded.notes;
  return public.cit_worksheet(p_company, p_year);
end $$;

-- the tax of the year into the books: Dr income tax expense / Cr tax payable, on the last day of the year (again: the difference)
create or replace function public.cit_book(p_company uuid, p_year int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w jsonb; v_tax numeric; v_old uuid; v_je uuid; v_to date;
begin
  perform app.require_permission(p_company, 'tax.write');
  perform app.ensure_tax_accounts(p_company);
  w := app.cit_compute(p_company, p_year);
  if w ->> 'year_status' = 'closed' then raise exception 'The year % is closed; reopen it to change the tax', p_year using errcode = '55000'; end if;
  v_tax := (w ->> 'tax')::numeric; v_to := (w ->> 'to')::date;
  insert into public.cit_returns (company_id, year) values (p_company, p_year) on conflict do nothing;
  select journal_entry_id into v_old from public.cit_returns where company_id = p_company and year = p_year;
  if v_old is not null then
    v_je := app.gl_post(p_company, 'GEN', v_to, 'cit', null, 'CIT ' || p_year, 'Corporate income tax ' || p_year || ' (replaced)',
      (select jsonb_agg(jsonb_build_object('account_id', l.account_id, 'amount', l.credit - l.debit)) from public.journal_lines l where l.entry_id = v_old),
      'cit-rev:' || v_old, null, v_old);
    update public.journal_entries set status = 'reversed', reversed_by_id = v_je where id = v_old;
  end if;
  v_je := null;
  if v_tax > 0 then
    v_je := app.gl_post(p_company, 'GEN', v_to, 'cit', null, 'CIT ' || p_year, 'Corporate income tax ' || p_year,
      jsonb_build_array(jsonb_build_object('account_id', app.acct(p_company, 'cit_expense'), 'amount', v_tax),
                        jsonb_build_object('account_id', app.acct(p_company, 'cit_payable'), 'amount', -v_tax)),
      'cit:' || p_year || ':' || extract(epoch from clock_timestamp()));
  end if;
  update public.cit_returns set journal_entry_id = v_je, tax = v_tax, booked_at = now() where company_id = p_company and year = p_year;
  return public.cit_worksheet(p_company, p_year);
end $$;

-- the accounts whose expenses the tax office does not accept
create or replace function public.account_set_nondeductible(p_account uuid, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_co uuid;
begin
  select company_id into v_co from public.accounts where id = p_account;
  if v_co is null then raise exception 'Account not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_co, 'tax.write');
  update public.accounts set tax_nondeductible = p_on where id = p_account;
end $$;

-- what the new entries in the books come from
insert into public.document_types (key, name, module, table_name, default_prefix) values
  ('year_close', 'Year-end close', 'finance', 'fiscal_years', 'CLOSE-'),
  ('year_carry', 'Result carried forward', 'finance', 'fiscal_years', 'CARRY-'),
  ('withholding', 'Withholding tax', 'invoicing', 'withholdings', 'WHT-'),
  ('cit', 'Corporate income tax', 'tax', 'cit_returns', 'CIT-')
on conflict (key) do nothing;

do $$
declare c uuid;
begin
  for c in select id from public.companies loop
    if exists (select 1 from public.accounts where company_id = c and code = '411') then perform app.ensure_tax_accounts(c); end if;
  end loop;
end $$;

revoke execute on function public.year_end_check(uuid), public.year_close(uuid, boolean), public.year_reopen(uuid, text),
  public.withholding_setup(uuid), public.withholding_create(jsonb), public.withholding_cancel(uuid, text), public.withholding_report(uuid, date, date),
  public.cit_worksheet(uuid, int), public.cit_save(uuid, int, jsonb), public.cit_book(uuid, int), public.account_set_nondeductible(uuid, boolean) from public, anon;
grant execute on function public.year_end_check(uuid), public.year_close(uuid, boolean), public.year_reopen(uuid, text),
  public.withholding_setup(uuid), public.withholding_create(jsonb), public.withholding_cancel(uuid, text), public.withholding_report(uuid, date, date),
  public.cit_worksheet(uuid, int), public.cit_save(uuid, int, jsonb), public.cit_book(uuid, int), public.account_set_nondeductible(uuid, boolean) to authenticated;

drop function app._patch_function(text, text, text);
