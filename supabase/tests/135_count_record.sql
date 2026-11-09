-- =============================================================================
-- The stock count record (procesverbali): the commission, who counted, and the differences as they were adjusted.
-- (after 134, on "Kontrolle Test": the session of 131 is posted)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select id as ses from public.count_sessions where company_id = :'co' and name = 'Inventari i nëntorit' \gset
select id as posted_list, adjustment_id as adj from public.cycle_counts where session_id = :'ses' and status = 'posted' and adjustment_id is not null limit 1 \gset

set role authenticated;
-- 1. the manager writes the commission and the person responsible; empty rows are dropped
select t.login('zoe@platform.io');
select public.count_record_save(:'ses', null, '{"commission": [{"name": "Arta Krasniqi", "role": "Kryetare"}, {"name": "  "}, {"name": "Blerim Gashi", "role": "Anëtar"}],
                                               "keeper": "Besa Hoxha", "notes": "Numërim me dyqan të hapur"}'::jsonb) as rec \gset
select t.ok(jsonb_array_length(:'rec'::jsonb -> 'commission') = 2 and :'rec'::jsonb ->> 'keeper' = 'Besa Hoxha', 'the commission and the person responsible are kept, empty rows dropped');
select t.throws(format($q$select public.count_record_save('%s', '%s', '{}')$q$, :'ses', :'posted_list'), 'session or a count', 'a session or a count, not both');

-- 2. the record: posted, with the adjustment, who counted, and the lines as adjusted
select public.count_record(:'ses') as r \gset
select t.ok((:'r'::jsonb ->> 'posted')::boolean and jsonb_array_length(:'r'::jsonb -> 'adjustments') >= 1, 'the record says it is posted, with the adjustments');
select t.ok(jsonb_array_length(:'r'::jsonb -> 'record' -> 'commission') = 2 and :'r'::jsonb -> 'company' ->> 'name' is not null, 'with the company and the commission');
select t.ok(exists (select 1 from jsonb_array_elements(:'r'::jsonb -> 'counters') x where x ->> 'name' is not null and (x ->> 'items')::int >= 1), 'and who counted how many items');
reset role;
select t.ok((select coalesce(sum(quantity_change), 0) from public.stock_adjustment_lines where adjustment_id = :'adj')
            = (select coalesce(sum((x ->> 'delta')::numeric), 0) from jsonb_array_elements(:'r'::jsonb -> 'lines') x
                where x ->> 'sku' in (select v.sku from public.cycle_count_lines l join public.product_variants v on v.id = l.variant_id where l.cycle_count_id = :'posted_list')),
  'the differences are what was adjusted, not what the stock is now');
select t.ok(not exists (select 1 from jsonb_array_elements(:'r'::jsonb -> 'lines') x
                         where (x ->> 'expected')::numeric <> (x ->> 'counted')::numeric - (x ->> 'delta')::numeric
                            or (x ->> 'value')::numeric <> round((x ->> 'delta')::numeric * (x ->> 'unit_cost')::numeric, 2)), 'each line adds up');
select t.ok((:'r'::jsonb -> 'totals' ->> 'lines')::int = jsonb_array_length(:'r'::jsonb -> 'lines'), 'the totals count every line');

-- 3. only managers read and write it
set role authenticated;
select t.login('cora@kt.al');
select t.throws(format($q$select public.count_record('%s')$q$, :'ses'), 'Permission denied', 'only a manager reads the record');
select t.login('besa@kt.al');
select t.throws(format($q$select public.count_record_save('%s', null, '{}')$q$, :'ses'), 'Permission denied', 'a counter does not write the commission');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
