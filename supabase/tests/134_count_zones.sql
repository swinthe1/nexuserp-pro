-- =============================================================================
-- Counting together: shelves given to people, shelves marked done, and zero only where a shelf is done.
-- (after 133, on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select id as wh from public.warehouses where company_id = :'co' and name = 'Main Warehouse' \gset
select id as ivo from public.profiles where email = 'ivo@kt.al' \gset
select id as cora from public.profiles where email = 'cora@kt.al' \gset
-- two shelves, each with an item in stock that nobody will find
insert into public.warehouse_locations (company_id, warehouse_id, code, name, location_type)
values (:'co', :'wh', 'Z134-A', 'Zona A', 'internal') returning id as sa \gset
insert into public.warehouse_locations (company_id, warehouse_id, code, name, location_type)
values (:'co', :'wh', 'Z134-B', 'Zona B', 'internal') returning id as sb \gset
select sl.variant_id as item from public.stock_levels sl where sl.warehouse_id = :'wh' and sl.on_hand > 0 and sl.lot_id is null order by sl.variant_id limit 1 \gset
insert into public.stock_levels (company_id, variant_id, warehouse_id, location_id, on_hand) values (:'co', :'item', :'wh', :'sa', 4), (:'co', :'item', :'wh', :'sb', 6);

set role authenticated;
select t.login('zoe@platform.io');
select public.count_session_start(:'wh', 'Numërimi 134', 10) as ses \gset

-- 1. the manager gives shelf A to Ivo: he gets a task; not to someone who does not count; a counter gives no shelves
select t.ok(exists (select 1 from jsonb_array_elements(public.count_session_people(:'ses')) p where (p ->> 'id')::uuid = :'ivo'), 'Ivo is among those who may count');
select t.ok(public.count_session_assign(:'ses', array[:'sa'::uuid], :'ivo') = 1, 'shelf A is Ivo''s');
select t.throws(format($q$select public.count_session_assign('%s', array['%s'::uuid], '%s')$q$, :'ses', :'sb', :'cora'), 'may not count stock', 'not to someone who does not count');
reset role;
select t.ok(exists (select 1 from public.tasks where auto_key like 'count_zone:' || :'ses' || ':%' and assignee_id = :'ivo' and status = 'todo'), 'Ivo has his shelves among his tasks');
set role authenticated;
select t.login('besa@kt.al');
select t.throws(format($q$select public.count_session_assign('%s', array['%s'::uuid], '%s')$q$, :'ses', :'sb', :'ivo'), 'Permission denied', 'a counter does not give shelves');

-- 2. Ivo joins and marks shelf A done (he found nothing there); shelf B nobody reaches
select t.login('ivo@kt.al');
select public.count_session_join(:'ses') as ivo_list \gset
select t.ok((public.count_shelf_done(:'ivo_list', :'sa') ->> 'done')::boolean, 'Ivo marks shelf A done');
select public.count_session_view(:'ses') as v \gset
select t.ok(exists (select 1 from jsonb_array_elements(:'v'::jsonb -> 'shelves') x where (x ->> 'location_id')::uuid = :'sa' and (x ->> 'done')::boolean
  and (x ->> 'person_id')::uuid = :'ivo' and x ->> 'done_by' is not null), 'the session shows shelf A: Ivo''s, done, and by whom');
select t.login('besa@kt.al');
select t.ok((select x -> 'with_stock' from jsonb_array_elements(public.count_session_view(:'ses') -> 'shelves') x where (x ->> 'location_id')::uuid = :'sa') = 'null'::jsonb,
  'a counter is not told how many items a shelf should hold');
select t.login('zoe@platform.io');
select t.ok((select (x ->> 'with_stock')::int from jsonb_array_elements(public.count_session_view(:'ses') -> 'shelves') x where (x ->> 'location_id')::uuid = :'sa') >= 1,
  'the manager is');

-- 3. closing with "zero only on finished shelves": A's item goes to zero, B's stays as it was
select public.count_session_close(:'ses', true, true) as cl \gset
select t.ok((:'cl'::jsonb ->> 'zero_lines')::int >= 1 and (:'cl'::jsonb ->> 'shelves_not_done')::int >= 1, 'zero on the finished shelf, and the shelves not done are told');
reset role;
select t.ok(exists (select 1 from public.cycle_count_lines l join public.cycle_counts c on c.id = l.cycle_count_id
                     where c.session_id = :'ses' and l.location_id = :'sa' and l.counted_qty = 0), 'the item missing on the finished shelf is counted as zero');
select t.ok(not exists (select 1 from public.cycle_count_lines l join public.cycle_counts c on c.id = l.cycle_count_id
                         where c.session_id = :'ses' and l.location_id = :'sb'), 'the shelf nobody reached is left alone');
select t.ok(not exists (select 1 from public.tasks where auto_key like 'count_zone:' || :'ses' || ':%' and status = 'todo'), 'closing the session closes the shelf tasks');
set role authenticated;
select t.login('ivo@kt.al');
select t.throws(format($q$select public.count_shelf_done('%s', '%s')$q$, :'ivo_list', :'sb'), 'closed', 'after closing no shelf is marked');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
