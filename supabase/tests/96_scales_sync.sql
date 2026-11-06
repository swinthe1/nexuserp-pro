-- =============================================================================
-- #8, all automatic: an item by the kilogram gets its PLU by itself once there is a scale; each scale knows
-- what it holds, what to send and what to take away  (after 92–95 on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select id as reg from public.pos_registers where company_id = :'co' and code = 'T10' \gset
select warehouse_id as shop from public.pos_registers where id = :'reg' \gset
select id as kg from public.units_of_measure where company_id = :'co' and code = 'kg' \gset
select id as banp from public.products where company_id = :'co' and name = 'Banane' \gset
set role authenticated;
select t.login(:'boss');

-- no scale yet: a new item by the kilogram has no PLU
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'KT-DOM', 'name', 'Domate', 'uom_id', :'kg', 'sales_price', 1.0)) as domp \gset
select t.ok((select scale_plu from public.products where id = :'domp') is null, 'no scale yet: no PLU by itself');
select public.scale_save(jsonb_build_object('company_id', :'co', 'warehouse_id', :'shop', 'name', 'Peshorja e frutave', 'ip', '192.168.1.150')) as sc \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'KT-MOL', 'name', 'Mollë', 'uom_id', :'kg', 'sales_price', 0.8)) as molp \gset
select t.ok((select scale_plu from public.products where id = :'molp') is not null, 'with a scale: the new item by the kilogram gets a PLU by itself');
select t.ok((select ltrim(scale_plu, '0')::bigint from public.products where id = :'molp') > (select ltrim(scale_plu, '0')::bigint from public.products where id = :'banp'), 'the next one after the others');

-- the computer of the store asks what to send
select public.scale_pending(:'sc', 'ARKA-1') as pd \gset
select t.ok(:'pd'::jsonb -> 'scale' ->> 'ip' = '192.168.1.150' and jsonb_array_length(:'pd'::jsonb -> 'upsert') >= 2, 'it gets the scale and the items to send');
select t.ok((select agent = 'ARKA-1' and last_seen_at is not null from public.scales where id = :'sc'), 'the scale knows which computer serves it');
select public.scale_synced(:'sc', jsonb_build_object('sent', :'pd'::jsonb -> 'upsert'));
select t.ok(jsonb_array_length(public.scale_pending(:'sc') -> 'upsert') = 0, 'all sent: nothing left to send');
select t.ok((select last_sync_at is not null and last_error is null from public.scales where id = :'sc'), 'in sync');

-- a new price goes out at once; a PLU taken away is removed from the scale
update public.products set sales_price = 0.9 where id = :'molp';
select t.ok((select jsonb_array_length(x -> 'upsert') = 1 and x -> 'upsert' -> 0 ->> 'product_id' = :'molp' from public.scale_pending(:'sc') x), 'a new price: only that item is sent');
select public.scale_plu_set(:'co', jsonb_build_array(jsonb_build_object('product_id', :'molp', 'plu', '')));
select t.ok((select x -> 'remove' -> 0 ->> 'product_id' = :'molp' from public.scale_pending(:'sc') x), 'no PLU any more: taken off the scale');
select public.scale_synced(:'sc', jsonb_build_object('error', 'The scale does not answer'));
select t.ok((select last_error = 'The scale does not answer' from public.scales where id = :'sc'), 'an error is shown on the screen');
select t.ok((public.scales_list(:'co') -> 'scales' -> 0 ->> 'pending')::int >= 1, 'the list shows what waits');
update public.scales set is_active = false where id = :'sc';
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
