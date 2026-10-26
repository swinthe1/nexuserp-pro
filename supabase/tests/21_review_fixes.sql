-- =============================================================================
-- DrisPRO · the fixes from the review before going live (runs after 01–20)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

insert into auth.users (email, raw_user_meta_data) values
  ('rina@rev.al', '{"full_name":"Rina Accountant"}'),
  ('kasa@rev.al', '{"full_name":"Kasa Rev"}');

set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Rishikim Test', 'country', 'AL', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 10,
  'valid_until', (current_date + 365)::text)) as co \gset
select public.platform_create_client(jsonb_build_object('name', 'Pagat Kosova', 'country', 'XK', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 10,
  'valid_until', (current_date + 365)::text)) as xk \gset
select t.login('alice@alba.al');
select public.invite_member(:'co', 'rina@rev.al', array['accountant']);
select public.invite_member(:'co', 'kasa@rev.al', array['pos_cashier']);
create or replace function pg_temp.bal(p_co uuid, p_code text) returns numeric language sql as $$
  select coalesce(sum(jl.debit - jl.credit), 0) from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
   where jl.company_id = p_co and jl.account_id = (select id from public.accounts where company_id = p_co and code = p_code)
     and e.status in ('posted','reversed') $$;
select id as pcs   from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select id as vat20 from public.tax_codes where company_id = :'co' and code = 'VAT20' \gset
select id as wh    from public.warehouses where company_id = :'co' and code = 'WH' \gset
select id as stock from public.warehouse_locations where company_id = :'co' and code = 'WH/STOCK' \gset
select id as bank  from public.bank_accounts where company_id = :'co' and account_kind = 'bank' \gset
insert into public.exchange_rates (company_id, currency_code, rate_date, rate) values (:'co', 'EUR', current_date - 30, 100);
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'TEA', 'name', 'Çaj', 'uom_id', :'pcs',
       'sales_price', 1000, 'sales_tax_code_id', :'vat20', 'purchase_tax_code_id', :'vat20')) as p_tea \gset
select id as tea from public.product_variants where product_id = :'p_tea' \gset
insert into public.business_partners (company_id, code, name, is_customer, is_vendor) values (:'co', 'C1', 'Market Era', true, true) returning id as cust \gset

-- stock to sell
insert into public.goods_receipts (company_id, receipt_type, vendor_id, warehouse_id, currency_code) values (:'co', 'purchase', :'cust', :'wh', 'ALL') returning id as gr \gset
insert into public.goods_receipt_lines (company_id, receipt_id, variant_id, location_id, quantity, unit_price) values (:'co', :'gr', :'tea', :'stock', 50, 400);
select public.post_goods_receipt(:'gr');

