-- =============================================================================
-- NexusERP Pro · history from the old program (runs after 17)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

set role authenticated;
select t.login('zoe@platform.io');
select id as co from public.companies where name = 'Kafe Test' \gset
select (public.sync_create_connection(:'co', 'Logmicro history') ->> 'key') as key \gset
reset role;

set role anon;
select public.sync_push(:'key', jsonb_build_object(
  'warehouses', '[{"code":"3","name":"Njesia 3"}]'::jsonb,
  'products', '[{"sku":"500","name":"COCA COLA 0.5","price":"1","vat":"18"},{"sku":"501","name":"UJE 1.5","price":"0.5","vat":"18"}]'::jsonb,
  'partners', '[{"code":"V9","name":"Furnitori","role":"vendor"},{"code":"C9","name":"Blerësi","role":"customer"}]'::jsonb));
select public.sync_history(:'key', 'documents', '[
  {"ext_id":"LM2026:1","kind":"pos_sale","doc_type":"Kupon","number":"K-1","date":"2026-01-05","partner":"C9","warehouse":"3","total":"2.5","tax":"0.38","paid":"2.5","cashier":"Arta",
   "lines":[{"line":10,"sku":"500","name":"COCA COLA 0.5","qty":"2","price":"1","total":"2"},{"line":20,"sku":"501","name":"UJE 1.5","qty":"1","price":"0.5","total":"0.5"}]},
  {"ext_id":"LM2026:2","kind":"purchase","number":"FB-1","date":"2026-01-03","partner":"V9","warehouse":"3","total":"100",
   "lines":[{"line":10,"sku":"500","qty":"200","price":"0.5","total":"100"}]}]'::jsonb) as h1 \gset
select public.sync_history(:'key', 'documents', '[{"ext_id":"LM2026:1","kind":"pos_sale","number":"K-1","date":"2026-01-05","total":"2.5","partner":"C9","warehouse":"3",
   "lines":[{"line":10,"sku":"500","qty":"2","price":"1","total":"2"},{"line":20,"sku":"501","qty":"1","price":"0.5","total":"0.5"}]}]'::jsonb) as h2 \gset
select public.sync_history(:'key', 'documents', '[{"ext_id":"LM2026:3","kind":"pos_sale","number":"K-3","date":"2026-01-06","warehouse":"3","total":"1","tax":"","paid":"","partner":"",
   "lines":[{"line":10,"sku":"500","qty":"1","price":"1","total":"1","discount":"","cost":""}]}]'::jsonb) as h3 \gset
select public.sync_history(:'key', 'payments', '[{"ext_id":"CL:1","kind":"cash","number":"K-1","date":"2026-01-05","amount":"2.5","book":"Arka 3","document":"K-1"},
  {"ext_id":"P:1","kind":"bank","number":"PAG-1","date":"2026-01-20","partner":"V9","amount":"-100","document":"FB-1"}]'::jsonb) as p1 \gset
select public.sync_history(:'key', 'balances', '[{"account":"60100","name":"Shitjet","period":"2026-01","debit":"0","credit":"2.12"},
  {"account":"12000","name":"Arka","period":"2025-12","debit":"50","credit":"0"},{"account":"12000","name":"Arka","period":"2026-01","debit":"2.5","credit":"100"}]'::jsonb) as b1 \gset
select public.sync_history(:'key', 'barcodes', '[{"sku":"500","barcode":"5449000000996"},{"sku":"500","barcode":"123"},{"sku":"501","barcode":"5449000000997"}]'::jsonb) as bc \gset
select public.sync_history(:'key', 'vendor_products', '[{"sku":"500","vendor":"V9","vendor_sku":"CC-05","price":"0.5"}]'::jsonb) as vp \gset
select public.sync_history(:'key', 'reorder', '[{"sku":"500","warehouse":"3","min":"24","max":"96"},{"sku":"501","warehouse":"3","min":"0","max":"0"}]'::jsonb) as ro \gset
select public.sync_history(:'key', 'activity', '[{"sku":"500","last_movement":"2026-10-20","last_sold":"2026-10-20","last_received":"2026-09-01"},{"sku":"501"},{"sku":"NOPE"}]'::jsonb) as ac \gset
select public.sync_history(:'key', 'employees', '[{"code":"E-77","first":"Blerim","last":"Krasniqi","start":"2024-03-01","gender":"M"}]'::jsonb) as em \gset
select public.sync_history(:'key', 'attendance', '[{"employee":"E-77","date":"2026-10-20","in":"2026-10-20T08:00:00","out":"2026-10-20T16:30:00"}]'::jsonb) as at \gset
reset role;

select t.ok((:'h1'::jsonb ->> 'saved')::int = 2 and (select count(*) from public.history_document_lines l join public.history_documents h on h.id = l.document_id where h.company_id = :'co') = 4,
  'documents arrive with their lines');
