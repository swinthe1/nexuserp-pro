-- =============================================================================
-- DrisPRO · where is it: one item across every unit, where to take it from, asking for it,
-- and replenishment that moves what another unit can spare before buying
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
insert into auth.users (email, raw_user_meta_data) values
  ('mgr@nj.al', '{"full_name":"Mira Menaxhere"}'), ('ana@nj.al', '{"full_name":"Ana Arkëtare"}'), ('ben@nj.al', '{"full_name":"Ben Dyqani 2"}')
  on conflict do nothing;
select id as u_ben from auth.users where email = 'ben@nj.al' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
set role authenticated;
select t.login(:'boss');
select public.create_company('Njësitë Test', 'XK') as co \gset
select public.invite_member(:'co', 'mgr@nj.al', array['store_manager']);
select t.accept_invites();
select public.invite_member(:'co', 'ana@nj.al', array['pos_cashier']);
select t.accept_invites();
select public.invite_member(:'co', 'ben@nj.al', array['warehouse_operator']);
select t.accept_invites();
select t.login(:'boss');
select id as pcs from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'COLA', 'name', 'Kola 2 L', 'uom_id', :'pcs', 'sales_price', 1.5)) as p1 \gset
select id as cola from public.product_variants where product_id = :'p1' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'UJE', 'name', 'Ujë 1,5 L', 'uom_id', :'pcs', 'sales_price', 0.5)) as p2 \gset
select id as uje from public.product_variants where product_id = :'p2' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'UJEG', 'name', 'Ujë me gaz 1 L', 'uom_id', :'pcs', 'sales_price', 0.6)) as p3 \gset

reset role;
select id as wh from public.warehouses where company_id = :'co' and warehouse_type = 'warehouse' and deleted_at is null order by created_at limit 1 \gset
select app.main_location(:'wh') as wh_loc \gset
insert into public.warehouses (company_id, code, name, warehouse_type) values (:'co', 'S1', 'Dyqani 1', 'store') returning id as s1 \gset
insert into public.warehouses (company_id, code, name, warehouse_type) values (:'co', 'S2', 'Dyqani 2', 'store') returning id as s2 \gset
insert into public.warehouses (company_id, code, name, warehouse_type) values (:'co', 'S3', 'Dyqani 3', 'store') returning id as s3 \gset
insert into public.warehouses (company_id, code, name, warehouse_type) values (:'co', 'S4', 'Dyqani 4', 'store') returning id as s4 \gset
insert into public.warehouse_locations (company_id, warehouse_id, code, name, location_type, is_pickable)
select :'co', w.id, w.code || '/SALLA', 'Salla', 'internal', true from public.warehouses w where w.id in (:'s1', :'s2', :'s3', :'s4')
   and app.main_location(w.id) is null;
select app.virtual_location(:'co', 'adjustment') as adj \gset
-- cola: the warehouse 50, store 1 short (4, keeps 24–96 in packs of 6), store 2 plenty (150, same rule), store 3 40 without a rule, store 4 none
select app.post_stock_move(:'co', 'adjustment_in', :'cola', :'adj', :'wh_loc', 50, 1);
select app.post_stock_move(:'co', 'adjustment_in', :'cola', :'adj', app.main_location(:'s1'), 4, 1);
select app.post_stock_move(:'co', 'adjustment_in', :'cola', :'adj', app.main_location(:'s2'), 150, 1);
select app.post_stock_move(:'co', 'adjustment_in', :'cola', :'adj', app.main_location(:'s3'), 40, 1);
insert into public.replenishment_rules (company_id, variant_id, warehouse_id, min_qty, max_qty, multiple_qty) values
  (:'co', :'cola', :'s1', 24, 96, 6), (:'co', :'cola', :'s2', 24, 96, 6);
-- the people: Mira works in store 1, Ben in store 2
select public.member_set_warehouses((select id from public.company_members where company_id = :'co' and user_id = (select id from auth.users where email = 'mgr@nj.al')), array[:'s1']::uuid[]);
select public.member_set_warehouses((select id from public.company_members where company_id = :'co' and user_id = :'u_ben'), array[:'s2']::uuid[]);
set role authenticated;

