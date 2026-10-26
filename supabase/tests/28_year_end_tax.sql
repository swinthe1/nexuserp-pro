-- =============================================================================
-- DrisPRO · withholding tax, corporate income tax, year-end close (runs after 01–27)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Mbyllja Test', 'country', 'XK', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 10,
  'valid_until', (current_date + 365)::text)) as co \gset
select t.login('alice@alba.al');
select extract(year from current_date)::int - 1 as py \gset
select public.create_fiscal_year(:'co', :py) as fy \gset
select make_date(:py, 3, 1) as d_bill, make_date(:py, 6, 1) as d_inv, make_date(:py, 12, 1) as d_late, make_date(:py, 12, 31) as d_end, make_date(:py + 1, 1, 1) as d_next \gset
select id as a_rent from public.accounts where company_id = :'co' and code = '612' \gset
select id as a_serv from public.accounts where company_id = :'co' and code = '704' \gset
insert into public.business_partners (company_id, code, name, is_customer, is_vendor, tax_number) values (:'co', 'P1', 'Qiradhënësi', true, true, '810000001') returning id as pt \gset

-- a rent bill of 1 000 and a service sold for 5 000, both last year, no VAT
insert into public.vendor_bills (company_id, vendor_id, vendor_invoice_number, currency_code, bill_date, due_date)
values (:'co', :'pt', 'Q-03', 'EUR', :'d_bill', :'d_bill') returning id as bill \gset
insert into public.vendor_bill_lines (company_id, bill_id, line_no, description, account_id, quantity, unit_price) values (:'co', :'bill', 1, 'Qiraja', :'a_rent', 1, 1000);
select public.post_vendor_bill(:'bill') \gset
insert into public.sales_invoices (company_id, partner_id, currency_code, invoice_date, due_date) values (:'co', :'pt', 'EUR', :'d_inv', :'d_inv') returning id as inv \gset
insert into public.sales_invoice_lines (company_id, invoice_id, line_no, description, account_id, quantity, unit_price) values (:'co', :'inv', 1, 'Shërbim', :'a_serv', 1, 5000);
select public.post_sales_invoice(:'inv') \gset

-- ---------- withholding tax --------------------------------------------------------------------
select public.withholding_setup(:'co') as codes \gset
select t.ok(jsonb_array_length(:'codes'::jsonb) = 5, 'Kosovo kinds of withholding are set up');
select id as rent from public.withholding_codes where company_id = :'co' and code = 'RENT' \gset
select t.ok((select rate from public.withholding_codes where id = :'rent') = 9, 'rent is withheld at 9 %');
select public.withholding_create(jsonb_build_object('bill_id', :'bill', 'code_id', :'rent', 'date', :'d_bill')) as w \gset
select t.ok((:'w'::jsonb ->> 'amount')::numeric = 90, '9 % of 1 000 is 90');
select t.ok((select amount_due from public.vendor_bills where id = :'bill') = 910, 'the bill has 910 left to pay the supplier');
select t.ok((select sum(l.credit - l.debit) from public.journal_lines l join public.accounts a on a.id = l.account_id
             where l.company_id = :'co' and a.code = '4428') = 90, 'and 90 is owed to the tax office');
select t.throws(format($q$select public.withholding_create(jsonb_build_object('bill_id', %L, 'code_id', %L, 'base', 20000))$q$, :'bill', :'rent'),
  'Only', 'not more than is left on the bill');
select public.withholding_report(:'co', make_date(:py, 3, 1), make_date(:py, 3, 31)) as rep \gset
select t.ok(jsonb_array_length(:'rep'::jsonb -> 'rows') = 1 and (:'rep'::jsonb -> 'totals' -> 0 ->> 'amount')::numeric = 90
        and (:'rep'::jsonb ->> 'due')::date = make_date(:py, 4, 15), 'the monthly list, due on the 15th');
select public.withholding_cancel((:'w'::jsonb ->> 'id')::uuid, 'Gabim');
select t.ok((select amount_due from public.vendor_bills where id = :'bill') = 1000
        and jsonb_array_length(public.withholding_report(:'co', make_date(:py, 3, 1), make_date(:py, 3, 31)) -> 'rows') = 0, 'cancelled: the bill and the list are back');
select public.withholding_create(jsonb_build_object('bill_id', :'bill', 'code_id', :'rent', 'date', :'d_bill')) \gset

