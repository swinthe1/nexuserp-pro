-- =============================================================================
-- A new client's administrator: a user name and a PIN, the email only for contact.
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
set role authenticated;
select t.login('zoe@platform.io');

-- 1. user name + PIN, no email
select public.platform_create_client(jsonb_build_object('name', 'PIN Klient', 'country', 'XK', 'owner_name', 'Besnik Krasniqi',
  'owner_username', 'Besnik.K', 'owner_pin', '482913', 'business_type', 'retail')) as c1 \gset
select t.ok(public.platform_owner_login(:'c1') ->> 'username' = 'besnik.k' and (public.platform_owner_login(:'c1') ->> 'set_now')::boolean,
  'the administrator signs in as besnik.k, with the PIN given now');
reset role;
select t.ok((select p.email like 'u-%@pin.dris-ks.com' from app.user_logins l join public.profiles p on p.id = l.user_id where l.username = 'besnik.k'),
  'without an email the account gets one nobody writes to');
select t.ok(public.login_with_pin('besnik.k', '482913') ? 'request', 'and signs in with the user name and the PIN');

-- 2. with an email; a PIN too easy is refused and nothing is made
set role authenticated;
select t.login('zoe@platform.io');
select t.throws($$ select public.platform_create_client('{"name":"PIN Keq","country":"XK","owner_email":"keq@pin.xk","owner_username":"keq.pin","owner_pin":"111111"}') $$,
  'too easy', 'an easy PIN is refused');
select t.ok(not exists (select 1 from public.companies where name = 'PIN Keq'), 'and no company is left half made');
select t.throws($$ select public.platform_create_client('{"name":"Pa PIN","country":"XK","owner_email":"papin@pin.xk","owner_username":"pa.pin"}') $$,
  'Give a PIN too', 'a user name needs a PIN');
select public.platform_create_client(jsonb_build_object('name', 'PIN Klient 2', 'country', 'XK', 'owner_email', 'Arber@Klient.xk',
  'owner_username', 'arber', 'owner_pin', '730591')) as c2 \gset
select t.ok(public.platform_owner_login(:'c2') ->> 'username' = 'arber', 'with an email it works the same; the email is kept for contact');

-- 3. the same owner with a second business keeps the user name and PIN he has
select public.platform_create_client(jsonb_build_object('name', 'PIN Klient 3', 'country', 'XK', 'owner_email', 'arber@klient.xk',
  'owner_username', 'arber.tjeter', 'owner_pin', '914273')) as c3 \gset
select t.ok(public.platform_owner_login(:'c3') ->> 'username' = 'arber', 'an owner who signs in already keeps his user name');
reset role;
select t.ok(public.login_with_pin('arber', '730591') ? 'request', 'and his PIN');

-- 4. the user name must be free
set role authenticated;
select t.login('zoe@platform.io');
select t.throws($$ select public.platform_create_client('{"name":"PIN Dyfish","country":"XK","owner_username":"besnik.k","owner_pin":"602418"}') $$,
  'is taken', 'a user name in use is refused');
select t.login('nina@nobody.xk');
select t.throws(format($q$select public.platform_owner_login('%s')$q$, :'c1'), 'Only the platform administrator', 'only the platform sees it');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
