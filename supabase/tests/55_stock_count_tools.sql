-- =============================================================================
-- DrisPRO · stock counting: values before confirming, recount, spreadsheet import, shrinkage
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select email as boss from public.profiles where is_super_admin limit 1 \gset
-- a warehouse with an item on exactly one shelf
select sl.company_id as co, l.warehouse_id as wh, sl.variant_id as v, sl.location_id as loc, sl.on_hand as qty, v.sku
  from public.stock_levels sl join public.warehouse_locations l on l.id = sl.location_id join public.product_variants v on v.id = sl.variant_id
  join public.products p on p.id = v.product_id
 where sl.on_hand >= 10 and sl.lot_id is null and p.tracking = 'none' and l.location_type = 'internal'
   and (select count(*) from public.stock_levels x where x.variant_id = sl.variant_id and x.on_hand <> 0) = 1
   and exists (select 1 from public.item_costs ic where ic.variant_id = sl.variant_id and ic.avg_cost > 0)
 order by sl.on_hand desc limit 1 \gset
select avg_cost as cost from public.item_costs where variant_id = :'v' \gset
set role authenticated;
select t.login(:'boss');
select public.create_cycle_count(:'wh', array[:'loc'::uuid], null, true) as cnt \gset

-- the spreadsheet: one line short by 3, one unknown code
select public.count_import(:'cnt', jsonb_build_array(jsonb_build_object('code', :'sku', 'qty', (:'qty'::numeric - 3)::text),
                                                      jsonb_build_object('code', 'NO-SUCH-CODE', 'qty', '1'))) as imp \gset
select t.ok((:'imp'::jsonb ->> 'ok')::int = 1, 'the known item is counted from the spreadsheet');
select t.ok(:'imp'::jsonb -> 'errors' -> 0 ->> 'reason' = 'unknown_code', 'the unknown code is reported, not guessed');
select t.ok((select counted_qty from public.cycle_count_lines where cycle_count_id = :'cnt' and variant_id = :'v') = :'qty'::numeric - 3, 'the counted quantity is set');

select public.submit_cycle_count(:'cnt', true);
select public.count_review(:'cnt') as rev \gset
select t.ok((select (l ->> 'delta')::numeric from jsonb_array_elements(:'rev'::jsonb -> 'lines') l where (l ->> 'variant_id')::uuid = :'v') = -3, 'the review shows 3 missing');
select t.ok((select (l ->> 'value')::numeric from jsonb_array_elements(:'rev'::jsonb -> 'lines') l where (l ->> 'variant_id')::uuid = :'v') = round(-3 * :'cost'::numeric, 2),
  'with their value at the current cost');
select t.ok((:'rev'::jsonb ->> 'losses')::numeric <= round(-3 * :'cost'::numeric, 2), 'and in the losses');

-- send the big ones back: everything over 1 unit of value
select public.count_recount(:'cnt', 0.01, null) as back \gset
select t.ok(:back >= 1, 'big differences go back to be counted');
select t.ok((select status from public.cycle_counts where id = :'cnt') = 'in_progress', 'the count is open again');
select t.ok((select first_counted_qty from public.cycle_count_lines where cycle_count_id = :'cnt' and variant_id = :'v') = :'qty'::numeric - 3
  and (select counted_qty from public.cycle_count_lines where cycle_count_id = :'cnt' and variant_id = :'v') is null, 'the first figure is kept, the line waits for a new count');
select t.throws($$select public.count_recount('$$ || :'cnt' || $$', 1, null)$$, 'waiting for review', 'only a count in review can be sent back');

-- the recount finds 2 missing; confirm
select public.count_item(:'cnt', :'v', :'loc', :'qty'::numeric - 2, null, true);
select public.submit_cycle_count(:'cnt', true);
select public.post_cycle_count(:'cnt') as posted \gset
select t.ok((select status from public.cycle_counts where id = :'cnt') = 'posted', 'the count is confirmed');
reset role;
select set_config('request.jwt.claims', '', false);
set role authenticated;
select t.login(:'boss');
select t.ok(coalesce((select sum(qty_lost) from public.shrinkage_report(:'co', current_date - 1, current_date + 1) where variant_id = :'v' and reason = 'count'), 0) = 2
  or (:'posted'::jsonb ->> 'adjustment_status') = 'pending_approval', 'the shrinkage report shows the 2 missing');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
