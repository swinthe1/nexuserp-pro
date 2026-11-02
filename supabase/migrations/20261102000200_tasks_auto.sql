-- =============================================================================
-- Tasks, part 2: tasks that repeat, templates (a set of tasks with one click), tasks the
-- program makes by itself from what happens (late invoices, till differences, stock, lots,
-- contracts, tax deadlines, new contacts), reminders before the due date and a morning list.
-- Every automation is off until the company switches it on, and never makes a second task
-- while the first one for the same thing is still open.
-- =============================================================================

-- ---------------------------------------------------------------------------- repeating tasks
create table if not exists public.task_rules (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  title        text not null check (length(btrim(title)) between 1 and 200),
  description  text check (length(description) <= 8000),
  assignee_id  uuid references auth.users(id) on delete set null,
  list_id      uuid,
  priority     smallint not null default 1 check (priority between 0 and 3),
  checklist    text[] not null default '{}',
  freq         text not null check (freq in ('daily','workdays','weekly','monthly')),
  weekdays     smallint[] not null default '{}' check (weekdays <@ array[1,2,3,4,5,6,7]::smallint[]),
  month_day    smallint check (month_day between 0 and 31),   -- 0 = the last day of the month
  next_on      date not null,
  active       boolean not null default true
);
do $$ begin
  perform app.register_table('public.task_rules', 'tasks', p_policies => false);
exception when duplicate_object or duplicate_table then null; end $$;
do $$ begin
  alter table public.task_rules add constraint task_rules_list_fk foreign key (company_id, list_id) references public.task_lists(company_id, id);
exception when duplicate_object then null; end $$;

-- the day after p_day that the rule falls on
create or replace function app.rule_next(r public.task_rules, p_day date)
returns date language plpgsql immutable set search_path = '' as $$
declare d date := p_day + 1; i int;
begin
  if r.freq = 'daily' then return d; end if;
  if r.freq = 'monthly' then
    d := (date_trunc('month', p_day) + interval '1 month')::date;
    if coalesce(r.month_day, 1) = 0 then return (d + interval '1 month - 1 day')::date; end if;
    return least(d + coalesce(r.month_day, 1) - 1, (d + interval '1 month - 1 day')::date);
  end if;
  for i in 0..13 loop
    if (r.freq = 'workdays' and extract(isodow from d + i) <= 5)
       or (r.freq = 'weekly' and extract(isodow from d + i)::smallint = any (case when cardinality(r.weekdays) = 0 then array[extract(isodow from p_day)::smallint] else r.weekdays end)) then
      return d + i;
    end if;
  end loop;
  return d + 7;
end $$;

-- ---------------------------------------------------------------------------- templates
create table if not exists public.task_templates (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name       text not null check (length(btrim(name)) between 1 and 80),
  items      jsonb not null default '[]' check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 40)
  -- each item: {"title": "...", "due_in_days": 0, "assignee": "<user id>" | null, "checklist": ["..."]}
);
do $$ begin
  perform app.register_table('public.task_templates', 'tasks', p_policies => false);
exception when duplicate_object or duplicate_table then null; end $$;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' and tablename in ('task_rules','task_templates') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;
-- a repeating task: whoever made it, the person on it, and task managers
create policy task_rules_select on public.task_rules for select to authenticated
  using (deleted_at is null and company_id = any (app.my_company_ids())
         and (created_by = auth.uid() or assignee_id = auth.uid() or company_id = any (app.company_ids_with('tasks.read')) or company_id = any (app.company_ids_with('tasks.write'))));
create policy task_rules_insert on public.task_rules for insert to authenticated
  with check (company_id = any (app.my_company_ids()) and created_by = auth.uid()
              and (assignee_id is null or assignee_id = auth.uid() or company_id = any (app.company_ids_with('tasks.write')) or assignee_id = any (app.my_report_users(company_id))));
