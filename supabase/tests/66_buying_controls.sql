-- =============================================================================
-- DrisPRO · buying controls: the vendor's confirmation, late orders, ordering the rest again,
-- a price rise waiting for a manager, the vendors' scorecard, offers from several vendors
-- (runs after 01–65)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
insert into auth.users (email, raw_user_meta_data) values ('blerta@buy.al', '{"full_name":"Blerta Blerëse"}'), ('mira@buy.al', '{"full_name":"Mira Menaxhere"}'),
  ('fatos@buy.al', '{"full_name":"Fatos Financa"}') on conflict do nothing;

select email as boss from public.profiles where is_super_admin limit 1 \gset
set role authenticated;
select t.login(:'boss');
select public.create_company('Furnizimi Test', 'XK') as co \gset
select public.invite_member(:'co', 'blerta@buy.al', array['procurement_manager']);
select public.invite_member(:'co', 'mira@buy.al', array['procurement_manager']);
select public.invite_member(:'co', 'fatos@buy.al', array['accountant']);
select t.accept_invites();
select t.login(:'boss');
select id as pcs from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select id as wh from public.warehouses where company_id = :'co' order by created_at limit 1 \gset
select default_purchase_tax_code_id as vat from public.company_settings where company_id = :'co' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'B-MIL', 'name', 'Miell 1kg', 'uom_id', :'pcs', 'sales_price', 1)) as p \gset
select id as flour from public.product_variants where product_id = :'p' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'B-VAJ', 'name', 'Vaj 1L', 'uom_id', :'pcs', 'sales_price', 2.5)) as p \gset
select id as oil from public.product_variants where product_id = :'p' \gset
insert into public.business_partners (company_id, code, name, is_vendor) values (:'co', 'F-1', 'Mulliri Sh.p.k.', true) returning id as v1 \gset
insert into public.business_partners (company_id, code, name, is_vendor) values (:'co', 'F-2', 'Agro Import', true) returning id as v2 \gset
insert into public.business_partners (company_id, code, name, is_vendor) values (:'co', 'F-3', 'Distributori', true) returning id as v3 \gset
select m.user_id as blerta from public.company_members m join public.profiles p on p.id = m.user_id where m.company_id = :'co' and p.email = 'blerta@buy.al' \gset

