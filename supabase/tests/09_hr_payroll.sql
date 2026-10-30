-- =============================================================================
-- DrisPRO · Phase 8 HR & payroll tests (runs after 01–08)
-- Albania, September 2026: 21 working days (7 Sep is a holiday). Expected payslips:
--   Eda   100,000                       → SS 9,500  HI 1,700  TAP 9,100   net 79,700
--   Mark  250,000 + bonus 10,000        → SS 17,710 (capped at 186,416) HI 4,420 TAP 35,900 net 201,970
--   Lira  60,000, hired 16 Sep (11/21)  → gross 31,428.57, SS 2,986 HI 534 TAP 0 net 27,908.57
--   Besa  80,000, 2 days unpaid (19/21) → gross 72,380.95, SS 6,876 HI 1,230 TAP 5,510 net 58,764.95
--   employer: 16,700 + 32,382 + 5,248 + 12,087 = 66,417
-- Kosovo: pension 5 % + 5 %, tax on gross less pension; secondary employer 10 % flat.
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

insert into auth.users (email, raw_user_meta_data) values
  ('hana@hr.al', '{"full_name":"Hana HR"}'), ('ola@hr.al', '{"full_name":"Ola Payroll"}'),
  ('eda@hr.al', '{"full_name":"Eda Employee"}'), ('mark@hr.al', '{"full_name":"Mark Manager"}'), ('acc@hr.al', '{"full_name":"Acc Accountant"}');

create or replace function pg_temp.bal(p_co uuid, p_code text) returns numeric language sql security definer as $$
  select coalesce(sum(jl.debit - jl.credit), 0) from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
   where jl.company_id = p_co and jl.account_id = (select id from public.accounts where company_id = p_co and code = p_code)
     and e.status in ('posted','reversed') $$;

select id as u_mark from auth.users where email = 'mark@hr.al' \gset
select id as u_eda from auth.users where email = 'eda@hr.al' \gset
set role authenticated;
select t.login('alice@alba.al');
select public.create_company('Njerëz Test', 'AL') as co \gset
select public.invite_member(:'co', 'hana@hr.al', array['hr_manager']);
select t.accept_invites();
select public.invite_member(:'co', 'ola@hr.al', array['hr_manager']);
select t.accept_invites();
select public.invite_member(:'co', 'eda@hr.al', array['employee']);
select t.accept_invites();
select public.invite_member(:'co', 'mark@hr.al', array['employee']);
select t.accept_invites();
select public.invite_member(:'co', 'acc@hr.al', array['accountant']);
select t.accept_invites();
select t.ok((select count(*) from public.public_holidays where company_id = :'co' and holiday_date between '2026-01-01' and '2026-12-31') = 15,
            '2026 Albanian holidays seeded, moved days included');

select t.login('hana@hr.al');
insert into public.departments (company_id, name) values (:'co', 'Sales') returning id as dep \gset
insert into public.employees (company_id, user_id, first_name, last_name, personal_number, hire_date, department_id)
values (:'co', :'u_mark', 'Mark', 'Manager', 'J00000001A', '2024-01-01', :'dep') returning id as mark \gset
insert into public.employees (company_id, user_id, first_name, last_name, personal_number, hire_date, department_id, manager_id)
values (:'co', :'u_eda', 'Eda', 'Employee', 'J00000002B', '2025-01-01', :'dep', :'mark') returning id as eda \gset
insert into public.employees (company_id, first_name, last_name, hire_date) values (:'co', 'Lira', 'New', '2026-09-16') returning id as lira \gset
insert into public.employees (company_id, first_name, last_name, hire_date) values (:'co', 'Besa', 'Unpaid', '2023-05-01') returning id as besa \gset
insert into public.employment_contracts (company_id, employee_id, start_date, gross_salary, currency_code) values
  (:'co', :'mark', '2024-01-01', 250000, 'ALL'), (:'co', :'eda', '2025-01-01', 100000, 'ALL'),
  (:'co', :'lira', '2026-09-16', 60000, 'ALL'), (:'co', :'besa', '2023-05-01', 80000, 'ALL');
select id as annual from public.leave_types where company_id = :'co' and name = 'Annual leave' \gset
select id as unpaid from public.leave_types where company_id = :'co' and name = 'Unpaid leave' \gset

-- ---------- leave ----------------------------------------------------------------------------------
insert into public.leave_requests (company_id, employee_id, leave_type_id, start_date, end_date) values (:'co', :'besa', :'unpaid', '2026-09-21', '2026-09-22')
returning id as lv_b \gset
select public.submit_leave_request(:'lv_b');
select t.login('ola@hr.al');
select public.decide_leave_request(:'lv_b', true);

