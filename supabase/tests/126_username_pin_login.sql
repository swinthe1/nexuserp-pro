-- =============================================================================
-- Signing in with a user name and a PIN, no email: the owner makes the person, the PIN is checked
-- and locked after wrong tries, the owner gives a new one, the person changes their own.
-- (after 122, on "Tatim Test" where alice is the owner)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Tatim Test' \gset

-- 1. the owner adds a person: name, user name, PIN, role; no email
set role authenticated;
select t.login('alice@alba.al');
select t.throws(format($q$select public.company_user_create(%L, 'Arta Gashi', 'arta.gashi', '123456', array['pos_cashier'])$q$, :'co'), 'too easy', 'a run of digits is refused');
select t.throws(format($q$select public.company_user_create(%L, 'Arta Gashi', 'arta.gashi', '1234', array['pos_cashier'])$q$, :'co'), '6 digits', 'so is a short PIN');
select t.throws(format($q$select public.company_user_create(%L, 'Arta Gashi', 'A', '482915', array['pos_cashier'])$q$, :'co'), 'user name is 3 to 30', 'and a user name too short');
select public.company_user_create(:'co', 'Arta Gashi', 'Arta.Gashi', '482915', array['pos_cashier']) as mem \gset
select t.ok((select status = 'active' and user_id is not null from public.company_members where id = :'mem'), 'the person is in the company at once');
select t.ok((select username = 'arta.gashi' from public.member_extras(:'co') where member_id = :'mem'), 'with the user name in small letters');
select t.throws(format($q$select public.company_user_create(%L, 'Arta Tjetër', 'arta.gashi', '583926', array['pos_cashier'])$q$, :'co'), 'is taken', 'a user name is one person''s only');
reset role;
select t.ok((select email like '%@pin.dris-ks.com' from auth.users where id = (select user_id from public.company_members where id = :'mem')), 'the account''s address is one nobody writes to');

-- 2. signing in: a wrong PIN and a wrong name look the same; the right one opens a sign-in
set role anon;
select t.ok(public.login_with_pin('nobody.here', '482915') ->> 'error' = 'Wrong user name or PIN', 'an unknown name');
select t.ok(public.login_with_pin('arta.gashi', '000001') ->> 'error' = 'Wrong user name or PIN', 'a wrong PIN, the same answer');
select public.login_with_pin(' ARTA.GASHI ', '482915') as ok \gset
reset role;
select t.ok(:'ok'::jsonb ? 'request' and exists (select 1 from app.pin_logins where id = (:'ok'::jsonb ->> 'request')::uuid and device_id is null and status = 'queued'),
            'the right PIN starts the sign-in, from no particular device');

-- 3. five wrong tries lock the name; the owner's new PIN opens it again
set role anon;
select public.login_with_pin('arta.gashi', '111112') from generate_series(1, 4);
select t.ok(public.login_with_pin('arta.gashi', '111112') ->> 'error' like 'Too many wrong PINs%', 'the fifth wrong PIN locks it');
select t.ok(public.login_with_pin('arta.gashi', '482915') ->> 'error' like 'Too many wrong PINs%', 'even the right PIN waits');
reset role;
set role authenticated;
select t.login('alice@alba.al');
select public.member_login_set(:'mem', null, '739154');
reset role;
set role anon;
select t.ok(public.login_with_pin('arta.gashi', '739154') ? 'request', 'the new PIN works at once');
reset role;

-- 4. the person changes their own PIN with the present one
select u.email as arta from auth.users u join public.company_members m on m.user_id = u.id where m.id = :'mem' \gset
set role authenticated;
select t.login(:'arta');
select t.throws($q$select public.my_login_set('arta.gashi', '615283', '000000')$q$, 'present PIN', 'not without the present PIN');
select public.my_login_set('arta.gashi', '615283', '739154');
select t.ok((public.my_login() ->> 'username') = 'arta.gashi', 'and they see their user name');
reset role;
set role anon;
select t.ok(public.login_with_pin('arta.gashi', '615283') ? 'request', 'the changed PIN opens it');
reset role;

-- 5. someone who left no longer gets in
update public.company_members set status = 'suspended' where id = :'mem';
set role anon;
select t.ok(public.login_with_pin('arta.gashi', '615283') ->> 'error' = 'This user has no access to any company any more', 'suspended: no way in');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
