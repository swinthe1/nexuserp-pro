-- =============================================================================
-- From the meeting with the administrative staff: sales and purchase analysis (#23) and the
-- profit report by month and by unit (#24). (runs after 69 "Agjent Test", 78)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Agjent Test' \gset
set role authenticated;
select t.login('drita@agjent.xk');

-- ---------------------------------------------------------------- 23. analysis
select public.trade_analysis(:'co', jsonb_build_object('kind', 'sales', 'from', current_date - 400, 'to', current_date + 1, 'group_by', 'unit', 'cmp_from', current_date - 800, 'cmp_to', current_date - 401)) as by_unit \gset
select public.trade_analysis(:'co', jsonb_build_object('kind', 'sales', 'from', current_date - 400, 'to', current_date + 1, 'group_by', 'item')) as by_item \gset
select t.ok(jsonb_typeof(:'by_unit'::jsonb -> 'rows') = 'array' and (:'by_unit'::jsonb ->> 'currency') is not null, 'the analysis gives rows and the currency');
select t.ok((select coalesce(sum((r -> 'a' ->> 'net')::numeric), 0) from jsonb_array_elements(:'by_unit'::jsonb -> 'rows') r)
          = (select coalesce(sum((r -> 'a' ->> 'net')::numeric), 0) from jsonb_array_elements(:'by_item'::jsonb -> 'rows') r), 'by unit and by item add up to the same sales');
select t.ok(not exists (select 1 from jsonb_array_elements(:'by_unit'::jsonb -> 'rows') r
   where abs((r -> 'a' ->> 'gross')::numeric - (r -> 'a' ->> 'net')::numeric - (r -> 'a' ->> 'vat')::numeric) > 0.02), 'with VAT = without VAT + VAT, on every row');
select t.ok(not exists (select 1 from jsonb_array_elements(:'by_unit'::jsonb -> 'rows') r
   where abs((r -> 'a' ->> 'margin')::numeric - ((r -> 'a' ->> 'net')::numeric - (r -> 'a' ->> 'cost')::numeric)) > 0.02), 'margin = sales without VAT less their cost');
select t.ok(jsonb_typeof(public.trade_analysis(:'co', jsonb_build_object('kind', 'purchases', 'from', current_date - 30, 'to', current_date, 'group_by', 'supplier')) -> 'rows') = 'array', 'purchases by supplier');
select t.ok(jsonb_typeof(public.trade_analysis(:'co', jsonb_build_object('kind', 'sales', 'from', current_date - 30, 'to', current_date, 'group_by', 'group', 'units', jsonb_build_array(gen_random_uuid()))) -> 'rows') = 'array', 'a unit filter that matches nothing gives no rows, not an error');
select t.throws(format($q$select public.trade_analysis(%L, '{"kind":"stock","from":"2026-01-01","to":"2026-02-01"}')$q$, :'co'), 'Choose sales or purchases', 'only sales or purchases');
select t.throws(format($q$select public.trade_analysis(%L, '{"kind":"sales","from":"2026-01-01","to":"2026-02-01","group_by":"colour"}')$q$, :'co'), 'Cannot group by', 'only the known groupings');
select t.throws(format($q$select public.trade_analysis(%L, '{"kind":"sales","from":"2026-03-01","to":"2026-02-01"}')$q$, :'co'), 'Check the dates', 'the end before the start is refused');
select t.throws(format($q$select public.trade_analysis(%L, '{"kind":"sales","from":"2020-01-01","to":"2026-02-01"}')$q$, :'co'), 'At most three years', 'not more than three years at once');

-- ---------------------------------------------------------------- 24. profit
select public.profit_report(:'co', jsonb_build_object('from', current_date - 400, 'to', current_date + 1, 'by', 'month')) as pm \gset
select public.profit_report(:'co', jsonb_build_object('from', current_date - 400, 'to', current_date + 1, 'by', 'unit', 'shared', 'split')) as pu \gset
select t.ok(jsonb_array_length(:'pm'::jsonb -> 'columns') >= 13, 'a column for every month of the period');
select t.ok(not exists (select 1 from jsonb_each(:'pm'::jsonb -> 'cells') c
   where abs((c.value ->> 'net_profit')::numeric - ((c.value ->> 'gross_profit')::numeric - (c.value ->> 'opex')::numeric - (c.value ->> 'other_expense')::numeric
       + (c.value ->> 'other_income')::numeric - (c.value ->> 'interest')::numeric)) > 0.02), 'net profit = gross profit − expenses + other income − interest, every month');
select t.ok(not exists (select 1 from jsonb_each(:'pm'::jsonb -> 'cells') c
   where abs((c.value ->> 'gross_profit')::numeric - ((c.value ->> 'net_sales')::numeric - (c.value ->> 'cogs')::numeric)) > 0.02), 'gross profit = net sales − cost of goods');
select t.ok(abs((select sum((c.value ->> 'net_sales')::numeric) from jsonb_each(:'pm'::jsonb -> 'cells') c)
              - (select sum((c.value ->> 'net_sales')::numeric) from jsonb_each(:'pu'::jsonb -> 'cells') c)) < 0.05, 'by month and by unit, the same sales');
select t.ok(abs((select sum((c.value ->> 'net_profit')::numeric) from jsonb_each(:'pm'::jsonb -> 'cells') c)
              - (select sum((c.value ->> 'net_profit')::numeric) from jsonb_each(:'pu'::jsonb -> 'cells') c)) < 0.05, 'shared expenses split by sales: the total profit does not change');
select t.ok(not (:'pu'::jsonb -> 'cells') ? 'shared', 'split by sales: no column of shared expenses is left');
select t.throws(format($q$select public.profit_report(%L, '{"from":"2026-01-01","to":"2026-02-01","by":"week"}')$q$, :'co'), 'Show it by month or by unit', 'by month or by unit only');

-- a cashier sees neither
select t.login('vesa@agjent.xk');
select t.throws(format($q$select public.trade_analysis(%L, '{"kind":"sales","from":"2026-01-01","to":"2026-02-01"}')$q$, :'co'), 'Permission denied', 'a cashier does not see the analysis');
select t.throws(format($q$select public.profit_report(%L, '{"from":"2026-01-01","to":"2026-02-01"}')$q$, :'co'), 'Permission denied', 'nor the profit');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
