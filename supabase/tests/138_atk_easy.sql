-- =============================================================================
-- Making a computer a till at ATK: the numbers are given by the program, a taken one is replaced by itself,
-- and a till can be added on the spot. (after 137, on "SEF Test": till A2 has number 2 of store 3, taken at ATK)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'SEF Test' and tax_number = '810123456' \gset
select id as reg2, warehouse_id as wh from public.pos_registers where company_id = :'co' and code = 'A2' \gset
-- a second store, with a shelf and no ATK number yet
insert into public.warehouses (company_id, code, name, warehouse_type) values (:'co', 'S2', 'Dyqani 2', 'store') returning id as wh2 \gset
insert into public.warehouse_locations (company_id, warehouse_id, code, name, location_type) values (:'co', :'wh2', 'S2/STOCK', 'Rafti', 'internal');

set role authenticated;
select t.login('lume@atk.al');
-- 1. the taken number is replaced by the next free one, by itself
select public.atk_till_prepare(:'reg2') as p \gset
select t.ok((:'p'::jsonb ->> 'pos')::int <> 2 and (:'p'::jsonb ->> 'replaced')::int = 2 and (:'p'::jsonb ->> 'branch')::int = 3, 'number 2 was taken at ATK: the till gets a free one');
select t.ok(public.atk_till_prepare(:'reg2') ->> 'replaced' is null, 'asked again, nothing changes');

-- 2. a new till in a store without an ATK number: both numbers come by themselves
select public.atk_till_new(:'wh2', 'Arka e re') as nt \gset
select public.atk_till_prepare(:'nt') as p2 \gset
reset role;
select t.ok((:'p2'::jsonb ->> 'branch')::int is not null and (:'p2'::jsonb ->> 'branch')::int <> 3 and (:'p2'::jsonb ->> 'pos')::int = 1,
  'the new store takes a free store number and its first till number 1');
select t.ok((select location_id is not null and cash_account_id is not null and code like 'A%' from public.pos_registers where id = :'nt'), 'the till has its shelf, its cash account and a code');
select t.ok(not exists (select 1 from public.pos_registers r join public.warehouses w on w.id = r.warehouse_id where r.company_id = :'co' and r.deleted_at is null
                          group by w.atk_branch_id, r.atk_pos_id having count(*) > 1 and r.atk_pos_id is not null), 'no two tills of a store share a number');

-- 3. only someone who registers tills
set role authenticated;
select t.login('cora@kt.al');
select t.throws(format($q$select public.atk_till_prepare('%s')$q$, :'reg2'), 'store manager', 'someone else cannot');
select t.throws(format($q$select public.atk_till_new('%s', 'X')$q$, :'wh2'), 'store manager', 'nor add a till');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
