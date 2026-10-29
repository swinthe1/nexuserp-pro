-- =============================================================================
-- DrisPRO · Phase 2 inventory engine tests
-- Runs after 01_rls_and_invariants.sql (reuses its harness: t.ok / t.throws / t.login).
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

insert into auth.users (email, raw_user_meta_data) values
  ('ivan@store.al',  '{"full_name":"Ivan Inventory"}'),
  ('wendy@store.al', '{"full_name":"Wendy Warehouse"}');

set role authenticated;
select t.login('alice@alba.al');
select public.create_company('Dyqani Phase Two', 'AL') as co \gset
select public.invite_member(:'co', 'ivan@store.al',  array['inventory_manager']);
select public.invite_member(:'co', 'wendy@store.al', array['warehouse_operator']);

select id as pcs   from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select id as vat20 from public.tax_codes where company_id = :'co' and code = 'VAT20' \gset
select id as wh    from public.warehouses where company_id = :'co' and code = 'WH' \gset
select id as stock from public.warehouse_locations where company_id = :'co' and code = 'WH/STOCK' \gset

insert into public.warehouses (company_id, code, name, warehouse_type) values (:'co', 'ST1', 'Store Tirana', 'store') returning id as store \gset
insert into public.warehouse_locations (company_id, warehouse_id, code, name) values (:'co', :'store', 'ST1/STOCK', 'Shop floor') returning id as store_stock \gset
insert into public.business_partners (company_id, code, name, is_vendor) values (:'co', 'V-IT', 'Caffè Milano S.p.A.', true) returning id as vendor \gset

-- ---------- product master ------------------------------------------------------
insert into public.product_attributes (company_id, name, sort_order) values (:'co', 'Size', 1) returning id as a_size \gset
insert into public.product_attributes (company_id, name, sort_order) values (:'co', 'Color', 2) returning id as a_color \gset
insert into public.product_attribute_values (company_id, attribute_id, value) values (:'co', :'a_size', 'S') returning id as s \gset
insert into public.product_attribute_values (company_id, attribute_id, value) values (:'co', :'a_size', 'M') returning id as m \gset
insert into public.product_attribute_values (company_id, attribute_id, value) values (:'co', :'a_color', 'Navy') returning id as navy \gset
insert into public.product_attribute_values (company_id, attribute_id, value) values (:'co', :'a_color', 'White') returning id as white \gset

select public.create_product(jsonb_build_object(
  'company_id', :'co', 'code', 'TEE', 'name', 'T-Shirt Basic', 'uom_id', :'pcs', 'sales_price', 1200, 'sales_tax_code_id', :'vat20',
  'reorder_rules', jsonb_build_array(jsonb_build_object('warehouse_id', :'wh', 'min_qty', 5, 'max_qty', 20)),
  'variants', jsonb_build_array(
     jsonb_build_object('sku', 'TEE-S-NVY', 'attribute_value_ids', jsonb_build_array(:'s', :'navy'),  'generate_barcode', true),
     jsonb_build_object('sku', 'TEE-S-WHT', 'attribute_value_ids', jsonb_build_array(:'s', :'white'), 'generate_barcode', true),
     jsonb_build_object('sku', 'TEE-M-NVY', 'attribute_value_ids', jsonb_build_array(:'navy', :'m'), 'generate_barcode', true),
     jsonb_build_object('sku', 'TEE-M-WHT', 'attribute_value_ids', jsonb_build_array(:'m', :'white'), 'generate_barcode', true))
)) as tee \gset
select id as tee_m from public.product_variants where sku = 'TEE-M-NVY' and company_id = :'co' \gset

select t.ok((select count(*) from public.product_variants where product_id = :'tee') = 4, 'create_product builds 4 variants from 2×2 attributes');
select t.ok((select name from public.product_variants where id = :'tee_m') = 'T-Shirt Basic / M / Navy', 'variant names follow attribute order');
select t.ok((select count(*) from public.product_barcodes b join public.product_variants v on v.id = b.variant_id
              where v.product_id = :'tee' and b.barcode ~ '^200[0-9]{10}$') = 4, 'internal EAN-13 barcodes generated (prefix 200)');
