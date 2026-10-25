-- =============================================================================
-- DrisPRO · Phase 7 manufacturing tests (runs after 01–06; reuses t.ok / t.throws / t.login)
-- Scenario: a roastery. Green coffee (lots) → roasted coffee (sub-assembly, lots) → 1 kg packs (lots).
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

insert into auth.users (email, raw_user_meta_data) values
  ('pete@mfg.al', '{"full_name":"Pete Production"}'),
  ('wes@mfg.al',  '{"full_name":"Wes Warehouse"}'),
  ('fay@mfg.al',  '{"full_name":"Fay Finance"}'),
  ('cass@mfg.al', '{"full_name":"Cass Cashier"}');

-- balance helpers read past row-level security (production managers do not see the ledger)
create or replace function pg_temp.bal(p_co uuid, p_code text) returns numeric language sql security definer as $$
  select coalesce(sum(jl.debit - jl.credit), 0) from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
   where jl.company_id = p_co and jl.account_id = (select id from public.accounts where company_id = p_co and code = p_code)
     and e.status in ('posted','reversed') $$;
create or replace function pg_temp.qty(p_variant uuid) returns numeric language sql security definer as $$
  select coalesce(sum(on_hand), 0) from public.stock_levels where variant_id = p_variant $$;

set role authenticated;
select t.login('alice@alba.al');
select public.create_company('Fabrika Test', 'AL') as co \gset
select public.invite_member(:'co', 'pete@mfg.al', array['production_manager']);
select public.invite_member(:'co', 'wes@mfg.al', array['warehouse_operator']);
select public.invite_member(:'co', 'fay@mfg.al', array['finance_manager']);
select public.invite_member(:'co', 'cass@mfg.al', array['pos_cashier']);

select id as pcs   from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select coalesce((select id from public.units_of_measure where company_id = :'co' and code = 'kg'), :'pcs'::uuid) as kg \gset
select id as wh    from public.warehouses where company_id = :'co' and code = 'WH' \gset
select id as stock from public.warehouse_locations where company_id = :'co' and code = 'WH/STOCK' \gset

select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'GREEN', 'name', 'Green coffee Santos', 'uom_id', :'kg', 'tracking', 'lot', 'is_sellable', false)) as p \gset
select id as green from public.product_variants where product_id = :'p' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'BAG', 'name', 'Valve bag 1 kg', 'uom_id', :'pcs', 'is_sellable', false)) as p \gset
select id as bag from public.product_variants where product_id = :'p' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'ROAST', 'name', 'Roasted coffee (bulk)', 'uom_id', :'kg', 'tracking', 'lot',
       'track_expiry', true, 'is_sellable', false, 'is_purchasable', false)) as p \gset
select id as roast from public.product_variants where product_id = :'p' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'PACK', 'name', 'House blend 1 kg', 'uom_id', :'pcs', 'tracking', 'lot',
       'track_expiry', true, 'sales_price', 2500, 'is_purchasable', false)) as p \gset
select id as pack from public.product_variants where product_id = :'p' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'SET', 'name', 'Gift set', 'uom_id', :'pcs', 'is_purchasable', false)) as p \gset
select id as gset from public.product_variants where product_id = :'p' \gset

-- opening stock: two lots of green coffee at different costs, bags
insert into public.lots (company_id, variant_id, lot_number, expiry_date) values (:'co', :'green', 'G-1', current_date + 200) returning id as g1 \gset
insert into public.lots (company_id, variant_id, lot_number, expiry_date) values (:'co', :'green', 'G-2', current_date + 400) returning id as g2 \gset
insert into public.stock_adjustments (company_id, warehouse_id, reason) values (:'co', :'wh', 'opening') returning id as op \gset
insert into public.stock_adjustment_lines (company_id, adjustment_id, variant_id, location_id, lot_id, quantity_change, unit_cost) values
  (:'co', :'op', :'green', :'stock', :'g1', 30, 600), (:'co', :'op', :'green', :'stock', :'g2', 30, 650), (:'co', :'op', :'bag', :'stock', null, 100, 20);
