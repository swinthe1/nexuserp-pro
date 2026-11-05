-- =============================================================================
-- From the meeting with the administrative staff, #22: balancing the stock between the units
-- (runs after 64 "Kontrolle Test", 80 and 82: the shop sold beer today, its till is open)
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
-- a depot that does not sell, with beer to spare
insert into public.warehouses (company_id, code, name, warehouse_type) values (:'co', 'DP', 'Depoja', 'warehouse') returning id as depot \gset
insert into public.warehouse_locations (company_id, warehouse_id, code, name, location_type, is_pickable) values (:'co', :'depot', 'DP/1', 'Raft', 'internal', true);
select app.post_stock_move(:'co', 'adjustment_in', :'beer', app.virtual_location(:'co', 'adjustment'), app.main_location(:'depot'), 100, 0.6);
-- the shop sells 30 beers today, and keeps only a few
set role authenticated;
select t.login('cora@kt.al');
select coalesce(sum(on_hand), 0) as before from public.stock_levels where variant_id = :'beer' and warehouse_id = :'shop' \gset
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'beer', 'quantity', least(30, :'before'::numeric - 2), 'unit_price', 1, 'discount_pct', 0, 'manual_pct', 0)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', least(30, :'before'::numeric - 2)))));
reset role;
select coalesce(sum(on_hand), 0) as left_ from public.stock_levels where variant_id = :'beer' and warehouse_id = :'shop' \gset
set role authenticated;

select t.login('ivo@kt.al');
select public.stock_balance(:'co', '{"days": 30, "cover": 30}') as b \gset
select t.ok(exists (select 1 from jsonb_array_elements(:'b'::jsonb -> 'rows') r
                     where (r ->> 'variant_id')::uuid = :'beer' and (r ->> 'from_id')::uuid = :'depot' and (r ->> 'to_id')::uuid = :'shop'),
         'the depot that does not sell beer sends to the shop that runs out');
select t.ok((select (r ->> 'quantity')::numeric from jsonb_array_elements(:'b'::jsonb -> 'rows') r where (r ->> 'variant_id')::uuid = :'beer' and (r ->> 'to_id')::uuid = :'shop')
            = floor(30 * (select (r ->> 'to_daily')::numeric from jsonb_array_elements(:'b'::jsonb -> 'rows') r where (r ->> 'variant_id')::uuid = :'beer' and (r ->> 'to_id')::uuid = :'shop') - :'left_'::numeric),
         'as much as the shop needs for the days chosen, in whole bottles');
select t.ok(not exists (select 1 from jsonb_array_elements(:'b'::jsonb -> 'rows') r where (r ->> 'to_id')::uuid = :'depot'), 'nothing is sent to a unit that does not sell');
select t.ok(jsonb_array_length(public.stock_balance(:'co', jsonb_build_object('units', jsonb_build_array(:'shop'))) -> 'rows') = 0, 'with one unit only, nothing to balance');

select public.stock_balance_create(:'co', jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('variant_id', :'beer', 'from_id', :'depot', 'to_id', :'shop', 'quantity', 12)))) as made \gset
select t.ok(jsonb_array_length(:'made'::jsonb) = 1 and (select status from public.stock_transfers where id = (:'made'::jsonb -> 0 ->> 'id')::uuid) = 'draft'
        and (select quantity from public.stock_transfer_lines where transfer_id = (:'made'::jsonb -> 0 ->> 'id')::uuid) = 12, 'a draft transfer depot → shop with the quantity chosen');
select t.throws(format($q$select public.stock_balance_create(%L, jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('variant_id', %L, 'from_id', %L, 'to_id', %L, 'quantity', 1))))$q$, :'co', :'beer', :'shop', :'shop'),
  'two different units', 'not from a unit to itself');
select t.login('cora@kt.al');
select t.throws(format($q$select public.stock_balance_create(%L, jsonb_build_object('lines', jsonb_build_array(jsonb_build_object('variant_id', %L, 'from_id', %L, 'to_id', %L, 'quantity', 1))))$q$, :'co', :'beer', :'depot', :'shop'),
  'Permission denied', 'a cashier does not make transfers');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