-- ---------- a posted invoice cannot be edited or deleted ----------------------------------------
insert into public.sales_invoices (company_id, partner_id, currency_code) values (:'co', :'cust', 'ALL') returning id as inv \gset
insert into public.sales_invoice_lines (company_id, invoice_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
values (:'co', :'inv', 1, :'tea', 'Çaj', 2, 1000, :'vat20');
select public.post_sales_invoice(:'inv');
select t.throws(format($q$update public.sales_invoices set amount_paid = total where id = %L$q$, :'inv'), 'cannot be changed', 'a posted invoice cannot be marked paid by editing it');
select t.throws(format($q$update public.sales_invoices set partner_id = partner_id, total = 1 where id = %L$q$, :'inv'), 'cannot be changed', 'nor its total');
select t.throws(format($q$delete from public.sales_invoices where id = %L$q$, :'inv'), 'cannot be deleted', 'nor deleted');
update public.sales_invoices set notes = 'Dorëzuar në zyrë' where id = :'inv';
select t.ok((select notes from public.sales_invoices where id = :'inv') = 'Dorëzuar në zyrë', 'notes can still be written');

-- ---------- a credit note settles the invoice it corrects ---------------------------------------
select public.create_credit_note(:'inv') as cn \gset
select public.post_sales_invoice(:'cn');
select t.ok((select payment_status = 'paid' and amount_due = 0 from public.sales_invoices where id = :'inv'), 'a fully credited invoice is settled, not unpaid forever');
select t.ok((select payment_status = 'paid' from public.sales_invoices where id = :'cn'), 'and the credit note is used up');

-- ---------- a price-correction credit note does not reopen the order for billing ----------------
insert into public.sales_orders (company_id, partner_id, warehouse_id, currency_code) values (:'co', :'cust', :'wh', 'ALL') returning id as so \gset
insert into public.sales_order_lines (company_id, sales_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
values (:'co', :'so', 1, :'tea', 'Çaj', 5, 1000, :'vat20');
select public.confirm_sales_order(:'so');
select public.create_delivery_from_order(:'so') as dl \gset
select public.post_delivery(:'dl');
select public.create_invoice_from_order(:'so') as inv2 \gset
select public.post_sales_invoice(:'inv2');
select public.create_credit_note(:'inv2') as cn2 \gset
update public.sales_invoice_lines set unit_price = 100 where invoice_id = :'cn2';
select public.post_sales_invoice(:'cn2');
select t.ok((select qty_invoiced from public.sales_order_lines where sales_order_id = :'so') = 5, 'a price correction leaves the invoiced quantity as it is');
select t.throws(format($q$select public.create_invoice_from_order(%L)$q$, :'so'), 'Nothing to invoice', 'so the same goods cannot be invoiced twice');

-- ---------- exchange rates ----------------------------------------------------------------------
insert into public.sales_invoices (company_id, partner_id, currency_code) values (:'co', :'cust', 'EUR') returning id as einv \gset
select t.ok((select exchange_rate from public.sales_invoices where id = :'einv') = 100, 'an invoice in euro takes the rate of its date');
insert into public.sales_invoices (company_id, partner_id, currency_code) values (:'co', :'cust', 'USD') returning id as uinv \gset
insert into public.sales_invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price, tax_code_id)
values (:'co', :'uinv', 1, 'Shërbim', 1, 100, :'vat20');
select t.throws(format($q$select public.post_sales_invoice(%L)$q$, :'uinv'), 'No exchange rate for USD', 'without a rate it is not posted at 1.0');
select t.throws(format($q$select * from public.get_price(%L, %L, %L, 1, current_date, null, 'USD')$q$, :'co', :'cust', :'tea'), 'No exchange rate', 'prices in a currency without a rate are an error');

-- ---------- books that only their actions change ------------------------------------------------
select t.throws(format($q$update public.fiscal_periods set status = 'closed' where company_id = %L$q$, :'co'), 'Finance setup', 'accounting months are not opened by editing them');
select t.throws(format($q$update public.journal_entries set status = 'reversed' where id = (select journal_entry_id from public.sales_invoices where id = %L)$q$, :'inv'),
  'set by its own action', 'an entry is not marked reversed without its reversing entry');
insert into public.purchase_orders (company_id, vendor_id, warehouse_id) values (:'co', :'cust', :'wh') returning id as po \gset
insert into public.purchase_order_lines (company_id, purchase_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id, qty_received)
values (:'co', :'po', 1, :'tea', 'Çaj', 10, 400, :'vat20', 100);
select t.ok((select qty_received from public.purchase_order_lines where purchase_order_id = :'po') = 0, 'nobody types what was received');
select t.throws(format($q$update public.purchase_order_lines set qty_billed = 10 where purchase_order_id = %L$q$, :'po'), 'counted by receipts', 'nor what was billed');

-- ---------- customer returns come back at the average cost --------------------------------------
insert into public.goods_receipts (company_id, receipt_type, warehouse_id, currency_code) values (:'co', 'customer_return', :'wh', 'ALL') returning id as ret \gset
insert into public.goods_receipt_lines (company_id, receipt_id, variant_id, location_id, quantity, unit_price) values (:'co', :'ret', :'tea', :'stock', 1, 1200);
select public.post_goods_receipt(:'ret');
select t.ok((select unit_cost from public.goods_receipt_lines where receipt_id = :'ret') = 400, 'a returned item comes back at its average cost, not the typed price');

-- ---------- the till ----------------------------------------------------------------------------
insert into public.bank_accounts (company_id, name, account_kind, currency_code, account_id)
select :'co', 'Arka 1', 'cash', 'ALL', id from public.accounts where company_id = :'co' and code = '5311' returning id as drawer \gset
insert into public.pos_registers (company_id, code, name, warehouse_id, location_id, cash_account_id, journal_id)
select :'co', 'A1', 'Arka 1', :'wh', :'stock', :'drawer', id from public.journals where company_id = :'co' and code = 'POS' returning id as reg \gset
select t.login('kasa@rev.al');
select public.open_pos_session(:'reg', 0) as ses \gset
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'tea', 'quantity', 2, 'unit_price', 1200, 'discount_pct', 0)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 2400)))) as sale \gset
select t.throws(format($q$select public.pos_submit_order('{"client_uuid":"%s","session_id":"%s","lines":[{"variant_id":"%s","quantity":1,"unit_price":10,"discount_pct":0}],"payments":[{"method":"cash","amount":10}]}')$q$,
  gen_random_uuid(), :'ses', :'tea'), 'far under the till price', 'a cashier cannot sell at a made-up low price');
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses', 'is_refund', true, 'refund_of_id', :'sale'::jsonb ->> 'id',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'tea', 'quantity', -1, 'unit_price', 50000)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', -1200)))) as ref \gset
select t.ok((:'ref'::jsonb ->> 'total')::numeric = -1200, 'a refund gives back what was paid, whatever price the till sends');
select t.throws(format($q$select public.pos_submit_order('{"client_uuid":"%s","session_id":"%s","is_refund":true,"refund_of_id":"%s","lines":[{"variant_id":"%s","quantity":-5,"unit_price":1200}],"payments":[{"method":"cash","amount":-6000}]}')$q$,
  gen_random_uuid(), :'ses', :'sale'::jsonb ->> 'id', :'tea'), 'more than what is left', 'not more than was sold');