select t.login('eda@hr.al');
insert into public.leave_requests (company_id, employee_id, leave_type_id, start_date, end_date) values (:'co', :'eda', :'annual', '2026-11-02', '2026-11-06')
returning id as lv1, days as lv1_days \gset
select t.ok(:'lv1_days' = '5.00', 'leave days are working days (Mon–Fri = 5)');
select public.submit_leave_request(:'lv1');
select t.throws(format($q$select public.decide_leave_request(%L, true)$q$, :'lv1'), 'manager can decide', 'an employee cannot approve her own leave');
select t.login('mark@hr.al');
select t.ok(exists (select 1 from public.notifications where title = 'Leave request: Eda Employee'), 'the manager is notified');
select public.decide_leave_request(:'lv1', true, 'Enjoy');
select t.login('eda@hr.al');
select t.ok(exists (select 1 from public.notifications where title like 'Leave approved:%'), 'the employee hears back');
select t.ok((select (entitlement, taken, remaining) = (20::numeric, 5.00, 15.00) from public.leave_balances(:'co', 2026, :'eda') where leave_type_id = :'annual'),
            'balance: 20 days, 5 taken, 15 left');
insert into public.leave_requests (company_id, employee_id, leave_type_id, start_date, end_date) values (:'co', :'eda', :'annual', '2026-11-05', '2026-11-06')
returning id as lv2 \gset
select t.throws(format($q$select public.submit_leave_request(%L)$q$, :'lv2'), 'already has leave', 'overlapping leave is refused');
insert into public.leave_requests (company_id, employee_id, leave_type_id, start_date, end_date) values (:'co', :'eda', :'annual', '2026-12-01', '2026-12-31')
returning id as lv3, days as lv3_days \gset
select t.ok(:'lv3_days' = '20.00', 'December: 23 weekdays less 1, 8 and 25 December');
select t.throws(format($q$select public.submit_leave_request(%L)$q$, :'lv3'), '15 days of annual leave left', 'more than the balance is refused');
insert into public.leave_requests (company_id, employee_id, leave_type_id, start_date, end_date) values (:'co', :'eda', :'annual', '2026-11-23', '2026-11-30')
returning days as lv4_days \gset
select t.ok(:'lv4_days' = '4.00', 'holidays in the range are not counted (23 and 30 November)');
select t.login('hana@hr.al');
select t.ok((select entitlement from public.leave_balances(:'co', 2026, :'lira') where leave_type_id = :'annual') = 6.5,
            'a September joiner gets 4/12 of the year, rounded to half days');

-- ---------- attendance ---------------------------------------------------------------------------
insert into public.attendance_records (company_id, employee_id, work_date, check_in, check_out)
values (:'co', :'eda', '2026-09-01', '2026-09-01 08:00+02', '2026-09-01 16:30+02');
select t.ok((select (days -> 0 ->> 'c', days -> 0 ->> 'h', days -> 4 ->> 'c', days -> 6 ->> 'c') = ('P', '8.50', 'W', 'H')
               from public.attendance_month(:'co', '2026-09-01') where employee_id = :'eda'),
            'attendance grid: present 8.5 h on 1 Sep, weekend on the 5th, holiday on the 7th');
select t.ok((select (days -> 20 ->> 'c', leave_days) = ('U', 2::numeric) from public.attendance_month(:'co', '2026-09-01') where employee_id = :'besa'),
            'unpaid leave shows in the grid');
select t.ok((select days -> 10 ->> 'c' from public.attendance_month(:'co', '2026-09-01') where employee_id = :'lira') = '', 'nothing before the hire date');

-- ---------- payroll --------------------------------------------------------------------------------
select t.ok(public.payroll_income_tax('AL', 60000, public.payroll_params('AL', '2026-09-30')) = 3250
            and public.payroll_income_tax('AL', 100000, public.payroll_params('AL', '2026-09-30')) = 9100
            and public.payroll_income_tax('AL', 250000, public.payroll_params('AL', '2026-09-30')) = 33600,
            'TAP: 60,000 → 3,250; 100,000 → 9,100; 250,000 → 33,600');
select public.create_payroll_run(:'co', 2026, 9) as run \gset
select t.throws(format($q$select public.create_payroll_run(%L, 2026, 9)$q$, :'co'), 'already a payroll run', 'one run per month');
insert into public.payroll_run_items (company_id, payroll_run_id, employee_id, name, amount) values (:'co', :'run', :'mark', 'Q3 bonus', 10000);
select public.calculate_payroll(:'run');
select t.ok((select employee_count from public.payroll_runs where id = :'run') = 4, 'four payslips');
select t.ok((select (gross_salary, employee_contributions, income_tax, net_salary, employer_contributions) = (100000.00, 11200.00, 9100.00, 79700.00, 16700.00)
               from public.payslips where payroll_run_id = :'run' and employee_id = :'eda'), 'Eda: 100,000 → net 79,700');
select t.ok((select (gross_salary, contribution_base, employee_contributions, income_tax, net_salary, employer_contributions)
                    = (260000.00, 186416.00, 22130.00, 35900.00, 201970.00, 32382.00)
               from public.payslips where payroll_run_id = :'run' and employee_id = :'mark'), 'Mark: social insurance capped at 186,416, bonus taxed at 23%');
