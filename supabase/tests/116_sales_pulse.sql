-- =============================================================================
-- The day in one sentence: today's sales so far against the same weekday a week ago at the same hour,
-- the month against the same days of last month, today's best seller. Also the public contact for the
-- packages page, with no prices in it. (after 115: the Mini market "Mini Market Arbëri")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as mini, coalesce(timezone, 'Europe/Tirane') as tz from public.companies where name = 'Mini Market Arbëri' \gset

-- 1. the same counting as the morning summary: a whole past day gives the same sales
select ((s ->> 'pos_sales')::numeric + (s ->> 'invoiced')::numeric + (s ->> 'old_program_sales')::numeric) as day_sum
  from public.daily_summary(:'mini', (now() at time zone :'tz')::date - 1) s \gset
select t.ok(app.sales_between(:'mini', :'tz', (now() at time zone :'tz')::date - 1, (now() at time zone :'tz')::date - 1, now()) = :day_sum,
            'a whole day counts the same as in the morning summary');
select t.ok(app.sales_between(:'mini', :'tz', (now() at time zone :'tz')::date, (now() at time zone :'tz')::date, now() - interval '30 days') = 0,
            'nothing counts before it was in the program');

-- 2. the owner sees the pulse; its parts fit together
set role authenticated;
select t.login('pronari@arberi.xk');
select public.sales_pulse(:'mini') as p \gset
select t.ok(:'p'::jsonb ?& array['currency', 'today', 'week_ago', 'month', 'prev_month', 'receipts', 'weekday'], 'the pulse has today, the week before and the month');
select t.ok((:'p'::jsonb ->> 'weekday')::int between 1 and 7 and (:'p'::jsonb ->> 'receipts')::int >= 0, 'the weekday and the receipts are plain numbers');
select t.ok((:'p'::jsonb ->> 'today')::numeric = app.sales_between(:'mini', :'tz', (now() at time zone :'tz')::date, (now() at time zone :'tz')::date, now()),
            'today is everything sold since midnight');

-- 3. not for anyone else
reset role;
set role authenticated;
select t.login('alice@alba.al');
select t.throws(format($q$select public.sales_pulse(%L)$q$, :'mini'), '.', 'someone outside the company does not see its sales');
reset role;
set role anon;
select t.throws(format($q$select public.sales_pulse(%L)$q$, :'mini'), '.', 'nobody signed out sees them');

-- 4. the public contact: the ways to reach DrisPRO and nothing about prices
select t.ok(public.public_contact() ?& array['email', 'phone', 'whatsapp'] and not public.public_contact()::text ~ 'price', 'the packages page gets the contact, no prices');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
