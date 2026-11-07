-- =============================================================================
-- "Raporti i stokut", phase 3: what looks wrong with the stock, the lots and their expiry, the stock against the books, and
-- the costs only for those who may see them.  (on "Stoku Test" of 105)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
insert into auth.users (email, raw_user_meta_data) values ('dita@stoku.test', '{"full_name":"Dita Arkëtare"}') on conflict do nothing;
select email as boss from public.profiles where is_super_admin limit 1 \gset
select id as co from public.companies where name = 'Stoku Test' \gset
select id as wh from public.warehouses where company_id = :'co' and deleted_at is null order by created_at limit 1 \gset
select id as wh_stock from public.warehouse_locations where warehouse_id = :'wh' and location_type = 'internal' order by code limit 1 \gset
select v.id as kos from public.product_variants v join public.products p on p.id = v.product_id where p.company_id = :'co' and p.code = 'KOS' \gset

set role authenticated;
select t.login(:'boss');
select public.invite_member(:'co', 'dita@stoku.test', array['pos_cashier']);
select t.accept_invites();
select t.login(:'boss');
-- 10 kg of kos bought at 3,00 and sold at 2,00: under its cost
insert into public.goods_receipts (company_id, warehouse_id, receipt_date) values (:'co', :'wh', current_date) returning id as gr \gset
insert into public.goods_receipt_lines (company_id, receipt_id, variant_id, location_id, quantity, unit_cost) values (:'co', :'gr', :'kos', :'wh_stock', 10, 3);
select public.post_goods_receipt(:'gr');
select public.stock_report(:'co', '{"report": "anomalies"}') as an \gset
select public.stock_books_check(:'co', '{}') as books \gset
select public.stock_expiry(:'co', '{}') as exp \gset
reset role;

select t.ok((select x -> 'problems' ? 'below_cost' from jsonb_array_elements(:'an'::jsonb -> 'rows') x where x ->> 'code' = 'KOS'), 'sold under its cost: shown');
select t.ok(not exists (select 1 from jsonb_array_elements(:'an'::jsonb -> 'rows') x where x ->> 'code' = 'JOG'), 'an item with nothing wrong is not');
select t.ok((select sum((x ->> 'stock_value')::numeric) = 108 and sum((x ->> 'difference')::numeric) = 0 from jsonb_array_elements(:'books'::jsonb -> 'rows') x),
            'the stock (78 + 30) is what the stock accounts say');
select t.ok(jsonb_array_length(:'exp'::jsonb -> 'rows') = 0, 'no lots, nothing to expire');

-- the cashier sees quantities and sale prices, not what the goods cost
set role authenticated;
select t.login('dita@stoku.test');
select public.stock_report(:'co', '{"report": "sale"}') as sale \gset
select public.stock_analysis(:'co', '{"report": "availability"}') as av \gset
select t.throws(format($q$select public.stock_report(%L, '{"report": "avg"}')$q$, :'co'), 'what the stock cost', 'the report at cost is not hers');
select t.throws(format($q$select public.stock_books_check(%L, '{}')$q$, :'co'), 'Permission', 'nor the books');
reset role;
select t.ok((select bool_and(not (x ? 'value') and not (x ? 'avg_cost') and not (x ? 'margin') and x ? 'value_sale_gross') from jsonb_array_elements(:'sale'::jsonb -> 'rows') x),
            'at sale prices: no cost, no margin');
select t.ok((select bool_and(not (x ? 'value') and x ? 'available') from jsonb_array_elements(:'av'::jsonb -> 'rows') x), 'free to sell: the quantities only');

\set QUIET off
select count(*) as assertions_passed from t.results;
