-- =============================================================================
-- DrisPRO · Phase 6 WMS + POS tests (runs after 01–05; reuses t.ok / t.throws / t.login)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

insert into auth.users (email, raw_user_meta_data) values
  ('wanda@wms.al', '{"full_name":"Wanda Warehouse"}'),
  ('ivo@wms.al',   '{"full_name":"Ivo Inventory Manager"}'),
  ('cora@wms.al',  '{"full_name":"Cora Cashier"}');

set role authenticated;
select t.login('alice@alba.al');
select public.create_company('Magazina Test', 'AL') as co \gset
select public.invite_member(:'co', 'wanda@wms.al', array['warehouse_operator']);
select t.accept_invites();
select public.invite_member(:'co', 'ivo@wms.al', array['inventory_manager']);
select t.accept_invites();
select public.invite_member(:'co', 'cora@wms.al', array['pos_cashier']);
select t.accept_invites();

create or replace function pg_temp.bal(p_co uuid, p_code text) returns numeric language sql as $$
  select coalesce(sum(jl.debit - jl.credit), 0) from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
   where jl.company_id = p_co and jl.account_id = (select id from public.accounts where company_id = p_co and code = p_code)
     and e.status in ('posted','reversed') $$;
create or replace function pg_temp.qty(p_loc uuid, p_variant uuid) returns numeric language sql as $$
  select coalesce(sum(on_hand), 0) from public.stock_levels where location_id = p_loc and variant_id = p_variant $$;

select id as pcs   from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select id as vat20 from public.tax_codes where company_id = :'co' and code = 'VAT20' \gset
select id as wh    from public.warehouses where company_id = :'co' and code = 'WH' \gset
select id as rcv   from public.warehouse_locations where company_id = :'co' and code = 'WH/RECEIVING' \gset
insert into public.warehouse_locations (company_id, warehouse_id, code, name, barcode) values (:'co', :'wh', 'WH/A-01', 'Aisle A 1', 'BIN-A01') returning id as a01 \gset
insert into public.warehouse_locations (company_id, warehouse_id, code, name, barcode) values (:'co', :'wh', 'WH/A-02', 'Aisle A 2', 'BIN-A02') returning id as a02 \gset
insert into public.warehouse_locations (company_id, warehouse_id, code, name, barcode) values (:'co', :'wh', 'WH/B-01', 'Aisle B 1', 'BIN-B01') returning id as b01 \gset
insert into public.warehouses (company_id, code, name, warehouse_type) values (:'co', 'SHOP', 'Shop', 'store') returning id as shop \gset
insert into public.warehouse_locations (company_id, warehouse_id, code, name) values (:'co', :'shop', 'SHOP/FLOOR', 'Shop floor') returning id as floor \gset
insert into public.product_categories (company_id, name) values (:'co', 'Tea') returning id as c_tea \gset
insert into public.product_categories (company_id, name) values (:'co', 'Dairy') returning id as c_dairy \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'TEA', 'name', 'Mountain tea 100 g', 'uom_id', :'pcs', 'category_id', :'c_tea',
       'sales_price', 100, 'sales_tax_code_id', :'vat20', 'purchase_tax_code_id', :'vat20')) as p_tea \gset
select id as tea from public.product_variants where product_id = :'p_tea' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'YOG', 'name', 'Yogurt 500 g', 'uom_id', :'pcs', 'category_id', :'c_dairy',
       'tracking', 'lot', 'track_expiry', true, 'sales_price', 150, 'sales_tax_code_id', :'vat20', 'purchase_tax_code_id', :'vat20')) as p_yog \gset
select id as yog from public.product_variants where product_id = :'p_yog' \gset
insert into public.business_partners (company_id, code, name, is_vendor) values (:'co', 'V1', 'Bulmet', true) returning id as vend \gset
insert into public.business_partners (company_id, code, name, is_customer) values (:'co', 'C1', 'Hotel Tirana', true) returning id as cust \gset

-- some tea already in A-01
insert into public.stock_adjustments (company_id, warehouse_id, reason) values (:'co', :'wh', 'opening') returning id as op \gset
insert into public.stock_adjustment_lines (company_id, adjustment_id, variant_id, location_id, quantity_change, unit_cost) values (:'co', :'op', :'tea', :'a01', 10, 50);
select public.post_stock_adjustment(:'op');

