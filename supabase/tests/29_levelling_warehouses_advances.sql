-- =============================================================================
-- DrisPRO · price levelling, warehouses per user, advance invoices (runs after 01–28)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Nivelim Test', 'country', 'XK', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 10,
  'valid_until', (current_date + 365)::text)) as co \gset
select t.login('alice@alba.al');
select id as pcs  from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select id as vat  from public.tax_codes where company_id = :'co' and rate = 18 and deleted_at is null limit 1 \gset
select id as wh   from public.warehouses where company_id = :'co' and code = 'WH' \gset
select id as stock from public.warehouse_locations where company_id = :'co' and code = 'WH/STOCK' \gset
insert into public.warehouses (company_id, code, name, warehouse_type) values (:'co', 'SHOP', 'Dyqani', 'store') returning id as shop \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'KAF', 'name', 'Kafe', 'uom_id', :'pcs', 'sales_price', 10,
       'sales_tax_code_id', :'vat', 'purchase_tax_code_id', :'vat')) as p_kaf \gset
select id as kaf from public.product_variants where product_id = :'p_kaf' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'MONT', 'name', 'Montim', 'uom_id', :'pcs', 'product_type', 'service',
       'sales_price', 1000, 'sales_tax_code_id', :'vat')) as p_mont \gset
select id as mont from public.product_variants where product_id = :'p_mont' \gset
insert into public.business_partners (company_id, code, name, is_customer, is_vendor) values (:'co', 'K1', 'Klienti', true, true) returning id as pt \gset
insert into public.goods_receipts (company_id, receipt_type, vendor_id, warehouse_id, currency_code) values (:'co', 'purchase', :'pt', :'wh', 'EUR') returning id as gr \gset
insert into public.goods_receipt_lines (company_id, receipt_id, variant_id, location_id, quantity, unit_price) values (:'co', :'gr', :'kaf', :'stock', 5, 4);
select public.post_goods_receipt(:'gr') \gset

-- ---------- price levelling -------------------------------------------------------------------
select t.ok((public.price_level_items(:'co', array[:'kaf']::uuid[]) -> 0 ->> 'stock')::numeric = 5, 'the item with its stock and price');
insert into public.price_levels (company_id, notes) values (:'co', 'Çmime të reja') returning id as lv \gset
insert into public.price_level_lines (company_id, level_id, line_no, variant_id, new_price) values (:'co', :'lv', 1, :'kaf', 12);
select public.price_level_post(:'lv') as r \gset
select t.ok((:'r'::jsonb ->> 'changed')::int = 1 and (:'r'::jsonb ->> 'value_change')::numeric = 11.8, '5 in stock × 2 more × VAT 18 % = 11.80');
select t.ok((select sales_price from public.products where id = :'p_kaf') = 12, 'the new price is set');
select t.ok((select number from public.price_levels where id = :'lv') like 'NIV-%'
        and exists (select 1 from public.price_changes where variant_id = :'kaf' and doc_number = (select number from public.price_levels where id = :'lv')),
  'the price history names the levelling');
select t.ok((public.label_items(:'co', 'price_level', array[:'lv']::uuid[]) -> 'items' -> 0 ->> 'old_price')::numeric = 11.8, 'its labels show the old price');
select t.throws(format($q$select public.price_level_post(%L)$q$, :'lv'), 'already posted', 'posted once');

-- ---------- warehouses per user ---------------------------------------------------------------
select member_id as me from public.company_users(:'co') where is_self \gset
select public.member_set_warehouses(:'me', array[:'shop']::uuid[]);
select t.ok(public.my_warehouse_access(:'co') = array[:'shop']::uuid[], 'she works only in the shop now');
select t.throws(format($q$insert into public.goods_receipts (company_id, receipt_type, vendor_id, warehouse_id, currency_code) values (%L, 'purchase', %L, %L, 'EUR')$q$, :'co', :'pt', :'wh'),
  'do not work in the warehouse', 'goods into another warehouse are refused');
insert into public.goods_receipts (company_id, receipt_type, vendor_id, warehouse_id, currency_code) values (:'co', 'purchase', :'pt', :'shop', 'EUR');
select t.ok(true, 'into her own warehouse they go');
insert into public.stock_transfers (company_id, from_warehouse_id, to_warehouse_id) values (:'co', :'wh', :'shop');
select t.ok(true, 'a transfer to her warehouse is allowed');
select t.throws(format($q$insert into public.price_levels (company_id, warehouse_id) values (%L, %L)$q$, :'co', :'wh'), 'do not work in the warehouse', 'and so is levelling another warehouse''s prices');
select public.member_set_warehouses(:'me', '{}'::uuid[]);
select t.ok(public.my_warehouse_access(:'co') is null, 'an empty list means every warehouse');

-- ---------- advance invoices ------------------------------------------------------------------
insert into public.sales_orders (company_id, partner_id, warehouse_id, currency_code) values (:'co', :'pt', :'wh', 'EUR') returning id as so \gset
insert into public.sales_order_lines (company_id, sales_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
values (:'co', :'so', 1, :'mont', 'Montim', 1, 1000, :'vat');
select public.confirm_sales_order(:'so') \gset
select public.advance_invoice_create(jsonb_build_object('order_id', :'so', 'percent', 50)) as adv \gset
select t.ok((select total from public.sales_invoices where id = :'adv') = 590 and (select subtotal from public.sales_invoices where id = :'adv') = 500
        and (select is_advance from public.sales_invoices where id = :'adv'), 'an advance of half the order: 500 + VAT 90');
select public.post_sales_invoice(:'adv') \gset
select t.ok((select sum(l.credit - l.debit) from public.journal_lines l join public.accounts a on a.id = l.account_id where l.company_id = :'co' and a.code = '419') = 500,
  'the advance is owed to the customer until delivery, its VAT is paid now');
select public.create_invoice_from_order(:'so') as fin \gset
select t.ok((select count(*) from public.sales_invoice_lines where invoice_id = :'fin' and advance_invoice_id = :'adv') = 1
        and (select subtotal from public.sales_invoices where id = :'fin') = 500 and (select total from public.sales_invoices where id = :'fin') = 590,
  'the final invoice deducts the advance: 1 000 − 500');
select public.post_sales_invoice(:'fin') \gset
select t.ok((select coalesce(sum(l.credit - l.debit), 0) from public.journal_lines l join public.accounts a on a.id = l.account_id where l.company_id = :'co' and a.code = '419') = 0,
  'the advance account is clear');
select t.ok((select sum(l.credit - l.debit) from public.journal_lines l join public.accounts a on a.id = l.account_id where l.company_id = :'co' and a.code = '704') = 1000
        or (select sum(l.credit - l.debit) from public.journal_lines l join public.accounts a on a.id = l.account_id where l.company_id = :'co' and a.account_type = 'revenue') = 1000,
  'the whole 1 000 is revenue');
select t.ok((public.advance_invoices(:'co', :'so') -> 0 ->> 'left')::numeric = 0, 'nothing left to deduct');
insert into public.sales_invoices (company_id, partner_id, currency_code, invoice_date, due_date) values (:'co', :'pt', 'EUR', current_date, current_date) returning id as dr \gset
select t.throws(format($q$insert into public.sales_invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price) values (%L, %L, 9, 'x', 1, -5)$q$, :'co', :'dr'),
  'check', 'other lines can not be negative');

reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
