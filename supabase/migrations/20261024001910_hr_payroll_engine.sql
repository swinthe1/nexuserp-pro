-- =============================================================================
-- DrisPRO · 1910 · HR & payroll engine (Phase 8)
--
-- * Holidays per company (seeded with the 2026 official days, moved days
--   included) drive working-day counts for leave and payroll.
-- * Leave: days computed from the calendar, balance checked for paid types
--   with an annual entitlement, submitted → approved / rejected by HR or the
--   employee's manager; notifications both ways.
-- * Attendance: month grid per employee (present, leave, holiday, absent).
-- * Payroll: rules are data (payroll_parameters, by country and valid-from).
--     AL 2026: social 9.5 % / 15 % on a 50,000–186,416 ALL base; health
--              1.7 % / 1.7 % on gross; TAP 0 % to 50,000, 13 % of (gross −
--              35,000) to 60,000, 13 % of (gross − 30,000) to 200,000, then
--              22,100 + 23 % above 200,000. TAP is on gross.
--     XK:      pension 5 % / 5 %; income tax on gross less employee pension:
--              0 % to 250 €, 8 % to 450 €, 10 % above; secondary employer 10 %.
--   draft → calculated → approved (payroll.approve, not by who calculated) →
--   posted (GL) → paid (bank). Employees see their payslips once posted.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Holidays and payroll parameters
-- -----------------------------------------------------------------------------
create table public.public_holidays (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  holiday_date date not null,
  name         text not null,
  unique (company_id, holiday_date)
);
select app.register_table('public.public_holidays', 'hr', 'core', p_soft_delete => false);

create or replace function app.seed_holidays(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_country text;
begin
  select country_code into v_country from public.companies where id = p_company;
  insert into public.public_holidays (company_id, holiday_date, name)
  select p_company, d::date, n from (values
    ('AL','2026-01-01','New Year''s Day'), ('AL','2026-01-02','New Year''s Day'), ('AL','2026-03-16','Summer Day (observed)'),
    ('AL','2026-03-20','Eid al-Fitr'), ('AL','2026-03-23','Nevruz Day (observed)'), ('AL','2026-04-06','Catholic Easter (observed)'),
    ('AL','2026-04-13','Orthodox Easter (observed)'), ('AL','2026-05-01','Labour Day'), ('AL','2026-05-27','Eid al-Adha'),
    ('AL','2026-09-07','Mother Teresa Day (observed)'), ('AL','2026-11-23','Alphabet Day (observed)'),
    ('AL','2026-11-30','Independence Day (observed)'), ('AL','2026-12-01','Liberation Day (observed)'),
    ('AL','2026-12-08','National Youth Day'), ('AL','2026-12-25','Christmas Day'),
    ('XK','2026-01-01','New Year''s Day'), ('XK','2026-01-02','New Year''s Day'), ('XK','2026-01-07','Orthodox Christmas'),
    ('XK','2026-02-17','Independence Day'), ('XK','2026-03-20','Eid al-Fitr'), ('XK','2026-04-06','Catholic Easter Monday'),
    ('XK','2026-04-09','Constitution Day'), ('XK','2026-04-13','Orthodox Easter Monday'), ('XK','2026-05-01','Labour Day'),
    ('XK','2026-05-11','Europe Day (observed)'), ('XK','2026-05-28','Eid al-Adha'), ('XK','2026-12-25','Christmas Day')
  ) h(c, d, n)
  where h.c = v_country
  on conflict (company_id, holiday_date) do nothing;
end $$;
create or replace function app.tg_company_holidays()
returns trigger language plpgsql security definer set search_path = '' as $$
begin perform app.seed_holidays(new.id); return null; end $$;
create trigger trg_97_holidays after insert on public.companies for each row execute function app.tg_company_holidays();
select app.seed_holidays(id) from public.companies;

-- Global payroll rules (read-only for clients; maintained by migrations / platform admins)
create table public.payroll_parameters (
  id           uuid primary key default gen_random_uuid(),
  country_code char(2) not null check (country_code in ('AL','XK')),
  valid_from   date not null,
  params       jsonb not null,
  source       text,
  unique (country_code, valid_from)
);
alter table public.payroll_parameters enable row level security;
create policy payroll_parameters_read on public.payroll_parameters for select to authenticated using (true);
grant select on public.payroll_parameters to authenticated;

insert into public.payroll_parameters (country_code, valid_from, params, source) values
  ('AL', '2025-01-01', '{"ss_ee":9.5,"ss_er":15,"hi_ee":1.7,"hi_er":1.7,"ss_min":40000,"ss_max":176416,
     "tax":[{"upto":50000,"rate":0},{"upto":60000,"rate":13,"less":35000},{"upto":200000,"rate":13,"less":30000},{"rate":23,"over":200000,"fixed":22100}],
     "overtime_pct":25}', 'Law 29/2023 on income tax; ISSH contribution rates'),
  ('AL', '2026-01-01', '{"ss_ee":9.5,"ss_er":15,"hi_ee":1.7,"hi_er":1.7,"ss_min":50000,"ss_max":186416,
     "tax":[{"upto":50000,"rate":0},{"upto":60000,"rate":13,"less":35000},{"upto":200000,"rate":13,"less":30000},{"rate":23,"over":200000,"fixed":22100}],
     "overtime_pct":25}', 'Minimum wage 50,000 ALL and maximum insurable wage 186,416 ALL from 1 January 2026'),
  ('XK', '2023-01-01', '{"pension_ee":5,"pension_er":5,
     "tax":[{"upto":250,"rate":0},{"upto":450,"rate":8},{"rate":10}],"secondary_rate":10,"overtime_pct":30}',
   'Law 08/L-142 on personal income tax; Trust pension 5% + 5%');

