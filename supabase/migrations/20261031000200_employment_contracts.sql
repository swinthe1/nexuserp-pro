-- =============================================================================
-- Employment contracts as real documents: a number, the written text from a model, signing,
-- annexes (a raise, a new position, an extension), ending with notice, the signed copy,
-- and models a company can edit. Payroll keeps working the same way: one active contract
-- per person, a contract that changes mid-month pays its own days.
-- =============================================================================

-- 1. the contract's own terms and its life
alter table public.employment_contracts
  add column if not exists number            text,
  add column if not exists kind              text not null default 'contract' check (kind in ('contract','annex')),
  add column if not exists parent_id         uuid,
  add column if not exists template_key      text,
  add column if not exists job_title         text,
  add column if not exists job_description   text,
  add column if not exists workplace         text,
  add column if not exists work_schedule     text,
  add column if not exists probation_months  smallint not null default 0 check (probation_months between 0 and 6),
  add column if not exists notice_days       smallint check (notice_days between 0 and 365),
  add column if not exists annual_leave_days smallint check (annual_leave_days between 0 and 60),
  add column if not exists pay_day           smallint check (pay_day between 1 and 31),
  add column if not exists employer_signatory text,
  add column if not exists body              text,
  add column if not exists signed_on         date,
  add column if not exists signed_file       text,
  add column if not exists signed_file_name  text,
  add column if not exists ended_reason      text check (ended_reason in ('expired','resigned','dismissed','mutual','probation','retired','changed','replaced','other')),
  add column if not exists ended_note        text,
  add column if not exists notice_given_on   date;

do $$ begin
  alter table public.employment_contracts add constraint employment_contracts_parent_fk
    foreign key (company_id, parent_id) references public.employment_contracts(company_id, id);
exception when duplicate_object then null; end $$;
create index if not exists employment_contracts_parent_idx on public.employment_contracts (parent_id) where parent_id is not null;
create index if not exists employment_contracts_employee_idx on public.employment_contracts (employee_id, start_date desc) where deleted_at is null;

-- 2. a number for every contract (KP-2026-00001); the ones that exist get theirs first, oldest first
insert into public.document_types (key, name, module, table_name, default_prefix)
values ('employment_contract', 'Employment contract', 'payroll', 'employment_contracts', 'KP-')
on conflict (key) do nothing;

do $$
declare r record;
begin
  for r in select id, company_id, start_date from public.employment_contracts where number is null order by company_id, start_date, created_at loop
    update public.employment_contracts set number = app.next_document_number(r.company_id, 'employment_contract', r.start_date) where id = r.id;
  end loop;
end $$;
drop trigger if exists trg_10_number on public.employment_contracts;
create trigger trg_10_number before insert or update of number on public.employment_contracts
  for each row execute function app.tg_assign_number('employment_contract', 'start_date');
create unique index if not exists employment_contracts_number_key on public.employment_contracts (company_id, number) where deleted_at is null;

-- 3. a signed contract does not change: a raise, a new position or a longer term is an annex.
--    Its end (date and reason) and the signed copy can still be recorded.
create or replace function app.tg_contract_frozen()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.signed_on is null or coalesce(current_setting('app.contract_system', true), '') = 'on' then return new; end if;
  if (new.employee_id, new.contract_type, new.start_date, new.gross_salary, new.currency_code, new.working_hours_per_week, new.pay_frequency,
      new.is_primary_employer, new.kind, new.parent_id, new.job_title, new.job_description, new.workplace, new.work_schedule,
      new.probation_months, new.notice_days, new.annual_leave_days, new.pay_day, new.employer_signatory, new.signed_on)
     is distinct from
     (old.employee_id, old.contract_type, old.start_date, old.gross_salary, old.currency_code, old.working_hours_per_week, old.pay_frequency,
      old.is_primary_employer, old.kind, old.parent_id, old.job_title, old.job_description, old.workplace, old.work_schedule,
      old.probation_months, old.notice_days, old.annual_leave_days, old.pay_day, old.employer_signatory, old.signed_on)
     or (old.body is not null and new.body is distinct from old.body) then
    raise exception 'A signed contract does not change; make an annex' using errcode = '55000';
  end if;
  if new.deleted_at is not null and old.deleted_at is null then
    raise exception 'A signed contract cannot be deleted' using errcode = '55000';
  end if;
  return new;
