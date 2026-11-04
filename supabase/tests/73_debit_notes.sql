-- =============================================================================
-- DrisPRO · debit notes (runs after 03 "Shitje Test" and 04 procurement)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Shitje Test' \gset
select id as inv, partner_id as cust from public.sales_invoices where company_id = :'co' and document_type = 'sales_invoice' and status = 'posted' order by created_at limit 1 \gset
select id as vat from public.tax_codes where company_id = :'co' and code = 'VAT20' \gset
set role authenticated;

select t.login('fiona@shop.al');
select public.create_debit_note(:'inv') as dn \gset
select t.ok((select number like 'ND-2026-%' and is_debit_note and status = 'draft' and original_invoice_id = :'inv' and partner_id = :'cust' from public.sales_invoices where id = :'dn'),
            'a debit note: its own series, a draft for the same customer, naming the invoice it adds to');
insert into public.sales_invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price, tax_code_id)
values (:'co', :'dn', 1, 'Diferencë çmimi', 1, 1000, :'vat');
select public.post_sales_invoice(:'dn');
select t.ok((select status = 'posted' and total = 1200 and amount_due = 1200 from public.sales_invoices where id = :'dn'), 'posted like an invoice: 1 000 + VAT, owed on its own');
select public.partner_card(:'cust', 'customer', current_date - 30, current_date) as card \gset
select t.ok(exists (select 1 from jsonb_array_elements(:'card'::jsonb -> 'rows') r where r ->> 'source_type' = 'debit_note' and (r ->> 'debit')::numeric = 1200),
            'the customer''s card shows it as a debit note, on the debit side');
select t.ok(exists (select 1 from jsonb_array_elements(public.open_items_statement(:'cust', 'customer', current_date) -> 'rows') r where r ->> 'kind' = 'debit_note'),
            'and among the open items');
select t.ok((public.document_print('sales_invoice', :'dn') ->> 'kind') = 'debit_note' and (public.document_print('sales_invoice', :'dn') ->> 'original') is not null,
            'printed as a debit note that names the invoice');
-- the kinds of card
select public.partner_invoices_card(:'cust', 'customer', current_date - 365, current_date) as ic \gset
select t.ok(exists (select 1 from jsonb_array_elements(:'ic'::jsonb -> 'rows') r where r ->> 'id' = :'inv'
                      and exists (select 1 from jsonb_array_elements(r -> 'notes') n where n ->> 'kind' = 'debit_note'))
            and exists (select 1 from jsonb_array_elements(:'ic'::jsonb -> 'rows') r where r ->> 'kind' = 'debit_note' and (r ->> 'open')::numeric = 1200),
            'by invoice: the invoice lists the debit note on it, and the debit note is open on its own');
select t.ok(jsonb_array_length(public.partner_items_card(:'cust', 'customer', current_date - 365, current_date) -> 'rows') >= 1, 'by item: what the customer bought');
select t.ok(exists (select 1 from jsonb_array_elements(public.partner_balances(:'co', 'customer') -> 'rows') r where r ->> 'id' = :'cust' and (r ->> 'balance')::numeric > 0),
            'balances of all: the customer with what they owe');
select t.throws(format($q$update public.sales_invoices set is_debit_note = false where id = %L$q$, :'dn'), 'cannot be changed|stays a debit note', 'a debit note stays one');
select t.throws(format($q$select public.create_debit_note(%L)$q$, (select id from public.sales_invoices where company_id = :'co' and document_type = 'credit_note' limit 1)), 'posted invoices', 'not for a credit note');
reset role;

-- from the supplier
select id as vco from public.companies where name = 'Blerje Test' \gset
select id as bill from public.vendor_bills where company_id = :'vco' and document_type = 'vendor_bill' and status = 'posted' order by created_at limit 1 \gset
set role authenticated;
select t.login('finn@buy.al');
select t.throws(format($q$select public.create_vendor_debit(%L, '  ')$q$, :'bill'), 'number of the supplier', 'the supplier''s debit note needs its number');
select public.create_vendor_debit(:'bill', 'ND-7/2026') as vd \gset
select t.ok((select number like 'NDF-%' and is_debit_note and vendor_invoice_number = 'ND-7/2026' and original_bill_id = :'bill' and purchase_order_id is null from public.vendor_bills where id = :'vd'),
            'a supplier''s debit note: its own series, the supplier''s number, naming the bill');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
