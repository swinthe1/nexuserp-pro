-- =============================================================================
-- DrisPRO · packaging units on lines and in print, labels (runs after 01–26)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Paketim Test', 'country', 'XK', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 10,
  'valid_until', (current_date + 365)::text)) as co \gset
select t.login('alice@alba.al');
select id as pcs  from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select id as vat  from public.tax_codes where company_id = :'co' and rate = 18 and deleted_at is null limit 1 \gset
select id as wh   from public.warehouses where company_id = :'co' and code = 'WH' \gset
select id as stock from public.warehouse_locations where company_id = :'co' and code = 'WH/STOCK' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'UJE', 'name', 'Ujë 0.5 l', 'uom_id', :'pcs',
       'sales_price', 0.5, 'sales_tax_code_id', :'vat', 'purchase_tax_code_id', :'vat')) as p_uje \gset
select id as uje from public.product_variants where product_id = :'p_uje' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'LNG', 'name', 'Lëng', 'uom_id', :'pcs',
       'sales_price', 1, 'sales_tax_code_id', :'vat')) as p_lng \gset
select id as lng from public.product_variants where product_id = :'p_lng' \gset
update public.products set volume_m3 = 0.0005 where id = :'p_uje';
insert into public.business_partners (company_id, code, name, is_customer, is_vendor) values (:'co', 'K1', 'Market', true, true) returning id as pt \gset

-- ---------- packs ------------------------------------------------------------------------------
insert into public.product_packs (company_id, product_id, name, factor, barcode, is_default)
values (:'co', :'p_uje', 'Paketë', 6, null, false) returning id as k6 \gset
insert into public.product_packs (company_id, product_id, name, factor, barcode, is_default)
values (:'co', :'p_uje', 'Kuti', 24, '3800000000010', true) returning id as k24 \gset
select t.ok((select quantity from public.product_barcodes where barcode = '3800000000010' and deleted_at is null) = 24,
  'the pack''s barcode scans as 24 pieces');
select t.ok((select units_per_scan from public.find_variant_by_code(:'co', '3800000000010')) = 24, 'and the scanner finds it');
select t.throws(format($q$insert into public.product_packs (company_id, product_id, name, factor, is_default) values (%L, %L, 'Arkë', 12, true)$q$, :'co', :'p_uje'),
  'duplicate key', 'only one main pack per item');
select t.throws(format($q$insert into public.product_packs (company_id, product_id, name, factor) values (%L, %L, 'kuti', 12)$q$, :'co', :'p_uje'),
  'duplicate key', 'pack names are unique per item');
select t.throws(format($q$insert into public.product_packs (company_id, product_id, name, factor, barcode) values (%L, %L, 'Kuti', 24, '3800000000010')$q$, :'co', :'p_lng'),
  'another item', 'a barcode can not belong to two items');
update public.product_packs set barcode = '3800000000027' where id = :'k24';
select t.ok(not exists (select 1 from public.product_barcodes where barcode = '3800000000010' and deleted_at is null)
        and (select quantity from public.product_barcodes where barcode = '3800000000027' and deleted_at is null) = 24, 'changing the pack''s barcode moves it');

insert into public.goods_receipts (company_id, receipt_type, vendor_id, warehouse_id, currency_code) values (:'co', 'purchase', :'pt', :'wh', 'EUR') returning id as gr0 \gset
insert into public.goods_receipt_lines (company_id, receipt_id, variant_id, location_id, quantity, unit_price) values (:'co', :'gr0', :'uje', :'stock', 200, 0.2);
select public.post_goods_receipt(:'gr0') \gset

-- ---------- packs on lines ---------------------------------------------------------------------
insert into public.sales_orders (company_id, partner_id, warehouse_id, currency_code) values (:'co', :'pt', :'wh', 'EUR') returning id as so \gset
insert into public.sales_order_lines (company_id, sales_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id, pack_id, pack_qty)
values (:'co', :'so', 1, :'uje', 'Ujë', 1, 0.5, :'vat', :'k24', 2) returning id as sol \gset
select t.ok((select quantity from public.sales_order_lines where id = :'sol') = 48 and (select line_subtotal from public.sales_order_lines where id = :'sol') = 24,
  '2 boxes of 24 are 48 pieces, priced per piece');
update public.sales_order_lines set pack_qty = 3 where id = :'sol';
select t.ok((select quantity from public.sales_order_lines where id = :'sol') = 72, 'changing the boxes changes the pieces');
update public.sales_order_lines set quantity = 50 where id = :'sol';
select t.ok((select pack_qty from public.sales_order_lines where id = :'sol') = round(50 / 24.0, 4), 'changing the pieces keeps the boxes in step');
select t.throws(format($q$insert into public.sales_order_lines (company_id, sales_order_id, line_no, variant_id, description, quantity, unit_price, pack_id, pack_qty)
  values (%L, %L, 2, %L, 'Lëng', 1, 1, %L, 1)$q$, :'co', :'so', :'lng', :'k24'), 'another item', 'a pack of another item is refused');
