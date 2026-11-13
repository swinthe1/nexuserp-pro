-- =============================================================================
-- The platform adds a client's person with a user name and a PIN, and gives a new one. (on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select coalesce(max_users::text, '') as old_users from public.licenses where company_id = :'co' \gset
update public.licenses set max_users = 999 where company_id = :'co';
set role authenticated;
select t.login(:'boss');
select public.platform_member_create(:'co', 'Arta Prova', 'arta.prova161', '482913', array['pos_cashier']) as r \gset
select (:'r'::jsonb ->> 'member_id') as mem \gset
select t.ok((select status = 'active' from public.company_members where id = :'mem'), 'the person is in the company');
select t.ok((select count(*) = 1 from jsonb_array_elements(public.platform_client_detail(:'co') -> 'members') x where x ->> 'username' = 'arta.prova161'), 'the client''s people show the user name');
select t.throws(format($q$select public.platform_member_create(%L, 'Tjetër', 'ARTA.prova161', '573920', array['pos_cashier'])$q$, :'co'), 'is taken', 'a user name once');
select t.throws(format($q$select public.platform_member_create(%L, 'Tjetër', 'tjeter161', '123456', array['pos_cashier'])$q$, :'co'), 'too easy', 'no easy PIN');
select t.throws(format($q$select public.platform_member_create(%L, 'Tjetër', 'tjeter161', '573920', '{}')$q$, :'co'), 'at least one role', 'a role is needed');
reset role;
select t.ok((public.login_with_pin('arta.prova161', '482913') ->> 'error') is null, 'the person signs in with the user name and the PIN');
set role authenticated;
select t.login(:'boss');
select public.platform_member_login(:'mem', 'arta.prova161', '739204') as l \gset
reset role;
select t.ok((public.login_with_pin('arta.prova161', '739204') ->> 'error') is null, 'the new PIN opens');
select t.ok((public.login_with_pin('arta.prova161', '482913') ->> 'error') is not null, 'the old one does not');
-- one invited by email, never joined: gets an account with a user name and a PIN
insert into public.company_members (company_id, invited_email, status) values (:'co', 'ftuar161@example.com', 'invited') returning id as inv \gset
set role authenticated;
select t.login(:'boss');
select t.throws(format($q$select public.platform_member_login(%L, 'ftuar161', null)$q$, :'inv'), 'user name and a PIN', 'an invited person needs a PIN');
select public.platform_member_login(:'inv', 'ftuar161', '615283') as li \gset
select t.ok((select user_id is not null and status = 'active' from public.company_members where id = :'inv'), 'the invited person has an account now');
select t.login('pronari@arberi.xk');
select t.throws(format($q$select public.platform_member_create(%L, 'X', 'x161x', '573920', array['pos_cashier'])$q$, :'co'), '', 'only the platform adds this way');
select t.throws(format($q$select public.platform_member_login(%L, 'x161', '573920')$q$, :'mem'), '', 'or changes a PIN');
reset role;
update public.company_members set status = 'removed', deleted_at = now() where id in (:'mem', :'inv');
delete from app.user_logins where username in ('arta.prova161', 'ftuar161');
update public.licenses set max_users = nullif(:'old_users', '')::int where company_id = :'co';
\set QUIET off
select count(*) as assertions_passed from t.results;
