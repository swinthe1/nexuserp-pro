-- =============================================================================
-- Every client its own address (<name>.drispro.com); app.drispro.com is the platform's only, and a company's
-- address lets in only that company's people. (on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false), set_config('request.headers', '{}', false);
select id as co, app_slug as slug from public.companies where name = 'Kontrolle Test' \gset
select t.ok(:'slug' like 'kontrolle-test%', 'a client with a licence has its address, from its name');
select t.ok((select count(*) = 0 from public.companies c where c.deleted_at is null and c.app_slug is null and exists (select 1 from public.licenses l where l.company_id = c.id)),
  'every client with a licence has one');
select t.ok((select count(distinct app_slug) = count(app_slug) from public.companies), 'no two clients share one');
select m.user_id as worker from public.company_members m where m.company_id = :'co' and m.status = 'active' and m.deleted_at is null
   and not coalesce((select is_super_admin from public.profiles p where p.id = m.user_id), false) limit 1 \gset
select app.set_user_login(:'worker', 'taddr165', '482619', null);
-- someone of another company, to try the wrong address
select c.app_slug as other from public.companies c where c.app_slug is not null and c.id <> :'co'
   and not exists (select 1 from public.company_members m where m.company_id = c.id and m.user_id = :'worker') limit 1 \gset

set role anon;
select t.ok(public.company_by_host('app.drispro.com') ->> 'kind' = 'platform', 'app.drispro.com is the platform''s');
select t.ok(public.company_by_host(:'slug' || '.drispro.com') ->> 'name' = 'Kontrolle Test', 'a company''s address says whose it is');
select t.ok(public.company_by_host('nobody-here.drispro.com') ->> 'kind' = 'unknown' and public.company_by_host('192.168.1.20') ->> 'kind' = 'other', 'an unknown name, a local address');
select set_config('request.headers', '{"origin":"https://app.drispro.com"}', false);
select public.login_with_pin('taddr165', '482619') as r1 \gset
select t.ok(:'r1'::jsonb ->> 'error' = 'Sign in at your company''s address' and :'r1'::jsonb ->> 'company_url' = 'https://' || :'slug' || '.drispro.com',
  'at app.drispro.com a client''s person is sent to the company''s address');
select set_config('request.headers', json_build_object('origin', 'https://' || :'other' || '.drispro.com')::text, false);
select t.ok(public.login_with_pin('taddr165', '482619') ->> 'error' = 'Wrong user name or PIN', 'another company''s address does not let them in');
select set_config('request.headers', json_build_object('origin', 'https://' || :'slug' || '.drispro.com')::text, false);
select t.ok(public.login_with_pin('taddr165', '482619') ? 'request', 'their company''s address does');
select set_config('request.headers', '{"origin":"http://192.168.100.150:8080"}', false);
select t.ok(public.login_with_pin('taddr165', '482619') ? 'request', 'a local server''s own address too');
reset role;
delete from app.user_logins where user_id = :'worker' and username = 'taddr165';
select set_config('request.headers', '{}', false);
\set QUIET off
select count(*) as assertions_passed from t.results;
