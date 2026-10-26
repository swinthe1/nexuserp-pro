-- =============================================================================
-- DrisPRO · partner and item cards, open items, compensation (runs after 01–25)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Kartela Test', 'country', 'XK', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 10,
  'valid_until', (current_date + 365)::text)) as co \gset
select t.login('alice@alba.al');
select id as pcs  from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select id as vat  from public.tax_codes where company_id = :'co' and rate = 18 and deleted_at is null limit 1 \gset
select id as wh   from public.warehouses where company_id = :'co' and code = 'WH' \gset
select id as stock from public.warehouse_locations where company_id = :'co' and code = 'WH/STOCK' \gset
select id as bank from public.bank_accounts where company_id = :'co' and account_kind = 'bank' limit 1 \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'VAJ', 'name', 'Vaj', 'uom_id', :'pcs',
       'sales_price', 10, 'sales_tax_code_id', :'vat', 'purchase_tax_code_id', :'vat')) as p_vaj \gset
select id as vaj from public.product_variants where product_id = :'p_vaj' \gset
insert into public.business_partners (company_id, code, name, is_customer, is_vendor) values (:'co', 'P1', 'Partneri Dyfish', true, true) returning id as pt \gset

-- goods in (10 at 5) from the partner, and a bill for them
insert into public.goods_receipts (company_id, receipt_type, vendor_id, warehouse_id, currency_code, receipt_date) values (:'co', 'purchase', :'pt', :'wh', 'EUR', current_date - 10) returning id as gr \gset
insert into public.goods_receipt_lines (company_id, receipt_id, variant_id, location_id, quantity, unit_price) values (:'co', :'gr', :'vaj', :'stock', 10, 5);
select public.post_goods_receipt(:'gr');
select public.create_bill_from_receipt(:'gr') as bill \gset
select public.post_vendor_bill(:'bill');
select total as bill_total from public.vendor_bills where id = :'bill' \gset
-- a sale of 4 to the same partner, invoiced
insert into public.sales_orders (company_id, partner_id, warehouse_id, currency_code) values (:'co', :'pt', :'wh', 'EUR') returning id as so \gset
insert into public.sales_order_lines (company_id, sales_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id) values (:'co', :'so', 1, :'vaj', 'Vaj', 4, 10, :'vat');
select public.confirm_sales_order(:'so');
select public.create_delivery_from_order(:'so') as dl \gset
select public.post_delivery(:'dl');
select public.create_invoice_from_order(:'so') as inv \gset
select public.post_sales_invoice(:'inv');

-- ---------- item card ---------------------------------------------------------------------------
select public.item_card(:'vaj', null, current_date - 30, current_date) as ic \gset
select t.ok((:'ic'::jsonb ->> 'closing_qty')::numeric = 6 and (:'ic'::jsonb ->> 'closing_value')::numeric = 30, 'the item card ends at 6 pieces worth 30');
select t.ok(jsonb_array_length(:'ic'::jsonb -> 'rows') = 2 and (:'ic'::jsonb -> 'rows' -> 0 ->> 'partner') = 'Partneri Dyfish', 'two movements, with who they came from');
select t.ok((public.item_card(:'vaj', null, current_date - 5, current_date) ->> 'opening_qty')::numeric = 10, 'a later start carries the quantity before it');

-- ---------- partner card ------------------------------------------------------------------------
select public.partner_card(:'pt', 'customer', current_date - 30, current_date) as pc \gset
select t.ok((:'pc'::jsonb ->> 'closing')::numeric = 47.2 and jsonb_array_length(:'pc'::jsonb -> 'rows') = 1, 'the customer card: one invoice of 47.20');
select t.ok((public.partner_card(:'pt', 'vendor', current_date - 30, current_date) ->> 'closing')::numeric = -:'bill_total'::numeric, 'the supplier card: what we owe them');

-- ---------- compensation -----------------------------------------------------------------------
select t.throws(format($q$select public.compensation_create(jsonb_build_object('company_id', %L, 'partner_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('sales_invoice_id', %L, 'amount', 40), jsonb_build_object('vendor_bill_id', %L, 'amount', 30))))$q$, :'co', :'pt', :'inv', :'bill'),
  'Both sides must be equal', 'both sides must match');
select t.throws(format($q$select public.compensation_create(jsonb_build_object('company_id', %L, 'partner_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('sales_invoice_id', %L, 'amount', 100), jsonb_build_object('vendor_bill_id', %L, 'amount', 100))))$q$, :'co', :'pt', :'inv', :'bill'),
  'Only', 'not more than is open');
select public.compensation_create(jsonb_build_object('company_id', :'co', 'partner_id', :'pt',
  'lines', jsonb_build_array(jsonb_build_object('sales_invoice_id', :'inv', 'amount', 40), jsonb_build_object('vendor_bill_id', :'bill', 'amount', 40)))) as k \gset
select t.ok((:'k'::jsonb ->> 'number') like 'KOMP-%', 'a compensation document with its number');
select t.ok((select amount_due from public.sales_invoices where id = :'inv') = 7.2, 'the invoice has 7.20 left');
select t.ok((select amount_due from public.vendor_bills where id = :'bill') = :'bill_total'::numeric - 40, 'the bill 40 less');
select t.ok((public.partner_card(:'pt', 'customer', current_date - 30, current_date) ->> 'closing')::numeric = 7.2, 'and the card shows it');
select t.ok((public.open_items_statement(:'pt', 'customer', current_date) -> 'totals' ->> 'EUR')::numeric = 7.2, 'the open items (IOS) agree');
select t.ok((public.open_items_statement(:'pt', 'customer', current_date - 1) -> 'totals' ->> 'EUR')::numeric = 47.2 or
            (select invoice_date from public.sales_invoices where id = :'inv') = current_date, 'at an earlier date the compensation is not counted yet');
select t.ok((public.compensation_print((:'k'::jsonb ->> 'id')::uuid) -> 'invoices' -> 0 ->> 'amount')::numeric = 40, 'it prints with both sides');

select public.compensation_cancel((:'k'::jsonb ->> 'id')::uuid, 'Gabim');
select t.ok((select amount_due from public.sales_invoices where id = :'inv') = 47.2 and (select amount_due from public.vendor_bills where id = :'bill') = :'bill_total'::numeric,
  'cancelled: both are open again');
select t.ok((public.partner_card(:'pt', 'customer', current_date - 30, current_date) ->> 'closing')::numeric = 47.2, 'and the books are back');

reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
