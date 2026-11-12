-- =============================================================================
-- What a fiscal coupon would print without: the unit's address, town and number, the cashier's number. (on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select w.id as wh, w.name as whn, coalesce(w.address_line1, '') as a0, coalesce(w.atk_unit_no, '') as u0 from public.warehouses w
 where w.company_id = :'co' and exists (select 1 from public.pos_registers r where r.warehouse_id = w.id and r.deleted_at is null and r.is_active) order by w.name limit 1 \gset
select coalesce(address_line1, '') as ca0 from public.companies where id = :'co' \gset
update public.warehouses set address_line1 = null, atk_unit_no = null where id = :'wh';
update public.companies set address_line1 = null where id = :'co';
set role authenticated;
select t.login(:'boss');
select t.ok((select count(*) = 1 from jsonb_array_elements(public.atk_coupon_gaps(:'co')) g where g ->> 'what' = 'address' and g ->> 'name' = :'whn'), 'a unit with no address is listed');
select t.ok((select count(*) = 1 from jsonb_array_elements(public.atk_coupon_gaps(:'co')) g where g ->> 'what' = 'unit_no' and g ->> 'name' = :'whn'), 'and one with no unit number');
reset role;
update public.warehouses set address_line1 = 'Rr. Provë 1', atk_unit_no = '5130484' where id = :'wh';
set role authenticated;
select t.ok((select count(*) = 0 from jsonb_array_elements(public.atk_coupon_gaps(:'co')) g where g ->> 'name' = :'whn' and g ->> 'what' in ('address', 'unit_no')), 'filled in, they are no longer listed');
select t.login('pronari@arberi.xk');
select t.throws(format('select public.atk_coupon_gaps(%L)', :'co'), '', 'not for another company');
reset role;
update public.warehouses set address_line1 = nullif(:'a0', ''), atk_unit_no = nullif(:'u0', '') where id = :'wh';
update public.companies set address_line1 = nullif(:'ca0', '') where id = :'co';
\set QUIET off
select count(*) as assertions_passed from t.results;
