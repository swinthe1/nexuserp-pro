-- =============================================================================
-- From the meeting with the administrative staff: the same supplier invoice never twice; new items
-- from invoices wait for approval when the company wants; no transfer below zero
-- (runs after 69 "Agjent Test", 74)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Agjent Test' \gset
select id as shop from public.warehouses where company_id = :'co' and name = 'Dyqani Qendër' \gset
select id as depot from public.warehouses where company_id = :'co' and code = 'MQ' \gset
select id as kac from public.product_variants where company_id = :'co' and sku = 'A-KAC' \gset
select id as vesa from auth.users where email = 'vesa@agjent.xk' \gset
set role authenticated;

-- ---------------------------------------------------------------- 7. the same invoice twice
select t.login('drita@agjent.xk');
insert into public.business_partners (company_id, code, name, is_vendor, tax_number) values (:'co', 'DP1', 'Furra Dukagjini', true, '811223344') returning id as v1 \gset
insert into public.business_partners (company_id, code, name, is_vendor, tax_number) values (:'co', 'DP2', 'Furra Dukagjini SHPK', true, '811223344') returning id as v2 \gset
select public.save_document('vendor_bills', jsonb_build_object('company_id', :'co', 'document_type', 'vendor_bill', 'vendor_id', :'v1', 'vendor_invoice_number', 'F04-2026/1122',
   'bill_date', current_date, 'due_date', current_date, 'currency_code', 'EUR', 'warehouse_id', :'shop'), '{}'::jsonb) as b1 \gset
select t.throws(format($q$select public.save_document('vendor_bills', jsonb_build_object('company_id', %L, 'document_type', 'vendor_bill', 'vendor_id', %L, 'vendor_invoice_number', 'f04 2026 1122',
   'bill_date', current_date, 'due_date', current_date, 'currency_code', 'EUR'), '{}'::jsonb)$q$, :'co', :'v1'), 'already entered', 'the same number written differently is the same invoice');
select t.throws(format($q$select public.save_document('vendor_bills', jsonb_build_object('company_id', %L, 'document_type', 'vendor_bill', 'vendor_id', %L, 'vendor_invoice_number', 'F04-2026-1122',
   'bill_date', current_date, 'due_date', current_date, 'currency_code', 'EUR'), '{}'::jsonb)$q$, :'co', :'v2'), 'already entered', 'also under the same supplier opened twice (same tax number)');
select t.ok((public.vendor_bill_duplicate(:'co', :'v2', 'F04.2026.1122') ->> 'id') = :'b1', 'the invoice screen is told while the number is typed');
select t.ok(public.vendor_bill_duplicate(:'co', :'v1', 'F04-2026-1123') is null, 'another number is fine');

-- ---------------------------------------------------------------- 12. new items wait for approval
reset role;
insert into public.roles (company_id, key, name) values (:'co', 'blerje_test', 'Blerje (test)') returning id as rl \gset
insert into public.role_permissions (role_id, permission) values (:'rl', 'core.read'), (:'rl', 'inventory.read'), (:'rl', 'inventory.write'), (:'rl', 'invoicing.write');
insert into public.member_roles (member_id, role_id, company_id) select m.id, :'rl', :'co' from public.company_members m where m.company_id = :'co' and m.user_id = :'vesa';
set role authenticated;
select t.login('drita@agjent.xk');
select public.new_items_setting_save(:'co', 'approval');
select t.login('vesa@agjent.xk');
select public.purchase_line_new_item(:'co', '{"name":"Vezë fshati 30 copë","barcode":"3800000000015","cost":4.2,"vat_rate":8}') as r1 \gset
select t.ok((:'r1'::jsonb ->> 'requested')::boolean and not exists (select 1 from public.product_variants where company_id = :'co' and name like 'Vezë fshati%'),
            'someone who may not approve items asks for it; nothing is made');
select (:'r1'::jsonb ->> 'request_id') as req \gset
select t.ok((public.purchase_line_new_item(:'co', '{"name":"Vezë fshati 30 copë","barcode":"3800000000015"}') ->> 'request_id') = :'req', 'asking again is the same request');
select t.throws(format($q$select public.item_request_decide(%L, true)$q$, :'req'), 'Permission denied|inventory.approve', 'and cannot approve it');
reset role;
select t.ok(exists (select 1 from public.notifications n join public.company_members m on m.user_id = n.user_id and m.company_id = n.company_id
                     join auth.users u on u.id = n.user_id where n.company_id = :'co' and n.type = 'item_request' and u.email = 'drita@agjent.xk'),
            'the people who approve items are told');
set role authenticated;
select t.login('drita@agjent.xk');
select public.item_request_decide(:'req', true) ->> 'variant_id' as newv \gset
select t.ok((select status = 'made' and variant_id = :'newv' from public.item_requests where id = :'req'), 'approved: the item is made');
reset role;
select t.ok(exists (select 1 from public.notifications where user_id = :'vesa' and type = 'item_request' and title like 'The new item is made:%'), 'and the one who asked is told');
set role authenticated;
select t.login('drita@agjent.xk');
select public.new_items_setting_save(:'co', 'anyone');

-- ---------------------------------------------------------------- 21. no transfer below zero
reset role;
update public.company_settings set allow_negative_stock = true where company_id = :'co';
select app.main_location(:'depot') as dloc \gset
select app.main_location(:'shop') as sloc \gset
set role authenticated;
select t.login('drita@agjent.xk');
insert into public.stock_transfers (company_id, from_warehouse_id, to_warehouse_id) values (:'co', :'depot', :'shop') returning id as trf \gset
insert into public.stock_transfer_lines (company_id, transfer_id, variant_id, from_location_id, to_location_id, quantity)
values (:'co', :'trf', :'kac', :'dloc', :'sloc', 5);
select t.throws(format($q$select public.post_stock_transfer(%L)$q$, :'trf'), 'Not enough', 'a unit cannot send what it does not have, even where tills may sell below zero');
reset role;
update public.company_settings set allow_negative_stock = false where company_id = :'co';

\set QUIET off
select count(*) as assertions_passed from t.results;
