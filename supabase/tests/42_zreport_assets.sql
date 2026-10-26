-- =============================================================================
-- DrisPRO · Z reports and fixed-asset invoices from a photo (runs after 01–41)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Z Test', 'country', 'XK', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 10,
  'valid_until', (current_date + 365)::text)) as co \gset
select public.platform_set_plan_extras(:'co', array['ai_reads'], null);
select t.login('alice@alba.al');
select public.doc_read_submit(:'co', encode(convert_to(repeat('z', 300), 'UTF8'), 'base64'), 'image/jpeg', 'z.jpg', 'z_report') as z1 \gset
select public.doc_read_submit(:'co', encode(convert_to(repeat('a', 300), 'UTF8'), 'base64'), 'image/jpeg', 'kombi.jpg', 'asset') as a1 \gset
select t.ok((select count(*) from public.zreport_reads(:'co')) = 1 and (select count(*) from public.expense_reads(:'co', 'asset')) = 1
        and (select count(*) from public.expense_reads(:'co')) = 0, 'Z reports and asset invoices each have their own list');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select public.reader_done(:'z1', true, '{"z_number":"0145","device":"KS1234","date":"2026-10-20","total":154,"receipts":37,"vat":[{"rate":18,"gross":118},{"rate":8,"net":30,"vat":2.4},{"rate":0,"gross":3.6}],"cash":100,"card":54}');
select public.reader_done(:'a1', true, '{"vendor_name":"Auto Kosova","vendor_tax_number":"810555666","number":"F-9","date":"2026-10-01","total":11800,"asset_name":"Kombi Ford Transit","asset_type":"vehicle","vat":[{"rate":18,"net":10000,"vat":1800}]}');

-- the Z report
set role authenticated;
select t.login('alice@alba.al');
select public.zreport_read_get(:'z1') -> 'result' as zr \gset
select t.ok(jsonb_array_length(:'zr'::jsonb -> 'lines') = 3 and (:'zr'::jsonb -> 'lines' -> 0 ->> 'net')::numeric = 100
        and (select bool_and(x ->> 'tax_code_id' is not null) from jsonb_array_elements(:'zr'::jsonb -> 'lines') x), 'the day''s sales by rate, each with its VAT code');
select id as cash from public.bank_accounts where company_id = :'co' and account_kind = 'cash' and deleted_at is null limit 1 \gset
select id as bank from public.bank_accounts where company_id = :'co' and account_kind = 'bank' and deleted_at is null limit 1 \gset
select coalesce(:'bank', :'cash') as bank \gset
select public.zreport_book(:'z1', jsonb_build_object('z_number', '0145', 'device', 'KS1234', 'date', '2026-10-20', 'lines', :'zr'::jsonb -> 'lines',
  'cash', 100, 'cash_account_id', :'cash', 'card', 54, 'card_account_id', :'bank')) as zb \gset
select t.ok((select status = 'posted' and total = 154 and payment_status = 'paid' and fiscal_status = 'not_required' from public.sales_invoices where id = (:'zb'::jsonb ->> 'invoice_id')::uuid),
  'booked as a posted sale, paid in cash and by card, not fiscalized a second time');
select t.ok(exists (select 1 from public.vat_book(:'co', '2026-10-01', '2026-10-31', 'sales') where total = 154), 'it is in the sales book');
reset role;
select t.ok(exists (select 1 from app.vat_entries(:'co', '2026-10-01', '2026-10-31') where doc_id = (:'zb'::jsonb ->> 'invoice_id')::uuid and rate = 18 and base = 100 and vat = 18),
  'with its VAT by rate');
set role authenticated;
select t.login('alice@alba.al');
select t.throws(format($q$select public.zreport_book(null, jsonb_build_object('company_id', %L, 'z_number', '0145', 'device', 'KS1234', 'lines', '[{"net":5}]'::jsonb))$q$, :'co'),
  'already booked', 'a Z report is booked once');
select t.ok((public.zreport_read_get(:'z1') ->> 'invoice_number') is not null, 'the read shows what it became');

-- the fixed asset
select public.expense_read_get(:'a1') -> 'result' as ar \gset
select t.ok((select name from public.fixed_asset_categories where id = (:'ar'::jsonb ->> 'category_id')::uuid) = 'Vehicles', 'a van is proposed as a vehicle');
select public.asset_book(:'a1', jsonb_build_object('vendor_name', 'Auto Kosova', 'vendor_tax_number', '810555666', 'number', 'F-9', 'date', '2026-10-01',
  'name', 'Kombi Ford Transit', 'category_id', :'ar'::jsonb ->> 'category_id', 'lines', :'ar'::jsonb -> 'lines')) as ab \gset
select t.ok((select status = 'active' and acquisition_cost = 10000 and vendor_bill_id is not null and journal_entry_id is null from public.fixed_assets where id = (:'ab'::jsonb ->> 'asset_id')::uuid),
  'the asset is made from the invoice, active, at the cost without VAT');
select t.ok((select count(*) from public.asset_depreciation_lines where asset_id = (:'ab'::jsonb ->> 'asset_id')::uuid) > 0, 'and its depreciation is planned');
reset role;
select t.ok(exists (select 1 from app.vat_entries(:'co', '2026-10-01', '2026-10-31') where doc_id = (:'ab'::jsonb ->> 'bill_id')::uuid and kind = 'investment'),
  'the invoice is an investment in the purchase book');
select t.ok(not exists (select 1 from app.expense_rules where company_id = :'co'), 'an asset invoice does not teach an expense account');
set role authenticated;
select t.login('alice@alba.al');
select t.throws(format($q$select public.asset_book(%L, '{}')$q$, :'a1'), 'already booked', 'an asset invoice is booked once');
reset role;

-- small business: the tax on gross income per quarter
set role authenticated;
select t.login('alice@alba.al');
select public.set_small_business_rate(:'co', 9);
select public.small_business_tax(:'co', 2026) as sb \gset
select t.ok((:'sb'::jsonb -> 'quarters' -> 3 ->> 'income')::numeric = 154 and (:'sb'::jsonb -> 'quarters' -> 3 ->> 'tax')::numeric = 13.86
        and (:'sb'::jsonb -> 'quarters' -> 3 ->> 'due') = '2027-01-15', 'small business: 9% of the gross income of the quarter, due on the 15th after it');
reset role;

-- ready-made expense items
set role authenticated;
select t.login('alice@alba.al');
select t.ok(public.seed_expense_items(:'co') = 23 and public.seed_expense_items(:'co') = 0, 'the expense items are made once');
reset role;
select t.ok((select a.code from public.products p join public.product_variants v on v.product_id = p.id join public.accounts a on a.id = app.item_acct(:'co', v.id, 'expense')
              where p.company_id = :'co' and p.code = 'SHP-007') = '624'
        and (select tc.rate from public.products p join public.tax_codes tc on tc.id = p.purchase_tax_code_id where p.company_id = :'co' and p.code = 'SHP-002') = 8
        and not (select is_sellable from public.products where company_id = :'co' and code = 'SHP-001'), 'fuel books on its account, electricity carries 8% VAT, none is sold');

\set QUIET off
select count(*) as assertions_passed from t.results;