select t.ok(public.save_document('sales_orders', jsonb_build_object('id', :'so', 'company_id', :'co', 'partner_id', :'pt', 'warehouse_id', :'wh', 'currency_code', 'EUR'),
  jsonb_build_object('sales_order_lines', jsonb_build_array(
    jsonb_build_object('line_no', 1, 'variant_id', :'uje', 'description', 'Ujë', 'quantity', 1, 'unit_price', 0.5, 'tax_code_id', :'vat', 'pack_id', :'k24', 'pack_qty', 2),
    jsonb_build_object('line_no', 2, 'variant_id', :'uje', 'description', 'Ujë', 'quantity', 1, 'unit_price', 0.5, 'tax_code_id', :'vat', 'pack_id', :'k6', 'pack_qty', 1),
    jsonb_build_object('line_no', 3, 'variant_id', :'uje', 'description', 'Ujë copë', 'quantity', 27, 'unit_price', 0.5, 'tax_code_id', :'vat')))) = :'so'::uuid,
  'saving a draft keeps the packs');
select t.ok((select array_agg(quantity order by line_no) from public.sales_order_lines where sales_order_id = :'so') = array[48, 6, 27]::numeric[], 'and computes the pieces');

-- ---------- in print ---------------------------------------------------------------------------
select public.document_print('sales_order', :'so') as pr \gset
select t.ok((:'pr'::jsonb -> 'lines' -> 0 ->> 'pack') = '2 Kuti × 24', 'the printed order shows the boxes');
select t.ok((:'pr'::jsonb -> 'lines' -> 1 ->> 'pack') = '1 Paketë × 6', 'the pack of the line, not the main one');
select t.ok((:'pr'::jsonb -> 'lines' -> 2 ->> 'pack') = '1 Kuti × 24 + 3', 'loose pieces are shown in the main pack and the rest');
select public.confirm_sales_order(:'so');
select public.create_delivery_from_order(:'so') as dl \gset
select t.ok((public.document_print('delivery', :'dl') -> 'lines' -> 0 ->> 'pack') like '% Kuti × 24%', 'the delivery note too');

-- ---------- labels -----------------------------------------------------------------------------
select public.label_items(:'co', 'items', array[:'uje', :'lng']::uuid[]) as li \gset
select t.ok(jsonb_array_length(:'li'::jsonb -> 'items') = 2 and (:'li'::jsonb -> 'items' -> 0 ->> 'sku') = 'UJE', 'labels in the order chosen');
select t.ok((:'li'::jsonb -> 'items' -> 0 ->> 'price')::numeric = 0.59, 'the price on the label includes VAT');
select t.ok((:'li'::jsonb -> 'items' -> 0 ->> 'volume_l')::numeric = 0.5 and (:'li'::jsonb -> 'items' -> 0 -> 'pack' ->> 'factor')::numeric = 24,
  'with the size for the price per litre and the main pack');
select t.ok((:'li'::jsonb -> 'items' -> 1 ->> 'barcode') is null, 'an item without a barcode');
select t.ok(public.labels_assign_barcodes(:'co', array[:'uje', :'lng']::uuid[]) = 2, 'gets an internal one (both had only pack codes or none)');
select t.ok((public.label_items(:'co', 'items', array[:'lng']::uuid[]) -> 'items' -> 0 ->> 'barcode') ~ '^200[0-9]{10}$', 'a valid internal EAN-13');
select t.ok((public.label_items(:'co', 'items', array[:'uje']::uuid[]) -> 'items' -> 0 ->> 'barcode') like '200%', 'the piece barcode, not the box');

insert into public.goods_receipts (company_id, receipt_type, vendor_id, warehouse_id, currency_code) values (:'co', 'purchase', :'pt', :'wh', 'EUR') returning id as gr \gset
insert into public.goods_receipt_lines (company_id, receipt_id, variant_id, location_id, quantity, unit_price) values (:'co', :'gr', :'lng', :'stock', 12, 0.4);
select t.ok((public.label_items(:'co', 'receipt', array[:'gr']::uuid[]) -> 'items' -> 0 ->> 'qty')::int = 12, 'from a goods receipt: one label per piece');
update public.products set sales_price = 1.2 where id = :'p_lng';
select public.label_items(:'co', 'price_changes', null, current_date) as pc \gset
select t.ok(jsonb_array_length(:'pc'::jsonb -> 'items') = 1 and (:'pc'::jsonb -> 'items' -> 0 ->> 'old_price')::numeric = 1.18
        and (:'pc'::jsonb -> 'items' -> 0 ->> 'price')::numeric = 1.42, 'from today''s price changes, with the old price');
select t.throws(format($q$select public.label_items(%L, 'nothing')$q$, :'co'), 'Unknown source', 'an unknown source is refused');

-- ---------- removing a pack --------------------------------------------------------------------
delete from public.product_packs where id = :'k24';
select t.ok(not exists (select 1 from public.product_barcodes where barcode = '3800000000027' and deleted_at is null), 'removing a pack removes its barcode');
select t.ok((select quantity from public.sales_order_lines where sales_order_id = :'so' and line_no = 1) = 48, 'lines that used it are unchanged');

reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
