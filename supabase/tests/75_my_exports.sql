-- =============================================================================
-- DrisPRO · "Eksportet e mia": each person sees only their own exports (runs after 69 "Agjent Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Agjent Test' \gset
set role authenticated;

select t.login('drita@agjent.xk');
select auth.uid() as drita \gset
insert into public.my_exports (company_id, file_name, kind, page, row_count, size_bytes, path)
  values (:'co', 'artikujt.xlsx', 'xlsx', '/inventory/items', 12, 3400, :'co' || '/' || :'drita' || '/x/artikujt.xlsx');
select t.ok((select count(*) = 1 from public.my_exports where file_name = 'artikujt.xlsx'), 'a person keeps a copy of what they exported');
select t.throws(format($q$insert into public.my_exports (company_id, file_name, kind, path) values (%L, 'a.csv', 'csv', %L)$q$, :'co', :'co' || '/someone-else/a.csv'),
                'row-level security', 'not into someone else''s folder');

select t.login('vesa@agjent.xk');
select t.ok((select count(*) = 0 from public.my_exports where file_name = 'artikujt.xlsx'), 'a colleague does not see them');
delete from public.my_exports where file_name = 'artikujt.xlsx';
reset role;
select t.ok((select count(*) = 1 from public.my_exports where file_name = 'artikujt.xlsx'), 'nor delete them');

\set QUIET off
select count(*) as assertions_passed from t.results;
