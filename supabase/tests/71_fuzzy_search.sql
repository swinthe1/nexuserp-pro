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

-- ----------------------------------------------------------------------------- the supplier's file on the purchase invoice
set role authenticated;
select t.login('drita@agjent.xk');
insert into public.business_partners (company_id, code, name, is_vendor, is_customer) values (:'co', 'FX', 'Furnitori Excel', true, false) returning id as ven \gset
select public.purchase_lines_match(:'co', :'ven', '[{"code":"FX-1","name":"QUMESHT FRESKET 2.8% 1L TETRA"},{"code":"FX-2","name":"Kackavall 400gr"},{"code":"FX-9","name":"Lapsa grafit 2B"}]') as m1 \gset
select t.ok((:'m1'::jsonb -> 0 ->> 'variant_name') = 'Qumësht i freskët 2,8% 1 L' and (:'m1'::jsonb -> 0 ->> 'matched_by') = 'name'
            and (:'m1'::jsonb -> 1 ->> 'variant_name') = 'Kaçkavall 400 g' and (:'m1'::jsonb -> 2 ->> 'variant_id') is null,
            'the supplier''s names find our items, the 2,8% milk and not the 1,5%; a pencil finds nothing');
select public.purchase_line_new_item(:'co', '{"name":"Lapsa grafit 2B","barcode":"3801234567890","vat_rate":18,"cost":0.1}') as ni \gset
select t.ok((:'ni'::jsonb ->> 'bad_barcode') = '3801234567890' and not (:'ni'::jsonb ->> 'existed')::boolean
            and (select p.purchase_tax_code_id is not null and v.sku ~ '^A-\d{5}$' from public.product_variants v join public.products p on p.id = v.product_id where v.id = (:'ni'::jsonb ->> 'variant_id')::uuid),
            'a new item from a line: its own code, VAT 18%, and a mistyped barcode left out');
select public.purchase_line_new_item(:'co', '{"name":"Lapsa grafit HB","barcode":"3801234567898"}') ->> 'variant_id' as ni2 \gset
select t.ok((public.purchase_line_new_item(:'co', '{"name":"Lapsa tjetër","barcode":"3801234567898"}') ->> 'existed')::boolean, 'a barcode we have already is not made twice');
select public.purchase_lines_learn(:'co', :'ven', jsonb_build_array(jsonb_build_object('code', 'FX-9', 'name', 'Lapsa grafit 2B', 'variant_id', :'ni'::jsonb ->> 'variant_id', 'price', 0.1),
                                                                 jsonb_build_object('code', 'FX-2', 'name', 'Kackavall 400gr', 'variant_id', (:'m1'::jsonb -> 1 ->> 'variant_id')))) as learned \gset
select public.purchase_lines_match(:'co', :'ven', '[{"code":"FX-9","name":"LAPSA 2B (12 copë)"},{"code":"FX-2","name":"Djathë i verdhë"}]') as m2 \gset
select t.ok(:learned = 2 and (:'m2'::jsonb -> 0 ->> 'variant_id') = (:'ni'::jsonb ->> 'variant_id') and (:'m2'::jsonb -> 0 ->> 'matched_by') = 'learned'
            and (:'m2'::jsonb -> 1 ->> 'variant_name') = 'Kaçkavall 400 g', 'next time the supplier''s codes find what was linked, whatever the name says');
select t.ok(exists (select 1 from public.vendor_products where vendor_id = :'ven' and vendor_sku = 'FX-9'), 'the supplier''s code is kept on the item');
select t.login('vesa@agjent.xk');
select t.throws(format($q$select public.purchase_line_new_item(%L, '{"name":"Diçka"}')$q$, :'co'), 'Permission denied', 'a cashier does not make items');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
