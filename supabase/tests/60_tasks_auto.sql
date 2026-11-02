-- =============================================================================
-- DrisPRO · tasks part 2: repeating tasks, templates, automations without duplicates, reminders
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Detyra Test' order by created_at desc limit 1 \gset
select id as u_mgr from auth.users where email = 'mgr@dt.al' \gset
select id as u_ana from auth.users where email = 'ana@dt.al' \gset

-- when a rule falls next
select t.ok(app.rule_next(row(null, null, 'x', null, null, null, 1, '{}', 'workdays', '{}', null, date '2026-11-06', true, null, null, null, null, null, null)::public.task_rules, date '2026-11-06') = date '2026-11-09',
            'after a Friday the next working day is Monday');
select t.ok(app.rule_next(row(null, null, 'x', null, null, null, 1, '{}', 'monthly', '{}', 0, date '2026-01-31', true, null, null, null, null, null, null)::public.task_rules, date '2026-01-31') = date '2026-02-28',
            'the last day of the month follows the month');
select t.ok(app.rule_next(row(null, null, 'x', null, null, null, 1, '{}', 'weekly', '{1,4}', null, date '2026-11-02', true, null, null, null, null, null, null)::public.task_rules, date '2026-11-02') = date '2026-11-05',
            'weekly on Monday and Thursday: after Monday comes Thursday');

set role authenticated;
select t.login('mgr@dt.al');
insert into public.task_rules (company_id, title, assignee_id, freq, next_on, checklist) values (:'co', 'Hapja e dyqanit', :'u_ana', 'daily', current_date - 2, '{Dritat,Peshorja}') returning id as r1 \gset
reset role;
select app.tasks_run(:'co') as made \gset
select t.ok((select count(*) from public.tasks where rule_id = :'r1') = 1, 'a missed repeating task is made once, not once per missed day');
select t.ok((select next_on from public.task_rules where id = :'r1') = current_date + 1, 'and the rule moves past today');
select t.ok((select count(*) from public.task_checklist c join public.tasks t on t.id = c.task_id where t.rule_id = :'r1') = 2, 'with its checklist');
select app.tasks_run(:'co') as again \gset
select t.ok((select count(*) from public.tasks where rule_id = :'r1') = 1, 'running again makes nothing new');

-- an automation makes one task per thing while it is open
select t.ok(app.auto_task(:'co', 'test:1', 'Kontakto Bletën', :'u_ana', current_date, 1::smallint, null, null, null), 'an automation makes a task');
select t.ok(not app.auto_task(:'co', 'test:1', 'Kontakto Bletën', :'u_ana', current_date, 1::smallint, null, null, null), 'not a second one while the first is open');
update public.tasks set status = 'done' where auto_key = 'test:1';
select t.ok(not app.auto_task(:'co', 'test:1', 'Kontakto Bletën', :'u_ana', current_date, 1::smallint, null, null, null), 'nor after it is done');

-- reminders: once a day, on the day
insert into public.tasks (company_id, title, assignee_id, due_date, created_by) values (:'co', 'Dorëzo raportin', :'u_ana', current_date, :'u_mgr') returning id as t5 \gset
select app.tasks_remind(:'co') as r \gset
select app.tasks_remind(:'co') as r2 \gset
select t.ok((select count(*) from public.notifications where entity_id = :'t5' and title = 'Due today: Dorëzo raportin') = 1, 'a reminder on the day, only once');

-- a template makes its tasks with their dates
set role authenticated;
select t.login('mgr@dt.al');
insert into public.task_templates (company_id, name, items) values (:'co', 'Punëtori i ri',
  '[{"title":"Hap llogarinë","due_in_days":0},{"title":"Trajnimi në arkë","due_in_days":2,"checklist":["Kuponi","Kthimi"]}]') returning id as tp \gset
select public.task_apply_template(:'tp', current_date, :'u_ana') as made_tpl \gset
select t.ok(:'made_tpl'::int = 2 and (select due_date from public.tasks where title = 'Trajnimi në arkë' and company_id = :'co') = current_date + 2, 'a template makes its tasks, dated from the start');
select t.login('ana@dt.al');
select t.throws($$select public.task_apply_template('$$ || :'tp' || $$')$$, '', 'only a manager starts a template');
reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
