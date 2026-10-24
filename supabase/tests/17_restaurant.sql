-- =============================================================================
-- NexusERP Pro · restaurant (runs after 16; uses the shop and till T9 from 06/16)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

set role authenticated;
select t.login('alice@alba.al');
select id as co from public.companies where name = 'Magazina Test' \gset
select id as shop from public.warehouses where company_id = :'co' and code = 'SHOP' \gset
select id as reg from public.pos_registers where company_id = :'co' and code = 'T9' \gset
select id as ses from public.pos_sessions where register_id = :'reg' and status = 'open' \gset
select id as c_tea from public.product_categories where company_id = :'co' and name = 'Tea' \gset
select id as pcs from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select id as vat20 from public.tax_codes where company_id = :'co' and code = 'VAT20' \gset
select v.id as tea from public.product_variants v join public.products p on p.id = v.product_id where p.company_id = :'co' and p.code = 'TEA' \gset
update public.pos_registers set mode = 'restaurant' where id = :'reg';

-- the room
insert into public.restaurant_areas (company_id, warehouse_id, name) values (:'co', :'shop', 'Salla') returning id as area \gset
insert into public.restaurant_tables (company_id, area_id, name, seats) values (:'co', :'area', 'T1', 4) returning id as t1 \gset
insert into public.restaurant_tables (company_id, area_id, name, seats) values (:'co', :'area', 'T2', 2) returning id as t2 \gset
insert into public.kitchen_stations (company_id, warehouse_id, name, category_ids) values (:'co', :'shop', 'Bari', array[:'c_tea'::uuid]) returning id as bar \gset
insert into public.kitchen_stations (company_id, warehouse_id, name, is_default) values (:'co', :'shop', 'Kuzhina', true) returning id as kitchen \gset

-- a dish with a recipe: one serving uses 0.1 of the tea
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'CAJ', 'name', 'Çaj mali', 'uom_id', :'pcs', 'product_type', 'consumable',
       'sales_price', 50, 'sales_tax_code_id', :'vat20', 'purchase_tax_code_id', :'vat20')) as p_caj \gset
select id as caj from public.product_variants where product_id = :'p_caj' \gset
insert into public.boms (company_id, code, variant_id, name, bom_type) values (:'co', 'R-CAJ', :'caj', 'Çaj mali', 'kit') returning id as bom \gset
insert into public.bom_lines (company_id, bom_id, line_no, component_variant_id, quantity) values (:'co', :'bom', 1, :'tea', 0.1);

-- the waiter
select t.login('cora@wms.al');
select public.restaurant_open(:'reg', :'t1', 3) as tab \gset
select t.ok(public.restaurant_open(:'reg', :'t1', 2) = :'tab'::uuid, 'opening a busy table joins its order');
select public.restaurant_add(:'tab', jsonb_build_array(jsonb_build_object('variant_id', :'tea', 'quantity', 2),
                                                       jsonb_build_object('variant_id', :'caj', 'quantity', 1, 'note', 'pa sheqer')));
select t.ok((select count(*) from public.table_order_lines where table_order_id = :'tab' and status = 'new') = 2, 'items wait on the order until sent');
select t.ok((select unit_price from public.table_order_lines where table_order_id = :'tab' and variant_id = :'tea') = 120, 'the price is the till price with VAT');
select t.ok((select (o ->> 'total')::numeric from jsonb_array_elements(public.restaurant_floor(:'reg') -> 'orders') o where o ->> 'table_id' = :'t1') = 300, 'the floor shows what the table owes');
select public.restaurant_send(:'tab') as sent \gset
select t.ok(jsonb_array_length(:'sent'::jsonb -> 'tickets') = 2, 'one ticket for the bar, one for the kitchen');
select t.ok(exists (select 1 from jsonb_array_elements(:'sent'::jsonb -> 'tickets') x where x ->> 'station' = 'Kuzhina' and x -> 'lines' -> 0 ->> 'note' = 'pa sheqer'),
  'the note reaches the kitchen');
select t.ok(jsonb_array_length(public.restaurant_kitchen(:'shop', :'bar')) = 1 and (public.restaurant_kitchen(:'shop', :'bar') -> 0 -> 'lines' -> 0 ->> 'name') like 'Mountain%',
  'the bar screen shows only bar items');
select id as tea_line from public.table_order_lines where table_order_id = :'tab' and variant_id = :'tea' \gset
select public.restaurant_set_status(array[:'tea_line'::uuid], 'ready');
select t.ok((select status from public.table_order_lines where id = :'tea_line') = 'ready', 'the bar marks it ready');
select t.throws(format($q$select public.restaurant_change_line(%L, 5)$q$, :'tea_line'), 'gone to the kitchen', 'sent items cannot be changed');
select t.throws(format($q$select public.restaurant_void(%L, 'mistake')$q$, :'tea_line'), 'needs a manager', 'a waiter cannot cancel what the kitchen has');

-- split the bill: one guest pays one tea
select public.restaurant_pay(jsonb_build_object('tab_id', :'tab', 'session_id', :'ses', 'client_uuid', gen_random_uuid(),
  'split', jsonb_build_array(jsonb_build_object('line_id', :'tea_line', 'quantity', 1)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 120)))) as pay1 \gset