-- ----------------------------------------------------------------------------- 1. following an order
insert into public.purchase_orders (company_id, vendor_id, warehouse_id, expected_date, buyer_id) values (:'co', :'v1', :'wh', current_date + 5, :'blerta') returning id as po \gset
insert into public.purchase_order_lines (company_id, purchase_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
values (:'co', :'po', 1, :'flour', 'Miell', 100, 0.6, :'vat'), (:'co', :'po', 2, :'oil', 'Vaj', 40, 1.5, :'vat');
select public.submit_purchase_order(:'po');
select t.login('blerta@buy.al');
select t.throws(format($q$select public.po_confirm('%s', current_date - 10)$q$, :'po'), 'before the order date', 'a promised date before the order is refused');
select public.po_confirm(:'po', current_date + 7, 'MUL-4471');
select t.ok((select status = 'sent' and promised_date = current_date + 7 and vendor_reference = 'MUL-4471' and confirmed_by = :'blerta'::uuid
               from public.purchase_orders where id = :'po'), 'the vendor''s confirmation: sent, the promised date and their number');

-- the automatic tasks: unconfirmed after 2 days, late by a day
reset role;
update public.company_settings set task_automations = '{"po_confirm": {"on": true}, "late_po": {"on": true}}' where company_id = :'co';
insert into public.purchase_orders (company_id, vendor_id, warehouse_id, expected_date, buyer_id) values (:'co', :'v2', :'wh', current_date + 3, :'blerta') returning id as po2 \gset
insert into public.purchase_order_lines (company_id, purchase_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
values (:'co', :'po2', 1, :'oil', 'Vaj', 20, 1.6, :'vat');
set role authenticated;
select t.login(:'boss');
select public.submit_purchase_order(:'po2');
reset role;
update public.purchase_orders set approved_at = now() - interval '3 days' where id = :'po2';
update public.purchase_orders set promised_date = current_date - 2 where id = :'po';
select app.tasks_run(:'co') as made \gset
select t.ok((select assignee_id = :'blerta'::uuid from public.tasks where company_id = :'co' and auto_key = 'po_confirm:' || :'po2'), 'an order not confirmed in 2 days: the buyer asks for it');
select t.ok((select title like 'Telefono Mulliri%vonon%' and assignee_id = :'blerta'::uuid from public.tasks where company_id = :'co' and auto_key = 'late_po:' || :'po'),
  'a late order: the buyer calls the vendor');
select t.ok(not exists (select 1 from public.tasks where company_id = :'co' and auto_key = 'late_po:' || :'po2'), 'an order not yet due is not late');
set role authenticated;
select t.login('blerta@buy.al');
select public.po_confirm(:'po2', current_date + 3);
select t.ok((select status = 'done' from public.tasks where company_id = :'co' and auto_key = 'po_confirm:' || :'po2'), 'the confirmation closes its task');

-- part of the order came; the rest is ordered again from another vendor
select t.login(:'boss');
select public.create_receipt_from_po(:'po') as gr \gset
update public.goods_receipt_lines set quantity = 60 where receipt_id = :'gr' and variant_id = :'flour';
delete from public.goods_receipt_lines where receipt_id = :'gr' and variant_id = :'oil';
select public.post_goods_receipt(:'gr');
select t.login('blerta@buy.al');
select public.po_order_rest(:'po', :'v2') as po3 \gset
select t.ok((select vendor_id = :'v2'::uuid and follows_id = :'po'::uuid and status = 'draft' from public.purchase_orders where id = :'po3'), 'a new draft order from the other vendor');
select t.ok((select array_agg((variant_id, quantity)::text order by line_no) = array[(:'flour', 40.0000)::text, (:'oil', 40.0000)::text]
               from public.purchase_order_lines where purchase_order_id = :'po3'), 'for what did not come: 40 flour, 40 oil');
select t.ok((select status from public.purchase_orders where id = :'po') = 'closed', 'the old order stops waiting');
select t.ok((select status = 'done' from public.tasks where company_id = :'co' and auto_key = 'late_po:' || :'po'), 'and its late task is done');
select public.po_order_rest(:'po2') as po4 \gset
select t.ok((select status = 'cancelled' and cancel_reason like 'Ordered again in%' from public.purchase_orders where id = :'po2')
  and (select unit_price = 1.6 and quantity = 20 from public.purchase_order_lines where purchase_order_id = :'po4'), 'nothing came: cancelled, the same order again at the same price');
select t.throws(format($q$select public.po_order_rest('%s')$q$, :'po'), 'only an order still waiting', 'a closed order is not ordered again');

-- ----------------------------------------------------------------------------- 2. a price rise
select t.login(:'boss');
insert into public.vendor_bills (company_id, vendor_id, vendor_invoice_number, bill_date) values (:'co', :'v3', 'D-100', current_date - 20) returning id as b1 \gset
insert into public.vendor_bill_lines (company_id, bill_id, line_no, variant_id, description, quantity, unit_price, tax_code_id) values (:'co', :'b1', 1, :'oil', 'Vaj', 10, 1.50, :'vat');
select public.post_vendor_bill(:'b1');
insert into public.vendor_bills (company_id, vendor_id, vendor_invoice_number, bill_date) values (:'co', :'v3', 'D-101', current_date) returning id as b2 \gset
insert into public.vendor_bill_lines (company_id, bill_id, line_no, variant_id, description, quantity, unit_price, tax_code_id) values
  (:'co', :'b2', 1, :'oil', 'Vaj', 10, 1.65, :'vat'), (:'co', :'b2', 2, :'flour', 'Miell', 10, 0.7, :'vat');
select t.login('fatos@buy.al');
select public.bill_price_check(:'b2') as chk \gset
select t.ok(jsonb_array_length(:'chk'::jsonb -> 'rises') = 1 and (:'chk'::jsonb -> 'rises' -> 0 ->> 'pct')::numeric = 10
  and (:'chk'::jsonb -> 'rises' -> 0 ->> 'before')::numeric = 1.5 and (:'chk'::jsonb -> 'rises' -> 0 ->> 'ref_number') is not null,
  'oil went up 10% from the last bill; flour has nothing to compare with');
select t.throws(format($q$select public.post_vendor_bill('%s')$q$, :'b2'), 'Prices went up', 'the bill waits for a manager');
select t.ok(public.bill_ask_price_ok(:'b2') >= 1, 'the managers are asked');
select t.throws(format($q$select public.bill_accept_prices('%s', 'Rritje e tregut')$q$, :'b2'), 'Only a procurement or finance manager', 'the accountant cannot accept it');
select t.login('mira@buy.al');
select t.ok(exists (select 1 from public.notifications where user_id = auth.uid() and title like 'Prices went up: Distributori%'), 'the procurement manager was told');
select t.throws(format($q$select public.bill_accept_prices('%s', 'ok')$q$, :'b2'), 'Write why', 'a reason is needed');
select public.bill_accept_prices(:'b2', 'Rritje e çmimit të vajit në treg, konfirmuar me email');
select t.login('fatos@buy.al');
select t.ok((public.post_vendor_bill(:'b2') ->> 'status') = 'posted', 'once accepted it is posted');
select t.ok((select price_ok_reason like 'Rritje%' and price_ok_by is not null from public.vendor_bills where id = :'b2'), 'with who accepted it and why');
select t.login('mira@buy.al');
select public.automation_settings_save(:'co', '{"purchase_price_tolerance": 1}');
select t.login('fatos@buy.al');
select t.throws(format($q$select public.automation_settings_save('%s', '{"purchase_price_tolerance": 20}')$q$, :'co'), 'procurement.approve', 'only the procurement manager sets the tolerance');
-- within the tolerance nothing waits
select t.login(:'boss');
insert into public.vendor_bills (company_id, vendor_id, vendor_invoice_number, bill_date) values (:'co', :'v3', 'D-102', current_date) returning id as b3 \gset
insert into public.vendor_bill_lines (company_id, bill_id, line_no, variant_id, description, quantity, unit_price, tax_code_id) values (:'co', :'b3', 1, :'oil', 'Vaj', 10, 1.66, :'vat');
select t.ok((public.post_vendor_bill(:'b3') ->> 'status') = 'posted', 'under 1% above the last price is not a rise');

-- ----------------------------------------------------------------------------- 3. the scorecard
select t.login('mira@buy.al');
select public.vendor_scorecard(:'co', current_date - 30, current_date) as sc \gset
select t.ok((select (x ->> 'orders')::int = 1 and (x ->> 'fill_pct')::numeric = round(100.0 * 60 / 140, 1) and (x ->> 'on_time_pct')::numeric = 0
               from jsonb_array_elements(:'sc'::jsonb -> 'vendors') x where (x ->> 'vendor_id')::uuid = :'v1'), 'the mill: one order, 60 of 140 came, late');
select t.ok((select (x ->> 'price_rises')::int = 1 and (x ->> 'spend')::numeric > 0 from jsonb_array_elements(:'sc'::jsonb -> 'vendors') x where (x ->> 'vendor_id')::uuid = :'v3'),
  'the distributor: what we spent and the price rise accepted');
select t.ok(:'sc'::jsonb ? 'single_source' and :'sc'::jsonb ? 'abc_ready', 'with the main items that have one vendor');

-- ----------------------------------------------------------------------------- 4. offers from several vendors
select t.login('blerta@buy.al');
select public.rfq_save(jsonb_build_object('company_id', :'co', 'title', 'Miell për dhjetor', 'warehouse_id', :'wh', 'needed_by', current_date + 14,
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'flour', 'quantity', 500), jsonb_build_object('variant_id', :'oil', 'quantity', 200)),
  'vendors', jsonb_build_array(:'v1'))) as rfq \gset