-- ---------- receiving with lots, automatic putaway task ----------------------------------------
insert into public.purchase_orders (company_id, vendor_id, warehouse_id) values (:'co', :'vend', :'wh') returning id as po \gset
insert into public.purchase_order_lines (company_id, purchase_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id) values
  (:'co', :'po', 1, :'tea', 'Tea', 100, 50, :'vat20'), (:'co', :'po', 2, :'yog', 'Yogurt', 40, 80, :'vat20');
select public.submit_purchase_order(:'po');
select t.login('wanda@wms.al');
select public.create_receipt_from_po(:'po') as gr \gset
select t.ok((select bool_and(location_id = :'rcv'::uuid) from public.goods_receipt_lines where receipt_id = :'gr'), 'PO receipts land in receiving');
select public.ensure_lot(:'yog', 'Y-2610', current_date + 12) as lot1 \gset
select t.ok(public.ensure_lot(:'yog', 'Y-2610') = :'lot1'::uuid, 'ensure_lot finds an existing lot instead of duplicating it');
select t.ok((select expiry_date from public.lots where id = :'lot1') = current_date + 12, 'the scanned expiry is kept on the lot');
update public.goods_receipt_lines set lot_id = :'lot1' where receipt_id = :'gr' and variant_id = :'yog';
select public.post_goods_receipt(:'gr');
select id as pt from public.warehouse_tasks where source_doc_id = :'gr' and task_type = 'putaway' \gset
select t.ok(:'pt' <> '', 'posting a receipt into receiving creates a putaway task');
select t.ok((select to_location_id from public.warehouse_task_lines where task_id = :'pt' and variant_id = :'tea') = :'a01'::uuid,
            'putaway suggests the bin that already holds the item');
select t.ok((select to_location_id from public.warehouse_task_lines where task_id = :'pt' and variant_id = :'yog') = :'a02'::uuid,
            'otherwise the first empty bin');
select t.ok((select reason from public.suggest_putaway(:'yog', :'wh', 3) limit 1) = 'Empty bin', 'suggestions explain themselves');
select id as pl_tea from public.warehouse_task_lines where task_id = :'pt' and variant_id = :'tea' \gset
select id as pl_yog from public.warehouse_task_lines where task_id = :'pt' and variant_id = :'yog' \gset
select t.throws(format($q$select public.confirm_task_line(%L, 101)$q$, :'pl_tea'), 'Only 100 left', 'cannot put away more than the line');
select public.confirm_task_line(:'pl_tea', 60);
select t.ok((select status from public.warehouse_tasks where id = :'pt') = 'in_progress', 'task in progress after the first scan');
select public.confirm_task_line(:'pl_tea', 40);
select public.confirm_task_line(:'pl_yog', 40, :'b01');           -- worker scanned a different bin
select t.ok((select status from public.warehouse_tasks where id = :'pt') = 'done', 'task done when every line is put away');
select t.ok(pg_temp.qty(:'a01', :'tea') = 110 and pg_temp.qty(:'b01', :'yog') = 40 and pg_temp.qty(:'rcv', :'tea') + pg_temp.qty(:'rcv', :'yog') = 0,
            'stock moved to the confirmed bins, receiving is empty');
select t.ok((select done_location_id from public.warehouse_task_lines where id = :'pl_yog') = :'b01'::uuid, 'the bin actually used is recorded');
select public.create_putaway_task(:'b01') as pt2 \gset
select t.ok((select count(*) from public.warehouse_task_lines where task_id = :'pt2') = 1, 'a bin can be swept into a putaway task');
select t.throws(format($q$update public.warehouse_task_lines set quantity_done = quantity where task_id = %L$q$, :'pt2'), 'confirmed by scanning', 'progress cannot be typed in, only confirmed');
select t.throws(format($q$update public.warehouse_tasks set status = 'done' where id = %L$q$, :'pt2'), 'set by its own action', 'task statuses are system-set');
select public.cancel_task(:'pt2');

-- ---------- picking and shipping -------------------------------------------------------------
select t.login('alice@alba.al');
insert into public.sales_orders (company_id, partner_id, warehouse_id, currency_code) values (:'co', :'cust', :'wh', 'ALL') returning id as so \gset
insert into public.sales_order_lines (company_id, sales_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id) values
  (:'co', :'so', 1, :'tea', 'Tea', 30, 100, :'vat20'), (:'co', :'so', 2, :'yog', 'Yogurt', 10, 150, :'vat20');
