-- =============================================================================
-- DrisPRO · Phase 8 logistics, order management and e-commerce tests (runs after 01–09)
-- Route day: two orders on a 50 kg van (cash on delivery on one), a failed stop
-- handed to a carrier, COD settled into the cash box. Replenishment nets stock
-- against unreserved demand; a store is refilled by transfer. Web orders are
-- imported once per external id.
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

insert into auth.users (email, raw_user_meta_data) values
  ('lou@log.al', '{"full_name":"Lou Logistics"}'), ('wade@log.al', '{"full_name":"Wade Warehouse"}'),
  ('pam@log.al', '{"full_name":"Pam Purchasing"}'), ('sid@log.al', '{"full_name":"Sid Sales"}'),
  ('fin@log.al', '{"full_name":"Fin Accountant"}'), ('cash@log.al', '{"full_name":"Cash Cashier"}');

set role authenticated;
select t.login('alice@alba.al');
select public.create_company('Logjistika Test', 'AL') as co \gset
select public.invite_member(:'co', 'lou@log.al', array['logistics_manager']);
select public.invite_member(:'co', 'wade@log.al', array['warehouse_operator']);
select public.invite_member(:'co', 'pam@log.al', array['procurement_manager']);
select public.invite_member(:'co', 'sid@log.al', array['sales_manager']);
select public.invite_member(:'co', 'fin@log.al', array['accountant']);
select public.invite_member(:'co', 'cash@log.al', array['pos_cashier']);
select id as wh    from public.warehouses where company_id = :'co' and code = 'WH' \gset
select id as stock from public.warehouse_locations where company_id = :'co' and code = 'WH/STOCK' \gset
select id as pcs   from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select id as vat20 from public.tax_codes where company_id = :'co' and code = 'VAT20' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'BOX', 'name', 'Carton of water', 'uom_id', :'pcs', 'weight_kg', 2,
       'sales_price', 1000, 'sales_tax_code_id', :'vat20')) as p \gset
select id as box from public.product_variants where product_id = :'p' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'CUP', 'name', 'Paper cups', 'uom_id', :'pcs', 'weight_kg', 0.1,
       'sales_price', 100, 'sales_tax_code_id', :'vat20')) as p \gset
select id as cup from public.product_variants where product_id = :'p' \gset
update public.product_variants set weight_kg = 2 where id = :'box';
insert into public.stock_adjustments (company_id, warehouse_id, reason) values (:'co', :'wh', 'opening') returning id as op \gset
insert into public.stock_adjustment_lines (company_id, adjustment_id, variant_id, location_id, quantity_change, unit_cost) values
  (:'co', :'op', :'box', :'stock', 100, 500), (:'co', :'op', :'cup', :'stock', 50, 20);
select public.post_stock_adjustment(:'op');

insert into public.business_partners (company_id, code, name, kind, is_customer) values (:'co', 'C1', 'Market Tirana', 'company', true) returning id as c1 \gset
insert into public.business_partners (company_id, code, name, kind, is_customer) values (:'co', 'C2', 'Market Durrës', 'company', true) returning id as c2 \gset
insert into public.business_partners (company_id, code, name, kind, is_vendor) values (:'co', 'V1', 'Ujë Shpk', 'company', true) returning id as v1 \gset
insert into public.partner_addresses (company_id, partner_id, address_type, line1, city, is_default) values
  (:'co', :'c1', 'shipping', 'Rruga e Kavajës 10', 'Tirana', true), (:'co', :'c2', 'shipping', 'Lagjia 1, Rruga Taulantia', 'Durrës', true);
insert into public.vendor_products (company_id, vendor_id, variant_id, price, currency_code, is_preferred) values (:'co', :'v1', :'box', 450, 'ALL', true);
insert into public.employees (company_id, first_name, last_name, hire_date) values (:'co', 'Driton', 'Driver', '2024-01-01') returning id as drv \gset
insert into public.carriers (company_id, code, name, carrier_type) values (:'co', 'OWN', 'Own fleet', 'own_fleet') returning id as own \gset
insert into public.carriers (company_id, code, name, carrier_type, tracking_url_template) values (:'co', 'DHL', 'DHL Express', 'external', 'https://www.dhl.com/track?id={tracking}')
returning id as dhl \gset
insert into public.vehicles (company_id, plate_number, name, capacity_kg, driver_employee_id) values (:'co', 'AA 123 BB', 'Van 1', 50, :'drv') returning id as van \gset

