-- =============================================================================
-- DrisPRO · Phase 4 procurement tests (runs after 01–03; reuses t.ok / t.throws / t.login)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

insert into auth.users (email, raw_user_meta_data) values
  ('pam@buy.al',  '{"full_name":"Pam Procurement"}'),
  ('ian@buy.al',  '{"full_name":"Ian Inventory"}'),
  ('wes@buy.al',  '{"full_name":"Wes Warehouse"}'),
  ('finn@buy.al', '{"full_name":"Finn Accountant"}');

set role authenticated;
select t.login('alice@alba.al');
select public.create_company('Blerje Test', 'AL') as co \gset
select public.invite_member(:'co', 'pam@buy.al',  array['procurement_manager']);
select public.invite_member(:'co', 'ian@buy.al',  array['inventory_manager']);
select public.invite_member(:'co', 'wes@buy.al',  array['warehouse_operator']);
select public.invite_member(:'co', 'finn@buy.al', array['accountant']);

select id as pcs   from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select id as vat20 from public.tax_codes where company_id = :'co' and code = 'VAT20' \gset
select id as wh    from public.warehouses where company_id = :'co' and code = 'WH' \gset
select id as net30 from public.payment_terms where company_id = :'co' and code = 'NET30' \gset
insert into public.exchange_rates (company_id, currency_code, rate_date, rate) values (:'co', 'EUR', current_date - 30, 100);

select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'COF', 'name', 'Coffee beans 1 kg', 'uom_id', :'pcs',
       'sales_price', 3000, 'sales_tax_code_id', :'vat20', 'purchase_tax_code_id', :'vat20')) as p_cof \gset
select id as cof from public.product_variants where product_id = :'p_cof' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'CUP', 'name', 'Paper cups (100)', 'uom_id', :'pcs',
       'sales_price', 400, 'sales_tax_code_id', :'vat20', 'purchase_tax_code_id', :'vat20')) as p_cup \gset
select id as cup from public.product_variants where product_id = :'p_cup' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'FIX', 'name', 'Machine service', 'uom_id', :'pcs',
       'product_type', 'service', 'purchase_tax_code_id', :'vat20')) as p_fix \gset
select id as fix from public.product_variants where product_id = :'p_fix' \gset

insert into public.business_partners (company_id, code, name, is_vendor, payment_term_id) values (:'co', 'V-A', 'Kafe Shqip', true, :'net30') returning id as va \gset
insert into public.business_partners (company_id, code, name, is_vendor, currency_code) values (:'co', 'V-B', 'Torrefazione Roma', true, 'EUR') returning id as vb \gset
insert into public.business_partners (company_id, code, name, is_vendor, is_active) values (:'co', 'V-X', 'Old supplier', true, false) returning id as vx \gset

-- ---------- vendor pricing -------------------------------------------------------
select t.login('pam@buy.al');
insert into public.vendor_products (company_id, vendor_id, variant_id, vendor_sku, price, currency_code, min_order_qty, lead_time_days, is_preferred)
values (:'co', :'va', :'cof', 'KS-1000', 900, 'ALL', 12, 5, true), (:'co', :'vb', :'cof', 'TR-ARABICA', 8, 'EUR', 50, 20, false);
select t.ok((select (unit_price, currency_code, source, min_order_qty, lead_time_days) = (900, 'ALL', 'vendor_price', 12, 5)
               from public.get_purchase_price(:'co', :'va', :'cof')), 'vendor price list applies');
select t.ok((select (unit_price, source) = (800, 'vendor_price') from public.get_purchase_price(:'co', :'vb', :'cof', 1, 'ALL')),
            'vendor price converted EUR → ALL at the company rate');
select t.ok((select (unit_price, currency_code) = (8, 'EUR') from public.get_purchase_price(:'co', :'vb', :'cof')), 'vendor currency is the default');
select t.ok((select source from public.get_purchase_price(:'co', :'va', :'cup')) = 'standard_cost', 'no price yet: falls back to cost');

-- ---------- requisitions -----------------------------------------------------------
select t.login('ian@buy.al');
insert into public.purchase_requisitions (company_id, warehouse_id, required_date, justification)
values (:'co', :'wh', current_date + 10, 'Café reopening') returning id as req, number as req_no \gset
insert into public.purchase_requisition_lines (company_id, requisition_id, variant_id, description, quantity, estimated_unit_cost) values
  (:'co', :'req', :'cof', 'Coffee beans', 24, 950), (:'co', :'req', :'cup', 'Cups', 10, 200);