-- ---------- a bill for a receipt without an order, and goods back to the vendor ------------------
select t.login('alice@alba.al');
create or replace function pg_temp.grni(p_co uuid) returns numeric language sql as $$
  select coalesce(sum(jl.debit - jl.credit), 0) from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
   where jl.company_id = p_co and e.status = 'posted'
     and jl.account_id = (select account_id from public.company_account_defaults where company_id = p_co and key = 'grni') $$;
select pg_temp.grni(:'co') as grni0 \gset
select public.create_bill_from_receipt(:'gr') as rbill \gset
select t.ok((select count(*) = 1 and bool_and(receipt_line_id is not null) from public.vendor_bill_lines where bill_id = :'rbill'), 'a bill made from the receipt points at its lines');
select t.throws(format($q$select public.create_bill_from_receipt(%L)$q$, :'gr'), 'already has a bill', 'one bill per receipt');
select public.post_vendor_bill(:'rbill');
select t.ok(pg_temp.grni(:'co') = :'grni0'::numeric + 20000, 'the bill clears what the receipt put in goods received not invoiced');
select (select on_hand from public.stock_levels where variant_id = :'tea' and location_id = :'stock') as before_ret \gset
select public.return_to_vendor(:'gr', jsonb_build_array(jsonb_build_object('receipt_line_id', (select id from public.goods_receipt_lines where receipt_id = :'gr'), 'quantity', 5)), 'Paketim i dëmtuar') as vret \gset
select t.ok((select on_hand from public.stock_levels where variant_id = :'tea' and location_id = :'stock') = :'before_ret'::numeric - 5, 'the goods leave the stock');
select t.ok(pg_temp.grni(:'co') = :'grni0'::numeric + 20000 + 2000, 'at the cost they came in at, waiting for the vendor''s credit');
select t.throws(format($q$select public.return_to_vendor(%L, '[{"receipt_line_id":"%s","quantity":46}]', 'x')$q$, :'gr', (select id from public.goods_receipt_lines where receipt_id = :'gr')),
  'can still go back', 'not more than came in');
select public.vendor_credit_from_return(:'vret') as vcr \gset
select t.ok((select original_bill_id = :'rbill'::uuid from public.vendor_bills where id = :'vcr')
            and (select bool_and(is_return) and sum(quantity) = 5 from public.vendor_bill_lines where bill_id = :'vcr'), 'the credit for those goods is prepared against their bill');
select public.post_vendor_bill(:'vcr');
select t.ok(pg_temp.grni(:'co') = :'grni0'::numeric + 20000, 'posting the credit clears what the return left');
select t.ok((select amount_due from public.vendor_bills where id = :'rbill') = 24000 - 2400, 'and the bill owes that much less');

-- ---------- payroll: a raise in the middle of the month --------------------------------------
select t.login('alice@alba.al');
insert into public.employees (company_id, first_name, last_name, hire_date) values (:'xk', 'Drita', 'Raise', '2024-01-01') returning id as drita \gset
insert into public.employment_contracts (company_id, employee_id, start_date, end_date, status, gross_salary, currency_code, is_primary_employer) values
  (:'xk', :'drita', '2024-01-01', '2026-09-15', 'ended', 1000, 'EUR', true),
  (:'xk', :'drita', '2026-09-16', null, 'active', 1200, 'EUR', true);
select public.create_payroll_run(:'xk', 2026, 9) as xrun \gset
select public.calculate_payroll(:'xrun');
select t.ok((select count(*) from public.payslips where payroll_run_id = :'xrun' and employee_id = :'drita') = 1, 'a contract change in the month: one payslip');
select t.ok((select gross_salary between 1000 and 1200 from public.payslips where payroll_run_id = :'xrun' and employee_id = :'drita'),
  'each contract pays its own days (between the old and the new salary)');

reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