-- ---------- the lookup ------------------------------------------------------------------------
select t.login(:'boss');
select public.item_where(:'co', 'COLA') as r \gset
select t.ok((:'r'::jsonb ->> 'found')::boolean and (:'r'::jsonb -> 'item' ->> 'variant_id')::uuid = :'cola', 'a scanned code finds the item');
select t.ok(jsonb_array_length(:'r'::jsonb -> 'units') = 5, 'every active unit is listed');
select t.ok((select x ->> 'status' from jsonb_array_elements(:'r'::jsonb -> 'units') x where (x ->> 'id')::uuid = :'s1') = 'low'
        and (select x ->> 'status' from jsonb_array_elements(:'r'::jsonb -> 'units') x where (x ->> 'id')::uuid = :'s4') = 'none'
        and (select x ->> 'status' from jsonb_array_elements(:'r'::jsonb -> 'units') x where (x ->> 'id')::uuid = :'s2') = 'ok',
  'short, missing and fine units are told apart');
select t.ok((select (x ->> 'spare')::numeric from jsonb_array_elements(:'r'::jsonb -> 'units') x where (x ->> 'id')::uuid = :'s2') = 126
        and (select (x ->> 'spare')::numeric from jsonb_array_elements(:'r'::jsonb -> 'units') x where (x ->> 'id')::uuid = :'s3') = 20
        and (select (x ->> 'spare')::numeric from jsonb_array_elements(:'r'::jsonb -> 'units') x where (x ->> 'id')::uuid = :'wh') = 50,
  'what a unit can spare: above its minimum, half for a store without one, all of it for a warehouse');
select t.ok(jsonb_array_length(:'r'::jsonb -> 'suggestions') = 1, 'without "my unit", every short unit gets a suggestion');

select public.item_where(:'co', null, :'cola', :'s1') as r \gset
select t.ok((:'r'::jsonb -> 'suggestions' -> 0 ->> 'kind') = 'transfer' and (:'r'::jsonb -> 'suggestions' -> 0 ->> 'from')::uuid = :'s2',
  'take it from the unit that can spare the most');
select t.ok((:'r'::jsonb -> 'suggestions' -> 0 ->> 'qty')::numeric = 96 and (:'r'::jsonb -> 'suggestions' -> 0 ->> 'basis') = 'rule',
  'up to its maximum, in whole packs (96 - 4 = 92 → 96)');
select public.item_where(:'co', null, :'cola', :'s2') as r \gset
select t.ok(jsonb_array_length(:'r'::jsonb -> 'suggestions') = 0, 'a unit with enough gets no suggestion');

select t.ok((public.item_where(:'co', 'kola') -> 'item' ->> 'variant_id')::uuid = :'cola', 'typing a name finds it');
select t.ok(jsonb_array_length(public.item_where(:'co', 'ujë') -> 'matches') = 2 and not (public.item_where(:'co', 'ujë') ->> 'found')::boolean,
  'several names match: the list to choose from');
select t.ok(not (public.item_where(:'co', 'XYZ-404') ->> 'found')::boolean, 'an unknown code finds nothing');

-- ---------- who may do what -------------------------------------------------------------------
select t.login('ana@nj.al');
select t.ok((public.item_where(:'co', 'COLA') ->> 'found')::boolean and not (public.item_where(:'co', 'COLA') ->> 'can_request')::boolean,
  'a cashier sees every unit but does not ask for transfers');
select t.throws(format($q$select public.item_request(%L, %L, %L, %L, 12)$q$, :'co', :'cola', :'s2', :'s1'), 'Permission denied', 'nor can she');

select t.login('mgr@nj.al');
select t.ok((public.item_where(:'co', 'COLA') ->> 'here')::uuid = :'s1', 'someone who works in one unit only: that is their unit');
select public.item_request(:'co', :'cola', :'s2', :'s1', 48, 'Për fundjavë') as q1 \gset
select t.ok((select is_request and status = 'draft' and from_warehouse_id = :'s2' and to_warehouse_id = :'s1' from public.stock_transfers where id = (:'q1'::jsonb ->> 'id')::uuid),
  'asking makes a transfer request from that unit to mine');
