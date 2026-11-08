-- =============================================================================
-- The day's count of the riskiest items, how right the stock is, and the loss watch.
-- (after 127, on "Kontrolle Test", which has tills, sales and stock)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select id as wh from public.warehouses where company_id = :'co' and name = 'Main Warehouse' \gset
select id as till, (select id from public.pos_sessions s where s.register_id = r.id order by opened_at desc limit 1) as sess
  from public.pos_registers r where company_id = :'co' and name = 'Till 22' \gset
select id as cora from public.profiles where email = 'cora@kt.al' \gset
select id as wanda from public.profiles where email = 'wanda@kt.al' \gset
select sl.variant_id as risky from public.stock_levels sl join public.warehouse_locations l on l.id = sl.location_id and l.location_type = 'internal'
 where sl.warehouse_id = :'wh' and sl.on_hand > 0 order by sl.variant_id limit 1 \gset

-- 1. an item taken off at the till again and again rises to the top, with the reason
insert into public.pos_till_log (id, company_id, session_id, register_id, kind, variant_id, description, quantity, amount, at, cashier_id)
select gen_random_uuid(), :'co', :'sess', :'till', 'void_line', :'risky', 'x', 1, 2, now() - make_interval(hours => g), :'cora'
  from generate_series(1, 6) g;
select t.ok((select 'voids' = any (reasons) from app.count_risk(:'wh') where variant_id = :'risky'), 'an item taken off often at the till is risky, and says why');
select t.ok((select score from app.count_risk(:'wh') where variant_id = :'risky') = (select max(score) from app.count_risk(:'wh')), 'it comes first');

-- 2. the day's counts: one for each person of the unit who may count, a few items each, with a task
update public.company_members set warehouse_ids = array[:'wh'::uuid] where company_id = :'co' and user_id = :'wanda';
select t.ok(app.daily_counts(:'co', 3, current_date) >= 1, 'the day''s counts are made');
select id as dc from public.cycle_counts where company_id = :'co' and scope = 'risk' and assigned_to = :'wanda' \gset
select t.ok((select count(distinct variant_id) from public.cycle_count_lines where cycle_count_id = :'dc') between 1 and 3, 'a few items each, not more');
select t.ok(exists (select 1 from public.cycle_count_lines where cycle_count_id = :'dc' and variant_id = :'risky'), 'the riskiest item is in it');
select t.ok((select blind_count and status = 'in_progress' from public.cycle_counts where id = :'dc'), 'blind, and ready to count');
select t.ok(exists (select 1 from public.tasks where auto_key = 'daily_count:' || :'dc' and assignee_id = :'wanda' and status = 'todo'), 'the person has it among the tasks');
select t.ok(app.daily_counts(:'co', 3, current_date) = 0, 'a second run the same day makes nothing new');
select t.ok(not exists (select 1 from public.cycle_counts c join public.cycle_count_lines l on l.cycle_count_id = c.id
                         where c.company_id = :'co' and c.scope = 'risk' and c.warehouse_id = :'wh' and c.id <> :'dc' and l.variant_id = :'risky'), 'two people of a unit do not get the same item');
update public.cycle_count_lines set counted_qty = system_qty, counted_at = now() where cycle_count_id = :'dc';
update public.cycle_counts set status = 'review' where id = :'dc';
select t.ok((select status = 'done' from public.tasks where auto_key = 'daily_count:' || :'dc'), 'sending the count closes the task');
select t.ok((select reasons is not null from public.cycle_count_lines where cycle_count_id = :'dc' and variant_id = :'risky' limit 1), 'the count keeps why each item was picked');

-- 3. the loss watch: a cashier far above the rest stands out; only a manager sees it
select t.ok(exists (select 1 from jsonb_array_elements(app.loss_watch_data(:'co', current_date - 7, current_date) -> 'signals') s
                     where s ->> 'kind' = 'voids' and s ->> 'user_id' = :'cora'), 'many items taken off the sale stand out');
set role authenticated;
select t.login('besa@kt.al');
select t.ok(jsonb_typeof(public.loss_watch(:'co', current_date - 7, current_date) -> 'cashiers') = 'array', 'the manager sees the cashiers side by side');
select t.ok(jsonb_typeof(public.count_risk_list(:'wh', 10)) = 'array', 'and where the risk is');
select t.ok(jsonb_typeof(public.count_accuracy(:'co', 30)) = 'array', 'and how right the stock is');
select t.login('cora@kt.al');
select t.throws($$select public.loss_watch('$$ || :'co' || $$', current_date - 7, current_date)$$, 'Permission denied', 'a cashier does not see the loss watch');
reset role;
select t.ok(not has_function_privilege('authenticated', 'app.daily_counts(uuid, int, date)', 'execute'), 'the day''s counts are made only by the program or by daily_counts_now');

\set QUIET off
select count(*) as assertions_passed from t.results;
