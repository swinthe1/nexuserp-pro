-- =============================================================================
-- DrisPRO · ABC-XYZ: classes by value and regularity, items not sold, rules, counting by class
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
insert into auth.users (email, raw_user_meta_data) values ('ana@abc.al', '{"full_name":"Ana Arkëtare"}') on conflict do nothing;
select email as boss from public.profiles where is_super_admin limit 1 \gset
set role authenticated;
select t.login(:'boss');
select public.create_company('ABC Test', 'XK') as co \gset
select public.invite_member(:'co', 'ana@abc.al', array['pos_cashier']);
select t.accept_invites();
select t.login(:'boss');
select id as pcs from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'BIG', 'name', 'Artikulli i madh', 'uom_id', :'pcs', 'sales_price', 30)) as p \gset
select id as big from public.product_variants where product_id = :'p' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'MID', 'name', 'Artikulli i mesëm', 'uom_id', :'pcs', 'sales_price', 8)) as p \gset
select id as mid from public.product_variants where product_id = :'p' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'SML', 'name', 'Artikulli i vogël', 'uom_id', :'pcs', 'sales_price', 2)) as p \gset
select id as sml from public.product_variants where product_id = :'p' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'RAR', 'name', 'Artikulli i rrallë', 'uom_id', :'pcs', 'sales_price', 3)) as p \gset
select id as rar from public.product_variants where product_id = :'p' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'DED', 'name', 'Artikulli që s''shitet', 'uom_id', :'pcs', 'sales_price', 9)) as p \gset
select id as ded from public.product_variants where product_id = :'p' \gset

reset role;
select id as wh from public.warehouses where company_id = :'co' and warehouse_type = 'warehouse' and deleted_at is null order by created_at limit 1 \gset
select app.main_location(:'wh') as wh_loc \gset
insert into public.warehouses (company_id, code, name, warehouse_type) values (:'co', 'S1', 'Dyqani 1', 'store') returning id as s1 \gset
insert into public.warehouse_locations (company_id, warehouse_id, code, name, location_type, is_pickable) values (:'co', :'s1', 'S1/SALLA', 'Salla', 'internal', true) returning id as s1_loc \gset
select app.virtual_location(:'co', 'adjustment') as adj, app.virtual_location(:'co', 'customer') as cust \gset
select date_trunc('week', now()) - interval '11 weeks' as t0 \gset
select app.post_stock_move(:'co', 'adjustment_in', :'big', :'adj', :'s1_loc', 300, 20, p_date => :'t0');
select app.post_stock_move(:'co', 'adjustment_in', :'mid', :'adj', :'s1_loc', 200, 5, p_date => :'t0');
select app.post_stock_move(:'co', 'adjustment_in', :'sml', :'adj', :'s1_loc', 200, 1, p_date => :'t0');
select app.post_stock_move(:'co', 'adjustment_in', :'rar', :'adj', :'s1_loc', 50, 2, p_date => :'t0');
select app.post_stock_move(:'co', 'adjustment_in', :'ded', :'adj', :'wh_loc', 10, 4, p_date => :'t0');
-- ten complete weeks: big 20 a week (4 000 € in all), mid and small 10 a week (500 € and 100 €); the rare one 30 in a single week
select count(app.post_stock_move(:'co', 'pos_sale', x.v, :'s1_loc', :'cust', x.q, p_date => date_trunc('week', now()) - make_interval(weeks => k) + interval '2 days'))
  from generate_series(1, 10) k cross join (values (:'big'::uuid, 20), (:'mid'::uuid, 10), (:'sml'::uuid, 10)) x(v, q);
select app.post_stock_move(:'co', 'pos_sale', :'rar', :'s1_loc', :'cust', 30, p_date => date_trunc('week', now()) - interval '6 weeks' + interval '1 day');
set role authenticated;

-- ---------- classes -----------------------------------------------------------------------------
select t.login(:'boss');
select public.abc_run(:'co') as s \gset
select t.ok((:'s'::jsonb ->> 'items')::int = 5, 'every item that sold or has stock is classified');
select t.ok((select abc || xyz from public.item_classes where variant_id = :'big' and warehouse_id is null) = 'AX', 'the item making most of the value, sold the same every week: AX');
select t.ok((select abc || xyz from public.item_classes where variant_id = :'mid' and warehouse_id is null) = 'BX', 'the next one, up to 95 %: BX');
select t.ok((select abc from public.item_classes where variant_id = :'sml' and warehouse_id is null) = 'C', 'the rest: C');
select t.ok((select abc || xyz from public.item_classes where variant_id = :'rar' and warehouse_id is null) = 'CZ', 'sold in one week only: Z');
select t.ok((select abc || xyz || months_sold from public.item_classes where variant_id = :'ded' and warehouse_id is null) = 'CZ0', 'in stock but never sold: C, Z');
select t.ok((select round(value) from public.item_classes where variant_id = :'big' and warehouse_id is null) = 4000
        and (select rank from public.item_classes where variant_id = :'big' and warehouse_id is null) = 1, 'the value is what left the stock at cost (200 × 20 €), best first');
