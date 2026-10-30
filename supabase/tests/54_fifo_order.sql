-- =============================================================================
-- DrisPRO · FIFO uses up layers that came in at the same moment in the order they were made
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select p.company_id as co, v.id as v from public.product_variants v join public.products p on p.id = v.product_id
 where p.product_type = 'stockable' and p.tracking = 'none' and not exists (select 1 from public.stock_levels s where s.variant_id = v.id and s.on_hand <> 0)
 order by v.created_at limit 1 \gset
select l.id as loc from public.warehouse_locations l where l.company_id = :'co' and l.warehouse_id is not null and l.location_type = 'internal' limit 1 \gset
select app.virtual_location(:'co', 'supplier') as vend, app.virtual_location(:'co', 'customer') as cust \gset
select coalesce((select costing_method from public.company_settings where company_id = :'co'), 'weighted_average') as old_method \gset
update public.company_settings set costing_method = 'fifo' where company_id = :'co';
begin;
select app.post_stock_move(:'co', 'receipt', :'v', :'vend', :'loc', 10, 5.00) \g /dev/null
select app.post_stock_move(:'co', 'receipt', :'v', :'vend', :'loc', 10, 9.00) \g /dev/null
select app.post_stock_move(:'co', 'delivery', :'v', :'loc', :'cust', 15) \g /dev/null
select (select string_agg(round(qty_left, 3) || '@' || round(unit_cost, 2), ' ' order by layer_at, seq) from public.cost_layers where variant_id = :'v' and qty_left > 0) as layers,
       (select total_value from public.item_costs where variant_id = :'v') as left_value \gset
rollback;
select t.ok(:'layers' = '5.000@9.00', 'two receipts at the same moment: the first one (at 5) leaves first, 5 at 9 are left');
select t.ok(:'left_value'::numeric = 45, 'what is left is worth 45');
update public.company_settings set costing_method = :'old_method' where company_id = :'co';
\set QUIET off
select count(*) as assertions_passed from t.results;
