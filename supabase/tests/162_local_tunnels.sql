-- =============================================================================
-- The outside address of a local server: asked with the licence, made by the cloud's worker, handed over,
-- turned off and on by the platform. (on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select code as old_code, local_server_id as old_server, deployment as old_dep from public.licenses where company_id = :'co' \gset
update public.licenses set code = 'NXS-T162-T162-T162', local_server_id = '11111111-1111-1111-1111-111111111111', deployment = 'any' where company_id = :'co';
delete from app.local_tunnels where company_id = :'co';
set role anon;
select t.throws($q$select public.licence_tunnel('NXS-T162-T162-T162', '22222222-2222-2222-2222-222222222222')$q$, 'another server', 'only the licence''s own server asks');
select public.licence_tunnel('NXS-T162-T162-T162', '11111111-1111-1111-1111-111111111111') as r \gset
select t.ok(:'r'::jsonb ->> 'status' = 'pending' and :'r'::jsonb ->> 'hostname' like 'kontrolle-test%.dris-ks.com', 'the first ask: an address being made, from the company''s name');
select t.throws('select public.postier_tunnel_claim()', '', 'only the server''s worker takes the work');
reset role;
select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false);
-- the worker, with Cloudflare set
insert into app.server_secrets (key, value) values ('cf_api_token', 'x162') on conflict (key) do nothing;
select t.ok((select count(*) = 1 from jsonb_array_elements(public.postier_tunnel_claim() -> 'jobs') j where j ->> 'company_id' = :'co'), 'the worker sees it');
select public.postier_tunnel_done(:'co', true, 'tid162', 'token162');
set role anon;
select public.licence_tunnel('NXS-T162-T162-T162', '11111111-1111-1111-1111-111111111111') as r2 \gset
select t.ok(:'r2'::jsonb ->> 'status' = 'ready' and :'r2'::jsonb ->> 'token' = 'token162' and :'r2'::jsonb ->> 'url' like 'https://kontrolle-test%', 'the next ask gets the key and the address');
reset role;
select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false);
set role authenticated;
select t.login(:'boss');
select t.ok((select count(*) = 1 from jsonb_array_elements(public.platform_tunnels() -> 'tunnels') x where x ->> 'company_id' = :'co' and x ->> 'status' = 'ready'), 'the platform sees it working');
select public.platform_tunnel_set(:'co', false);
reset role;
select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false);
select t.ok((select status = 'remove' and token is null from app.local_tunnels where company_id = :'co'), 'turned off: to be removed, the key gone');
set role anon;
select t.ok(public.licence_tunnel('NXS-T162-T162-T162', '11111111-1111-1111-1111-111111111111') ->> 'status' = 'off', 'the server is told to stop it');
reset role;
select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false);
select public.postier_tunnel_done(:'co', true);
select t.ok((select status = 'off' and tunnel_id is null from app.local_tunnels where company_id = :'co'), 'removed by the worker');
set role authenticated;
select t.login(:'boss');
select public.platform_tunnel_set(:'co', true);
reset role;
select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false);
select t.ok((select status = 'requested' from app.local_tunnels where company_id = :'co'), 'turned on again: made again');
-- the worker failing eight times: failed, asked again after an hour
update app.local_tunnels set attempts = 7 where company_id = :'co';
select public.postier_tunnel_done(:'co', false, null, null, 'Cloudflare: 403');
select t.ok((select status = 'failed' and error like '%403%' from app.local_tunnels where company_id = :'co'), 'eight failures: failed, with the reason');
set role authenticated;
select t.login('pronari@arberi.xk');
select t.throws('select public.platform_tunnels()', '', 'only the platform sees the addresses');
select t.throws(format('select public.platform_tunnel_set(%L, false)', :'co'), '', 'or turns one off');
reset role;
select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false);
delete from app.local_tunnels where company_id = :'co';
delete from app.server_secrets where key = 'cf_api_token' and value = 'x162';
update public.licenses set code = :'old_code', local_server_id = nullif(:'old_server', '')::uuid, deployment = :'old_dep' where company_id = :'co';
\set QUIET off
select count(*) as assertions_passed from t.results;
