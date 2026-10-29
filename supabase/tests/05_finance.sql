-- =============================================================================
-- DrisPRO · Phase 5 finance tests (runs after 01–04; reuses t.ok / t.throws / t.login)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

insert into auth.users (email, raw_user_meta_data) values
  ('fina@fin.al', '{"full_name":"Fina Finance Manager"}'),
  ('acco@fin.al', '{"full_name":"Acco Accountant"}'),
  ('rexa@fin.al', '{"full_name":"Rexa Sales Rep"}');

set role authenticated;
select t.login('alice@alba.al');
select public.create_company('Financa Test', 'AL') as co \gset
select public.invite_member(:'co', 'fina@fin.al', array['finance_manager']);
select public.invite_member(:'co', 'acco@fin.al', array['accountant']);
select public.invite_member(:'co', 'rexa@fin.al', array['sales_rep']);

-- ---------- chart of accounts & posting setup ------------------------------------
select t.ok((select count(*) from public.accounts where company_id = :'co' and is_postable) >= 50, 'a chart of accounts is created with the company');
select t.ok((select count(*) from public.company_account_defaults where company_id = :'co') >= 40, 'every posting role has an account');
select t.ok((select count(*) from public.journals where company_id = :'co') = 10, 'standard journals created');
select t.ok((select count(*) from public.bank_accounts where company_id = :'co') = 2, 'main bank account and cash box created');
select id as bank from public.bank_accounts where company_id = :'co' and account_kind = 'bank' \gset
select id as cashbox from public.bank_accounts where company_id = :'co' and account_kind = 'cash' \gset
create or replace function pg_temp.acc(p_co uuid, p_code text) returns uuid language sql as $$ select id from public.accounts where company_id = p_co and code = p_code $$;
create or replace function pg_temp.bal(p_co uuid, p_code text) returns numeric language sql as $$
  select coalesce(sum(jl.debit - jl.credit), 0) from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
   where jl.company_id = p_co and jl.account_id = (select id from public.accounts where company_id = p_co and code = p_code)
     and e.status in ('posted','reversed') $$;

select id as pcs   from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select id as vat20 from public.tax_codes where company_id = :'co' and code = 'VAT20' \gset
select id as wh    from public.warehouses where company_id = :'co' and code = 'WH' \gset
select id as stock from public.warehouse_locations where company_id = :'co' and code = 'WH/STOCK' \gset
select id as net30 from public.payment_terms where company_id = :'co' and code = 'NET30' \gset
insert into public.exchange_rates (company_id, currency_code, rate_date, rate) values (:'co', 'EUR', current_date - 60, 100);
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'OIL', 'name', 'Olive oil 1 L', 'uom_id', :'pcs',
       'sales_price', 1500, 'sales_tax_code_id', :'vat20', 'purchase_tax_code_id', :'vat20')) as p_oil \gset
select id as oil from public.product_variants where product_id = :'p_oil' \gset
insert into public.business_partners (company_id, code, name, is_customer, payment_term_id) values (:'co', 'C1', 'Restorant Era', true, :'net30') returning id as cust \gset
insert into public.business_partners (company_id, code, name, is_customer, currency_code) values (:'co', 'C2', 'Gastro GmbH', true, 'EUR') returning id as cust_eur \gset
insert into public.business_partners (company_id, code, name, is_vendor, payment_term_id) values (:'co', 'V1', 'Vaj Ulliri Berat', true, :'net30') returning id as vend \gset

