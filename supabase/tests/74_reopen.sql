-- =============================================================================
-- DrisPRO · "Rihape për ndryshim": a completed invoice back to a draft (runs after 69 "Agjent Test",
-- 03 "Shitje Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Agjent Test' \gset
select id as shop from public.warehouses where company_id = :'co' and name = 'Dyqani Qendër' \gset
select id as kac from public.product_variants where company_id = :'co' and sku = 'A-KAC' \gset
select id as vat from public.tax_codes where company_id = :'co' and code = 'VAT8' \gset
set role authenticated;

select t.login('drita@agjent.xk');
insert into public.business_partners (company_id, code, name, is_vendor, is_customer) values (:'co', 'RH', 'Furnitori Rihapje', true, false) returning id as ven \gset
select coalesce((select qty_on_hand from t.item_costs where variant_id = :'kac'), 0) as q0, coalesce((select total_value from t.item_costs where variant_id = :'kac'), 0) as v0 \gset

-- ----------------------------------------------------------------------------- a purchase invoice with goods
select public.save_document('vendor_bills', jsonb_build_object('company_id', :'co', 'document_type', 'vendor_bill', 'vendor_id', :'ven', 'vendor_invoice_number', 'RH-1',
   'bill_date', current_date, 'due_date', current_date, 'currency_code', 'EUR', 'warehouse_id', :'shop'),
   jsonb_build_object('vendor_bill_lines', jsonb_build_array(jsonb_build_object('line_no', 1, 'variant_id', :'kac', 'description', 'Kaçkavall', 'quantity', 20, 'unit_price', 2.5, 'tax_code_id', :'vat')))) as bill \gset
select public.purchase_invoice_complete(:'bill');
select receipt_id as rec, journal_entry_id as je from public.vendor_bills where id = :'bill' \gset

select t.login('vesa@agjent.xk');
select t.throws(format($q$select public.reopen_vendor_bill(%L, 'gabim çmimi')$q$, :'bill'), 'Only a finance manager|Permission denied', 'a cashier does not reopen a completed invoice');
select t.login('drita@agjent.xk');
select t.throws(format($q$select public.reopen_vendor_bill(%L, '  ')$q$, :'bill'), 'Write why', 'reopening needs a reason');
select public.reopen_vendor_bill(:'bill', 'Çmimi ishte 2,40') as ro \gset
reset role;
select t.ok((select status = 'draft' and receipt_id is null and journal_entry_id is null and number like 'FB-%' from public.vendor_bills where id = :'bill')
            and (select status from public.goods_receipts where id = :'rec') = 'cancelled'
            and (select status from public.journal_entries where id = :'je') = 'reversed'
            and (:'ro'::jsonb ->> 'href') = '/procurement/invoice/' || :'bill',
            'reopened: a draft with its number, its receipt cancelled, its entry reversed');
select t.ok((select qty_on_hand = :q0 and abs(total_value - :v0) < 0.01 from t.item_costs where variant_id = :'kac'),
            'the goods are out again and the stock value is what it was before the invoice');
select t.ok(exists (select 1 from public.entity_activities where entity_id = :'bill' and metadata ->> 'kind' = 'reopened' and metadata ->> 'reason' = 'Çmimi ishte 2,40'),
            'the history says who reopened it and why');
set role authenticated;
select t.login('drita@agjent.xk');
update public.vendor_bill_lines set unit_price = 2.4 where bill_id = :'bill';
select public.purchase_invoice_complete(:'bill');
reset role;
select t.ok((select status = 'posted' and total = 51.84 from public.vendor_bills where id = :'bill')
            and (select qty_on_hand = :q0 + 20 and abs(total_value - (:v0 + 48)) < 0.01 from t.item_costs where variant_id = :'kac'),
            'completed again: the corrected price is in the stock and the bill');

-- ----------------------------------------------------------------------------- refused when it would do harm
set role authenticated;
select t.login('drita@agjent.xk');
select public.create_vendor_debit(:'bill', 'ND-RH-1');
select t.throws(format($q$select public.reopen_vendor_bill(%L, 'prapë')$q$, :'bill'), 'credit or debit note', 'not with a debit note on it');

-- a sales invoice: reopened when it is a plain one, refused when fiscalized
select id as cust from public.business_partners where company_id = :'co' and is_customer order by created_at limit 1 \gset
insert into public.sales_invoices (company_id, partner_id, invoice_date, due_date, currency_code) values (:'co', :'cust', current_date, current_date, 'EUR') returning id as inv \gset
insert into public.sales_invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price, tax_code_id) values (:'co', :'inv', 1, 'Shërbim', 1, 100, :'vat');
select public.post_sales_invoice(:'inv');
select public.reopen_sales_invoice(:'inv', 'Klienti i gabuar') ->> 'href' as sref \gset
select t.ok((select status = 'draft' and journal_entry_id is null from public.sales_invoices where id = :'inv') and :'sref' = '/sales/invoices/' || :'inv',
            'a sales invoice reopened to a draft');
select t.login('fiona@shop.al');
select t.throws(format($q$select public.reopen_sales_invoice(%L, 'gabim')$q$,
                (select id from public.sales_invoices where company_id = (select id from public.companies where name = 'Shitje Test') and document_type = 'sales_invoice' and status = 'posted' limit 1)),
                'order|fiscalized|finance manager', 'not an invoice of an order, nor a fiscalized one');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
