-- =============================================================================
-- A copy of a fiscal coupon is a row of the SEF log: which coupon, which copy, by whom; in the hash chain.
-- (after 152 on "Kontrolle Test", till T10: its fiscal sales)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select o.id as ord, o.session_id as ses, (o.atk ->> 'coupon_id')::bigint as no from public.pos_orders o
 where o.company_id = :'co' and coalesce(o.atk ->> 'details', '') <> '' order by o.order_at desc limit 1 \gset
select o.id as plain from public.pos_orders o where o.company_id = :'co' and coalesce(o.atk ->> 'details', '') = '' limit 1 \gset
set role authenticated;
select t.login(:'boss');
select t.ok(public.atk_copy_printed(:'ord') = 1, 'the first copy of a coupon is copy 1');
select t.ok(public.atk_copy_printed(:'ord') = 2, 'the second is copy 2');
select t.ok(public.atk_copy_printed(:'plain') = 0, 'a receipt that is not fiscal leaves nothing in the SEF log');
select t.ok((public.atk_copy_counts(:'ses') ->> :'ord')::int = 2, 'the shift knows how many copies each coupon has had');
select t.ok((public.atk_log_verify(:'co') ->> 'ok')::boolean, 'the chain of the log still holds with the copies in it');
select t.login('pronari@arberi.xk');
select t.throws(format('select public.atk_copy_printed(%L)', :'ord'), 'Receipt not found', 'not for another company');
select t.throws(format('select public.atk_copy_counts(%L)', :'ses'), 'Shift not found', 'nor its shifts');
reset role;
select t.ok((select count(*) = 2 and bool_and(coupon_no = :no and hash is not null and details ? 'number') from public.atk_events
              where company_id = :'co' and kind = 'copy' and details ->> 'order_id' = :'ord'), 'both copies are rows of the log, with the coupon''s number');
\set QUIET off
select count(*) as assertions_passed from t.results;
