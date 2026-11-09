-- =============================================================================
-- Counting together: a second person checks some shelves blind; the two counts are compared, never both posted.
-- (after 135, on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select id as wh from public.warehouses where company_id = :'co' and name = 'Main Warehouse' \gset
select id as ivo from public.profiles where email = 'ivo@kt.al' \gset
select id as besa from public.profiles where email = 'besa@kt.al' \gset
insert into public.warehouse_locations (company_id, warehouse_id, code, name, location_type)
values (:'co', :'wh', 'K136', 'Rafti i kontrollit', 'internal') returning id as sh \gset
select v.id as i1 from public.product_variants v join public.products p on p.id = v.product_id
 where v.company_id = :'co' and p.tracking = 'none' and p.product_type = 'stockable' order by v.sku limit 1 \gset
select v.id as i2 from public.product_variants v join public.products p on p.id = v.product_id
 where v.company_id = :'co' and p.tracking = 'none' and p.product_type = 'stockable' and v.id <> :'i1' order by v.sku limit 1 \gset
insert into public.stock_levels (company_id, variant_id, warehouse_id, location_id, on_hand) values (:'co', :'i1', :'wh', :'sh', 10), (:'co', :'i2', :'wh', :'sh', 8);

set role authenticated;
select t.login('zoe@platform.io');
select public.count_session_start(:'wh', 'Numërimi 136', 10) as ses \gset
select t.login('besa@kt.al');
select public.count_session_join(:'ses') as besa_list \gset
select public.count_entry_add(gen_random_uuid(), :'besa_list', :'i1', :'sh', 9);
select public.count_entry_add(gen_random_uuid(), :'besa_list', :'i2', :'sh', 5);

-- 1. the check goes to someone who did not count the shelf
select t.login('zoe@platform.io');
select t.throws(format($q$select public.count_check_start('%s', array['%s'::uuid], '%s')$q$, :'ses', :'sh', :'besa'), 'did not count these shelves', 'not to the person who counted it');
select public.count_check_start(:'ses', array[:'sh'::uuid], :'ivo') as k \gset
reset role;
select t.ok((select scope = 'check' and blind_count and session_id is null and check_session = :'ses' and assigned_to = :'ivo' from public.cycle_counts where id = :'k'),
  'a blind list of his own, outside the shared lists');
select t.ok(exists (select 1 from public.tasks where auto_key = 'count_check:' || :'k' and assignee_id = :'ivo' and status = 'todo'), 'Ivo has it among his tasks');

-- 2. Ivo counts without seeing Besa's figures: one the same, one not
set role authenticated;
select t.login('ivo@kt.al');
select t.ok(jsonb_array_length(public.count_item_elsewhere(:'k', :'i1', :'sh')) = 0 or not exists (
  select 1 from jsonb_array_elements(public.count_item_elsewhere(:'k', :'i1', :'sh')) x where (x ->> 'counted')::boolean), 'he is not told what the others counted');
select public.count_item(:'k', :'i1', :'sh', 9, null, true);
select public.count_item(:'k', :'i2', :'sh', 7, null, true);
select public.submit_cycle_count(:'k', false);
reset role;
select t.ok((select status = 'done' from public.tasks where auto_key = 'count_check:' || :'k'), 'sending the check closes his task');

-- 3. the comparison
set role authenticated;
select t.login('zoe@platform.io');
select public.count_check_compare(:'k') as cmp \gset
select t.ok((:'cmp'::jsonb ->> 'agree')::int = 1 and (:'cmp'::jsonb ->> 'differ')::int = 1, 'one line the same in both counts, one not');
select t.ok((select (x ->> 'agree')::boolean from jsonb_array_elements(:'cmp'::jsonb -> 'lines') x where (x ->> 'main_counted')::numeric = 9) , 'both found 9: confirmed by two people');
select t.ok(exists (select 1 from jsonb_array_elements(public.count_session_checks(:'ses')) x where (x ->> 'differ')::int = 1), 'the session lists its checks');
select t.throws(format($q$select public.post_cycle_count('%s')$q$, :'k'), 'only compared', 'a check never changes the stock by itself');
select t.login('besa@kt.al');
select t.throws(format($q$select public.count_check_compare('%s')$q$, :'k'), 'Permission denied', 'a counter does not see the comparison');

-- 4. the line that differs goes back; confirming the session closes the check without touching the stock
select t.login('zoe@platform.io');
select public.count_session_close(:'ses', false);
select (x ->> 'line_id')::uuid as dline from jsonb_array_elements(public.count_check_compare(:'k') -> 'lines') x where not (x ->> 'agree')::boolean \gset
select t.ok(public.count_recount(:'besa_list', p_lines => array[:'dline'::uuid], p_other => true) = 1, 'the line that differs goes back to be counted by someone else');
select t.login('wanda@kt.al');
select public.count_entry_add(gen_random_uuid(), :'besa_list', :'i2', :'sh', 7);
select public.submit_cycle_count(:'besa_list', false);
select t.login('zoe@platform.io');
select public.count_session_post(:'ses');
reset role;
select t.ok((select status = 'cancelled' and (scope_filter ->> 'compared')::boolean from public.cycle_counts where id = :'k'), 'the check is closed, compared');
select t.ok((select on_hand from public.stock_levels where location_id = :'sh' and variant_id = :'i2') = 7
        and (select on_hand from public.stock_levels where location_id = :'sh' and variant_id = :'i1') = 9, 'the stock is what the shared count found, once');
set role authenticated;
select t.login('zoe@platform.io');
select t.ok(jsonb_array_length(public.count_record(:'ses') -> 'checks') = 1, 'the record says the shelf was checked by a second person');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
