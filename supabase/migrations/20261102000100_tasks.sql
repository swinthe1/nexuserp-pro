-- =============================================================================
-- Tasks: every job to do has one person responsible, a due date and, when it comes from
-- the program, a link to the document behind it. Lists and projects group them.
-- Everyone can keep their own tasks; giving tasks to others needs tasks.write (managers),
-- seeing all of a company's tasks needs tasks.read. A manager also sees the tasks of the
-- people under them (the manager chain on the employee cards).
-- =============================================================================

insert into public.document_types (key, name, module, table_name, default_prefix)
values ('task', 'Task', 'tasks', 'tasks', 'DET-') on conflict (key) do nothing;

insert into public.permissions (key, module, action, description) values
  ('tasks.read',  'tasks', 'read',  'See every task in the company'),
  ('tasks.write', 'tasks', 'write', 'Give tasks to other people and manage shared lists')
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission)
select r.id, 'tasks.write' from public.roles r
 where r.key in ('finance_manager','hr_manager','inventory_manager','logistics_manager','procurement_manager','production_manager','sales_manager','store_manager')
on conflict do nothing;

-- ---------------------------------------------------------------------------- tables
create table if not exists public.task_lists (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name       text not null check (length(btrim(name)) between 1 and 80),
  color      text not null default 'green' check (color in ('green','blue','violet','orange','pink','teal','gray')),
  kind       text not null default 'list' check (kind in ('list','project')),
  start_date date,
  end_date   date,
  is_private boolean not null default false,
  archived_at timestamptz,
  check (end_date is null or start_date is null or end_date >= start_date)
);
create table if not exists public.task_list_members (
  company_id uuid not null references public.companies(id),
  list_id    uuid not null references public.task_lists(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  primary key (list_id, user_id)
);
create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  number       text,
  title        text not null check (length(btrim(title)) between 1 and 200),
  description  text check (length(description) <= 8000),
  status       text not null default 'todo' check (status in ('todo','doing','waiting','done','cancelled')),
  priority     smallint not null default 1 check (priority between 0 and 3),
  assignee_id  uuid references auth.users(id) on delete set null,
  due_date     date,
  due_time     time,
  list_id      uuid,
  parent_id    uuid,
  warehouse_id uuid,
  entity_type  text check (entity_type ~ '^[a-z_]{2,40}$'),
  entity_id    uuid,
  entity_label text check (length(entity_label) <= 120),
  tags         text[] not null default '{}',
  is_private   boolean not null default false,
  source       text not null default 'manual' check (source in ('manual','auto','recurring','template','assistant')),
  auto_key     text,
  rule_id      uuid,
  completed_at timestamptz,
  completed_by uuid,
  sort_order   double precision not null default 0,
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id),
  check (due_time is null or due_date is not null),
  check (entity_id is null or entity_type is not null)
);
create table if not exists public.task_watchers (
  company_id uuid not null references public.companies(id),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  primary key (task_id, user_id)
);
create table if not exists public.task_checklist (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  title      text not null check (length(btrim(title)) between 1 and 200),
  done_at    timestamptz,
  done_by    uuid,
  sort_order double precision not null default 0
);
create table if not exists public.task_comments (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  kind       text not null default 'comment' check (kind in ('comment','event')),
  body       text check (length(body) <= 4000),
  files      jsonb not null default '[]' check (jsonb_typeof(files) = 'array' and jsonb_array_length(files) <= 10),
  event      jsonb,
  check (kind = 'event' or btrim(coalesce(body, '')) <> '' or jsonb_array_length(files) > 0)
);

do $$ begin
  perform app.register_table('public.task_lists', 'tasks', p_policies => false);
  perform app.register_table('public.tasks', 'tasks', p_policies => false);
  perform app.register_table('public.task_checklist', 'tasks', p_soft_delete => false, p_audit => false, p_policies => false);
  perform app.register_table('public.task_comments', 'tasks', p_policies => false, p_audit => false);
