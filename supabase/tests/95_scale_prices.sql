-- =============================================================================
-- #8: the prices for the Rongta scale: the items with a PLU and their price with VAT, the PLU of many items
-- at once (from the names of the scale's file), and the price each had in the last file  (after 92–94)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select id as ban, product_id as banp from public.product_variants where sku = 'KT-BAN' and company_id = :'co' \gset
select id as beer, product_id as beerp from public.product_variants where sku = 'KT-BEER' and company_id = :'co' \gset
set role authenticated;
select t.login(:'boss');

select t.ok((select x ->> 'plu' from jsonb_array_elements(public.scale_items(:'co')) x where x ->> 'variant_id' = :'ban') = '77', 'the bananas are on the scale with PLU 77');
-- the file of the scale: the beer gets PLU 78 (sent as its variant), the bananas move to 79
select t.ok(public.scale_plu_set(:'co', jsonb_build_array(jsonb_build_object('variant_id', :'beer', 'plu', '078'), jsonb_build_object('product_id', :'banp', 'plu', '79'))) = 2, 'two items get their PLU at once');
select t.ok((select scale_plu from public.products where id = :'beerp') = '78' and (select scale_plu from public.products where id = :'banp') = '79', 'the PLUs are kept without leading zeros');
select t.throws(format('select public.scale_plu_set(%L, %L)', :'co', jsonb_build_array(jsonb_build_object('product_id', :'beerp', 'plu', '79'))), 'already on', 'one PLU, one item');
select t.ok(public.scale_plu_set(:'co', jsonb_build_array(jsonb_build_object('product_id', :'beerp', 'plu', '79'), jsonb_build_object('product_id', :'banp', 'plu', '78'))) = 2, 'two items can swap their PLUs');
-- the file was made
select (x ->> 'price')::numeric as p from jsonb_array_elements(public.scale_items(:'co')) x where x ->> 'variant_id' = :'ban' \gset
select public.scale_mark_sent(:'co', jsonb_build_array(jsonb_build_object('product_id', :'banp', 'price', :p)));
select t.ok((select (x ->> 'sent_price')::numeric = (x ->> 'price')::numeric from jsonb_array_elements(public.scale_items(:'co')) x where x ->> 'variant_id' = :'ban'), 'the price in the last file is remembered');
select public.scale_plu_set(:'co', jsonb_build_array(jsonb_build_object('product_id', :'beerp', 'plu', ''), jsonb_build_object('product_id', :'banp', 'plu', '77')));
select t.ok(not exists (select 1 from jsonb_array_elements(public.scale_items(:'co')) x where x ->> 'variant_id' = :'beer'), 'an empty PLU takes the item off the scale');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