select t.ok((select count(*) from public.history_document_lines l join public.history_documents h on h.id = l.document_id where h.company_id = :'co' and h.ext_id = 'LM2026:1') = 2,
  'sending a document again replaces it, it does not double');
select t.ok((select partner_id is not null and warehouse_id is not null from public.history_documents where company_id = :'co' and ext_id = 'LM2026:1'), 'linked to the customer and the store');
select t.ok((select count(*) from public.history_document_lines l join public.history_documents h on h.id = l.document_id where h.company_id = :'co' and l.variant_id is not null) = 4, 'lines linked to the products');
select t.ok((:'h3'::jsonb ->> 'saved')::int = 1, 'a receipt with empty tax and paid amounts is saved');
select t.ok((:'p1'::jsonb ->> 'saved')::int = 2, 'payments arrive');
select t.ok((:'b1'::jsonb ->> 'saved')::int = 3, 'monthly account balances arrive');
select t.ok((:'bc'::jsonb ->> 'saved')::int = 1 and (:'bc'::jsonb ->> 'skipped')::int = 2, 'valid barcodes are added, wrong ones skipped');
select t.ok(exists (select 1 from public.vendor_products vp join public.product_variants v on v.id = vp.variant_id where vp.company_id = :'co' and v.sku = '500' and vp.vendor_sku = 'CC-05'), 'the vendor''s code for the product');
select t.ok((select min_qty = 24 and max_qty = 96 from public.replenishment_rules r join public.product_variants v on v.id = r.variant_id where r.company_id = :'co' and v.sku = '500'), 'reorder levels per store');
select t.ok((:'ac'::jsonb ->> 'saved')::int = 2 and (:'ac'::jsonb ->> 'skipped')::int = 1
  and (select last_sold = '2026-10-20' and last_received = '2026-09-01' from public.v_product_stock where company_id = :'co' and sku = '500')
  and (select last_sold is null from public.v_product_stock where company_id = :'co' and sku = '501'), 'when an item last sold and arrived, from the old program');
select t.ok((select full_name = 'Blerim Krasniqi' and gender = 'male' from public.employees where company_id = :'co' and number = 'E-77'), 'employees arrive');
select t.ok((select hours_worked = 8.5 from public.attendance_records a join public.employees e on e.id = a.employee_id where e.company_id = :'co' and e.number = 'E-77'), 'and their attendance');
set role anon;
select t.throws(format($q$select public.sync_history(%L, 'documents', '[]')$q$, 'nxs_wrong'), 'Unknown or switched-off', 'a wrong key is refused');
reset role;

-- reading it back
set role authenticated;
select t.login('kafe@test.xk');
select public.history_documents_page(:'co', '{"kind":["pos_sale","sale"]}') as pg \gset
select t.ok((:'pg'::jsonb ->> 'total_count')::int = 2 and (:'pg'::jsonb -> 'rows' -> 1 ->> 'number') = 'K-1', 'the list filters by kind');
select t.ok(jsonb_array_length(public.history_document((:'pg'::jsonb -> 'rows' -> 1 ->> 'id')::uuid) -> 'lines') = 2, 'a document opens with its lines');
select t.ok((public.history_payments_page(:'co', '{}') ->> 'money_out')::numeric = 100, 'payments add up money in and out');
select t.ok((public.history_summary(:'co', '2026-01-01', '2026-12-31') -> 'by_month' -> 0 ->> 'sales')::numeric = 3.5, 'sales per month');
select public.history_live(:'co', '2026-01-05') as lv \gset
select t.ok((:'lv'::jsonb ->> 'today')::numeric = 2.5 and (:'lv'::jsonb ->> 'today_receipts')::int = 1 and (:'lv'::jsonb ->> 'month_purchases')::numeric = 100
  and (:'lv'::jsonb -> 'by_store' -> 0 ->> 'store') = 'Njesia 3', 'the dashboard reads today''s sales from the old program');
select t.ok((public.history_live(:'co', '2026-02-10') ->> 'month')::numeric = 0, 'a new month starts at zero');
select t.ok((select (a ->> 'opening')::numeric = 50 from jsonb_array_elements(public.history_balances(:'co', 2026) -> 'accounts') a where a ->> 'code' = '12000'), 'balances carry the opening of the year');
reset role;

-- price history: the old program's levellings, and a change made here
set role anon;
select public.sync_history(:'key', 'price_changes', '[
  {"ext_id":"N:LM2026:1","sku":"500","warehouse":"3","price_list":"Cm. Shitese_1","date":"2026-02-01","old_price":"1","new_price":"1.2","qty":"50","number":"NVL-1"},
  {"ext_id":"N:LM2026:1","sku":"500","warehouse":"3","price_list":"Cm. Shitese_1","date":"2026-02-01","old_price":"1","new_price":"1.2","qty":"50","number":"NVL-1"},
  {"ext_id":"N:LM2026:2","sku":"NOPE","date":"2026-02-01","new_price":"3"}]'::jsonb) as pc1 \gset