select t.ok((select bool_and(right(barcode, 1)::int = app.gtin_check_digit(left(barcode, 12)))
               from public.product_barcodes where company_id = :'co'), 'generated barcodes have valid check digits');
select t.ok((select count(*) from public.replenishment_rules where company_id = :'co') = 4, 'reorder points created for every variant');
select t.ok((select count(*) from public.stock_alerts where company_id = :'co' and status = 'open') = 4, 'new reorder point with no stock opens low-stock alerts');

select public.create_product(jsonb_build_object(
  'company_id', :'co', 'code', 'COFFEE', 'name', 'Espresso beans 1kg', 'uom_id', :'pcs', 'sales_price', 2500, 'weight_kg', 1,
  'barcodes', jsonb_build_array(jsonb_build_object('barcode', '5901234123457')))) as coffee_p \gset
select id as coffee from public.product_variants where product_id = :'coffee_p' \gset
select public.create_product(jsonb_build_object(
  'company_id', :'co', 'code', 'MILK', 'name', 'Fresh milk 1L', 'uom_id', :'pcs', 'tracking', 'lot', 'track_expiry', true)) as milk_p \gset
select id as milk from public.product_variants where product_id = :'milk_p' \gset

select t.throws(format($q$insert into public.product_barcodes (company_id, variant_id, barcode) values (%L, %L, '5901234123458')$q$, :'co', :'coffee'),
                'check digit', 'invalid EAN-13 check digit rejected');
select t.ok((select sku from public.find_variant_by_code(:'co', '5901234123457')) = 'COFFEE', 'barcode lookup finds the variant');
select t.ok((select matched_by from public.find_variant_by_code(:'co', 'tee-m-nvy')) = 'sku', 'lookup falls back to SKU (case-insensitive)');
select t.ok(exists (select 1 from public.global_search(:'co', 'espresso') where kind = 'product'), '⌘K search finds products');

-- ---------- weighted average cost ---------------------------------------------------
-- GR1: 10 @ 100
insert into public.goods_receipts (company_id, warehouse_id, receipt_date) values (:'co', :'wh', '2026-10-01') returning id as gr1, number as gr1_no \gset
insert into public.goods_receipt_lines (company_id, receipt_id, variant_id, location_id, quantity, unit_cost) values (:'co', :'gr1', :'coffee', :'stock', 10, 100);
select public.post_goods_receipt(:'gr1');
select t.ok(:'gr1_no' = 'PRN-2026-00001', 'receipts are numbered');
select t.ok((select (qty_on_hand, avg_cost, total_value) = (10.0000, 100.000000, 1000.0000) from public.item_costs where variant_id = :'coffee'),
            'first receipt sets average cost = 100');

-- GR2: 10 @ 130 → avg 115
insert into public.goods_receipts (company_id, warehouse_id, receipt_date) values (:'co', :'wh', '2026-10-02') returning id as gr2 \gset
insert into public.goods_receipt_lines (company_id, receipt_id, variant_id, location_id, quantity, unit_cost) values (:'co', :'gr2', :'coffee', :'stock', 10, 130);
select public.post_goods_receipt(:'gr2');
select t.ok((select (qty_on_hand, avg_cost, total_value) = (20.0000, 115.000000, 2300.0000) from public.item_costs where variant_id = :'coffee'),
            'WAC: (10×100 + 10×130) / 20 = 115');
select t.throws(format($q$select public.post_goods_receipt(%L)$q$, :'gr2'), 'only draft', 'a receipt cannot be posted twice');
select t.throws(format($q$update public.goods_receipt_lines set quantity = 99 where receipt_id = %L$q$, :'gr2'), 'cannot be modified', 'posted receipt lines are frozen');

