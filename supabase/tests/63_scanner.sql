-- =============================================================================
-- DrisPRO Skaner: a price changed on the handheld goes onto the person's levelling from the scanner
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
insert into auth.users (email, raw_user_meta_data) values ('ana@sk.al', '{"full_name":"Ana Arkëtare"}') on conflict do nothing;
select email as boss from public.profiles where is_super_admin limit 1 \gset
set role authenticated;
select t.login(:'boss');
select public.create_company('Skaner Test', 'XK') as co \gset
select public.invite_member(:'co', 'ana@sk.al', array['pos_cashier']);
select t.accept_invites();
select t.login(:'boss');
select id as pcs from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'SK1', 'name', 'Artikull', 'uom_id', :'pcs', 'sales_price', 10)) as p \gset
select id as v1 from public.product_variants where product_id = :'p' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'SK2', 'name', 'Artikull 2', 'uom_id', :'pcs', 'sales_price', 5)) as p \gset
select id as v2 from public.product_variants where product_id = :'p' \gset

select public.level_add_line(:'co', :'v1', 12) as r1 \gset
select public.level_add_line(:'co', :'v2', 6) as r2 \gset
select public.level_add_line(:'co', :'v1', 11.5) as r3 \gset
select t.ok((:'r1'::jsonb ->> 'id') = (:'r3'::jsonb ->> 'id') and (:'r3'::jsonb ->> 'lines')::int = 2, 'every price scanned goes onto one draft levelling');
select t.ok((select new_price from public.price_level_lines where level_id = (:'r1'::jsonb ->> 'id')::uuid and variant_id = :'v1') = 11.5, 'scanning the same item again changes its new price');
select t.ok((select status = 'draft' and notes = 'Nga skaneri' from public.price_levels where id = (:'r1'::jsonb ->> 'id')::uuid)
        and (select sales_price from public.products where id = (select product_id from public.product_variants where id = :'v1')) = 10, 'nothing changes until it is posted');
select t.throws(format($q$select public.level_add_line(%L, %L, -1)$q$, :'co', :'v1'), 'below zero', 'no price below zero');
select t.login('ana@sk.al');
select t.throws(format($q$select public.level_add_line(%L, %L, 9)$q$, :'co', :'v1'), 'Permission denied', 'a cashier may not change prices');

reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
