-- =============================================================================
-- #27 as meant: fruit and vegetables thrown away when they go off, weighed on the Zebra; the share of
-- what was sold and of what came in, in kilograms and in value  (runs after 64, 80–91 on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select id as reg from public.pos_registers where company_id = :'co' and code = 'T10' \gset
select warehouse_id as shop from public.pos_registers where id = :'reg' \gset
select id as kg from public.units_of_measure where company_id = :'co' and code = 'kg' \gset
set role authenticated;
select t.login(:'boss');

-- a group that goes off, and bananas by the kilogram (PLU 77 on the scale)
insert into public.product_categories (company_id, name, perishable) values (:'co', 'Fruta', true) returning id as fruit \gset
insert into public.product_categories (company_id, name) values (:'co', 'Detergjentë') returning id as soap \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'KT-BAN', 'name', 'Banane', 'uom_id', :'kg', 'sales_price', 1.5, 'category_id', :'fruit')) as banp \gset
select id as ban from public.product_variants where product_id = :'banp' \gset
update public.products set scale_plu = '77' where id = :'banp';
reset role;
select app.post_stock_move(:'co', 'receipt', :'ban', app.virtual_location(:'co', 'supplier'), app.main_location(:'shop'), 100, 1);
set role authenticated;
select t.login(:'boss');

-- the Zebra finds it by its PLU, and by the scale's label with the weight inside
select t.ok((select variant_id from public.find_variant_by_code(:'co', '77')) = :'ban', 'the PLU typed by hand finds the bananas');
select t.ok((select units_per_scan from public.find_variant_by_code(:'co', '2100077012345')) = 1.234, 'the scale''s label: the bananas, 1.234 kg');
select t.ok(public.waste_items(:'co', :'shop') @> jsonb_build_array(jsonb_build_object('variant_id', :'ban', 'plu', '77')), 'the Zebra lists the fresh items of the store');

-- 40 kg sold, 2 kg thrown away
select public.open_pos_session(:'reg', 0) as ses \gset
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'ban', 'quantity', 40, 'unit_price', 1.5)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 60)))) is not null as sold \gset
select public.waste_submit(jsonb_build_object('company_id', :'co', 'warehouse_id', :'shop', 'reason', 'waste', 'note', 'të prishura',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'ban', 'quantity', 2)))) ->> 'status' as st \gset
select t.ok(:'st' = 'posted', 'thrown away: out of the stock at once');

select public.waste_report(:'co', jsonb_build_object('from', current_date, 'to', current_date, 'by', 'item', 'units', jsonb_build_array(:'shop'))) as w \gset
select r.value as b from jsonb_array_elements(:'w'::jsonb -> 'rows') r where r.value ->> 'key' = :'ban' \gset
select t.ok((:'b'::jsonb ->> 'waste_qty')::numeric = 2 and (:'b'::jsonb ->> 'sold_qty')::numeric = 40 and (:'b'::jsonb ->> 'in_qty')::numeric = 100,
  '2 kg thrown away, 40 kg sold, 100 kg came in');
select t.ok((:'b'::jsonb ->> 'pct_qty_sold')::numeric = 5 and (:'b'::jsonb ->> 'pct_qty_in')::numeric = 2, 'in quantity: 5 % of what was sold, 2 % of what came in');
select t.ok((:'b'::jsonb ->> 'pct_value_sold')::numeric = 5 and (:'b'::jsonb ->> 'waste_cost')::numeric = 2, 'in value: 5 % of the sales (at the selling price), 2.00 at cost');
select t.ok((:'w'::jsonb -> 'totals' ->> 'waste_kg')::numeric >= 2 and :'w'::jsonb -> 'fresh_groups' ? :'fruit', 'the totals in kilograms, from the groups that go off');
select t.ok(not exists (select 1 from jsonb_array_elements(:'w'::jsonb -> 'rows') r where r.value ->> 'key' = (select id::text from public.product_variants where sku = 'KT-BEER' and company_id = :'co')),
  'beer is not fruit: left out unless its group is chosen');
select t.ok(jsonb_array_length(public.waste_report(:'co', jsonb_build_object('from', current_date, 'to', current_date, 'groups', jsonb_build_array(:'soap'))) -> 'rows') = 0,
  'another group chosen: only that group');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
