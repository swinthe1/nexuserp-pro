-- =============================================================================
-- A new product's number: the next after the company's highest numeric code; 1001 when it has none. (after 150, Kontrolle Test)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select coalesce(max(code::bigint), 1000) + 1 as want from public.products where company_id = :'co' and code ~ '^[0-9]{1,12}$' \gset
set role authenticated;
select t.login(:'boss');
select t.ok(public.product_next_code(:'co') = :'want', 'the next number comes after the highest numeric code (letters in other codes do not count)');
select t.login('pronari@arberi.xk');
select t.throws(format('select public.product_next_code(%L)', :'co'), '', 'not for another company');
reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
