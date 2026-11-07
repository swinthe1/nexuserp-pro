-- =============================================================================
-- "Raporti i stokut", phase 2: the stock over a period, the stock free to sell, the goods that do not move and the days
-- the stock lasts.  (on "Stoku Test" of 105)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select email as boss from public.profiles where is_super_admin limit 1 \gset
select id as co from public.companies where name = 'Stoku Test' \gset
select id as wh from public.warehouses where company_id = :'co' and deleted_at is null order by created_at limit 1 \gset
select id as m1 from public.warehouses where company_id = :'co' and code = 'M1' \gset

set role authenticated;
select t.login(:'boss');
select public.stock_analysis(:'co', jsonb_build_object('report', 'movement', 'from', current_date - 30, 'to', current_date)) as mv \gset
select public.stock_analysis(:'co', jsonb_build_object('report', 'movement', 'split', true, 'from', current_date - 30, 'to', current_date)) as mvs \gset
select public.stock_analysis(:'co', jsonb_build_object('report', 'movement', 'from', current_date - 30, 'to', current_date - 4)) as mvy \gset
select public.stock_analysis(:'co', jsonb_build_object('report', 'movement', 'from', current_date - 2, 'to', current_date)) as mv2 \gset
select public.stock_analysis(:'co', '{"report": "availability", "split": true}') as av \gset
select public.stock_analysis(:'co', '{"report": "slow"}') as sl \gset
select public.stock_analysis(:'co', '{"report": "slow", "classes": ["dead"]}') as dead \gset
select public.stock_analysis(:'co', '{"report": "cover", "days": 30}') as cv \gset
reset role;

select t.ok((select (x ->> 'opening_qty')::numeric = 0 and (x ->> 'purchase_in')::numeric = 140 and (x ->> 'in_value')::numeric = 78
                and (x ->> 'qty')::numeric = 140 and (x ->> 'value')::numeric = 78
               from jsonb_array_elements(:'mv'::jsonb -> 'rows') x where x ->> 'code' = 'JOG'),
            'the period: nothing at the start, 140 bought for 78, 140 at the end');
select t.ok((select bool_and((x ->> 'opening_qty')::numeric + (x ->> 'in_qty')::numeric - (x ->> 'out_qty')::numeric = (x ->> 'qty')::numeric
                and (x ->> 'opening_value')::numeric + (x ->> 'in_value')::numeric - (x ->> 'out_value')::numeric + (x ->> 'revaluation')::numeric = (x ->> 'value')::numeric)
               from jsonb_array_elements(:'mv'::jsonb -> 'rows') x), 'opening + in − out = closing, in quantity and in value');
select t.ok((select array_agg((x ->> 'purchase_in')::numeric order by (x ->> 'purchase_in')::numeric) = array[40, 100]::numeric[]
               from jsonb_array_elements(:'mvs'::jsonb -> 'rows') x where x ->> 'code' = 'JOG'), 'a row per unit: 100 into the warehouse, 40 into the market');
select t.ok(jsonb_array_length(:'mvy'::jsonb -> 'rows') = 0, 'a period that ends before the goods came: nothing');
select t.ok((select (x ->> 'opening_qty')::numeric = 100 and (x ->> 'opening_value')::numeric = 50 and (x ->> 'purchase_in')::numeric = 40
               from jsonb_array_elements(:'mv2'::jsonb -> 'rows') x where x ->> 'code' = 'JOG'), 'a later period opens with what came before it');
select t.ok((select (x ->> 'available')::numeric = 100 and (x ->> 'projected')::numeric = 100 and (x ->> 'to_order')::numeric = 900
               from jsonb_array_elements(:'av'::jsonb -> 'rows') x where x ->> 'code' = 'JOG' and x ->> 'unit_id' = :'wh'),
            'free to sell 100, below the minimum of 500: order 900 up to the maximum');
select t.ok((select x ->> 'class' = 'new' and (x ->> 'sold')::numeric = 0 from jsonb_array_elements(:'sl'::jsonb -> 'rows') x where x ->> 'code' = 'JOG'),
            'bought this month and not sold yet: new, not dead');
select t.ok(jsonb_array_length(:'dead'::jsonb -> 'rows') = 0, 'by class');
select t.ok((select x ->> 'cover' = 'no_sales' and x ->> 'cover_days' is null from jsonb_array_elements(:'cv'::jsonb -> 'rows') x where x ->> 'code' = 'JOG'),
            'no sales: no days of cover to count');

set role authenticated;
select t.login('cora@kt.al');
select t.throws(format($q$select public.stock_analysis(%L, '{}')$q$, :'co'), 'Permission', 'not for another company');
select t.login(:'boss');
select t.throws(format($q$select public.stock_analysis(%L, '{"report": "nope"}')$q$, :'co'), 'Unknown report', 'a report we know');
select t.throws(format($q$select public.stock_analysis(%L, jsonb_build_object('report', 'movement', 'from', current_date, 'to', current_date - 3))$q$, :'co'), 'Check the dates', 'the dates in order');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
