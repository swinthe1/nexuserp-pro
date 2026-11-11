-- =============================================================================
-- DrisPRO · the employee's job with us: main job, second job or intern (11.11.2026)
--   One choice on the employee decides it everywhere: the tax on the salary (a second job pays the flat 10% in Kosovo)
--   and the PO / JO of "Punë Primare" in ATK's payroll file. Changing it changes the employee's contracts in force,
--   and a contract changed by hand moves the employee's choice with it, so the two never disagree.
-- =============================================================================
alter table public.employees add column if not exists job_status text not null default 'primary'
  check (job_status in ('primary', 'secondary', 'intern'));

-- as things stand today: an intern stays an intern; a second job where the contract in force says so
update public.employees e set job_status = 'intern' where e.employment_type = 'intern' and e.job_status = 'primary';
update public.employees e set job_status = 'secondary'
 where e.job_status = 'primary'
   and exists (select 1 from public.employment_contracts c where c.employee_id = e.id and c.deleted_at is null
                and not c.is_primary_employer and (c.end_date is null or c.end_date >= current_date));

create or replace function app.tg_employee_job_status()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
  if new.job_status is distinct from old.job_status then
    -- whether this is the person's main job is what they declare for the tax, not a term the two sides signed:
    -- it follows on a signed contract too, without an annex
    perform set_config('app.contract_system', 'on', true);
    update public.employment_contracts c set is_primary_employer = (new.job_status <> 'secondary')
     where c.employee_id = new.id and c.deleted_at is null and (c.end_date is null or c.end_date >= current_date)
       and c.is_primary_employer is distinct from (new.job_status <> 'secondary');
    perform set_config('app.contract_system', '', true);
  end if;
  return null;
end
$function$;
revoke all on function app.tg_employee_job_status() from public, anon, authenticated;
drop trigger if exists trg_80_job_status on public.employees;
create trigger trg_80_job_status after update of job_status on public.employees
  for each row execute function app.tg_employee_job_status();

create or replace function app.tg_contract_job_status()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
  if (tg_op = 'INSERT' or new.is_primary_employer is distinct from old.is_primary_employer)
     and new.deleted_at is null and (new.end_date is null or new.end_date >= current_date) then
    -- an intern stays an intern while the contract says main job; a second job always shows
    update public.employees e set job_status = case when new.is_primary_employer then 'primary' else 'secondary' end
     where e.id = new.employee_id
       and ((not new.is_primary_employer and e.job_status <> 'secondary') or (new.is_primary_employer and e.job_status = 'secondary'));
  end if;
  return null;
end
$function$;
revoke all on function app.tg_contract_job_status() from public, anon, authenticated;
drop trigger if exists trg_80_job_status on public.employment_contracts;
create trigger trg_80_job_status after insert or update of is_primary_employer on public.employment_contracts
  for each row execute function app.tg_contract_job_status();
