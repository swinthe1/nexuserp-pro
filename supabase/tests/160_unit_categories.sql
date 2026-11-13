-- =============================================================================
-- What a unit is (market, café, restaurant, warehouse…), its tills' kind, and the platform's own
-- "add or change a client's unit". (on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select coalesce(max_warehouses::text, '') as old_max, extra_features as old_extra from public.licenses where company_id = :'co' \gset
update public.licenses set max_warehouses = 999 where company_id = :'co';
select t.ok((select count(*) = 0 from public.warehouses where unit_category is null and warehouse_type <> 'transit'), 'every unit there already has a kind');
set role authenticated;
select t.login(:'boss');
select (public.platform_client_units(:'co') -> 'units') is not null as has_units \gset
select t.ok(:'has_units', 'the platform lists a client''s units');
select public.platform_unit_create(:'co', '{"name":"Kafe Test 160","code":"KT160","category":"cafe","tills":2,"add_restaurant":true}') as r \gset
select (:'r'::jsonb ->> 'id') as kafe \gset
select t.ok((select unit_category = 'cafe' and warehouse_type = 'store' from public.warehouses where id = :'kafe'), 'a café is a selling unit');
select t.ok((select count(*) = 2 and bool_and(mode = 'restaurant') from public.pos_registers where warehouse_id = :'kafe'), 'with two restaurant tills');
select t.ok((select 'restaurant' = any(extra_features) from public.licenses where company_id = :'co'), 'the licence got the restaurant module');
select t.throws(format($q$select public.platform_unit_create(%L, '{"name":"Tjetër","code":"kt160","category":"market"}')$q$, :'co'), 'is used by another unit', 'a code once per company');
select t.throws(format($q$select public.platform_unit_create(%L, '{"name":"X","code":"X160","category":"spaceship"}')$q$, :'co'), 'Unknown kind', 'only known kinds');
select public.platform_unit_update(:'kafe', '{"category":"market","name":"Market Test 160","city":"Gllogoc"}') as u \gset
select t.ok((select unit_category = 'market' and name = 'Market Test 160' and city = 'Gllogoc' from public.warehouses where id = :'kafe'), 'the platform changes the unit');
select t.ok((select bool_and(mode = 'retail') from public.pos_registers where warehouse_id = :'kafe'), 'and its tills become shop tills');
select t.ok((:'u'::jsonb ->> 'tills_changed')::int = 2, 'it says how many tills changed');
select t.throws(format($q$select public.platform_unit_update(%L, '{"category":"warehouse"}')$q$, :'kafe'), 'has tills', 'a unit with tills does not become a warehouse');
select public.platform_unit_create(:'co', '{"name":"Depo Test 160","code":"DT160","category":"warehouse","tills":3}') as d \gset
select t.ok((select warehouse_type = 'warehouse' and not exists (select 1 from public.pos_registers r where r.warehouse_id = w.id) from public.warehouses w where w.id = (:'d'::jsonb ->> 'id')::uuid), 'a warehouse gets no tills');
-- the company's own New unit takes the kinds too
select public.unit_create(jsonb_build_object('company_id', :'co', 'name', 'Furra Test 160', 'code', 'FT160', 'category', 'bakery', 'tills', 1)) as b \gset
select t.ok((select unit_category = 'bakery' from public.warehouses where id = (:'b'::jsonb ->> 'id')::uuid), 'the company makes a bakery itself');
select t.ok((select mode = 'retail' from public.pos_registers where warehouse_id = (:'b'::jsonb ->> 'id')::uuid), 'with a shop till');
select public.unit_create(jsonb_build_object('company_id', :'co', 'name', 'Kuzhina Test 160', 'code', 'KZ160', 'kind', 'restaurant', 'tills', 1)) as k \gset
select t.ok((select unit_category = 'restaurant' from public.warehouses where id = (:'k'::jsonb ->> 'id')::uuid), 'the older "restaurant" kind still works');
-- someone else is refused
select t.login('pronari@arberi.xk');
select t.throws(format('select public.platform_client_units(%L)', :'co'), '', 'only the platform sees a client''s units');
select t.throws(format($q$select public.platform_unit_create(%L, '{"name":"Y","code":"Y160","category":"market"}')$q$, :'co'), '', 'or adds one');
select t.throws(format($q$select public.platform_unit_update(%L, '{"name":"Y"}')$q$, :'kafe'), '', 'or changes one');
select t.throws(format($q$select public.unit_update(%L, '{"name":"Y"}')$q$, :'kafe'), '', 'nor through the company''s own function');
reset role;
set session_replication_role = replica;
delete from public.pos_registers where warehouse_id in (select id from public.warehouses where company_id = :'co' and code in ('KT160', 'DT160', 'FT160', 'KZ160'));
delete from public.warehouse_locations where warehouse_id in (select id from public.warehouses where company_id = :'co' and code in ('KT160', 'DT160', 'FT160', 'KZ160'));
delete from public.warehouses where company_id = :'co' and code in ('KT160', 'DT160', 'FT160', 'KZ160');
set session_replication_role = default;
update public.licenses set max_warehouses = nullif(:'old_max', '')::int, extra_features = :'old_extra'::text[] where company_id = :'co';
\set QUIET off
select count(*) as assertions_passed from t.results;