select t.ok((:'pay1'::jsonb ->> 'total')::numeric = 120 and not (:'pay1'::jsonb ->> 'closed')::boolean, 'part of the bill is paid, the table stays open');
select t.ok((select sum(quantity) from public.table_order_lines where table_order_id = :'tab' and variant_id = :'tea' and pos_order_id is null) = 1, 'one tea is still to pay');
select public.restaurant_pay(jsonb_build_object('tab_id', :'tab', 'session_id', :'ses', 'client_uuid', gen_random_uuid(),
  'payments', jsonb_build_array(jsonb_build_object('method', 'card', 'amount', 180)))) as pay2 \gset
select t.ok((:'pay2'::jsonb ->> 'closed')::boolean and (select status from public.table_orders where id = :'tab') = 'paid', 'paying the rest frees the table');
select t.ok((select table_order_id = :'tab'::uuid and waiter_id is not null from public.pos_orders where id = (:'pay2'::jsonb ->> 'id')::uuid), 'the receipt knows its table and waiter');
reset role;
select t.ok((select sum(m.quantity) from public.stock_movements m join public.pos_order_lines ol on ol.id = m.source_line_id
              where ol.pos_order_id = (:'pay2'::jsonb ->> 'id')::uuid and ol.variant_id = :'caj' and m.variant_id = :'tea') = 0.1,
  'the recipe takes its ingredients out of stock');
select t.ok((select unit_cost > 0 from public.pos_order_lines where pos_order_id = (:'pay2'::jsonb ->> 'id')::uuid and variant_id = :'caj'), 'and the dish gets their cost');
set role authenticated;
select t.login('cora@wms.al');

-- move and merge tables
select public.restaurant_open(:'reg', :'t2', 2) as tab2 \gset
select public.restaurant_add(:'tab2', jsonb_build_array(jsonb_build_object('variant_id', :'tea', 'quantity', 1)));
select public.restaurant_move(:'tab2', :'t1') as mv1 \gset
select t.ok(:'mv1' = :'tab2' and (select table_id from public.table_orders where id = :'tab2') = :'t1'::uuid, 'an order moves to a free table');
select public.restaurant_open(:'reg', :'t2', 1) as tab3 \gset
select public.restaurant_add(:'tab3', jsonb_build_array(jsonb_build_object('variant_id', :'caj', 'quantity', 2)));
select public.restaurant_move(:'tab3', :'t1') as mv2 \gset
select t.ok(:'mv2' = :'tab2' and (select count(*) from public.table_order_lines where table_order_id = :'tab2') = 2
  and (select status from public.table_orders where id = :'tab3') = 'cancelled', 'moving onto a busy table merges the orders');
select t.throws(format($q$select public.restaurant_close_empty(%L)$q$, :'tab2'), 'still has items', 'an order with items cannot just be closed');
select t.login('alice@alba.al');
select id as caj_line from public.table_order_lines where table_order_id = :'tab2' and variant_id = :'caj' \gset
select public.restaurant_send(:'tab2');
select public.restaurant_void(:'caj_line', 'Klienti ndryshoi mendje');
select t.ok((select status from public.table_order_lines where id = :'caj_line') = 'void', 'a manager cancels a sent item');
select t.throws(format($q$select public.restaurant_pay('{"tab_id":"%s","session_id":"%s","client_uuid":"%s","payments":[{"method":"cash","amount":50}]}')$q$, :'tab2', :'ses', gen_random_uuid()),
  'short', 'the bill must be paid in full');
reset role;

-- deleting a client completely (the shop above has stock, accounting, tills, cards and tables)
set role authenticated;
select t.login('alice@alba.al');
select t.throws(format($q$select public.platform_delete_client(%L, 'Magazina Test')$q$, :'co'), 'platform', 'only the platform administrator deletes clients');
select t.login('zoe@platform.io');
select t.throws(format($q$select public.platform_delete_client(%L, 'magazina')$q$, :'co'), 'name exactly', 'the name must be typed exactly');
-- the slow path, as on a server where triggers cannot be switched off for a session
select set_config('app.purge_no_replica', 'on', false);
select public.platform_delete_client(:'co', 'Magazina Test') as del \gset
select t.ok(not (:'del'::jsonb ->> 'fast')::boolean and (:'del'::jsonb ->> 'rows')::int > 100, 'every row went, round by round');
reset role;
select t.ok(not exists (select 1 from public.companies where id = :'co'), 'the client is gone');
select t.ok((select bool_and(n = 0) from (select (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I where company_id = %L', c.relname, :'co'), false, true, '')))[1]::text::int as n
               from pg_class c join pg_namespace s on s.oid = c.relnamespace join pg_attribute a on a.attrelid = c.oid and a.attname = 'company_id'
              where s.nspname = 'public' and c.relkind = 'r') x), 'no row of it is left in any table');
select t.ok(not exists (select 1 from auth.users where email = 'cora@wms.al') and exists (select 1 from auth.users where email = 'alice@alba.al'),
  'people only in that company are removed; people with other companies stay');
select t.ok((select bool_and(tgenabled <> 'D') from pg_trigger where not tgisinternal and tgrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)),
  'every paused rule is back on');
-- and the fast path on another client
set role authenticated;
select t.login('zoe@platform.io');
select set_config('app.purge_no_replica', 'off', false);
select (public.platform_delete_client(id, name) ->> 'fast')::boolean as fast2 from public.companies where name = 'Lider Live' \gset
reset role;
select t.ok(not exists (select 1 from public.companies where name = 'Lider Live'), 'a second client goes too');

\set QUIET off
select count(*) as assertions_passed from t.results;
