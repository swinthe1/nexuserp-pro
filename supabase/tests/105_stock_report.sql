-- =============================================================================
-- "Raporti i stokut": the stock on a day from the movements, a row per unit or all together, the average and
-- the last purchase cost, the sale price of that day (the unit's till price list, the price history), the
-- producer, and the stock filters.  (its own company, after 02)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select email as boss from public.profiles where is_super_admin limit 1 \gset
set role authenticated;
select t.login(:'boss');
select public.create_company('Stoku Test', 'XK') as co \gset
reset role;
select id as pcs from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select id as vat18 from public.tax_codes where company_id = :'co' and code = 'VAT18' \gset
select id as wh from public.warehouses where company_id = :'co' and deleted_at is null order by created_at limit 1 \gset
select id as wh_stock from public.warehouse_locations where warehouse_id = :'wh' and location_type = 'internal' order by code limit 1 \gset
insert into public.business_partners (company_id, code, name, is_vendor) values (:'co', 'V-Z', 'Zott Kosova', true) returning id as vendor \gset
insert into public.bank_accounts (company_id, name, account_kind, currency_code, account_id)
select :'co', 'Arka', 'cash', 'EUR', id from public.accounts where company_id = :'co' and code = '5311';
update public.company_settings set multi_unit = true where company_id = :'co';

set role authenticated;
select t.login(:'boss');
select public.unit_create(jsonb_build_object('company_id', :'co', 'kind', 'store', 'name', 'Market 1', 'code', 'M1', 'tills', 1)) as m1r \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'JOG', 'name', 'Jogurt 180 g', 'uom_id', :'pcs', 'sales_price', 1,
  'sales_tax_code_id', :'vat18', 'manufacturer', ' Zott ', 'brand', 'Zott Natur')) as jog_p \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'KOS', 'name', 'Kos 1 kg', 'uom_id', :'pcs', 'sales_price', 2,
  'sales_tax_code_id', :'vat18', 'manufacturer', 'Bylmeti')) as kos_p \gset
reset role;
select (:'m1r'::jsonb ->> 'id') as m1 \gset
select id as m1_stock from public.warehouse_locations where warehouse_id = :'m1' and location_type = 'internal' order by code limit 1 \gset
select id as jog from public.product_variants where product_id = :'jog_p' \gset
select t.ok((select manufacturer = 'Zott' from public.products where id = :'jog_p'), 'a new item keeps its producer');

-- the stock comes in: 100 to the warehouse at 0,50 (+10 import costs), then 40 to the market at 0,70
set role authenticated;
select t.login(:'boss');
insert into public.goods_receipts (company_id, warehouse_id, vendor_id, receipt_date) values (:'co', :'wh', :'vendor', current_date - 3) returning id as gr1 \gset
insert into public.goods_receipt_lines (company_id, receipt_id, variant_id, location_id, quantity, unit_cost, landed_cost_amount) values (:'co', :'gr1', :'jog', :'wh_stock', 100, 0.5, 10);
select public.post_goods_receipt(:'gr1');
insert into public.goods_receipts (company_id, warehouse_id, vendor_id, receipt_date) values (:'co', :'m1', :'vendor', current_date - 1) returning id as gr2 \gset
insert into public.goods_receipt_lines (company_id, receipt_id, variant_id, location_id, quantity, unit_cost) values (:'co', :'gr2', :'jog', :'m1_stock', 40, 0.7);
select public.post_goods_receipt(:'gr2');
-- the price goes up today; the market sells from its own price list (with VAT)
update public.products set sales_price = 1.2 where id = :'jog_p';
insert into public.price_lists (company_id, name, list_type, currency_code, prices_include_tax) values (:'co', 'Market 1', 'sales', 'EUR', true) returning id as pl \gset
insert into public.price_list_items (company_id, price_list_id, variant_id, price) values (:'co', :'pl', :'jog', 2.36);
reset role;
update public.pos_registers set price_list_id = :'pl' where warehouse_id = :'m1';
insert into public.replenishment_rules (company_id, variant_id, warehouse_id, min_qty, max_qty) values (:'co', :'jog', :'wh', 500, 1000);

set role authenticated;
select t.login(:'boss');
select public.stock_report(:'co', '{"report": "avg_sale"}') as all1 \gset
select public.stock_report(:'co', '{"report": "avg_sale", "split": true}') as split \gset
select public.stock_report(:'co', jsonb_build_object('report', 'avg', 'as_of', current_date - 1)) as past \gset
select public.stock_report(:'co', jsonb_build_object('report', 'avg', 'as_of', current_date - 5)) as before \gset
select public.stock_report(:'co', '{"report": "avg", "stock": "all"}') as zero_too \gset
select public.stock_report(:'co', jsonb_build_object('report', 'last_cost', 'stock', 'all', 'as_of', current_date - 2)) as early \gset
select public.stock_report(:'co', '{"report": "avg", "stock": "zero"}') as zero_only \gset
select public.stock_report(:'co', '{"report": "avg", "stock": "below_min", "split": true}') as low \gset
select public.stock_report(:'co', '{"report": "by_producer", "stock": "all", "producers": ["Bylmeti"]}') as byl \gset
select public.stock_report(:'co', jsonb_build_object('report', 'sale', 'units', jsonb_build_array(:'m1'))) as m1only \gset
select public.stock_report(:'co', '{"report": "price_list"}') as plist \gset
reset role;

