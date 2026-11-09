-- =============================================================================
-- Counting: the counter is told where else in the unit the item is kept, and whether that place was counted,
-- never how many the program expects. (after 131, on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select id as wh from public.warehouses where company_id = :'co' and name = 'Main Warehouse' \gset
select sl.variant_id as item, sl.location_id as loc from public.stock_levels sl join public.warehouse_locations l on l.id = sl.location_id and l.location_type = 'internal'
 where sl.warehouse_id = :'wh' and sl.on_hand > 0 and sl.lot_id is null order by sl.variant_id limit 1 \gset
-- a second shelf with some of the item, and a third that has none
insert into public.warehouse_locations (company_id, warehouse_id, code, name, location_type)
values (:'co', :'wh', 'T132-B', 'Rafti B', 'internal') returning id as loc_b \gset
insert into public.warehouse_locations (company_id, warehouse_id, code, name, location_type)
values (:'co', :'wh', 'T132-C', 'Rafti C', 'internal') returning id as loc_c \gset
insert into public.stock_levels (company_id, variant_id, warehouse_id, location_id, on_hand) values (:'co', :'item', :'wh', :'loc_b', 7);

set role authenticated;
select t.login('zoe@platform.io');
select public.count_session_start(:'wh', 'Numërimi 132', 10) as ses \gset
select t.login('besa@kt.al');
select public.count_session_join(:'ses') as besa_list \gset
select t.login('ivo@kt.al');
select public.count_session_join(:'ses') as ivo_list \gset

-- 1. Besa counts the item on its usual shelf: she is told it is also on shelf B, not counted yet, with no quantity
select t.login('besa@kt.al');
select public.count_entry_add(gen_random_uuid(), :'besa_list', :'item', :'loc', 5) as a \gset
select public.count_item_elsewhere(:'besa_list', :'item', :'loc') as e1 \gset
select t.ok(exists (select 1 from jsonb_array_elements(:'e1'::jsonb) x where (x ->> 'location_id')::uuid = :'loc_b' and not (x ->> 'counted')::boolean),
  'the other shelf with the item is named, not counted yet');
select t.ok(not exists (select 1 from jsonb_array_elements(:'e1'::jsonb) x where (x ->> 'location_id')::uuid in (:'loc', :'loc_c')),
  'not the shelf just counted, and not a shelf without the item');
select t.ok(not exists (select 1 from jsonb_array_elements(:'e1'::jsonb) x, jsonb_object_keys(x) k
                         where k not in ('location_id', 'code', 'name', 'counted', 'counted_qty', 'by'))
  and (select x ->> 'counted_qty' from jsonb_array_elements(:'e1'::jsonb) x where (x ->> 'location_id')::uuid = :'loc_b') is null,
  'how many the program expects there is never told');

-- 2. Ivo finds it on shelf C (where the program has none) and counts shelf B too: Besa now sees both, counted, and by whom
select t.login('ivo@kt.al');
select public.count_entry_add(gen_random_uuid(), :'ivo_list', :'item', :'loc_b', 6);
select public.count_entry_add(gen_random_uuid(), :'ivo_list', :'item', :'loc_c', 2);
select t.login('besa@kt.al');
select public.count_item_elsewhere(:'besa_list', :'item', :'loc') as e2 \gset
select t.ok(exists (select 1 from jsonb_array_elements(:'e2'::jsonb) x where (x ->> 'location_id')::uuid = :'loc_b' and (x ->> 'counted')::boolean
  and (x ->> 'counted_qty')::numeric = 6 and x ->> 'by' is not null), 'shelf B shows counted, how many were found and by whom');
select t.ok(exists (select 1 from jsonb_array_elements(:'e2'::jsonb) x where (x ->> 'location_id')::uuid = :'loc_c' and (x ->> 'counted')::boolean),
  'a place where someone found the item shows too, even if the program had none there');

-- 3. only someone who may count asks; then the session is closed
select t.login('cora@kt.al');
select t.throws(format($q$select public.count_item_elsewhere('%s', '%s', '%s')$q$, :'besa_list', :'item', :'loc'), 'Permission denied', 'someone who does not count is not told');
select t.login('zoe@platform.io');
select public.count_session_close(:'ses', false);
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
