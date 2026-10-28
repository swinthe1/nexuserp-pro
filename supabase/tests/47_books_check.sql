-- =============================================================================
-- DrisPRO · the books check: what slipped through (runs after 01–46, uses the demo market of 32)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

reset role;
select id as co from public.companies where name = 'Market Demo X' \gset
-- the same business entered twice
insert into public.business_partners (company_id, code, name, kind, is_customer, tax_number) values
  (:'co', 'DUP1', 'Dyfish SH.P.K.', 'company', true, '811999001'), (:'co', 'DUP2', 'Dyfish shpk', 'company', true, '811999001');

set role authenticated;
select t.login('demo@market-test.com');
select public.books_check(:'co') as f \gset
select t.ok(jsonb_typeof(:'f'::jsonb) = 'array', 'the check gives a list');
select t.ok(:'f'::jsonb @> '[{"code":"duplicate_nui","count":1}]', 'one NUI on two partners is found');
select t.ok((select x -> 'items' -> 0 ->> 'label' from jsonb_array_elements(:'f'::jsonb) x where x ->> 'code' = 'duplicate_nui') like 'Dyfish SH.P.K. · Dyfish shpk',
  'with both names');
select t.ok((select bool_and((x ->> 'count')::int >= jsonb_array_length(x -> 'items') and jsonb_array_length(x -> 'items') <= 5) from jsonb_array_elements(:'f'::jsonb) x),
  'counts and at most five examples');
select t.login('bob@kosova.xk');
select t.throws(format($q$select public.books_check(%L)$q$, :'co'), 'Permission denied', 'another company cannot look');
reset role;

-- the morning notice
select public.run_daily_reminders() \gset
select t.ok(exists (select 1 from public.notifications where company_id = :'co' and link = '/check' and title like '% things to check in the books'),
  'every morning the accountant is told what waits');

\set QUIET off
select count(*) as assertions_passed from t.results;