-- ---------- corporate income tax ---------------------------------------------------------------
select public.cit_worksheet(:'co', :py) as cit \gset
select t.ok((:'cit'::jsonb ->> 'profit')::numeric = 4000 and (:'cit'::jsonb ->> 'rate')::numeric = 10 and (:'cit'::jsonb ->> 'tax')::numeric = 400,
  'profit 4 000, Kosovo 10 %: tax 400');
select public.account_set_nondeductible(:'a_rent', true);
select t.ok((public.cit_worksheet(:'co', :py) ->> 'taxable')::numeric = 5000, 'an expense that is not deductible is added back');
select public.cit_save(:'co', :py, jsonb_build_object('adjustments', jsonb_build_array(jsonb_build_object('label', 'Të ardhura të përjashtuara', 'amount', -500)),
  'advances', 100)) as cit \gset
select t.ok((:'cit'::jsonb ->> 'taxable')::numeric = 4500 and (:'cit'::jsonb ->> 'tax')::numeric = 450 and (:'cit'::jsonb ->> 'payable')::numeric = 350,
  'other adjustments and the advances paid');
select public.cit_book(:'co', :py) \gset
select t.ok((select sum(l.debit - l.credit) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id join public.accounts a on a.id = l.account_id
             where l.company_id = :'co' and a.code = '691') = 450, 'the tax is in the books of the year');
select public.cit_save(:'co', :py, jsonb_build_object('advances', 100)) \gset
select public.cit_book(:'co', :py) \gset
select t.ok((select sum(l.debit - l.credit) from public.journal_lines l join public.accounts a on a.id = l.account_id
             where l.company_id = :'co' and a.code = '691') = 500, 'booked again: the old entry is replaced');

-- ---------- year-end close ---------------------------------------------------------------------
select public.year_end_check(:'fy') as chk \gset
select t.ok((:'chk'::jsonb ->> 'result')::numeric = 3500, 'the result of the year: 5 000 − 1 000 − 500 tax');
select t.ok((select (x ->> 'count')::int from jsonb_array_elements(:'chk'::jsonb -> 'checks') x where x ->> 'key' = 'cit') = 0, 'the tax is booked');
select public.year_close(:'fy') as yc \gset
select t.ok((:'yc'::jsonb ->> 'result')::numeric = 3500 and (select status from public.fiscal_years where id = :'fy') = 'closed', 'the year is closed with its result');
select t.ok((select closing from public.account_balances(:'co', :'d_next', :'d_next') where code = '108') = -3500
        and (select closing from public.account_balances(:'co', :'d_next', :'d_next') where code = '109') = 0, 'the result is in the earlier years'' results');
select t.ok((select credit from public.account_balances(:'co', make_date(:py, 1, 1), :'d_end') where code = '704') = 5000,
  'the year''s own report still shows its revenue');
select t.ok((select opening from public.account_balances(:'co', :'d_next', :'d_next') where code = '704') = 0, 'the next year starts from zero revenue');
select t.ok(not exists (select 1 from public.fiscal_periods where fiscal_year_id = :'fy' and status = 'open'), 'its months are closed');
insert into public.vendor_bills (company_id, vendor_id, vendor_invoice_number, currency_code, bill_date, due_date)
values (:'co', :'pt', 'Q-12', 'EUR', :'d_late', :'d_late') returning id as late \gset
insert into public.vendor_bill_lines (company_id, bill_id, line_no, description, account_id, quantity, unit_price) values (:'co', :'late', 1, 'Qiraja', :'a_rent', 1, 100);
select t.throws(format($q$select public.post_vendor_bill(%L)$q$, :'late'), 'closed', 'nothing more can be posted in a closed year');
select t.throws(format($q$select public.cit_book(%L, %s)$q$, :'co', :py), 'closed', 'nor the tax changed');
select t.throws(format($q$select public.year_reopen(%L, '')$q$, :'fy'), 'Write why', 'reopening needs a reason');

select public.year_reopen(:'fy', 'Fatura e harruar');
select t.ok((select status from public.fiscal_years where id = :'fy') = 'open'
        and (select closing from public.account_balances(:'co', :'d_next', :'d_next') where code = '108') = 0
        and (select opening from public.account_balances(:'co', :'d_next', :'d_next') where code = '704') = -5000, 'reopened: the closing is taken back');
select public.post_vendor_bill(:'late') \gset
select public.year_close(:'fy') as yc \gset
select t.ok((:'yc'::jsonb ->> 'result')::numeric = 3400, 'closed again with the late bill');

reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
