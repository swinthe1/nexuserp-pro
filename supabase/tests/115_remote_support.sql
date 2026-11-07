-- =============================================================================
-- Help at a distance, step 1: the Super Admin asks to see a licensed computer's screen; the program
-- checks with the server that the request is real before asking the person at the computer; her answer
-- and the end are kept. Also: a person's own export sent by email; the three books of the purchase book.
-- (after 114: the Mini market "Mini Market Arbëri" and its computers)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as mini from public.companies where name = 'Mini Market Arbëri' \gset
select id as pc from app.devices where company_id = :'mini' and name = 'Arka 1' \gset
select id as blocked from app.devices where company_id = :'mini' and name = 'Arka 2' \gset

-- 1. the computer learns its channel with its licence
set role anon;
select public.device_ping(:'pc', repeat(md5('Arka 1'), 2)) ->> 'channel' as ch \gset
select t.ok(length(:'ch') = 32, 'the program gets its own channel with the licence check');
select t.ok(public.device_ping(:'pc', 'wrong') ->> 'channel' is null, 'with another key there is no channel');

-- 2. the Super Admin asks; a blocked computer cannot be asked; a client cannot ask
reset role;
set role authenticated;
select t.login('zoe@platform.io');
select public.platform_support_start(:'pc') as s1 \gset
select t.ok(:'s1'::jsonb ->> 'channel' = :'ch' and jsonb_array_length(:'s1'::jsonb -> 'ice') >= 1, 'the request gives the channel and where the computers meet');
select t.throws(format($q$select public.platform_support_start(%L)$q$, :'blocked'), 'no licence', 'a blocked computer cannot be asked');
reset role;
set role authenticated;
select t.login('pronari@arberi.xk');
select t.throws(format($q$select public.platform_support_start(%L)$q$, :'pc'), 'platform administrator', 'a client cannot ask to see a computer');

-- 3. the program checks the request with its own key: only a real, fresh request for itself
reset role;
set role anon;
select t.ok((public.device_support_check(:'pc', repeat(md5('Arka 1'), 2), (:'s1'::jsonb ->> 'session')::uuid) ->> 'ok')::boolean, 'a real request is confirmed to the program');
select t.ok(not (public.device_support_check(:'pc', 'wrong', (:'s1'::jsonb ->> 'session')::uuid) ->> 'ok')::boolean, 'with another key nothing is confirmed');
select t.ok(not (public.device_support_check(:'pc', repeat(md5('Arka 1'), 2), gen_random_uuid()) ->> 'ok')::boolean, 'a made-up request is not confirmed');

-- 4. accepted, then stopped by the person at the computer; it is not confirmed again
select public.device_support_event(:'pc', repeat(md5('Arka 1'), 2), (:'s1'::jsonb ->> 'session')::uuid, 'accepted');
select t.ok(not (public.device_support_check(:'pc', repeat(md5('Arka 1'), 2), (:'s1'::jsonb ->> 'session')::uuid) ->> 'ok')::boolean, 'an answered request cannot be used again');
select public.device_support_event(:'pc', repeat(md5('Arka 1'), 2), (:'s1'::jsonb ->> 'session')::uuid, 'ended');
reset role;
select t.ok((select status = 'ended' and ended_by = 'client' and answered_at is not null from app.support_sessions where id = (:'s1'::jsonb ->> 'session')::uuid), 'the session is kept: accepted, ended by the client');

-- 5. refused; a request nobody answered is closed by the next one
set role authenticated;
select t.login('zoe@platform.io');
select public.platform_support_start(:'pc') as s2 \gset
select public.platform_support_start(:'pc') as s3 \gset
reset role;
set role anon;
select public.device_support_event(:'pc', repeat(md5('Arka 1'), 2), (:'s3'::jsonb ->> 'session')::uuid, 'declined');
reset role;
set role authenticated;
select t.login('zoe@platform.io');
select t.ok((select jsonb_agg(x ->> 'status' order by x ->> 'requested_at') from jsonb_array_elements(public.platform_support_sessions(:'mini')) x) = '["ended", "expired", "declined"]'::jsonb,
  'the console shows every session: ended, unanswered, refused');
select public.platform_support_settings('{"turn_url": "turn:turn.dris-ks.com:3478", "turn_username": "u", "turn_credential": "p"}');
select t.ok(jsonb_array_length(public.platform_support_start(:'pc') -> 'ice') = 2 and not (public.platform_support_settings() ? 'turn_credential'),
  'a TURN server is used once set; its password is not shown back');
reset role;
select t.ok((select count(*) from app.platform_events where company_id = :'mini' and kind in ('support_requested', 'support_accepted', 'support_declined', 'support_ended')) >= 6,
  'every request and answer is in the diary');

-- 6. a person's own export goes by email as an attachment; someone else's does not
select id as owner from auth.users where email = 'pronari@arberi.xk' \gset
insert into app.mail_accounts (company_id, host, port, security, username, password, from_email, is_active) values (:'mini', 'smtp.test', 587, 'starttls', 'u', 'p', 'zyra@arberi.test', true);
insert into public.my_exports (company_id, user_id, file_name, kind, path) values (:'mini', :'owner', 'faturat.xlsx', 'xlsx', :'mini' || '/' || :'owner' || '/f.xlsx') returning id as ex \gset
set role authenticated;
select t.login('pronari@arberi.xk');
select public.export_email(:'ex', 'kontabilisti@zyra.test', 'Faturat', 'Përshëndetje', 'UEsDBBQ=') as msg \gset
reset role;
select t.ok((select attachments -> 0 ->> 'name' = 'faturat.xlsx' and attachments -> 0 ->> 'mime' like '%spreadsheetml%' from app.message_outbox where id = :'msg'), 'the export goes as an Excel attachment');
set role authenticated;
select t.login('zoe@platform.io');
select t.throws(format($q$select public.export_email(%L, 'a@b.test', '', '', 'UEsDBBQ=')$q$, :'ex'), 'not found', 'nobody else can send a person''s export');

-- 7. the purchase book: goods, expenses, investments from what each invoice bought
reset role;
select id as gb from public.vendor_bills b where exists (select 1 from public.vendor_bill_lines l join public.product_variants v on v.id = l.variant_id
  join public.products p on p.id = v.product_id where l.bill_id = b.id and p.product_type = 'stockable') limit 1 \gset
select t.ok((select public.book(b) from public.vendor_bills b where id = :'gb') = 'goods', 'an invoice for stock is in the goods book');
set session_replication_role = replica;
update public.vendor_bill_lines set variant_id = null where bill_id = :'gb';
select t.ok((select public.book(b) from public.vendor_bills b where id = :'gb') = 'expense', 'an invoice without goods is in the expense book');
insert into public.accounts (company_id, code, name, account_type, account_subtype) select company_id, '2299-T', 'Pajisje test', 'asset', 'fixed_asset' from public.vendor_bills where id = :'gb' returning id as fa \gset
update public.vendor_bill_lines set account_id = :'fa' where bill_id = :'gb' and line_no = (select min(line_no) from public.vendor_bill_lines where bill_id = :'gb');
select t.ok((select public.book(b) from public.vendor_bills b where id = :'gb') = 'investment', 'a line to a fixed-asset account makes it an investment');
set session_replication_role = origin;

\set QUIET off
select count(*) as assertions_passed from t.results;
