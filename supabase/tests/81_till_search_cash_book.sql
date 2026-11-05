-- =============================================================================
-- From the meeting with the administrative staff: the till's catalog with the unit (#19), the
-- expiry dates with supplier and groups (#14), the cash book by day and by unit (#16b)
-- (runs after 64 "Kontrolle Test" and 80)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select id as reg from public.pos_registers where company_id = :'co' and code = 'T10' \gset
select warehouse_id as shop, cash_account_id as drawer from public.pos_registers where id = :'reg' \gset
select id as milk from public.product_variants where company_id = :'co' and sku = 'KT-MILK' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
set role authenticated;

-- ---------------------------------------------------------------- 19
select t.login('cora@kt.al');
select t.ok((select uom from public.pos_catalog(:'reg') where sku = 'KT-BEER') = 'pcs', 'the till''s catalog gives each item''s unit');

-- ---------------------------------------------------------------- 14
select t.login(:'boss');
select public.expiry_overview(:'co', null, 3650) as ov \gset
select t.ok(jsonb_array_length(:'ov'::jsonb -> 'lots') = 0
         or not exists (select 1 from jsonb_array_elements(:'ov'::jsonb -> 'lots') x where not (x ? 'supplier_id' and x ? 'group_id' and x ? 'category_id')),
         'each short-dated lot says its supplier, group and sub-group');
select t.ok(not exists (select 1 from jsonb_array_elements(:'ov'::jsonb -> 'markdowns') x where not (x ? 'supplier_id' and x ? 'group_id')),
         'and so does each discount proposal');
select t.ok(exists (select 1 from jsonb_array_elements(:'ov'::jsonb -> 'markdowns') x where x ->> 'name' = 'Qumësht 1L' and x ->> 'group_id' is null),
         'an item without a group says so (no group to filter by)');

-- ---------------------------------------------------------------- 16b
select public.cash_accounts(:'co') as ca \gset
select t.ok(jsonb_path_exists(:'ca'::jsonb, '$[*] ? (@.id == $d && @.units[*].id == $s)', jsonb_build_object('d', :'drawer', 's', :'shop')),
         'the till''s drawer belongs to its store');
select public.cash_book(:'co', jsonb_build_object('from', current_date - 1, 'to', current_date + 1, 'units', jsonb_build_array(:'shop'))) as cb \gset
select t.ok((:'cb'::jsonb -> 'accounts') @> jsonb_build_array(jsonb_build_object('id', :'drawer')), 'by unit: the store''s cash accounts');
select t.ok(abs((:'cb'::jsonb ->> 'opening')::numeric + (:'cb'::jsonb ->> 'in')::numeric - (:'cb'::jsonb ->> 'out')::numeric - (:'cb'::jsonb ->> 'closing')::numeric) < 0.005,
         'opening + in − out = closing');
select t.ok(not exists (select 1 from jsonb_array_elements(:'cb'::jsonb -> 'days') x
                         where abs((x ->> 'opening')::numeric + (x ->> 'in')::numeric - (x ->> 'out')::numeric - (x ->> 'closing')::numeric) > 0.005),
         'and so each day');
select t.ok(exists (select 1 from jsonb_array_elements(:'cb'::jsonb -> 'days') d, jsonb_array_elements(d -> 'lines') l
                     where l ->> 'partner' = 'Furra e Qytetit' and (l ->> 'out')::numeric = 25),
         'the supplier paid from the till is in the book, with the supplier''s name');
select t.ok((public.cash_book(:'co', jsonb_build_object('from', current_date - 1, 'to', current_date + 1, 'units', jsonb_build_array(gen_random_uuid()))) -> 'accounts') = '[]',
         'a unit with no cash account: nothing');
select t.throws(format($q$select public.cash_book(%L, '{"from":"2026-03-01","to":"2026-02-01"}')$q$, :'co'), 'Check the dates', 'the end before the start is refused');
select t.login('cora@kt.al');
select t.throws(format($q$select public.cash_book(%L, '{}')$q$, :'co'), 'Permission denied', 'a cashier does not read the cash book');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