-- -----------------------------------------------------------------------------
-- 2. Calendar helpers
-- -----------------------------------------------------------------------------
create or replace function app.working_days(p_company uuid, p_from date, p_to date)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from generate_series(p_from, p_to, interval '1 day') d
   where extract(isodow from d) < 6
     and not exists (select 1 from public.public_holidays h where h.company_id = p_company and h.holiday_date = d::date)
$$;

-- -----------------------------------------------------------------------------
-- 3. Leave
-- -----------------------------------------------------------------------------
alter table public.leave_requests add column decision_note text;

create or replace function app.tg_leave_days()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.start_date is distinct from old.start_date or new.end_date is distinct from old.end_date then
    new.days := greatest(app.working_days(new.company_id, new.start_date, new.end_date), 0);
    if new.days = 0 then raise exception 'The dates cover no working days' using errcode = '23514'; end if;
  end if;
  if tg_op = 'UPDATE' and old.status in ('approved','rejected') and new.status = old.status
     and (new.start_date, new.end_date, new.leave_type_id, new.employee_id) is distinct from (old.start_date, old.end_date, old.leave_type_id, old.employee_id) then
    raise exception 'Decided leave cannot be changed; cancel it and request again' using errcode = '55000';
  end if;
  return new;
end $$;
create trigger trg_03_days before insert or update on public.leave_requests for each row execute function app.tg_leave_days();
-- days is set by the trigger; the check (days > 0) would reject the placeholder otherwise
alter table public.leave_requests alter column days set default 1;

create trigger trg_04_system_statuses before insert or update of status on public.leave_requests
  for each row execute function app.tg_system_statuses('approved','rejected');

create or replace function public.leave_balances(p_company uuid, p_year int default null, p_employee uuid default null)
returns table (employee_id uuid, employee text, leave_type_id uuid, leave_type text, entitlement numeric, taken numeric, pending numeric, remaining numeric)
language sql stable security definer set search_path = '' as $$
  with y as (select coalesce(p_year, extract(year from current_date)::int) as y)
  select e.id, e.full_name, t.id, t.name,
         -- annual entitlement, pro rata for the months employed this year
         round(t.days_per_year * least(12, greatest(0,
               12 - case when e.hire_date > make_date(y.y, 1, 1) then extract(month from e.hire_date) - 1 else 0 end
                  - case when e.termination_date < make_date(y.y, 12, 31) then 12 - extract(month from e.termination_date) else 0 end)) / 12 * 2) / 2,
         coalesce(sum(r.days) filter (where r.status = 'approved'), 0),
         coalesce(sum(r.days) filter (where r.status = 'submitted'), 0),
         round(t.days_per_year * least(12, greatest(0,
               12 - case when e.hire_date > make_date(y.y, 1, 1) then extract(month from e.hire_date) - 1 else 0 end
                  - case when e.termination_date < make_date(y.y, 12, 31) then 12 - extract(month from e.termination_date) else 0 end)) / 12 * 2) / 2
           - coalesce(sum(r.days) filter (where r.status in ('approved','submitted')), 0)
    from y cross join public.employees e
    join public.leave_types t on t.company_id = e.company_id and t.is_active and t.deleted_at is null and t.days_per_year > 0
    left join public.leave_requests r on r.employee_id = e.id and r.leave_type_id = t.id and r.deleted_at is null
         and extract(year from r.start_date) = y.y
   where e.company_id = p_company and e.deleted_at is null and e.employment_status <> 'terminated'
     and (p_employee is null or e.id = p_employee)
     and (app.has_permission(p_company, 'hr.read') or e.id = any (app.my_employee_ids()))
   group by e.id, e.full_name, e.hire_date, e.termination_date, t.id, t.name, t.days_per_year, y.y
   order by e.full_name, t.name
$$;