select public.confirm_sales_order(:'so');
select public.create_delivery_from_order(:'so') as dl \gset
select t.login('wanda@wms.al');
select public.create_pick_list(array[:'dl'::uuid]) as pick \gset
select t.ok((select count(*) from public.warehouse_task_lines where task_id = :'pick') = 2, 'one pick line per delivery line');
select t.ok((select array_agg(from_location_id order by sequence) from public.warehouse_task_lines where task_id = :'pick') = array[:'a01'::uuid, :'b01'::uuid],
            'pick path follows the bin order');
select t.throws(format($q$select public.create_pick_list(array[%L::uuid])$q$, :'dl'), 'already on an open pick list', 'a delivery is on one pick list at a time');
select id as pk_tea from public.warehouse_task_lines where task_id = :'pick' and variant_id = :'tea' \gset
select id as pk_yog from public.warehouse_task_lines where task_id = :'pick' and variant_id = :'yog' \gset
select t.throws(format($q$select public.confirm_pick(%L, 31)$q$, :'pk_tea'), 'Over-pick', 'no over-picking');
select public.confirm_pick(:'pk_tea', 30);
select public.confirm_pick(:'pk_yog', 8);                      -- two jars were broken
select public.complete_pick_list(:'pick');
select t.ok((select status from public.deliveries where id = :'dl') = 'ready', 'picked delivery is ready to ship');
select t.ok((select quantity from public.delivery_lines where delivery_id = :'dl' and variant_id = :'yog') = 8, 'short pick shrinks the delivery line');
select public.confirm_shipment(:'dl', 'DHL', 'JD0123456789', 2, 7.5);
select t.ok((select (status, tracking_number, package_count, carrier_name) = ('done', 'JD0123456789', 2::smallint, 'DHL') from public.deliveries where id = :'dl'),
            'shipment confirmed with carrier, tracking and parcels');
select t.ok((select status from public.sales_orders where id = :'so') = 'partially_delivered', 'the order keeps the shortfall as a backorder');
select t.ok(pg_temp.qty(:'a01', :'tea') = 80 and pg_temp.qty(:'b01', :'yog') = 32, 'stock left the picked bins');

-- ---------- quick moves --------------------------------------------------------------------
select public.move_stock(:'a01', :'floor', jsonb_build_array(jsonb_build_object('variant_id', :'tea', 'quantity', 20))) as mv \gset
select t.ok((select status from public.stock_transfers where id = :'mv') = 'done' and pg_temp.qty(:'floor', :'tea') = 20, 'quick move posts a transfer');
select t.throws(format($q$select public.move_stock(%L, %L, '[{"variant_id": "%s", "quantity": 31, "lot_id": "%s"}]')$q$, :'b01', :'a02', :'yog', :'lot1'),
                'is free at', 'reserved stock cannot be moved away');   -- 32 on hand, 2 reserved for the backorder
select t.ok((select sum(reserved) from public.stock_levels where variant_id = :'yog') = 2, 'the backorder keeps its reservation');

-- ---------- cycle count ------------------------------------------------------------------
select public.create_cycle_count(:'wh', array[:'a01'::uuid]) as cc \gset
select t.ok((select (status, blind_count) = ('in_progress', true) from public.cycle_counts where id = :'cc'), 'count starts blind and in progress');
select t.ok((public.count_item(:'cc', :'tea', :'a01', 1))->'system_qty' = 'null'::jsonb, 'blind count hides the system quantity');
select public.count_item(:'cc', :'tea', :'a01', 54, null, true);
select public.count_item(:'cc', :'yog', :'a01', 1, :'lot1');      -- found a yogurt where the system has none
select t.throws(format($q$select public.count_item(%L, %L, %L, 1)$q$, :'cc', :'yog', :'a01'), 'lot', 'lot items need their lot when counted');
-- stock moves out of the bin after the tea was counted: posting must not put it back
select public.move_stock(:'a01', :'a02', jsonb_build_array(jsonb_build_object('variant_id', :'tea', 'quantity', 4)));
select public.submit_cycle_count(:'cc');
select t.throws(format($q$select public.post_cycle_count(%L)$q$, :'cc'), 'inventory.write', 'a warehouse operator cannot post a count');
select t.login('ivo@wms.al');
select public.post_cycle_count(:'cc') as ccr \gset
select t.ok((:'ccr'::jsonb)->>'adjustment_status' = 'posted' and ((:'ccr'::jsonb)->>'lines')::int = 2, 'count posts one adjustment for both differences');
select t.ok(pg_temp.qty(:'a01', :'tea') = 50 and pg_temp.qty(:'a01', :'yog') = 1, 'stock matches the count, less what moved out after counting');
select t.ok((select reason from public.stock_adjustments where id = (select adjustment_id from public.cycle_counts where id = :'cc')) = 'count',
            'the adjustment is linked and marked as a count');