select public.sync_history(:'key', 'price_changes', '[{"ext_id":"N:LM2026:1","sku":"500","warehouse":"3","date":"2026-02-01","old_price":"1","new_price":"1.25","qty":"50","number":"NVL-1"}]'::jsonb) as pc2 \gset
reset role;
select t.ok((:'pc1'::jsonb ->> 'saved') = '1' and (:'pc1'::jsonb ->> 'skipped') = '2', 'a levelling is saved once, an unknown item is skipped');
select t.ok((select value_change from public.price_changes where company_id = :'co' and ext_id = 'N:LM2026:1') = 12.5, 'sent again it is updated, with the change in stock value');
select t.ok((select count(*) from public.price_changes where company_id = :'co' and source = 'manual') = 0, 'nothing logged by hand yet');
update public.products set sales_price = 9 where company_id = :'co' and id = (select product_id from public.product_variants where company_id = :'co' and sku = '500');
select t.ok(not exists (select 1 from public.price_changes where company_id = :'co' and source = 'manual'), 'on the live link a price change here is not logged (it comes as a levelling)');
update public.sync_connections set is_active = false where company_id = :'co';
update public.products set sales_price = 10 where company_id = :'co' and id = (select product_id from public.product_variants where company_id = :'co' and sku = '500');
select t.ok((select old_price = 9 and new_price = 10 from public.price_changes where company_id = :'co' and source = 'manual'), 'without the link a change of the selling price is kept');
update public.sync_connections set is_active = true where company_id = :'co';

-- product pictures: from the old program, and one put here by hand is kept
set role anon;
select public.sync_images(:'key', '[{"sku":"500","data":"/9j/4AAQSkZJRg==","ext_id":"I:1"},{"sku":"NOPE","data":"/9j/4AAQ"},{"sku":"501","data":"aGVsbG8="}]'::jsonb) as im1 \gset
reset role;
select t.ok((:'im1'::jsonb ->> 'saved') = '1' and (:'im1'::jsonb ->> 'skipped') = '2', 'a picture arrives; an unknown item and a file that is not a picture are skipped');
select t.ok((select image_path from public.products where id = (select product_id from public.product_variants where company_id = :'co' and sku = '500')) = 'db', 'the product knows it has a picture');
set role authenticated;
select t.login('zoe@platform.io');
select t.ok((public.product_images_get(:'co', array[(select product_id from public.product_variants where company_id = :'co' and sku = '500')]) ->> (select product_id::text from public.product_variants where company_id = :'co' and sku = '500')) like 'data:image/jpeg;base64,/9j/%', 'the picture is read as a data URL');
select public.product_image_set((select product_id from public.product_variants where company_id = :'co' and sku = '500'), 'data:image/png;base64,iVBORw0KGgo=');
select t.throws($$ select public.product_image_set((select product_id from public.product_variants where sku = '501' limit 1), 'aGVsbG8=') $$, 'Only JPEG', 'a file that is not a picture is refused');
reset role;
set role anon;
select public.sync_images(:'key', '[{"sku":"500","data":"/9j/4AAQSkZJRg==","ext_id":"I:1"}]'::jsonb) as im2 \gset
reset role;
select t.ok((select mime from public.product_images where product_id = (select product_id from public.product_variants where company_id = :'co' and sku = '500')) = 'image/png', 'a picture put here by hand is not replaced by the old program''s');
set role authenticated;
select t.login('zoe@platform.io');
select public.product_image_set((select product_id from public.product_variants where company_id = :'co' and sku = '500'), null);
reset role;
select t.ok((select image_path from public.products where id = (select product_id from public.product_variants where company_id = :'co' and sku = '500')) is null, 'removing the picture clears the flag');

