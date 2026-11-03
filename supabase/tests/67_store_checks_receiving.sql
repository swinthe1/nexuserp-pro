-- =============================================================================
-- DrisPRO · daily checks in the shop, and receiving with temperature and the discrepancy report
-- (runs after 01–66)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
insert into auth.users (email, raw_user_meta_data) values ('drita@chk.al', '{"full_name":"Drita Përgjegjëse"}'), ('arta@chk.al', '{"full_name":"Arta Arkëtare"}')
on conflict do nothing;

select email as boss from public.profiles where is_super_admin limit 1 \gset
set role authenticated;
select t.login(:'boss');
select public.create_company('Kontrolle Ditore Test', 'XK') as co \gset
select public.invite_member(:'co', 'drita@chk.al', array['store_manager']);
select public.invite_member(:'co', 'arta@chk.al', array['pos_cashier']);
select t.accept_invites();
select t.login(:'boss');
select id as shop from public.warehouses where company_id = :'co' order by created_at limit 1 \gset
select id as floor from public.warehouse_locations where company_id = :'co' and warehouse_id = :'shop' order by created_at limit 1 \gset
insert into public.warehouses (company_id, code, name) values (:'co', 'D2', 'Depoja') returning id as depot \gset
insert into public.bank_accounts (company_id, name, account_kind, currency_code, account_id)
select :'co', 'Arka 1', 'cash', 'EUR', id from public.accounts where company_id = :'co' and code = '5311' returning id as drawer \gset
insert into public.pos_registers (company_id, code, name, warehouse_id, location_id, cash_account_id, journal_id)
select :'co', 'A1', 'Arka 1', :'shop', :'floor', :'drawer', id from public.journals where company_id = :'co' and code = 'POS' returning id as reg \gset
select (now() at time zone 'Europe/Tirane')::date as today \gset

-- ----------------------------------------------------------------------------- the lists
select t.login('arta@chk.al');
select t.throws(format($q$select public.store_checklists_defaults('%s')$q$, :'co'), 'only a store manager', 'a cashier does not change the lists');
select t.login('drita@chk.al');
select t.ok(public.store_checklists_defaults(:'co') = 5, 'the five lists of the handbook');
select t.ok(public.store_checklists_defaults(:'co') = 0, 'and not twice');
select t.throws(format($q$select public.store_checklist_save('{"company_id":"%s","name":"Prova","items":[{"label":"Frigo","type":"number","min":8,"max":2}]}')$q$, :'co'),
  'is above its highest', 'a range must make sense');
select public.store_checklist_save(jsonb_build_object('company_id', :'co', 'warehouse_id', :'depot', 'name', 'Rampa e pranimit', 'items', jsonb_build_array(jsonb_build_object('label', 'Rampa e lirë'))));

select t.login('arta@chk.al');
select public.store_checks_day(:'co', :'shop') as day \gset
select t.ok(jsonb_array_length(:'day'::jsonb -> 'lists') = 5 and (select bool_and(x ->> 'status' = 'todo') from jsonb_array_elements(:'day'::jsonb -> 'lists') x),
  'the shop has its five lists for today (the depot''s own list is not here)');
select t.ok(jsonb_array_length(public.store_checks_day(:'co', :'depot') -> 'lists') = 1, 'the depot (no till) only has its own');
select t.ok((:'day'::jsonb -> 'can' ->> 'fill')::boolean and not (:'day'::jsonb -> 'can' ->> 'sign')::boolean, 'the cashier fills, she does not sign');

-- the fridges: the dairy is too warm, the showcase was not read
select id as temp from public.store_checklists where company_id = :'co' and kind = 'temperature' \gset
select items as titems from public.store_checklists where id = :'temp' \gset
select public.store_check_submit(:'temp', :'shop', :'today', jsonb_build_object(
  :'titems'::jsonb -> 0 ->> 'id', jsonb_build_object('value', 9), :'titems'::jsonb -> 1 ->> 'id', jsonb_build_object('value', 3),
  :'titems'::jsonb -> 2 ->> 'id', jsonb_build_object('value', -20)), 'Frigoriferi i bulmetit u thirr për servis') as r1 \gset
select t.ok(jsonb_array_length(:'r1'::jsonb -> 'problems') = 2
  and (select string_agg(x ->> 'why', ',' order by x ->> 'why') from jsonb_array_elements(:'r1'::jsonb -> 'problems') x) = 'high,missing', 'two problems: 9 °C is too warm, the showcase is missing');
select t.login('drita@chk.al');
select t.ok(exists (select 1 from public.notifications where user_id = auth.uid() and title = 'Check with problems: Temperaturat e frigoriferëve · ' || (select name from public.warehouses where id = :'shop')),
  'the store manager is told at once');

-- the opening, all in order
select t.login('arta@chk.al');
select id as open_id, items as oitems from public.store_checklists where company_id = :'co' and kind = 'opening' \gset
select public.store_check_submit(:'open_id', :'shop', :'today',
  (select jsonb_object_agg(it ->> 'id', case when it ->> 'type' = 'number' then jsonb_build_object('value', case when (it ->> 'min')::numeric < -10 then -20 else 3 end) else '{"ok": true}'::jsonb end)
     from jsonb_array_elements(:'oitems'::jsonb) it)) as r2 \gset
select t.ok(jsonb_array_length(:'r2'::jsonb -> 'problems') = 0 and :'r2'::jsonb ->> 'status' = 'done', 'the opening: everything in order');
select t.throws(format($q$select public.store_check_sign('%s')$q$, :'r2'::jsonb ->> 'id'), 'shift leader', 'the cashier does not sign');
select t.throws(format($q$select public.store_check_submit('%s', '%s', '%s', '{}')$q$, :'open_id', :'shop', (:'today'::date - 2)), 'on its day', 'a check is written on its day');
select t.login('drita@chk.al');
select public.store_check_sign((:'r2'::jsonb ->> 'id')::uuid);
select t.login('arta@chk.al');
select t.throws(format($q$select public.store_check_submit('%s', '%s', '%s', '{}')$q$, :'open_id', :'shop', :'today'), 'signed already', 'a signed list does not change');

