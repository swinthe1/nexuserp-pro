-- =============================================================================
-- The platform enters a client's local server: a ticket from the cloud (2 minutes, once, that client only),
-- checked by the local server's worker with its licence, then the Super Admin is signed in there.
-- (cloud and local in one database here; on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false), set_config('request.headers', '{}', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select code as old_code, coalesce(local_server_id::text, '') as old_server, deployment as old_dep from public.licenses where company_id = :'co' \gset
update public.licenses set code = 'NXS-T164-T164-T164', local_server_id = null, deployment = 'cloud' where company_id = :'co';

set role authenticated;
select t.login(:'boss');
select t.ok((public.platform_local_ticket(:'co') ->> 'local')::boolean = false, 'a client in the cloud is opened here, as before');
reset role;
update public.licenses set local_server_id = '11111111-1111-1111-1111-111111111164', deployment = 'local' where company_id = :'co';
delete from app.local_tunnels where company_id = :'co';
set role authenticated;
select t.login(:'boss');
select t.throws(format('select public.platform_local_ticket(%L)', :'co'), 'no outside address', 'a local server without its outside address cannot be opened');
reset role;
insert into app.local_tunnels (company_id, licence_code, server_id, hostname, status) values (:'co', 'NXS-T164-T164-T164', '11111111-1111-1111-1111-111111111164', 'kontrolle-t164.drispro.com', 'ready');
set role authenticated;
select t.login('pronari@arberi.xk');
select t.throws(format('select public.platform_local_ticket(%L)', :'co'), '', 'only the Super Admin gets a ticket');
select t.login(:'boss');
select public.platform_local_ticket(:'co') as tk \gset
select t.ok(:'tk'::jsonb ->> 'url' like 'https://kontrolle-t164.drispro.com/login#ticket=%', 'a local client is opened on its own server, with a ticket');
reset role;
select split_part(:'tk'::jsonb ->> 'url', '#ticket=', 2) as ticket \gset

-- the page on the local server asks; the worker takes it
select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false);
set role anon;
select public.support_login_start(:'ticket') as st \gset
select t.ok(public.support_login_result((:'st'::jsonb ->> 'request')::uuid, :'st'::jsonb ->> 'secret') ->> 'status' = 'queued', 'the page waits');
select t.throws('select public.support_login_wait()', '', 'only the server''s worker takes it');
reset role;
select public.support_login_wait() as w \gset
set role anon;
select t.throws(format('select public.licence_support_ticket(%L, %L, %L)', 'NXS-T164-T164-T164', '22222222-2222-2222-2222-222222222222', :'ticket'), '', 'another server cannot use the ticket');
select public.licence_support_ticket('NXS-T164-T164-T164', '11111111-1111-1111-1111-111111111164', :'w'::jsonb ->> 'ticket') as who \gset
select t.ok(:'who'::jsonb ->> 'email' = :'boss', 'the cloud says who opens it');
select t.throws(format('select public.licence_support_ticket(%L, %L, %L)', 'NXS-T164-T164-T164', '11111111-1111-1111-1111-111111111164', :'ticket'), 'not valid', 'a ticket is used once');
reset role;
select public.support_login_user((:'w'::jsonb ->> 'id')::uuid, 'NXS-T164-T164-T164', :'who'::jsonb ->> 'email', 'DrisPRO') as u \gset
select public.support_login_done((:'w'::jsonb ->> 'id')::uuid, true, '123456');
set role anon;
select public.support_login_result((:'st'::jsonb ->> 'request')::uuid, :'st'::jsonb ->> 'secret') as res \gset
select t.ok(:'res'::jsonb ->> 'status' = 'done' and :'res'::jsonb ->> 'otp' = '123456' and (:'res'::jsonb ->> 'company_id')::uuid = :'co', 'the page gets its sign-in and the client''s company');
select t.ok(public.support_login_result((:'st'::jsonb ->> 'request')::uuid, :'st'::jsonb ->> 'secret') ->> 'otp' is null, 'the sign-in code is given once');
reset role;

-- back as it was
delete from app.local_tunnels where company_id = :'co';
delete from app.support_tickets where company_id = :'co';
update public.licenses set code = :'old_code', local_server_id = nullif(:'old_server', '')::uuid, deployment = :'old_dep' where company_id = :'co';
\set QUIET off
select count(*) as assertions_passed from t.results;
