-- =============================================================================
-- NexusERP Pro · Phase 10 tests: clients created by the platform owner, licences (runs after 01–12)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

update public.platform_settings set self_service = false;
insert into auth.users (email, raw_user_meta_data) values ('nina@nobody.xk', '{"full_name":"Nina Nobody"}');

set role authenticated;
-- closed mode: ordinary people cannot open companies
select t.login('nina@nobody.xk');
select t.throws($$ select public.create_company('Nina Shop', 'XK') $$, 'Only the platform administrator', 'ordinary users cannot create companies');
select t.ok(not (public.get_my_context() ->> 'self_service')::boolean, 'the app is told sign-up is closed');
select t.throws($$ select public.platform_clients() $$, 'Only the platform administrator', 'only the platform owner lists clients');
select t.throws($$ select public.platform_create_client('{"name":"X","owner_email":"x@x.xk","owner_password":"12345678"}') $$, 'Only the platform administrator', 'only the platform owner creates clients');

-- the platform owner creates a client with its admin and a 2-user licence
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object(
  'name', 'Klienti Drita', 'country', 'XK', 'tax_number', '811223344',
  'owner_email', 'Olga@Drita.xk', 'owner_name', 'Olga Drita', 'owner_password', 'sekret123',
  'plan', 'standard', 'max_users', 2, 'valid_until', (current_date + 30)::text, 'notes', 'Contract 2026-07')) as drita \gset
select t.ok((select country_code from public.companies where id = :'drita') = 'XK', 'client company created in Kosovo');
select t.ok((select base_currency from public.companies where id = :'drita') = 'EUR', 'Kosovo clients work in euro');
select t.ok(exists (select 1 from public.profiles where email = 'olga@drita.xk'), 'the client admin account exists (email stored in lower case)');
select t.ok((select full_name from public.profiles where email = 'olga@drita.xk') = 'Olga Drita', 'the admin''s name is kept');
select t.ok(not exists (select 1 from public.company_members m join public.profiles p on p.id = m.user_id
                         where m.company_id = :'drita' and p.email = 'zoe@platform.io'), 'the platform owner is not a member of the client');
select t.ok((select jsonb_array_length(public.platform_clients() -> 'clients')) >= 1, 'the client list is available to the platform owner');
select t.ok((select c ->> 'users' from jsonb_array_elements(public.platform_clients() -> 'clients') c where c ->> 'id' = :'drita') = '1', 'one seat used');
select t.ok((select c -> 'admins' ->> 0 from jsonb_array_elements(public.platform_clients() -> 'clients') c where c ->> 'id' = :'drita') = 'olga@drita.xk', 'the client admin is listed');
select t.throws($$ select public.platform_create_client(jsonb_build_object('name','Copy','country','XK','tax_number','811223344','owner_email','copy@drita.xk','owner_password','sekret123')) $$,
  'already exists', 'the same tax number cannot be registered twice');
select t.throws($$ select public.platform_create_client(jsonb_build_object('name','Short','country','XK','owner_email','short@pw.xk','owner_password','123')) $$,
  'at least 8 characters', 'new accounts need a proper password');
select t.ok(exists (select 1 from public.companies where id = :'drita'), 'the platform owner reaches every company');

-- the client admin works inside the licence
select t.login('olga@drita.xk');
select t.ok((public.get_my_context() -> 'companies' -> 0 ->> 'id') = :'drita', 'the client admin sees the company');
select t.ok((public.get_my_context() -> 'companies' -> 0 -> 'license' ->> 'max_users') = '2', 'the app gets the licence details');
select t.ok(exists (select 1 from public.warehouses where company_id = :'drita'), 'company defaults were set up');
select t.ok((select count(*) from public.licenses) = 1 and (select plan from public.licenses) = 'standard', 'the client reads only its own licence');
select t.throws($$ select notes from public.licenses $$, 'permission denied', 'internal licence notes stay private');
select t.throws($$ update public.licenses set max_users = 99 $$, 'permission denied', 'clients cannot change their licence');
select public.invite_member(:'drita', 'arben@drita.xk', array['cashier']);
select t.throws($$ select public.invite_member('$$ || :'drita' || $$', 'blerta@drita.xk', array['cashier']) $$, 'licence allows 2 users', 'invitations stop at the user limit');
select t.throws($$ select public.create_company('Second', 'XK') $$, 'Only the platform administrator', 'client admins cannot open more companies');