select t.ok((select number like 'KO-%' and status = 'draft' from public.purchase_rfqs where id = :'rfq'), 'a request for offers with its own number');
select t.throws(format($q$select public.rfq_send('%s')$q$, :'rfq'), 'at least two vendors', 'two vendors at least, to compare');
select public.rfq_save(jsonb_build_object('id', :'rfq', 'title', 'Miell për dhjetor', 'vendors', jsonb_build_array(:'v1', :'v2', :'v3')));
select public.rfq_send(:'rfq');
select id as l1 from public.purchase_rfq_lines where rfq_id = :'rfq' and line_no = 1 \gset
select id as l2 from public.purchase_rfq_lines where rfq_id = :'rfq' and line_no = 2 \gset
select id as o1 from public.purchase_rfq_vendors where rfq_id = :'rfq' and vendor_id = :'v1' \gset
select id as o2 from public.purchase_rfq_vendors where rfq_id = :'rfq' and vendor_id = :'v2' \gset
select id as o3 from public.purchase_rfq_vendors where rfq_id = :'rfq' and vendor_id = :'v3' \gset
select public.rfq_offer_save(:'o1', jsonb_build_object('delivery_days', 3, 'payment_days', 30, 'prices', jsonb_build_array(
  jsonb_build_object('line_id', :'l1', 'unit_price', 0.60), jsonb_build_object('line_id', :'l2', 'unit_price', 1.70))));
select public.rfq_offer_save(:'o2', jsonb_build_object('delivery_days', 7, 'payment_days', 15, 'prices', jsonb_build_array(
  jsonb_build_object('line_id', :'l1', 'unit_price', 0.62, 'discount_pct', 5), jsonb_build_object('line_id', :'l2', 'unit_price', 1.55))));
