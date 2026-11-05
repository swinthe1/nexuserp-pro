-- =============================================================================
-- From the meeting with the administrative staff: every stock output with its value at cost and at
-- the selling price (#25); goods thrown away from the Zebra and against the sales (#27)
-- (runs after 64 "Kontrolle Test" and 80, where the shop received beer)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select id as shop from public.warehouses where company_id = :'co' order by created_at limit 1 \gset
select id as beer from public.product_variants where company_id = :'co' and sku = 'KT-BEER' \gset
select id as ivo from auth.users where email = 'ivo@kt.al' \gset
select coalesce(sum(on_hand), 0) as beer0 from public.stock_levels where variant_id = :'beer' and warehouse_id = :'shop' \gset
select t.ok(:'beer0'::numeric >= 5, 'the shop has beer to throw away');
set role authenticated;

-- ---------------------------------------------------------------- 27. from the Zebra
select t.login('cora@kt.al');
select t.throws(format($q$select public.waste_submit(jsonb_build_object('company_id', %L, 'warehouse_id', %L, 'lines', jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', 1))))$q$, :'co', :'shop', :'beer'),
  'Permission denied', 'a cashier does not take goods off the shelf');
select t.login('wanda@kt.al');
select t.throws(format($q$select public.waste_submit(jsonb_build_object('company_id', %L, 'warehouse_id', %L, 'lines', '[]'::jsonb))$q$, :'co', :'shop'), 'Scan what', 'nothing scanned, nothing sent');
select t.throws(format($q$select public.waste_submit(jsonb_build_object('company_id', %L, 'warehouse_id', %L, 'lines', jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', 100000))))$q$, :'co', :'shop', :'beer'),
  'Only', 'not more than the shop has');
select public.waste_submit(jsonb_build_object('company_id', :'co', 'warehouse_id', :'shop', 'note', 'Shishe të thyera',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'beer', 'quantity', 2)))) as w1 \gset
select t.ok(:'w1'::jsonb ->> 'status' = 'draft', 'the shelf worker''s batch waits for the stock manager');
reset role;
select t.ok(exists (select 1 from public.notifications where company_id = :'co' and user_id = :'ivo' and title like 'Goods thrown away to confirm: %'), 'the stock manager is told');
select t.ok((select reason from public.stock_adjustments where id = (:'w1'::jsonb ->> 'adjustment_id')::uuid) = 'waste', 'kept as thrown away');
set role authenticated;
select t.login('ivo@kt.al');
select public.waste_submit(jsonb_build_object('company_id', :'co', 'warehouse_id', :'shop', 'reason', 'internal_use',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'beer', 'quantity', 1)))) as w2 \gset
select t.ok(:'w2'::jsonb ->> 'status' = 'posted', 'the stock manager''s batch goes out of stock at once');
select public.post_stock_adjustment((:'w1'::jsonb ->> 'adjustment_id')::uuid);
reset role;
select t.ok((select coalesce(sum(on_hand), 0) from public.stock_levels where variant_id = :'beer' and warehouse_id = :'shop') = :'beer0'::numeric - 3, 'three beers fewer in the shop');
select t.ok(exists (select 1 from public.stock_movements where source_doc_id = (:'w1'::jsonb ->> 'adjustment_id')::uuid and movement_type = 'scrap'), 'thrown away goes to scrap');
set role authenticated;

-- ---------------------------------------------------------------- 25. each output with its values
select t.login('ivo@kt.al');
select public.stock_outputs(:'co', jsonb_build_object('from', current_date - 1, 'to', current_date + 1)) as o \gset
select t.ok(exists (select 1 from jsonb_array_elements(:'o'::jsonb -> 'rows') r where r ->> 'reason' = 'waste' and (r ->> 'quantity')::numeric = 2
                     and r ->> 'description' = 'Shishe të thyera' and (r ->> 'cost_net')::numeric > 0), 'the thrown-away beer with its description and its cost');
select t.ok(not exists (select 1 from jsonb_array_elements(:'o'::jsonb -> 'rows') r
                         where (r ->> 'sku' = 'KT-BEER' and abs((r ->> 'sale_net')::numeric - (r ->> 'quantity')::numeric * 1) > 0.01) or (r ->> 'sale_gross')::numeric < (r ->> 'sale_net')::numeric
                            or (r ->> 'cost_gross')::numeric < (r ->> 'cost_net')::numeric),
         'at the selling price (1 without VAT) and with VAT never below without');
select t.ok(jsonb_array_length(public.stock_outputs(:'co', jsonb_build_object('from', current_date - 1, 'to', current_date + 1, 'reasons', jsonb_build_array('internal_use'))) -> 'rows') = 1,
         'filtered by reason');

-- ---------------------------------------------------------------- 27. against the sales
select public.waste_vs_sales(:'co', jsonb_build_object('from', current_date - 30, 'to', current_date + 1, 'by', 'item')) as v \gset
select t.ok(exists (select 1 from jsonb_array_elements(:'v'::jsonb -> 'rows') r where r ->> 'code' = 'KT-BEER' and (r ->> 'waste_qty')::numeric = 2),
         'thrown away counts waste, damage and expiry, not what was used in the company');
select t.ok(not exists (select 1 from jsonb_array_elements(:'v'::jsonb -> 'rows') r where (r ->> 'sold_net')::numeric <> 0
                         and abs((r ->> 'pct_value')::numeric - round(100 * (r ->> 'waste_sale')::numeric / (r ->> 'sold_net')::numeric, 2)) > 0.011),
         'the share is the thrown-away value at the selling price over the sales');
select t.throws(format($q$select public.waste_vs_sales(%L, '{"by":"colour"}')$q$, :'co'), 'Cannot group by', 'by group or item only');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