select t.ok((:'s'::jsonb -> 'dead' ->> 'items')::int = 1 and (:'s'::jsonb -> 'dead' ->> 'stock_value')::numeric = 40, 'items not sold, with the money they hold (10 × 4 €)');
select t.ok((select count(*) from public.item_classes where company_id = :'co' and warehouse_id = :'s1') = 4
        and (select abc from public.item_classes where variant_id = :'ded' and warehouse_id = :'wh') = 'C', 'every unit is classified on its own');
select t.ok((select jsonb_array_length(public.abc_summary(:'co', :'s1') -> 'cells')) >= 3, 'the matrix of one unit');
select t.ok((public.item_where(:'co', 'BIG') -> 'item' ->> 'class') = 'A', 'the class shows where the item is looked up: ABC alone, XYZ is off');
select t.ok(not (public.abc_summary(:'co', null) -> 'settings' ->> 'xyz')::boolean, 'XYZ is optional and starts off');
select public.abc_settings_save(:'co', '{"xyz":true}');
select t.ok((public.item_where(:'co', 'BIG') -> 'item' ->> 'class') = 'AX', 'switched on, the class has both letters');
-- stock that has not sold, for a period
select t.ok((public.stock_not_sold(:'co', null, 50) ->> 'items')::int = 1 and (public.stock_not_sold(:'co', null, 50) -> 'rows' -> 0 ->> 'sku') = 'DED'
        and (public.stock_not_sold(:'co', null, 50) -> 'rows' -> 0 ->> 'last_sold') is null, 'not sold in 50 days: only the item that never sold');
select t.ok((public.stock_not_sold(:'co', null, 30) ->> 'items')::int = 2, 'in 30 days the rare item, last sold about six weeks ago, joins it');
select t.ok((public.stock_not_sold(:'co', :'s1', 30) ->> 'items')::int = 1 and (public.stock_not_sold(:'co', :'wh', 30) ->> 'items')::int = 1, 'by unit');
select t.ok((public.stock_not_sold(:'co', null, 5000) ->> 'items')::int = 0 and (public.stock_not_sold(:'co', null, 5000, null, true) ->> 'items')::int = 1,
  'goods that came in during the period are left out unless asked for');

-- ---------- rules -------------------------------------------------------------------------------
select public.abc_settings_save(:'co', '{"basis":"qty"}');
select t.ok((select abc from public.item_classes where variant_id = :'mid' and warehouse_id is null) = 'A', 'by quantity the middle item is an A too (200 of 430 before it)');
select t.throws(format($q$select public.abc_settings_save(%L, '{"a":90,"b":85}')$q$, :'co'), 'A must be below B', 'A below B');
select t.throws(format($q$select public.abc_settings_save(%L, '{"months":30}')$q$, :'co'), '3 to 24', 'three to twenty-four months');
select public.abc_settings_save(:'co', '{"basis":"value"}');
select t.ok((select abc from public.item_classes where variant_id = :'mid' and warehouse_id is null) = 'B', 'back to value');

-- ---------- counting by class -------------------------------------------------------------------
select t.ok((select (x -> 'classes' -> 'A' ->> 'due')::int from jsonb_array_elements(public.count_plan(:'co')) x where (x ->> 'warehouse_id')::uuid = :'s1') = 1
        and (select (x ->> 'due')::int from jsonb_array_elements(public.count_plan(:'co')) x where (x ->> 'warehouse_id')::uuid = :'s1') = 4,
  'never counted: everything is due, by class');
select public.create_count_due(:'s1', 2) as cc \gset
select t.ok((select array_agg(variant_id order by variant_id) from public.cycle_count_lines where cycle_count_id = :'cc') = (select array_agg(v order by v) from unnest(array[:'big', :'mid']::uuid[]) v)
        and (select scope from public.cycle_counts where id = :'cc') = 'abc_class', 'the count takes A first, then B');
select t.ok((select (x ->> 'due')::int from jsonb_array_elements(public.count_plan(:'co')) x where (x ->> 'warehouse_id')::uuid = :'s1') = 2,
  'what is on an open count is no longer due');

select t.login('ana@abc.al');
select t.ok((public.abc_summary(:'co', null) ->> 'items')::int = 5, 'a cashier may look');
select t.throws(format($q$select public.abc_run(%L)$q$, :'co'), 'Permission denied', 'but not classify');
select t.throws(format($q$select public.create_count_due(%L)$q$, :'s1'), 'Permission denied', 'nor start counts');

reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
