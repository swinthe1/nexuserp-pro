-- =============================================================================
-- DrisPRO · expenses from a photo: reading, proposing, learning, booking (runs after 01–34)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Expense Test', 'country', 'XK', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 10,
  'valid_until', (current_date + 365)::text)) as co \gset
select public.platform_set_plan_extras(:'co', array['ai_reads'], null);
select t.login('alice@alba.al');
select public.doc_read_submit(:'co', encode(convert_to(repeat('x', 300), 'UTF8'), 'base64'), 'image/jpeg', 'nafta.jpg', 'expense') as r1 \gset
select t.ok((select count(*) from public.expense_reads(:'co')) = 1 and (select count(*) from public.doc_reads_list(:'co')) = 0, 'expenses are listed apart from supplier invoices');
reset role;
select set_config('request.jwt.claim.sub', '', false);
update app.document_reads set status = 'failed' where id <> :'r1' and status in ('queued', 'reading');
select t.ok((public.reader_claim() ->> 'kind') = 'expense', 'the reader knows it is an expense');
select public.reader_done(:'r1', true, '{"vendor_name":"Petrol Ekspres","vendor_tax_number":"811000111","number":"K-77","date":"2026-10-20","total":59,"category":"fuel","description":"Naftë 40 L","vat":[{"rate":18,"net":50,"vat":9}],"paid":"cash"}');
set role authenticated;
select t.login('alice@alba.al');
select public.expense_read_get(:'r1') -> 'result' as res \gset
select t.ok((:'res'::jsonb ->> 'account_how') = 'category' and (:'res'::jsonb -> 'lines' -> 0 ->> 'net')::numeric = 50 and (:'res'::jsonb -> 'lines' -> 0 ->> 'tax_code_id') is not null,
  'a new seller: the account comes from the kind of expense, VAT by rate');
select id as cash from public.bank_accounts where company_id = :'co' and account_kind = 'cash' and deleted_at is null limit 1 \gset
select public.expense_book(:'r1', jsonb_build_object('vendor_name', 'Petrol Ekspres', 'vendor_tax_number', '811000111', 'number', 'K-77', 'date', '2026-10-20', 'category', 'fuel',
  'description', 'Naftë 40 L', 'lines', :'res'::jsonb -> 'lines', 'pay', jsonb_build_object('bank_account_id', :'cash', 'method', 'cash'))) as b1 \gset
select t.ok((select status = 'posted' and payment_status = 'paid' and total = 59 from public.vendor_bills where id = (:'b1'::jsonb ->> 'bill_id')::uuid),
  'booked as a posted bill, paid from the till');
select t.ok((select a.code from public.vendor_bill_lines l join public.accounts a on a.id = l.account_id where l.bill_id = (:'b1'::jsonb ->> 'bill_id')::uuid) = '624',
  'fuel goes to its own account, made when first needed');
select t.ok(exists (select 1 from public.business_partners where company_id = :'co' and name = 'Petrol Ekspres' and is_vendor and tax_number = '811000111'), 'the seller became a vendor');
select t.throws(format($q$select public.expense_book(%L, '{"vendor_name":"X","lines":[{"net":1}]}')$q$, :'r1'), 'already booked', 'a receipt is booked once');

-- the same seller again: what was chosen is proposed, even when the AI thinks otherwise
select public.doc_read_submit(:'co', encode(convert_to(repeat('y', 300), 'UTF8'), 'base64'), 'image/jpeg', 'n2.jpg', 'expense') as r2 \gset
reset role;
select set_config('request.jwt.claim.sub', '', false);
select public.reader_done(:'r2', true, '{"vendor_name":"PETROL EKSPRES","vendor_tax_number":"811 000 111","number":"K-77","total":20,"category":"supplies"}');
set role authenticated;
select t.login('alice@alba.al');
select public.expense_read_get(:'r2') -> 'result' as res2 \gset
select t.ok((:'res2'::jsonb ->> 'account_how') = 'learned' and (:'res2'::jsonb ->> 'category') = 'fuel' and (:'res2'::jsonb ->> 'vendor_id') is not null,
  'it learns: the seller is found and its account proposed');
select t.ok((:'res2'::jsonb -> 'already' ->> 'number') is not null, 'the same receipt number from the same seller is flagged');
select t.ok((:'res2'::jsonb -> 'lines' -> 0 ->> 'net')::numeric = 20, 'a receipt with only a total still has an amount');
select t.throws(format($q$select public.expense_book(%L, jsonb_build_object('vendor_id', %L, 'number', 'K-77', 'lines', '[{"net":20}]'::jsonb))$q$, :'r2', :'res2'::jsonb ->> 'vendor_id'),
  'already booked', 'the same number from the same seller is not booked twice');

-- without a photo, unpaid: it waits among the bills to pay
select public.expense_book(null, jsonb_build_object('company_id', :'co', 'vendor_name', 'KEDS', 'category', 'utilities', 'date', '2026-10-15',
  'lines', jsonb_build_array(jsonb_build_object('net', 100, 'tax_code_id', app.purchase_tax(:'co', 8))))) as b3 \gset
select t.ok((select payment_status <> 'paid' and total = 108 from public.vendor_bills where id = (:'b3'::jsonb ->> 'bill_id')::uuid), 'without a photo, not paid yet: a bill to pay with its VAT');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