create or replace function app.employee_user(p_employee uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select user_id from public.employees where id = p_employee
$$;

-- Submitting (by the RPC or by inserting as 'submitted'): no overlap, enough balance; managers and HR are told
create or replace function app.tg_leave_validate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare e public.employees; t public.leave_types; v_left numeric;
begin
  if new.status <> 'submitted' or (tg_op = 'UPDATE' and old.status = 'submitted') then return new; end if;
  select * into e from public.employees where id = new.employee_id;
  select * into t from public.leave_types where id = new.leave_type_id;
  if exists (select 1 from public.leave_requests x where x.employee_id = new.employee_id and x.id <> new.id and x.deleted_at is null
               and x.status in ('submitted','approved') and daterange(x.start_date, x.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')) then
    raise exception '% already has leave in those dates', e.full_name using errcode = '23P01';
  end if;
  if t.days_per_year > 0 then
    select remaining + case when tg_op = 'UPDATE' and old.status in ('submitted','approved') and old.leave_type_id = new.leave_type_id then old.days else 0 end
      into v_left from public.leave_balances(new.company_id, extract(year from new.start_date)::int, new.employee_id) b where b.leave_type_id = t.id;
    if coalesce(v_left, 0) < new.days then
      raise exception '% has % days of % left; this request needs %', e.full_name, trim_scale(coalesce(v_left, 0)), lower(t.name), trim_scale(new.days)
        using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger trg_06_validate before insert or update of status on public.leave_requests
  for each row execute function app.tg_leave_validate();

-- permission check for another user (who receives a link)
create or replace function app.has_permission_of(p_user uuid, p_company uuid, p_perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.company_members m join public.member_roles mr on mr.member_id = m.id join public.role_permissions rp on rp.role_id = mr.role_id
     where m.user_id = p_user and m.company_id = p_company and m.status = 'active' and m.deleted_at is null
       and (rp.permission in (p_perm, '*', split_part(p_perm, '.', 1) || '.*', '*.' || split_part(p_perm, '.', 2))))
$$;

create or replace function app.tg_leave_submitted()
returns trigger language plpgsql security definer set search_path = '' as $$
declare e public.employees; t public.leave_types; v_mgr uuid; v_body text;
begin
  if new.status <> 'submitted' or (tg_op = 'UPDATE' and old.status = 'submitted') then return null; end if;
  select * into e from public.employees where id = new.employee_id;
  select * into t from public.leave_types where id = new.leave_type_id;
  v_body := trim_scale(new.days) || ' days of ' || lower(t.name) || ' from ' || to_char(new.start_date, 'DD Mon');
  v_mgr := app.employee_user(e.manager_id);
  if v_mgr is not null then
    perform app.notify(new.company_id, v_mgr, 'approval', 'Leave request: ' || e.full_name, v_body,
                       case when app.has_permission_of(v_mgr, new.company_id, 'hr.read') then '/hr/leave?id=' || new.id else '/hr/me#team' end,
                       'leave_requests', new.id);
  end if;
  insert into public.notifications (company_id, user_id, type, title, body, link, entity_type, entity_id)
  select distinct new.company_id, m.user_id, 'approval', 'Leave request: ' || e.full_name, v_body, '/hr/leave?id=' || new.id, 'leave_requests', new.id
    from public.company_members m join public.member_roles mr on mr.member_id = m.id join public.roles r on r.id = mr.role_id
   where m.company_id = new.company_id and m.status = 'active' and m.user_id is not null and r.key = 'hr_manager'
     and m.user_id is distinct from v_mgr and m.user_id is distinct from e.user_id;
  return null;
end $$;
create trigger trg_94_submitted after insert or update of status on public.leave_requests
  for each row execute function app.tg_leave_submitted();

create or replace function public.submit_leave_request(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare r public.leave_requests;
begin
  select * into r from public.leave_requests where id = p_id for update;
  if r.id is null then raise exception 'Leave request not found' using errcode = 'P0002'; end if;
  if not (app.has_permission(r.company_id, 'hr.write') or r.employee_id = any (app.my_employee_ids())) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  if r.status <> 'draft' then raise exception 'Leave request % is %', r.number, r.status using errcode = '55000'; end if;
  update public.leave_requests set status = 'submitted' where id = p_id;
  return 'submitted';
end $$;

create or replace function public.decide_leave_request(p_id uuid, p_approve boolean, p_note text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare r public.leave_requests; e public.employees; v_status text; v_user uuid;
begin
  select * into r from public.leave_requests where id = p_id for update;
  if r.id is null then raise exception 'Leave request not found' using errcode = 'P0002'; end if;
  select * into e from public.employees where id = r.employee_id;
  if not (app.has_permission(r.company_id, 'hr.approve') or app.employee_user(e.manager_id) = auth.uid()) then
    raise exception 'Only HR or the manager can decide leave for %', e.full_name using errcode = '42501';
  end if;
  if e.user_id = auth.uid() then raise exception 'You cannot decide your own leave' using errcode = '42501'; end if;
  if r.status <> 'submitted' then raise exception 'Leave request % is %', r.number, r.status using errcode = '55000'; end if;
  v_status := case when p_approve then 'approved' else 'rejected' end;
  update public.leave_requests set status = v_status, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '')
   where id = p_id;
  v_user := e.user_id;
  if v_user is not null then
    perform app.notify(r.company_id, v_user, case when p_approve then 'info' else 'alert' end,
                       'Leave ' || v_status || ': ' || to_char(r.start_date, 'DD Mon') || ' – ' || to_char(r.end_date, 'DD Mon'),
                       nullif(btrim(p_note), ''), '/hr/me', 'leave_requests', r.id);
  end if;
  return v_status;
end $$;

create or replace function public.cancel_leave_request(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare r public.leave_requests;
begin
  select * into r from public.leave_requests where id = p_id for update;
  if r.id is null then raise exception 'Leave request not found' using errcode = 'P0002'; end if;
  if not (app.has_permission(r.company_id, 'hr.write') or (r.employee_id = any (app.my_employee_ids()) and r.status in ('draft','submitted'))) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  if r.status not in ('draft','submitted','approved') then raise exception 'Leave request % is %', r.number, r.status using errcode = '55000'; end if;
  if r.status = 'approved' and exists (select 1 from public.payroll_runs pr where pr.company_id = r.company_id and pr.status in ('approved','posted','paid')
                                         and pr.deleted_at is null and daterange(pr.period_start, pr.period_end, '[]') && daterange(r.start_date, r.end_date, '[]')) then
    raise exception 'Payroll for those dates is already approved' using errcode = '55000';
  end if;
  update public.leave_requests set status = 'cancelled' where id = p_id;
  return 'cancelled';
end $$;

-- -----------------------------------------------------------------------------
-- 4. Attendance
-- -----------------------------------------------------------------------------
-- One row per employee: day codes P present, L leave, U unpaid leave, H holiday, W weekend, A absent, '' not employed / future
create or replace function public.attendance_month(p_company uuid, p_month date, p_department uuid default null)
returns table (employee_id uuid, number text, employee text, department text, days jsonb,
               worked_hours numeric, overtime_hours numeric, present_days int, leave_days numeric, absent_days int, working_days int)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare v_from date := date_trunc('month', p_month)::date; v_to date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
begin
  if not app.has_permission(p_company, 'hr.read') then raise exception 'Permission denied: hr.read required' using errcode = '42501'; end if;
  return query
  with emp as (
    select e.*, d.name as dept from public.employees e left join public.departments d on d.id = e.department_id
     where e.company_id = p_company and e.deleted_at is null and (p_department is null or e.department_id = p_department)
       and e.hire_date <= v_to and (e.termination_date is null or e.termination_date >= v_from)
  ), cal as (
    select d::date as day, extract(isodow from d) >= 6 as weekend,
           (select h.name from public.public_holidays h where h.company_id = p_company and h.holiday_date = d::date) as holiday
      from generate_series(v_from, v_to, interval '1 day') d
  ), grid as (
    select emp.id as emp_id, cal.day,
           case when cal.day < emp.hire_date or cal.day > coalesce(emp.termination_date, v_to) then ''
                when lv.unpaid is not null and not cal.weekend and cal.holiday is null then case when lv.unpaid then 'U' else 'L' end
                when att.hours is not null or att.checked then 'P'
                when cal.holiday is not null then 'H'
                when cal.weekend then 'W'
                when cal.day > current_date then ''
                else 'A' end as code,
           coalesce(att.hours, 0) as hours, coalesce(att.ot, 0) as ot, lv.type_name,
           not cal.weekend and cal.holiday is null and cal.day >= emp.hire_date and cal.day <= coalesce(emp.termination_date, v_to) as workday
      from emp cross join cal
      left join lateral (select sum(a.hours_worked) as hours, sum(a.overtime_hours) as ot, bool_or(a.check_in is not null) as checked
                           from public.attendance_records a where a.employee_id = emp.id and a.work_date = cal.day) att on true
      left join lateral (select not t.is_paid as unpaid, t.name as type_name from public.leave_requests r join public.leave_types t on t.id = r.leave_type_id
                          where r.employee_id = emp.id and r.status = 'approved' and r.deleted_at is null and cal.day between r.start_date and r.end_date
                          limit 1) lv on true
  )
  select emp.id, emp.number, emp.full_name, emp.dept,
         jsonb_agg(jsonb_build_object('d', extract(day from g.day)::int, 'c', g.code, 'h', g.hours, 't', g.type_name) order by g.day),
         sum(g.hours), sum(g.ot), (count(*) filter (where g.code = 'P'))::int,
         (count(*) filter (where g.code in ('L','U')))::numeric, (count(*) filter (where g.code = 'A'))::int,
         (count(*) filter (where g.workday))::int
    from emp join grid g on g.emp_id = emp.id
   group by emp.id, emp.number, emp.full_name, emp.dept
   order by emp.full_name;
end $$;

-- Self-service and terminal clock in / out
create or replace function public.clock_attendance(p_employee uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_emp uuid; e public.employees; a public.attendance_records; v_tz text;
begin
  v_emp := coalesce(p_employee, (app.my_employee_ids())[1]);
  if v_emp is null then raise exception 'Your login is not linked to an employee' using errcode = 'P0002'; end if;
  select * into e from public.employees where id = v_emp;
  if not (v_emp = any (app.my_employee_ids()) or app.has_permission(e.company_id, 'hr.write')) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  select timezone into v_tz from public.companies where id = e.company_id;
  select * into a from public.attendance_records where employee_id = v_emp and check_out is null and check_in is not null
     and work_date = (now() at time zone v_tz)::date order by check_in desc limit 1 for update;
  if a.id is not null then
    update public.attendance_records set check_out = now() where id = a.id;
    return jsonb_build_object('action', 'out', 'at', now());
  end if;
  insert into public.attendance_records (company_id, employee_id, work_date, check_in, source)
  values (e.company_id, v_emp, (now() at time zone v_tz)::date, now(), case when p_employee is null then 'mobile' else 'manual' end);
  return jsonb_build_object('action', 'in', 'at', now());
end $$;

-- -----------------------------------------------------------------------------
-- 5. Payroll
-- -----------------------------------------------------------------------------
alter table public.payroll_runs
  add column calculated_by uuid references auth.users(id),
  add column calculated_at timestamptz,
  add column approved_by   uuid references auth.users(id),
  add column approved_at   timestamptz,
  add column payment_journal_entry_id uuid,
  add column bank_account_id uuid,
  add column employee_count int not null default 0,
  add column notes text,
  add foreign key (company_id, payment_journal_entry_id) references public.journal_entries(company_id, id);

alter table public.payslips
  add column working_days numeric(5,2),
  add column paid_days    numeric(5,2),
  add column unpaid_leave_days numeric(5,2) not null default 0,
  add column overtime_hours numeric(6,2) not null default 0,
  add column contribution_base numeric(18,2) not null default 0,
  add column cost_center_id uuid;

-- Extra earnings entered before calculating (bonus, allowance)
create table public.payroll_run_items (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null,
  payroll_run_id uuid not null,
  employee_id    uuid not null,
  code           text not null default 'BONUS',
  name           text not null,
  amount         numeric(18,2) not null check (amount > 0),
  foreign key (company_id, payroll_run_id) references public.payroll_runs(company_id, id) on delete cascade,
  foreign key (company_id, employee_id) references public.employees(company_id, id)
);
select app.register_table('public.payroll_run_items', 'payroll', p_soft_delete => false);
select app.register_lines('public.payroll_run_items', 'payroll_runs', 'payroll_run_id', 'draft,calculated', p_totals => false, p_tax => false);

create trigger trg_04_system_statuses before insert or update of status on public.payroll_runs
  for each row execute function app.tg_system_statuses('calculated','approved','posted','paid');

create or replace function public.payroll_params(p_country text, p_on date)
returns jsonb language sql stable set search_path = '' as $$
  select params from public.payroll_parameters where country_code = p_country and valid_from <= p_on order by valid_from desc limit 1
$$;

-- Income tax on a monthly amount (AL on gross; XK on gross less employee pension)
create or replace function public.payroll_income_tax(p_country text, p_taxable numeric, p_params jsonb, p_secondary boolean default false)
returns numeric language plpgsql immutable set search_path = '' as $$
declare b jsonb; v_prev numeric := 0; v_tax numeric := 0;
begin
  if p_taxable <= 0 then return 0; end if;
  if p_country = 'XK' then
    if p_secondary then return round(p_taxable * (p_params ->> 'secondary_rate')::numeric / 100, 2); end if;
    for b in select * from jsonb_array_elements(p_params -> 'tax') loop
      v_tax := v_tax + greatest(least(p_taxable, coalesce((b ->> 'upto')::numeric, p_taxable)) - v_prev, 0) * (b ->> 'rate')::numeric / 100;
      exit when b ->> 'upto' is null or p_taxable <= (b ->> 'upto')::numeric;
      v_prev := (b ->> 'upto')::numeric;
    end loop;
    return round(v_tax, 2);
  end if;
  -- AL: the bracket the gross falls in decides the formula
  for b in select * from jsonb_array_elements(p_params -> 'tax') loop
    if b ->> 'upto' is null or p_taxable <= (b ->> 'upto')::numeric then
      if b ? 'fixed' then
        return round((b ->> 'fixed')::numeric + (p_taxable - (b ->> 'over')::numeric) * (b ->> 'rate')::numeric / 100, 0);
      end if;
      return round(greatest(p_taxable - coalesce((b ->> 'less')::numeric, 0), 0) * (b ->> 'rate')::numeric / 100, 0);
    end if;
  end loop;
  return 0;
end $$;

create or replace function public.create_payroll_run(p_company uuid, p_year int, p_month int, p_pay_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_from date := make_date(p_year, p_month, 1); v_to date; v_id uuid; v_country text;
begin
  perform app.require_permission(p_company, 'payroll.write');
  v_to := (v_from + interval '1 month - 1 day')::date;
  select country_code into v_country from public.companies where id = p_company;
  if v_country not in ('AL','XK') then raise exception 'Payroll rules exist for Albania and Kosovo' using errcode = '23514'; end if;
  if exists (select 1 from public.payroll_runs where company_id = p_company and deleted_at is null and status <> 'cancelled'
               and daterange(period_start, period_end, '[]') && daterange(v_from, v_to, '[]')) then
    raise exception 'There is already a payroll run for %', to_char(v_from, 'FMMonth YYYY') using errcode = '23505';
  end if;
  insert into public.payroll_runs (company_id, country_rules, period_start, period_end, pay_date)
  values (p_company, v_country, v_from, v_to, coalesce(p_pay_date, v_to)) returning id into v_id;
  return v_id;
end $$;

create or replace function public.calculate_payroll(p_run uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.payroll_runs; pr jsonb; k record; v_slip uuid; v_wd numeric; v_paid numeric; v_unpaid numeric; v_ratio numeric;
  v_basic numeric; v_ot_h numeric; v_ot numeric; v_extra numeric; v_gross numeric; v_base numeric; v_ss_ee numeric; v_hi_ee numeric;
  v_ss_er numeric; v_hi_er numeric; v_ee numeric; v_er numeric; v_taxable numeric; v_tax numeric; v_hourly numeric; v_n int := 0; it record;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if r.id is null then raise exception 'Payroll run not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'payroll.write');
  if r.status not in ('draft','calculated') then raise exception 'Payroll % is %', r.number, r.status using errcode = '55000'; end if;
  pr := public.payroll_params(r.country_rules, r.period_end);
  if pr is null then raise exception 'No payroll rules for % on %', r.country_rules, r.period_end using errcode = 'P0002'; end if;

  delete from public.payslips where payroll_run_id = r.id;
  for k in
    select c.*, e.full_name, e.hire_date, e.termination_date, e.cost_center_id as emp_cc, d.cost_center_id as dept_cc
      from public.employment_contracts c join public.employees e on e.id = c.employee_id
      left join public.departments d on d.id = e.department_id
     where c.company_id = r.company_id and c.deleted_at is null and e.deleted_at is null and c.status in ('active','ended')
       and c.start_date <= r.period_end and (c.end_date is null or c.end_date >= r.period_start)
       and e.hire_date <= r.period_end and (e.termination_date is null or e.termination_date >= r.period_start)
     order by e.full_name
  loop
    -- days: working days of the month; paid = working days employed under this contract, less unpaid leave
    v_wd := app.working_days(r.company_id, r.period_start, r.period_end);
    v_paid := app.working_days(r.company_id, greatest(r.period_start, k.start_date, k.hire_date),
                               least(r.period_end, coalesce(k.end_date, r.period_end), coalesce(k.termination_date, r.period_end)));
    select coalesce(sum(app.working_days(r.company_id, greatest(lr.start_date, r.period_start), least(lr.end_date, r.period_end))), 0) into v_unpaid
      from public.leave_requests lr join public.leave_types t on t.id = lr.leave_type_id
     where lr.employee_id = k.employee_id and lr.status = 'approved' and lr.deleted_at is null and not t.is_paid
       and lr.start_date <= r.period_end and lr.end_date >= r.period_start;
    v_paid := greatest(v_paid - v_unpaid, 0);
    v_ratio := case when v_wd > 0 then v_paid / v_wd else 0 end;
    v_basic := round(k.gross_salary * v_ratio, 2);
    -- overtime from attendance, at the statutory premium
    select coalesce(sum(a.overtime_hours), 0) into v_ot_h from public.attendance_records a
     where a.employee_id = k.employee_id and a.work_date between r.period_start and r.period_end;
    v_hourly := k.gross_salary / nullif(k.working_hours_per_week * 52 / 12, 0);
    v_ot := round(v_ot_h * coalesce(v_hourly, 0) * (1 + (pr ->> 'overtime_pct')::numeric / 100), 2);
    select coalesce(sum(amount), 0) into v_extra from public.payroll_run_items where payroll_run_id = r.id and employee_id = k.employee_id;
    v_gross := v_basic + v_ot + v_extra;

    if r.country_rules = 'AL' then
      v_base := least(greatest(v_gross, round((pr ->> 'ss_min')::numeric * v_ratio, 2)), (pr ->> 'ss_max')::numeric);
      v_ss_ee := round(v_base * (pr ->> 'ss_ee')::numeric / 100, 0);
      v_hi_ee := round(v_gross * (pr ->> 'hi_ee')::numeric / 100, 0);
      v_ss_er := round(v_base * (pr ->> 'ss_er')::numeric / 100, 0);
      v_hi_er := round(v_gross * (pr ->> 'hi_er')::numeric / 100, 0);
      v_ee := v_ss_ee + v_hi_ee; v_er := v_ss_er + v_hi_er;
      v_taxable := v_gross;
      v_tax := public.payroll_income_tax('AL', v_gross, pr);
    else
      v_base := v_gross;
      v_ss_ee := round(v_gross * (pr ->> 'pension_ee')::numeric / 100, 2); v_hi_ee := 0;
      v_ss_er := round(v_gross * (pr ->> 'pension_er')::numeric / 100, 2); v_hi_er := 0;
      v_ee := v_ss_ee; v_er := v_ss_er;
      v_taxable := v_gross - v_ss_ee;
      v_tax := public.payroll_income_tax('XK', v_taxable, pr, not k.is_primary_employer);
    end if;

    insert into public.payslips (company_id, payroll_run_id, employee_id, contract_id, worked_days, working_days, paid_days, unpaid_leave_days,
                                 overtime_hours, gross_salary, contribution_base, employee_contributions, taxable_income, income_tax,
                                 net_salary, employer_contributions, cost_center_id)
    values (r.company_id, r.id, k.employee_id, k.id, v_paid, v_wd, v_paid, v_unpaid, v_ot_h, v_gross, v_base, v_ee, v_taxable, v_tax,
            v_gross - v_ee - v_tax, v_er, coalesce(k.emp_cc, k.dept_cc))
    returning id into v_slip;

    insert into public.payslip_lines (company_id, payslip_id, line_type, code, name, base, rate_pct, amount)
    select r.company_id, v_slip, x.t, x.c, x.n, x.b, x.p, x.a from (values
      ('earning', 'BASIC', 'Basic salary · ' || trim_scale(v_paid) || ' of ' || trim_scale(v_wd) || ' days', k.gross_salary, null::numeric, v_basic),
      ('earning', 'OVERTIME', 'Overtime · ' || trim_scale(v_ot_h) || ' h at +' || (pr ->> 'overtime_pct') || '%', round(coalesce(v_hourly, 0), 2), null, v_ot),
      ('employee_contribution', case when r.country_rules = 'AL' then 'SOC_EE' else 'PENSION_EE' end,
         case when r.country_rules = 'AL' then 'Social insurance' else 'Pension (Trust)' end, v_base,
         case when r.country_rules = 'AL' then (pr ->> 'ss_ee')::numeric else (pr ->> 'pension_ee')::numeric end, v_ss_ee),
      ('employee_contribution', 'HEALTH_EE', 'Health insurance', v_gross, (pr ->> 'hi_ee')::numeric, v_hi_ee),
      ('tax', case when r.country_rules = 'AL' then 'TAP' else 'TAX' end,
         case when r.country_rules = 'AL' then 'Income tax (TAP)' when not k.is_primary_employer then 'Income tax (secondary employer)' else 'Income tax' end,
         v_taxable, null, v_tax),
      ('employer_contribution', case when r.country_rules = 'AL' then 'SOC_ER' else 'PENSION_ER' end,
         case when r.country_rules = 'AL' then 'Social insurance (employer)' else 'Pension (employer)' end, v_base,
         case when r.country_rules = 'AL' then (pr ->> 'ss_er')::numeric else (pr ->> 'pension_er')::numeric end, v_ss_er),
      ('employer_contribution', 'HEALTH_ER', 'Health insurance (employer)', v_gross, (pr ->> 'hi_er')::numeric, v_hi_er)
    ) x(t, c, n, b, p, a)
    where x.a <> 0 or x.c in ('BASIC');
    for it in select * from public.payroll_run_items where payroll_run_id = r.id and employee_id = k.employee_id loop
      insert into public.payslip_lines (company_id, payslip_id, line_type, code, name, amount)
      values (r.company_id, v_slip, 'earning', it.code, it.name, it.amount);
    end loop;
    v_n := v_n + 1;
  end loop;

  update public.payroll_runs set status = 'calculated', calculated_by = auth.uid(), calculated_at = now(), employee_count = v_n,
         total_gross = coalesce((select sum(gross_salary) from public.payslips where payroll_run_id = r.id), 0),
         total_employee_contrib = coalesce((select sum(employee_contributions) from public.payslips where payroll_run_id = r.id), 0),
         total_income_tax = coalesce((select sum(income_tax) from public.payslips where payroll_run_id = r.id), 0),
         total_net = coalesce((select sum(net_salary) from public.payslips where payroll_run_id = r.id), 0),
         total_employer_contrib = coalesce((select sum(employer_contributions) from public.payslips where payroll_run_id = r.id), 0)
   where id = r.id;
  return jsonb_build_object('employees', v_n);
end $$;

create or replace function public.approve_payroll(p_run uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if r.id is null then raise exception 'Payroll run not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'payroll.approve');
  if r.status <> 'calculated' then raise exception 'Calculate payroll % first (it is %)', r.number, r.status using errcode = '55000'; end if;
  if r.calculated_by = auth.uid() and not app.is_super_admin() then
    raise exception 'Someone other than the person who calculated it must approve the payroll' using errcode = '42501';
  end if;
  if r.employee_count = 0 then raise exception 'Payroll % has no payslips', r.number using errcode = '23514'; end if;
  update public.payroll_runs set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = r.id;
  return 'approved';
end $$;

create or replace function public.reopen_payroll(p_run uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  perform app.require_permission(r.company_id, 'payroll.write');
  if r.status not in ('calculated','approved') then raise exception 'Payroll % is %', r.number, r.status using errcode = '55000'; end if;
  update public.payroll_runs set status = 'draft', approved_by = null, approved_at = null where id = r.id;
  return 'draft';
end $$;

-- Dr salaries (per cost center) and employer contributions; Cr net pay, contributions and income tax payable
create or replace function public.post_payroll(p_run uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs; v_lines jsonb := '[]'::jsonb; c record; v_je uuid;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if r.id is null then raise exception 'Payroll run not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'payroll.write');
  if r.status <> 'approved' then raise exception 'Approve payroll % first (it is %)', r.number, r.status using errcode = '55000'; end if;
  for c in select cost_center_id, sum(gross_salary) as gross, sum(employer_contributions) as er
             from public.payslips where payroll_run_id = r.id group by cost_center_id loop
    v_lines := v_lines
      || jsonb_build_object('account_id', app.acct(r.company_id, 'salary_expense'), 'amount', c.gross, 'cost_center_id', c.cost_center_id,
                            'description', 'Gross salaries ' || to_char(r.period_start, 'MM/YYYY'))
      || jsonb_build_object('account_id', app.acct(r.company_id, 'employer_contribution_expense'), 'amount', c.er, 'cost_center_id', c.cost_center_id,
                            'description', 'Employer contributions ' || to_char(r.period_start, 'MM/YYYY'));
  end loop;
  v_lines := v_lines
    || jsonb_build_object('account_id', app.acct(r.company_id, 'salary_payable'), 'amount', -r.total_net, 'description', 'Net salaries')
    || jsonb_build_object('account_id', app.acct(r.company_id, case when r.country_rules = 'XK' then 'pension_payable' else 'social_security_payable' end),
                          'amount', -(r.total_employee_contrib + r.total_employer_contrib),
                          'description', case when r.country_rules = 'XK' then 'Pension contributions (Trust)' else 'Social and health contributions' end)
    || jsonb_build_object('account_id', app.acct(r.company_id, 'income_tax_payable'), 'amount', -r.total_income_tax,
                          'description', case when r.country_rules = 'XK' then 'Income tax withheld' else 'Income tax withheld (TAP)' end);
  v_je := app.gl_post(r.company_id, 'PAY', r.period_end, 'payroll_run', r.id, r.number, 'Payroll ' || to_char(r.period_start, 'MM/YYYY'), v_lines);
  update public.payroll_runs set status = 'posted', journal_entry_id = v_je where id = r.id;
  -- employees with a login get their payslip
  perform app.notify(r.company_id, e.user_id, 'info', 'Your payslip for ' || to_char(r.period_start, 'FMMonth YYYY'), null, '/hr/me', 'payslips', p.id)
     from public.payslips p join public.employees e on e.id = p.employee_id where p.payroll_run_id = r.id and e.user_id is not null;
  return v_je;
end $$;

create or replace function public.pay_payroll(p_run uuid, p_bank_account uuid, p_date date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs; b record; v_je uuid;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if r.id is null then raise exception 'Payroll run not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'payroll.write');
  if r.status <> 'posted' then raise exception 'Post payroll % first (it is %)', r.number, r.status using errcode = '55000'; end if;
  select ba.*, j.code as journal_code into b from public.bank_accounts ba left join public.journals j on j.id = ba.journal_id
   where ba.id = p_bank_account and ba.company_id = r.company_id;
  if b.id is null then raise exception 'Choose the bank account the salaries are paid from' using errcode = '23514'; end if;
  v_je := app.gl_post(r.company_id, coalesce(b.journal_code, 'BNK'), coalesce(p_date, r.pay_date), 'payroll_run', r.id, r.number,
                      'Salary payment ' || to_char(r.period_start, 'MM/YYYY'),
                      jsonb_build_array(jsonb_build_object('account_id', app.acct(r.company_id, 'salary_payable'), 'amount', r.total_net, 'description', 'Net salaries paid'),
                                        jsonb_build_object('account_id', b.account_id, 'amount', -r.total_net, 'description', 'Salary transfer')),
                      'payment');
  update public.payroll_runs set status = 'paid', payment_journal_entry_id = v_je, bank_account_id = b.id where id = r.id;
  return v_je;
end $$;

create or replace function public.cancel_payroll(p_run uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  perform app.require_permission(r.company_id, 'payroll.write');
  if r.status not in ('draft','calculated') then raise exception 'Payroll % is %; posted payroll is corrected by a new run', r.number, r.status using errcode = '55000'; end if;
  update public.payroll_runs set status = 'draft' where id = r.id and status = 'calculated';
  update public.payroll_runs set status = 'cancelled' where id = r.id;
  return 'cancelled';
end $$;

-- Monthly payroll register in the layout of the declaration (AL: E-SIG 025 / listëpagesa; XK: monthly WP declaration)
create or replace function public.payroll_register(p_run uuid)
returns table (line_no int, employee_id uuid, personal_number text, last_name text, first_name text, job_title text, department text,
               paid_days numeric, gross numeric, contribution_base numeric, ss_employee numeric, health_employee numeric, ss_employer numeric,
               health_employer numeric, taxable numeric, income_tax numeric, net numeric, employer_cost numeric, iban text)
language sql stable security definer set search_path = '' as $$
  select (row_number() over (order by e.last_name, e.first_name))::int, e.id, e.personal_number, e.last_name, e.first_name, jp.title, d.name,
         p.paid_days, p.gross_salary, p.contribution_base,
         coalesce((select sum(amount) from public.payslip_lines l where l.payslip_id = p.id and l.code in ('SOC_EE','PENSION_EE')), 0),
         coalesce((select sum(amount) from public.payslip_lines l where l.payslip_id = p.id and l.code = 'HEALTH_EE'), 0),
         coalesce((select sum(amount) from public.payslip_lines l where l.payslip_id = p.id and l.code in ('SOC_ER','PENSION_ER')), 0),
         coalesce((select sum(amount) from public.payslip_lines l where l.payslip_id = p.id and l.code = 'HEALTH_ER'), 0),
         p.taxable_income, p.income_tax, p.net_salary, p.gross_salary + p.employer_contributions, e.iban
    from public.payslips p join public.employees e on e.id = p.employee_id
    join public.payroll_runs r on r.id = p.payroll_run_id
    left join public.job_positions jp on jp.id = e.position_id
    left join public.departments d on d.id = e.department_id
   where p.payroll_run_id = p_run and app.has_permission(r.company_id, 'payroll.read')
   order by e.last_name, e.first_name
$$;

-- -----------------------------------------------------------------------------
-- 6. HR overview
-- -----------------------------------------------------------------------------
create or replace function public.hr_overview(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; v_today date;
begin
  if not app.has_permission(p_company, 'hr.read') then raise exception 'Permission denied: hr.read required' using errcode = '42501'; end if;
  select (now() at time zone timezone)::date into v_today from public.companies where id = p_company;
  select jsonb_build_object(
    'headcount', (select count(*) from public.employees where company_id = p_company and deleted_at is null and employment_status <> 'terminated'
                    and hire_date <= v_today),
    'joiners_90d', (select count(*) from public.employees where company_id = p_company and deleted_at is null and hire_date > v_today - 90 and hire_date <= v_today),
    'leavers_90d', (select count(*) from public.employees where company_id = p_company and deleted_at is null and termination_date > v_today - 90 and termination_date <= v_today),
    'on_leave_today', (select count(distinct r.employee_id) from public.leave_requests r where r.company_id = p_company and r.status = 'approved'
                         and r.deleted_at is null and v_today between r.start_date and r.end_date),
    'pending_leave', (select count(*) from public.leave_requests where company_id = p_company and status = 'submitted' and deleted_at is null),
    'present_today', (select count(distinct employee_id) from public.attendance_records where company_id = p_company and work_date = v_today),
    'contracts_ending_60d', (select coalesce(jsonb_agg(jsonb_build_object('employee', e.full_name, 'employee_id', e.id, 'end_date', c.end_date) order by c.end_date), '[]')
                               from public.employment_contracts c join public.employees e on e.id = c.employee_id
                              where c.company_id = p_company and c.status = 'active' and c.deleted_at is null and c.end_date between v_today and v_today + 60),
    'by_department', (select coalesce(jsonb_agg(jsonb_build_object('department', coalesce(d.name, 'No department'), 'count', x.n) order by x.n desc), '[]')
                        from (select department_id, count(*) as n from public.employees where company_id = p_company and deleted_at is null
                                and employment_status <> 'terminated' group by department_id) x
                        left join public.departments d on d.id = x.department_id),
    'payroll_trend', case when app.has_permission(p_company, 'payroll.read') then
                       (select coalesce(jsonb_agg(jsonb_build_object('period', to_char(period_start, 'YYYY-MM'), 'gross', total_gross, 'net', total_net,
                                                                     'employer_cost', total_employer_cost, 'employees', employee_count) order by period_start), '[]')
                          from (select * from public.payroll_runs where company_id = p_company and deleted_at is null and status in ('posted','paid')
                                 order by period_start desc limit 12) x) end,
    'upcoming_leave', (select coalesce(jsonb_agg(jsonb_build_object('employee', e.full_name, 'type', t.name, 'start', r.start_date, 'end', r.end_date, 'days', r.days)
                                                 order by r.start_date), '[]')
                         from public.leave_requests r join public.employees e on e.id = r.employee_id join public.leave_types t on t.id = r.leave_type_id
                        where r.company_id = p_company and r.status = 'approved' and r.deleted_at is null and r.end_date >= v_today and r.start_date <= v_today + 30))
  into v;
  return v;
end $$;

-- Self-service: the period of each payslip the caller may see (runs themselves stay HR-only: they carry company totals)
create or replace function public.my_payslip_periods()
returns table (payslip_id uuid, run_number text, period_start date, period_end date, pay_date date, status text)
language sql stable security definer set search_path = '' as $$
  select p.id, r.number, r.period_start, r.period_end, r.pay_date, r.status
    from public.payslips p join public.payroll_runs r on r.id = p.payroll_run_id
   where p.id = any (app.my_visible_payslip_ids())
$$;
grant execute on function public.my_payslip_periods() to authenticated;

-- Managers decide their team's leave from their own workplace page, without HR rights
create or replace function public.my_team_leave()
returns table (id uuid, number text, status text, employee_id uuid, employee text, leave_type text, start_date date, end_date date, days numeric,
               reason text, created_at timestamptz, remaining numeric)
language sql stable security definer set search_path = '' as $$
  select r.id, r.number, r.status, e.id, e.full_name, t.name, r.start_date, r.end_date, r.days, r.reason, r.created_at,
         (select b.remaining from public.leave_balances(r.company_id, extract(year from r.start_date)::int, e.id) b where b.leave_type_id = t.id)
    from public.leave_requests r join public.employees e on e.id = r.employee_id join public.leave_types t on t.id = r.leave_type_id
   where e.manager_id = any (app.my_employee_ids()) and r.deleted_at is null
     and (r.status = 'submitted' or (r.status = 'approved' and r.end_date >= current_date))
   order by r.status = 'submitted' desc, r.start_date
$$;
grant execute on function public.my_team_leave() to authenticated;

revoke execute on function app.working_days(uuid, date, date), app.seed_holidays(uuid), app.employee_user(uuid), app.has_permission_of(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.leave_balances(uuid, int, uuid), public.submit_leave_request(uuid), public.decide_leave_request(uuid, boolean, text),
  public.cancel_leave_request(uuid), public.attendance_month(uuid, date, uuid), public.clock_attendance(uuid), public.payroll_params(text, date),
  public.payroll_income_tax(text, numeric, jsonb, boolean), public.create_payroll_run(uuid, int, int, date), public.calculate_payroll(uuid),
  public.approve_payroll(uuid), public.reopen_payroll(uuid), public.post_payroll(uuid), public.pay_payroll(uuid, uuid, date),
  public.cancel_payroll(uuid), public.payroll_register(uuid), public.hr_overview(uuid) to authenticated;
