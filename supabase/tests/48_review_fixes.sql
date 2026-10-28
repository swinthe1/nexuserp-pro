-- =============================================================================
-- DrisPRO · fixes from the review of every page (runs after 01–47, uses the demo market of 32)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

reset role;
select id as co from public.companies where name = 'Market Demo X' \gset
delete from public.company_account_defaults where company_id = :'co' and key = 'cit_expense';
select app.cit_compute(:'co', extract(year from current_date)::int) as cit \gset
select t.ok((:'cit'::jsonb ->> 'expenses')::numeric > 0, 'the profit tax counts the expenses also when no profit-tax account is set');
select t.ok((:'cit'::jsonb ->> 'profit')::numeric = (:'cit'::jsonb ->> 'revenue')::numeric - (:'cit'::jsonb ->> 'expenses')::numeric,
  'profit is income less expenses');

\set QUIET off
select count(*) as assertions_passed from t.results;