select public.post_stock_adjustment(:'op');

-- work centers and BOMs (as the production manager)
select t.login('pete@mfg.al');
insert into public.work_centers (company_id, code, name, warehouse_id, cost_per_hour, overhead_per_hour) values
  (:'co', 'ROAST', 'Roaster', :'wh', 1200, 600) returning id as wc_roast \gset
insert into public.work_centers (company_id, code, name, warehouse_id, cost_per_hour, overhead_per_hour) values
  (:'co', 'PACK', 'Packing line', :'wh', 900, 300) returning id as wc_pack \gset
select public.save_document('boms', jsonb_build_object('company_id', :'co', 'code', 'BOM-ROAST', 'name', 'Roasting', 'variant_id', :'roast', 'quantity', 10),
       jsonb_build_object('bom_lines', jsonb_build_array(jsonb_build_object('line_no', 1, 'component_variant_id', :'green', 'quantity', 12)),
                          'bom_operations', jsonb_build_array(jsonb_build_object('sequence', 10, 'name', 'Roasting', 'work_center_id', :'wc_roast',
                                                                                 'setup_minutes', 15, 'run_minutes_per_unit', 3)))) as b_roast \gset
select public.save_document('boms', jsonb_build_object('company_id', :'co', 'code', 'BOM-PACK', 'name', 'Packing 1 kg', 'variant_id', :'pack', 'quantity', 1),
       jsonb_build_object('bom_lines', jsonb_build_array(jsonb_build_object('line_no', 1, 'component_variant_id', :'roast', 'quantity', 1),
                                                         jsonb_build_object('line_no', 2, 'component_variant_id', :'bag', 'quantity', 1)),
                          'bom_operations', jsonb_build_array(jsonb_build_object('sequence', 10, 'name', 'Packing', 'work_center_id', :'wc_pack',
                                                                                 'setup_minutes', 10, 'run_minutes_per_unit', 1)))) as b_pack \gset
select public.save_document('boms', jsonb_build_object('company_id', :'co', 'code', 'KIT-SET', 'name', 'Gift set', 'variant_id', :'gset', 'quantity', 1, 'bom_type', 'kit'),
       jsonb_build_object('bom_lines', jsonb_build_array(jsonb_build_object('line_no', 1, 'component_variant_id', :'pack', 'quantity', 1)))) as b_kit \gset
select t.ok((select is_manufactured from public.products p join public.product_variants v on v.product_id = p.id where v.id = :'pack'), 'a product with a BOM is marked as manufactured');

-- ---------- BOM structure and cost ----------------------------------------------------------------
select t.throws(format($q$insert into public.bom_lines (company_id, bom_id, line_no, component_variant_id, quantity) values (%L, %L, 2, %L, 1)$q$,
                       :'co', :'b_roast', :'pack'), 'Circular BOM', 'a BOM cannot contain itself through a sub-assembly');
select t.ok((select count(*) from public.bom_explode(:'b_pack', 10)) = 3, 'explosion shows all levels (roast, bag, and green under roast)');
select t.ok((select (depth, quantity) = (2, 12.000000) from public.bom_explode(:'b_pack', 10) where variant_id = :'green'),
            '10 packs need 12 kg of green coffee two levels down');
select t.ok((public.bom_cost(:'b_pack', 10))->>'material' = '7700.00', 'rolled-up material: 12 kg × 625 average + 10 bags × 20');
select t.ok((public.bom_cost(:'b_pack', 10))->>'labor' = '1200.00' and (public.bom_cost(:'b_pack', 10))->>'overhead' = '550.00',
            'rolled-up labour and overhead from both operations');
select t.ok((public.bom_cost(:'b_pack', 10))->>'unit' = '945.0000', 'cost per pack');
select t.ok((select count(*) from public.bom_where_used(:'roast')) = 1, 'where-used finds the parent BOM');