select public.item_request(:'co', :'cola', :'s2', :'s1', 12) as q2 \gset
select t.ok((:'q2'::jsonb ->> 'merged')::boolean and (:'q2'::jsonb ->> 'id') = (:'q1'::jsonb ->> 'id')
        and (select quantity from public.stock_transfer_lines where transfer_id = (:'q1'::jsonb ->> 'id')::uuid) = 60,
  'asking again joins the open request (48 + 12)');
select t.throws(format($q$select public.item_request(%L, %L, %L, %L, 0)$q$, :'co', :'cola', :'s2', :'s1'), 'more than zero', 'a quantity is needed');
select t.throws(format($q$select public.item_request(%L, %L, %L, %L, 5)$q$, :'co', :'cola', :'s1', :'s1'), 'two different', 'two different units');
select t.throws(format($q$select public.item_request(%L, %L, %L, %L, 5)$q$, :'co', :'cola', :'s2', :'s3'), 'do not work', 'only for a transfer that touches one''s own unit');

select public.item_where(:'co', null, :'cola', :'s1') as r \gset
select t.ok((select (x ->> 'incoming')::numeric from jsonb_array_elements(:'r'::jsonb -> 'units') x where (x ->> 'id')::uuid = :'s1') = 60
        and jsonb_array_length((select x -> 'docs' from jsonb_array_elements(:'r'::jsonb -> 'units') x where (x ->> 'id')::uuid = :'s1')) = 1,
  'what was asked for shows as on the way, with its document');
select t.ok((:'r'::jsonb -> 'suggestions' -> 0 ->> 'qty')::numeric = 36 and (:'r'::jsonb -> 'suggestions' -> 0 ->> 'from_spare')::numeric = 66,
  'the next suggestion counts what is coming (96 - 64 → 36) and what store 2 already promised (126 - 60)');

reset role;
select t.ok((select count(*) from public.notifications where company_id = :'co' and user_id = :'u_ben' and type = 'transfer_request'
               and title = 'Stock request from Dyqani 1' and category = 'stock') >= 1,
  'the people of the sending unit are told');
set role authenticated;

-- ---------- replenishment: what another unit can spare goes first -----------------------------
select t.login(:'boss');
delete from public.stock_transfers where id = (:'q1'::jsonb ->> 'id')::uuid;
reset role;
select app.post_stock_move(:'co', 'adjustment_in', :'uje', :'adj', app.main_location(:'s2'), 60, 0.2);
select app.post_stock_move(:'co', 'adjustment_in', :'uje', :'adj', app.main_location(:'s3'), 100, 0.2);
insert into public.replenishment_rules (company_id, variant_id, warehouse_id, min_qty, max_qty, multiple_qty) values
  (:'co', :'uje', :'s1', 10, 50, 1), (:'co', :'uje', :'s2', 5, 20, 1);
set role authenticated;
select t.login(:'boss');
select public.generate_replenishment(:'co');
select t.ok((select count(*) from public.replenishment_suggestions where company_id = :'co' and status = 'open' and variant_id = :'uje' and warehouse_id = :'s1'
               and replenish_method = 'transfer' and source_warehouse_id = :'s2' and suggested_qty = 50) = 1
        and not exists (select 1 from public.replenishment_suggestions where company_id = :'co' and status = 'open' and variant_id = :'uje' and replenish_method = 'buy'),
  'store 2 can spare 55 above its minimum: the 50 are moved, nothing is bought (store 3 has no rule and is left alone)');
select public.set_replenishment_automation(:'co', p_from_units => false);
select public.generate_replenishment(:'co');
select t.ok((select count(*) from public.replenishment_suggestions where company_id = :'co' and status = 'open' and variant_id = :'uje' and replenish_method = 'buy' and suggested_qty = 50) = 1
        and not exists (select 1 from public.replenishment_suggestions where company_id = :'co' and status = 'open' and variant_id = :'uje' and replenish_method = 'transfer'),
  'switched off: everything is bought');

reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