select t.ok((select (paid_days, working_days, gross_salary, employee_contributions, income_tax, net_salary) = (11.00, 21.00, 31428.57, 3520.00, 0.00, 27908.57)
               from public.payslips where payroll_run_id = :'run' and employee_id = :'lira'), 'Lira: 11 of 21 days, below the TAP threshold');
select t.ok((select (unpaid_leave_days, gross_salary, income_tax, net_salary) = (2.00, 72380.95, 5510.00, 58764.95)
               from public.payslips where payroll_run_id = :'run' and employee_id = :'besa'), 'Besa: 2 unpaid days deducted');
select t.ok((select (total_gross, total_employee_contrib, total_income_tax, total_net, total_employer_contrib)
                    = (463809.52, 44956.00, 50510.00, 368343.52, 66417.00) from public.payroll_runs where id = :'run'), 'run totals');
select t.ok((select count(*) from public.payslip_lines l join public.payslips p on p.id = l.payslip_id where p.payroll_run_id = :'run' and p.employee_id = :'mark'
               and l.code in ('BASIC','BONUS','SOC_EE','HEALTH_EE','TAP','SOC_ER','HEALTH_ER')) = 7, 'payslip lines show every element');
select t.throws(format($q$select public.approve_payroll(%L)$q$, :'run'), 'Someone other than', 'whoever calculated cannot approve');

select t.login('eda@hr.al');
select t.ok((select count(*) from public.payslips) = 0, 'employees do not see payslips before posting');

select t.login('ola@hr.al');
select public.approve_payroll(:'run');
select public.post_payroll(:'run');
select t.ok(pg_temp.bal(:'co', '641') = 463809.52 and pg_temp.bal(:'co', '644') = 66417 and pg_temp.bal(:'co', '421') = -368343.52
            and pg_temp.bal(:'co', '431') = -111373 and pg_temp.bal(:'co', '442') = -50510, 'posted: Dr 641 / 644, Cr 421 / 431 / 442');
select id as bank from public.bank_accounts where company_id = :'co' and account_kind = 'bank' limit 1 \gset
select public.pay_payroll(:'run', :'bank');
select t.ok(pg_temp.bal(:'co', '421') = 0 and pg_temp.bal(:'co', '5121') = -368343.52 and (select status from public.payroll_runs where id = :'run') = 'paid',
            'salaries paid from the bank');
select t.throws(format($q$select public.reopen_payroll(%L)$q$, :'run'), 'is paid', 'paid payroll cannot be reopened');
select t.ok((select (ss_employee, health_employee, income_tax, net) = (9500.00, 1700.00, 9100.00, 79700.00) from public.payroll_register(:'run') where employee_id = :'eda'),
            'payroll register line for the monthly declaration');

select t.login('eda@hr.al');
select t.ok((select count(*) from public.payslips) = 1 and (select employee_id from public.payslips) = :'eda'::uuid, 'after posting, Eda sees only her payslip');
select t.login('acc@hr.al');
select t.ok((select count(*) from public.payslips) = 0, 'accountants without payroll rights see no payslips');
select t.login('hana@hr.al');
select t.ok((public.hr_overview(:'co') ->> 'headcount')::int = 4, 'HR overview headcount');

-- ---------- Kosovo -----------------------------------------------------------------------------------
select t.login('alice@alba.al');
select public.create_company('Njerëz Kosova', 'XK', 'EUR') as xk \gset
insert into public.employees (company_id, first_name, last_name, hire_date) values (:'xk', 'Arben', 'Primary', '2024-01-01') returning id as arben \gset
insert into public.employees (company_id, first_name, last_name, hire_date) values (:'xk', 'Blerta', 'Secondary', '2024-01-01') returning id as blerta \gset
insert into public.employment_contracts (company_id, employee_id, start_date, gross_salary, currency_code, is_primary_employer) values
  (:'xk', :'arben', '2024-01-01', 1000, 'EUR', true), (:'xk', :'blerta', '2024-01-01', 400, 'EUR', false);
insert into public.attendance_records (company_id, employee_id, work_date, check_in, check_out, overtime_hours)
values (:'xk', :'arben', '2026-09-03', '2026-09-03 08:00+02', '2026-09-03 18:00+02', 2);
select public.create_payroll_run(:'xk', 2026, 9) as xrun \gset
select public.calculate_payroll(:'xrun');
select t.ok((select (gross_salary, employee_contributions, taxable_income, income_tax, net_salary, employer_contributions)
                    = (1015.00, 50.75, 964.25, 67.43, 896.82, 50.75) from public.payslips where payroll_run_id = :'xrun' and employee_id = :'arben'),
            'XK: 2 h overtime at +30%; tax 0 / 8 % / 10 % on gross less 5 % pension');
select t.ok((select (income_tax, net_salary) = (38.00, 342.00) from public.payslips where payroll_run_id = :'xrun' and employee_id = :'blerta'),
            'XK secondary employer: flat 10 %');

reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