-- ---------- work orders: creation, guards, sub-assemblies ------------------------------------------
select t.login('wes@mfg.al');
select t.throws(format($q$select public.create_work_order('{"bom_id": "%s", "quantity": 5}')$q$, :'b_pack'), 'manufacturing.write',
                'warehouse staff cannot create work orders');
select t.login('pete@mfg.al');
select t.throws(format($q$select public.create_work_order('{"bom_id": "%s", "quantity": 5}')$q$, :'b_kit'), 'kit', 'kits are sold, not produced');
select public.create_work_order(jsonb_build_object('bom_id', :'b_pack', 'quantity', 10, 'make_subassemblies', true)) as wo \gset
select id as wo_r from public.work_orders where parent_work_order_id = :'wo' \gset
select t.ok((select (variant_id, quantity_planned) = (:'roast'::uuid, 10.0000) from public.work_orders where id = :'wo_r'),
            'a short sub-assembly becomes its own work order for the shortfall');
select t.ok((select planned_end from public.work_orders where id = :'wo_r') <= (select planned_start from public.work_orders where id = :'wo'),
            'the sub-assembly is due before the parent starts');
select t.ok((select quantity_required from public.work_order_materials where work_order_id = :'wo' and variant_id = :'bag') = 10, 'materials copied from the BOM');
select t.ok((select planned_minutes from public.work_order_operations where work_order_id = :'wo_r') = 45, 'operation time: 15 setup + 3 × 10 kg');
select t.throws(format($q$update public.work_orders set status = 'in_progress' where id = %L$q$, :'wo_r'), 'set by its own action', 'status is not edited directly');
select t.throws(format($q$update public.work_orders set material_cost = 1 where id = %L$q$, :'wo_r'), 'recorded by consuming', 'costs are not edited directly');
select id as m_green from public.work_order_materials where work_order_id = :'wo_r' \gset
select t.throws(format($q$select public.consume_materials(%L)$q$, :'wo_r'), 'Release', 'materials are used only after release');

-- ---------- roasting: consume, report time, produce ---------------------------------------------------
select t.ok((public.release_work_order(:'wo_r'))->'shortages' = '[]'::jsonb, 'release reports no shortages when stock is there');
select t.ok((select planned_material_cost from public.work_orders where id = :'wo_r') = 7500, 'release snapshots the planned material cost');
select public.consume_materials(:'wo_r', jsonb_build_array(jsonb_build_object('material_id', :'m_green', 'quantity', 12, 'lot_id', :'g1')));
select t.ok((select (status, material_cost) = ('in_progress', 7500.0000) from public.work_orders where id = :'wo_r'), 'consumption starts the order at average cost');
select t.ok(pg_temp.bal(:'co', '331') = 7500, 'consumption: Dr work in progress / Cr inventory');
select t.ok((select sum(quantity) from public.work_order_consumptions where work_order_id = :'wo_r' and lot_id = :'g1') = 12, 'the consumed lot is recorded');
select t.throws(format($q$select public.consume_materials(%L, '[{"material_id": "%s", "quantity": 100}]')$q$, :'wo_r', :'m_green'), 'Not enough',
                'production never takes stock negative');
select id as op_r from public.work_order_operations where work_order_id = :'wo_r' \gset
select public.record_operation(:'op_r', 50);
select t.ok((select (labor_cost, overhead_cost) = (1000.0000, 500.0000) from public.work_orders where id = :'wo_r'), '50 minutes at 1,200/h labour and 600/h overhead');
select t.ok(pg_temp.bal(:'co', '331') = 9000 and pg_temp.bal(:'co', '7212') = -1000 and pg_temp.bal(:'co', '7213') = -500,
            'labour and overhead absorbed into WIP');
