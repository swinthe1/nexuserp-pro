-- =============================================================================
-- Every device its own licence: a pairing code approved by the Super Admin only, a lease of 30 days,
-- the check per client (off / warn / on) at sign-in and before every request, the local server's copy,
-- and a local server's errors sent to the cloud. (on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false), set_config('request.headers', '{}', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select m.user_id as worker, u.email as worker_email from public.company_members m join auth.users u on u.id = m.user_id
 where m.company_id = :'co' and m.status = 'active' and m.deleted_at is null
   and not coalesce((select is_super_admin from public.profiles p where p.id = m.user_id), false) limit 1 \gset
select app.set_user_login(:'worker', 'tdevice163', '482619', null);
select code as old_code, coalesce(local_server_id::text, '') as old_server, deployment as old_dep, device_guard as old_guard from public.licenses where company_id = :'co' \gset
update public.licenses set code = 'NXS-T163-T163-T163', local_server_id = '11111111-1111-1111-1111-111111111163', deployment = 'any', device_guard = 'off' where company_id = :'co';

-- a new device asks for a code
set role anon;
select t.throws($q$select public.device_pair_start('{"secret":"short"}')$q$, '', 'a device without its own key gets no code');
select public.device_pair_start('{"secret":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","kind":"mobile","name":"Telefoni i Arbenit","user_agent":"Android"}') as p \gset
select t.ok(length(:'p'::jsonb ->> 'code') = 6, 'a pairing code of six letters');
select t.ok(public.device_pair_status((:'p'::jsonb ->> 'id')::uuid, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') ->> 'status' = 'waiting', 'it waits for the approval');
select t.ok(public.device_pair_status((:'p'::jsonb ->> 'id')::uuid, 'wrong') ->> 'status' = 'unknown', 'another key learns nothing');
reset role;

-- only the Super Admin approves it
set role authenticated;
select t.login(:'worker_email');
select t.throws(format('select public.platform_device_pair_approve(%L, %L)', :'p'::jsonb ->> 'code', :'co'), '', 'the client''s people do not approve devices');
select t.login(:'boss');
select t.ok(public.platform_device_pair_find(lower(:'p'::jsonb ->> 'code')) ->> 'kind' = 'mobile', 'the Super Admin finds the code (small letters too)');
select public.platform_device_pair_approve(:'p'::jsonb ->> 'code', :'co', '{"name":"Telefoni 1"}') as d \gset
select t.ok(:'d'::jsonb ->> 'status' = 'active' and :'d'::jsonb ->> 'kind' = 'mobile' and (:'d'::jsonb ->> 'lease_until')::timestamptz > now() + interval '29 days', 'approved: a phone, a lease of 30 days');
select t.throws(format('select public.platform_device_pair_approve(%L, %L)', :'p'::jsonb ->> 'code', :'co'), 'not known', 'a code is used once');
reset role;
select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false);
set role anon;
select t.ok(public.device_pair_status((:'p'::jsonb ->> 'id')::uuid, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') ->> 'status' = 'active', 'the device learns it is licensed');
reset role;

-- a computer with the shared licence code waits too
set role anon;
select public.device_activate('NXS-T163-T163-T163', '{"kind":"office","secret":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","hostname":"PC-NEW","migrated":true}') as a \gset
select t.ok(:'a'::jsonb ->> 'status' = 'pending', 'a new computer from the licence code waits for the Super Admin, even one that says it was there before');
reset role;

-- the check off: everyone signs in as before
select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false), set_config('request.headers', '{}', false);
set role anon;
select t.ok(public.login_with_pin('tdevice163', '482619') ? 'request', 'check off: a device without licence signs in');
reset role;
update public.licenses set device_guard = 'on' where company_id = :'co';
update app.user_logins set failed = 0, locked_until = null where user_id = :'worker';
set role anon;
select t.ok(public.login_with_pin('tdevice163', '482619') ->> 'error' = 'This device has no DrisPRO licence', 'check on: no sign-in without a licensed device');
select set_config('request.headers', json_build_object('x-drispro-device', :'p'::jsonb ->> 'id', 'x-drispro-device-key', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')::text, false);
select t.ok(public.login_with_pin('tdevice163', '482619') ? 'request', 'check on: the licensed phone signs in');
select set_config('request.headers', json_build_object('x-drispro-device', :'p'::jsonb ->> 'id', 'x-drispro-device-key', 'cccccccccccccccccccccccccccccccccccccccc')::text, false);
select t.ok(public.login_with_pin('tdevice163', '482619') ->> 'error' is not null, 'its id with another key does not');
reset role;

-- before every request
set role authenticated;
select t.login(:'worker_email');
select set_config('request.headers', '{}', false);
select t.throws('select public.check_device()', 'no DrisPRO licence', 'a request without a licensed device is stopped');
select t.ok(public.device_state() ->> 'guard' = 'on' and not (public.device_state() ->> 'licensed')::boolean, 'the app is told why');
select set_config('request.headers', json_build_object('x-drispro-device', :'p'::jsonb ->> 'id', 'x-drispro-device-key', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')::text, false);
select public.check_device();
select t.ok((public.device_state() ->> 'licensed')::boolean, 'from the licensed phone it goes on');
select t.login(:'boss');
select set_config('request.headers', '{}', false);
select public.check_device();
select t.ok(true, 'the Super Admin is never held');
-- a blocked device stops at once; a lease that ran out stops too
select public.platform_device_set((:'p'::jsonb ->> 'id')::uuid, '{"status":"blocked"}');
select t.login(:'worker_email');
select set_config('request.headers', json_build_object('x-drispro-device', :'p'::jsonb ->> 'id', 'x-drispro-device-key', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')::text, false);
select t.throws('select public.check_device()', 'no DrisPRO licence', 'a blocked device is stopped');
select t.login(:'boss');
select public.platform_device_set((:'p'::jsonb ->> 'id')::uuid, '{"status":"active"}');
reset role;
update app.devices set lease_until = now() - interval '1 minute' where id = (:'p'::jsonb ->> 'id')::uuid;
set role authenticated;
select t.login(:'worker_email');
select t.throws('select public.check_device()', 'no DrisPRO licence', 'a lease that ran out (30 days without DrisPRO) stops it');
reset role;
-- its check renews the lease; another machine with its key is noted
select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false);
update app.devices set fingerprint = 'fp-one' where id = (:'p'::jsonb ->> 'id')::uuid;
set role anon;
select public.device_ping((:'p'::jsonb ->> 'id')::uuid, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '{"fingerprint":"fp-two"}') as g \gset
select t.ok((:'g'::jsonb ->> 'lease_until')::timestamptz > now() + interval '29 days', 'reaching DrisPRO renews the lease');
select t.ok((:'g'::jsonb ->> 'clone_suspect')::boolean, 'the same key on another machine is noted');
reset role;

-- a local server gets the devices and checks them itself
set role anon;
select t.throws($q$select public.licence_devices('NXS-T163-T163-T163', '22222222-2222-2222-2222-222222222222')$q$, '', 'only the licence''s own server gets them');
select public.licence_devices('NXS-T163-T163-T163', '11111111-1111-1111-1111-111111111163') as ld \gset
select t.ok(:'ld'::jsonb ->> 'guard' = 'on' and jsonb_array_length(:'ld'::jsonb -> 'devices') >= 2 and not (:'ld'::jsonb -> 'devices' -> 0 ? 'secret'), 'the server gets the devices, only the hashes of their keys');
select t.throws(format('select public.local_devices_apply(%L, %L)', 'NXS-T163-T163-T163', :'ld'), '', 'only the server''s worker keeps them');
reset role;
select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false);
delete from app.devices where id = (:'p'::jsonb ->> 'id')::uuid;
select public.local_devices_apply('NXS-T163-T163-T163', :'ld') as kept \gset
select t.ok(:kept >= 2 and exists (select 1 from app.devices where id = (:'p'::jsonb ->> 'id')::uuid), 'the worker keeps the cloud''s list');

-- the errors: with the device, and a local server's sent to the cloud once
set role authenticated;
select t.login(:'worker_email');
select set_config('request.headers', json_build_object('x-drispro-device', :'p'::jsonb ->> 'id', 'x-drispro-device-key', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')::text, false);
select public.report_client_error('{"message":"T163 the till broke","kind":"error","version":"2.56.0"}');
reset role;
select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false), set_config('request.headers', '{}', false);
select t.ok((select device like 'PC-%Telefoni 1' from public.client_errors where message = 'T163 the till broke'), 'an error says on which device');
select public.local_errors_take() as le \gset
select t.ok(exists (select 1 from jsonb_array_elements(:'le'::jsonb) x where x ->> 'message' = 'T163 the till broke' and (x ->> 'count')::int = 1), 'the worker takes what is new');
set role anon;
select t.ok(public.licence_errors_submit('NXS-T163-T163-T163', '11111111-1111-1111-1111-111111111163', :'le') >= 1, 'the cloud takes them with the licence');
reset role;
select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false);
select public.local_errors_sent(:'le');
select t.ok(not exists (select 1 from jsonb_array_elements(public.local_errors_take()) x where x ->> 'message' = 'T163 the till broke'), 'what was sent is not sent again');
select t.ok((select count(*) = 1 from public.client_errors where message = 'T163 the till broke' and device like '%server lokal'), 'the platform sees it as the local server''s');

-- back as it was
delete from public.client_errors where message = 'T163 the till broke';
delete from app.devices where company_id = :'co' and (id = (:'p'::jsonb ->> 'id')::uuid or hostname = 'PC-NEW');
delete from app.device_pairings where id = (:'p'::jsonb ->> 'id')::uuid;
delete from app.user_logins where user_id = :'worker' and username = 'tdevice163';
update public.licenses set code = :'old_code', local_server_id = nullif(:'old_server', '')::uuid, deployment = :'old_dep', device_guard = :'old_guard' where company_id = :'co';
\set QUIET off
select count(*) as assertions_passed from t.results;
