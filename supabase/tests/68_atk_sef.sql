-- =============================================================================
-- DrisPRO · Kosovo: DrisPRO as a fiscal software (SEF) for ATK: registering a till, signed coupons,
-- the postier sending them (runs after 01–67)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
insert into auth.users (email, raw_user_meta_data) values ('lume@atk.al', '{"full_name":"Lume Menaxhere"}'), ('kaltrina@atk.al', '{"full_name":"Kaltrina Arkëtare"}')
on conflict do nothing;

select email as boss from public.profiles where is_super_admin limit 1 \gset
set role authenticated;
select t.login(:'boss');
select public.create_company('SEF Test', 'XK') as co \gset
select public.invite_member(:'co', 'lume@atk.al', array['store_manager']);
select public.invite_member(:'co', 'kaltrina@atk.al', array['pos_cashier']);
select t.accept_invites();
select t.login(:'boss');
select id as shop from public.warehouses where company_id = :'co' order by created_at limit 1 \gset
select id as floor from public.warehouse_locations where company_id = :'co' and warehouse_id = :'shop' order by created_at limit 1 \gset
select id as pcs from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
insert into public.bank_accounts (company_id, name, account_kind, currency_code, account_id)
select :'co', 'Arka 1', 'cash', 'EUR', id from public.accounts where company_id = :'co' and code = '5311' returning id as drawer \gset
insert into public.pos_registers (company_id, code, name, warehouse_id, location_id, cash_account_id, journal_id)
select :'co', 'A1', 'Arka 1', :'shop', :'floor', :'drawer', id from public.journals where company_id = :'co' and code = 'POS' returning id as reg \gset
insert into public.pos_registers (company_id, code, name, warehouse_id, location_id, cash_account_id, journal_id)
select :'co', 'A2', 'Arka 2', :'shop', :'floor', :'drawer', id from public.journals where company_id = :'co' and code = 'POS' returning id as reg2 \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'S-UJE', 'name', 'Ujë Rugove', 'uom_id', :'pcs', 'sales_price', 0.5)) as p \gset
select id as water from public.product_variants where product_id = :'p' \gset

-- ----------------------------------------------------------------------------- off until the company turns it on
reset role;
update public.companies set tax_number = '810123456', city = 'Prishtinë' where id = :'co';
update public.company_settings set fiscalization_enabled = true where company_id = :'co';
update public.platform_settings set atk_application_id_test = null, atk_application_id_prod = null where id;
set role authenticated;
select t.login(:'boss');
select t.ok(not (public.atk_till(:'reg') ->> 'required')::boolean, 'a Kosovo company with the old fiscalization switch on: its tills go on selling as before');
select public.atk_settings_save(:'co', null, null, true);
select public.atk_till(:'reg') as till \gset
select t.ok((:'till'::jsonb ->> 'required')::boolean and :'till'::jsonb ->> 'env' = 'test' and not (:'till'::jsonb ->> 'certified')::boolean
  and :'till'::jsonb -> 'missing' @> '["fiscalization_no", "application_id", "branch", "pos"]', 'DrisPRO as the fiscal software turned on: the till must sign, and is told what is missing');

-- ----------------------------------------------------------------------------- the numbers
select t.login('kaltrina@atk.al');
select t.throws(format($q$select public.atk_settings_save('%s', '1234')$q$, :'co'), 'tax rights', 'a cashier does not set the ATK numbers');
select t.throws('select public.atk_platform_save(11, 12)', 'platform admin', 'nor DrisPRO''s own number at ATK');
select t.login(:'boss');
select public.atk_platform_save(4242, null);
select public.atk_settings_save(:'co', 'FN-2026-77');
select t.throws(format($q$select public.atk_numbers_save('%s', '[]', '[{"id":"%s","atk_pos_id":1},{"id":"%s","atk_pos_id":1}]')$q$, :'co', :'reg', :'reg2'),
  'same ATK number', 'two tills of one store cannot share a number');
select public.atk_numbers_save(:'co', jsonb_build_array(jsonb_build_object('id', :'shop', 'atk_branch_id', 3)),
  jsonb_build_array(jsonb_build_object('id', :'reg', 'atk_pos_id', 1), jsonb_build_object('id', :'reg2', 'atk_pos_id', 2)));
select public.atk_setup(:'co') as setup \gset
select t.ok(:'setup'::jsonb ->> 'application_id' = '4242' and :'setup'::jsonb ->> 'fiscalization_no' = 'FN-2026-77'
  and (select bool_and(jsonb_array_length(x -> 'missing') = 0) from jsonb_array_elements(:'setup'::jsonb -> 'tills') x), 'everything set: both tills are ready to register');