end $$;
drop trigger if exists trg_40_contract_frozen on public.employment_contracts;
create trigger trg_40_contract_frozen before update on public.employment_contracts
  for each row execute function app.tg_contract_frozen();

-- 4. models: the company's own wording (the program carries a model for each country)
create table if not exists public.contract_templates (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  name          text not null check (length(btrim(name)) between 1 and 120),
  kind          text not null default 'contract' check (kind in ('contract','annex','notice')),
  contract_type text check (contract_type in ('indefinite','fixed_term','seasonal','service')),
  body          text not null check (length(body) between 1 and 60000),
  is_default    boolean not null default false
);
do $$ begin
  perform app.register_table('public.contract_templates', 'payroll', 'payroll');
exception when duplicate_object or duplicate_table then null; end $$;
create unique index if not exists contract_templates_default on public.contract_templates (company_id, kind, coalesce(contract_type, ''))
  where is_default and deleted_at is null;

-- 5. who signs for the employer and where (printed under the contract)
alter table public.company_settings
  add column if not exists contract_signatory       text,
  add column if not exists contract_signatory_title text,
  add column if not exists contract_place           text;

-- 6. people see their own contracts (once signed or in force) under "My workplace"
drop policy if exists employment_contracts_self_select on public.employment_contracts;
create policy employment_contracts_self_select on public.employment_contracts for select to authenticated
  using (employee_id = any ((select app.my_employee_ids())::uuid[]) and status <> 'draft' and deleted_at is null);

-- 7. the signed copies: a private folder per company, only payroll people (and the person themself) read it
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  insert into storage.buckets (id, name, public) values ('hr-files', 'hr-files', false) on conflict (id) do nothing;
  execute 'drop policy if exists "hr files: read" on storage.objects';
  execute 'drop policy if exists "hr files: upload" on storage.objects';
  execute 'drop policy if exists "hr files: remove" on storage.objects';
  execute $p$create policy "hr files: read" on storage.objects for select to authenticated
    using (bucket_id = 'hr-files' and ((storage.foldername(name))[1] = any ((select app.company_ids_with('payroll.read'))::text[])
           or ((storage.foldername(name))[1] = any ((select app.my_company_ids())::text[])
               and (storage.foldername(name))[2] = any ((select app.my_employee_ids())::text[]))))$p$;
  execute $p$create policy "hr files: upload" on storage.objects for insert to authenticated
    with check (bucket_id = 'hr-files' and (storage.foldername(name))[1] = any ((select app.company_ids_with('payroll.write'))::text[]))$p$;
  execute $p$create policy "hr files: remove" on storage.objects for delete to authenticated
    using (bucket_id = 'hr-files' and (storage.foldername(name))[1] = any ((select app.company_ids_with('payroll.write'))::text[]))$p$;
end $$;

-- 8. signing: the draft comes into force; a contract it replaces ends the day before
create or replace function public.contract_sign(p_id uuid, p_signed_on date default current_date)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.employment_contracts; o public.employment_contracts;
begin
  select * into c from public.employment_contracts where id = p_id and deleted_at is null for update;
  if c.id is null then raise exception 'Contract not found' using errcode = 'P0002'; end if;
  perform app.require_permission(c.company_id, 'payroll.write');
  if c.signed_on is not null then raise exception 'This contract is already signed' using errcode = '55000'; end if;
  if c.status = 'ended' then raise exception 'This contract has ended' using errcode = '55000'; end if;
  if p_signed_on is null or p_signed_on > current_date then raise exception 'The signing date cannot be in the future' using errcode = '22023'; end if;
  if c.gross_salary <= 0 and c.contract_type <> 'service' then raise exception 'Enter the gross pay first' using errcode = '22023'; end if;

  perform set_config('app.contract_system', 'on', true);
  -- the contract in force before this one ends the day before this one starts
  for o in select * from public.employment_contracts
            where employee_id = c.employee_id and id <> c.id and status = 'active' and deleted_at is null for update loop
    if o.start_date >= c.start_date then
      raise exception 'Contract % starts on % or later; end it first', o.number, to_char(c.start_date, 'DD.MM.YYYY') using errcode = '55000';
    end if;
    update public.employment_contracts
       set status = 'ended', end_date = least(coalesce(o.end_date, c.start_date - 1), c.start_date - 1),
           ended_reason = case when o.id = c.parent_id then 'changed' else 'replaced' end
     where id = o.id;
  end loop;
  update public.employment_contracts set signed_on = p_signed_on, status = 'active' where id = c.id;
  -- someone who had left and comes back
  update public.employees set termination_date = null, employment_status = 'active'
   where id = c.employee_id and termination_date is not null and termination_date < c.start_date;
  perform set_config('app.contract_system', 'off', true);
