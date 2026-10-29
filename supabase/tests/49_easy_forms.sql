-- =============================================================================
-- DrisPRO · the short new-item form: the quantity on the shelf goes in as opening stock;
-- new companies number their documents in Albanian (runs after 01–48, uses the demo market of 32)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

reset role;
select id as co from public.companies where name = 'Market Demo X' \gset
select id as wh from public.warehouses where company_id = :'co' order by created_at limit 1 \gset
select id as uom from public.units_of_measure where code = 'pcs' and company_id = :'co' limit 1 \gset

set role authenticated;
select t.login('demo@market-test.com');
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'OPEN-1', 'name', 'Opening test', 'product_type', 'stockable',
  'uom_id', :'uom', 'tracking', 'none', 'sales_price', 1, 'variants', jsonb_build_array(jsonb_build_object('sku', 'OPEN-1', 'attribute_value_ids', '[]'::jsonb, 'barcodes', '[]'::jsonb)))) as prod \gset
select public.product_opening_stock(:'prod', :'wh', 12, 0.8) as r \gset
select t.ok(:'r'::jsonb ->> 'status' in ('posted', 'pending_approval'), 'the opening stock is posted (or waits for approval)');
select a.number as adj, a.reason from public.stock_adjustments a where a.id = (:'r'::jsonb ->> 'id')::uuid \gset
select t.ok(:'reason' = 'opening', 'it is an opening adjustment');
select t.ok((select coalesce(sum(sl.on_hand), 0) from public.stock_levels sl join public.product_variants v on v.id = sl.variant_id where v.product_id = :'prod') = 12
  or :'r'::jsonb ->> 'status' = 'pending_approval', 'twelve pieces are on the shelf');
select t.throws($$select public.product_opening_stock('$$ || :'prod' || $$', '$$ || :'wh' || $$', 0)$$, 'more than zero', 'no opening stock of zero');

-- one's own details, and a stranger's are refused
select id as me from public.profiles where email = 'demo@market-test.com' \gset
select public.member_profile_save(:'co', :'me', 'Demo', 'Owner', '+383 44 000 000');
select t.ok((select full_name from public.profiles where id = :'me') = 'Demo Owner', 'a person changes their own name');
reset role;
select t.ok((select raw_user_meta_data ->> 'full_name' from auth.users where id = :'me') = 'Demo Owner', 'the sign-in account shows the new name');
select p.id as stranger from public.profiles p where not exists (select 1 from public.company_members m where m.user_id = p.id and m.company_id = :'co') and not p.is_super_admin limit 1 \gset
set role authenticated;
select t.login('demo@market-test.com');
select t.throws($$select public.member_profile_save('$$ || :'co' || $$', '$$ || :'stranger' || $$', 'X', 'Y')$$, 'Not allowed', 'not the details of someone outside the company');

reset role;
select t.ok((select default_prefix from public.document_types where key = 'sales_invoice') = 'FAT-', 'a new company numbers invoices FAT-');
select t.ok(:'adj' like 'RS-%', 'the adjustment is numbered RS-');

\set QUIET off
select count(*) as assertions_passed from t.results;