-- ----------------------------------------------------------------------------- registering a till (the postier talks to ATK)
select t.login('kaltrina@atk.al');
select t.throws(format($q$select public.atk_onboard_verify('%s')$q$, :'reg'), 'store manager', 'a cashier does not register a till');
select t.login('lume@atk.al');
select public.atk_onboard_verify(:'reg') as v \gset
select t.throws(format($q$select public.atk_onboard_verify('%s')$q$, :'reg'), 'being registered', 'not twice at once');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select public.atk_wait(100) as job \gset
select t.ok(:'job'::jsonb ->> 'url' = 'https://fiskalizimi-test.atk-ks.org/ca/verify/810123456'
  and :'job'::jsonb -> 'body' = '{"fiscalization_no":"FN-2026-77","pos_id":1,"branch_id":3,"application_id":4242}', 'the postier is told where and what: /ca/verify with the four numbers');
select public.atk_done('verify', :'v', 200, '{"business_name":"SEF Test SH.P.K.","verification_code":"VC-9911"}');
set role authenticated;
select t.login('lume@atk.al');
select t.ok(public.atk_job(:'v') = '{"error": null, "status": "done", "certificate": null, "business_name": "SEF Test SH.P.K."}'::jsonb, 'the till sees the name ATK knows, not the code');
select t.login('kaltrina@atk.al');
select t.ok(public.atk_job(:'v') is null, 'and nobody else sees the step');
select t.login('lume@atk.al');
select public.atk_onboard_csr(:'v', E'-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----\n', 'BPub', 'Chrome on Windows') as c \gset
reset role;
select set_config('request.jwt.claim.sub', '', false);
select public.atk_wait(100) as job \gset
select t.ok(:'job'::jsonb ->> 'url' = 'https://fiskalizimi-test.atk-ks.org/ca/signcsr' and :'job'::jsonb -> 'body' ->> 'verification_code' = 'VC-9911'
  and :'job'::jsonb -> 'body' ->> 'business_name' = 'SEF Test SH.P.K.' and (:'job'::jsonb -> 'body' ->> 'business_id')::bigint = 810123456
  and not (:'job'::jsonb -> 'body' ? '_public_key'), 'then /ca/signcsr with the code and the request (the till''s own notes stay home)');
select public.atk_done('signcsr', :'c', 200, '{"signed_certificate":"-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----"}');
set role authenticated;
select t.login('lume@atk.al');
select t.ok((public.atk_till(:'reg') ->> 'certified')::boolean and public.atk_till(:'reg') ->> 'public_key' = 'BPub', 'the till is registered');
select t.ok(not (public.atk_till(:'reg2') ->> 'certified')::boolean, 'the other till is not');

-- ----------------------------------------------------------------------------- a signed sale
select t.login('kaltrina@atk.al');
select public.open_pos_session(:'reg', 20) as ses \gset
select t.throws(format($q$select public.pos_submit_order('{"client_uuid":"%s","session_id":"%s","lines":[{"variant_id":"%s","quantity":2,"unit_price":0.5}],
  "payments":[{"method":"cash","amount":1}],"fiscal":{"env":"test","coupon_id":"301000000001"}}')$q$, gen_random_uuid(), :'ses', :'water'),
  'not complete', 'a coupon without its signature is refused');
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'water', 'quantity', 2, 'unit_price', 0.5)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1)),
  'fiscal', jsonb_build_object('env', 'test', 'coupon_id', 301000000001, 'seq', 1, 'pos_id', 1, 'branch_id', 3, 'verification_no', '1234567890123456',
    'details', 'CMTVAxAKGAEiCVByaXNodGluZQ==', 'signature', 'MEUCIQD3XmlSMXXlCoGL1i8FvjpM7cEFG0caI8lo6gwQvHy3jwIhAKP4m5nnbncPANmp', 'qr', 'CMTV|MEUC',
    'type', 1, 'total', 100, 'tax', 0))) as s1 \gset
select t.ok((select atk ->> 'coupon_id' = '301000000001' and fiscal_status = 'pending' from public.pos_orders where id = (:'s1'::jsonb ->> 'id')::uuid),
  'the sale keeps its signed coupon and waits for ATK');
select t.ok((select status = 'pending' and iic = '301000000001' and verification_code = '1234567890123456' and request_payload -> 'atk' ->> 'details' = 'CMTVAxAKGAEiCVByaXNodGluZQ=='
               from public.fiscalization_records where source_doc_id = (:'s1'::jsonb ->> 'id')::uuid), 'the queue holds what goes to ATK');
