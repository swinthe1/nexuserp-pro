-- =============================================================================
-- Transfers on the floor: packed by scanner, received blind; differences go to the manager.
-- (after 136, on "Kontrolle Test": Main Warehouse sends to Depoja)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select id as wh from public.warehouses where company_id = :'co' and name = 'Main Warehouse' \gset
select id as dep from public.warehouses where company_id = :'co' and name = 'Depoja' \gset
select id as ivo from public.profiles where email = 'ivo@kt.al' \gset
-- two items in stock on a shelf of the sending unit
insert into public.warehouse_locations (company_id, warehouse_id, code, name, location_type)
values (:'co', :'wh', 'T137', 'Rafti i dërgimit', 'internal') returning id as sh \gset
select v.id as i1 from public.product_variants v join public.products p on p.id = v.product_id
 where v.company_id = :'co' and p.tracking = 'none' and p.product_type = 'stockable' order by v.sku limit 1 \gset
select v.id as i2 from public.product_variants v join public.products p on p.id = v.product_id
 where v.company_id = :'co' and p.tracking = 'none' and p.product_type = 'stockable' and v.id <> :'i1' order by v.sku limit 1 \gset
insert into public.stock_levels (company_id, variant_id, warehouse_id, location_id, on_hand) values (:'co', :'i1', :'wh', :'sh', 500), (:'co', :'i2', :'wh', :'sh', 500)
on conflict do nothing;
select app.main_location(:'dep') is not null as dep_ok \gset
select t.ok(:'dep_ok'::boolean, 'the receiving unit has a shelf for goods');

-- 1. Besa packs on the scanner: scans add up, a typed quantity replaces, zero removes
set role authenticated;
select t.login('besa@kt.al');
select t.throws(format($q$select public.transfer_pack_start('%s', '%s')$q$, :'wh', :'wh'), 'another unit', 'not to the same unit');
select public.transfer_pack_start(:'wh', :'dep', 'Për fundjavë') as tr \gset
select public.transfer_pack_add(:'tr', :'i1', 1);
select t.ok((public.transfer_pack_add(:'tr', :'i1', 1) ->> 'quantity')::numeric = 2, 'two scans, two pieces');
select t.ok((public.transfer_pack_add(:'tr', :'i1', 10, null, true) ->> 'quantity')::numeric = 10, 'a typed quantity replaces');
select public.transfer_pack_add(:'tr', :'i2', 4);
select public.transfer_pack_add(:'tr', :'i2', 0, null, true);
select t.ok((select count(*) from public.stock_transfer_lines where transfer_id = :'tr') = 1, 'zero takes the item off');
select public.transfer_pack_add(:'tr', :'i2', 5, null, true);
reset role;
select t.ok((select from_location_id = :'sh' from public.stock_transfer_lines where transfer_id = :'tr' and variant_id = :'i1'), 'taken from the shelf that holds the item');
set role authenticated;
select t.login('besa@kt.al');
select public.ship_stock_transfer(:'tr');

-- 2. Ivo receives blind: the answer never says what was sent
select t.login('ivo@kt.al');
select public.transfer_count_add(:'tr', :'i1', 10) as c1 \gset
select t.ok(:'c1'::jsonb ->> 'counted' = '10' and not (:'c1'::jsonb ? 'quantity') and not (:'c1'::jsonb ? 'shipped'), 'he is told what he counted, not what was sent');
select t.throws(format($q$select public.transfer_count_add('%s', '%s', 1)$q$, :'tr', (select v.id from public.product_variants v where v.company_id = :'co' and v.id not in (:'i1', :'i2') limit 1)),
  'not on the transfer', 'an item not sent is put aside');
select public.transfer_count_add(:'tr', :'i2', 3);
select public.transfer_receive_blind(:'tr') as r1 \gset
select t.ok(not (:'r1'::jsonb ->> 'ok')::boolean and (:'r1'::jsonb ->> 'recount')::boolean and jsonb_array_length(:'r1'::jsonb -> 'items') = 1,
  'one item does not agree: it is named, to count again');
reset role;
select t.ok((select quantity_counted is null and recount from public.stock_transfer_lines where transfer_id = :'tr' and variant_id = :'i2')
        and (select quantity_counted = 10 from public.stock_transfer_lines where transfer_id = :'tr' and variant_id = :'i1'), 'only that item starts again from nothing');

-- 3. counted again and still different: the manager gets it, with a task
set role authenticated;
select t.login('ivo@kt.al');
select public.transfer_count_add(:'tr', :'i2', 4);
select public.transfer_receive_blind(:'tr') as r2 \gset
select t.ok((:'r2'::jsonb ->> 'to_manager')::boolean, 'twice different: it goes to the manager');
select t.throws(format($q$select public.transfer_count_add('%s', '%s', 1)$q$, :'tr', :'i2'), 'waits for the manager', 'nobody counts on it any more');
reset role;
select t.ok((select receive_state = 'differences' from public.stock_transfers where id = :'tr')
        and exists (select 1 from public.tasks where auto_key = 'transfer_diff:' || :'tr' and status = 'todo'), 'the manager has a task');
set role authenticated;
select t.login('zoe@platform.io');
select public.receive_stock_transfer(:'tr', jsonb_build_array(jsonb_build_object('line_id', (select id from public.stock_transfer_lines where transfer_id = :'tr' and variant_id = :'i2'),
  'received', 4, 'action', 'return')), 'Një copë u kthye');
reset role;
select t.ok((select status = 'done' and receive_state is null from public.stock_transfers where id = :'tr')
        and exists (select 1 from public.tasks where auto_key = 'transfer_diff:' || :'tr' and status = 'done'), 'the manager decides; the task closes');

-- 4. a clean one is received at once; weighed goods agree within 20 g
set role authenticated;
select t.login('besa@kt.al');
select public.transfer_pack_start(:'wh', :'dep') as tr2 \gset
select public.transfer_pack_add(:'tr2', :'i1', 3);
select public.ship_stock_transfer(:'tr2');
select t.login('ivo@kt.al');
select public.transfer_count_add(:'tr2', :'i1', 1);
select public.transfer_count_add(:'tr2', :'i1', 2);
select t.ok((public.transfer_receive_blind(:'tr2') ->> 'ok')::boolean, 'everything agrees: received in one step');
reset role;
select t.ok((select status from public.stock_transfers where id = :'tr2') = 'done', 'and the transfer is done');
update public.products set uom_id = (select id from public.units_of_measure where company_id = :'co' and code = 'kg')
 where id = (select product_id from public.product_variants where id = :'i1');
select t.ok(app.transfer_tolerance(:'i1') = 0.02 and app.transfer_tolerance(:'i2') = 0, 'kilograms tolerate 20 g; pieces nothing');

\set QUIET off
select count(*) as assertions_passed from t.results;