-- work done without internet, sent later: each step once, documents made offline found by the step's id
set role anon;
select public.sync_push(:'key', jsonb_build_object('stock', '[{"warehouse":"3","sku":"500","qty":"10","cost":"0.4"}]'::jsonb));
reset role;
set role authenticated;
select t.login('zoe@platform.io');
select id as wh3 from public.warehouses where company_id = :'co' and code = '3' \gset
select id as loc3 from public.warehouse_locations where warehouse_id = :'wh3' order by created_at limit 1 \gset
select v.id as v500 from public.product_variants v where v.company_id = :'co' and v.sku = '500' \gset
select gen_random_uuid() as op1, gen_random_uuid() as op2, gen_random_uuid() as op3, gen_random_uuid() as op4 \gset
select public.create_cycle_count(:'wh3') as cnt \gset
select public.offline_call(:'op1', 'count_item', jsonb_build_object('p_count', :'cnt', 'p_variant', :'v500', 'p_location', :'loc3', 'p_qty', 2));
select public.offline_call(:'op1', 'count_item', jsonb_build_object('p_count', :'cnt', 'p_variant', :'v500', 'p_location', :'loc3', 'p_qty', 2));
select t.ok((select counted_qty from public.cycle_count_lines where cycle_count_id = :'cnt' and variant_id = :'v500' and location_id = :'loc3') = 2, 'a counted item sent twice counts once');
select public.offline_call(:'op2', 'save_document', jsonb_build_object('p_table', 'goods_receipts',
  'p_header', jsonb_build_object('company_id', :'co', 'warehouse_id', :'wh3', 'receipt_date', current_date),
  'p_children', jsonb_build_object('goods_receipt_lines', jsonb_build_array(jsonb_build_object('variant_id', :'v500', 'location_id', :'loc3', 'quantity', 5, 'unit_cost', 0.4))))) as gr_off \gset
select public.offline_call(:'op3', 'save_document', jsonb_build_object('p_table', 'goods_receipts',
  'p_header', jsonb_build_object('id', :'op2', 'company_id', :'co', 'warehouse_id', :'wh3', 'receipt_date', current_date, 'notes', 'nga pajisja'),
  'p_children', jsonb_build_object('goods_receipt_lines', jsonb_build_array(jsonb_build_object('variant_id', :'v500', 'location_id', :'loc3', 'quantity', 6, 'unit_cost', 0.4)))));
select t.ok((select notes = 'nga pajisja' from public.goods_receipts where id = (:'gr_off'::jsonb #>> '{}')::uuid)
            and (select quantity from public.goods_receipt_lines where receipt_id = (:'gr_off'::jsonb #>> '{}')::uuid) = 6,
  'saving it again with the device''s id changes the same receipt');
select public.offline_call(:'op4', 'post_goods_receipt', jsonb_build_object('p_id', :'op2'));
select public.offline_call(:'op4', 'post_goods_receipt', jsonb_build_object('p_id', :'op2'));
select t.ok((select status from public.goods_receipts where id = (:'gr_off'::jsonb #>> '{}')::uuid) = 'done', 'and posting it, once');
select t.throws($$ select public.offline_call(gen_random_uuid(), 'platform_delete_client', '{}') $$, 'cannot be done without internet', 'only the steps meant for offline can wait');
select t.ok(jsonb_array_length(public.scan_catalog(:'co') -> 'items') >= 2, 'the device gets the items to recognise scans offline');
reset role;

-- licence codes: the program activates with it; a local server checks it every night and applies it
set role authenticated;
select t.login('zoe@platform.io');
select public.platform_licence_info(:'co') ->> 'code' as lcode \gset
select t.ok(:'lcode' ~ '^NXS(-[A-Z2-9]{4}){3}$' and public.platform_licence_info(:'co') ->> 'code' = :'lcode', 'a client''s licence gets a code, the same every time');
reset role;
set role anon;
select t.ok(public.licence_activate(lower(:'lcode')) -> 'company' ->> 'name' = 'Kafe Test', 'the program learns whose licence the code is');
select t.throws($$ select public.licence_activate('NXS-AAAA-BBBB-CCCC') $$, 'not known', 'an unknown code is refused');
select gen_random_uuid() as srv1, gen_random_uuid() as srv2 \gset
select public.licence_check(:'lcode', :'srv1', 'http://192.168.1.20', '1.0') as lic \gset
select t.ok((:'lic'::jsonb ->> 'plan') is not null and (:'lic'::jsonb ->> 'status') = 'active', 'the local server gets its licence');
select t.throws(format($q$select public.licence_check(%L, %L)$q$, :'lcode', :'srv2'), 'another server', 'a second server cannot use the same code');
reset role;
select app.apply_licence(jsonb_set(jsonb_set(:'lic'::jsonb, '{code}', '"NXS-LOCA-LTES-T234"'), '{plan}', '"basic"'), 'zoe@platform.io') as local_co \gset
select app.apply_licence(jsonb_set(:'lic'::jsonb, '{code}', '"NXS-LOCA-LTES-T234"'), 'zoe@platform.io') as local_co2 \gset
select t.ok(:'local_co' = :'local_co2' and (select plan from public.licenses where company_id = :'local_co') = (:'lic'::jsonb ->> 'plan')
            and (select name from public.companies where id = :'local_co') = 'Kafe Test', 'on the local server the company is made once and follows the licence');
set role authenticated;
select t.login('zoe@platform.io');
select t.ok((public.platform_licence_info(:'co', 'local', true) ->> 'local_server')::boolean = false, 'the platform owner can free the code for another server');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