select t.ok((public.atk_till(:'reg') ->> 'last_seq')::int = 1, 'the server knows the till''s count (a till that lost its storage goes on from there)');
select t.throws(format($q$select public.pos_submit_order('{"client_uuid":"%s","session_id":"%s","lines":[{"variant_id":"%s","quantity":1,"unit_price":0.5}],
  "payments":[{"method":"cash","amount":0.5}],"fiscal":{"env":"test","coupon_id":301000000001,"seq":1,"details":"CMTVAxAKGAEi","signature":"MEUCIQD3XmlSMXXlCoGL1i8FvjpM7cEFG0caI8lo6gwQvHy3jwIhAKP4","qr":"A|B"}}')$q$,
  gen_random_uuid(), :'ses', :'water'), 'duplicate key', 'one coupon number is used once');

-- the old queue (it simulates test answers) leaves the ATK coupons alone
select t.login(:'boss');
select public.process_fiscal_queue(:'co');
select t.ok((select status from public.fiscalization_records where source_doc_id = (:'s1'::jsonb ->> 'id')::uuid) = 'pending', 'they are never "simulated"');

-- ----------------------------------------------------------------------------- the postier sends it
reset role;
select set_config('request.jwt.claim.sub', '', false);
select public.atk_wait(100) as job \gset
select (:'job'::jsonb ->> 'id') as fr \gset
select t.ok(:'job'::jsonb ->> 'url' = 'https://fiskalizimi-test.atk-ks.org/pos/coupon'
  and :'job'::jsonb -> 'body' = '{"details":"CMTVAxAKGAEiCVByaXNodGluZQ==","signature":"MEUCIQD3XmlSMXXlCoGL1i8FvjpM7cEFG0caI8lo6gwQvHy3jwIhAKP4m5nnbncPANmp"}'
  and :'job'::jsonb -> 'citizen' -> 'body' = '{"qr_code":"CMTV|MEUC","citizen_id":1}', 'the coupon goes to /pos/coupon (and, in test, the citizen''s scan too)');
select t.ok(public.atk_wait(100) is null, 'a coupon being sent is not given out twice');
-- ATK cannot be reached: tried again later
select public.atk_done('coupon', :'fr', 0, null, 'ECONNREFUSED');
select t.ok((select status = 'failed' and error_code = 'UNREACHABLE' and attempt_count = 1 from public.fiscalization_records where id = :'fr'), 'no answer: kept to try again');
select t.ok(public.atk_wait(100) is null, 'not again at once');
update public.fiscalization_records set last_attempt_at = now() - interval '2 minutes' where id = :'fr';
select t.ok(public.atk_wait(100) ->> 'id' = :'fr', 'a minute later it goes again');
select public.atk_done('coupon', :'fr', 200, '{"message":"ok","transaction_id":987654321}', null, 200, '{"message":"ok"}');
select t.ok((select status = 'fiscalized' and fic = '987654321' and attempt_count = 2 from public.fiscalization_records where id = :'fr')
  and (select fiscal_status from public.pos_orders where id = (:'s1'::jsonb ->> 'id')::uuid) = 'fiscalized', 'ATK took it: its transaction number is kept');

-- the till asks after its coupon before printing it
set role authenticated;
select t.login('kaltrina@atk.al');
select t.ok(public.atk_coupon_status(:'reg', 301000000001) ->> 'status' = 'fiscalized' and public.atk_coupon_status(:'reg', 301000000001) ->> 'transaction' = '987654321',
  'the till sees that ATK took its coupon');
select t.ok(public.atk_receipt((:'s1'::jsonb ->> 'id')::uuid) -> 'atk' ->> 'coupon_id' = '301000000001'
  and public.atk_receipt((:'s1'::jsonb ->> 'id')::uuid) -> 'header' ->> 'city' = 'Prishtinë', 'a copy is printed from the signed coupon, with the head of the coupon');
select t.throws(format($q$select public.pos_submit_order('{"client_uuid":"%s","session_id":"%s","lines":[{"variant_id":"%s","quantity":1,"unit_price":0.5}],
  "payments":[{"method":"cash","amount":0.5}],"fiscal":{"env":"test","coupon_id":301000000009,"seq":9,"type":2,"details":"CMTVAxAKGAEi","signature":"MEUCIQD3XmlSMXXlCoGL1i8FvjpM7cEFG0caI8lo6gwQvHy3jwIhAKP4","qr":"A|B"}}')$q$,
  gen_random_uuid(), :'ses', :'water'), 'needs its reason', 'a cancellation coupon says why');
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- ATK refuses a coupon: the tax people are told
set role authenticated;
select t.login('kaltrina@atk.al');
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'water', 'quantity', 1, 'unit_price', 0.5)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 0.5)),
  'fiscal', jsonb_build_object('env', 'test', 'coupon_id', 301000000002, 'seq', 2, 'pos_id', 1, 'details', 'CMTVAxAKGAEiCVByaXNodGluZQ==',
    'signature', 'MEUCIQD3XmlSMXXlCoGL1i8FvjpM7cEFG0caI8lo6gwQvHy3jwIhAKP4m5nnbncPANmp', 'qr', 'CMTV|MEUC', 'block_no', 'B-0042'))) as s2 \gset