select public.rfq_offer_save(:'o3', '{"declined": true, "notes": "Nuk kemi miell"}');
select public.rfq_get(:'rfq') as cmp \gset
select t.ok((select (l ->> 'best')::numeric = 0.589 from jsonb_array_elements(:'cmp'::jsonb -> 'lines') l where (l ->> 'id')::uuid = :'l1'), 'the best flour: 0.62 less 5% = 0.589');
select t.ok((select (v ->> 'total_base')::numeric = round(500 * 0.589 + 200 * 1.55, 2) and (v ->> 'best_lines')::int = 2
               from jsonb_array_elements(:'cmp'::jsonb -> 'vendors') v where (v ->> 'vendor_id')::uuid = :'v2'), 'Agro Import is best on both items');
select t.ok((select v ->> 'status' from jsonb_array_elements(:'cmp'::jsonb -> 'vendors') v where (v ->> 'vendor_id')::uuid = :'v3') = 'declined', 'the distributor declined');
select t.throws(format($q$select public.rfq_decide('%s', '%s')$q$, :'rfq', :'v3'), 'has not made an offer', 'a vendor without an offer cannot win');
-- everything from the mill (quicker), at its offered prices
select public.rfq_decide(:'rfq', :'v1', 'Dërgesë më e shpejtë') as dec \gset
select (:'dec'::jsonb -> 0 ->> 'id') as po5 \gset
select t.ok((select vendor_id = :'v1'::uuid and status = 'draft' and expected_date = current_date + 14 from public.purchase_orders where id = :'po5'::uuid)
  and (select array_agg(unit_price order by line_no) = array[0.6000, 1.7000]::numeric[] from public.purchase_order_lines where purchase_order_id = :'po5'::uuid),
  'one draft order from the chosen vendor at the offered prices');
select t.ok((select string_agg(status, ',' order by vendor_id = :'v1' desc, vendor_id = :'v2' desc) from public.purchase_rfq_vendors where rfq_id = :'rfq') = 'won,lost,declined',
  'won, lost, declined');
select t.ok((select price from public.vendor_products where vendor_id = :'v1' and variant_id = :'oil' and deleted_at is null) = 1.7, 'the offered price is now the vendor''s price');
select t.throws(format($q$select public.rfq_decide('%s')$q$, :'rfq'), 'Only a sent request', 'a request is decided once');

-- each item from the vendor with the best price
select public.rfq_save(jsonb_build_object('company_id', :'co', 'title', 'Vaj dhe miell', 'warehouse_id', :'wh',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'flour', 'quantity', 100), jsonb_build_object('variant_id', :'oil', 'quantity', 50)),
  'vendors', jsonb_build_array(:'v1', :'v2'))) as rfq2 \gset
select public.rfq_send(:'rfq2');
select id as m1 from public.purchase_rfq_lines where rfq_id = :'rfq2' and line_no = 1 \gset
select id as m2 from public.purchase_rfq_lines where rfq_id = :'rfq2' and line_no = 2 \gset
select public.rfq_offer_save((select id from public.purchase_rfq_vendors where rfq_id = :'rfq2' and vendor_id = :'v1'), jsonb_build_object('prices', jsonb_build_array(
  jsonb_build_object('line_id', :'m1', 'unit_price', 0.55), jsonb_build_object('line_id', :'m2', 'unit_price', 1.80))));
select public.rfq_offer_save((select id from public.purchase_rfq_vendors where rfq_id = :'rfq2' and vendor_id = :'v2'), jsonb_build_object('prices', jsonb_build_array(
  jsonb_build_object('line_id', :'m1', 'unit_price', 0.65), jsonb_build_object('line_id', :'m2', 'unit_price', 1.50))));
select public.rfq_decide(:'rfq2', null, null, false) as dec2 \gset
select t.ok(jsonb_array_length(:'dec2'::jsonb) = 2, 'two orders: each item where it is cheapest');
select t.ok((select string_agg(bp.name || ':' || l.description, ',' order by bp.name) from public.purchase_orders o join public.business_partners bp on bp.id = o.vendor_id
               join public.purchase_order_lines l on l.purchase_order_id = o.id where o.id in (select (x ->> 'id')::uuid from jsonb_array_elements(:'dec2'::jsonb) x))
  = 'Agro Import:Vaj 1L,Mulliri Sh.p.k.:Miell 1kg', 'flour from the mill, oil from Agro Import');
select t.ok(jsonb_array_length(public.rfq_list(:'co')) = 2, 'the list of requests');
select t.throws(format($q$insert into public.purchase_rfqs (company_id, title, warehouse_id) values ('%s', 'x', '%s')$q$, :'co', :'wh'), 'row-level security',
  'requests are written only through their functions');

reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
