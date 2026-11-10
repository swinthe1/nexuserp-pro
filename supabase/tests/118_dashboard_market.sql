-- =============================================================================
-- The market's numbers on the dashboard: today against a week ago, the tills, the margin, goods that
-- expire or do not sell. Each part only for those who may see it; nothing for someone outside.
-- (after 117: the Mini market "Mini Market Arbëri")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as mini, coalesce(timezone, 'Europe/Tirane') as tz from public.companies where name = 'Mini Market Arbëri' \gset

-- 1. the owner sees every part, and today is the same as in the day's sentence
set role authenticated;
select t.login('pronari@arberi.xk');
select public.dashboard_market(:'mini') as d \gset
select t.ok(:'d'::jsonb ?& array['today', 'week_ago', 'receipts', 'month', 'month_margin', 'cash_in_tills', 'open_shifts', 'till_diff',
                                  'voids_today', 'refunds_today', 'expiring_week', 'out_of_stock_selling', 'dead_value', 'price_changes',
                                  'receipts_waiting_invoice'], 'the owner sees the tills, the goods and the money');
select t.ok((:'d'::jsonb ->> 'today')::numeric = (public.sales_pulse(:'mini') ->> 'today')::numeric, 'today is the same as in the day''s sentence');
select t.ok((:'d'::jsonb ->> 'cash_in_tills')::numeric >= 0 and (:'d'::jsonb ->> 'open_shifts')::int >= 0, 'the cash in the open tills is a plain sum');
select t.ok((:'d'::jsonb ->> 'month_margin_pct') is null or (:'d'::jsonb ->> 'month_margin_pct')::numeric between -100 and 100, 'the margin is a percent');
select t.ok(:'d'::jsonb ?& array['today_net', 'today_margin'] and ((:'d'::jsonb ->> 'today_margin_pct') is null or (:'d'::jsonb ->> 'today_margin_pct')::numeric between -100 and 100)
        and (:'d'::jsonb ->> 'today_net')::numeric <= (:'d'::jsonb ->> 'month_net')::numeric + 0.01 or (:'d'::jsonb ->> 'today_net')::numeric < 0, 'today''s margin: a percent, of a part of the month''s sales');

-- 2. not for someone outside the company
reset role;
select u.email as outsider from auth.users u
 where not exists (select 1 from public.company_members m where m.user_id = u.id and m.company_id = :'mini' and m.status = 'active')
   and not coalesce((select p.is_super_admin from public.profiles p where p.id = u.id), false)
 limit 1 \gset
set role authenticated;
select t.login(:'outsider');
select t.throws(format('select public.dashboard_market(%L)', :'mini'), 'Not a member', 'someone outside the company sees nothing');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