-- ---------- purchases: receipt → GRNI, bill clears GRNI, price difference -----------
insert into public.purchase_orders (company_id, vendor_id, warehouse_id) values (:'co', :'vend', :'wh') returning id as po \gset
insert into public.purchase_order_lines (company_id, purchase_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
values (:'co', :'po', 1, :'oil', 'Olive oil', 100, 600, :'vat20');
select public.submit_purchase_order(:'po');
select public.create_receipt_from_po(:'po') as gr \gset
update public.goods_receipt_lines set location_id = :'stock' where receipt_id = :'gr';   -- straight to a pickable bin
select public.post_goods_receipt(:'gr');
select t.ok((select (source_doc_type, source_doc_id, total_debit, is_automatic) = ('goods_receipt', :'gr'::uuid, 60000.00, true)
               from public.journal_entries where id = (select journal_entry_id from public.goods_receipts where id = :'gr')),
            'receipt posts Dr inventory / Cr GRNI and links back');
select t.ok(pg_temp.bal(:'co', '311') = 60000 and pg_temp.bal(:'co', '4081') = -60000, 'inventory up, goods-received-not-invoiced open');
select t.ok((select count(*) from public.stock_movements where source_doc_id = :'gr' and journal_entry_id is null) = 0, 'stock movements point at their entry');

select public.create_bill_from_po(:'po', 'F-01') as bill \gset
update public.vendor_bill_lines set unit_price = 610 where bill_id = :'bill';   -- 1.7% over: within tolerance
select public.post_vendor_bill(:'bill');
select t.ok(pg_temp.bal(:'co', '4081') = 0, 'bill clears GRNI at receipt value');
select t.ok(pg_temp.bal(:'co', '311') = 61000, 'price difference on stock still on hand goes to inventory');
select t.ok(pg_temp.bal(:'co', '4456') = 12200 and pg_temp.bal(:'co', '401') = -73200, 'VAT input 20% and payable to the vendor');
select t.ok((select partner_id from public.journal_lines where entry_id = (select journal_entry_id from public.vendor_bills where id = :'bill')
               and account_id = pg_temp.acc(:'co', '401')) = :'vend'::uuid, 'payable line carries the vendor');

-- ---------- sales: invoice → AR / revenue / VAT, delivery → COGS ----------------------
insert into public.sales_orders (company_id, partner_id, warehouse_id, currency_code, payment_term_id) values (:'co', :'cust', :'wh', 'ALL', :'net30') returning id as so \gset
insert into public.sales_order_lines (company_id, sales_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
values (:'co', :'so', 1, :'oil', 'Olive oil', 40, 1500, :'vat20');
select public.confirm_sales_order(:'so');
select public.create_delivery_from_order(:'so') as dl \gset
select public.post_delivery(:'dl');
select t.ok(pg_temp.bal(:'co', '601') = 24400 and pg_temp.bal(:'co', '311') = 36600, 'delivery: Dr COGS / Cr inventory at average cost (40 × 610)');
select public.create_invoice_from_order(:'so') as inv \gset
select public.post_sales_invoice(:'inv');
select t.ok((select (total_debit, source_doc_type) = (72000.00, 'sales_invoice') from public.journal_entries
               where id = (select journal_entry_id from public.sales_invoices where id = :'inv')), 'invoice entry 72,000 with source link');
select t.ok(pg_temp.bal(:'co', '411') = 72000 and pg_temp.bal(:'co', '701') = -60000 and pg_temp.bal(:'co', '4457') = -12000,
            'Dr receivable / Cr revenue / Cr VAT output');

-- EUR invoice to post a foreign-currency receivable
insert into public.sales_invoices (company_id, partner_id, currency_code, exchange_rate) values (:'co', :'cust_eur', 'EUR', 100) returning id as inv_eur \gset
insert into public.sales_invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price, tax_code_id)
values (:'co', :'inv_eur', 1, 'Consulting', 1, 1000, :'vat20');
select public.post_sales_invoice(:'inv_eur');
select t.ok((select (currency_code, amount_currency, debit) = ('EUR', 1200.00, 120000.00) from public.journal_lines
               where entry_id = (select journal_entry_id from public.sales_invoices where id = :'inv_eur') and account_id = pg_temp.acc(:'co', '411')),
            'foreign invoice keeps the EUR amount next to the base amount');

-- credit note reverses revenue and VAT
select public.create_credit_note(:'inv') as cn \gset
update public.sales_invoice_lines set quantity = 4 where invoice_id = :'cn';
select public.post_sales_invoice(:'cn');
select t.ok(pg_temp.bal(:'co', '701') = -60000 - 100000 + 6000 and pg_temp.bal(:'co', '4457') = -12000 - 20000 + 1200, 'credit note reduces revenue and VAT');

-- ---------- payments, allocations, FX difference -------------------------------------
select t.login('acco@fin.al');
insert into public.payments (company_id, document_type, partner_id, method, amount, bank_account_id, payment_date, reference)
values (:'co', 'customer_payment', :'cust', 'bank_transfer', 50000, :'bank', current_date, 'ERA-INV') returning id as rcp, number as rcp_no \gset
insert into public.payment_allocations (company_id, payment_id, sales_invoice_id, amount) values (:'co', :'rcp', :'inv', 50000);
select t.ok(:'rcp_no' like 'ARK-2026-%', 'customer receipts are numbered');
select t.throws(format($q$update public.payments set status = 'posted' where id = %L$q$, :'rcp'), 'set by its own action', 'payments post only through posting');
select public.post_payment(:'rcp');
select t.ok((select (payment_status, amount_paid) = ('partially_paid', 57200.00) from public.sales_invoices where id = :'inv'), 'invoice partially paid (50,000 paid + 7,200 credited)');
select t.ok(pg_temp.bal(:'co', '5121') = 50000 and pg_temp.bal(:'co', '411') = 72000 - 50000 + 120000 - 7200, 'Dr bank / Cr receivable');
select t.throws(format($q$
  with p as (insert into public.payments (company_id, document_type, partner_id, method, amount, bank_account_id) values (%1$L, 'customer_payment', %2$L, 'cash', 30000, %3$L) returning id)
  insert into public.payment_allocations (company_id, payment_id, sales_invoice_id, amount) select %1$L::uuid, p.id, %4$L::uuid, 30000 from p;
  select public.post_payment((select id from public.payments where amount = 30000 and status = 'draft'));$q$, :'co', :'cust', :'cashbox', :'inv'),
  'more than its open amount', 'over-allocation rejected (14,800 still open)');
delete from public.payments where amount = 30000 and status = 'draft';

-- EUR receipt at a better rate: exchange gain
insert into public.payments (company_id, document_type, partner_id, method, amount, currency_code, exchange_rate, bank_account_id)
values (:'co', 'customer_payment', :'cust_eur', 'bank_transfer', 1200, 'EUR', 102, :'bank') returning id as rcp_eur \gset
insert into public.payment_allocations (company_id, payment_id, sales_invoice_id, amount) values (:'co', :'rcp_eur', :'inv_eur', 1200);
select public.post_payment(:'rcp_eur');
select t.ok(pg_temp.bal(:'co', '766') = -2400, 'EUR invoice booked at 100, paid at 102: 2,400 exchange gain');
select t.ok((select payment_status from public.sales_invoices where id = :'inv_eur') = 'paid', 'EUR invoice paid');

-- vendor payment through an approval workflow
select t.login('alice@alba.al');
insert into public.approval_workflows (company_id, name, doc_type, min_amount) values (:'co', 'Payments over 50k', 'vendor_payment', 50000) returning id as wf \gset
insert into public.approval_workflow_steps (company_id, workflow_id, step_order, name, approver_role_id) select :'co', :'wf', 1, 'Finance manager', id from public.roles where key = 'finance_manager';
select t.login('acco@fin.al');
insert into public.payments (company_id, document_type, partner_id, method, amount, bank_account_id) values (:'co', 'vendor_payment', :'vend', 'bank_transfer', 73200, :'bank') returning id as vp, number as vp_no \gset
insert into public.payment_allocations (company_id, payment_id, vendor_bill_id, amount) values (:'co', :'vp', :'bill', 73200);
select t.ok(public.post_payment(:'vp') = 'pending_approval' and :'vp_no' like 'PGS-2026-%', 'large vendor payment waits for approval');
select t.login('fina@fin.al');
select public.decide_approval((select id from public.approval_requests where document_id = :'vp'), 'approved');
select t.login('acco@fin.al');
select t.ok(public.post_payment(:'vp') = 'posted', 'approved payment posts');
select t.ok(pg_temp.bal(:'co', '401') = 0 and (select payment_status from public.vendor_bills where id = :'bill') = 'paid', 'payable settled, bill paid');

-- reversal restores the invoice balance
select public.reverse_payment(:'rcp', 'Bounced transfer');
select t.ok((select (payment_status, amount_paid) = ('partially_paid', 7200.00) from public.sales_invoices where id = :'inv'), 'reversed receipt reopens the invoice (the credit note stays applied)');
select t.ok(pg_temp.bal(:'co', '5121') = 122400 - 73200, 'bank back to the EUR receipt minus the vendor payment');
select t.ok((select status from public.journal_entries where id = (select journal_entry_id from public.payments where id = :'rcp')) = 'reversed',
            'original entry marked reversed');

-- ---------- aging -------------------------------------------------------------------------
select t.login('alice@alba.al');
insert into public.sales_invoices (company_id, partner_id, currency_code, invoice_date, due_date) values (:'co', :'cust', 'ALL', current_date - 50, current_date - 40) returning id as old_inv \gset
insert into public.sales_invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price) values (:'co', :'old_inv', 1, 'Old service', 1, 5000);
select public.post_sales_invoice(:'old_inv');
select t.ok((select (not_due, d31_60, total) = (64800.00, 5000.00, 69800.00) from public.partner_aging(:'co', 'ar') where partner_id = :'cust'),
            'aging: open invoice not yet due, 5,000 in 31–60 days');