select t.ok((select atk ->> 'block_no' = 'B-0042' from public.pos_orders where id = (:'s2'::jsonb ->> 'id')::uuid), 'a coupon from the receipt book keeps the book''s number');
reset role;
select set_config('request.jwt.claim.sub', '', false);
select public.atk_wait(100) ->> 'id' as fr2 \gset
select public.atk_done('coupon', :'fr2', 400, '{"error":"details and signature don''t match"}');
select t.ok((select status = 'failed' and error_code = 'ATK_400' and error_message = 'details and signature don''t match' from public.fiscalization_records where id = :'fr2'),
  'ATK''s own reason is kept');
select t.ok(exists (select 1 from public.notifications n join public.profiles p on p.id = n.user_id where p.email = :'boss' and n.company_id = :'co'
  and n.title like 'ATK refused a receipt:%'), 'and the tax people are told');

-- a sale from the till that is not registered: it cannot be sent, and says why
set role authenticated;
select t.login('kaltrina@atk.al');
-- a cashier works one market shift at a time: the first one closes
select public.pos_close(:'ses', jsonb_build_object('counted', public.pos_session_summary(:'ses') ->> 'expected_cash'));
select public.open_pos_session(:'reg2', 0) as ses2 \gset
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses2',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'water', 'quantity', 1, 'unit_price', 0.5)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 0.5)))) as s3 \gset
select t.ok((select status = 'failed' and error_code = 'NOT_SIGNED' from public.fiscalization_records where source_doc_id = (:'s3'::jsonb ->> 'id')::uuid),
  'unsigned: marked, never sent');
reset role;
select set_config('request.jwt.claim.sub', '', false);
update public.fiscalization_records set last_attempt_at = now() - interval '1 day' where company_id = :'co';
select t.ok(public.atk_wait(100) ->> 'id' = :'fr2', 'the postier only ever takes signed coupons');
select public.atk_done('coupon', :'fr2', 0, null, 'timeout');

-- a till registered again forgets its old certificate first
set role authenticated;
select t.login('lume@atk.al');
select public.atk_till_forget(:'reg');
select t.ok(not (public.atk_till(:'reg') ->> 'certified')::boolean, 'a till can be unregistered');
-- ATK registers each till number once (its /ca/verify answers 404 the second time)
select t.ok((select (x ->> 'taken')::boolean and (x ->> 'next_free')::int = 3 from jsonb_array_elements(public.atk_setup(:'co') -> 'tills') x where (x ->> 'id')::uuid = :'reg'),
  'the page says the number is taken and offers a free one (2 belongs to the other till)');
select t.throws(format($q$select public.atk_onboard_verify('%s')$q$, :'reg'), 'give this till number 3', 'registering it again under the same number is stopped before ATK is asked');
select t.login('kaltrina@atk.al');
select t.throws('select public.atk_wait(100)', 'permission denied', 'only the server waits for ATK work');


-- ----------------------------------------------------------------------------- ATK's units and categories on each line
set role authenticated;
select t.login(:'boss');
select t.ok((select x ->> 'atk_unit' from jsonb_array_elements(public.atk_codes(:'co') -> 'units') x where x ->> 'code' = 'pcs') = 'CP'
  and (select x ->> 'atk_unit' from jsonb_array_elements(public.atk_codes(:'co') -> 'units') x where x ->> 'code' = 'kg') = 'KGN', 'the company''s units come matched to ATK''s (pcs = CP, kg = KGN)');