exception when duplicate_object or duplicate_table then null; end $$;
do $$ begin
  alter table public.tasks add constraint tasks_private_own check (not is_private or assignee_id is null or assignee_id = created_by);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tasks add constraint tasks_list_fk foreign key (company_id, list_id) references public.task_lists(company_id, id);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.tasks add constraint tasks_parent_fk foreign key (company_id, parent_id) references public.tasks(company_id, id);
exception when duplicate_object then null; end $$;
alter table public.task_list_members enable row level security;
alter table public.task_watchers enable row level security;
revoke all on public.task_list_members, public.task_watchers from anon;
grant select, insert, delete on public.task_list_members, public.task_watchers to authenticated;

drop trigger if exists trg_10_number on public.tasks;
create trigger trg_10_number before insert or update of number on public.tasks
  for each row execute function app.tg_assign_number('task', 'created_at');
create unique index if not exists tasks_number_key on public.tasks (company_id, number) where deleted_at is null;
create index if not exists tasks_assignee_idx on public.tasks (company_id, assignee_id, status) where deleted_at is null;
create index if not exists tasks_due_idx on public.tasks (company_id, due_date) where deleted_at is null and status not in ('done','cancelled');
create index if not exists tasks_entity_idx on public.tasks (company_id, entity_type, entity_id) where entity_id is not null;
create index if not exists tasks_list_idx on public.tasks (list_id) where list_id is not null;
create index if not exists tasks_parent_idx on public.tasks (parent_id) where parent_id is not null;
create unique index if not exists tasks_auto_open on public.tasks (company_id, auto_key) where auto_key is not null and deleted_at is null and status not in ('done','cancelled');
create index if not exists task_comments_task_idx on public.task_comments (task_id, created_at);
create index if not exists task_checklist_task_idx on public.task_checklist (task_id, sort_order);

-- ---------------------------------------------------------------------------- who sees what
create or replace function app.is_active_member(p_company uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.company_members m where m.company_id = p_company and m.user_id = p_user
                   and m.status = 'active' and m.deleted_at is null)
$$;

-- the people under me (any depth), by the manager on the employee cards
create or replace function app.my_report_users(p_company uuid)
returns uuid[] language sql stable security definer set search_path = '' as $$
  with recursive chain as (
    select e.id from public.employees e where e.company_id = p_company and e.manager_id in
      (select me.id from public.employees me where me.company_id = p_company and me.user_id = auth.uid() and me.deleted_at is null)
      and e.deleted_at is null
    union
    select e.id from public.employees e join chain c on e.manager_id = c.id where e.deleted_at is null)
  select coalesce(array_agg(e.user_id) filter (where e.user_id is not null), '{}') from chain c join public.employees e on e.id = c.id
$$;