-- Adjustment out 5 → valued at average, average unchanged
insert into public.stock_adjustments (company_id, warehouse_id, reason, adjustment_date) values (:'co', :'wh', 'correction', '2026-10-03') returning id as adj1 \gset
insert into public.stock_adjustment_lines (company_id, adjustment_id, variant_id, location_id, quantity_change) values (:'co', :'adj1', :'coffee', :'stock', -5);
select t.ok(public.post_stock_adjustment(:'adj1') = 'posted', 'adjustment without workflow posts directly');
select t.ok((select (qty_on_hand, avg_cost, total_value) = (15.0000, 115.000000, 1725.0000) from public.item_costs where variant_id = :'coffee'),
            'issue at average: 2300 − 5×115 = 1725, average unchanged');
select t.ok((select total_value from public.stock_adjustments where id = :'adj1') = -575.00, 'adjustment carries its signed value');

-- ---------- import in foreign currency via PO --------------------------------------
insert into public.purchase_orders (company_id, vendor_id, warehouse_id, currency_code, exchange_rate, order_date)
values (:'co', :'vendor', :'wh', 'EUR', 100, '2026-10-01') returning id as po \gset
insert into public.purchase_order_lines (company_id, purchase_order_id, line_no, variant_id, description, quantity, unit_price)
values (:'co', :'po', 1, :'coffee', 'Espresso beans', 20, 1.5) returning id as pol \gset
select public.submit_for_approval('purchase_order', :'po');

insert into public.goods_receipts (company_id, warehouse_id, purchase_order_id, receipt_date, is_import, exchange_rate, customs_declaration_number, origin_country)
values (:'co', :'wh', :'po', '2026-10-05', true, 98, 'DUD-2026-AL-118734', 'IT') returning id as gr3 \gset
insert into public.goods_receipt_lines (company_id, receipt_id, po_line_id, variant_id, location_id, quantity) values (:'co', :'gr3', :'pol', :'coffee', :'stock', 20);
select t.ok((select (currency_code, vendor_id, clearance_status) = ('EUR', :'vendor'::uuid, 'pending') from public.goods_receipts where id = :'gr3'),
            'import receipt inherits PO currency/vendor and awaits customs clearance');
select public.post_goods_receipt(:'gr3');
select t.ok((select unit_cost from public.goods_receipt_lines where receipt_id = :'gr3') = 147.000000, 'import valued at PO price × customs rate (1.5 × 98)');
select t.ok((select (qty_on_hand, total_value, avg_cost) = (35.0000, 4665.0000, 133.285714) from public.item_costs where variant_id = :'coffee'),
            'WAC after import: (1725 + 20×147) / 35 = 133.285714');
select t.ok((select (status, l.qty_received) = ('received', 20.0000) from public.purchase_orders o join public.purchase_order_lines l on l.purchase_order_id = o.id where o.id = :'po'),
            'PO received quantities and status updated');

-- over-receipt on a second PO
insert into public.purchase_orders (company_id, vendor_id, warehouse_id, currency_code, order_date) values (:'co', :'vendor', :'wh', 'ALL', '2026-10-05') returning id as po2 \gset
insert into public.purchase_order_lines (company_id, purchase_order_id, line_no, variant_id, description, quantity, unit_price)
values (:'co', :'po2', 1, :'tee_m', 'T-shirts', 10, 500) returning id as pol2 \gset
select t.throws(format($q$
  with g as (insert into public.goods_receipts (company_id, warehouse_id, purchase_order_id) values (%1$L, %2$L, %3$L) returning id)
  insert into public.goods_receipt_lines (company_id, receipt_id, po_line_id, variant_id, location_id, quantity)
  select %1$L::uuid, g.id, %4$L::uuid, %5$L::uuid, %6$L::uuid, 6 from g;
  select public.post_goods_receipt(id) from public.goods_receipts where purchase_order_id = %3$L;$q$, :'co', :'wh', :'po2', :'pol2', :'tee_m', :'stock'),
  'must be approved', 'cannot receive against an unapproved PO');
