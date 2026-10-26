-- =============================================================================
-- DrisPRO · night and holiday premiums, deductions from pay, promotions (runs after 01–29)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

create or replace function pg_temp.bal(p_co uuid, p_code text) returns numeric language sql security definer as $$
  select coalesce(sum(jl.debit - jl.credit), 0) from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
   where jl.company_id = p_co and jl.account_id = (select id from public.accounts where company_id = p_co and code = p_code)
     and e.status in ('posted','reversed') $$;

set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Paga Test', 'country', 'AL', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 10,
  'valid_until', (current_date + 365)::text)) as co \gset
select t.login('alice@alba.al');
select public.invite_member(:'co', 'ola@hr.al', array['hr_manager']);
select extract(year from current_date - interval '1 month')::int as y, extract(month from current_date - interval '1 month')::int as m \gset
select make_date(:y, :m, 1) as m1 \gset
-- the first Sunday of that month
select (:'m1'::date + ((7 - extract(isodow from :'m1'::date)::int) % 7))::date as sun \gset

insert into public.employees (company_id, first_name, last_name, hire_date) values (:'co', 'Arben', 'Puna', '2024-01-01') returning id as emp \gset
insert into public.employment_contracts (company_id, employee_id, start_date, gross_salary, currency_code, working_hours_per_week)
values (:'co', :'emp', '2024-01-01', 104000, 'ALL', 40);

-- ---------- night and holiday hours -----------------------------------------------------------
insert into public.attendance_records (company_id, employee_id, work_date, check_in, check_out)
values (:'co', :'emp', :'sun', (:'sun'::date + time '20:00') at time zone 'Europe/Tirane', (:'sun'::date + 1 + time '02:00') at time zone 'Europe/Tirane');
select t.ok((select night_hours from public.attendance_records where employee_id = :'emp') = 4, '22:00–02:00 are 4 night hours');
select t.ok((select holiday_hours from public.attendance_records where employee_id = :'emp') = 6, 'a Sunday''s 6 hours are rest-day hours');

-- ---------- deductions ------------------------------------------------------------------------
insert into public.employee_deductions (company_id, employee_id, kind, name, amount, total, starts_on)
values (:'co', :'emp', 'loan', 'Kredi', 5000, 8000, :'m1') returning id as loan \gset
select id as bank from public.bank_accounts where company_id = :'co' and account_kind = 'bank' limit 1 \gset
select public.employee_advance_pay(jsonb_build_object('employee_id', :'emp', 'amount', 3000, 'months', 1, 'bank_account_id', :'bank', 'date', :'m1')) as adv \gset
select t.ok(pg_temp.bal(:'co', '425') = 3000, 'the advance paid is owed back by the employee');

select public.create_payroll_run(:'co', :y, :m) as run \gset
select public.calculate_payroll(:'run');
select id as slip, gross_salary, net_salary, other_deductions, employee_contributions, income_tax from public.payslips where payroll_run_id = :'run' \gset
-- hourly: 104 000 / (40 × 52 / 12) = 600
select t.ok((select amount from public.payslip_lines where payslip_id = :'slip' and code = 'NIGHT') = 480, 'night premium: 4 h × 600 × 20 % = 480');
select t.ok((select amount from public.payslip_lines where payslip_id = :'slip' and code = 'HOLIDAY') = 900, 'rest-day premium: 6 h × 600 × 25 % = 900');
select t.ok(:'other_deductions'::numeric = 8000, 'the loan''s 5 000 and the advance''s 3 000 are taken');
select t.ok(:'net_salary'::numeric = :'gross_salary'::numeric - :'employee_contributions'::numeric - :'income_tax'::numeric - 8000, 'from the net pay');
select t.login('ola@hr.al');
select public.approve_payroll(:'run');
select t.login('alice@alba.al');
select public.post_payroll(:'run');
select t.ok(pg_temp.bal(:'co', '425') = -5000, 'the advance is back; the loan (given outside) shows as taken');

select public.create_payroll_run(:'co', extract(year from current_date)::int, extract(month from current_date)::int) as run2 \gset
select public.calculate_payroll(:'run2');
select t.ok((select other_deductions from public.payslips where payroll_run_id = :'run2') = 3000, 'next month only the 3 000 left of the loan');

-- ---------- promotions ------------------------------------------------------------------------
select id as pcs from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select id as vat from public.tax_codes where company_id = :'co' and rate = 20 and deleted_at is null limit 1 \gset
select id as wh from public.warehouses where company_id = :'co' and code = 'WH' \gset
select id as stock from public.warehouse_locations where company_id = :'co' and code = 'WH/STOCK' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'LNG', 'name', 'Lëng', 'uom_id', :'pcs', 'sales_price', 100, 'sales_tax_code_id', :'vat')) as p_lng \gset
select id as lng from public.product_variants where product_id = :'p_lng' \gset
insert into public.promotions (company_id, name, kind, value, channels, variant_ids) values (:'co', 'Lëngje −10%', 'percent', 10, '{sales}', array[:'lng']::uuid[]);
select t.ok((select discount_pct from public.get_price(:'co', null, :'lng', 1)) = 10 and (select source from public.get_price(:'co', null, :'lng', 1)) = 'promotion',
  'a sales promotion fills in the discount');
insert into public.promotions (company_id, name, kind, buy_qty, get_qty, channels, variant_ids) values (:'co', '3 me 2', 'buy_get', 2, 1, '{pos}', array[:'lng']::uuid[])
returning id as p32 \gset
insert into public.bank_accounts (company_id, name, account_kind, currency_code, account_id)
select :'co', 'Arka 1', 'cash', 'ALL', id from public.accounts where company_id = :'co' and code = '5311' returning id as drawer \gset
insert into public.pos_registers (company_id, code, name, warehouse_id, location_id, cash_account_id, journal_id)
select :'co', 'A1', 'Arka 1', :'wh', :'stock', :'drawer', id from public.journals where company_id = :'co' and code = 'POS' returning id as reg \gset
select t.ok(jsonb_array_length(public.pos_promotions(:'reg')) = 1, 'the till gets its promotions');
select public.open_pos_session(:'reg', 0) as ses \gset
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'lng', 'quantity', 3, 'unit_price', 120, 'discount_pct', 33.3333, 'promotion_id', :'p32')),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 240)))) as r1 \gset
select t.ok((:'r1'::jsonb ->> 'total')::numeric = 240, '3 for the price of 2');
select t.throws(format($q$select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', 2, 'unit_price', 120, 'discount_pct', 33.3333, 'promotion_id', %L)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 160))))$q$, :'ses', :'lng', :'p32'),
  'the promotion gives', 'two pieces do not get the third free');
select t.ok((public.promotion_results(:'co', current_date - 1, current_date + 1) -> 0 ->> 'discount')::numeric = 120, 'the promotion''s results: 120 given');

reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
