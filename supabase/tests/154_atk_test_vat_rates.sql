-- =============================================================================
-- ATK's test environment: the VAT rates tried in a company not registered for VAT. (after 153)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select fiscal_environment as env0, atk_test_vat as tv0 from public.company_settings where company_id = :'co' \gset
update public.company_settings set fiscal_environment = 'production', atk_test_vat = false where company_id = :'co';
set role authenticated;
select t.login(:'boss');
select t.throws(format('select public.atk_test_vat_set(%L, true)', :'co'), 'only in ATK', 'never in the real environment');
reset role;
update public.company_settings set fiscal_environment = 'test' where company_id = :'co';
set role authenticated;
select public.atk_test_vat_set(:'co', true);
select t.ok((public.atk_setup(:'co') ->> 'test_vat')::boolean, 'in the test environment it turns on');
select t.login('pronari@arberi.xk');
select t.throws(format('select public.atk_test_vat_set(%L, false)', :'co'), '', 'not for another company');
reset role;
select t.ok(exists (select 1 from public.atk_events where company_id = :'co' and kind = 'change' and details ->> 'what' = 'test_vat' and details ->> 'to' = 'true'),
  'the change is in the SEF log');
select t.ok(pg_get_functiondef('public.atk_till(uuid)'::regprocedure) like '%(s.atk_test_vat and s.fiscal_environment = ''test'')%', 'the till takes it only in the test environment');
update public.company_settings set fiscal_environment = :'env0', atk_test_vat = :'tv0' where company_id = :'co';
\set QUIET off
select count(*) as assertions_passed from t.results;