-- ---------- lot traceability ------------------------------------------------------------
select public.lot_trace(:'lot1') as tr \gset
select t.ok(((:'tr'::jsonb)->>'received')::numeric = 41 and ((:'tr'::jsonb)->>'shipped')::numeric = 8, 'lot trace totals in and out');
select t.ok((:'tr'::jsonb)->'customers'->0->>'name' = 'Hotel Tirana', 'recall list names the customer');
select t.ok(exists (select 1 from public.lots_expiring(:'co', 30) where lot_id = :'lot1'), 'lot shows on the expiry watch list');

-- ---------- point of sale ---------------------------------------------------------------
select t.login('alice@alba.al');
insert into public.bank_accounts (company_id, name, account_kind, currency_code, account_id)
select :'co', 'Till 1 drawer', 'cash', 'ALL', id from public.accounts where company_id = :'co' and code = '5311' returning id as drawer \gset
insert into public.pos_registers (company_id, code, name, warehouse_id, location_id, cash_account_id, journal_id)
select :'co', 'T1', 'Till 1', :'shop', :'floor', :'drawer', id from public.journals where company_id = :'co' and code = 'POS' returning id as reg \gset
select t.login('cora@wms.al');
select t.ok((select price from public.pos_catalog(:'reg') where variant_id = :'tea') = 120, 'catalog prices include VAT');
select public.open_pos_session(:'reg', 2000) as ses \gset
select t.throws(format($q$select public.open_pos_session(%L, 0)$q$, :'reg'), 'already has an open session', 'one open session per register');
select gen_random_uuid() as c1 \gset
select public.pos_submit_order(jsonb_build_object('client_uuid', :'c1', 'session_id', :'ses', 'device_ref', 'T1-0001',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'tea', 'quantity', 2, 'unit_price', 120)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 300)))) as r1 \gset
select t.ok(((:'r1'::jsonb)->>'change')::numeric = 60 and ((:'r1'::jsonb)->>'total')::numeric = 240, 'sale: total 240, change 60');
select t.ok((public.pos_submit_order(jsonb_build_object('client_uuid', :'c1', 'session_id', :'ses',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'tea', 'quantity', 2, 'unit_price', 120)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 300)))))->>'duplicate' = 'true', 'replaying a queued sale is a no-op');
select t.ok((select count(*) from public.pos_orders where session_id = :'ses') = 1, 'still one receipt');
select t.ok(pg_temp.qty(:'floor', :'tea') = 18, 'stock leaves the shop floor at the sale');
select t.ok((select subtotal from public.pos_orders where client_uuid = :'c1') = 200 and (select tax_total from public.pos_orders where client_uuid = :'c1') = 40,
            'net and VAT derived from the tax-inclusive price');
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses', 'offline', true,
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'yog', 'quantity', 1, 'unit_price', 180)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'card', 'amount', 180, 'reference', '**** 4242'))));
select t.ok(pg_temp.qty(:'floor', :'yog') = -1, 'the till sells even without stock on the floor (negative, flagged)');
select t.ok((select lot_id from public.pos_order_lines ol join public.pos_orders o on o.id = ol.pos_order_id where o.session_id = :'ses' and ol.variant_id = :'yog') = :'lot1'::uuid,
            'a lot is chosen for lot-tracked items');
select t.throws(format($q$select public.pos_submit_order('{"client_uuid":"%s","session_id":"%s","lines":[{"variant_id":"%s","quantity":1,"unit_price":120}],"payments":[{"method":"card","amount":150}]}')$q$,
                gen_random_uuid(), :'ses', :'tea'), 'Change can only be given from cash', 'no change from card payments');
