-- =============================================================================
-- DrisPRO · selling below zero does not spoil the cost (runs after 01–39)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Negative Test', 'country', 'XK', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 10,
  'valid_until', (current_date + 365)::text)) as co \gset
select t.login('alice@alba.al');
select id as pcs from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'NEG', 'name', 'Artikull i ri', 'uom_id', :'pcs', 'sales_price', 10)) as p \gset
select id as var from public.product_variants where product_id = :'p' \gset
select id as stock from public.warehouse_locations where company_id = :'co' and code = 'WH/STOCK' \gset
reset role;
insert into public.business_partners (company_id, code, name, is_vendor) values (:'co', 'V1', 'Furnitori', true) returning id as vend \gset
insert into public.vendor_products (company_id, vendor_id, variant_id, vendor_sku, price, currency_code) values (:'co', :'vend', :'var', 'F-123', 4, 'EUR');
update public.company_settings set allow_negative_stock = true where company_id = :'co';
select app.virtual_location(:'co', 'supplier') as sup, app.virtual_location(:'co', 'adjustment') as adj \gset

-- sold before it was ever received: it leaves at the supplier's price, not at zero
select app.post_stock_move(:'co', 'adjustment_out', :'var', :'stock', :'adj', 10) as m1 \gset
select t.ok((select unit_cost = 4 from public.stock_movements where id = :'m1'), 'an item with no cost yet leaves at its best known cost (the supplier''s price)');
select t.ok((select qty_on_hand = -10 and avg_cost = 4 and total_value = -40 from public.item_costs where variant_id = :'var'), 'the shortage is carried at that cost');

-- the goods arrive at 5: the shortage is settled at the real cost; the difference corrects the cost of what was sold
select app.post_stock_move(:'co', 'receipt', :'var', :'sup', :'stock', 10, 5) as m2 \gset
select t.ok((select qty_on_hand = 0 and total_value = 0 from public.item_costs where variant_id = :'var'), 'settled: nothing in stock, nothing in value');
select t.ok((select total_cost = -10 from public.stock_movements where variant_id = :'var' and movement_type = 'revaluation'), 'the difference (10 × 1) is recorded');
select t.ok((select sum(cost) = 10 from app.sales_facts(:'co', current_date - 1, current_date + 1) where doc_type = 'cost_correction' and variant_id = :'var'),
  'the margin report charges the difference to the item');

-- still below zero after a smaller delivery: the average follows the real cost
select app.post_stock_move(:'co', 'adjustment_out', :'var', :'stock', :'adj', 10);
select app.post_stock_move(:'co', 'receipt', :'var', :'sup', :'stock', 4, 6);
select t.ok((select qty_on_hand = -6 and avg_cost = 6 and total_value = -36 from public.item_costs where variant_id = :'var'), 'what is still missing is valued at the latest real cost');
select app.post_stock_move(:'co', 'receipt', :'var', :'sup', :'stock', 16, 6);
select t.ok((select qty_on_hand = 10 and avg_cost = 6 and total_value = 60 from public.item_costs where variant_id = :'var'), 'and once in stock again the cost is exact: 10 × 6');

-- the supplier's article number finds the item
select t.ok((select matched_by = 'vendor_code' from public.find_variant_by_code(:'co', 'f-123') limit 1), 'the supplier''s article number finds the item');

\set QUIET off
select count(*) as assertions_passed from t.results;