select public.submit_for_approval('purchase_order', :'po2');
insert into public.goods_receipts (company_id, warehouse_id, purchase_order_id) values (:'co', :'wh', :'po2') returning id as gr4 \gset
insert into public.goods_receipt_lines (company_id, receipt_id, po_line_id, variant_id, location_id, quantity) values (:'co', :'gr4', :'pol2', :'tee_m', :'stock', 6);
select public.post_goods_receipt(:'gr4');
select t.ok((select status from public.purchase_orders where id = :'po2') = 'partially_received', 'partial receipt → PO partially received');
select t.ok((select status from public.stock_alerts where variant_id = :'tee_m') = 'resolved', 'receipt above reorder point resolves the alert');
insert into public.goods_receipts (company_id, warehouse_id, purchase_order_id) values (:'co', :'wh', :'po2') returning id as gr5 \gset
insert into public.goods_receipt_lines (company_id, receipt_id, po_line_id, variant_id, location_id, quantity) values (:'co', :'gr5', :'pol2', :'tee_m', :'stock', 5);
select t.throws(format($q$select public.post_goods_receipt(%L)$q$, :'gr5'), 'over-receipt', 'over-receipt beyond PO quantity rejected');

-- ---------- landed cost after clearance (partly sold already) -------------------
insert into public.stock_adjustments (company_id, warehouse_id, reason) values (:'co', :'wh', 'correction') returning id as adj2 \gset
insert into public.stock_adjustment_lines (company_id, adjustment_id, variant_id, location_id, quantity_change) values (:'co', :'adj2', :'coffee', :'stock', -25);
select public.post_stock_adjustment(:'adj2');
select t.ok((select (qty_on_hand, total_value) = (10.0000, 1332.8571) from public.item_costs where variant_id = :'coffee'),
            '25 issued at 133.285714 leaves 10 units worth 1332.8571');

insert into public.landed_costs (company_id, allocation_method, landed_cost_date) values (:'co', 'quantity', '2026-10-08') returning id as lc, number as lc_no \gset
insert into public.landed_cost_receipts (company_id, landed_cost_id, receipt_id) values (:'co', :'lc', :'gr3');
insert into public.landed_cost_charges (company_id, landed_cost_id, charge_type, description, amount) values
  (:'co', :'lc', 'freight', 'Durrës port → warehouse', 400),
  (:'co', :'lc', 'customs', 'Customs duty', 300);
select t.ok((select total_amount from public.landed_costs where id = :'lc') = 700, 'landed cost total = sum of charges');
select public.post_landed_cost(:'lc') as lc_result \gset
select t.ok((:'lc_result'::jsonb ->> 'capitalized')::numeric = 350 and (:'lc_result'::jsonb ->> 'expensed')::numeric = 350,
            'only the in-stock share (10 of 20) is capitalised; the sold half is expensed');
select t.ok((select (qty_on_hand, total_value, avg_cost) = (10.0000, 1682.8571, 168.285710) from public.item_costs where variant_id = :'coffee'),
            'landed cost raises the average cost of remaining stock');
select t.ok((select clearance_status from public.goods_receipts where id = :'gr3') = 'cleared', 'import receipt marked cleared');
select t.ok((select landed_cost_amount from public.goods_receipt_lines where receipt_id = :'gr3') = 700, 'receipt line carries its landed cost');

insert into public.landed_costs (company_id, allocation_method) values (:'co', 'weight') returning id as lc2 \gset
insert into public.landed_cost_receipts (company_id, landed_cost_id, receipt_id) values (:'co', :'lc2', :'gr4');
insert into public.landed_cost_charges (company_id, landed_cost_id, charge_type, amount) values (:'co', :'lc2', 'freight', 50);
select t.throws(format($q$select public.post_landed_cost(%L)$q$, :'lc2'), 'no weights', 'weight allocation needs product weights');