select t.throws(format($q$select public.pos_submit_order('{"client_uuid":"%s","session_id":"%s","lines":[{"variant_id":"%s","quantity":1,"unit_price":120,"discount_pct":50}],"payments":[{"method":"cash","amount":60}]}')$q$,
                gen_random_uuid(), :'ses', :'tea'), 'need a manager', 'big discounts need a manager');
select id as o1 from public.pos_orders where client_uuid = :'c1' \gset
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses', 'is_refund', true, 'refund_of_id', :'o1',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'tea', 'quantity', -1, 'unit_price', 120)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', -120))));
select t.throws(format($q$select public.pos_submit_order('{"client_uuid":"%s","session_id":"%s","is_refund":true,"refund_of_id":"%s","lines":[{"variant_id":"%s","quantity":-2,"unit_price":120}],"payments":[{"method":"cash","amount":-240}]}')$q$,
                gen_random_uuid(), :'ses', :'o1', :'tea'), 'more than what is left', 'cannot refund more than was sold');
select t.ok(pg_temp.qty(:'floor', :'tea') = 19, 'refunded item is back on the floor');
select public.pos_cash_move(:'ses', 'cash_out', 500, 'To the safe');
select t.ok(((app.pos_summary_all(:'ses'))->>'expected_cash')::numeric = 1620, 'X-report: expected cash 2000 + 240 − 120 − 500');
select public.close_pos_session(:'ses', 1610) as z \gset
select t.ok((select (order_count, refund_count, gross_sales, refunds_total, expected_cash, cash_difference) = (2, 1, 420.00, 120.00, 1620.00, -10.00)
               from public.z_reports where id = :'z'), 'Z-report: counts, sales, refunds and the cash difference');
select t.ok((select payments_by_method->>'card' from public.z_reports where id = :'z')::numeric = 180, 'Z-report: payments by method');
select t.ok((select status from public.pos_sessions where id = :'ses') = 'closed', 'session closed');
select t.login('alice@alba.al');   -- the ledger is not visible to cashiers
select t.ok(pg_temp.bal(:'co', '5311') = 0, 'drawer account is emptied into the cash box at close');
select t.ok(pg_temp.bal(:'co', '531') = -2000 + 500 + 1610, 'cash box: float out, cash out and the counted cash back in');
select t.ok(pg_temp.bal(:'co', '658') = 10, 'cash shortage booked');
select t.ok(pg_temp.bal(:'co', '701') <= -250 and pg_temp.bal(:'co', '581') = 180, 'revenue net of the refund and card payments in transit');
select t.ok((select count(*) from public.journal_entries where source_doc_type = 'pos_order' and journal_id = (select id from public.journals where company_id = :'co' and code = 'POS')) = 3,
            'each receipt posts its cost of sales in the POS journal');
select t.login('cora@wms.al');
select t.throws(format($q$select public.pos_submit_order('{"client_uuid":"%s","session_id":"%s","lines":[{"variant_id":"%s","quantity":1,"unit_price":120}],"payments":[{"method":"cash","amount":120}]}')$q$,
                gen_random_uuid(), :'ses', :'tea'), 'SESSION_CLOSED', 'a closed session takes no new sales');
select t.ok((public.pos_submit_order(jsonb_build_object('client_uuid', :'c1', 'session_id', :'ses', 'lines', '[]'::jsonb)))->>'duplicate' = 'true',
            'but a late replay of a synced sale is still recognised');

-- ---------- invariants and permissions -----------------------------------------------------
select t.login('alice@alba.al');
select t.ok((select sum(total_debit) = sum(total_credit) from public.journal_entries where company_id = :'co' and status = 'posted'), 'every entry balances');
select t.ok(pg_temp.bal(:'co', '311') = (select round(sum(total_value), 2) from t.item_costs where company_id = :'co'), 'GL inventory equals the stock valuation');
select t.login('cora@wms.al');
select t.throws(format($q$select public.create_pick_list(array[%L::uuid])$q$, :'dl'), 'wms.write', 'cashiers cannot pick');
select t.throws(format($q$insert into public.pos_orders (company_id, client_uuid, session_id, register_id) values (%L, gen_random_uuid(), %L, %L)$q$, :'co', :'ses', :'reg'),
                'set by its own action', 'receipts are created by the till function only');

select t.ok((select array_agg(permission order by permission) from public.role_permissions rp join public.roles r on r.id = rp.role_id where r.key = 'store_manager') @> array['pos.*','wms.write'],
            'store managers run tills, approve discounts and handle store stock');

reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
