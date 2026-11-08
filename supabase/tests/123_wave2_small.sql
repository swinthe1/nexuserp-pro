-- =============================================================================
-- Wave 2 of the audit, part 1: the year-end list also asks for the yearly count and the partners'
-- balances. (after 28 on "Tatim Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select fy.id as fy from public.fiscal_years fy join public.companies c on c.id = fy.company_id where c.name = 'Tatim Test' order by fy.start_date limit 1 \gset
set role authenticated;
select t.login('alice@alba.al');
select public.year_end_check(:'fy') as y \gset
select t.ok((select count(*) from jsonb_array_elements(:'y'::jsonb -> 'checks') c where c ->> 'key' in ('stock_count', 'partner_balances')) = 2,
            'the year-end list has the yearly count and the partners'' balances');
select t.ok(not exists (select 1 from jsonb_array_elements(:'y'::jsonb -> 'checks') c where c ->> 'key' in ('stock_count', 'partner_balances') and (c ->> 'block')::boolean),
            'both are reminders: they do not stop the closing');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