select t.ok(:'req_no' like 'PR-2026-%', 'requisitions are numbered');
select t.ok((select estimated_total from public.purchase_requisitions where id = :'req') = 24800, 'requisition estimate totalled');
select t.throws(format($q$update public.purchase_requisitions set status = 'approved' where id = %L$q$, :'req'), 'set by its own action',
                'a requester cannot approve by editing the status');
select t.ok(public.submit_requisition(:'req') = 'submitted', 'requisition submitted');
select t.throws(format($q$update public.purchase_requisition_lines set quantity = 99 where requisition_id = %L$q$, :'req'), 'cannot be modified',
                'submitted requisitions are frozen');
select t.throws(format($q$select public.decide_requisition(%L, 'approved')$q$, :'req'), 'permission denied', 'requesters cannot decide');

select t.login('pam@buy.al');
select t.ok(exists (select 1 from public.notifications where title like 'Requisition % needs a decision'), 'procurement notified');
select t.throws(format($q$select public.decide_requisition(%L, 'rejected')$q$, :'req'), 'reason', 'rejections need a reason');
select public.decide_requisition(:'req', 'rejected', 'Split coffee and cups');
select t.ok((select (status, rejection_reason) = ('rejected', 'Split coffee and cups') from public.purchase_requisitions where id = :'req'), 'rejected with reason');
select t.login('ian@buy.al');
update public.purchase_requisitions set status = 'draft' where id = :'req';
select public.submit_requisition(:'req');
select t.login('pam@buy.al');
select public.decide_requisition(:'req', 'approved');
select t.ok((select (status, decided_by is not null, approved_at is not null) = ('approved', true, true)
               from public.purchase_requisitions where id = :'req'), 'approved, with who and when');
select t.throws(format($q$select public.create_po_from_requisition(%L)$q$, :'req'), 'Choose a vendor for: Cups', 'lines need a vendor');
select public.create_po_from_requisition(:'req', :'va') as conv \gset
select (:'conv'::jsonb -> 'orders' ->> 0) as po1 \gset
select t.ok(jsonb_array_length(:'conv'::jsonb -> 'orders') = 1, 'one order per vendor');
select t.ok((select status from public.purchase_requisitions where id = :'req') = 'ordered', 'requisition marked ordered');
select t.ok((select (count(*), count(requisition_line_id)) = (2::bigint, 2::bigint) from public.purchase_order_lines where purchase_order_id = :'po1'),
            'order lines keep their requisition line');
select t.ok((select unit_price from public.purchase_order_lines where purchase_order_id = :'po1' and variant_id = :'cof') = 900
         and (select unit_price from public.purchase_order_lines where purchase_order_id = :'po1' and variant_id = :'cup') = 200,
            'priced from the vendor list, else the requisition estimate');
select t.ok((select (expected_date, buyer_id is not null, payment_term_id) = (current_date + 10, true, :'net30'::uuid)
               from public.purchase_orders where id = :'po1'), 'expected date, buyer and vendor terms filled in');
select t.throws(format($q$select public.create_po_from_requisition(%L, %L)$q$, :'req', :'va'), 'Only approved', 'a requisition is ordered once');

insert into public.purchase_requisitions (company_id, warehouse_id) values (:'co', :'wh') returning id as req2 \gset
insert into public.purchase_requisition_lines (company_id, requisition_id, description, quantity) values (:'co', :'req2', 'Office chairs', 2);
select public.submit_requisition(:'req2');
select t.throws(format($q$select public.decide_requisition(%L, 'approved')$q$, :'req2'), 'own requisition', 'no self-approval of requisitions');

-- ---------- purchase order approval ---------------------------------------------------
select t.login('alice@alba.al');
insert into public.approval_workflows (company_id, name, doc_type, min_amount) values (:'co', 'POs over 100k', 'purchase_order', 100000) returning id as wf \gset
insert into public.approval_workflow_steps (company_id, workflow_id, step_order, name, approver_role_id)
select :'co', :'wf', 1, 'Owner', id from public.roles where key = 'company_admin';

select t.login('pam@buy.al');
select t.ok((select total from public.purchase_orders where id = :'po1') = 28320, 'PO totals: 24×900 + 10×200, +20% VAT');
select t.throws(format($q$update public.purchase_orders set status = 'approved' where id = %L$q$, :'po1'), 'set by its own action',
                'orders cannot skip approval');
