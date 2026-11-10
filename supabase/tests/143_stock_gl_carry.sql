-- =============================================================================
-- The stock account follows the stock list to the cent: an item that costs 0,2217 sold 60 times one by one
-- is booked what it cost in all, not 60 × 0,22. (after 142: any company with stock)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select v.company_id as mini, v.id as item, (select w.id from public.warehouses w where w.company_id = v.company_id and w.deleted_at is null order by w.created_at limit 1) as wh
  from public.product_variants v join public.products p on p.id = v.product_id
 where v.deleted_at is null and coalesce(p.product_type, 'stockable') = 'stockable'
   and exists (select 1 from public.warehouses w where w.company_id = v.company_id and w.deleted_at is null)
   and exists (select 1 from public.journals j where j.company_id = v.company_id)
 order by (select count(*) from public.product_variants x where x.company_id = v.company_id) desc, v.created_at limit 1 \gset
select gen_random_uuid() as rdoc \gset
select app.post_stock_move(:'mini', 'receipt', :'item', app.virtual_location(:'mini', 'supplier'), app.main_location(:'wh'), 1000000, 0.2217, null, 'goods_receipt', :'rdoc', null, 'T-CARRY');
select app.post_stock_move(:'mini', 'delivery', :'item', app.main_location(:'wh'), app.virtual_location(:'mini', 'customer'), 1, null, null, 'delivery', gen_random_uuid(), null, 'T-CARRY')
  from generate_series(1, 60);
select coalesce(sum(m.total_cost), 0) as exact from public.stock_movements m where m.company_id = :'mini' and m.variant_id = :'item' and m.reference = 'T-CARRY' and m.movement_type = 'delivery' \gset
select coalesce(sum(jl.credit - jl.debit), 0) as booked from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
 where jl.company_id = :'mini' and jl.variant_id = :'item' and e.source_doc_type = 'delivery' and e.reference = 'T-CARRY'
   and jl.account_id = app.item_acct(:'mini', :'item', 'inventory') \gset
select t.ok(abs(:'exact'::numeric - 60 * 0.22) > 0.05, 'sixty sales of an item at about 0,2217 cost some cents more than 60 × 0,22 in the stock list');
select t.ok(abs(:'exact'::numeric - :'booked'::numeric) <= 0.005, 'and the accounts book the same to the cent (not 60 × 0,22)');
select t.ok((select abs(c.carry) <= 0.005 from app.stock_gl_carry c where c.company_id = :'mini' and c.variant_id = :'item'), 'what the rounding left over is under half a cent');
select t.ok(exists (select 1 from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
                    where e.source_doc_type = 'goods_receipt' and e.source_doc_id = :'rdoc' and jl.credit = 221700.00),
            'the goods in from the supplier keep their own rounding');
\set QUIET off
select count(*) as assertions_passed from t.results;