end $$;

-- 9. an annex: what changes and from when; it is a draft until signed
create or replace function public.contract_annex(p_id uuid, p_from date, p_terms jsonb, p_body text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.employment_contracts; v_id uuid; k text;
begin
  select * into c from public.employment_contracts where id = p_id and deleted_at is null;
  if c.id is null then raise exception 'Contract not found' using errcode = 'P0002'; end if;
  perform app.require_permission(c.company_id, 'payroll.write');
  if c.status <> 'active' then raise exception 'Only a contract in force gets an annex' using errcode = '55000'; end if;
  if p_from is null or p_from <= c.start_date then raise exception 'The annex starts after the contract' using errcode = '22023'; end if;
  if c.end_date is not null and p_from > c.end_date + 1 then raise exception 'The contract ended before %', to_char(p_from, 'DD.MM.YYYY') using errcode = '22023'; end if;
  for k in select jsonb_object_keys(coalesce(p_terms, '{}')) loop
    if k not in ('gross_salary','working_hours_per_week','job_title','job_description','workplace','work_schedule','end_date','contract_type',
                 'annual_leave_days','notice_days','pay_day','is_primary_employer') then
      raise exception 'An annex cannot change %', k using errcode = '22023';
    end if;
  end loop;
  if exists (select 1 from public.employment_contracts where parent_id = c.id and status = 'draft' and deleted_at is null) then
    raise exception 'This contract already has an annex waiting to be signed' using errcode = '55000';
  end if;

  insert into public.employment_contracts (company_id, employee_id, kind, parent_id, contract_type, start_date, end_date, gross_salary, currency_code,
         working_hours_per_week, pay_frequency, is_primary_employer, status, job_title, job_description, workplace, work_schedule,
         probation_months, notice_days, annual_leave_days, pay_day, employer_signatory, body, notes)
  values (c.company_id, c.employee_id, 'annex', c.id,
          coalesce(p_terms ->> 'contract_type', c.contract_type), p_from,
          case when p_terms ? 'end_date' then nullif(p_terms ->> 'end_date', '')::date else c.end_date end,
          coalesce((p_terms ->> 'gross_salary')::numeric, c.gross_salary), c.currency_code,
          coalesce((p_terms ->> 'working_hours_per_week')::numeric, c.working_hours_per_week), c.pay_frequency,
          coalesce((p_terms ->> 'is_primary_employer')::boolean, c.is_primary_employer), 'draft',
          coalesce(p_terms ->> 'job_title', c.job_title), coalesce(p_terms ->> 'job_description', c.job_description),
          coalesce(p_terms ->> 'workplace', c.workplace), coalesce(p_terms ->> 'work_schedule', c.work_schedule),
          0, coalesce((p_terms ->> 'notice_days')::smallint, c.notice_days),
          coalesce((p_terms ->> 'annual_leave_days')::smallint, c.annual_leave_days), coalesce((p_terms ->> 'pay_day')::smallint, c.pay_day),
          c.employer_signatory, nullif(btrim(coalesce(p_body, '')), ''), null)
  returning id into v_id;
  return v_id;
end $$;

-- 10. ending: the last day, why, and when notice was given; the person leaves on that day
create or replace function public.contract_end(p_id uuid, p_last_day date, p_reason text, p_notice_given_on date default null,
                                               p_note text default null, p_end_employment boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.employment_contracts;
begin
  select * into c from public.employment_contracts where id = p_id and deleted_at is null for update;
  if c.id is null then raise exception 'Contract not found' using errcode = 'P0002'; end if;
  perform app.require_permission(c.company_id, 'payroll.write');
  if c.status <> 'active' then raise exception 'Only a contract in force can be ended' using errcode = '55000'; end if;
  if p_reason is null or p_reason not in ('expired','resigned','dismissed','mutual','probation','retired','other') then
    raise exception 'Choose why the contract ends' using errcode = '22023';
  end if;
  if p_last_day is null or p_last_day < c.start_date then raise exception 'The last day cannot be before the contract starts' using errcode = '22023'; end if;
  if p_notice_given_on is not null and p_notice_given_on > p_last_day then raise exception 'Notice is given before the last day' using errcode = '22023'; end if;
  if exists (select 1 from public.payslips ps join public.payroll_runs r on r.id = ps.payroll_run_id
              where ps.employee_id = c.employee_id and r.status in ('posted','paid') and r.period_start > p_last_day and r.deleted_at is null) then
    raise exception 'Salary after % has already been posted', to_char(p_last_day, 'DD.MM.YYYY') using errcode = '55000';
  end if;

  perform set_config('app.contract_system', 'on', true);
  update public.employment_contracts
     set status = 'ended', end_date = p_last_day, ended_reason = p_reason, notice_given_on = p_notice_given_on,
         ended_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = c.id;
  -- a draft annex of this contract has nothing left to change
  update public.employment_contracts set deleted_at = now() where parent_id = c.id and status = 'draft' and deleted_at is null;
  if p_end_employment then
    update public.employees set termination_date = p_last_day,
           employment_status = case when p_last_day < current_date then 'terminated' else employment_status end
     where id = c.employee_id;
  end if;
  perform set_config('app.contract_system', 'off', true);
end $$;

-- 11. every morning: people whose last day has passed have left; reminders for probation ending
--     and for fixed-term contracts that ran out while the person is still marked as working
create or replace function app.contracts_daily()
returns int language plpgsql security definer set search_path = '' as $$
declare k record; v_n int := 0;
begin
  update public.employees set employment_status = 'terminated'
   where termination_date < current_date and employment_status <> 'terminated' and deleted_at is null;

  for k in select ct.id, ct.company_id, e.full_name, (ct.start_date + make_interval(months => ct.probation_months))::date - 1 as until
             from public.employment_contracts ct join public.employees e on e.id = ct.employee_id
            where ct.status = 'active' and ct.deleted_at is null and ct.kind = 'contract' and ct.probation_months > 0
              and (ct.start_date + make_interval(months => ct.probation_months))::date - 1 = current_date + 7 loop
    v_n := v_n + app.remind(k.company_id, array['hr_manager','company_admin'], 'Probation of ' || k.full_name || ' ends ' || to_char(k.until, 'DD.MM.YYYY'),
                            null, '/hr/contracts/' || k.id, 'employment_contracts', k.id);
  end loop;

  for k in select ct.id, ct.company_id, e.full_name, ct.end_date
             from public.employment_contracts ct join public.employees e on e.id = ct.employee_id
            where ct.status = 'active' and ct.deleted_at is null and ct.end_date = current_date - 1
              and e.employment_status <> 'terminated' and e.termination_date is null loop
    v_n := v_n + app.remind(k.company_id, array['hr_manager','company_admin'], 'Contract of ' || k.full_name || ' ended ' || to_char(k.end_date, 'DD.MM.YYYY') || ': extend it or close it',
                            null, '/hr/contracts/' || k.id, 'employment_contracts', k.id);
  end loop;
  return v_n;
end $$;
revoke execute on function app.contracts_daily() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('drispro-contracts', '10 6 * * *', 'select app.contracts_daily()');
  end if;
exception when others then
  raise notice 'pg_cron not available (%); schedule app.contracts_daily() externally', sqlerrm;
end $$;

-- the "contract ends soon" reminder opens the contract itself
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
  perform app._patch_function('public.run_daily_reminders',
    $o$null, '/hr/employees/' || k.id, 'employees', k.id);$o$,
    $n$null, '/hr/contracts/' || k.contract_id, 'employment_contracts', k.contract_id);$n$);
  perform app._patch_function('public.run_daily_reminders',
    $o$for k in select e.full_name, e.id, ct.end_date from public.employment_contracts ct$o$,
    $n$for k in select e.full_name, e.id, ct.end_date, ct.id as contract_id from public.employment_contracts ct$n$);
end $$;
drop function app._patch_function(text, text, text);

revoke execute on function public.contract_sign(uuid, date), public.contract_annex(uuid, date, jsonb, text),
  public.contract_end(uuid, date, text, date, text, boolean) from public, anon;
grant execute on function public.contract_sign(uuid, date), public.contract_annex(uuid, date, jsonb, text),
  public.contract_end(uuid, date, text, date, text, boolean) to authenticated;
