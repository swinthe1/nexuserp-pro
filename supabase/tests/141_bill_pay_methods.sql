-- =============================================================================
-- How each purchase bill was paid (cash, bank, both): every paid bill is in it, and only for those who see invoices.
-- (after 117: the Mini market "Mini Market Arbëri")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as mini from public.companies where name = 'Mini Market Arbëri' \gset

set role authenticated;
select t.login('pronari@arberi.xk');
select public.bill_pay_methods(:'mini') as w \gset
select t.ok(jsonb_typeof(:'w'::jsonb) = 'object'
        and not exists (select 1 from jsonb_each_text(:'w'::jsonb) e where e.value not in ('cash', 'bank', 'mixed')),
        'each paid bill is cash, bank or mixed');
reset role;
select t.ok((select count(distinct a.vendor_bill_id) from public.payment_allocations a join public.payments p on p.id = a.payment_id
              where a.company_id = :'mini' and a.vendor_bill_id is not null and p.deleted_at is null and p.status = 'posted' and p.reversed_at is null)
            = (select count(*) from jsonb_object_keys(:'w'::jsonb)), 'every bill with a payment is there');

select u.email as outsider from auth.users u
 where not exists (select 1 from public.company_members m where m.user_id = u.id and m.company_id = :'mini' and m.status = 'active')
   and not coalesce((select p.is_super_admin from public.profiles p where p.id = u.id), false)
 limit 1 \gset
set role authenticated;
select t.login(:'outsider');
select t.throws(format('select public.bill_pay_methods(%L)', :'mini'), 'Permission denied', 'someone outside the company sees nothing');
reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
