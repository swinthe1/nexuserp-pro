-- =============================================================================
-- DrisPRO · the end of the day at the till, and the monthly payroll prepared by itself
--   * When a till closes with cash that does not match (more than the shop's tolerance), the
--     people who approve at the till are told at once: which till, who, how much.
--   * Every morning: tills still open since yesterday are reported, so a forgotten shift is
--     closed and counted the same day.
--   * Payroll: on the day the company chooses, the month's payroll is made and calculated as a
--     draft (attendance overtime, unpaid leave, and optionally days absent without leave);
--     payroll is told to check and approve it. Nothing is approved or paid by itself.
-- =============================================================================

alter table public.company_settings
  add column pos_cash_tolerance numeric(12,2) not null default 1 check (pos_cash_tolerance >= 0),
  add column payroll_auto_day smallint check (payroll_auto_day between 1 and 28),
  add column payroll_auto_for text not null default 'previous' check (payroll_auto_for in ('previous', 'current')),
  add column payroll_deduct_absence boolean not null default false;

-- ---------------------------------------------------------------- the till
create or replace function app.tg_session_closed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_tol numeric; v_reg text; v_who text; v_cur text;
begin
  if new.status <> 'closed' or old.status = 'closed' then return null; end if;
  select coalesce(pos_cash_tolerance, 1) into v_tol from public.company_settings where company_id = new.company_id;
  if abs(coalesce(new.cash_difference, 0)) <= coalesce(v_tol, 1) then return null; end if;
  select name into v_reg from public.pos_registers where id = new.register_id;
  select coalesce(full_name, email) into v_who from public.profiles where id = new.opened_by;
  select base_currency into v_cur from public.companies where id = new.company_id;
  perform app.notify_permission(new.company_id, 'pos.approve', 'warning',
    'Cash difference at ' || coalesce(v_reg, new.number) || ': ' || to_char(new.cash_difference, 'FMS999G999G990D00') || ' ' || coalesce(v_cur, ''),
    'Shift ' || new.number || ' · ' || coalesce(v_who, '') || ' · expected ' || to_char(coalesce(new.expected_cash, 0), 'FM999G999G990D00')
      || ', counted ' || to_char(coalesce(new.closing_cash_counted, 0), 'FM999G999G990D00'),
    '/pos/sessions/' || new.id);
  return null;
end $$;
create trigger trg_90_session_closed after update of status on public.pos_sessions
  for each row execute function app.tg_session_closed();

create or replace function app.remind_open_tills()
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select s.company_id, count(*) as k, string_agg(coalesce(g.name, s.number), ', ' order by g.name) as names
             from public.pos_sessions s left join public.pos_registers g on g.id = s.register_id
            where s.status = 'open' and s.deleted_at is null and s.opened_at < now() - interval '16 hours'
            group by s.company_id loop
    perform app.notify_once(r.company_id, 'pos.approve', 'Tills still open since yesterday: ' || r.k, r.names || ' — close and count them today.', '/pos');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function app.remind_open_tills() from public, anon, authenticated;

-- ---------------------------------------------------------------- payroll
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;
-- days absent without leave: a working day with no attendance and no leave, for someone whose
-- attendance is kept (at least one record that month); only when the company asks for it
select app._patch_function('public.calculate_payroll',
  $x$v_hourly numeric; v_n int := 0; it record;$x$,
  $x$v_hourly numeric; v_n int := 0; it record; v_absent numeric; v_deduct boolean;$x$);
select app._patch_function('public.calculate_payroll',
  $x$    v_paid := greatest(v_paid - v_unpaid, 0);$x$,
  $x$    select coalesce(payroll_deduct_absence, false) into v_deduct from public.company_settings where company_id = r.company_id;
    v_absent := 0;
    if v_deduct and exists (select 1 from public.attendance_records a where a.employee_id = k.employee_id and a.work_date between r.period_start and r.period_end) then
      select count(*) into v_absent
        from generate_series(greatest(r.period_start, k.start_date, k.hire_date),
                             least(r.period_end, coalesce(k.end_date, r.period_end), coalesce(k.termination_date, r.period_end), current_date - 1), interval '1 day') g(d)
       where app.working_days(r.company_id, g.d::date, g.d::date) > 0
         and not exists (select 1 from public.attendance_records a where a.employee_id = k.employee_id and a.work_date = g.d::date)
         and not exists (select 1 from public.leave_requests lr where lr.employee_id = k.employee_id and lr.status = 'approved' and lr.deleted_at is null
                          and g.d::date between lr.start_date and lr.end_date);
      v_unpaid := v_unpaid + v_absent;
    end if;
    v_paid := greatest(v_paid - v_unpaid, 0);$x$);

drop function app._patch_function(text, text, text);

create or replace function public.run_monthly_payroll()
returns int language plpgsql security definer set search_path = '' as $$
declare c record; v_today date; v_month date; v_run uuid; n int := 0;
begin
  for c in select s.company_id, s.payroll_auto_day, s.payroll_auto_for, coalesce(co.timezone, 'Europe/Tirane') as tz
             from public.company_settings s join public.companies co on co.id = s.company_id
            where s.payroll_auto_day is not null and co.deleted_at is null and co.country_code in ('AL', 'XK') loop
    v_today := (now() at time zone c.tz)::date;
    if extract(day from v_today) <> c.payroll_auto_day then continue; end if;
    v_month := date_trunc('month', v_today)::date - case when c.payroll_auto_for = 'previous' then interval '1 month' else interval '0' end;
    if exists (select 1 from public.payroll_runs where company_id = c.company_id and deleted_at is null and status <> 'cancelled'
                and period_start <= (v_month + interval '1 month - 1 day')::date and period_end >= v_month) then continue; end if;
    if not exists (select 1 from public.employment_contracts where company_id = c.company_id and status = 'active' and deleted_at is null) then continue; end if;
    begin
      v_run := public.create_payroll_run(c.company_id, extract(year from v_month)::int, extract(month from v_month)::int, null);
      perform public.calculate_payroll(v_run);
      perform app.notify_permission(c.company_id, 'payroll.write', 'info', 'Payroll for ' || to_char(v_month, 'MM/YYYY') || ' is ready to check',
        'Made from contracts, attendance and leave. Check it, then approve and post.', '/hr/payroll/' || v_run);
      n := n + 1;
    exception when others then
      perform app.notify_permission(c.company_id, 'payroll.write', 'warning', 'The payroll for ' || to_char(v_month, 'MM/YYYY') || ' could not be prepared',
        sqlerrm, '/hr/payroll');
    end;
  end loop;
  return n;
end $$;
revoke execute on function public.run_monthly_payroll() from public, anon, authenticated;

-- the settings of these two, saved by whoever runs the till or the payroll
create or replace function public.automation_settings_save(p_company uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_patch ?| array['pos_cash_tolerance'] then perform app.require_permission(p_company, 'pos.approve'); end if;
  if p_patch ?| array['payroll_auto_day', 'payroll_auto_for', 'payroll_deduct_absence'] then perform app.require_permission(p_company, 'payroll.write'); end if;
  update public.company_settings set
    pos_cash_tolerance = coalesce((p_patch ->> 'pos_cash_tolerance')::numeric, pos_cash_tolerance),
    payroll_auto_day = case when p_patch ? 'payroll_auto_day' then nullif(p_patch ->> 'payroll_auto_day', '')::smallint else payroll_auto_day end,
    payroll_auto_for = coalesce(p_patch ->> 'payroll_auto_for', payroll_auto_for),
    payroll_deduct_absence = coalesce((p_patch ->> 'payroll_deduct_absence')::boolean, payroll_deduct_absence)
  where company_id = p_company;
end $$;
grant execute on function public.automation_settings_save(uuid, jsonb) to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('nexuserp-open-tills', '0 5 * * *', 'select app.remind_open_tills()');
    perform cron.schedule('nexuserp-payroll', '15 5 * * *', 'select public.run_monthly_payroll()');
  end if;
exception when others then
  raise notice 'pg_cron not available (%); schedule app.remind_open_tills() and public.run_monthly_payroll() daily elsewhere', sqlerrm;
end $$;
