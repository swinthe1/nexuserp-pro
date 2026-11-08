-- =============================================================================
-- Wave 1 of the audit: holidays for every year, a payroll an owner alone can finish, and a tax
-- calendar that lists only the taxes the company files.
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);

-- 1. the holidays of any year: both Easters worked out, weekends moved (Albania: next free day, Kosovo: Monday)
select t.ok(app.easter_western(2027) = '2027-03-28' and app.easter_orthodox(2027) = '2027-05-02'
            and app.easter_western(2025) = '2025-04-20' and app.easter_orthodox(2025) = '2025-04-20', 'Easter 2025 and 2027, both churches');
select t.ok((select string_agg(holiday_date::text, ' ' order by holiday_date) from app.holiday_list('XK', 2026))
            = '2026-01-01 2026-01-02 2026-01-07 2026-02-17 2026-03-20 2026-04-06 2026-04-09 2026-04-13 2026-05-01 2026-05-11 2026-05-28 2026-12-25',
            'Kosovo 2026 comes out as it was entered by hand');
select t.ok((select count(*) from app.holiday_list('AL', 2026)) = 15, 'Albania 2026: the same fifteen days off');
select t.ok(exists (select 1 from app.holiday_list('AL', 2027) where holiday_date = '2027-05-04')
            and exists (select 1 from app.holiday_list('AL', 2027) where holiday_date = '2027-05-03'),
            'Albania 2027: May Day and Orthodox Easter on the weekend become Monday and Tuesday');
select t.ok(exists (select 1 from app.holiday_list('XK', 2027) where holiday_date = '2027-05-10' and name = 'Europe Day (observed)'),
            'Kosovo 2027: Europe Day on Sunday moves to Monday');
select t.ok(not exists (select 1 from app.holiday_list('XK', 2027) where extract(isodow from holiday_date) >= 6), 'no day off falls on a weekend');

-- 2. every company has next year too; a year someone entered by hand is not touched
select id as co from public.companies where country_code = 'AL' and deleted_at is null order by created_at limit 1 \gset
select t.ok((select count(*) from public.public_holidays where company_id = :'co' and holiday_date between '2027-01-01' and '2027-12-31') = (select count(*) from app.holiday_list('AL', 2027)),
            'next year is there for every company');
delete from public.public_holidays where company_id = :'co' and holiday_date >= '2028-01-01';
insert into public.public_holidays (company_id, holiday_date, name) values (:'co', '2028-01-03', 'Our own day');
select t.ok(app.seed_holidays(:'co', 2028) = 0 and (select count(*) from public.public_holidays where company_id = :'co' and holiday_date >= '2028-01-01') = 1,
            'a year with dates entered by hand is left as it is');
delete from public.public_holidays where company_id = :'co' and holiday_date >= '2028-01-01';

-- 3. in December the next year comes with a task to check it (and to add the Bajrams when they are not known)
select t.ok(app.holidays_next_year(:'co', '2026-11-30') = 0, 'nothing before December');
select app.holidays_next_year(:'co', '2027-12-01');
select t.ok((select count(*) from public.public_holidays where company_id = :'co' and holiday_date between '2028-01-01' and '2028-12-31') > 8
            and exists (select 1 from public.tasks where company_id = :'co' and auto_key = 'holidays:2028' and description like '%Bajram%'),
            'December: 2028 added and HR asked to check it and add the Bajrams');
delete from public.tasks where company_id = :'co' and auto_key = 'holidays:2028';
delete from public.public_holidays where company_id = :'co' and holiday_date >= '2028-01-01';

-- 4. an owner alone may approve the payroll he calculated; with a second approver, two people stay the rule
insert into auth.users (email, raw_user_meta_data) values ('dyte@pronar.xk', '{"full_name":"Dyte"}');
set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Vetëm Unë', 'country', 'XK', 'owner_email', 'solo@pronar.xk',
  'owner_password', 'sekret123', 'plan', 'pro', 'business_type', 'services')) as solo \gset
select t.login('solo@pronar.xk');
insert into public.employees (company_id, first_name, last_name, hire_date) values (:'solo', 'Arta', 'Punëtore', '2025-01-01') returning id as arta \gset
insert into public.employment_contracts (company_id, employee_id, start_date, gross_salary, currency_code) values (:'solo', :'arta', '2025-01-01', 600, 'EUR');
select t.ok(public.payroll_other_approvers(:'solo') = 0, 'nobody else may approve payroll here');
select public.create_payroll_run(:'solo', 2026, 9) as srun \gset
select public.calculate_payroll(:'srun');
select public.approve_payroll(:'srun');
select t.ok((select status = 'approved' and self_approved from public.payroll_runs where id = :'srun'), 'the owner alone approves, and the payroll says so');
select public.reopen_payroll(:'srun');
select t.ok(not (select self_approved from public.payroll_runs where id = :'srun'), 'reopened, the mark is gone');
select public.invite_member(:'solo', 'dyte@pronar.xk', array['company_admin']);
select t.accept_invites();
select public.calculate_payroll(:'srun');
select t.ok(public.payroll_other_approvers(:'solo') = 1, 'now someone else may approve');
select t.throws(format($q$select public.approve_payroll(%L)$q$, :'srun'), 'Someone other than', 'so the one who calculated cannot');
reset role;

-- 5. the tax calendar: VAT only with a VAT number; small business tax by quarter in Kosovo; withholding when withheld
update public.companies set vat_number = null where id = :'solo';
select t.ok(not exists (select 1 from app.tax_deadlines(:'solo', 6) where obligation = 'vat'), 'no VAT number: no VAT returns, nothing "overdue"');
select t.ok(exists (select 1 from app.tax_deadlines(:'solo', 6) where obligation = 'small_business' and period_start = '2026-07-01' and due_date = '2026-10-15'),
            'the small business tax of the third quarter, by 15 October');
update public.companies set vat_number = '330000001' where id = :'solo';
select t.ok(exists (select 1 from app.tax_deadlines(:'solo', 6) where obligation = 'vat')
            and exists (select 1 from app.tax_deadlines(:'solo', 6) where obligation = 'profit_advance')
            and not exists (select 1 from app.tax_deadlines(:'solo', 6) where obligation = 'small_business'),
            'with a VAT number: VAT returns and the profit tax instalments instead');
select t.ok(not exists (select 1 from app.tax_deadlines(:'solo', 6) where obligation in ('withholding', 'small_business', 'profit_advance') and status = 'overdue'),
            'a date the program cannot check says "passed", it does not nag');
select t.ok(app.tax_obligation_title('small_business', '2026-07-01') = 'Tatimi i biznesit të vogël, tremujori 3/2026', 'tasks and reminders name the tax');
select t.ok(position('vat_registered' in pg_get_functiondef('public.get_my_context()'::regprocedure)) > 0, 'the screens can tell whether the company has VAT');

\set QUIET off
select count(*) as assertions_passed from t.results;