create or replace function pg_temp.order(p_co uuid, p_c uuid, p_wh uuid, p_v uuid, p_q numeric, p_tax uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.sales_orders (company_id, partner_id, warehouse_id, currency_code) values (p_co, p_c, p_wh, 'ALL') returning id into v;
  insert into public.sales_order_lines (company_id, sales_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
  values (p_co, v, 1, p_v, 'Item', p_q, 1000, p_tax);
  perform public.confirm_sales_order(v);
  return v;
end $$;
select pg_temp.order(:'co', :'c1', :'wh', :'box', 10, :'vat20') as so1 \gset
select pg_temp.order(:'co', :'c2', :'wh', :'box', 15, :'vat20') as so2 \gset
select pg_temp.order(:'co', :'c1', :'wh', :'box', 30, :'vat20') as so3 \gset
select public.create_delivery_from_order(:'so1') as dl1 \gset
select public.create_delivery_from_order(:'so2') as dl2 \gset
select public.create_delivery_from_order(:'so3') as dl3 \gset
update public.deliveries set status = 'ready' where id in (:'dl1', :'dl2', :'dl3');

-- ---------- shipments and the route -------------------------------------------------------------
select t.login('lou@log.al');
select t.ok((select count(*) from public.dispatch_queue(:'co') where kind = 'delivery') = 3, 'three picked deliveries wait for dispatch');
select public.create_shipment(:'dl1', '{"cod_amount": 12000}') as s1 \gset
select public.create_shipment(:'dl2') as s2 \gset
select public.create_shipment(:'dl3') as s3 \gset
select t.throws(format($q$select public.create_shipment(%L)$q$, :'dl1'), 'already has a shipment', 'one live shipment per delivery');
select t.ok((select (weight_kg, city, cod_amount) = (20.000, 'Tirana', 12000.00) from public.shipments where id = :'s1'),
            'shipment takes weight from the products and the customer''s address');
select public.create_route(:'co', current_date, :'wh', :'van', null, array[:'s1', :'s2']::uuid[]) as rt \gset
select t.ok((select array_agg(shipment_id order by sequence) from public.route_stops where route_id = :'rt') = array[:'s2', :'s1']::uuid[],
            'stops grouped by city (Durrës, then Tirana)');
select t.ok((select driver_employee_id from public.delivery_routes where id = :'rt') = :'drv'::uuid, 'the van''s driver is the route''s driver');
select t.throws(format($q$select public.assign_to_route(%L, array[%L]::uuid[])$q$, :'rt', :'s3'), 'capacity is 50 kg', 'the van cannot carry 110 kg');
select t.throws(format($q$select public.create_route(%L, current_date, %L, %L)$q$, :'co', :'wh', :'van'), 'already has a route', 'a van and its driver run one route a day');
select id as st_s1 from public.route_stops where shipment_id = :'s1' \gset
select id as st_s2 from public.route_stops where shipment_id = :'s2' \gset
select public.reorder_route(:'rt', array[:'st_s1', :'st_s2']::uuid[]);
select t.ok((select sequence from public.route_stops where id = :'st_s1') = 1, 'stops can be reordered');

select t.login('wade@log.al');
select public.start_route(:'rt');
select t.ok((select array_agg(status order by number) from public.deliveries where id in (:'dl1', :'dl2')) = array['done','done'],
            'leaving the warehouse posts the deliveries');
select t.ok((select sum(on_hand) from public.stock_levels where variant_id = :'box') = 75, 'stock left: 100 − 25');
select t.ok((select array_agg(status) from public.shipments where id in (:'s1', :'s2')) = array['in_transit','in_transit'], 'shipments in transit');
select t.throws(format($q$select public.record_stop(%L, 'delivered')$q$, :'st_s1'), 'Collect', 'cash on delivery must be collected first');
select public.record_stop(:'st_s1', 'delivered', 'Signed by the shop', true);
select t.throws(format($q$select public.record_stop(%L, 'failed')$q$, :'st_s2'), 'Say why', 'a failed stop needs a reason');
select public.record_stop(:'st_s2', 'failed', 'Shop closed');
select public.complete_route(:'rt', 84);
select t.ok((select (status, actual_distance_km) = ('completed', 84.00) from public.delivery_routes where id = :'rt'), 'route completed with the kilometres driven');
select t.login('sid@log.al');
select t.ok(exists (select 1 from public.notifications where title like 'Delivery failed:%'), 'sales hears about the failed delivery');

select t.login('lou@log.al');
select public.update_shipment(:'s2', 'scheduled', 'Try again with a carrier');
select public.ship_with_carrier(:'s2', :'dhl', 'JD014600');
select public.update_shipment(:'s2', 'delivered', 'Delivered by DHL');
select t.ok((select (status, attempts, tracking_number) = ('delivered', 2::smallint, 'JD014600') from public.shipments where id = :'s2'),
            'second attempt by carrier delivered');
select t.ok((select array_agg(status order by event_at, id) from public.shipment_events where shipment_id = :'s2')
            @> array['draft','scheduled','in_transit','failed','delivered'], 'tracking history of every step');
select t.throws(format($q$select public.ship_with_carrier(%L, %L, '')$q$, :'s3', :'dhl'), 'tracking number', 'external carriers need a tracking number');

-- ---------- cash on delivery → customer receipt ----------------------------------------------------
select t.login('alice@alba.al');
select public.create_invoice_from_order(:'so1') as inv1 \gset
select public.post_sales_invoice(:'inv1');
select t.login('fin@log.al');
select id as cashbox from public.bank_accounts where company_id = :'co' and account_kind = 'cash' limit 1 \gset
select public.settle_cod(array[:'s1']::uuid[], :'cashbox');
select t.ok((select (payment_status, amount_due) = ('paid', 0.00) from public.sales_invoices where id = :'inv1'), 'COD receipt pays the order''s invoice');
select t.throws(format($q$select public.settle_cod(array[%L]::uuid[], %L)$q$, :'s1', :'cashbox'), 'already settled', 'settled once');
select t.login('lou@log.al');
select public.logistics_overview(:'co') as lo \gset
select t.ok((:'lo'::jsonb ->> 'delivered')::int = 2 and (:'lo'::jsonb ->> 'cod_to_settle')::numeric = 0 and (:'lo'::jsonb ->> 'first_attempt_pct')::numeric = 50,
            'overview: 2 delivered, half at the first attempt, nothing left to settle');

-- ---------- replenishment: demand, transfers, automated purchase orders -----------------------------
select t.login('alice@alba.al');
select pg_temp.order(:'co', :'c2', :'wh', :'box', 60, :'vat20') as so4 \gset
insert into public.warehouses (company_id, code, name, warehouse_type) values (:'co', 'ST1', 'Store Blloku', 'store') returning id as store \gset
insert into public.warehouse_locations (company_id, warehouse_id, code, name) values (:'co', :'store', 'ST1/STOCK', 'Shop floor');
insert into public.replenishment_rules (company_id, variant_id, warehouse_id, min_qty, max_qty, multiple_qty, preferred_vendor_id) values
  (:'co', :'box', :'wh', 80, 150, 10, :'v1');
insert into public.replenishment_rules (company_id, variant_id, warehouse_id, min_qty, max_qty, multiple_qty, replenish_method, source_warehouse_id) values
  (:'co', :'cup', :'store', 5, 20, 5, 'transfer', :'wh');
select t.login('sid@log.al');
select t.ok((select (reserved, outstanding, state) = (45.0000, 60.0000, 'short') from public.fulfillment_queue(:'co') where sales_order_id = :'so4'),
            'order desk: 45 of 60 reserved, short');
select t.login('pam@log.al');
select public.generate_replenishment(:'co');
select t.ok((select (on_hand, reserved, demand, projected, suggested_qty) = (75.0000, 75.0000, 15.0000, -15.0000, 170.0000)
               from public.replenishment_suggestions where variant_id = :'box' and status = 'open'),
            'buy 170: 75 on hand, all reserved, 15 more ordered → −15, up to 150 in tens');
select t.ok((select (source_warehouse_id, suggested_qty) = (:'wh'::uuid, 20.0000) from public.replenishment_suggestions where variant_id = :'cup' and status = 'open'),
            'the store is refilled with 20 cups from the main warehouse''s surplus');
select public.run_replenishment(:'co', 'draft_po') as run \gset
select t.ok(jsonb_array_length(:'run'::jsonb -> 'purchase_orders') = 1 and :'run'::jsonb #>> '{purchase_orders,0,status}' = 'draft'
            and jsonb_array_length(:'run'::jsonb -> 'transfers') = 1, 'the run creates one draft purchase order and one transfer');
select t.ok((select (vendor_id, total) = (:'v1'::uuid, 91800.00) from public.purchase_orders where id = (:'run'::jsonb #>> '{purchase_orders,0,id}')::uuid),
            'purchase order: 170 × 450 + 20% VAT');
select t.ok(exists (select 1 from public.notifications where title like 'Replenishment: 1 purchase order%'), 'procurement is notified');
reset role;
update public.company_settings set auto_replenish_enabled = true where company_id = :'co';
select t.ok(public.run_scheduled_replenishment(true) >= 1, 'the scheduled job runs for companies that turned it on');
select t.ok((select count(*) from public.purchase_orders where company_id = :'co') = 1, 'incoming orders count, so nothing is ordered twice');
select t.ok((select trigger_kind from public.replenishment_runs where company_id = :'co' order by run_at desc limit 1) = 'schedule', 'scheduled run logged');
set role authenticated;

-- ---------- e-commerce ----------------------------------------------------------------------------------
select t.login('sid@log.al');
insert into public.sales_channels (company_id, name, channel_type, warehouse_id, is_active) values (:'co', 'Web shop', 'custom_api', :'wh', true) returning id as ch \gset
select t.ok(public.link_channel_products(:'ch') = 2, 'products linked by SKU');
select public.ingest_channel_order(:'ch', '{"id":"W-1001","number":"#1001","customer":{"email":"Ana@Shop.al","name":"Ana Web","phone":"+355691234567"},
  "shipping_address":{"line1":"Rruga Myslym Shyri 5","city":"Tirana"},"lines":[{"sku":"BOX","quantity":2,"price":1200}],"shipping":240,"payment":"cod"}') as w1 \gset
select t.ok(:'w1'::jsonb ->> 'status' = 'imported', 'web order imported');
select (:'w1'::jsonb ->> 'sales_order_id') as wso \gset
select t.ok((select (channel, total, customer_reference) = ('ecommerce', 2640.00, '#1001') from public.sales_orders where id = :'wso'),
            'sales order with tax-inclusive prices converted (2 × 1,200 + 240 shipping)');
select t.ok((select email from public.business_partners p join public.sales_orders s on s.partner_id = p.id where s.id = :'wso') = 'ana@shop.al',
            'a new customer is created from the email');
select public.ingest_channel_order(:'ch', '{"id":"W-1001","number":"#1001","customer":{"email":"ana@shop.al"},"lines":[{"sku":"BOX","quantity":2,"price":1200}]}') as w1b \gset
select t.ok(:'w1b'::jsonb ->> 'status' = 'duplicate' and :'w1b'::jsonb ->> 'sales_order_id' = :'wso', 'the same order twice is imported once');
select public.ingest_channel_order(:'ch', '{"id":"W-1002","customer":{"email":"ana@shop.al"},"lines":[{"sku":"NOPE","quantity":1,"price":10}]}') as w2 \gset
select t.ok(:'w2'::jsonb ->> 'status' = 'failed' and :'w2'::jsonb ->> 'error' like 'Unknown SKU: NOPE%', 'unknown SKUs fail the import with a reason');
select t.login('alice@alba.al');
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'NOPE', 'name', 'New item', 'uom_id', :'pcs'));
select t.login('sid@log.al');
select t.ok((public.retry_channel_order((:'w2'::jsonb ->> 'channel_order_id')::uuid)) ->> 'status' = 'imported', 'retried after the product exists');
select t.ok((select (public.sync_channel_stock(:'ch')) -> 'items' @> '[{"sku":"BOX"}]'::jsonb), 'stock sync lists available quantities per SKU');
select t.ok((select count(*) from public.channel_sync_logs where channel_id = :'ch' and status = 'failed') = 1, 'sync log keeps the failure');
select t.login('cash@log.al');
select t.throws(format($q$select public.ingest_channel_order(%L, '{"id":"X"}')$q$, :'ch'), 'Permission denied', 'cashiers cannot import web orders');

reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
