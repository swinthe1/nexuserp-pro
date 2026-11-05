-- =============================================================================
-- The deep check, phase 2 in the stock: the shortest shelf life at receiving, min and max from sales,
-- picking the shops' transfers in the central warehouse  (runs after 64, 80–89 on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select id as reg from public.pos_registers where company_id = :'co' and code = 'T10' \gset
select warehouse_id as shop from public.pos_registers where id = :'reg' \gset
select id as depot from public.warehouses where company_id = :'co' and code = 'DP' \gset
select id as beer, product_id as beer_p from public.product_variants where company_id = :'co' and sku = 'KT-BEER' \gset
select id as milk, product_id as milk_p from public.product_variants where company_id = :'co' and sku = 'KT-MILK' \gset
select id as ven from public.business_partners where company_id = :'co' and code = 'FT1' \gset
select m.id as wanda_m from public.company_members m join public.profiles p on p.id = m.user_id where m.company_id = :'co' and p.email = 'wanda@kt.al' \gset
set role authenticated;

-- ---------------------------------------------------------------- the shortest shelf life at receiving
select t.login(:'boss');
update public.products set min_shelf_days = 10 where id in (:'milk_p', :'beer_p');
select public.save_custom_role(:'co', null, 'Pranuesi', null, array['wms.read', 'wms.write', 'inventory.read', 'inventory.write', 'invoicing.read', 'invoicing.write',
  'procurement.read', 'procurement.write', 'partners.read', 'finance.read']) as r_recv \gset
select public.set_member_roles(:'wanda_m', array[:'r_recv']::uuid[]);
select t.login('wanda@kt.al');
select t.throws(format($q$select public.ensure_lot(%L, 'L-SHORT', current_date + 3)$q$, :'milk'), 'at least 10', 'a lot with 3 days left is refused for an item that needs 10');
select t.ok(public.ensure_lot(:'milk', 'L-GOOD', current_date + 30) is not null, 'one with 30 days comes in');
select public.save_document('vendor_bills', jsonb_build_object('company_id', :'co', 'document_type', 'vendor_bill', 'vendor_id', :'ven', 'vendor_invoice_number', 'SH-1',
   'bill_date', current_date - 40, 'due_date', current_date, 'currency_code', 'EUR', 'warehouse_id', :'shop'),
   jsonb_build_object('vendor_bill_lines', jsonb_build_array(jsonb_build_object('line_no', 1, 'variant_id', :'beer', 'description', 'Birra', 'quantity', 6, 'unit_price', 0.45,
     'expiry_date', current_date - 36)))) as sb \gset
select t.throws(format($q$select public.purchase_invoice_complete(%L)$q$, :'sb'), 'must have at least 10', 'an invoice whose goods expire too soon is not completed');
select t.login(:'boss');
select t.ok(public.ensure_lot(:'milk', 'L-SHORT', current_date + 3) is not null, 'a manager can accept a short lot');
select public.purchase_invoice_complete(:'sb');
select t.ok((select status from public.vendor_bills where id = :'sb') = 'posted', 'and a short invoice');
update public.products set min_shelf_days = null where id in (:'milk_p', :'beer_p');

-- ---------------------------------------------------------------- min and max from sales
select t.login(:'boss');
select count(*) as rules_before from public.replenishment_rules where company_id = :'co' and deleted_at is null \gset
select public.replenishment_from_sales(:'co', :'shop', '{"days": 28, "lead_days": 2, "safety_days": 1, "cover_days": 7}') as rf \gset
select r.value as beer_row from jsonb_array_elements(:'rf'::jsonb -> 'rows') r where (r.value ->> 'variant_id')::uuid = :'beer' \gset
select t.ok((:'beer_row'::jsonb ->> 'per_day')::numeric > 0, 'beer sold in the shop: it has a speed');
select t.ok((:'beer_row'::jsonb ->> 'new_min')::numeric = ceil((:'beer_row'::jsonb ->> 'sold')::numeric / 28 * 3)
        and (:'beer_row'::jsonb ->> 'new_max')::numeric = ceil((:'beer_row'::jsonb ->> 'sold')::numeric / 28 * 10), 'min: delivery and safety days of sales; max: a week more');
select t.ok((:'rf'::jsonb ->> 'written')::int = 0 and (select count(*) from public.replenishment_rules where company_id = :'co' and deleted_at is null) = :rules_before, 'shown first, nothing written');
select public.replenishment_from_sales(:'co', :'shop', '{"days": 28, "lead_days": 2, "safety_days": 1, "cover_days": 7, "apply": true}') ->> 'written' as wrote \gset
select t.ok(:wrote > 0 and exists (select 1 from public.replenishment_rules where variant_id = :'beer' and warehouse_id = :'shop' and deleted_at is null
                                    and min_qty = (:'beer_row'::jsonb ->> 'new_min')::numeric and lead_time_days = 2), 'written when asked');
select t.throws(format($q$select public.replenishment_from_sales(%L, %L, '{"method": "transfer"}')$q$, :'co', :'shop'), 'goods come from', 'a transfer names where from');

-- ---------------------------------------------------------------- picking the shops' transfers
select id as tr from public.stock_transfers where company_id = :'co' and from_warehouse_id = :'depot' and to_warehouse_id = :'shop' and status = 'draft' order by created_at desc limit 1 \gset
select public.create_transfer_pick_list(array[:'tr']::uuid[]) as task \gset
select t.throws(format($q$select public.create_transfer_pick_list(array[%L]::uuid[])$q$, :'tr'), 'already on an open pick list', 'one pick list per transfer');
select t.throws(format($q$select public.ship_stock_transfer(%L)$q$, :'tr'), 'finish the picking', 'it leaves when the picking is done');
select id as tline, quantity as tq from public.warehouse_task_lines where task_id = :'task' \gset
select public.confirm_pick(:'tline', :tq - 2);
select public.complete_pick_list(:'task') as done \gset
select t.ok((:'done'::jsonb ->> 'transfers')::int = 1 and (:'done'::jsonb ->> 'short_lines')::int = 1, 'one transfer picked, short by two');
select t.ok((select sum(quantity) from public.stock_transfer_lines where transfer_id = :'tr') = :tq - 2
        and (select picked_at from public.stock_transfers where id = :'tr') is not null, 'the transfer keeps what was picked');
select t.ok(public.ship_stock_transfer(:'tr') = 'in_transit', 'and leaves with it');

\set QUIET off
select count(*) as assertions_passed from t.results;
