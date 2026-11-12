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
-- a support account that is not a user of the company is not listed as a cashier without a number
reset role;
select id as reg from public.pos_registers where company_id = :'co' and deleted_at is null limit 1 \gset
select coalesce((select p.id::text from public.profiles p where not exists (select 1 from public.company_members m where m.company_id = :'co' and m.user_id = p.id)
  and not exists (select 1 from public.pos_sessions s where s.company_id = :'co' and s.opened_by = p.id) limit 1), '') as sup \gset
set session_replication_role = replica;
insert into public.pos_sessions (company_id, register_id, number, opened_by, opened_at, status, closed_at)
  select :'co', :'reg', 'T-SUP-157', :'sup'::uuid, now() - interval '2 days', 'closed', now() - interval '2 days' where :'sup' <> '';
set session_replication_role = origin;
select t.login(:'boss');
set role authenticated;
select t.ok((select count(*) = 0 from jsonb_array_elements(public.atk_coupon_gaps(:'co')) g, public.profiles p
  where g ->> 'what' = 'operator_no' and :'sup' <> '' and p.id = :'sup'::uuid and g ->> 'name' = coalesce(nullif(p.full_name, ''), p.email)
    and not exists (select 1 from public.profiles q join public.company_members m on m.user_id = q.id and m.company_id = :'co' where q.id <> p.id and coalesce(nullif(q.full_name, ''), q.email) = g ->> 'name')),
  'a support account outside the company is not listed');
reset role;
set session_replication_role = replica;
delete from public.pos_sessions where company_id = :'co' and number = 'T-SUP-157';
set session_replication_role = origin;
update public.warehouses set address_line1 = nullif(:'a0', ''), atk_unit_no = nullif(:'u0', '') where id = :'wh';
update public.companies set address_line1 = nullif(:'ca0', '') where id = :'co';
\set QUIET off
select count(*) as assertions_passed from t.results;