select t.throws(format($q$select public.produce(%L, 10)$q$, :'wo_r'), 'best-before', 'expiry-tracked output needs its best-before date');
select public.produce(:'wo_r', 10, 'R-001', current_date + 180) as out_r \gset
select id as lot_r from public.lots where lot_number = 'R-001' and variant_id = :'roast' \gset
select t.ok((select (status, quantity_produced, output_value) = ('completed', 10.0000, 9000.0000) from public.work_orders where id = :'wo_r'),
            'the last output carries all the cost: 9,000 for 10 kg');
select t.ok((select avg_cost from public.item_costs where variant_id = :'roast') = 900, 'roasted coffee enters stock at 900/kg');
select t.ok(pg_temp.bal(:'co', '331') = 0, 'WIP is empty once the output is booked');
select t.ok((select (status) = 'done' from public.work_order_operations where id = :'op_r'), 'the operation is finished with the order');
select t.ok((select quantity from public.lot_genealogy where parent_lot_id = :'g1' and child_lot_id = :'lot_r') = 12, 'genealogy: G-1 went into R-001');
select t.ok((public.close_work_order(:'wo_r'))->>'variance' = '0.00', 'closing a fully absorbed order leaves no variance');

-- ---------- packing: partial output with backflush, then the rest ----------------------------------
select public.release_work_order(:'wo');
select t.ok((select planned_material_cost + planned_labor_cost + planned_overhead_cost from public.work_orders where id = :'wo') = 9600,
            'parent planned cost uses the roasted coffee now in stock (900) + bags + packing');
select public.produce(:'wo', 4, 'P-001', current_date + 365) as out1 \gset
select t.ok((select quantity_consumed from public.work_order_materials where work_order_id = :'wo' and variant_id = :'roast') = 4, 'backflush takes 4 kg for 4 packs');
select t.ok((select actual_minutes from public.work_order_operations where work_order_id = :'wo') = 8, 'backflush books 40% of the packing time');
select t.ok((:'out1'::jsonb)->>'unit_cost' = '960.000000', 'partial output at planned unit cost 960');
select id as m_bag from public.work_order_materials where work_order_id = :'wo' and variant_id = :'bag' \gset
select public.consume_materials(:'wo', jsonb_build_array(jsonb_build_object('material_id', :'m_bag', 'quantity', 2)));   -- picked by hand: counts towards the requirement
select public.produce(:'wo', 6, null, null) as out2 \gset
select id as lot_p from public.lots where lot_number = 'P-001' and variant_id = :'pack' \gset
select t.ok((select (status, quantity_produced) = ('completed', 10.0000) from public.work_orders where id = :'wo'), 'second output completes the order');
select t.ok((select output_value from public.work_orders where id = :'wo') = (select total_cost from public.work_orders where id = :'wo'),
            'finished goods carry exactly the actual cost');
select t.ok((select material_cost from public.work_orders where id = :'wo') = 9200
            and (select quantity_consumed from public.work_order_materials where id = :'m_bag') = 10,
            'backflush tops up to the requirement, counting what was taken by hand: 10 kg × 900 + 10 bags × 20');
select t.ok(pg_temp.qty(:'pack') = 10 and pg_temp.qty(:'roast') = 0, 'packs in stock, roasted coffee used up');

-- ---------- traceability ------------------------------------------------------------------------------
select t.ok((select array_agg(lot_number order by depth) from public.lot_genealogy_tree(:'lot_p', 'up')) = array['R-001', 'G-1'],
            'backward trace: pack lot ← roast lot ← green lot');
select t.ok((select array_agg(lot_number order by depth) from public.lot_genealogy_tree(:'g1', 'down')) = array['R-001', 'P-001'],
            'forward trace (recall): green lot → roast lot → pack lot');
select t.ok((select vendor is null and work_order = (select number from public.work_orders where id = :'wo_r')
               from public.lot_genealogy_tree(:'lot_p', 'up') where depth = 2), 'each step names the work order that made it');