-- ---------- negative stock policy ---------------------------------------------------
insert into public.stock_adjustments (company_id, warehouse_id, reason) values (:'co', :'wh', 'loss') returning id as adj3 \gset
insert into public.stock_adjustment_lines (company_id, adjustment_id, variant_id, location_id, quantity_change) values (:'co', :'adj3', :'coffee', :'stock', -100);
select t.throws(format($q$select public.post_stock_adjustment(%L)$q$, :'adj3'), 'insufficient stock', 'negative stock refused by default');
select t.ok((select status from public.stock_adjustments where id = :'adj3') = 'draft', 'failed posting leaves the document untouched');

update public.company_settings set allow_negative_stock = true where company_id = :'co';
select public.post_stock_adjustment(:'adj3');
select t.ok((select qty_on_hand from public.item_costs where variant_id = :'coffee') = -90, 'negative stock allowed when enabled');
insert into public.goods_receipts (company_id, warehouse_id) values (:'co', :'wh') returning id as gr6 \gset
insert into public.goods_receipt_lines (company_id, receipt_id, variant_id, location_id, quantity, unit_cost) values (:'co', :'gr6', :'coffee', :'stock', 100, 200);
select public.post_goods_receipt(:'gr6');
select t.ok((select (qty_on_hand, avg_cost, total_value) = (10.0000, 200.000000, 2000.0000) from public.item_costs where variant_id = :'coffee'),
            'receipt settling a deficit resets the average to the incoming cost');
select t.ok(exists (select 1 from public.stock_movements where variant_id = :'coffee' and movement_type = 'revaluation'),
            'deficit settlement recorded as a revaluation movement');
update public.company_settings set allow_negative_stock = false where company_id = :'co';

-- ---------- lots -----------------------------------------------------------------------
select t.throws(format($q$
  with g as (insert into public.goods_receipts (company_id, warehouse_id) values (%1$L, %2$L) returning id)
  insert into public.goods_receipt_lines (company_id, receipt_id, variant_id, location_id, quantity, unit_cost)
  select %1$L::uuid, g.id, %3$L::uuid, %4$L::uuid, 12, 90 from g;
  select public.post_goods_receipt(id) from public.goods_receipts where company_id = %1$L and status = 'draft' and purchase_order_id is null;$q$,
  :'co', :'wh', :'milk', :'stock'), 'lot/serial number is required', 'lot-tracked product requires a lot');
insert into public.lots (company_id, variant_id, lot_number, expiry_date) values (:'co', :'milk', 'L2610-A', '2026-11-05') returning id as lot \gset
insert into public.goods_receipts (company_id, warehouse_id) values (:'co', :'wh') returning id as gr7 \gset
insert into public.goods_receipt_lines (company_id, receipt_id, variant_id, location_id, lot_id, quantity, unit_cost) values (:'co', :'gr7', :'milk', :'stock', :'lot', 12, 90);
select public.post_goods_receipt(:'gr7');
select t.ok((select on_hand from public.v_stock_levels where variant_id = :'milk' and lot_number = 'L2610-A') = 12, 'stock tracked per lot with expiry');

-- ---------- transfers & permissions ------------------------------------------------
select t.login('wendy@store.al');
insert into public.stock_transfers (company_id, from_warehouse_id, to_warehouse_id) values (:'co', :'wh', :'store') returning id as trf \gset
insert into public.stock_transfer_lines (company_id, transfer_id, variant_id, from_location_id, to_location_id, quantity)
values (:'co', :'trf', :'coffee', :'stock', :'store_stock', 4);
select t.ok(public.post_stock_transfer(:'trf') = 'done', 'warehouse operator posts a transfer');
select t.ok((select string_agg(warehouse_code || '=' || trim_scale(on_hand), ',' order by warehouse_code) from public.v_stock_levels where variant_id = :'coffee') = 'ST1=4,WH=6',
            'transfer moves stock between warehouses');
