-- =============================================================================
-- The errors people meet in the app: collected once a day, tokens taken out, read only by the platform
-- owner  (runs after 64 on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
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
select t.ok((public.platform_client_errors(7) -> 0 ->> 'people')::int = 2 and public.platform_client_errors(7) -> 0 ->> 'companies' = 'Kontrolle Test', 'the platform owner sees it, with the people and the company');
reset role;
select t.ok(to_regprocedure('public.mfa_status()') is null and to_regprocedure('app.mfa_ok()') is null, 'two-step verification is gone: the password alone signs in');

\set QUIET off
select count(*) as assertions_passed from t.results;
