-- =============================================================================
-- DrisPRO · tasks: who sees and changes what, giving tasks, done, history, comments, lists
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
insert into auth.users (email, raw_user_meta_data) values
  ('mgr@dt.al', '{"full_name":"Mira Menaxhere"}'), ('ana@dt.al', '{"full_name":"Ana Arkëtare"}'),
  ('ben@dt.al', '{"full_name":"Ben Magazinier"}'), ('aud@dt.al', '{"full_name":"Auditori"}') on conflict do nothing;
select id as u_mgr from auth.users where email = 'mgr@dt.al' \gset
select id as u_ana from auth.users where email = 'ana@dt.al' \gset
select id as u_ben from auth.users where email = 'ben@dt.al' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
set role authenticated;
select t.login(:'boss');
select public.create_company('Detyra Test', 'AL') as co \gset
select public.invite_member(:'co', 'mgr@dt.al', array['store_manager']);
select t.accept_invites();
select public.invite_member(:'co', 'ana@dt.al', array['pos_cashier']);
select t.accept_invites();
select public.invite_member(:'co', 'ben@dt.al', array['warehouse_operator']);
select t.accept_invites();
select public.invite_member(:'co', 'aud@dt.al', array['auditor']);
select t.accept_invites();
-- the manager chain: Ben reports to Mira
insert into public.employees (company_id, user_id, first_name, last_name, hire_date) values (:'co', :'u_mgr', 'Mira', 'Menaxhere', '2025-01-01') returning id as e_mgr \gset
insert into public.employees (company_id, user_id, first_name, last_name, hire_date, manager_id) values (:'co', :'u_ben', 'Ben', 'Magazinier', '2025-01-01', :'e_mgr');
insert into public.employees (company_id, user_id, first_name, last_name, hire_date) values (:'co', :'u_ana', 'Ana', 'Arkëtare', '2025-01-01');

-- a cashier keeps her own tasks
select t.login('ana@dt.al');
insert into public.tasks (company_id, title, assignee_id, due_date) values (:'co', '  Fshi vitrinën  ', :'u_ana', current_date - 1) returning id as t1, number as t1_no \gset
select t.ok(:'t1_no' like 'DET-%', 'a task gets its own number');
select t.ok((select title from public.tasks where id = :'t1') = 'Fshi vitrinën', 'the title is trimmed');
select t.throws($$insert into public.tasks (company_id, title, assignee_id) values ('$$ || :'co' || $$', 'Numëro stokun', '$$ || :'u_ben' || $$')$$, 'Only a manager', 'a cashier cannot give tasks to others');
insert into public.task_checklist (company_id, task_id, title) values (:'co', :'t1', 'Xhamat');
insert into public.task_comments (company_id, task_id, body) values (:'co', :'t1', 'Mungon pastruesi');
insert into public.tasks (company_id, title, is_private) values (:'co', 'Takim me bankën', true) returning id as tp \gset
select t.ok((select assignee_id from public.tasks where id = :'tp') = :'u_ana', 'a private task stays with whoever made it');
select t.ok((select overdue_mine from public.task_counts(:'co')) = 1 and (select open_mine from public.task_counts(:'co')) = 2, 'her counts: two open, one late');

select t.login('ben@dt.al');
select t.ok((select count(*) from public.tasks where id in (:'t1', :'tp')) = 0, 'a colleague does not see her tasks');
update public.tasks set status = 'done' where id = :'t1';
select t.throws($$insert into public.task_comments (company_id, task_id, body) values ('$$ || :'co' || $$', '$$ || :'t1' || $$', 'x')$$, '', 'nor comment on them');

select t.login('aud@dt.al');
select t.ok((select count(*) from public.tasks where id = :'t1') = 1, 'whoever may see every task sees it');
select t.ok((select count(*) from public.tasks where id = :'tp') = 0, 'but never a private one');

-- the manager gives tasks
select t.login('mgr@dt.al');
insert into public.tasks (company_id, title, assignee_id, due_date, priority) values (:'co', 'Rregullo frigoriferin', :'u_ana', current_date + 2, 2) returning id as t2 \gset
insert into public.tasks (company_id, title, assignee_id) values (:'co', 'Prano mallin', :'u_ben') returning id as t3 \gset
insert into public.tasks (company_id, title, parent_id) values (:'co', 'Blej llamba', :'t2') returning id as t2a \gset
select t.throws($$insert into public.tasks (company_id, title, parent_id) values ('$$ || :'co' || $$', 'x', '$$ || :'t2a' || $$')$$, 'one level', 'sub-tasks go one level deep');
select t.ok((select count(*) from public.tasks where id = :'t1') = 0, 'a manager without the people link does not see the cashier''s own task');

select t.login('ana@dt.al');
select t.ok((select count(*) from public.notifications where company_id = :'co' and user_id = :'u_ana' and title = 'New task: Rregullo frigoriferin' and entity_type = 'tasks' and category = 'tasks') = 1,
            'the person given a task hears about it, in the tasks category');
update public.tasks set status = 'done' where id = :'t2';
select t.ok((select completed_at is not null and completed_by = :'u_ana' from public.tasks where id = :'t2'), 'done records when and who');
select t.ok((select count(*) from public.task_comments where task_id = :'t2' and kind = 'event') = 2, 'the history keeps the creation and the change');
update public.tasks set status = 'doing' where id = :'t2';
select t.ok((select completed_at is null from public.tasks where id = :'t2'), 'reopened, it is no longer done');
update public.tasks set status = 'done' where id = :'t2';
select t.throws($$update public.tasks set assignee_id = '$$ || :'u_ben' || $$' where id = '$$ || :'t2' || $$'$$, 'Only a manager', 'she cannot pass the task on');
insert into public.task_comments (company_id, task_id, body) values (:'co', :'t2', 'U rregullua');

select t.login('mgr@dt.al');
select t.ok((select count(*) from public.notifications where company_id = :'co' and user_id = :'u_mgr' and title = 'Task done: Rregullo frigoriferin') >= 1, 'who gave the task hears it is done');
select t.ok((select count(*) from public.notifications where company_id = :'co' and user_id = :'u_mgr' and title like '% commented on Rregullo frigoriferin') = 1, 'and about the comment');
-- a list shared with the cashier shows its tasks to her
insert into public.task_lists (company_id, name) values (:'co', 'Hapja e dyqanit') returning id as l1 \gset
insert into public.task_list_members (company_id, list_id, user_id) values (:'co', :'l1', :'u_ana');
update public.tasks set list_id = :'l1' where id = :'t3';
select t.login('ana@dt.al');
select t.ok((select count(*) from public.tasks where id = :'t3') = 1, 'a list member sees the tasks on the list');
select t.ok((select count(*) from public.task_people(:'co') where assignable) = 1, 'she may give tasks only to herself');

-- Ben's manager sees Ben's tasks even when someone else gave them
select t.login(:'boss');
insert into public.tasks (company_id, title, assignee_id) values (:'co', 'Numëro raftin A', :'u_ben') returning id as t4 \gset
select t.login('mgr@dt.al');
select t.ok((select count(*) from public.tasks where id = :'t4') = 1, 'a manager sees the tasks of the people under them');
reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