select t.throws(format($q$select public.post_stock_adjustment(%L)$q$, :'adj1'), 'permission denied', 'warehouse operator cannot post adjustments');
select t.throws(format($q$insert into public.products (company_id, code, name, uom_id) values (%L, 'X', 'x', %L)$q$, :'co', :'pcs'),
                'row-level security', 'warehouse operator cannot edit the product master');
select t.login('alice@alba.al');
select t.ok((select (qty_on_hand, avg_cost) = (10.0000, 200.000000) from public.item_costs where variant_id = :'coffee'), 'transfers do not change valuation');

-- ---------- two-step transfer: ship (on the road) → receive with differences ----------
select t.login('wendy@store.al');
insert into public.stock_transfers (company_id, from_warehouse_id, to_warehouse_id) values (:'co', :'wh', :'store') returning id as trf2 \gset
insert into public.stock_transfer_lines (company_id, transfer_id, variant_id, from_location_id, to_location_id, quantity)
values (:'co', :'trf2', :'coffee', :'stock', :'store_stock', 2) returning id as tl1 \gset
insert into public.stock_transfer_lines (company_id, transfer_id, variant_id, from_location_id, to_location_id, quantity)
values (:'co', :'trf2', :'coffee', :'stock', :'store_stock', 1) returning id as tl2 \gset
insert into public.stock_transfer_lines (company_id, transfer_id, variant_id, from_location_id, to_location_id, quantity)
values (:'co', :'trf2', :'coffee', :'stock', :'store_stock', 1) returning id as tl3 \gset
select t.ok(public.ship_stock_transfer(:'trf2') = 'in_transit', 'the sending store ships');
select t.ok((select string_agg(warehouse_code || '=' || trim_scale(on_hand), ',' order by warehouse_code) from public.v_stock_levels where variant_id = :'coffee' and on_hand <> 0) = 'ST1=4,TRANSIT=4,WH=2',
            'shipped goods are on the road, no longer on the sender''s shelves');
select t.ok((public.transfers_on_the_road(:'co') ->> 'count')::int = 1, 'the dashboard counts goods on the road');
select t.throws(format($q$select public.post_stock_transfer(%L)$q$, :'trf2'), 'Only draft transfers', 'a shipped transfer cannot be posted again');
select public.receive_stock_transfer(:'trf2', jsonb_build_array(jsonb_build_object('line_id', :'tl1', 'received', 3),
                                                                jsonb_build_object('line_id', :'tl2', 'received', 0),
                                                                jsonb_build_object('line_id', :'tl3', 'received', 0, 'action', 'return')), 'one bag torn') as rcv \gset
select t.ok((:'rcv'::jsonb ->> 'lost')::numeric = 1 and (:'rcv'::jsonb ->> 'returned')::numeric = 1 and (:'rcv'::jsonb ->> 'extra')::numeric = 1,
            'one unit more than shipped, one lost, one sent back');
select t.ok((select string_agg(warehouse_code || '=' || trim_scale(on_hand), ',' order by warehouse_code) from public.v_stock_levels where variant_id = :'coffee' and on_hand <> 0) = 'ST1=7,WH=3',
            'the receiving store gets what arrived, the sender gets back what was returned');
select t.ok((select status = 'done' and has_difference and receive_note = 'one bag torn' from public.stock_transfers where id = :'trf2'), 'the transfer closes with its difference noted');
select t.login('alice@alba.al');
select t.ok((select (qty_on_hand, avg_cost) = (10.0000, 200.000000) from public.item_costs where variant_id = :'coffee'), 'the loss and the extra unit balance out at the average cost');
select t.ok(not exists (select 1 from public.stock_movements where source_doc_id = :'trf2' and journal_entry_id is not null)
  and not exists (select 1 from public.journal_entries where source_doc_id = :'trf2'),
  'a loss and an extra unit of the same item cancel out: no journal entry');
-- put the stock back where the next tests expect it (WH=6, ST1=4)
insert into public.stock_transfers (company_id, from_warehouse_id, to_warehouse_id) values (:'co', :'store', :'wh') returning id as trf3 \gset
insert into public.stock_transfer_lines (company_id, transfer_id, variant_id, from_location_id, to_location_id, quantity)
values (:'co', :'trf3', :'coffee', :'store_stock', :'stock', 3);
select public.post_stock_transfer(:'trf3');

