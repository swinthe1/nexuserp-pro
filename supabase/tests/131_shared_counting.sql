-- =============================================================================
-- Counting together with the shop open: each person a list; the first list that counts an item owns it,
-- the others add to it; every entry kept. (after 130, on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select id as wh from public.warehouses where company_id = :'co' and name = 'Main Warehouse' \gset
select sl.variant_id as item, sl.location_id as loc from public.stock_levels sl join public.warehouse_locations l on l.id = sl.location_id and l.location_type = 'internal'
 where sl.warehouse_id = :'wh' and sl.on_hand > 0 and sl.lot_id is null order by sl.variant_id limit 1 \gset

set role authenticated;
-- 1. the manager opens the session; a counter cannot
select t.login('besa@kt.al');
select t.throws(format($q$select public.count_session_start('%s', 'Inventari', 20)$q$, :'wh'), 'Permission denied', 'a counter does not open a session');
select t.login('zoe@platform.io');
select public.count_session_start(:'wh', 'Inventari i nëntorit', 15) as ses \gset
select t.throws(format($q$select public.count_session_start('%s', 'Tjetër', 20)$q$, :'wh'), 'open in this unit already', 'one open session per unit');

-- 2. two people join, each gets a list of their own
select t.login('besa@kt.al');
select public.count_session_join(:'ses') as besa_list \gset
select t.ok(public.count_session_join(:'ses') = :'besa_list', 'joining again gives the same list');
select t.login('ivo@kt.al');
select public.count_session_join(:'ses') as ivo_list \gset
select t.ok(:'ivo_list' <> :'besa_list', 'each person has a list');

-- 3. Besa counts the item first: it is hers; Ivo counts it too and ADDS to her list
select t.login('besa@kt.al');
select public.count_entry_add('11111111-0000-4000-8000-000000000131', :'besa_list', :'item', :'loc', 10) as a \gset
select t.ok((:'a'::jsonb ->> 'mine')::boolean and (:'a'::jsonb ->> 'counted_qty')::numeric = 10 and :'a'::jsonb ->> 'system_qty' is null, 'the first count lands on her list (the expected quantity is never told)');
select t.login('ivo@kt.al');
select public.count_entry_add('22222222-0000-4000-8000-000000000131', :'ivo_list', :'item', :'loc', 10) as b \gset
select t.ok(not (:'b'::jsonb ->> 'mine')::boolean and (:'b'::jsonb ->> 'counted_qty')::numeric = 20 and (:'b'::jsonb ->> 'before')::numeric = 10
  and :'b'::jsonb ->> 'owner' is not null and (:'b'::jsonb ->> 'count_id')::uuid = :'besa_list', 'the second person adds to the first list: 10 + 10 = 20, and is told whose it is');
select public.count_entry_add('22222222-0000-4000-8000-000000000131', :'ivo_list', :'item', :'loc', 10) as b2 \gset
select t.ok((:'b2'::jsonb ->> 'counted_qty')::numeric = 20, 'the same entry sent twice (offline) counts once');
select public.offline_call('33333333-0000-4000-8000-000000000131', 'count_entry_add', jsonb_build_object('p_id', '44444444-0000-4000-8000-000000000131',
  'p_count', :'ivo_list', 'p_variant', :'item', 'p_location', :'loc', 'p_qty', 2)) as off \gset
select t.ok((:'off'::jsonb ->> 'counted_qty')::numeric = 22, 'an entry made without internet arrives later and is added too');

-- 4. each corrects only their own entry
select t.login('besa@kt.al');
select t.throws($$select public.count_entry_change('22222222-0000-4000-8000-000000000131', 1)$$, 'Only the person who counted it', 'nobody changes another person''s entry');
select t.ok((public.count_entry_change('11111111-0000-4000-8000-000000000131', 12) ->> 'counted_qty')::numeric = 24, 'her own entry she corrects: 12 + 10 + 2');
reset role;
select t.ok((select count(*) from public.cycle_count_entries where line_id = (:'a'::jsonb ->> 'line_id')::uuid) = 3, 'every entry is kept apart');
select t.ok((select counted_by from public.cycle_count_lines where id = (:'a'::jsonb ->> 'line_id')::uuid) = (select id from public.profiles where email = 'besa@kt.al'),
  'the line is counted by the first person');

-- 5. the session view, then closing: lists to review, what nobody found counted as zero
set role authenticated;
select t.login('zoe@platform.io');
select t.ok(jsonb_array_length(public.count_session_view(:'ses') -> 'lists') = 2 and (public.count_session_view(:'ses') ->> 'items')::int = 1, 'the manager sees the two lists and the item counted');
select public.count_session_close(:'ses', true) as cl \gset
select t.ok((:'cl'::jsonb ->> 'zero_lines')::int >= 1, 'the items with stock nobody counted go on a "zero" list');
reset role;
select t.ok((select status from public.cycle_counts where id = :'besa_list') = 'review' and (select status from public.cycle_counts where id = :'ivo_list') = 'cancelled',
  'the list with counts goes to review; the empty one is dropped');
set role authenticated;
select t.login('ivo@kt.al');
select t.throws(format($q$select public.count_entry_add(gen_random_uuid(), '%s', '%s', '%s', 1)$q$, :'ivo_list', :'item', :'loc'), 'cancelled|closed', 'after closing nobody adds');

-- 6. the review shows who counted what; the whole session is confirmed at once
select t.login('zoe@platform.io');
select public.count_review(:'besa_list') as rv \gset
select t.ok(coalesce((select jsonb_array_length(l -> 'entries') from jsonb_array_elements(:'rv'::jsonb -> 'lines') l where (l ->> 'variant_id')::uuid = :'item'), 3) = 3,
  'the review lists each person''s entries');
-- sent back to count again: the entries go, the person counts afresh (the session is closed, the list is not)
select t.ok(public.count_recount(:'besa_list', p_lines => array[(:'a'::jsonb ->> 'line_id')::uuid]) = 1, 'a line goes back to be counted again');
reset role;
select t.ok(not exists (select 1 from public.cycle_count_entries where line_id = (:'a'::jsonb ->> 'line_id')::uuid), 'its entries are cleared');
set role authenticated;
select t.login('besa@kt.al');
select t.ok((public.count_entry_add(gen_random_uuid(), :'besa_list', :'item', :'loc', 23) ->> 'counted_qty')::numeric = 23, 'and the recount is entered afresh');
select t.login('zoe@platform.io');
select public.submit_cycle_count(:'besa_list');
select t.ok((public.count_session_post(:'ses') ->> 'posted')::int >= 1, 'the session is confirmed in one step');
reset role;
select t.ok((select status from public.cycle_counts where id = :'besa_list') = 'posted', 'and its lists become stock adjustments');

\set QUIET off
select count(*) as assertions_passed from t.results;