-- decided from the row's own columns, so a row being written can be checked too
create or replace function app.task_row_visible(p_company uuid, p_id uuid, p_created_by uuid, p_assignee uuid, p_private boolean, p_list uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_company = any (app.my_company_ids())
     and (p_created_by = auth.uid() or p_assignee = auth.uid() or app.is_super_admin()
          or (not p_private and (
               exists (select 1 from public.task_watchers w where w.task_id = p_id and w.user_id = auth.uid())
            or exists (select 1 from public.task_list_members lm where lm.list_id = p_list and lm.user_id = auth.uid())
            or exists (select 1 from public.task_lists l where l.id = p_list and l.created_by = auth.uid())
            or p_company = any (app.company_ids_with('tasks.read'))
            or p_assignee = any (app.my_report_users(p_company)))))
$$;
create or replace function app.task_visible(p_task uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tasks t where t.id = p_task and t.deleted_at is null
                   and app.task_row_visible(t.company_id, t.id, t.created_by, t.assignee_id, t.is_private, t.list_id))
$$;

-- may change the task (status, dates, words): the person on it, who made it, their manager, a tasks.write holder
create or replace function app.task_editable(p_task uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks t
     where t.id = p_task and t.deleted_at is null and app.task_visible(t.id)
       and (t.created_by = auth.uid() or t.assignee_id = auth.uid()
            or (not t.is_private and (t.company_id = any (app.company_ids_with('tasks.write')) or t.assignee_id = any (app.my_report_users(t.company_id))))))
$$;

create or replace function app.list_visible(p_list uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.task_lists l where l.id = p_list and l.company_id = any (app.my_company_ids())
                   and (l.created_by = auth.uid()
                        or exists (select 1 from public.task_list_members m where m.list_id = l.id and m.user_id = auth.uid())
                        or (not l.is_private and l.company_id = any (app.company_ids_with('tasks.read')))))
$$;

do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public'
             and tablename in ('tasks','task_lists','task_list_members','task_watchers','task_checklist','task_comments') loop
    execute format('drop policy %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;
drop policy if exists tasks_insert on public.tasks;
drop policy if exists tasks_update on public.tasks;
create policy tasks_select on public.tasks for select to authenticated
  using (deleted_at is null and app.task_row_visible(company_id, id, created_by, assignee_id, is_private, list_id));
create policy tasks_insert on public.tasks for insert to authenticated
  with check (company_id = any (app.my_company_ids()) and created_by = auth.uid());
create policy tasks_update on public.tasks for update to authenticated using (app.task_editable(id)) with check (company_id = any (app.my_company_ids()));

drop policy if exists task_lists_select on public.task_lists;
drop policy if exists task_lists_insert on public.task_lists;
drop policy if exists task_lists_update on public.task_lists;
create or replace function app.list_member(p_list uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.task_list_members m where m.list_id = p_list and m.user_id = auth.uid())
$$;
create policy task_lists_select on public.task_lists for select to authenticated
  using (deleted_at is null and company_id = any (app.my_company_ids())
         and (created_by = auth.uid() or app.list_member(id) or (not is_private and company_id = any (app.company_ids_with('tasks.read')))));
create policy task_lists_insert on public.task_lists for insert to authenticated
  with check (company_id = any (app.my_company_ids()) and created_by = auth.uid());
create policy task_lists_update on public.task_lists for update to authenticated
  using (created_by = auth.uid() or company_id = any (app.company_ids_with('tasks.write')));

drop policy if exists task_list_members_all on public.task_list_members;
create policy task_list_members_select on public.task_list_members for select to authenticated using (app.list_visible(list_id));
create policy task_list_members_insert on public.task_list_members for insert to authenticated
  with check (exists (select 1 from public.task_lists l where l.id = task_list_members.list_id and l.company_id = task_list_members.company_id
                        and (l.created_by = auth.uid() or l.company_id = any (app.company_ids_with('tasks.write'))))
              and app.is_active_member(task_list_members.company_id, task_list_members.user_id));
create policy task_list_members_delete on public.task_list_members for delete to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.task_lists l where l.id = task_list_members.list_id
                                           and (l.created_by = auth.uid() or l.company_id = any (app.company_ids_with('tasks.write')))));

create policy task_watchers_select on public.task_watchers for select to authenticated using (app.task_visible(task_id));
create policy task_watchers_insert on public.task_watchers for insert to authenticated
  with check ((user_id = auth.uid() and app.task_visible(task_id)) or app.task_editable(task_id));
create policy task_watchers_delete on public.task_watchers for delete to authenticated
  using (user_id = auth.uid() or app.task_editable(task_id));

create policy task_checklist_select on public.task_checklist for select to authenticated using (app.task_visible(task_id));
create policy task_checklist_insert on public.task_checklist for insert to authenticated with check (app.task_editable(task_id));
create policy task_checklist_update on public.task_checklist for update to authenticated using (app.task_editable(task_id));
create policy task_checklist_delete on public.task_checklist for delete to authenticated using (app.task_editable(task_id));

create policy task_comments_select on public.task_comments for select to authenticated using (deleted_at is null and app.task_visible(task_id));
create policy task_comments_insert on public.task_comments for insert to authenticated
  with check (kind = 'comment' and created_by = auth.uid() and app.task_visible(task_id));
create policy task_comments_update on public.task_comments for update to authenticated using (created_by = auth.uid() and kind = 'comment');