-- ---------- low-stock alert cycle & notifications ---------------------------------
insert into public.stock_adjustments (company_id, warehouse_id, reason) values (:'co', :'wh', 'damage') returning id as adj4 \gset
insert into public.stock_adjustment_lines (company_id, adjustment_id, variant_id, location_id, quantity_change) values (:'co', :'adj4', :'tee_m', :'stock', -2);
select public.post_stock_adjustment(:'adj4');
select t.ok(exists (select 1 from public.stock_movements where source_doc_id = :'adj4' and movement_type = 'scrap'), 'damaged goods go to the scrap location');
select t.ok((select count(*) from public.stock_alerts where variant_id = :'tee_m' and status = 'open') = 1, 'dropping to the reorder point re-opens an alert');
select t.ok((select suggested_qty from public.v_low_stock where variant_id = :'tee_m') = 12, 'suggested qty = max 20 − available 4 − incoming 4');
select t.login('ivan@store.al');
select t.ok((select count(*) from public.notifications where type = 'alert' and title = 'Low stock: TEE-M-NVY') = 2, 'inventory manager notified each time the item went low');
select id as alert from public.stock_alerts where variant_id = :'tee_m' and status = 'open' \gset
select public.acknowledge_stock_alert(:'alert');
select t.ok((select status from public.stock_alerts where id = :'alert') = 'acknowledged', 'alert can be acknowledged');
select t.login('alice@alba.al');

-- ---------- reservations ---------------------------------------------------------------
reset role;
select app.reserve_stock(:'co', :'tee_m', :'wh', 3, 'sales_order', gen_random_uuid());
select t.ok((select (on_hand, reserved, available) = (4.0000, 3.0000, 1.0000) from public.stock_levels where variant_id = :'tee_m'),
            'available = on_hand − reserved after reserving 3');
select t.throws(format($q$select app.reserve_stock(%L, %L, %L, 5, 'sales_order', gen_random_uuid())$q$, :'co', :'tee_m', :'wh'),
                'only 1 of 5', 'cannot reserve more than available');
select t.ok(app.release_reservations('sales_order', (select source_doc_id from public.stock_reservations where variant_id = :'tee_m' limit 1)) = 3,
            'reservations release');
select t.throws(format($q$
  select app.post_stock_move(%L, 'adjustment_out', %L, %L, %L, 1)$q$, :'co', :'tee_m', :'stock', :'stock'), 'same location', 'move needs two different locations');

-- ---------- approval-gated adjustment ------------------------------------------------
set role authenticated;
select t.login('alice@alba.al');
insert into public.approval_workflows (company_id, name, doc_type, min_amount) values (:'co', 'Write-offs ≥ 1,000', 'stock_adjustment', 1000) returning id as wf \gset
insert into public.approval_workflow_steps (company_id, workflow_id, step_order, name, approver_role_id)
select :'co', :'wf', 1, 'Inventory manager sign-off', id from public.roles where key = 'inventory_manager';
insert into public.stock_adjustments (company_id, warehouse_id, reason) values (:'co', :'wh', 'loss') returning id as adj5 \gset
insert into public.stock_adjustment_lines (company_id, adjustment_id, variant_id, location_id, quantity_change) values (:'co', :'adj5', :'coffee', :'stock', -5);
select t.ok(public.post_stock_adjustment(:'adj5') = 'pending_approval', 'write-off of 1,000 waits for approval');
select t.ok((select qty_on_hand from public.item_costs where variant_id = :'coffee') = 10, 'nothing posted while pending');
select t.login('ivan@store.al');
select public.decide_approval((select id from public.approval_requests where document_id = :'adj5'), 'approved', 'Confirmed theft report');
select t.login('alice@alba.al');
select t.ok(public.post_stock_adjustment(:'adj5') = 'posted', 'approved adjustment posts');
select t.ok((select qty_on_hand from public.item_costs where variant_id = :'coffee') = 5, 'write-off applied after approval');