-- ---------- early completion, returns and variance -------------------------------------------------
select public.create_work_order(jsonb_build_object('bom_id', :'b_roast', 'quantity', 5)) as wo3 \gset
select public.release_work_order(:'wo3');
select public.consume_materials(:'wo3');
select t.ok((select quantity_consumed from public.work_order_materials where work_order_id = :'wo3') = 6, 'consume all remaining = backflush to the requirement');
select t.ok((select lot_id from public.work_order_consumptions where work_order_id = :'wo3' limit 1) = :'g1'::uuid, 'first-expiry lot is used first');
select id as m3 from public.work_order_materials where work_order_id = :'wo3' \gset
select public.return_materials(:'wo3', jsonb_build_array(jsonb_build_object('material_id', :'m3', 'quantity', 1)));
select t.ok((select (quantity_consumed, material_cost) = (5.0000, 3125.0000) from public.work_order_materials m join public.work_orders w on w.id = m.work_order_id where m.id = :'m3'),
            'unused material returns at the cost it left with');
select public.produce(:'wo3', 2, 'R-002', current_date + 180, 0, false);
select public.complete_work_order(:'wo3');
select public.close_work_order(:'wo3') as cl3 \gset
select t.ok(((:'cl3'::jsonb)->>'variance')::numeric > 0 and pg_temp.bal(:'co', '6012') = ((:'cl3'::jsonb)->>'variance')::numeric,
            'closing books what output did not absorb to production variance');
select t.ok(pg_temp.bal(:'co', '331') = 0, 'WIP is clean after closing');
select t.ok(pg_temp.bal(:'co', '311') = (select round(sum(total_value), 2) from public.item_costs where company_id = :'co'),
            'GL inventory equals the stock valuation after production');
select t.ok((select count(*) from public.journal_entries where company_id = :'co' and source_doc_type = 'work_order' and total_debit <> total_credit) = 0,
            'every production entry balances');

-- ---------- cancel, planning, overview -----------------------------------------------------------------
select t.throws(format($q$select public.cancel_work_order(%L)$q$, :'wo3'), 'is closed', 'a closed order cannot be cancelled');
select public.create_work_order(jsonb_build_object('bom_id', :'b_pack', 'quantity', 3)) as wo4 \gset
select t.ok(public.cancel_work_order(:'wo4') = 'cancelled', 'an order with nothing booked can be cancelled');
select t.login('alice@alba.al');
insert into public.replenishment_rules (company_id, variant_id, warehouse_id, min_qty, max_qty, replenish_method)
values (:'co', :'pack', :'wh', 20, 40, 'manufacture');
select t.login('pete@mfg.al');
select t.ok((select suggested from public.production_plan(:'co') where variant_id = :'pack') = 30, 'plan: stock 10 below a minimum of 20 → make 30 to reach 40');
select t.ok((select count(*) from public.work_center_load(:'co', current_date, current_date + 6)) = 14, 'load per work center per day');
select t.ok((select count(*) from public.work_center_load(:'co', current_date, current_date + 6) where capacity_minutes = 0) = 2, 'Sundays have no capacity');
select t.ok((public.manufacturing_overview(:'co', current_date - 1, current_date))->>'produced_orders' = '3', 'overview counts what was produced');
select t.login('alice@alba.al');
select public.generate_replenishment(:'co');
select id as sug from public.replenishment_suggestions where company_id = :'co' and variant_id = :'pack' and status = 'open' \gset
select t.login('pete@mfg.al');
select t.ok(((public.create_wos_from_suggestions(array[:'sug']::uuid[]))->0->>'number') like 'WO-%', 'a manufacture suggestion becomes a work order');

-- ---------- visibility -----------------------------------------------------------------------------------
select t.login('cass@mfg.al');
select t.ok((select count(*) from public.work_orders) = 0, 'cashiers do not see work orders');
select t.login('fay@mfg.al');
select t.ok((select count(*) from public.work_orders) > 0 and (select count(*) from public.journal_entries where source_doc_type = 'work_order') > 0,
            'finance sees work orders and their entries');

reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