select t.ok(public.submit_purchase_order(:'po1') = 'approved', 'small order approved directly');
select t.ok((select approved_at is not null from public.purchase_orders where id = :'po1'), 'approval time recorded');

insert into public.purchase_orders (company_id, vendor_id, warehouse_id) values (:'co', :'vb', :'wh') returning id as po2, currency_code as po2_cur, exchange_rate as po2_rate \gset
select t.ok(:'po2_cur' = 'EUR' and :'po2_rate'::numeric = 100, 'vendor currency and current rate used');
insert into public.purchase_order_lines (company_id, purchase_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
values (:'co', :'po2', 1, :'cof', 'Arabica', 200, 8, :'vat20');
select t.ok(public.submit_purchase_order(:'po2') = 'pending_approval', 'large order waits for approval (base 192,000)');
select t.login('alice@alba.al');
select public.decide_approval((select id from public.approval_requests where document_id = :'po2'), 'approved');
select t.ok((select status from public.purchase_orders where id = :'po2') = 'approved', 'approver releases the order');

select t.login('pam@buy.al');
insert into public.purchase_orders (company_id, vendor_id, warehouse_id) values (:'co', :'vx', :'wh') returning id as pox \gset
insert into public.purchase_order_lines (company_id, purchase_order_id, line_no, variant_id, description, quantity, unit_price) values (:'co', :'pox', 1, :'cup', 'Cups', 5, 100);
select t.throws(format($q$select public.submit_purchase_order(%L)$q$, :'pox'), 'inactive', 'inactive vendors cannot be ordered from');
delete from public.purchase_orders where id = :'pox';

-- ---------- receiving ---------------------------------------------------------------
select t.login('wes@buy.al');
select public.create_receipt_from_po(:'po1') as gr1 \gset
select t.ok((select count(*) from public.goods_receipt_lines where receipt_id = :'gr1') = 2, 'receipt pre-filled with the open lines');
update public.goods_receipt_lines set quantity = 20 where receipt_id = :'gr1' and variant_id = :'cof';
select public.post_goods_receipt(:'gr1');
select t.ok((select status from public.purchase_orders where id = :'po1') = 'partially_received', 'partial receipt');
select public.create_receipt_from_po(:'po1') as gr2 \gset
select t.ok((select (count(*), sum(quantity)) = (1::bigint, 4.0000) from public.goods_receipt_lines where receipt_id = :'gr2'), 'only the 4 still due');
select t.throws(format($q$select public.create_receipt_from_po(%L)$q$, :'po1'), 'Nothing left to receive', 'draft receipts hold their quantities');
select public.post_goods_receipt(:'gr2');
select t.ok((select status from public.purchase_orders where id = :'po1') = 'received', 'fully received');
select t.login('pam@buy.al');
select t.throws(format($q$update public.purchase_orders set status = 'cancelled' where id = %L$q$, :'po1'), 'Invalid status transition', 'received orders cannot be cancelled');
select t.login('wes@buy.al');
select public.create_receipt_from_po(:'po2') as gr3 \gset
update public.goods_receipt_lines set quantity = 150 where receipt_id = :'gr3';
select public.post_goods_receipt(:'gr3');
select t.ok((select unit_cost from public.goods_receipt_lines where receipt_id = :'gr3') = 800, 'EUR receipt valued in ALL (8 × 100)');

-- ---------- vendor bills: three-way match ------------------------------------------------
select t.login('finn@buy.al');
select public.create_bill_from_po(:'po1', 'F-778') as b1 \gset
select t.ok((select (number like 'BILL-2026-%', due_date) = (true, current_date + 30) from public.vendor_bills where id = :'b1'),
            'bill numbered, due date from vendor terms');
select t.ok((select count(*) from public.vendor_bill_lines where bill_id = :'b1' and receipt_line_id is not null) = 2, 'bill lines linked to receipts');
select t.ok(public.match_vendor_bill(:'b1') ->> 'status' = 'matched', 'bill matches order and receipt');
select t.throws(format($q$insert into public.vendor_bills (company_id, vendor_id, vendor_invoice_number) values (%L, %L, ' f-778 ')$q$, :'co', :'va'),
                'already entered as BILL', 'duplicate vendor invoice numbers blocked (case and spaces ignored)');
select t.throws(format($q$select public.create_bill_from_po(%L, 'F-779')$q$, :'po1'), 'Nothing to bill', 'draft bills hold their quantities');

update public.vendor_bill_lines set unit_price = 950 where bill_id = :'b1' and variant_id = :'cof';
select public.match_vendor_bill(:'b1') as m1 \gset
select t.ok(:'m1'::jsonb ->> 'status' = 'exception'
        and (select (match_status, price_variance) = ('price_variance', 50.0000) from public.vendor_bill_lines where bill_id = :'b1' and variant_id = :'cof'),
            'price 5.6% above the order flagged');
select t.throws(format($q$select public.post_vendor_bill(%L)$q$, :'b1'), 'does not match', 'exceptions block posting');
select t.throws(format($q$select public.post_vendor_bill(%L, 'Vendor price rise')$q$, :'b1'), 'Only a procurement or finance manager',
                'accountants cannot override a mismatch');
update public.vendor_bill_lines set unit_price = 910 where bill_id = :'b1' and variant_id = :'cof';
select t.ok(public.match_vendor_bill(:'b1') ->> 'status' = 'matched', 'within the 2% price tolerance');
select public.post_vendor_bill(:'b1') as post1 \gset
select t.ok((:'post1'::jsonb ->> 'capitalized_variance')::numeric = 240, 'price difference (24 × 10) added to stock value');
select t.ok((select avg_cost from public.item_costs where variant_id = :'cof') = round((24 * 910 + 150 * 800)::numeric / 174, 6),
            'average cost reflects the billed price');
select t.ok((select (status, billing_status) = ('closed', 'billed') from public.purchase_orders where id = :'po1'), 'received + billed order closes');
select t.ok((select qty_billed from public.purchase_order_lines where purchase_order_id = :'po1' and variant_id = :'cof') = 24, 'billed quantity tracked');

select public.create_bill_from_po(:'po2', 'TR-2026-0091') as b2 \gset
select t.ok((select (currency_code, exchange_rate, quantity) = ('EUR', 100.00000000, 150.0000)
               from public.vendor_bills b join public.vendor_bill_lines l on l.bill_id = b.id where b.id = :'b2'), 'EUR bill for the received 150');
select t.throws(format($q$update public.vendor_bills set status = 'posted' where id = %L$q$, :'b2'), 'set by its own action', 'bills post only through posting');
update public.vendor_bill_lines set quantity = 200 where bill_id = :'b2';
select t.ok((select (m -> 'lines' -> 0 ->> 'status', (m -> 'lines' -> 0 ->> 'qty_variance')::numeric) = ('qty_variance', 50)
               from public.match_vendor_bill(:'b2') m), 'billing 50 more than received flagged');
select t.login('alice@alba.al');
select t.throws(format($q$select public.post_vendor_bill(%L, '  ')$q$, :'b2'), 'does not match', 'an override needs a real reason');
select public.post_vendor_bill(:'b2', 'Balance shipped, arriving Monday');
select t.ok((select (match_status, match_override_by is not null) = ('overridden', true) from public.vendor_bills where id = :'b2'), 'override recorded with who');
select t.ok((select (status, billing_status) = ('partially_received', 'billed') from public.purchase_orders where id = :'po2'), 'order still waits for goods');

-- services are billed on the ordered quantity; goods need a receipt
select t.login('pam@buy.al');
insert into public.purchase_orders (company_id, vendor_id, warehouse_id) values (:'co', :'va', :'wh') returning id as po3 \gset
insert into public.purchase_order_lines (company_id, purchase_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id) values
  (:'co', :'po3', 1, :'fix', 'Grinder service', 1, 5000, :'vat20'), (:'co', :'po3', 2, :'cup', 'Cups', 10, 180, :'vat20');
select public.submit_purchase_order(:'po3');
select t.login('finn@buy.al');
select public.create_bill_from_po(:'po3', 'F-801') as b3 \gset
select t.ok((select (count(*), max(variant_id::text)) = (1::bigint, :'fix') from public.vendor_bill_lines where bill_id = :'b3'),
            'only the service is billable before the goods arrive');
insert into public.vendor_bill_lines (company_id, bill_id, line_no, po_line_id, variant_id, description, quantity, unit_price, tax_code_id)
select :'co', :'b3', 2, id, :'cup', 'Cups', 10, 180, :'vat20' from public.purchase_order_lines where purchase_order_id = :'po3' and line_no = 2;
select t.ok((select m -> 'lines' -> 1 ->> 'status' from public.match_vendor_bill(:'b3') m) = 'no_receipt', 'goods billed before receipt flagged');
delete from public.vendor_bill_lines where bill_id = :'b3' and line_no = 2;
select public.post_vendor_bill(:'b3');
select t.ok((select billing_status from public.purchase_orders where id = :'po3') = 'partially_billed', 'partially billed');
select t.login('pam@buy.al');
select t.throws(format($q$update public.purchase_orders set status = 'cancelled' where id = %L$q$, :'po3'), 'close the order instead',
                'billed orders cannot be cancelled');
select t.login('finn@buy.al');

-- vendor credit notes
select public.create_vendor_credit(:'b1') as vc \gset
select t.ok((select (number like 'VCN-2026-%', document_type, original_bill_id, vendor_invoice_number) = (true, 'vendor_credit', :'b1'::uuid, 'CR-F-778')
               from public.vendor_bills where id = :'vc'), 'credit note in its own series');
select public.post_vendor_bill(:'vc');
select t.ok((select qty_billed from public.purchase_order_lines where purchase_order_id = :'po1' and variant_id = :'cof') > 0,
  'a credit is money back, not goods back: the order is not opened for billing again');
select t.ok((select amount_due from public.vendor_bills where id = :'b1') = 0 and (select payment_status from public.vendor_bills where id = :'vc') = 'paid',
  'the credit settles the bill it corrects');
select public.create_vendor_credit(:'b1') as vc2 \gset
select t.throws(format($q$select public.post_vendor_bill(%L)$q$, :'vc2'), 'exceed the original bill', 'credits cannot exceed the bill');

-- ---------- replenishment ------------------------------------------------------------------
select t.login('pam@buy.al');
insert into public.vendor_products (company_id, vendor_id, variant_id, price, currency_code, min_order_qty, lead_time_days, is_preferred)
values (:'co', :'va', :'cup', 180, 'ALL', 24, 3, true);
select t.login('ian@buy.al');
insert into public.replenishment_rules (company_id, variant_id, warehouse_id, min_qty, max_qty, multiple_qty) values (:'co', :'cup', :'wh', 30, 60, 10);
-- cups: 10 on hand, 10 on order (PO3) → projected 20 ≤ 30 → order up to 60 → 40
select t.ok(public.generate_replenishment(:'co') = 1, 'one item below its reorder point');
select id as sug from public.replenishment_suggestions where company_id = :'co' and status = 'open' \gset
select t.ok((select (projected, suggested_qty, vendor_id) = (20.0000, 40.0000, :'va'::uuid) from public.replenishment_suggestions where id = :'sug'),
            'suggestion: up to max, in multiples, from the preferred vendor');
select t.throws(format($q$select public.create_pos_from_suggestions(array[%L]::uuid[])$q$, :'sug'), 'permission denied', 'only buyers create orders');
select t.login('pam@buy.al');
select public.create_pos_from_suggestions(array[:'sug']::uuid[]) as rep \gset
select (:'rep'::jsonb -> 'orders' ->> 0) as po4 \gset
select t.ok((select (status, purchase_order_id) = ('converted', :'po4'::uuid) from public.replenishment_suggestions where id = :'sug'), 'suggestion converted');
select t.ok((select (quantity, unit_price) = (40.0000, 180.0000) from public.purchase_order_lines where purchase_order_id = :'po4'), 'order priced from the vendor list');
select t.ok((select expected_date from public.purchase_orders where id = :'po4') = current_date + 3, 'expected date from lead time');
select t.ok(public.generate_replenishment(:'co') = 0, 'draft orders count as incoming: no double ordering');
update public.purchase_orders set status = 'cancelled' where id = :'po4';
select t.ok((select status from public.replenishment_suggestions where id = :'sug') = 'dismissed', 'cancelling the order frees the suggestion');

-- ---------- visibility & metrics --------------------------------------------------------------
select t.login('wes@buy.al');
select t.ok((select count(*) from public.vendor_bills) = 0, 'warehouse staff cannot see vendor bills');
select t.login('alice@alba.al');
select public.procurement_overview(:'co', date_trunc('month', current_date)::date, current_date) as ov \gset
select t.ok((:'ov'::jsonb ->> 'spend')::numeric = 165000, 'spend = bills net of credits (21,840 + 2,000 + 120,000 + 40,000 + 5,000 − 23,840)');
select t.ok((:'ov'::jsonb ->> 'bill_count')::int = 3, 'bill count excludes credit notes');
select t.ok((:'ov'::jsonb ->> 'to_bill_value')::numeric = 0, 'received but not billed: nothing (a credit note does not reopen PO1)');
select t.ok(exists (select 1 from public.global_search(:'co', 'F-778') where kind = 'vendor_bill'), 'vendor bills found by the vendor invoice number');

reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