select t.ok((select sum(total) from public.partner_aging(:'co', 'ar')) = pg_temp.bal(:'co', '411'), 'aging total equals the receivable account');

-- ---------- bank reconciliation -------------------------------------------------------------
select t.login('fina@fin.al');
insert into public.bank_statements (company_id, bank_account_id, statement_date, reference, opening_balance, closing_balance)
values (:'co', :'bank', current_date, 'ST-1', 0, 122400 - 73200 - 450) returning id as st \gset
insert into public.bank_statement_lines (company_id, statement_id, transaction_date, description, reference, amount) values
  (:'co', :'st', current_date, 'Incoming from Gastro GmbH', null, 122400),
  (:'co', :'st', current_date, 'Payment to Vaj Ulliri Berat', null, -73200),
  (:'co', :'st', current_date, 'Account fee October', 'FEE10', -450);
select t.ok(public.auto_match_statement(:'st') = 2, 'two lines matched to posted payments');
select t.throws(format($q$select public.reconcile_statement(%L)$q$, :'st'), 'unmatched', 'cannot close with open lines');
select public.book_statement_line((select id from public.bank_statement_lines where statement_id = :'st' and reference = 'FEE10'), pg_temp.acc(:'co', '662'), 'Bank fee');
select t.ok(public.reconcile_statement(:'st') = 'reconciled' and pg_temp.bal(:'co', '662') = 450, 'fee booked to bank charges; statement reconciled');
select t.ok(pg_temp.bal(:'co', '5121') = (select closing_balance from public.bank_statements where id = :'st'), 'bank GL equals the statement closing balance');

