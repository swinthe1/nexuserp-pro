-- =============================================================================
-- The deep check, phase 3: two-step verification. With it turned on, the password alone reaches no
-- company's data, and not the platform either  (runs after 64 on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select id as besa from auth.users where email = 'besa@kt.al' \gset
select id as boss_id from auth.users where email = :'boss' \gset
set role authenticated;

select t.login('besa@kt.al');
select t.ok(:'co' = any (app.company_ids_with('pos.read')), 'without two-step verification the password is enough, as before');
select t.ok(not (public.mfa_status() ->> 'enabled')::boolean and (public.mfa_status() ->> 'verified')::boolean, 'nothing to type');

reset role;
insert into auth.mfa_factors (user_id, friendly_name, status) values (:'besa', 'Telefoni', 'verified');
set role authenticated;
select t.login('besa@kt.al');
select t.ok(cardinality(app.company_ids_with('pos.read')) = 0 and cardinality(app.my_company_ids()) = 0, 'turned on: the password alone reaches no company');
select t.ok((public.mfa_status() ->> 'enabled')::boolean and not (public.mfa_status() ->> 'verified')::boolean, 'the app is told a code is due');
select t.ok((select count(*) from public.pos_sessions) = 0, 'not a row of the till');
select set_config('request.jwt.claims', '{"aal": "aal2"}', false);
select t.ok(:'co' = any (app.company_ids_with('pos.read')) and (public.mfa_status() ->> 'verified')::boolean, 'with the code typed, everything as before');
select set_config('request.jwt.claims', '', false);

-- the platform owner
reset role;
insert into auth.mfa_factors (user_id, friendly_name, status) values (:'boss_id', 'Telefoni', 'unverified');
set role authenticated;
select t.login(:'boss');
select t.ok(app.is_super_admin() and (public.mfa_status() ->> 'required')::boolean, 'the platform owner is asked to turn it on; a factor not yet confirmed changes nothing');
reset role;
update auth.mfa_factors set status = 'verified' where user_id = :'boss_id';
set role authenticated;
select t.login(:'boss');
select t.ok(not app.is_super_admin() and cardinality(app.my_company_ids()) = 0, 'once on, the platform too waits for the code');
select t.throws($q$select public.mfa_reset_user('besa@kt.al')$q$, 'Only the platform owner', 'and cannot reset anyone with the password alone');
select set_config('request.jwt.claims', '{"aal": "aal2"}', false);
select t.ok(app.is_super_admin(), 'with the code, the platform owner again');
select t.ok(public.mfa_reset_user('besa@kt.al') = 1, 'a lost phone: the platform owner removes the factor');
select t.login('besa@kt.al');
select set_config('request.jwt.claims', '', false);
select t.ok(:'co' = any (app.company_ids_with('pos.read')), 'and the password works again until a new one is set up');
reset role;
delete from auth.mfa_factors where user_id = :'boss_id';
select set_config('request.jwt.claims', '', false);

-- ---------------------------------------------------------------- the errors people meet in the app
set role authenticated;
select t.login('cora@kt.al');
select public.report_client_error(jsonb_build_object('kind', 'page', 'message', 'Cannot read properties of undefined (reading ''x'') at row 12',
  'stack', E'TypeError\n    at Till (till-page.tsx:120)', 'url', 'https://erp.dris-ks.com/pos?access_token=eyJabcdefghij.klmnopqrstuv.wxyz0123456789', 'version', '1.86.0', 'company_id', :'co'));
select public.report_client_error(jsonb_build_object('kind', 'page', 'message', 'Cannot read properties of undefined (reading ''x'') at row 13',
  'stack', E'TypeError\n    at Till (till-page.tsx:120)', 'version', '1.86.0'));
select t.login('besa@kt.al');
select public.report_client_error(jsonb_build_object('kind', 'page', 'message', 'Cannot read properties of undefined (reading ''x'') at row 14', 'stack', E'TypeError\n    at Till (till-page.tsx:120)'));
select t.throws($q$select public.platform_client_errors(7)$q$, 'Only the platform owner', 'only the platform owner reads them');
select t.throws($q$select count(*) from public.client_errors$q$, 'permission denied', 'nobody reads the table straight');
reset role;
select t.ok((select count(*) from public.client_errors) = 1 and (select count from public.client_errors) = 3 and (select cardinality(users) from public.client_errors) = 2,
  'the same error: one row, met 3 times by 2 people');
select t.ok((select url from public.client_errors) like '%access_token=[hidden]%' and (select url from public.client_errors) not like '%eyJ%', 'the token in the address is taken out');
set role authenticated;
select t.login(:'boss');
select set_config('request.jwt.claims', '{"aal": "aal2"}', false);
select t.ok((public.platform_client_errors(7) -> 0 ->> 'people')::int = 2 and public.platform_client_errors(7) -> 0 ->> 'companies' = 'Kontrolle Test', 'the platform owner sees it, with the people and the company');
select set_config('request.jwt.claims', '', false);
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
