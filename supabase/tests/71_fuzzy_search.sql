-- =============================================================================
-- DrisPRO · search that forgives (runs after 69: the shop "Agjent Test" and its Kaçkavall)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Agjent Test' \gset

-- ----------------------------------------------------------------------------- the rules
select t.ok(app.search_norm('Qumësht i freskët 2,8% 1L') = 'qumesht i fresket 2.8 1 l', 'accents, decimal commas and "1L" are written one way');
select t.ok(app.fuzzy_score('Qumësht i freskët 2,8% 1 L', 'qumesht fresket 1l') > 0, 'without the accents, in any order');
select t.ok(app.fuzzy_score('Kaçkavall 400 g', 'kac') > 0, 'the start of a word');
select t.ok(app.fuzzy_score('Kaçkavall 400 g', 'kaqkavall') > 0, 'written the way it sounds');
select t.ok(app.fuzzy_score('Detergjent enësh 1 L', 'detergjnet enesh') > 0, 'a typo in a long word');
select t.ok(app.fuzzy_score('Coca-Cola 0,5 L', 'kokakola') > 0, 'two words written as one, the way they sound');
select t.ok(app.fuzzy_score('Coca-Cola 0,5 L', 'cola 0.5') > 0 and app.fuzzy_score('Coca-Cola 0,5 L', 'cola 2') = 0, 'numbers match only as numbers');
select t.ok(app.fuzzy_score('Coca-Cola 0,5 L', 'cola fanta') = 0, 'every word has to be found');
select t.ok(app.fuzzy_score('Çokollatë', '3800123456789', array['3800123456789']) = 1000, 'a barcode typed whole wins');
select t.ok(app.fuzzy_score('Faturë', '12', array['FAT-2026-00012']) > 0, 'the end of a document number');

-- ----------------------------------------------------------------------------- the agent and the search box
set role authenticated;
select t.login('drita@agjent.xk');
select id as pcs from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'Q-28', 'name', 'Qumësht i freskët 2,8% 1 L', 'uom_id', :'pcs', 'sales_price', 0.99));
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'Q-15', 'name', 'Qumësht i freskët 1,5% 1 L', 'uom_id', :'pcs', 'sales_price', 0.95));
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'J-Q', 'name', 'Jogurt qumështi 150 g', 'uom_id', :'pcs', 'sales_price', 0.45));
select public.ai_find_items(:'co', 'qumsht fresket') as f1 \gset
select t.ok(jsonb_array_length(:'f1'::jsonb) = 2 and (select bool_and(x ->> 'name' ilike 'qumësht i freskët%') from jsonb_array_elements(:'f1'::jsonb) x),
            'the agent finds the milk from a misspelled question');
select t.ok(exists (select 1 from public.global_search(:'co', 'kaqkavall') g where g.kind = 'product' and g.title ilike 'kaçkavall%'), 'so does the search box');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