select t.ok((select (x ->> 'qty')::numeric = 140 and (x ->> 'value')::numeric = 78 and (x ->> 'avg_cost')::numeric = round(78 / 140.0, 4)
               from jsonb_array_elements(:'all1'::jsonb -> 'rows') x where x ->> 'code' = 'JOG'),
            'all units: 140 pieces worth 50 + 28 = 78 as the books have it, at the average cost');
select t.ok((select (x ->> 'last_cost')::numeric = 0.7 and x ->> 'last_vendor' = 'Zott Kosova' and (x ->> 'last_date')::date = current_date - 1
               from jsonb_array_elements(:'all1'::jsonb -> 'rows') x where x ->> 'code' = 'JOG'), 'the last purchase cost, its day and its supplier');
select t.ok((select count(*) = 2 and sum((x ->> 'qty')::numeric) = 140 and sum((x ->> 'value')::numeric) = 78
               from jsonb_array_elements(:'split'::jsonb -> 'rows') x where x ->> 'code' = 'JOG'), 'a row per unit adds up to the same');
select t.ok((select (x ->> 'sale_net')::numeric = 2 and (x ->> 'sale_gross')::numeric = 2.36 from jsonb_array_elements(:'split'::jsonb -> 'rows') x
               where x ->> 'code' = 'JOG' and x ->> 'unit' = 'Market 1'), 'the market sells at its own till price list (2,36 with VAT = 2,00 without)');
select t.ok((select (x ->> 'sale_net')::numeric = 1.2 and (x ->> 'value_sale_net')::numeric = 120 and (x ->> 'margin')::numeric = 70
               from jsonb_array_elements(:'split'::jsonb -> 'rows') x where x ->> 'code' = 'JOG' and x ->> 'unit_id' = :'wh'),
            'the warehouse at the item price of today: 100 × 1,20 = 120, margin 70 over the cost of 50');
select t.ok((select (x ->> 'last_cost')::numeric = 0.6 from jsonb_array_elements(:'early'::jsonb -> 'rows') x where x ->> 'code' = 'JOG'),
            'the last purchase cost as it was on an earlier day, with its import costs ((50 + 10) / 100)');
select t.ok((select (x ->> 'qty')::numeric = 140 and (x ->> 'sale_net')::numeric = 1 from jsonb_array_elements(:'past'::jsonb -> 'rows') x where x ->> 'code' = 'JOG'),
            'yesterday: the stock as it was, at the price of yesterday (1,00 before the change)');
select t.ok(jsonb_array_length(:'before'::jsonb -> 'rows') = 0 and (:'before'::jsonb ->> 'as_of')::date = current_date - 5, 'before the goods came in: nothing');
select t.ok(exists (select 1 from jsonb_array_elements(:'zero_too'::jsonb -> 'rows') x where x ->> 'code' = 'KOS' and (x ->> 'qty')::numeric = 0)
            and not exists (select 1 from jsonb_array_elements(:'all1'::jsonb -> 'rows') x where x ->> 'code' = 'KOS'), 'items without stock only when asked for');
select t.ok((select bool_and(x ->> 'code' = 'KOS') from jsonb_array_elements(:'zero_only'::jsonb -> 'rows') x), 'only the items at zero');
select t.ok((select count(*) = 1 and bool_and(x ->> 'unit_id' = :'wh') from jsonb_array_elements(:'low'::jsonb -> 'rows') x), 'below the minimum of its unit');
select t.ok((select count(*) = 1 and bool_and(x ->> 'producer' = 'Bylmeti') from jsonb_array_elements(:'byl'::jsonb -> 'rows') x), 'by producer');
select t.ok((select (x ->> 'qty')::numeric = 40 and (x ->> 'value_sale_gross')::numeric = 94.4 from jsonb_array_elements(:'m1only'::jsonb -> 'rows') x where x ->> 'code' = 'JOG'),
            'one unit: its stock at its own prices (40 × 2,36)');
select t.ok(jsonb_array_length(:'plist'::jsonb -> 'rows') = 2, 'the price list has every item, stock or not');

-- the import reads the producer
set role authenticated;
select t.login(:'boss');
select public.import_rows(:'co', 'products', '[{"sku":"KOS","name":"Kos 1 kg","manufacturer":"Bylmeti Fushë Kosovë"}]', false);
reset role;
select t.ok((select manufacturer = 'Bylmeti Fushë Kosovë' from public.products where id = :'kos_p'), 'the import changes the producer');

-- who may see
set role authenticated;
select t.login('cora@kt.al');
select t.throws(format($q$select public.stock_report(%L, '{}')$q$, :'co'), 'Permission', 'not for another company');
select t.login(:'boss');
select t.throws(format($q$select public.stock_report(%L, '{"report": "nope"}')$q$, :'co'), 'Unknown report', 'a report we know');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
