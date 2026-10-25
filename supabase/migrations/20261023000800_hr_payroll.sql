-- =============================================================================
-- DrisPRO · 0800 · Human resources & payroll
-- HR data is protected by hr.* / payroll.* permissions. On top of that,
-- every employee linked to a login gets self-service policies: read own
-- record, attendance and (approved) payslips; create and withdraw own leave.
-- Payroll rules for AL (social + health insurance, progressive income tax) and
-- XK (Trust pension 5%+5%, progressive income tax) are applied by the payroll
-- engine (Phase 8); payslips store the full breakdown.
-- =============================================================================

create table public.departments (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id),
  code           text,
  name           text not null,
  parent_id      uuid,
  manager_id     uuid,                       -- employee; FK below
  cost_center_id uuid,
  foreign key (company_id, cost_center_id) references public.cost_centers(company_id, id)
);
select app.register_table('public.departments', 'hr', 'core');
alter table public.departments add foreign key (company_id, parent_id) references public.departments(company_id, id);

create table public.job_positions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  title         text not null,
  department_id uuid,
  description   text,
  foreign key (company_id, department_id) references public.departments(company_id, id)
);
select app.register_table('public.job_positions', 'hr', 'core');

create table public.employees (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id),
  number            text not null,           -- employee number (EMP-…)
  user_id           uuid references auth.users(id),
  first_name        text not null,
  last_name         text not null,
  full_name         text generated always as (first_name || ' ' || last_name) stored,
  personal_number   text,                    -- national ID (NID / numri personal)
  date_of_birth     date,
  gender            text check (gender in ('female','male','other')),
  email             text,
  phone             text,
  address           text,
  department_id     uuid,
  position_id       uuid,
  manager_id        uuid,
  hire_date         date not null,
  termination_date  date,
  employment_status text not null default 'active' check (employment_status in ('active','on_leave','terminated')),
  employment_type   text not null default 'full_time' check (employment_type in ('full_time','part_time','contract','intern')),
  bank_name         text,
  iban              text,
  cost_center_id    uuid,
  partner_id        uuid,                    -- for expense reimbursements
  foreign key (company_id, department_id)  references public.departments(company_id, id),
  foreign key (company_id, position_id)    references public.job_positions(company_id, id),
  foreign key (company_id, cost_center_id) references public.cost_centers(company_id, id),
  foreign key (company_id, partner_id)     references public.business_partners(company_id, id),
  check (termination_date is null or termination_date >= hire_date)
);
select app.register_table('public.employees', 'hr');
alter table public.employees add foreign key (company_id, manager_id) references public.employees(company_id, id);
-- Numbering only (employees have no status flow)
create trigger trg_10_number before insert or update of number on public.employees
  for each row execute function app.tg_assign_number('employee', 'hire_date');
create unique index employees_number_key on public.employees (company_id, number) where deleted_at is null;
create unique index employees_user_key on public.employees (company_id, user_id) where user_id is not null and deleted_at is null;
create unique index employees_personal_number_key on public.employees (company_id, personal_number) where personal_number is not null and deleted_at is null;
create index employees_name_trgm on public.employees using gin (full_name extensions.gin_trgm_ops);

alter table public.departments add foreign key (company_id, manager_id) references public.employees(company_id, id);
alter table public.fixed_assets add foreign key (company_id, custodian_employee_id) references public.employees(company_id, id);

create or replace function app.my_employee_ids()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(e.id), '{}') from public.employees e
   where e.user_id = auth.uid() and e.deleted_at is null
     and e.company_id = any (app.my_company_ids())
$$;

create policy employees_self_select on public.employees for select to authenticated
  using (id = any ((select app.my_employee_ids())::uuid[]));

create table public.employment_contracts (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null,
  employee_id            uuid not null,
  contract_type          text not null default 'indefinite' check (contract_type in ('indefinite','fixed_term','seasonal','service')),
  start_date             date not null,
  end_date               date,
  gross_salary           numeric(18,2) not null check (gross_salary >= 0),
  currency_code          char(3) not null references public.currencies(code),
  working_hours_per_week numeric(5,2) not null default 40,
  pay_frequency          text not null default 'monthly' check (pay_frequency in ('monthly','biweekly','weekly')),
  is_primary_employer    boolean not null default true,   -- XK: tax treatment differs for secondary employment
  status                 text not null default 'active' check (status in ('draft','active','ended')),
  notes                  text,
  foreign key (company_id, employee_id) references public.employees(company_id, id),
  check (end_date is null or end_date >= start_date)
);
select app.register_table('public.employment_contracts', 'payroll', 'payroll');
create unique index employment_contracts_one_active on public.employment_contracts (employee_id) where status = 'active' and deleted_at is null;

create table public.attendance_records (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null,
  employee_id  uuid not null,
  work_date    date not null,
  check_in     timestamptz,
  check_out    timestamptz,
  hours_worked numeric(6,2) generated always as (
                 case when check_in is not null and check_out is not null
                      then round((extract(epoch from (check_out - check_in)) / 3600)::numeric, 2) end) stored,
  overtime_hours numeric(6,2) not null default 0,
  source       text not null default 'manual' check (source in ('manual','terminal','mobile','import')),
  notes        text,
  foreign key (company_id, employee_id) references public.employees(company_id, id),
  check (check_out is null or check_in is null or check_out > check_in)
);
select app.register_table('public.attendance_records', 'hr', p_soft_delete => false);
create index attendance_employee_idx on public.attendance_records (employee_id, work_date desc);
create policy attendance_self_select on public.attendance_records for select to authenticated
  using (employee_id = any ((select app.my_employee_ids())::uuid[]));