-- a draft is kept without problems being reported
select id as dates_id from public.store_checklists where company_id = :'co' and kind = 'dates' \gset
select public.store_check_submit(:'dates_id', :'shop', :'today', '{}', null, false);
select public.store_checks_history(:'co', :'shop', :'today'::date - 1, :'today') as h \gset
select t.ok((select x -> 'cells' ->> :'today' from jsonb_array_elements(:'h'::jsonb -> 'lists') x where (x ->> 'checklist_id')::uuid = :'temp') = 'problems'
  and (select x -> 'cells' ->> :'today' from jsonb_array_elements(:'h'::jsonb -> 'lists') x where (x ->> 'checklist_id')::uuid = :'open_id') = 'signed'
  and (select x -> 'cells' ->> :'today' from jsonb_array_elements(:'h'::jsonb -> 'lists') x where (x ->> 'checklist_id')::uuid = :'dates_id') = 'todo',
  'the history: with problems, signed, still to do');

-- not done an hour after its time: a task for the store manager
reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.company_settings set task_automations = '{"store_check": {"on": true}}' where company_id = :'co';
update public.store_checklists set due_time = '00:00' where company_id = :'co' and kind = 'hygiene';
select app.tasks_run(:'co');
select t.ok(case when (now() at time zone 'Europe/Tirane')::time > '01:00' then
       exists (select 1 from public.tasks where company_id = :'co' and title like 'Plotëso kontrollin: Higjiena%' and status not in ('done', 'cancelled'))
       and not exists (select 1 from public.tasks where company_id = :'co' and title like 'Plotëso kontrollin: Hapja%') else true end,
  'the hygiene list not done is a task; the opening, done, is not');

-- ----------------------------------------------------------------------------- receiving
set role authenticated;
select t.login(:'boss');
select id as pcs from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select default_purchase_tax_code_id as vat from public.company_settings where company_id = :'co' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'R-MISH', 'name', 'Mish viçi', 'uom_id', :'pcs', 'sales_price', 9)) as p_meat \gset
update public.products set max_temperature = 4 where id = :'p_meat';
select id as meat from public.product_variants where product_id = :'p_meat' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'R-JOG', 'name', 'Jogurt', 'uom_id', :'pcs', 'sales_price', 1)) as p_yog \gset
update public.products set max_temperature = 6 where id = :'p_yog';
select id as yog from public.product_variants where product_id = :'p_yog' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'R-UJE', 'name', 'Ujë', 'uom_id', :'pcs', 'sales_price', 0.5)) as p \gset
select id as water from public.product_variants where product_id = :'p' \gset
insert into public.business_partners (company_id, code, name, is_vendor) values (:'co', 'F-M', 'Mishi i Freskët', true) returning id as vend \gset
insert into public.purchase_orders (company_id, vendor_id, warehouse_id) values (:'co', :'vend', :'shop') returning id as po \gset
insert into public.purchase_order_lines (company_id, purchase_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
values (:'co', :'po', 1, :'meat', 'Mish', 20, 6, :'vat'), (:'co', :'po', 2, :'yog', 'Jogurt', 100, 0.5, :'vat'), (:'co', :'po', 3, :'water', 'Ujë', 48, 0.2, :'vat');
select public.submit_purchase_order(:'po');
select public.create_receipt_from_po(:'po') as gr \gset
update public.goods_receipts set driver_name = 'Besnik K.', vendor_delivery_note = 'FD-221' where id = :'gr';
select t.throws(format($q$update public.goods_receipt_lines set temperature = 7 where receipt_id = '%s' and variant_id = '%s'$q$, :'gr', :'meat'),
  'above its 4', 'meat at 7 °C cannot be accepted');
update public.goods_receipt_lines set temperature = 7, qc_status = 'rejected', qc_reason = 'Temperaturë 7 °C në mbërritje' where receipt_id = :'gr' and variant_id = :'meat';
update public.goods_receipt_lines set quantity = 90 where receipt_id = :'gr' and variant_id = :'yog';
delete from public.goods_receipt_lines where receipt_id = :'gr' and variant_id = :'water';
select public.post_goods_receipt(:'gr');
select public.receipt_report(:'gr') as rep \gset
select t.ok((:'rep'::jsonb ->> 'issues')::int = 3 and :'rep'::jsonb ->> 'driver_name' = 'Besnik K.' and :'rep'::jsonb ->> 'delivery_note' = 'FD-221', 'the report: three lines differ');
select t.ok((select x -> 'issues' @> '["refused", "warm", "short"]' and x ->> 'reason' like 'Temperaturë%' from jsonb_array_elements(:'rep'::jsonb -> 'lines') x where x ->> 'sku' = 'R-MISH'),
  'the meat: refused, too warm, so short, with the reason');
select t.ok((select x -> 'issues' = '["short", "not_measured"]' and (x ->> 'accepted')::numeric = 90 and (x ->> 'expected')::numeric = 100
               from jsonb_array_elements(:'rep'::jsonb -> 'lines') x where x ->> 'sku' = 'R-JOG'), 'the yoghurt: 90 of 100, and its temperature was not taken');
select t.ok((select x -> 'issues' = '["short"]' and (x ->> 'accepted')::numeric = 0 from jsonb_array_elements(:'rep'::jsonb -> 'lines') x where x ->> 'sku' = 'R-UJE'),
  'the water did not come at all');

reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
