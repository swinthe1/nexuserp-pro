-- =============================================================================
-- DrisPRO · margin analysis with discounts and suppliers; depreciation by itself (runs after 01–40)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Margin Test', 'country', 'XK', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 10,
  'valid_until', (current_date + 365)::text)) as co \gset
select t.login('alice@alba.al');
select id as pcs from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'MRG', 'name', 'Artikull marzhi', 'uom_id', :'pcs', 'sales_price', 10)) as p \gset
select id as var from public.product_variants where product_id = :'p' \gset
reset role;
insert into public.business_partners (company_id, code, name, is_vendor) values (:'co', 'V1', 'Furnitori Alfa', true) returning id as vend \gset
insert into public.vendor_products (company_id, vendor_id, variant_id, vendor_sku, price, currency_code, is_preferred) values (:'co', :'vend', :'var', 'A-1', 4, 'EUR', true);
-- a negative-stock settlement gives the item a fact row (cost 10) without any sale
update public.company_settings set allow_negative_stock = true where company_id = :'co';
select id as stock from public.warehouse_locations where company_id = :'co' and code = 'WH/STOCK' \gset
select app.virtual_location(:'co', 'supplier') as sup, app.virtual_location(:'co', 'adjustment') as adj \gset
select app.post_stock_move(:'co', 'adjustment_out', :'var', :'stock', :'adj', 10);
select app.post_stock_move(:'co', 'receipt', :'var', :'sup', :'stock', 10, 5);

set role authenticated;
select t.login('alice@alba.al');
select public.run_report(:'co', 'margin', jsonb_build_object('from', (current_date - 1)::text, 'to', (current_date + 1)::text, 'group_by', 'vendor')) as rep \gset
select t.ok((:'rep'::jsonb -> 'dims') ? 'vendor' and (:'rep'::jsonb -> 'dims') ? 'warehouse', 'the margin report groups by supplier and by warehouse');
select t.ok((select bool_or(r ->> 'label' = 'Furnitori Alfa') from jsonb_array_elements(:'rep'::jsonb -> 'rows') r), 'the item counts under its preferred supplier');
select t.ok((select count(*) = 3 from jsonb_array_elements(:'rep'::jsonb -> 'columns') c where c ->> 'key' in ('discount', 'markup_pct', 'below_cost')),
  'discounts given, markup on cost and lines below cost are shown');
select t.ok(not ((public.run_report(:'co', 'sales', '{}'::jsonb) -> 'columns') @> '[{"key":"discount"}]'), 'the sales report stays as it was');

-- depreciation by itself
select public.set_depreciation_auto(:'co', true);
reset role;
select t.ok((select depreciation_auto from public.company_settings where company_id = :'co'), 'finance turns on depreciation by itself');
insert into public.fixed_assets (company_id, name, category_id, acquisition_date, in_service_date, acquisition_cost, useful_life_months)
select :'co', 'Kompjuter', id, (date_trunc('month', current_date) - interval '3 months')::date, (date_trunc('month', current_date) - interval '3 months')::date, 1200, 12
  from public.fixed_asset_categories where company_id = :'co' order by name limit 1 returning id as pc \gset
set role authenticated;
select t.login('alice@alba.al');
select public.activate_fixed_asset(:'pc', (select id from public.accounts where company_id = :'co' and is_postable order by code desc limit 1));
reset role;
select set_config('request.jwt.claim.sub', '', false);
select app.depreciation_monthly() as n \gset
select t.ok(:n = 1, 'the monthly run records it');
select t.ok((select count(*) >= 2 from public.asset_depreciation_lines where asset_id = :'pc' and status = 'posted')
        and not exists (select 1 from public.asset_depreciation_lines where asset_id = :'pc' and status = 'posted' and period_date >= date_trunc('month', current_date)),
  'every month up to the end of last month, nothing of this month');
select t.ok((select app.depreciation_monthly()) = 0, 'running it again records nothing twice');
select t.ok(exists (select 1 from public.notifications where company_id = :'co' and title like 'Depreciation up to %'), 'finance is told');

\set QUIET off
select count(*) as assertions_passed from t.results;
