-- =============================================================================
-- DrisPRO · FIFO costing, saved reports and cross tables, the hotel (runs after 01–30)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Hotel Test', 'country', 'AL', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 10,
  'valid_until', (current_date + 365)::text)) as co \gset
select t.login('alice@alba.al');
select id as pcs from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select id as vat from public.tax_codes where company_id = :'co' and rate = 20 and deleted_at is null limit 1 \gset
select id as stock from public.warehouse_locations where company_id = :'co' and code = 'WH/STOCK' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'VER', 'name', 'Verë', 'uom_id', :'pcs', 'sales_price', 500, 'sales_tax_code_id', :'vat')) as p_ver \gset
select id as ver from public.product_variants where product_id = :'p_ver' \gset

-- ---------- FIFO --------------------------------------------------------------------------------
reset role;
select app.virtual_location(:'co', 'supplier') as sup, app.virtual_location(:'co', 'adjustment') as adj \gset
select app.post_stock_move(:'co', 'receipt', :'ver', :'sup', :'stock', 4, 90, null, null, null, null, 'R0', now() - interval '3 days');
set role authenticated;
select t.login('alice@alba.al');
select (public.costing_method_set(:'co', 'fifo') ->> 'layers')::int as n \gset
select t.ok(:n = 1, 'switching to FIFO turns what is in stock into the first layer');
reset role;
select app.post_stock_move(:'co', 'receipt', :'ver', :'sup', :'stock', 10, 100, null, null, null, null, 'R1', now() - interval '2 days');
select app.post_stock_move(:'co', 'receipt', :'ver', :'sup', :'stock', 10, 130, null, null, null, null, 'R2', now() - interval '1 day');
select app.post_stock_move(:'co', 'adjustment_out', :'ver', :'stock', :'adj', 15) as mv \gset
select t.ok((select total_cost from public.stock_movements where id = :'mv') = 4 * 90 + 10 * 100 + 1 * 130, 'the oldest layers leave first: 4 × 90 + 10 × 100 + 1 × 130');
select t.ok((select total_value from public.item_costs where variant_id = :'ver') = 9 * 130, 'what is left is valued at the newest cost');
select t.ok((select sum(qty_left) from public.cost_layers where variant_id = :'ver') = 9, 'the layers hold what is in stock');
-- a value change made elsewhere (landed costs) follows into the layers
select app.post_value_adjustment(:'co', :'ver', :'stock', 90, null, null, null, 'LC');
select t.ok((select unit_cost from public.cost_layers where variant_id = :'ver' and qty_left > 0) = 140, 'landed costs raise the layers still in stock');
select app.post_stock_move(:'co', 'adjustment_out', :'ver', :'stock', :'adj', 9) as mv2 \gset
select t.ok((select total_cost from public.stock_movements where id = :'mv2') = 1260 and (select total_value from public.item_costs where variant_id = :'ver') = 0,
  'emptying the stock takes the exact value left');
set role authenticated;
select t.login('alice@alba.al');
select public.costing_method_set(:'co', 'weighted_average');
select t.ok((select count(*) from public.cost_layers where company_id = :'co') = 0, 'back to the average: the layers go');

-- ---------- cross table and saved reports ------------------------------------------------------
select public.run_report(:'co', 'inventory', '{"group_by":"product","pivot_by":"warehouse"}') as rep \gset
select t.ok(:'rep'::jsonb ? 'pivot' and :'rep'::jsonb ->> 'pivot_by' = 'warehouse', 'a second grouping gives a cross table');
select t.throws(format($q$select public.run_report(%L, 'sales', '{"group_by":"customer","pivot_by":"x; drop"}')$q$, :'co'), 'Cannot group', 'unknown cross groupings are refused');
insert into public.saved_reports (company_id, name, report, params) values (:'co', 'Shitjet sipas muajit', 'sales', '{"group_by":"month","period":"this_year"}') returning id as sr \gset
select t.ok((select count(*) from public.saved_reports where id = :'sr') = 1, 'a report is saved');
select public.invite_member(:'co', 'ola@hr.al', array['sales_manager']);
select t.accept_invites();
select t.login('ola@hr.al');
select t.ok((select count(*) from public.saved_reports where id = :'sr') = 0, 'another user does not see it until it is shared');
select t.login('alice@alba.al');
update public.saved_reports set is_shared = true where id = :'sr';
select t.login('ola@hr.al');
select t.ok((select count(*) from public.saved_reports where id = :'sr') = 1, 'shared, the others see it');
update public.saved_reports set name = 'x' where id = :'sr';
select t.ok((select name from public.saved_reports where id = :'sr') = 'Shitjet sipas muajit', 'only its owner changes it');

-- ---------- hotel -------------------------------------------------------------------------------
select t.login('alice@alba.al');
insert into public.hotel_room_types (company_id, name, capacity, rate) values (:'co', 'Dyshe', 2, 6000) returning id as dbl \gset
insert into public.hotel_rooms (company_id, number, room_type_id, floor) values (:'co', '101', :'dbl', '1') returning id as r101 \gset
insert into public.hotel_rooms (company_id, number, room_type_id, floor) values (:'co', '102', :'dbl', '1') returning id as r102 \gset
insert into public.hotel_reservations (company_id, room_id, guest_name, guest_phone, check_in, check_out, rate)
values (:'co', :'r101', 'Ana Gjoni', '+355691234567', current_date - 2, current_date + 1, 6000) returning id as res, number as resno \gset
select t.ok(:'resno' like 'REZ-%', 'reservations are numbered');
select t.throws(format($q$insert into public.hotel_reservations (company_id, room_id, guest_name, check_in, check_out, rate)
  values (%L, %L, 'Tjetri', current_date, current_date + 2, 6000)$q$, :'co', :'r101'), 'already taken', 'a room holds one stay at a time');
insert into public.hotel_reservations (company_id, room_id, guest_name, check_in, check_out, rate)
values (:'co', :'r101', 'Pas saj', current_date + 1, current_date + 3, 6000);
select t.ok(true, 'the next guest can arrive on the day the first leaves');
select t.ok((public.hotel_calendar(:'co', current_date, current_date + 7) -> 'rooms') @> jsonb_build_array(jsonb_build_object('number', '101')), 'the calendar lists the rooms');
select t.ok((public.hotel_today(:'co') ->> 'occupied')::int = 1 and (public.hotel_today(:'co') ->> 'occupancy')::numeric = 50, 'one room of two is taken today');
select public.hotel_check_in(:'res');
select t.ok((select status from public.hotel_reservations where id = :'res') = 'checked_in', 'the guest checks in');
insert into public.hotel_charges (company_id, reservation_id, description, quantity, unit_price) values (:'co', :'res', 'Minibar', 2, 300);
select public.hotel_check_out(:'res') as inv \gset
-- leaving a night early: two nights are invoiced
select t.ok((select total from public.sales_invoices where id = :'inv') = 2 * 6000 + 600, 'check-out invoices the nights stayed and the extras, VAT included');
select t.ok((select housekeeping from public.hotel_rooms where id = :'r101') = 'dirty', 'the room goes to cleaning');
select t.ok((select check_out from public.hotel_reservations where id = :'res') = current_date, 'the stay ends today');
select t.ok((select name from public.business_partners where id = (select partner_id from public.sales_invoices where id = :'inv')) = 'Ana Gjoni',
  'a walk-in guest gets a customer record');

reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