create table public.leave_types (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  name          text not null,
  days_per_year numeric(5,2) not null default 0,
  is_paid       boolean not null default true,
  requires_document boolean not null default false,
  is_active     boolean not null default true
);
select app.register_table('public.leave_types', 'hr', 'core');

create table public.leave_requests (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  number        text not null,
  status        text not null default 'draft',
  employee_id   uuid not null,
  leave_type_id uuid not null,
  start_date    date not null,
  end_date      date not null,
  days          numeric(5,2) not null check (days > 0),
  reason        text,
  decided_by    uuid references auth.users(id),
  decided_at    timestamptz,
  foreign key (company_id, employee_id)   references public.employees(company_id, id),
  foreign key (company_id, leave_type_id) references public.leave_types(company_id, id),
  check (end_date >= start_date)
);
select app.register_table('public.leave_requests', 'hr');
select app.register_document('public.leave_requests', 'leave_request', 'start_date');
create policy leave_self_select on public.leave_requests for select to authenticated
  using (employee_id = any ((select app.my_employee_ids())::uuid[]));
create policy leave_self_insert on public.leave_requests for insert to authenticated
  with check (employee_id = any ((select app.my_employee_ids())::uuid[]) and status in ('draft','submitted'));
create policy leave_self_update on public.leave_requests for update to authenticated
  using (employee_id = any ((select app.my_employee_ids())::uuid[]) and status in ('draft','submitted'))
  with check (employee_id = any ((select app.my_employee_ids())::uuid[]) and status in ('draft','submitted','cancelled')
              and decided_by is null);

-- -----------------------------------------------------------------------------
-- Payroll
-- -----------------------------------------------------------------------------
create table public.payroll_runs (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id),
  number                text not null,
  status                text not null default 'draft',
  country_rules         char(2) not null check (country_rules in ('AL','XK')),
  period_start          date not null,
  period_end            date not null,
  pay_date              date not null,
  total_gross           numeric(18,2) not null default 0,
  total_employee_contrib numeric(18,2) not null default 0,
  total_income_tax      numeric(18,2) not null default 0,
  total_net             numeric(18,2) not null default 0,
  total_employer_contrib numeric(18,2) not null default 0,
  total_employer_cost   numeric(18,2) generated always as (total_gross + total_employer_contrib) stored,
  journal_entry_id      uuid,
  foreign key (company_id, journal_entry_id) references public.journal_entries(company_id, id),
  check (period_end >= period_start)
);
select app.register_table('public.payroll_runs', 'payroll');
select app.register_document('public.payroll_runs', 'payroll_run', 'period_end');

create table public.payslips (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null,
  payroll_run_id        uuid not null,
  employee_id           uuid not null,
  contract_id           uuid,
  worked_days           numeric(5,2),
  gross_salary          numeric(18,2) not null default 0,
  employee_contributions numeric(18,2) not null default 0,  -- AL: social+health; XK: pension 5%
  taxable_income        numeric(18,2) not null default 0,
  income_tax            numeric(18,2) not null default 0,
  other_deductions      numeric(18,2) not null default 0,
  net_salary            numeric(18,2) not null default 0,
  employer_contributions numeric(18,2) not null default 0,  -- AL: social+health; XK: pension 5%
  foreign key (company_id, payroll_run_id) references public.payroll_runs(company_id, id) on delete cascade,
  foreign key (company_id, employee_id)    references public.employees(company_id, id),
  foreign key (company_id, contract_id)    references public.employment_contracts(company_id, id),
  unique (payroll_run_id, employee_id)
);
select app.register_table('public.payslips', 'payroll', p_soft_delete => false);
select app.register_lines('public.payslips', 'payroll_runs', 'payroll_run_id', 'draft,calculated', p_totals => false, p_tax => false);

create or replace function app.my_visible_payslip_ids()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(p.id), '{}')
    from public.payslips p join public.payroll_runs r on r.id = p.payroll_run_id
   where p.employee_id = any (app.my_employee_ids()) and r.status in ('posted','paid')
$$;
create policy payslips_self_select on public.payslips for select to authenticated
  using (id = any ((select app.my_visible_payslip_ids())::uuid[]));

create table public.payslip_lines (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  payslip_id uuid not null,
  line_type  text not null check (line_type in ('earning','deduction','employee_contribution','employer_contribution','tax')),
  code       text not null,                  -- BASIC, OVERTIME, SOC_EE, HEALTH_EE, PENSION_EE, TAP, …
  name       text not null,
  base       numeric(18,2),
  rate_pct   numeric(7,4),
  amount     numeric(18,2) not null,
  foreign key (company_id, payslip_id) references public.payslips(company_id, id) on delete cascade
);
select app.register_table('public.payslip_lines', 'payroll', p_soft_delete => false, p_client_write => false);
create index payslip_lines_payslip_idx on public.payslip_lines (payslip_id);
create policy payslip_lines_self_select on public.payslip_lines for select to authenticated
  using (payslip_id = any ((select app.my_visible_payslip_ids())::uuid[]));