-- ---------- history, overview, invariants ------------------------------------------
select t.ok((select count(*) from public.get_record_history('stock_adjustments', :'adj5') where kind in ('status_change','approval')) >= 3,
            'record history shows status changes and the approval');
select t.ok((public.inventory_overview(:'co') ->> 'stock_value')::numeric = (select sum(total_value) from public.item_costs where company_id = :'co'),
            'overview stock value = Σ item valuation');
reset role;

select t.ok(not exists (
  select 1 from public.item_costs ic
   where ic.company_id = :'co'
     and ic.qty_on_hand <> coalesce((select sum(on_hand) from public.stock_levels sl where sl.variant_id = ic.variant_id), 0)),
  'quantity conservation: item_costs = Σ stock_levels for every item');
select t.ok(not exists (
  select 1 from public.item_costs ic
   where ic.company_id = :'co'
     and ic.qty_on_hand <> coalesce((select sum(case direction when 'in' then quantity when 'out' then -quantity else 0 end)
                                        from public.v_stock_movements m where m.variant_id = ic.variant_id), 0)),
  'quantity conservation: item_costs = Σ signed movements');
select t.ok(not exists (
  select 1 from public.item_costs ic
   where ic.company_id = :'co'
     and ic.total_value <> coalesce((select sum(case direction when 'in' then total_cost when 'out' then -total_cost else 0 end)
                                        from public.v_stock_movements m where m.variant_id = ic.variant_id), 0)),
  'value conservation: item valuation = Σ signed movement values (incl. landed cost & revaluation)');

-- ---------- atomic draft save (save_document RPC) ---------------------------------
set role authenticated;
select t.login('alice@alba.al');
select public.save_document('stock_adjustments',
  jsonb_build_object('company_id', :'co', 'warehouse_id', :'wh', 'reason', 'count', 'status', 'posted', 'total_value', 999999),
  jsonb_build_object('stock_adjustment_lines', jsonb_build_array(
     jsonb_build_object('variant_id', :'coffee', 'location_id', :'stock', 'quantity_change', 2),
     jsonb_build_object('variant_id', :'tee_m',  'location_id', :'stock', 'quantity_change', -1)))) as doc \gset
select t.ok((select (status, total_value) = ('draft', 0.00) from public.stock_adjustments where id = :'doc'), 'save_document ignores system columns (status, totals)');
select t.ok((select count(*) from public.stock_adjustment_lines where adjustment_id = :'doc') = 2, 'header and lines saved together');
select public.save_document('stock_adjustments', jsonb_build_object('id', :'doc', 'notes', 'recount aisle 3'),
  jsonb_build_object('stock_adjustment_lines', jsonb_build_array(jsonb_build_object('variant_id', :'coffee', 'location_id', :'stock', 'quantity_change', 1))));
select t.ok((select (a.notes, count(l.*)) = ('recount aisle 3', 1::bigint) from public.stock_adjustments a join public.stock_adjustment_lines l on l.adjustment_id = a.id
              where a.id = :'doc' group by a.notes), 'update replaces the lines');
select t.throws(format($q$select public.save_document('stock_adjustments', jsonb_build_object('id', %L, 'notes', 'x'),
                         jsonb_build_object('stock_adjustment_lines', '[]'::jsonb))$q$, :'adj1'), 'cannot be modified', 'posted document lines cannot be replaced');
select t.throws($q$select public.save_document('employees', '{}'::jsonb)$q$, 'does not support', 'only whitelisted document tables');
select t.login('wendy@store.al');
select t.throws(format($q$select public.save_document('stock_adjustments', jsonb_build_object('company_id', %L, 'warehouse_id', %L, 'reason', 'count'))$q$, :'co', :'wh'),
                'row-level security', 'save_document respects RLS (operator cannot create adjustments)');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
