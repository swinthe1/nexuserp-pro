-- =============================================================================
-- A local server's health: its report every 5 minutes, a part down, silent for 10 minutes, back again; each
-- change kept and told to the Super Admins once. (on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false), set_config('request.headers', '{}', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select code as old_code, coalesce(local_server_id::text, '') as old_server from public.licenses where company_id = :'co' \gset
update public.licenses set code = 'NXS-T166-T166-T166', local_server_id = '11111111-1111-1111-1111-111111111166' where company_id = :'co';
delete from app.server_health where company_id = :'co';
select count(*) as n0 from public.notifications where company_id = :'co' and title like 'Server %' \gset

set role anon;
select t.throws($q$select public.licence_health('NXS-T166-T166-T166', '22222222-2222-2222-2222-222222222222', '{}')$q$, '', 'only the licence''s own server reports');
select public.licence_health('NXS-T166-T166-T166', '11111111-1111-1111-1111-111111111166', '{"services":{"database":true,"sign_in":true,"files":true},"db_mb":120}');
reset role;
select t.ok((select state = 'ok' and db_mb = 120 from app.server_health where company_id = :'co'), 'a server that works is kept as working');
select t.ok((select count(*) from public.notifications where company_id = :'co' and title like 'Server %') = :n0, 'nothing is told while it works');
set role anon;
select public.licence_health('NXS-T166-T166-T166', '11111111-1111-1111-1111-111111111166', '{"services":{"database":true,"sign_in":true,"files":false}}');
select public.licence_health('NXS-T166-T166-T166', '11111111-1111-1111-1111-111111111166', '{"services":{"database":true,"sign_in":true,"files":false}}');
reset role;
select t.ok((select state = 'warn' and down = '{files}' from app.server_health where company_id = :'co'), 'a part down: the server has a problem, which part');
select t.ok((select count(*) from public.notifications where company_id = :'co' and title = 'Server has a problem: Kontrolle Test')
  = (select count(*) from public.profiles where is_super_admin), 'every Super Admin is told once, not at every report');
-- silent for more than 10 minutes
update app.server_health set seen_at = now() - interval '11 minutes' where company_id = :'co';
select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false);
select public.postier_health_watch() as watched \gset
select t.ok(:watched >= 1 and (select state = 'silent' from app.server_health where company_id = :'co'), 'silent for 10 minutes: the cloud notices by itself');
select t.ok(public.postier_health_watch() = 0, 'and says it once');
set role anon;
select public.licence_health('NXS-T166-T166-T166', '11111111-1111-1111-1111-111111111166', '{"services":{"database":true,"sign_in":true,"files":true}}');
reset role;
select t.ok((select state = 'ok' from app.server_health where company_id = :'co')
  and exists (select 1 from public.notifications where company_id = :'co' and title = 'Server works again: Kontrolle Test'), 'back again: told too');
set role authenticated;
select t.login(:'boss');
select public.platform_server_health(:'co') as ph \gset
select t.ok(jsonb_array_length(:'ph'::jsonb -> 'events') = 3 and (:'ph'::jsonb ->> 'down_minutes')::int >= 0, 'the Platform sees the changes and the minutes down');
select t.login('pronari@arberi.xk');
select t.throws('select public.platform_server_health()', '', 'only the Platform');
reset role;
delete from public.notifications where company_id = :'co' and title like 'Server %';
delete from app.server_health_events where company_id = :'co';
delete from app.server_health where company_id = :'co';
update public.licenses set code = :'old_code', local_server_id = nullif(:'old_server', '')::uuid where company_id = :'co';
\set QUIET off
select count(*) as assertions_passed from t.results;
