-- =============================================================================
-- The market's till: search on the server (a code whole first, names that forgive), quick buttons chosen
-- by the manager, the stock at the till among what changed, the lock opened with the cashier's PIN or a
-- manager's.  (on "Kontrolle Test" of 64 and the tills of 108)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select id as till from public.pos_registers where company_id = :'co' and code = 'T21' \gset
select location_id as floor from public.pos_registers where id = :'till' \gset
select v.id as beer, v.sku as beer_sku, v.name as beer_name from public.product_variants v join public.products p on p.id = v.product_id
 where p.company_id = :'co' and p.code = 'KT-BEER' \gset
select v.id as other from public.product_variants v where v.company_id <> :'co' limit 1 \gset
select m.id as cora_m from public.company_members m join public.profiles p on p.id = m.user_id where m.company_id = :'co' and p.email = 'cora@kt.al' \gset
select m.id as besa_m from public.company_members m join public.profiles p on p.id = m.user_id where m.company_id = :'co' and p.email = 'besa@kt.al' \gset
update public.company_settings set pos_review = 'off' where company_id = :'co';

-- 1. search: the code typed whole comes first; a name with a typo and without ë still finds it
set role authenticated;
select t.login('cora@kt.al');
select t.ok((select variant_id = :'beer' and score = 1000 from public.pos_search(:'till', :'beer_sku', 5) limit 1), 'the code typed whole comes first');
select left(:'beer_name', 5) as part \gset
select t.ok(exists (select 1 from public.pos_search(:'till', lower(:'part'), 20) where variant_id = :'beer'), 'the start of the name finds it');
select t.ok((select count(*) = 0 from public.pos_search(:'till', '   ', 20)), 'nothing typed, nothing found');
select t.ok((select bool_and(price is not null and on_hand is not null) from public.pos_search(:'till', :'beer_sku', 5)), 'with the till''s price and stock');

-- 2. quick buttons: the manager chooses them, once each, only this company's items, at most 24
select t.throws(format($q$select public.pos_quick_items_set(%L, array[%L]::uuid[])$q$, :'till', :'beer'), 'ermission', 'a cashier does not change the quick buttons');
select t.login('besa@kt.al');
select t.ok(public.pos_quick_items_set(:'till', array[:'beer', :'beer', :'other']::uuid[]) = array[:'beer']::uuid[], 'once each, and another company''s item is left out');
select t.ok(public.pos_quick_items_set(:'till', array[gen_random_uuid(), :'beer']::uuid[]) = array[:'beer']::uuid[], 'an item that does not exist is left out');
select t.login('cora@kt.al');
select t.ok(public.pos_quick_items(:'till') -> 'pinned' = jsonb_build_array(:'beer'), 'the till reads its quick buttons');
select t.ok(jsonb_typeof(public.pos_quick_items(:'till') -> 'top') = 'array', 'and what sells most there');

-- 3. what changed since the till last looked: the stock at the till too
reset role;
select clock_timestamp() - interval '1 second' as since \gset
update public.stock_levels set on_hand = on_hand where variant_id = :'beer' and location_id = :'floor';
select count(*) as had_stock from public.stock_levels where variant_id = :'beer' and location_id = :'floor' \gset
set role authenticated;
select t.login('cora@kt.al');
select public.pos_catalog_changes(:'till', :'since') as ch \gset
select t.ok(:'had_stock'::int = 0 or (not (:'ch'::jsonb ->> 'full')::boolean and :'ch'::jsonb -> 'items' @> jsonb_build_array(jsonb_build_object('variant_id', :'beer'))),
  'a change of stock at the till is among what changed');

-- 4. the lock: the cashier's own PIN, five tries; a manager's PIN opens it too
select t.ok((public.pos_unlock(:'till', '4826') ->> 'no_pin')::boolean, 'without a PIN she is told to choose one');
select t.ok((public.pos_my_pin(:'co') ->> 'has_pin')::boolean is false, 'the till knows she has none');
select public.member_set_pin(:'cora_m', '4826');
select t.ok((public.pos_my_pin(:'co') ->> 'has_pin')::boolean, 'she chose hers');
select t.ok(public.pos_unlock(:'till', '0000') ->> 'error' = 'Wrong PIN', 'a wrong PIN does not open it');
select t.ok((public.pos_unlock(:'till', '4826') ->> 'ok')::boolean, 'her PIN opens it');
select public.pos_unlock(:'till', '0000'), public.pos_unlock(:'till', '0000'), public.pos_unlock(:'till', '0000'), public.pos_unlock(:'till', '0000') \gset x
select t.ok(public.pos_unlock(:'till', '0000') ->> 'error' like 'Too many wrong PINs%', 'five wrong PINs: ten minutes of waiting');
select t.ok(public.pos_unlock(:'till', '4826') ->> 'error' like 'Too many wrong PINs%', 'even the right PIN waits');
select t.ok(public.pos_approve(:'till', :'besa_m', '5917', 'unlock') ->> 'approval' is not null, 'a manager opens the locked till with her PIN');
reset role;
update app.member_pins set failed = 0, locked_until = null where member_id = :'cora_m';

-- 5. the setting: minutes without use before it locks by itself (a manager's choice)
set role authenticated;
select t.login('besa@kt.al');
select public.automation_settings_save(:'co', '{"pos_lock_minutes": 5}');
select t.ok((public.pos_till_options(:'till') ->> 'lock_minutes')::int = 5, 'the till locks itself after 5 minutes');
select t.throws(format($q$select public.automation_settings_save(%L, '{"pos_lock_minutes": 500}')$q$, :'co'), 'lock_minutes', 'at most two hours');
select public.automation_settings_save(:'co', '{"pos_lock_minutes": 0}');
reset role;
select t.ok((select screen = 'auto' and cardinality(quick_items) = 1 from public.pos_registers where id = :'till'), 'a till''s screen follows the kind of business unless set');
update public.company_settings set pos_review = 'manager' where company_id = :'co';

\set QUIET off
select count(*) as assertions_passed from t.results;