-- ---------- fixed assets ------------------------------------------------------------------
insert into public.cost_centers (company_id, code, name) values (:'co', 'SHOP', 'Shop') returning id as cc \gset
insert into public.fixed_assets (company_id, name, category_id, acquisition_date, in_service_date, acquisition_cost, useful_life_months, cost_center_id)
select :'co', 'Delivery van', id, make_date(extract(year from current_date)::int, 1, 10), make_date(extract(year from current_date)::int, 1, 10), 1200000, 48, :'cc'
  from public.fixed_asset_categories where company_id = :'co' and name = 'Vehicles' returning id as van, number as van_no \gset
select public.activate_fixed_asset(:'van', pg_temp.acc(:'co', '1091'));
select t.ok((select count(*) from public.asset_depreciation_lines where asset_id = :'van') = 48 and
            (select sum(amount) from public.asset_depreciation_lines where asset_id = :'van') = 1200000, 'straight-line schedule: 48 × 25,000');
select (public.run_depreciation(:'co', current_date) ->> 'months')::int as dep_months \gset
select t.ok(:'dep_months' = (extract(month from current_date)::int - case when current_date = (date_trunc('month', current_date) + interval '1 month - 1 day')::date then 0 else 1 end),
            'one depreciation entry per completed month');
select t.ok(pg_temp.bal(:'co', '681') = 25000 * :'dep_months' and pg_temp.bal(:'co', '2815') = -25000 * :'dep_months', 'Dr depreciation / Cr accumulated depreciation');
select t.ok((select sum(debit) from public.journal_lines where cost_center_id = :'cc' and account_id = pg_temp.acc(:'co', '681')) = 25000 * :'dep_months', 'depreciation carries the cost center');
select public.dispose_fixed_asset(:'van', current_date, 1100000, pg_temp.acc(:'co', '5121')) as disp \gset
select t.ok((:'disp'::jsonb ->> 'gain')::numeric = 1100000 - (1200000 - 25000 * :'dep_months'), 'disposal gain = proceeds − book value');
select t.ok((select status from public.fixed_assets where id = :'van') = 'disposed' and pg_temp.bal(:'co', '215') = 0 and pg_temp.bal(:'co', '2815') = 0,
            'asset and its depreciation leave the books');

-- ---------- production postings via the stock ledger -------------------------------------------
reset role;
select app.post_stock_move(:'co', 'production_consume', :'oil', :'stock', app.virtual_location(:'co', 'production'), 10, null, null,
                           'work_order', '00000000-0000-0000-0000-00000000a001', null, 'WO-TEST');
set role authenticated;
select t.ok(pg_temp.bal(:'co', '331') = 6100, 'production consumption: Dr WIP / Cr inventory');

