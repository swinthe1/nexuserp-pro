-- =============================================================================
-- #14 again: a short-date discount goes through the price calculation and is written as a levelling of
-- that unit; the day after the date a second levelling brings the price back  (runs after 92, 93 on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select id as reg from public.pos_registers where company_id = :'co' and code = 'T10' \gset
select warehouse_id as shop from public.pos_registers where id = :'reg' \gset
select id as ban, product_id as banp from public.product_variants where sku = 'KT-BAN' and company_id = :'co' \gset
set role authenticated;
select t.login(:'boss');

-- 10 kg of bananas expire in 3 days: −40 %, approved at once
select public.expiry_propose(jsonb_build_object('company_id', :'co', 'warehouse_id', :'shop', 'variant_id', :'ban',
  'expiry_date', current_date + 3, 'quantity', 10, 'discount_pct', 40, 'approve', true)) as md \gset
select level_id as lv from public.expiry_markdowns where id = :'md' \gset
select t.ok(:'lv' <> '', 'approved: a price levelling is written');
select t.ok((select source = 'expiry' and status = 'posted' and warehouse_id = :'shop' and valid_until = current_date + 3 from public.price_levels where id = :'lv'),
  'the levelling: posted, of this unit, until the expiry date');
select t.ok((select old_price = 1.5 and new_price = 0.9 and quantity = 10 from public.price_level_lines where level_id = :'lv'), 'the line: 1.50 → 0.90 for the 10 kg');
select t.ok((select value_change from public.price_levels where id = :'lv') < 0, 'the value of the change is recorded (down)');
select t.ok((select sales_price from public.products where id = :'banp') = 1.5, 'the price of the item does not change: the other units keep it');
select t.ok(exists (select 1 from public.promotions p join public.expiry_markdowns m on m.promotion_id = p.id where m.id = :'md' and p.warehouse_ids = array[:'shop'::uuid]),
  'the till of this unit sells at the discount');
select t.ok((public.expiry_overview(:'co', :'shop', 7) -> 'markdowns') @> jsonb_build_array(jsonb_build_object('id', :'md', 'level_id', :'lv')), 'the discounts list shows its levelling');
select t.ok(public.expiry_markdowns_waiting(:'co') >= 0, 'the levelling page counts the proposals waiting');

-- the date passes: the next night the price comes back with its own levelling
reset role;
update public.expiry_markdowns set expiry_date = current_date - 1 where id = :'md';
select app.expiry_levels_daily() >= 1 as ran \gset
select end_level_id as lv2 from public.expiry_markdowns where id = :'md' \gset
select t.ok((select source = 'expiry_end' and status = 'posted' from public.price_levels where id = :'lv2'), 'after the date: a second levelling, the price goes back');
select t.ok((select old_price = 0.9 and new_price = 1.5 from public.price_level_lines where level_id = :'lv2'), 'its line: 0.90 → 1.50');
select app.expiry_levels_daily() as again \gset
select t.ok((select count(*) from public.price_levels where markdown_id = :'md') = 2, 'only once');

\set QUIET off
select count(*) as assertions_passed from t.results;