-- sign-up through the auth service: only invited emails
reset role;
select t.ok(app.signup_allowed('ARBEN@drita.xk'), 'an invited email may sign up');
select t.ok(not app.signup_allowed('stranger@web.xk'), 'an unknown email may not');
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
end $$;
grant usage on schema auth to supabase_auth_admin;
grant insert, select on auth.users to supabase_auth_admin;
grant usage on schema t to supabase_auth_admin;
grant execute on all functions in schema t to supabase_auth_admin;
grant insert, select on t.results to supabase_auth_admin;
grant usage on sequence t.results_n_seq to supabase_auth_admin;
set session authorization supabase_auth_admin;
select t.throws($$ insert into auth.users (email) values ('stranger@web.xk') $$, 'invitation only', 'the auth service cannot create uninvited accounts');
insert into auth.users (email) values ('arben@drita.xk');
reset session authorization;
select t.ok((select status from public.company_members where invited_email = 'arben@drita.xk') = 'active', 'the invited person joins on sign-up');

-- licence ends: the client loses access, the data stays, the platform owner still gets in
set role authenticated;
select t.login('zoe@platform.io');
select public.platform_save_license(:'drita', 'standard', 2, current_date - 60, current_date - 1, 'active', 'expired');
select t.login('olga@drita.xk');
select t.ok(jsonb_array_length(public.get_my_context() -> 'companies') = 0, 'expired: the company disappears for its users');
select t.ok((public.get_my_context() -> 'blocked' -> 0 ->> 'reason') = 'expired', 'expired: the app is told why');
select t.ok(not exists (select 1 from public.warehouses where company_id = :'drita'), 'expired: no data can be read');
select t.throws($$ select public.invite_member('$$ || :'drita' || $$', 'c@drita.xk', array['cashier']) $$, 'Permission denied', 'expired: nothing can be changed');
select t.login('zoe@platform.io');
select t.ok(exists (select 1 from public.warehouses where company_id = :'drita'), 'expired: the data is kept and the platform owner sees it');
select public.platform_save_license(:'drita', 'standard', 2, current_date - 60, current_date + 365, 'suspended', null);
select t.login('olga@drita.xk');
select t.ok((public.get_my_context() -> 'blocked' -> 0 ->> 'reason') = 'suspended', 'suspended: the app is told why');
select t.login('zoe@platform.io');
select public.platform_save_license(:'drita', 'pro', 3, current_date - 60, current_date + 365, 'active', null);
select t.login('olga@drita.xk');
select t.ok((public.get_my_context() -> 'companies' -> 0 -> 'license' ->> 'plan') = 'pro', 'renewed: access comes back');
select public.invite_member(:'drita', 'blerta@drita.xk', array['cashier']);
select t.ok((select count(*) from public.company_members where company_id = :'drita' and deleted_at is null) = 3, 'a bigger licence allows more users');

-- forgotten password and self-service switch are for the platform owner only
select t.throws($$ select public.platform_set_password('olga@drita.xk', 'newpass123') $$, 'Only the platform administrator', 'clients cannot reset passwords');
select t.login('zoe@platform.io');
select public.platform_set_password('olga@drita.xk', 'newpass123');
select t.throws($$ select public.platform_set_password('ghost@drita.xk', 'newpass123') $$, 'No account', 'unknown accounts are reported');
select public.platform_set_self_service(true);
select t.ok((public.platform_clients() ->> 'self_service')::boolean, 'self-service can be switched on');
select public.platform_set_self_service(false);
reset role;

-- simpler menu: personal favourites kept beside other preferences; company hides unused parts
set role authenticated;
select t.login('olga@drita.xk');
update public.profiles set locale = 'en' where id = auth.uid();
select public.save_my_preference('nav_favourites', '["/pos", "/sales/invoices"]');
select t.ok((select preferences -> 'nav_favourites' ->> 0 from public.profiles where id = auth.uid()) = '/pos', 'favourites are saved');
select t.ok((select (preferences ->> 'locale_chosen')::boolean from public.profiles where id = auth.uid()), 'other preferences are kept');
select t.throws($$ select public.save_my_preference('Bad Key!', '1') $$, 'Unknown preference', 'only simple preference names');
update public.company_settings set hidden_menu_sections = array['Manufacturing'] where company_id = :'drita';
select t.ok((select hidden_menu_sections from public.company_settings where company_id = :'drita') = array['Manufacturing'], 'the company admin hides unused menu parts');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
