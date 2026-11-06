-- =============================================================================
-- A client with one unit or with several, as the Super Admin creates it (after 13 and 100)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
set role authenticated;
select t.login('zoe@platform.io');

-- several units: the units come with the client, the licence allows them
select public.platform_create_client(jsonb_build_object(
  'name', 'Lidhja Market', 'country', 'XK', 'owner_email', 'pronari@lidhja.xk', 'owner_password', 'sekret123',
  'plan', 'standard', 'max_users', 5, 'business_type', 'retail', 'multi_unit', true,
  'units', jsonb_build_array(
    jsonb_build_object('name', 'Lidhja 1 – Drenas', 'kind', 'store', 'city', 'Drenas', 'code', 'LM1'),
    jsonb_build_object('name', 'Lidhja 2 – Korroticë', 'kind', 'store', 'city', 'Korroticë', 'code', 'LM2'),
    jsonb_build_object('name', 'Depo Qendrore', 'kind', 'warehouse', 'code', 'DEPO')))) as multi \gset
reset role;
select t.ok((select multi_unit from public.company_settings where company_id = :'multi'), 'several units: said so');
select t.ok((select count(*) from public.warehouses where company_id = :'multi' and deleted_at is null and warehouse_type <> 'transit') = 3, 'the three units are there');
select t.ok((select string_agg(code || ':' || warehouse_type, ',' order by code) from public.warehouses where company_id = :'multi' and warehouse_type <> 'transit')
            = 'DEPO:warehouse,LM1:store,LM2:store', 'with their codes and kinds');
select t.ok(exists (select 1 from public.warehouse_locations l join public.warehouses w on w.id = l.warehouse_id
                     where w.company_id = :'multi' and w.code = 'LM2' and l.code = 'LM2/STOCK'), 'each unit has its places');
select t.ok((select max_warehouses >= 3 from public.licenses where company_id = :'multi'), 'the licence allows them');

-- one unit: it carries the name of the business, and a second one is not added by mistake
set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object(
  'name', 'Kafe Ura', 'country', 'XK', 'owner_email', 'ura@kafe.xk', 'owner_password', 'sekret123',
  'plan', 'standard', 'max_users', 3, 'business_type', 'restaurant', 'multi_unit', false)) as single \gset
reset role;
select t.ok((select multi_unit = false from public.company_settings where company_id = :'single'), 'one unit: said so');
select t.ok((select name = 'Kafe Ura' and warehouse_type = 'store' from public.warehouses where company_id = :'single' and warehouse_type <> 'transit'), 'the unit carries the business''s name');
select t.throws(format($q$insert into public.warehouses (company_id, code, name, warehouse_type) values (%L, 'N2', 'Tjetra', 'store')$q$, :'single'),
                'works with one unit', 'a second unit is not added by mistake');
set role authenticated;
select t.login('zoe@platform.io');
select public.platform_set_multi_unit(:'single', true);
reset role;
insert into public.warehouses (company_id, code, name, warehouse_type) values (:'single', 'N2', 'Ura 2', 'store');
select t.ok((select count(*) from public.warehouses where company_id = :'single' and warehouse_type <> 'transit') = 2, 'switched to several units, the second one comes');
set role authenticated;
select t.login('zoe@platform.io');
select t.throws(format($q$select public.platform_set_multi_unit(%L, false)$q$, :'single'), 'more than one active unit', 'back to one unit only when one is active');
select t.throws($$select public.platform_create_client(jsonb_build_object('name', 'Dy', 'owner_email', 'dy@dy.xk', 'owner_password', 'sekret123', 'multi_unit', true,
                  'units', jsonb_build_array(jsonb_build_object('name', 'Vetëm një'))))$$, 'at least two', 'several units means at least two');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
