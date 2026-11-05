-- =============================================================================
-- From the meeting with the administrative staff (answers of 5 November): the highest value of a
-- receipt (#17), the bar's whole order and each station's printer (#20), the expiry date on every
-- purchase line (#9), supplier contracts (#28)  (runs after 17 "Magazina Test", 64 and 80–84)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select id as reg from public.pos_registers where company_id = :'co' and code = 'T10' \gset
select warehouse_id as shop from public.pos_registers where id = :'reg' \gset
select id as ses from public.pos_sessions where register_id = :'reg' and status = 'open' order by opened_at desc limit 1 \gset
select id as beer from public.product_variants where company_id = :'co' and sku = 'KT-BEER' \gset
select id as ven from public.business_partners where company_id = :'co' and code = 'FT1' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
set role authenticated;

-- ---------------------------------------------------------------- 9
select t.login(:'boss');
select public.save_document('vendor_bills', jsonb_build_object('company_id', :'co', 'document_type', 'vendor_bill', 'vendor_id', :'ven', 'vendor_invoice_number', 'EXP-9',
   'bill_date', current_date, 'due_date', current_date, 'currency_code', 'EUR', 'warehouse_id', :'shop'),
   jsonb_build_object('vendor_bill_lines', jsonb_build_array(jsonb_build_object('line_no', 1, 'variant_id', :'beer', 'description', 'Birra', 'quantity', 4, 'unit_price', 1,
     'expiry_date', current_date + 5)))) as eb \gset
select public.purchase_invoice_complete(:'eb');
select public.expiry_overview(:'co', :'shop', 7) as ov \gset
select t.ok(exists (select 1 from jsonb_array_elements(:'ov'::jsonb -> 'lots') x where (x ->> 'from_invoice')::boolean and x ->> 'lot_number' = 'EXP-9'
                     and (x ->> 'variant_id')::uuid = :'beer' and (x ->> 'on_hand')::numeric between 0.001 and 4 and (x ->> 'days_left')::int = 5),
         'an item not kept by lot: the expiry date of its purchase line shows in Short dates');

-- ---------------------------------------------------------------- 17
select t.login('besa@kt.al');
select public.automation_settings_save(:'co', '{"pos_receipt_max": 50}');
select t.ok((public.pos_till_options(:'reg') ->> 'receipt_max')::numeric = 50, 'the till knows the highest value of a receipt');
select t.login('cora@kt.al');
select t.throws(format($q$select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', 60, 'unit_price', 1, 'discount_pct', 0, 'manual_pct', 0)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'card', 'amount', 60))))$q$, :'ses', :'beer'), 'at most', 'a receipt above the limit is not made');
select t.ok(public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses', 'offline', true, 'order_at', now() - interval '1 hour',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'beer', 'quantity', 55, 'unit_price', 1, 'discount_pct', 0, 'manual_pct', 0)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'card', 'amount', 55)))) is not null, 'a sale made offline before the till knew is kept');
select t.login('besa@kt.al');
select public.automation_settings_save(:'co', '{"pos_receipt_max": ""}');
reset role;
select t.ok((select pos_receipt_max from public.company_settings where company_id = :'co') is null, 'emptied: no limit');
set role authenticated;

-- ---------------------------------------------------------------- 28
select t.login(:'boss');
insert into public.supplier_contracts (company_id, vendor_id, number, title, start_date, end_date, payment_days, rebate_pct, returns_expired, remind_days)
values (:'co', :'ven', 'K-2026/01', 'Furnizim me pije', current_date - 100, current_date + 30, 45, 3, true, 30) returning id as k1 \gset
insert into public.supplier_contracts (company_id, vendor_id, number, start_date, end_date) values (:'co', :'ven', 'K-2025/07', current_date - 400, current_date - 1) returning id as k0 \gset
select t.ok((public.supplier_contract_for(:'ven') ->> 'number') = 'K-2026/01' and (public.supplier_contract_for(:'ven') ->> 'payment_days')::int = 45, 'the contract in force, with its terms');
select t.ok(public.supplier_contract_for(:'ven', current_date + 31) is null, 'none after it ends');
reset role;
select public.run_daily_reminders();
select t.ok((select status from public.supplier_contracts where id = :'k0') = 'ended', 'a contract past its end is ended');
select t.ok(exists (select 1 from public.notifications where company_id = :'co' and title like 'Contract K-2026/01 with % ends %'), 'the buyers are told a month before the end');
set role authenticated;
select t.login('cora@kt.al');
select t.ok(not exists (select 1 from public.supplier_contracts where company_id = :'co'), 'a cashier does not see the contracts');

-- ---------------------------------------------------------------- 20 (a bar and a kitchen in the shop)
reset role;
select id as c_alc from public.product_categories where company_id = :'co' and name = 'Pije alkoolike' \gset
insert into public.product_categories (company_id, name) values (:'co', 'Ushqim') returning id as c_food \gset
select id as pcs from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
update public.pos_registers set mode = 'restaurant' where id = :'reg';
insert into public.restaurant_areas (company_id, warehouse_id, name) values (:'co', :'shop', 'Salla') returning id as area \gset
insert into public.restaurant_tables (company_id, area_id, name, seats) values (:'co', :'area', 'T85', 2) returning id as t85 \gset
insert into public.kitchen_stations (company_id, warehouse_id, name, category_ids, whole_order, printer) values (:'co', :'shop', 'Shanku', array[:'c_alc'::uuid], true, 'Printeri i shankut') returning id as bar \gset
insert into public.kitchen_stations (company_id, warehouse_id, name, is_default, printer) values (:'co', :'shop', 'Kuzhina', true, 'Printeri i kuzhinës');
set role authenticated;
select t.login(:'boss');
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'KT-BYREK', 'name', 'Byrek me spinaq', 'uom_id', :'pcs', 'product_type', 'consumable',
  'sales_price', 2, 'category_id', :'c_food')) as p_food \gset
select id as food from public.product_variants where product_id = :'p_food' \gset
select t.login('cora@kt.al');
select public.restaurant_open(:'reg', :'t85', 2) as tab \gset
select public.restaurant_add(:'tab', jsonb_build_array(jsonb_build_object('variant_id', :'beer', 'quantity', 2), jsonb_build_object('variant_id', :'food', 'quantity', 1, 'note', 'pa djathë')));
select public.restaurant_send(:'tab') as sent \gset
select t.ok((select jsonb_array_length(x -> 'lines') from jsonb_array_elements(:'sent'::jsonb -> 'tickets') x where x ->> 'station' = 'Shanku') = 2
        and (select x ->> 'printer' from jsonb_array_elements(:'sent'::jsonb -> 'tickets') x where x ->> 'station' = 'Shanku') = 'Printeri i shankut',
         'the bar gets the whole order, on its own printer');
select t.ok((select jsonb_array_length(x -> 'lines') from jsonb_array_elements(:'sent'::jsonb -> 'tickets') x where x ->> 'station' = 'Kuzhina') = 1
        and (select x -> 'lines' -> 0 ->> 'note' from jsonb_array_elements(:'sent'::jsonb -> 'tickets') x where x ->> 'station' = 'Kuzhina') = 'pa djathë'
        and (select x ->> 'printer' from jsonb_array_elements(:'sent'::jsonb -> 'tickets') x where x ->> 'station' = 'Kuzhina') = 'Printeri i kuzhinës',
         'the kitchen only the food, on its printer');
select t.ok(jsonb_array_length(public.restaurant_kitchen(:'shop', :'bar')) = 1
        and (select count(*) from jsonb_array_elements(public.restaurant_kitchen(:'shop', :'bar') -> 0 -> 'lines')) = 1, 'the bar screen still shows only the bar''s own items');
select t.ok(jsonb_path_exists(public.restaurant_floor(:'reg'), '$.stations[*] ? (@.whole_order == true)'), 'the floor knows which station prints the whole order');
reset role;
update public.pos_registers set mode = 'retail' where id = :'reg';

\set QUIET off
select count(*) as assertions_passed from t.results;
