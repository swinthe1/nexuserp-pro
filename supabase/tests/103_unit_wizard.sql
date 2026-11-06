-- =============================================================================
-- "Njësi e re" in one step: the unit, its places, its tills and where its goods come from; each unit on the dashboard  (after 101)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Lidhja Market' \gset
select id as depo from public.warehouses where company_id = :'co' and code = 'DEPO' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
-- the company needs a cash box for the tills
insert into public.bank_accounts (company_id, name, account_kind, currency_code, account_id)
select :'co', 'Sirtarët e arkave', 'cash', 'EUR', id from public.accounts where company_id = :'co' and code = '5311';
set role authenticated;
select t.login(:'boss');

select public.unit_create(jsonb_build_object('company_id', :'co', 'kind', 'restaurant', 'name', 'Extra Grill', 'code', 'exg', 'city', 'Drenas',
  'atk_branch_id', '7', 'tills', 2, 'supplied_from_id', :'depo')) as r \gset
reset role;
select (:'r'::jsonb ->> 'id') as grill \gset
select t.ok((select code = 'EXG' and warehouse_type = 'store' and city = 'Drenas' and atk_branch_id = 7 and supplied_from_id = :'depo'
               from public.warehouses where id = :'grill'), 'the unit with its code, town, number at ATK and the unit that supplies it');
select t.ok((select count(*) from public.warehouse_locations where warehouse_id = :'grill') = 3, 'its places');
select t.ok((select count(*) = 2 and bool_and(mode = 'restaurant') and bool_and(location_id is not null and cash_account_id is not null)
               from public.pos_registers where warehouse_id = :'grill'), 'two restaurant tills, ready to sell');
select t.ok((:'r'::jsonb -> 'tills') = '["EXG-1", "EXG-2"]'::jsonb, 'their codes come back');

set role authenticated;
select t.login(:'boss');
select public.unit_create(jsonb_build_object('company_id', :'co', 'kind', 'warehouse', 'name', 'Depo e dytë', 'code', 'D2', 'tills', 3)) as r2 \gset
reset role;
select t.ok((select count(*) from public.pos_registers where warehouse_id = (:'r2'::jsonb ->> 'id')::uuid) = 0, 'a warehouse gets no tills');
set role authenticated;
select t.login(:'boss');
select t.throws(format($q$select public.unit_create(jsonb_build_object('company_id', %L, 'kind', 'store', 'name', '', 'code', 'X'))$q$, :'co'), 'Write the name', 'a unit needs a name');
select t.throws(format($q$select public.unit_create(jsonb_build_object('company_id', %L, 'kind', 'casino', 'name', 'X', 'code', 'X'))$q$, :'co'), 'Unknown kind', 'and a kind we know');
reset role;

-- each unit at a glance on the dashboard
set role authenticated;
select t.login(:'boss');
select public.units_today(:'co') as today \gset
reset role;
select t.ok((select (x ->> 'tills')::int = 2 and (x ->> 'tills_open')::int = 0 and (x ->> 'sales_today')::numeric = 0
               from jsonb_array_elements(:'today'::jsonb) x where x ->> 'code' = 'EXG'), 'the dashboard shows each unit with its tills and sales');
select t.ok(jsonb_array_length(:'today'::jsonb) = (select count(*) from public.warehouses where company_id = :'co' and is_active and deleted_at is null and warehouse_type <> 'transit'),
            'every active unit, no transit');

\set QUIET off
select count(*) as assertions_passed from t.results;