create policy task_rules_update on public.task_rules for update to authenticated
  using (created_by = auth.uid() or company_id = any (app.company_ids_with('tasks.write')))
  with check (assignee_id is null or assignee_id = auth.uid() or company_id = any (app.company_ids_with('tasks.write')) or assignee_id = any (app.my_report_users(company_id)));
create policy task_templates_select on public.task_templates for select to authenticated using (deleted_at is null and company_id = any (app.my_company_ids()));
create policy task_templates_write on public.task_templates for insert to authenticated with check (company_id = any (app.company_ids_with('tasks.write')));
create policy task_templates_update on public.task_templates for update to authenticated using (company_id = any (app.company_ids_with('tasks.write')));

-- start a template: its tasks, dated from p_start, on one list and one document if given
create or replace function public.task_apply_template(p_template uuid, p_start date default current_date, p_assignee uuid default null,
                                                     p_list uuid default null, p_entity_type text default null, p_entity_id uuid default null, p_entity_label text default null)
returns int language plpgsql security definer set search_path = '' as $$
declare tp public.task_templates; it jsonb; v_id uuid; v_who uuid; n int := 0; c text;
begin
  select * into tp from public.task_templates where id = p_template and deleted_at is null;
  if tp.id is null then raise exception 'Template not found' using errcode = 'P0002'; end if;
  perform app.require_permission(tp.company_id, 'tasks.write');
  for it in select * from jsonb_array_elements(tp.items) loop
    v_who := coalesce(nullif(it ->> 'assignee', '')::uuid, p_assignee);
    if v_who is not null and not app.is_active_member(tp.company_id, v_who) then v_who := p_assignee; end if;
    insert into public.tasks (company_id, title, description, assignee_id, due_date, list_id, entity_type, entity_id, entity_label, source, created_by)
    values (tp.company_id, it ->> 'title', nullif(it ->> 'description', ''), v_who, p_start + coalesce((it ->> 'due_in_days')::int, 0),
            p_list, p_entity_type, p_entity_id, p_entity_label, 'template', auth.uid())
    returning id into v_id;
    for c in select jsonb_array_elements_text(coalesce(it -> 'checklist', '[]')) loop
      insert into public.task_checklist (company_id, task_id, title) values (tp.company_id, v_id, c);
    end loop;
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------- automations
alter table public.company_settings
  add column if not exists task_automations jsonb not null default '{}',
  add column if not exists task_digest_email boolean not null default false;

-- the first active person with one of these roles (who gets a task meant for "the sales manager")
create or replace function app.first_with_role(p_company uuid, p_roles text[])
returns uuid language sql stable security definer set search_path = '' as $$
  select m.user_id from public.company_members m join public.member_roles mr on mr.member_id = m.id join public.roles r on r.id = mr.role_id
   where m.company_id = p_company and m.status = 'active' and m.deleted_at is null and m.user_id is not null and r.key = any (p_roles)
   order by array_position(p_roles, r.key), m.joined_at nulls last, m.created_at
   limit 1
$$;

-- one task for one thing: nothing new while the last one for the same key is still open
create or replace function app.auto_task(p_company uuid, p_key text, p_title text, p_assignee uuid, p_due date, p_priority smallint,
                                         p_entity text, p_entity_id uuid, p_label text, p_description text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.tasks t where t.company_id = p_company and t.auto_key = p_key and t.deleted_at is null) then return false; end if;
  insert into public.tasks (company_id, title, description, assignee_id, due_date, priority, entity_type, entity_id, entity_label, source, auto_key)
  values (p_company, left(p_title, 200), p_description, p_assignee, p_due, p_priority, p_entity, p_entity_id, left(p_label, 120), 'auto', p_key);
  return true;
end $$;

create or replace function app.auto_on(s jsonb, p_key text) returns boolean language sql immutable set search_path = '' as $$
  select coalesce((s -> p_key ->> 'on')::boolean, false)
$$;
create or replace function app.auto_days(s jsonb, p_key text, p_default int) returns int language sql immutable set search_path = '' as $$
  select greatest(0, least(365, coalesce((s -> p_key ->> 'days')::int, p_default)))