-- ---------------------------------------------------------------------------- rules on every change
create or replace function app.tg_task_rules()
returns trigger language plpgsql set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_manage boolean;
begin
  new.title := btrim(new.title);
  if new.assignee_id is not null and not app.is_active_member(new.company_id, new.assignee_id) then
    raise exception 'That person is not in this company' using errcode = '22023';
  end if;
  if new.list_id is not null and not exists (select 1 from public.task_lists l where l.id = new.list_id and l.company_id = new.company_id and l.deleted_at is null) then
    raise exception 'List not found' using errcode = 'P0002';
  end if;
  if new.parent_id is not null then
    if new.parent_id = new.id then raise exception 'A task cannot be its own sub-task' using errcode = '22023'; end if;
    if exists (select 1 from public.tasks p where p.id = new.parent_id and p.parent_id is not null) then
      raise exception 'Sub-tasks go one level deep' using errcode = '22023';
    end if;
  end if;
  -- giving the task to someone else: a manager of tasks, the manager of that person, or (for an existing task) who made it
  if v_uid is not null and new.assignee_id is not null and new.assignee_id <> v_uid
     and (tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id) then
    v_manage := new.company_id = any (app.company_ids_with('tasks.write')) or new.assignee_id = any (app.my_report_users(new.company_id))
                or (tg_op = 'UPDATE' and old.created_by = v_uid);
    if not v_manage then raise exception 'Only a manager gives tasks to other people' using errcode = '42501'; end if;
  end if;
  if new.is_private then new.assignee_id := coalesce(new.assignee_id, new.created_by); end if;
  -- done / reopened
  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := now(); new.completed_by := coalesce(v_uid, new.assignee_id);
  elsif new.status <> 'done' then
    new.completed_at := null; new.completed_by := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_20_task_rules on public.tasks;
create trigger trg_20_task_rules before insert or update on public.tasks for each row execute function app.tg_task_rules();

