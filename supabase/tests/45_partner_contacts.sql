-- =============================================================================
-- DrisPRO · partner details from invoices and from the partner itself (runs after 01–44)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Contacts Test', 'country', 'XK', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 10,
  'valid_until', (current_date + 365)::text)) as co \gset
select public.platform_set_plan_extras(:'co', array['ai_reads'], null);
select t.login('alice@alba.al');
select public.doc_read_submit(:'co', encode(convert_to(repeat('c', 300), 'UTF8'), 'base64'), 'image/jpeg', 'kesko.jpg', 'expense') as r1 \gset
reset role;
select set_config('request.jwt.claim.sub', '', false);
select public.reader_done(:'r1', true, '{"vendor_name":"KESCO","vendor_tax_number":"810111222","number":"E-1","total":10,"category":"utilities","vat":[{"rate":8,"net":9.26,"vat":0.74}],"vendor_address":"Rr. Bill Clinton 3","vendor_city":"Prishtinë","vendor_phone":"038 200 500","vendor_email":"Info@Kesco.com","vendor_iban":"XK05 1212 0123 4567 8906"}');
set role authenticated;
select t.login('alice@alba.al');
select public.expense_read_get(:'r1') -> 'result' as res \gset
select public.expense_book(:'r1', jsonb_build_object('vendor_name', 'KESCO', 'vendor_tax_number', '810111222', 'number', 'E-1', 'category', 'utilities', 'lines', :'res'::jsonb -> 'lines')) as b \gset
select id as v from public.business_partners where company_id = :'co' and tax_number = '810111222' \gset
select t.ok((select phone = '038 200 500' and email = 'info@kesco.com' and bank_iban = 'XK051212012345678906' from public.business_partners where id = :'v'), 'a new supplier gets phone, e-mail and IBAN from its invoice');
select t.ok(exists (select 1 from public.partner_addresses where partner_id = :'v' and line1 = 'Rr. Bill Clinton 3' and city = 'Prishtinë'), 'and its address');

-- the next invoice prints another phone: it is offered, not written over
select public.doc_read_submit(:'co', encode(convert_to(repeat('d', 300), 'UTF8'), 'base64'), 'image/jpeg', 'kesko2.jpg', 'expense') as r2 \gset
reset role;
select set_config('request.jwt.claim.sub', '', false);
select public.reader_done(:'r2', true, '{"vendor_name":"KESCO","vendor_tax_number":"810111222","number":"E-2","total":10,"category":"utilities","vendor_phone":"038 999 999"}');
set role authenticated;
select t.login('alice@alba.al');
select t.ok((public.expense_read_get(:'r2') -> 'result' -> 'contact_diff' -> 'phone' ->> 'invoice') = '038 999 999', 'a different phone is shown to decide');
select t.ok((select phone from public.business_partners where id = :'v') = '038 200 500', 'and nothing is overwritten');
select public.partner_contact_apply(:'v', '{"phone":"038 999 999"}');
select t.ok((select phone from public.business_partners where id = :'v') = '038 999 999', 'taken when the person says so');

-- the partner fills in its own details
select public.partner_info_request(:'v') ->> 'token' as tok \gset
select t.ok((public.partner_info_request(:'v') ->> 'token') = :'tok', 'one open link per partner');
set role anon;
select t.ok((public.partner_info_form(:'tok') ->> 'name') = 'KESCO', 'the partner opens the link without an account');
select public.partner_info_submit(:'tok', '{"phone":"044 111 222","contact_name":"Arta Krasniqi","contact_phone":"049 000 111","iban":"xk05 1111 2222 3333 4444","notes":"ignored"}');
select t.throws(format($q$select public.partner_info_submit(%L, '{"phone":"1"}')$q$, :'tok'), 'sent already', 'the link works once');
select t.throws($q$select public.partner_info_form('nope')$q$, 'not valid', 'a wrong link shows nothing');
reset role;
select t.ok((select phone = '044 111 222' and bank_iban = 'XK0511112222333344 44' is false and bank_iban = 'XK0511112222333344'||'44' from public.business_partners where id = :'v')
        and exists (select 1 from public.partner_contacts where partner_id = :'v' and name = 'Arta Krasniqi' and is_primary), 'the details and the contact person are on the card');
select t.ok(exists (select 1 from public.notifications where company_id = :'co' and title = 'KESCO sent their details'), 'the company is told');

\set QUIET off
select count(*) as assertions_passed from t.results;