$$;

create or replace function app.tasks_run(p_company uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare s jsonb; c public.companies; v_today date; r record; n int := 0; d int; v_who uuid; ru public.task_rules; v_id uuid; x text;
begin
  select * into c from public.companies where id = p_company;
  v_today := (now() at time zone coalesce(c.timezone, 'Europe/Tirane'))::date;
  select coalesce(task_automations, '{}') into s from public.company_settings where company_id = p_company;

  -- repeating tasks that fall on today or were missed
  for ru in select * from public.task_rules where company_id = p_company and active and deleted_at is null and next_on <= v_today for update loop
    if not exists (select 1 from public.tasks t where t.company_id = p_company and t.auto_key = 'rule:' || ru.id || ':' || ru.next_on) then
      insert into public.tasks (company_id, title, description, assignee_id, list_id, priority, due_date, source, rule_id, auto_key, created_by)
      values (p_company, ru.title, ru.description, ru.assignee_id, ru.list_id, ru.priority, ru.next_on, 'recurring', ru.id, 'rule:' || ru.id || ':' || ru.next_on, ru.created_by)
      returning id into v_id;
      foreach x in array ru.checklist loop insert into public.task_checklist (company_id, task_id, title) values (p_company, v_id, x); end loop;
      n := n + 1;
    end if;
    update public.task_rules set next_on = case when app.rule_next(ru, ru.next_on) > v_today then app.rule_next(ru, ru.next_on) else app.rule_next(ru, v_today) end where id = ru.id;
  end loop;

  -- invoices late by N days: whoever sells to that customer calls them
  if app.auto_on(s, 'late_invoice') then
    d := app.auto_days(s, 'late_invoice', 15);
    for r in select i.id, i.number, i.due_date, p.name, coalesce(i.salesperson_id, p.salesperson_id) as who
               from public.sales_invoices i join public.business_partners p on p.id = i.partner_id
              where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and i.payment_status <> 'paid' and i.amount_due > 0
                and i.due_date <= v_today - d loop
      v_who := coalesce(r.who, app.first_with_role(p_company, array['sales_manager','finance_manager','company_admin']));
      if app.auto_task(p_company, 'late_invoice:' || r.id, 'Telefono ' || r.name || ' për faturën ' || r.number, v_who, v_today + 2, 2::smallint,
                       'sales_invoices', r.id, r.number) then n := n + 1; end if;
    end loop;
  end if;

  -- a till that closed with a difference over the limit: the cashier explains it
  if app.auto_on(s, 'cash_diff') then
    d := app.auto_days(s, 'cash_diff', 5);
    for r in select ps.id, ps.number, ps.opened_by, ps.cash_difference from public.pos_sessions ps
              where ps.company_id = p_company and ps.status = 'closed' and ps.closed_at >= now() - interval '2 days' and abs(coalesce(ps.cash_difference, 0)) > d loop
      if app.auto_task(p_company, 'cash_diff:' || r.id, 'Shpjego diferencën e arkës në turnin ' || r.number, coalesce(r.opened_by, app.first_with_role(p_company, array['store_manager','company_admin'])),
                       v_today + 1, 2::smallint, 'pos_sessions', r.id, r.number) then n := n + 1; end if;
    end loop;
  end if;

  -- goods under the minimum: buying orders them
  if app.auto_on(s, 'low_stock') then
    for r in select a.id, v.sku, v.name from public.stock_alerts a join public.product_variants v on v.id = a.variant_id
              where a.company_id = p_company and a.status in ('open','acknowledged') and a.resolved_at is null loop
      if app.auto_task(p_company, 'low_stock:' || r.id, 'Porosit ' || r.name, app.first_with_role(p_company, array['procurement_manager','inventory_manager','store_manager','company_admin']),
                       v_today + 1, 1::smallint, 'product_variants', null, r.sku) then n := n + 1; end if;
    end loop;
  end if;

  -- lots about to expire with stock on hand
  if app.auto_on(s, 'lot_expiry') then
    d := app.auto_days(s, 'lot_expiry', 14);
    for r in select lt.id, lt.lot_number, lt.expiry_date, v.name from public.lots lt join public.product_variants v on v.id = lt.variant_id
              where lt.company_id = p_company and lt.deleted_at is null and lt.expiry_date between v_today and v_today + d
                and exists (select 1 from public.stock_levels sl where sl.lot_id = lt.id and sl.on_hand > 0) loop
      if app.auto_task(p_company, 'lot_expiry:' || r.id, 'Ul çmimin ose hiqe nga rafti: ' || r.name || ' (loti ' || r.lot_number || ')',
                       app.first_with_role(p_company, array['inventory_manager','warehouse_operator','store_manager','company_admin']),
                       greatest(v_today, r.expiry_date - 3), 1::smallint, 'lots', r.id, r.lot_number) then n := n + 1; end if;
    end loop;
  end if;

  -- fixed-term contracts that end soon
  if app.auto_on(s, 'contract_end') then
    d := app.auto_days(s, 'contract_end', 30);
    for r in select ct.id, ct.number, ct.end_date, e.full_name from public.employment_contracts ct join public.employees e on e.id = ct.employee_id
              where ct.company_id = p_company and ct.status = 'active' and ct.deleted_at is null and ct.end_date between v_today and v_today + d loop
      if app.auto_task(p_company, 'contract_end:' || r.id, 'Zgjat ose mbyll kontratën e ' || r.full_name, app.first_with_role(p_company, array['hr_manager','company_admin']),
                       r.end_date - 7, 2::smallint, 'employment_contracts', r.id, r.number) then n := n + 1; end if;
    end loop;
  end if;

  -- VAT and payroll returns due within N days
  if app.auto_on(s, 'tax_deadline') then
    d := app.auto_days(s, 'tax_deadline', 5);
    for r in select * from public.tax_calendar_internal(p_company) t where t.status in ('open','draft','overdue') and t.due_date <= v_today + d loop
      if app.auto_task(p_company, 'tax:' || r.obligation || ':' || r.period_start,
                       case when r.obligation = 'vat' then 'Përgatit deklaratën e TVSH-së për ' else 'Përgatit deklaratën e pagave për ' end || to_char(r.period_start, 'MM/YYYY'),
                       app.first_with_role(p_company, case when r.obligation = 'vat' then array['accountant','finance_manager','company_admin'] else array['hr_manager','accountant','company_admin'] end),
                       r.due_date, 3::smallint, null, null, null) then n := n + 1; end if;
    end loop;
  end if;

  -- new contacts nobody has picked up within a day
  if app.auto_on(s, 'new_lead') then
    for r in select l.id, coalesce(nullif(btrim(l.company_name), ''), nullif(btrim(l.contact_name), ''), l.title) as name, l.owner_id from public.leads l
              where l.company_id = p_company and l.deleted_at is null and l.status = 'new' and l.created_at between now() - interval '7 days' and now() - interval '1 day' loop
      if app.auto_task(p_company, 'new_lead:' || r.id, 'Kontakto ' || r.name, coalesce(r.owner_id, app.first_with_role(p_company, array['sales_manager','sales_rep','company_admin'])),
                       v_today, 2::smallint, 'leads', r.id, r.name) then n := n + 1; end if;
    end loop;
  end if;
  return n;
end $$;

-- reminders: the day before and on the day, in the app and on the phone (one of each per day)
create or replace function app.tasks_remind(p_company uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare c public.companies; v_today date; n int;
begin
  select * into c from public.companies where id = p_company;
  v_today := (now() at time zone coalesce(c.timezone, 'Europe/Tirane'))::date;
  insert into public.notifications (company_id, user_id, type, title, body, link, entity_type, entity_id)
  select t.company_id, t.assignee_id, 'alert',
         case when t.due_date = v_today then 'Due today: ' else 'Due tomorrow: ' end || t.title, t.number, '/tasks?id=' || t.id, 'tasks', t.id
    from public.tasks t
   where t.company_id = p_company and t.deleted_at is null and t.status not in ('done','cancelled') and t.assignee_id is not null
     and t.due_date in (v_today, v_today + 1) and app.is_active_member(t.company_id, t.assignee_id)
     and not exists (select 1 from public.notifications x where x.user_id = t.assignee_id and x.entity_id = t.id and x.type = 'alert' and x.created_at >= date_trunc('day', now()));
  get diagnostics n = row_count;
  return n;
end $$;

-- the morning list by email: each person their own tasks for today and the late ones
create or replace function app.tasks_digest(p_company uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare c public.companies; v_today date; r record; n int := 0; v_list text; v_html text;
begin
  if not coalesce((select task_digest_email from public.company_settings where company_id = p_company), false) then return 0; end if;
  select * into c from public.companies where id = p_company;
  v_today := (now() at time zone coalesce(c.timezone, 'Europe/Tirane'))::date;
  for r in select t.assignee_id, p.email, coalesce(nullif(p.full_name, ''), p.email) as name,
                  count(*) filter (where t.due_date < v_today) as late, count(*) filter (where t.due_date = v_today) as today,
                  string_agg(t.number || ' · ' || t.title || case when t.due_date < v_today then ' (vonuar që më ' || to_char(t.due_date, 'DD.MM') || ')' else '' end, E'\n' order by t.due_date, t.priority desc) as lines
             from public.tasks t join public.profiles p on p.id = t.assignee_id
            where t.company_id = p_company and t.deleted_at is null and t.status not in ('done','cancelled') and t.due_date <= v_today and not t.is_private
              and app.is_active_member(p_company, t.assignee_id) and coalesce(p.email, '') <> ''
            group by t.assignee_id, p.email, p.full_name loop
    v_list := r.lines;
    v_html := '<p>Mirëmëngjes, ' || replace(replace(r.name, '<', '&lt;'), '>', '&gt;') || '.</p><p>Detyrat tuaja për sot në ' || replace(c.name, '<', '&lt;') || ':</p><pre style="font-family:inherit">'
              || replace(replace(v_list, '<', '&lt;'), '>', '&gt;') || '</pre>';
    if app.enqueue_message(p_company, 'email', r.email,
         format('Detyrat e sotme: %s sot, %s të vonuara', r.today, r.late), v_list, v_html, 'tasks',
         null, 'tasks:' || r.assignee_id || ':' || v_today) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;

create or replace function app.tasks_hourly()
returns int language plpgsql security definer set search_path = '' as $$
declare co record; n int := 0; v_hour int;
begin
  for co in select id, timezone from public.companies where is_active and deleted_at is null loop
    begin
      n := n + app.tasks_run(co.id);
      v_hour := extract(hour from now() at time zone coalesce(co.timezone, 'Europe/Tirane'));
      if v_hour = 7 then n := n + app.tasks_remind(co.id) + app.tasks_digest(co.id); end if;
    exception when others then
      raise warning 'tasks for %: %', co.id, sqlerrm;
    end;
  end loop;
  return n;
end $$;
revoke execute on function app.tasks_run(uuid), app.tasks_remind(uuid), app.tasks_digest(uuid), app.tasks_hourly() from public, anon, authenticated;

-- run the automations now (from the settings page, to see what they make)
create or replace function public.tasks_run_now(p_company uuid)
returns int language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'admin.write');
  return app.tasks_run(p_company);
end $$;
revoke execute on function public.tasks_run_now(uuid), public.task_apply_template(uuid, date, uuid, uuid, text, uuid, text) from public, anon;
grant execute on function public.tasks_run_now(uuid), public.task_apply_template(uuid, date, uuid, uuid, text, uuid, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('drispro-tasks', '20 * * * *', 'select app.tasks_hourly()');
  end if;
exception when others then
  raise notice 'pg_cron not available (%); schedule app.tasks_hourly() externally', sqlerrm;
end $$;