-- the history line and who hears about it
create or replace function app.task_notify(p_task public.tasks, p_users uuid[], p_title text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications (company_id, user_id, type, title, body, link, entity_type, entity_id)
  select distinct p_task.company_id, u, 'info', p_title, p_body, '/tasks?id=' || p_task.id, 'tasks', p_task.id
    from unnest(p_users) u
   where u is not null and u is distinct from auth.uid() and app.is_active_member(p_task.company_id, u)
     and (not p_task.is_private or u = p_task.created_by);
end $$;

create or replace function app.tg_task_after()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_ev jsonb := '{}';
begin
  if tg_op = 'INSERT' then
    insert into public.task_comments (company_id, task_id, kind, event, created_by) values (new.company_id, new.id, 'event', jsonb_build_object('created', true, 'source', new.source), coalesce(auth.uid(), new.created_by));
    if new.assignee_id is not null then
      perform app.task_notify(new, array[new.assignee_id], 'New task: ' || new.title,
                              case when new.due_date is not null then 'Due ' || to_char(new.due_date, 'DD.MM.YYYY') end);
    end if;
    return null;
  end if;
  if new.deleted_at is not null then return null; end if;
  if new.status is distinct from old.status then v_ev := v_ev || jsonb_build_object('status', jsonb_build_array(old.status, new.status)); end if;
  if new.assignee_id is distinct from old.assignee_id then v_ev := v_ev || jsonb_build_object('assignee', jsonb_build_array(old.assignee_id, new.assignee_id)); end if;
  if new.due_date is distinct from old.due_date then v_ev := v_ev || jsonb_build_object('due', jsonb_build_array(old.due_date, new.due_date)); end if;
  if new.priority is distinct from old.priority then v_ev := v_ev || jsonb_build_object('priority', jsonb_build_array(old.priority, new.priority)); end if;
  if v_ev <> '{}' then
    insert into public.task_comments (company_id, task_id, kind, event, created_by) values (new.company_id, new.id, 'event', v_ev, auth.uid());
  end if;
  if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null then
    perform app.task_notify(new, array[new.assignee_id], 'New task: ' || new.title,
                            case when new.due_date is not null then 'Due ' || to_char(new.due_date, 'DD.MM.YYYY') end);
  end if;
  if new.status = 'done' and old.status <> 'done' then
    perform app.task_notify(new, array[new.created_by] || array(select w.user_id from public.task_watchers w where w.task_id = new.id), 'Task done: ' || new.title, null);
  end if;
  return null;
end $$;
drop trigger if exists trg_80_task_after on public.tasks;
create trigger trg_80_task_after after insert or update on public.tasks for each row execute function app.tg_task_after();

create or replace function app.tg_task_comment_after()
returns trigger language plpgsql security definer set search_path = '' as $$
declare t public.tasks; v_name text;
begin
  if new.kind <> 'comment' then return null; end if;
  select * into t from public.tasks where id = new.task_id;
  select coalesce(nullif(btrim(full_name), ''), email) into v_name from public.profiles where id = new.created_by;
  perform app.task_notify(t, array[t.assignee_id, t.created_by] || array(select w.user_id from public.task_watchers w where w.task_id = t.id),
                          coalesce(v_name, 'Someone') || ' commented on ' || t.title, left(coalesce(new.body, ''), 140));
  return null;
end $$;
drop trigger if exists trg_80_comment_after on public.task_comments;
create trigger trg_80_comment_after after insert on public.task_comments for each row execute function app.tg_task_comment_after();

-- notifications about tasks get their own category (people can mute them)
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
  perform app._patch_function('app.notification_category',
    $o$when p_type = 'approval' then 'approvals'$o$,
    $n$when p_type = 'approval' then 'approvals'
    when p_entity = 'tasks' then 'tasks'$n$);
end $$;
drop function app._patch_function(text, text, text);

-- ---------------------------------------------------------------------------- reads for the screens
-- the people tasks can go to: active members, with whether I may give them tasks
create or replace function public.task_people(p_company uuid)
returns table (user_id uuid, name text, is_me boolean, assignable boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_manage boolean; v_reports uuid[];
begin
  if not app.is_active_member(p_company, auth.uid()) and not app.is_super_admin() then
    raise exception 'Not a member of this company' using errcode = '42501';
  end if;
  v_manage := p_company = any (app.company_ids_with('tasks.write'));
  v_reports := app.my_report_users(p_company);
  return query
  select m.user_id, coalesce(nullif(btrim(p.full_name), ''), p.email, m.invited_email)::text, m.user_id = auth.uid(),
         (m.user_id = auth.uid() or v_manage or m.user_id = any (v_reports))
    from public.company_members m left join public.profiles p on p.id = m.user_id
   where m.company_id = p_company and m.status = 'active' and m.deleted_at is null and m.user_id is not null
   order by m.user_id <> auth.uid(), 2;
end $$;

-- the numbers for the menu badge and the dashboard card
create or replace function public.task_counts(p_company uuid)
returns table (open_mine int, overdue_mine int, today_mine int, overdue_team int)
language sql stable security definer set search_path = '' as $$
  select count(*) filter (where t.assignee_id = auth.uid())::int,
         count(*) filter (where t.assignee_id = auth.uid() and t.due_date < current_date)::int,
         count(*) filter (where t.assignee_id = auth.uid() and t.due_date = current_date)::int,
         count(*) filter (where t.assignee_id <> auth.uid() and t.due_date < current_date and app.task_visible(t.id))::int
    from public.tasks t
   where t.company_id = p_company and t.company_id = any (app.my_company_ids()) and t.deleted_at is null and t.status not in ('done','cancelled')
$$;

revoke execute on function public.task_people(uuid), public.task_counts(uuid) from public, anon;
grant execute on function public.task_people(uuid), public.task_counts(uuid) to authenticated;

-- photos and files on tasks: <company>/tasks/<task>/<file> in the attachments folder, for anyone who sees the task
do $$
begin
  if to_regclass('storage.buckets') is null then return; end if;
  execute 'drop policy if exists "task files: upload" on storage.objects';
  execute $p$create policy "task files: upload" on storage.objects for insert to authenticated
    with check (bucket_id = 'attachments' and (storage.foldername(name))[2] = 'tasks'
                and (storage.foldername(name))[1] = any ((select app.my_company_ids())::text[])
                and app.task_visible(((storage.foldername(name))[3])::uuid))$p$;
end $$;

-- live updates on the task screens (row security still decides who gets each change)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.tasks; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.task_comments; exception when duplicate_object then null; end;
  end if;
end $$;
