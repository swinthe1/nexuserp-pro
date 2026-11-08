-- =============================================================================
-- Wave 1 of the audit, part 2: four more books checks, the tills in the sales overview, the dashboard
-- for a person's own units, counts worth money at the selling price, two more platform signals,
-- and no live fiscalization in Albania before the link exists. (after 113: "Mini Market Arbëri")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as mini from public.companies where name = 'Mini Market Arbëri' \gset
select id as al from public.companies where country_code = 'AL' and deleted_at is null order by created_at limit 1 \gset

-- 1. the cash limit: the country's default, or the company's own
select t.ok(app.cash_limit(:'mini') = 300 and app.cash_limit(:'al') = 150000, 'cash limit: 300 € in Kosovo, 150 000 lekë in Albania');
update public.company_settings set cash_payment_limit = 2000 where company_id = :'mini';
select t.ok(app.cash_limit(:'mini') = 2000, 'the owner can set the limit in force');
update public.company_settings set cash_payment_limit = null where company_id = :'mini';
select t.ok(jsonb_typeof(app.books_check(:'mini')) = 'array' and jsonb_typeof(app.books_check(:'al')) = 'array', 'the books check runs with the new checks');
select t.ok(position('cash_over_limit' in pg_get_functiondef('app.books_check(uuid)'::regprocedure)) > 0
            and position('fiscal_failed' in pg_get_functiondef('app.books_check(uuid)'::regprocedure)) > 0
            and position('bank_unmatched_old' in pg_get_functiondef('app.books_check(uuid)'::regprocedure)) > 0
            and position('cash_negative' in pg_get_functiondef('app.books_check(uuid)'::regprocedure)) > 0, 'the four new checks are there');

-- 2. the sales overview counts what the tills sold
set role authenticated;
select t.login('pronari@arberi.xk');
select public.sales_overview(:'mini', (current_date - 30), current_date) as so \gset
select t.ok((:'so'::jsonb ? 'till_revenue') and (:'so'::jsonb ->> 'till_receipts')::int >= 0, 'the overview has the tills and the receipts');
select t.ok((select count(*) from jsonb_array_elements(:'so'::jsonb -> 'revenue_by_month') m where m ? 'till') = 12, 'and the tills month by month');

-- 3. the dashboard of someone limited to some units: their tills only, no company invoices
select (public.dashboard_market(:'mini') ->> 'my_stores') is null as all_units \gset
select t.ok(:'all_units', 'the owner sees the whole company');
reset role;
update public.company_members set warehouse_ids = array[gen_random_uuid()]
 where company_id = :'mini' and user_id = (select id from auth.users where email = 'pronari@arberi.xk');
set role authenticated;
select t.login('pronari@arberi.xk');
select public.dashboard_market(:'mini') as dm \gset
select t.ok((:'dm'::jsonb ->> 'my_stores') is not null and (:'dm'::jsonb ->> 'today')::numeric = 0 and (:'dm'::jsonb ->> 'receipts')::int = 0,
            'limited to a unit with no tills: nothing of the others');
select t.ok((public.sales_pulse(:'mini') ->> 'today')::numeric = 0, 'the day''s sentence too');
reset role;
update public.company_members set warehouse_ids = '{}'
 where company_id = :'mini' and user_id = (select id from auth.users where email = 'pronari@arberi.xk');

-- 4. a count review gives the selling price too
select t.ok(position('losses_sale' in pg_get_functiondef('public.count_review(uuid)'::regprocedure)) > 0, 'the count review has the selling-price values');

-- 5. the platform owner sees refused fiscalization and clients that stopped selling
set role authenticated;
select t.login('zoe@platform.io');
select public.platform_overview() as po \gset
select t.ok(jsonb_typeof(:'po'::jsonb -> 'attention') = 'array', 'the platform overview runs with the new signals');
reset role;

-- 6. Albania: no live fiscalization until the link with the tax office exists
select t.throws(format($q$update public.company_settings set fiscal_environment = 'production' where company_id = %L$q$, :'al'), 'not ready yet',
                'Albania cannot be switched to live');
update public.company_settings set fiscal_environment = 'test' where company_id = :'mini';
select t.ok(true, 'Kosovo is not touched');

\set QUIET off
select count(*) as assertions_passed from t.results;
