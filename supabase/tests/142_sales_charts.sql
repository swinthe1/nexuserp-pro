-- =============================================================================
-- The figures behind the charts: the months, the days, the hours and the categories add up to the same sales,
-- and someone outside the company sees nothing. (after 141: the Mini market "Mini Market Arbëri")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as mini from public.companies where name = 'Mini Market Arbëri' \gset
select coalesce(max(o.order_at)::date, current_date) as last_day from public.pos_orders o where o.company_id = :'mini' and o.status = 'paid' \gset

set role authenticated;
select t.login('pronari@arberi.xk');
select public.sales_charts(:'mini', :'last_day') as c \gset
select public.sales_daily(:'mini', date_trunc('month', :'last_day'::date)::date, :'last_day'::date) as d \gset
select t.ok(jsonb_array_length(:'c'::jsonb -> 'months') = 24, 'the charts get 24 months');
select t.ok(abs(((:'c'::jsonb -> 'months' -> 23 ->> 'till')::numeric)
              - (select coalesce(sum((x ->> 'till')::numeric), 0) from jsonb_array_elements(:'d'::jsonb) x)) < 0.05,
            'the month at the tills is the sum of its days');
select t.ok(abs(((:'c'::jsonb -> 'months' -> 23 ->> 'till')::numeric)
              - (select coalesce(sum((x ->> 'net')::numeric), 0) from jsonb_array_elements(:'c'::jsonb -> 'hours') x)) < 0.05,
            'and the sum of its hours');
select t.ok(abs(((:'c'::jsonb -> 'months' -> 23 ->> 'till')::numeric) + ((:'c'::jsonb -> 'months' -> 23 ->> 'invoices')::numeric)
              - (select coalesce(sum((x ->> 'net')::numeric), 0) from jsonb_array_elements(:'c'::jsonb -> 'categories') x)) < 0.05,
            'and the sum of its categories');
select t.ok((:'c'::jsonb ->> 'costs')::boolean and (:'c'::jsonb -> 'months' -> 23 ->> 'cost') is not null, 'the owner sees what the goods cost');
select t.ok(jsonb_array_length(public.purchase_months(:'mini')) = 24, 'the purchases get 24 months');
select t.ok(jsonb_typeof(public.finance_waterfall(:'mini', date_trunc('month', :'last_day'::date)::date, :'last_day'::date) -> 'expenses') = 'array',
            'the way from the sales to the profit has its costs');
reset role;

select u.email as outsider from auth.users u
 where not exists (select 1 from public.company_members m where m.user_id = u.id and m.company_id = :'mini' and m.status = 'active')
   and not coalesce((select p.is_super_admin from public.profiles p where p.id = u.id), false)
 limit 1 \gset
set role authenticated;
select t.login(:'outsider');
select t.throws(format('select public.sales_charts(%L)', :'mini'), 'Not allowed', 'someone outside the company sees no charts');
select t.throws(format('select public.sales_daily(%L, current_date - 7, current_date)', :'mini'), 'Not allowed', 'nor the days');
reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