insert into public.product_categories (company_id, name) values (:'co', 'Pije freskuese') returning id as cat \gset
select id as kg from public.units_of_measure where company_id = :'co' and code = 'kg' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'S-SOK', 'name', 'Lëng portokalli', 'uom_id', :'pcs', 'sales_price', 1.2, 'category_id', :'cat')) as p \gset
select id as juice from public.product_variants where product_id = :'p' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'S-MOL', 'name', 'Mollë', 'uom_id', :'kg', 'sales_price', 0.9)) as p \gset
select id as apple from public.product_variants where product_id = :'p' \gset
select public.atk_codes_save(:'co', 'AU', null, jsonb_build_array(jsonb_build_object('id', :'cat', 'atk_type', 'PJA')));
select t.throws(format($q$select public.atk_codes_save('%s', 'XX', null, null)$q$, :'co'), 'check constraint', 'only ATK''s own codes');
select public.atk_till(:'reg') as till \gset
select t.ok(:'till'::jsonb ->> 'default_type' = 'AU' and :'till'::jsonb -> 'types' ->> :'juice' = 'PJA' and not (:'till'::jsonb -> 'types' ? :'water')
  and :'till'::jsonb -> 'units' ->> :'apple' = 'KGN' and not (:'till'::jsonb -> 'units' ? :'water'), 'the till knows each item''s ATK unit and category (only what differs is sent)');
select t.login('kaltrina@atk.al');
select t.throws(format($q$select public.atk_codes_save('%s', 'TT', null, null)$q$, :'co'), 'tax rights', 'a cashier does not change them');


-- ----------------------------------------------------------------------------- the log ATK checks (sends, errors, interruptions, changes)
set role authenticated;
select t.login(:'boss');
select t.ok((select count(*) from public.atk_events where company_id = :'co' and kind = 'sent' and coupon_no is not null and amount > 0) >= 1
  and (select count(*) from public.atk_events where company_id = :'co' and kind = 'failed' and details ->> 'error' is not null) >= 2,
  'every try to send a coupon is in the log, with its number, total and the error of the failed ones');
select t.ok((select count(*) from public.atk_events where company_id = :'co' and kind = 'change' and details ->> 'what' in ('fiscalization_no', 'sef_enabled')) >= 2
  and exists (select 1 from public.atk_events where company_id = :'co' and kind = 'change' and details ->> 'what' = 'till_unregistered')
  and exists (select 1 from public.atk_events where company_id = :'co' and kind = 'change' and details ->> 'what' = 'store_number'),
  'changes to the SEF are logged: the numbers, the switch, a till unregistered');
select t.login('kaltrina@atk.al');
select public.atk_log_events(jsonb_build_array(
  jsonb_build_object('id', '6f9b1c1e-0000-4000-8000-000000000001', 'register_id', :'reg', 'kind', 'offline', 'at', now() - interval '20 minutes'),
  jsonb_build_object('id', '6f9b1c1e-0000-4000-8000-000000000002', 'register_id', :'reg', 'kind', 'online', 'at', now() - interval '5 minutes', 'details', jsonb_build_object('offline_seconds', 900, 'waiting', 3)),
  jsonb_build_object('id', '6f9b1c1e-0000-4000-8000-000000000003', 'register_id', :'reg', 'kind', 'sent', 'at', now()),
  jsonb_build_object('id', '6f9b1c1e-0000-4000-8000-000000000004', 'register_id', :'reg', 'kind', 'clock', 'at', now() + interval '1 day'))) as n \gset
select t.ok(:n = 3, 'the till sends what it saw; it cannot write a send to ATK itself');
select public.atk_log_events(jsonb_build_array(jsonb_build_object('id', '6f9b1c1e-0000-4000-8000-000000000001', 'register_id', :'reg', 'kind', 'offline', 'at', now())));
select t.ok(not exists (select 1 from public.atk_events where company_id = :'co'), 'a cashier does not read the log');
select t.login('lume@atk.al');
select t.ok((select count(*) from public.atk_events where company_id = :'co' and kind = 'offline') = 1
  and (select (details ->> 'offline_seconds')::int from public.atk_events where company_id = :'co' and kind = 'online') = 900
  and (select at <= now() from public.atk_events where company_id = :'co' and kind = 'clock'), 'a step sent twice is kept once, and no time is in the future');
select t.throws(format($q$update public.atk_events set kind = 'sent' where company_id = '%s'$q$, :'co'), 'permission denied', 'the log is never changed');
select t.throws(format($q$delete from public.atk_events where company_id = '%s'$q$, :'co'), 'permission denied', 'nor deleted');
select t.ok(abs(extract(epoch from public.server_now() - now())) < 5, 'the till can read the server''s clock');
reset role;
select t.throws(format($q$update public.pos_registers set paper_mm = 70 where id = '%s'$q$, :'reg'), 'check constraint', 'a till prints on 58 or 80 mm paper');

reset role;
update public.platform_settings set atk_application_id_test = null, atk_application_id_prod = null where id;
\set QUIET off
select count(*) as assertions_passed from t.results;