-- ---------- manual entries and reversal ----------------------------------------------------
select t.login('acco@fin.al');
insert into public.journal_entries (company_id, journal_id, entry_date, memo)
select :'co', id, current_date, 'October rent' from public.journals where company_id = :'co' and code = 'GEN' returning id as je \gset
insert into public.journal_lines (company_id, entry_id, line_no, account_id, debit, credit, cost_center_id) values
  (:'co', :'je', 1, pg_temp.acc(:'co', '612'), 80000, 0, :'cc'), (:'co', :'je', 2, pg_temp.acc(:'co', '5121'), 0, 80000, null);
update public.journal_entries set status = 'posted' where id = :'je';
select public.reverse_journal_entry(:'je') as je_rev \gset
select t.ok(pg_temp.bal(:'co', '612') = 0 and (select status from public.journal_entries where id = :'je') = 'reversed', 'manual entry reversed');
select t.throws(format($q$select public.reverse_journal_entry(%L)$q$, (select journal_entry_id from public.sales_invoices where id = :'inv')),
                'corrected from their source', 'automatic entries are corrected at the source');

-- ---------- statements & invariants ------------------------------------------------------------
select t.ok((select sum(closing) from public.account_balances(:'co', make_date(extract(year from current_date)::int, 1, 1), current_date)) = 0,
            'trial balance balances');
select t.ok((select -sum(closing) filter (where account_type in ('revenue','expense'))
               from public.account_balances(:'co', make_date(extract(year from current_date)::int, 1, 1), current_date))
          = (public.finance_overview(:'co') ->> 'net_profit')::numeric, 'P&L net profit agrees with the overview');
select t.ok((select sum(closing) filter (where account_type = 'asset')
               from public.account_balances(:'co', '2000-01-01', current_date))
          = -(select sum(closing) filter (where account_type in ('liability','equity','revenue','expense'))
               from public.account_balances(:'co', '2000-01-01', current_date)), 'assets = liabilities + equity + current profit');
select t.ok((select sum(total_value) from public.item_costs where company_id = :'co')
          = pg_temp.bal(:'co', '311') + pg_temp.bal(:'co', '331') - 6100, 'inventory account equals the stock valuation');
select t.ok(not exists (select 1 from public.journal_entries where company_id = :'co' and status = 'posted' and total_debit <> total_credit),
            'every posted entry balances');
select t.ok(not exists (select 1 from public.journal_entries e where e.company_id = :'co' and e.is_automatic and e.source_doc_type is not null
                         and e.source_doc_id is null), 'automatic entries name their source document');

-- closed periods stop operational postings too
select t.login('acco@fin.al');
select t.throws(format($q$select public.set_period_status((select id from public.fiscal_periods where company_id = %L and current_date between start_date and end_date), 'closed')$q$, :'co'),
                'permission denied', 'accountants cannot close periods');
select t.login('fina@fin.al');
select public.set_period_status(id, 'closed') from public.fiscal_periods where company_id = :'co' and current_date - 50 between start_date and end_date;
select t.login('alice@alba.al');
insert into public.sales_invoices (company_id, partner_id, currency_code, invoice_date, due_date) values (:'co', :'cust', 'ALL', current_date - 50, current_date - 50) returning id as late_inv \gset
insert into public.sales_invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price) values (:'co', :'late_inv', 1, 'Late', 1, 100);
select t.throws(format($q$select public.post_sales_invoice(%L)$q$, :'late_inv'), 'fiscal period', 'no invoices into a closed period');

-- ---------- stock item billed without a receipt → cost of sales, not stock or GRNI -------------------
insert into public.vendor_bills (company_id, vendor_id, vendor_invoice_number, bill_date, due_date, currency_code)
values (:'co', :'vend', 'DIRECT-1', current_date, current_date + 30, 'ALL') returning id as dbill \gset
insert into public.vendor_bill_lines (company_id, bill_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
values (:'co', :'dbill', 1, :'oil', 'Olive oil, bought and used directly', 5, 600, :'vat20');
select public.post_vendor_bill(:'dbill');
select t.ok((select array_agg(a.code order by a.code) from public.journal_lines jl join public.accounts a on a.id = jl.account_id
              where jl.entry_id = (select journal_entry_id from public.vendor_bills where id = :'dbill')) = array['401','4456','601'],
            'stock item billed without a receipt: Dr cost of sales + VAT / Cr payable');

-- ---------- visibility ----------------------------------------------------------------------------
select t.login('rexa@fin.al');
select t.ok((select count(*) from public.journal_entries) = 0, 'sales reps do not see the ledger');

reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
