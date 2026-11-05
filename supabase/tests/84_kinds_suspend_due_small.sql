-- =============================================================================
-- From the meeting with the administrative staff: the kind of a supplier (#13), suspending and
-- deleting items (#5), the debts by due date (#1), the small inventory (#3)
-- (runs after 64 "Kontrolle Test", 80–83)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select id as shop from public.warehouses where company_id = :'co' and code <> 'DP' order by created_at limit 1 \gset
select id as depot from public.warehouses where company_id = :'co' and code = 'DP' \gset
select id as beer, product_id as beer_p from public.product_variants where company_id = :'co' and sku = 'KT-BEER' \gset
select id as ven from public.business_partners where company_id = :'co' and code = 'FT1' \gset
select id as pcs from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
set role authenticated;
select t.login(:'boss');

-- ---------------------------------------------------------------- 13
select t.ok((select vendor_kinds from public.business_partners where id = :'ven') = '{goods}', 'a supplier of stock items is a supplier of goods, from its invoices');
select t.ok(jsonb_path_exists(public.partner_balances(:'co', 'vendor'), '$.rows[*] ? (@.kinds[*] == "goods")'), 'the partner cards know the kind');
select t.throws(format($q$update public.business_partners set vendor_kinds = '{fuel}' where id = %L$q$, :'ven'), 'vendor_kinds', 'only goods, expenses and investments');

-- ---------------------------------------------------------------- 5
select t.throws(format($q$delete from public.products where id = %L$q$, :'beer_p'), 'stock history', 'an item that moved in stock is not deleted');
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'KT-NEW', 'name', 'Artikull pa lëvizje', 'uom_id', :'pcs', 'sales_price', 2)) as newp \gset
delete from public.products where id = :'newp';
reset role;
select t.ok((select deleted_at is not null from public.products where id = :'newp'), 'an item that never moved can be deleted');
set role authenticated;
select t.login(:'boss');
update public.products set is_active = false where id = :'beer_p';
update public.product_variants set is_active = false where product_id = :'beer_p';
select t.throws(format($q$select public.save_document('vendor_bills', jsonb_build_object('company_id', %L, 'document_type', 'vendor_bill', 'vendor_id', %L, 'vendor_invoice_number', 'SUS-1',
   'bill_date', current_date, 'due_date', current_date, 'currency_code', 'EUR', 'warehouse_id', %L),
   jsonb_build_object('vendor_bill_lines', jsonb_build_array(jsonb_build_object('line_no', 1, 'variant_id', %L, 'description', 'Birra', 'quantity', 1, 'unit_price', 1))))$q$, :'co', :'ven', :'shop', :'beer'),
  'suspended', 'a suspended item is not bought');
reset role;
select t.ok((select count(*) from public.stock_movements where variant_id = :'beer') > 0 and exists (select 1 from public.stock_levels where variant_id = :'beer'), 'its history and stock stay');
set role authenticated;
select t.login(:'boss');
update public.products set is_active = true where id = :'beer_p';
update public.product_variants set is_active = true where product_id = :'beer_p';

-- ---------------------------------------------------------------- 1
select public.save_document('vendor_bills', jsonb_build_object('company_id', :'co', 'document_type', 'vendor_bill', 'vendor_id', :'ven', 'vendor_invoice_number', 'DUE-1',
   'bill_date', current_date, 'due_date', current_date + 10, 'currency_code', 'EUR', 'warehouse_id', :'shop'),
   jsonb_build_object('vendor_bill_lines', jsonb_build_array(jsonb_build_object('line_no', 1, 'variant_id', :'beer', 'description', 'Birra', 'quantity', 5, 'unit_price', 1)))) as due1 \gset
select public.purchase_invoice_complete(:'due1');
select public.debts_by_due(:'co', 'ap') as d \gset
select t.ok(exists (select 1 from jsonb_array_elements(:'d'::jsonb -> 'rows') r where (r ->> 'id')::uuid = :'due1' and (r ->> 'days')::int = 10 and (r ->> 'due')::numeric = 5),
         'the bill with its due date, ten days from now, and what is still to pay');
select t.ok(jsonb_array_length(public.debts_by_due(:'co', 'ap', jsonb_build_object('kinds', jsonb_build_array('expenses'))) -> 'rows') = 0, 'filtered by the kind of supplier');
select t.ok(jsonb_array_length(public.debts_by_due(:'co', 'ap', jsonb_build_object('units', jsonb_build_array(:'depot'))) -> 'rows') = 0, 'and by unit');
select t.throws(format($q$select public.debts_by_due(%L, 'xx')$q$, :'co'), 'Choose customers or suppliers', 'customers or suppliers');

-- ---------------------------------------------------------------- 3
insert into public.small_assets (company_id, name, category, warehouse_id, unit_value) values (:'co', 'Peshore e sallës', 'Pajisje', :'shop', 350) returning id as a1, code as c1 \gset
insert into public.small_assets (company_id, name, warehouse_id, quantity, unit_value) values (:'co', 'Karrige', :'shop', 6, 25) returning code as c2 \gset
select t.ok(:'c1' = 'INV-00001' and :'c2' = 'INV-00002', 'each thing gets the next code');
select public.small_asset_count(:'co', lower(:'c1'), :'depot') as cnt \gset
select t.ok((:'cnt'::jsonb ->> 'found')::boolean and (:'cnt'::jsonb ->> 'moved')::boolean, 'scanned in the depot: counted, and moved there');
select t.ok((select counted_at is not null and warehouse_id = :'depot' from public.small_assets where id = :'a1'), 'kept with the date it was counted');
select t.ok(not (public.small_asset_count(:'co', 'INV-99999') ->> 'found')::boolean, 'an unknown code is said so');
select t.login('cora@kt.al');
select t.ok(not exists (select 1 from public.small_assets where company_id = :'co'), 'a cashier does not see the small inventory');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
