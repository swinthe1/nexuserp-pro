-- =============================================================================
-- Counting: a line sent back is counted again by someone else, never by who counted it first.
-- (after 132, on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select id as wh from public.warehouses where company_id = :'co' and name = 'Main Warehouse' \gset
select sl.variant_id as item, sl.location_id as loc from public.stock_levels sl join public.warehouse_locations l on l.id = sl.location_id and l.location_type = 'internal'
  join public.product_variants v on v.id = sl.variant_id join public.products p on p.id = v.product_id
 where sl.warehouse_id = :'wh' and sl.on_hand > 0 and sl.lot_id is null and p.tracking = 'none' order by sl.variant_id limit 1 \gset
select id as besa from public.profiles where email = 'besa@kt.al' \gset
select id as ivo from public.profiles where email = 'ivo@kt.al' \gset
select id as wanda from public.profiles where email = 'wanda@kt.al' \gset
select id as cora from public.profiles where email = 'cora@kt.al' \gset
update public.company_members set warehouse_ids = null where company_id = :'co' and user_id in (:'besa', :'ivo', :'wanda');

-- Besa counts a shelf and finds far too few
set role authenticated;
select t.login('besa@kt.al');
select public.create_cycle_count(:'wh', array[:'loc'::uuid], null, true) as cnt \gset
select id as line from public.cycle_count_lines where cycle_count_id = :'cnt' and variant_id = :'item' and location_id = :'loc' \gset
select public.count_item(:'cnt', :'item', :'loc', 0, null, true);
select public.submit_cycle_count(:'cnt', true);

-- 1. the manager picks who counts again: not Besa, and only someone who may count
select t.login('zoe@platform.io');
select t.ok(exists (select 1 from jsonb_array_elements(public.count_people(:'cnt')) p where (p ->> 'id')::uuid = :'ivo')
  and not exists (select 1 from jsonb_array_elements(public.count_people(:'cnt')) p where (p ->> 'id')::uuid = :'cora'), 'the choice lists the people who may count, not the others');
select t.throws(format($q$select public.count_recount('%s', p_lines => array['%s'::uuid], p_person => '%s')$q$, :'cnt', :'line', :'besa'),
  'counted these lines the first time', 'the one who counted it first cannot be chosen');
select t.throws(format($q$select public.count_recount('%s', p_lines => array['%s'::uuid], p_person => '%s')$q$, :'cnt', :'line', :'cora'),
  'may not count stock', 'nor someone who does not count');
select t.ok(public.count_recount(:'cnt', p_lines => array[:'line'::uuid], p_person => :'ivo') = 1, 'Ivo is asked to count it again');
reset role;
select t.ok(exists (select 1 from public.tasks where auto_key like 'recount:' || :'cnt' || ':%' and assignee_id = :'ivo' and status = 'todo'), 'Ivo has it among his tasks');
select t.ok((select :'besa' = any (recount_not) and recount_by = :'ivo' from public.cycle_count_lines where id = :'line'), 'the line remembers who may not and who must');

-- 2. Besa cannot count it again; Ivo can
set role authenticated;
select t.login('besa@kt.al');
select t.throws(format($q$select public.count_item('%s', '%s', '%s', 5, null, true)$q$, :'cnt', :'item', :'loc'), 'You counted this line the first time', 'the first counter cannot count it again');
select t.ok((public.count_import(:'cnt', jsonb_build_array(jsonb_build_object('code', (select sku from public.product_variants where id = :'item'), 'qty', '5'))) ->> 'ok')::int = 0,
  'nor through Excel');
select t.login('ivo@kt.al');
select t.ok((public.count_item(:'cnt', :'item', :'loc', 9, null, true) ->> 'counted_qty')::numeric = 9, 'the chosen person counts it');
select t.ok((select first_counted_qty = 0 and counted_qty = 9 and counted_by = :'ivo' from public.cycle_count_lines where id = :'line'), 'both figures are kept, with who counted the second');
select public.submit_cycle_count(:'cnt', false);
reset role;
select t.ok(exists (select 1 from public.tasks where auto_key like 'recount:' || :'cnt' || ':%' and status = 'done'), 'sending the count closes Ivo''s task');

-- 3. "someone else": anyone but those who counted it
set role authenticated;
select t.login('zoe@platform.io');
select t.ok(public.count_recount(:'cnt', p_lines => array[:'line'::uuid], p_other => true) = 1, 'sent back again, for anyone else');
select t.login('ivo@kt.al');
select t.throws(format($q$select public.count_item('%s', '%s', '%s', 9, null, true)$q$, :'cnt', :'item', :'loc'), 'You counted this line the first time', 'Ivo counted it now: not him');
select t.login('besa@kt.al');
select t.throws(format($q$select public.count_item('%s', '%s', '%s', 9, null, true)$q$, :'cnt', :'item', :'loc'), 'You counted this line the first time', 'nor Besa, who counted it before him');
select t.login('wanda@kt.al');
select t.ok((public.count_item(:'cnt', :'item', :'loc', 8, null, true) ->> 'counted_qty')::numeric = 8, 'a third person counts it');

-- 4. without a choice, it is as before: anyone counts again
select public.submit_cycle_count(:'cnt', false);
select t.login('zoe@platform.io');
select public.count_recount(:'cnt', p_lines => array[:'line'::uuid]);
select t.login('wanda@kt.al');
select t.ok((public.count_item(:'cnt', :'item', :'loc', 8, null, true) ->> 'counted_qty')::numeric = 8, 'sent back without a choice, the same person may count again');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
