-- =============================================================================
-- DrisPRO · a payroll can be approved by the person who calculated it when nobody else may (audit, wave 1)
--   Two people stay the rule: while someone else in the company may approve payroll, they must.
--   An owner working alone can now finish the payroll; the payroll then says so ("approved by the
--   person who calculated it, the only one who may approve").
-- =============================================================================

alter table public.payroll_runs add column if not exists self_approved boolean not null default false;

create or replace function public.approve_payroll(p_run uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare r public.payroll_runs; v_self boolean := false;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if r.id is null then raise exception 'Payroll run not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'payroll.approve');
  if r.status <> 'calculated' then raise exception 'Calculate payroll % first (it is %)', r.number, r.status using errcode = '55000'; end if;
  if r.calculated_by = auth.uid() and not app.is_super_admin() then
    if exists (select 1 from public.company_members m
                where m.company_id = r.company_id and m.status = 'active' and m.deleted_at is null and m.user_id <> auth.uid()
                  and app.has_permission_of(m.user_id, r.company_id, 'payroll.approve')) then
      raise exception 'Someone other than the person who calculated it must approve the payroll' using errcode = '42501';
    end if;
    v_self := true;   -- nobody else may approve payroll in this company
  end if;
  if r.employee_count = 0 then raise exception 'Payroll % has no payslips', r.number using errcode = '23514'; end if;
  update public.payroll_runs set status = 'approved', approved_by = auth.uid(), approved_at = now(), self_approved = v_self where id = r.id;
  return 'approved';
end $$;

-- reopening clears the mark, so the next approval is judged again
create or replace function app.tg_payroll_self_approved_clear()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status not in ('approved', 'posted', 'paid') then new.self_approved := false; end if;
  return new;
end $$;
drop trigger if exists trg_90_self_approved on public.payroll_runs;
create trigger trg_90_self_approved before update of status on public.payroll_runs
  for each row execute function app.tg_payroll_self_approved_clear();

-- for the screen: may someone else in the company approve payroll? (only the count, for members)
create or replace function public.payroll_other_approvers(p_company uuid)
returns int language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.company_members m where m.company_id = p_company and m.user_id = auth.uid() and m.status = 'active')
     and not app.is_super_admin() then
    raise exception 'Not a member of this company' using errcode = '42501';
  end if;
  return (select count(*)::int from public.company_members m
           where m.company_id = p_company and m.status = 'active' and m.deleted_at is null and m.user_id <> auth.uid()
             and app.has_permission_of(m.user_id, p_company, 'payroll.approve'));
end $$;
revoke all on function public.payroll_other_approvers(uuid) from public, anon;
grant execute on function public.payroll_other_approvers(uuid) to authenticated;
