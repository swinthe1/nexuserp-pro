-- =============================================================================
-- DrisPRO · printed documents and email with the PDF (runs after 01–24)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

insert into auth.users (email, raw_user_meta_data) values ('arka@doc.al', '{"full_name":"Arka Doc"}');
set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Dokumente Test', 'country', 'XK', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 10,
  'valid_until', (current_date + 365)::text)) as co \gset
select t.login('alice@alba.al');
select public.invite_member(:'co', 'arka@doc.al', array['pos_cashier']);
select id as pcs  from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select id as vat  from public.tax_codes where company_id = :'co' and rate = 18 and deleted_at is null limit 1 \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'KAF', 'name', 'Kafe', 'uom_id', :'pcs',
       'sales_price', 10, 'sales_tax_code_id', :'vat', 'purchase_tax_code_id', :'vat')) as p_kaf \gset
select id as kaf from public.product_variants where product_id = :'p_kaf' \gset
insert into public.business_partners (company_id, code, name, is_customer, email, tax_number) values (:'co', 'K1', 'Kafe Prishtina', true, 'zyra@kafe.test', '810000001') returning id as cust \gset
insert into public.partner_addresses (company_id, partner_id, line1, city, is_default) values (:'co', :'cust', 'Rr. Agim Ramadani 5', 'Prishtinë', true);
insert into public.sales_invoices (company_id, partner_id, currency_code) values (:'co', :'cust', 'EUR') returning id as inv \gset
insert into public.sales_invoice_lines (company_id, invoice_id, line_no, variant_id, description, quantity, unit_price, tax_code_id) values (:'co', :'inv', 1, :'kaf', 'Kafe', 3, 10, :'vat');
insert into public.sales_invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price, discount_pct, tax_code_id) values (:'co', :'inv', 2, 'Shërbim', 1, 20, 10, :'vat');
select public.post_sales_invoice(:'inv');

select public.document_print('sales_invoice', :'inv') as d \gset
select t.ok((:'d'::jsonb ->> 'kind') = 'sales_invoice' and jsonb_array_length(:'d'::jsonb -> 'lines') = 2, 'an invoice comes with its lines');
select t.ok((:'d'::jsonb -> 'partner' ->> 'address') = 'Rr. Agim Ramadani 5, Prishtinë' and (:'d'::jsonb -> 'partner' ->> 'tax_number') = '810000001', 'the customer with address and NUI');
select t.ok((:'d'::jsonb -> 'vat' -> 0 ->> 'base')::numeric = 48 and (:'d'::jsonb ->> 'total')::numeric = 56.64, 'the VAT summary and the total');
select t.ok((:'d'::jsonb -> 'company' ->> 'name') = 'Dokumente Test', 'and the company block');

select public.print_settings_save(:'co', '{"accent":"#0f766e","show_codes":false,"texts":{"sales_invoice":"Faleminderit!"}}', 'data:image/png;base64,iVBORw0KGgo=');
select t.ok((public.document_print('sales_invoice', :'inv') -> 'company' -> 'settings' ->> 'accent') = '#0f766e'
         and (public.document_print('sales_invoice', :'inv') -> 'company' ->> 'logo') like 'data:image/png%', 'the look and the logo of the company');
select t.throws(format($q$select public.print_settings_save(%L, '{}', 'not a picture')$q$, :'co'), 'smaller than 500 KB', 'only a picture is a logo');

-- a quote as a pro forma, an order, a payment voucher
insert into public.sales_quotes (company_id, partner_id, currency_code) values (:'co', :'cust', 'EUR') returning id as q \gset
insert into public.sales_quote_lines (company_id, quote_id, line_no, variant_id, description, quantity, unit_price, tax_code_id) values (:'co', :'q', 1, :'kaf', 'Kafe', 2, 10, :'vat');
select t.ok((public.document_print('proforma_quote', :'q') ->> 'kind') = 'proforma', 'a quote prints as a pro forma');
insert into public.payments (company_id, document_type, partner_id, method, amount, currency_code, bank_account_id)
values (:'co', 'customer_payment', :'cust', 'cash', 20, 'EUR', (select id from public.bank_accounts where company_id = :'co' and account_kind = 'cash' limit 1)) returning id as pay \gset
insert into public.payment_allocations (company_id, payment_id, sales_invoice_id, amount) values (:'co', :'pay', :'inv', 20);
select public.post_payment(:'pay');
select t.ok((public.document_print('payment', :'pay') ->> 'kind') = 'receipt_voucher'
         and (public.document_print('payment', :'pay') -> 'allocations' -> 0 ->> 'amount')::numeric = 20, 'a receipt voucher with what it paid');

-- email: needs the company mailbox
select t.throws(format($q$select public.document_email('sales_invoice', %L, 'zyra@kafe.test', 'Fatura', 'Përshëndetje', 'JVBERi0=', 'f.pdf')$q$, :'inv'),
  'mailbox', 'no email without the company mailbox');
reset role;
insert into app.mail_accounts (company_id, host, port, security, username, password, from_email, is_active) values (:'co', 'smtp.test', 587, 'starttls', 'u', 'p', 'zyra@doc.test', true);
set role authenticated;
select t.login('alice@alba.al');
select t.throws(format($q$select public.document_email('sales_invoice', %L, 'jo-email', 'Fatura', '', 'JVBERi0=', 'f.pdf')$q$, :'inv'), 'valid email', 'a valid address');
select public.document_email('sales_invoice', :'inv', 'zyra@kafe.test', 'Fatura', 'Përshëndetje', 'JVBERi0=', 'Fatura.pdf') as m \gset
reset role;
select t.ok((select attachments -> 0 ->> 'name' = 'Fatura.pdf' and attachments -> 0 ->> 'data' = 'JVBERi0=' and status = 'queued' from app.message_outbox where id = :'m'),
  'the PDF waits in the outbox as an attachment');
set role authenticated;

-- a cashier cannot print the office's invoices
select t.login('arka@doc.al');
select t.throws(format($q$select public.document_print('sales_invoice', %L)$q$, :'inv'), 'invoicing.read', 'documents follow the rights to see them');

reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
