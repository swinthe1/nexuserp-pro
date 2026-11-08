-- =============================================================================
-- Wave 1 of the audit, part 4: prices change through levelling (also in one unit only), costs stay
-- with those who may see them, a truck without an order is received at the door, and a filed VAT
-- month gets a corrective declaration. (after 08 and 94, on "Kontrolle Test" and "Tatim Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as mini from public.companies where name = 'Kontrolle Test' \gset
select v.id as item, v.product_id as prod from public.product_variants v join public.products p on p.id = v.product_id
 where p.company_id = :'mini' and p.deleted_at is null and v.deleted_at is null and v.sales_price_override is null
   and (select count(*) from public.product_variants x where x.product_id = p.id and x.deleted_at is null) = 1 order by v.created_at limit 1 \gset
select r.warehouse_id as store from public.pos_registers r where r.company_id = :'mini' and r.deleted_at is null order by r.created_at limit 1 \gset

-- 1. a price changed on the item card is a levelling document
set role authenticated;
select t.login('zoe@platform.io');
select public.price_level_quick(:'item', 7.77) as q \gset
select t.ok((select sales_price from public.products where id = :'prod') = 7.77, 'the item has its new price');
select t.ok(exists (select 1 from public.price_levels where company_id = :'mini' and source = 'item_card' and status = 'posted' and number = :'q'::jsonb ->> 'number'),
            'and a posted levelling says so, with its number');

-- 2. only in this unit: the unit's tills get it, the item keeps its price
insert into public.price_levels (company_id, level_date, warehouse_id, only_here) values (:'mini', current_date, :'store', true) returning id as lv \gset
insert into public.price_level_lines (company_id, level_id, line_no, variant_id, new_price) values (:'mini', :'lv', 1, :'item', 5.55);
select public.price_level_post(:'lv') as lp \gset
select t.ok((select sales_price from public.products where id = :'prod') = 7.77, 'elsewhere the price stays');
select t.ok(exists (select 1 from public.price_list_items i where i.price_list_id = (:'lp'::jsonb ->> 'price_list_id')::uuid and i.variant_id = :'item'
                      and i.price = 5.55 and i.deleted_at is null), 'the unit''s own list has the new price');
select t.ok(not exists (select 1 from public.pos_registers r where r.warehouse_id = :'store' and r.deleted_at is null and r.price_list_id is null),
            'and the unit''s tills use that list');
select t.ok((select gp.unit_price from public.get_price(:'mini', null, :'item', 1, current_date, (:'lp'::jsonb ->> 'price_list_id')::uuid) gp) = 5.55,
            'the till''s price is the unit''s price');
reset role;

-- 3. costs only for those who may see them
select t.ok(app.scrub_costs('{"cost": 3, "qty": 2, "lines": [{"unit_cost": 1, "name": "x"}]}'::jsonb, array['cost', 'unit_cost'])
            = '{"cost": null, "qty": 2, "lines": [{"unit_cost": null, "name": "x"}]}'::jsonb, 'cost figures are emptied, the rest stays');
select id as tatim from public.companies where name = 'Tatim Test' \gset
insert into auth.users (email, raw_user_meta_data) values ('magazina@tatim.al', '{"full_name":"Magazinieri"}');
set role authenticated;
select t.login('alice@alba.al');
select public.invite_member(:'tatim', 'magazina@tatim.al', array['warehouse_operator']);
select t.accept_invites();
select t.login('magazina@tatim.al');
select t.ok(not app.has_permission(:'tatim', 'inventory.costs') and (select count(*) from public.item_costs where company_id = :'tatim') = 0,
            'the warehouse floor does not read what the goods cost');
select t.login('alice@alba.al');
select t.ok((select count(*) from public.item_costs where company_id = :'tatim') > 0, 'the owner does');
reset role;

-- 4. a truck without an order: started at the door, the goods scanned, a provisional cost, received
select bp.id as vend from public.business_partners bp where bp.company_id = :'tatim' and bp.is_vendor and bp.deleted_at is null order by bp.created_at limit 1 \gset
select w.id as twh from public.warehouses w where w.company_id = :'tatim' and w.deleted_at is null order by w.created_at limit 1 \gset
select v.id as titem from public.product_variants v join public.products p on p.id = v.product_id
 where p.company_id = :'tatim' and p.product_type = 'stockable' and coalesce(p.tracking, 'none') = 'none' and v.deleted_at is null order by v.created_at limit 1 \gset
select app.main_location(:'twh') as tloc \gset
set role authenticated;
select t.login('alice@alba.al');
select public.dock_receipt_start(:'tatim', :'vend', :'twh', 'FD-77') as gr \gset
insert into public.goods_receipt_lines (company_id, receipt_id, variant_id, location_id, quantity) values (:'tatim', :'gr', :'titem', :'tloc', 3);
select public.dock_receipt_costs(:'gr') as costed \gset
select t.ok(:'costed'::int = 1 and (select unit_cost from public.goods_receipt_lines where receipt_id = :'gr') is not null, 'the line gets a provisional cost');
select public.post_goods_receipt(:'gr');
select t.ok((select status from public.goods_receipts where id = :'gr') = 'done' and (select vendor_delivery_note from public.goods_receipts where id = :'gr') = 'FD-77',
            'received, with the delivery note number');
reset role;

-- 5. a corrective VAT declaration for a filed month
select d.id as d1, d.period_start as p1 from public.vat_declarations d where d.company_id = :'tatim' and d.status = 'accepted' and d.corrects_id is null order by d.period_start limit 1 \gset
set role authenticated;
select t.login('alice@alba.al');
select public.create_vat_correction(:'d1') as cor \gset
select t.ok((select corrects_id = :'d1' and status = 'draft' and period_start = :'p1'::date from public.vat_declarations where id = :'cor'), 'a correction draft for the same month');
select t.ok(public.create_vat_correction(:'d1') = :'cor', 'only one open at a time');
select t.ok(position('corrects_id is not null' in pg_get_functiondef('app.tg_vat_period_lock'::regproc)) > 0, 'while it is open the month takes documents');
select public.submit_vat_declaration(:'cor') as sub \gset
select t.ok((:'sub'::jsonb ->> 'difference')::numeric = 0 and (select status from public.vat_declarations where id = :'cor') = 'submitted',
            'nothing changed: submitted with no difference');
select t.ok((select status from public.vat_declarations where id = :'d1') = 'accepted', 'the original stays as filed');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
