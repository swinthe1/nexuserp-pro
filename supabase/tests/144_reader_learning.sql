-- =============================================================================
-- The invoice reader learns: what a person corrects after a read is kept for the supplier, written rules too,
-- and both go to the AI with the next photo; the figures of "how well it reads". (after 143: Mini Market Arbëri)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as mini from public.companies where name = 'Mini Market Arbëri' \gset
insert into public.business_partners (company_id, code, name, is_vendor, tax_number) values (:'mini', 'FLEX', 'Furra Lexuese Sh.p.k.', true, '811999777') returning id as ven \gset
insert into app.document_reads (company_id, kind, file_name, mime, content, status, result)
values (:'mini', 'supplier_invoice', 'f1.pdf', 'application/pdf', 'x'::bytea, 'done',
  '{"vendor_name":"Furra Lexuese Sh.p.k.","vendor_tax_number":"811999777","number":"F-10","date":"2026-11-02","lines":[
     {"name":"Bukë e bardhë 500 g","code":"B1","quantity":2,"unit_price":5.9,"vat_rate":8},
     {"name":"Kifle 6 copë","code":"K6","quantity":10,"unit_price":0.8},
     {"name":"Transport","quantity":1,"unit_price":5}]}'::jsonb) returning id as rd \gset

set role authenticated;
select t.login('pronari@arberi.xk');
select public.doc_read_feedback(:'rd', jsonb_build_object('vendor_id', :'ven', 'number', 'F-10', 'date', '2026-11-02', 'lines', jsonb_build_array(
  jsonb_build_object('i', 0, 'use', true, 'variant_id', null, 'quantity', 24, 'unit_price', 0.5),
  jsonb_build_object('i', 1, 'use', true, 'variant_id', null, 'quantity', 10, 'unit_price', 0.8),
  jsonb_build_object('i', 2, 'use', false, 'variant_id', null, 'quantity', 1, 'unit_price', 5)))) as fb \gset
select t.ok((:'fb'::jsonb ->> 'lines_read')::int = 3 and (:'fb'::jsonb ->> 'lines_fixed')::int = 2, 'two of the three lines were corrected');
select public.read_rules_save(:'mini', :'ven', 'Sasitë janë në arka nga 12 copë.');
select public.read_rules_get(:'mini', :'ven') as rg \gset
select t.ok(:'rg'::jsonb ->> 'notes' = 'Sasitë janë në arka nga 12 copë.' and jsonb_array_length(:'rg'::jsonb -> 'learned') = 3, 'the rules are kept and the three corrections show');
select public.reader_stats(:'mini') as st \gset
select t.ok((select (v ->> 'reads')::int = 1 and (v ->> 'quantity')::int = 1 and (v ->> 'unit_price')::int = 1 and (v ->> 'left_out')::int = 1 and (v ->> 'has_rules')::boolean
               from jsonb_array_elements(:'st'::jsonb -> 'vendors') v where v ->> 'id' = :'ven'), 'how well it reads counts them by kind');
reset role;
select app.read_hints(:'mini') as hints \gset
select t.ok(:'hints' like '%Furra Lexuese%811999777%' and :'hints' like '%arka nga 12%' and :'hints' like '%quantity was read 2, right was 24%'
        and :'hints' like '%"Transport" is not goods%', 'the next read gets the supplier''s rules and corrections');
-- the server takes the next photo with those notes
select set_config('request.jwt.claims', '', false);
select set_config('request.jwt.claim.sub', '', false);
insert into app.document_reads (company_id, kind, file_name, mime, content) values (:'mini', 'supplier_invoice', 'f2.pdf', 'application/pdf', 'y'::bytea);
select t.ok((select bool_or(c ->> 'hints' like '%arka nga 12%') from (select public.reader_claim() as c from generate_series(1, 30)) x where c ->> 'name' = 'f2.pdf'),
            'the photo goes to the reader with the notes');
delete from app.document_reads where company_id = :'mini' and file_name in ('f1.pdf', 'f2.pdf');

select u.email as outsider from auth.users u
 where not exists (select 1 from public.company_members m where m.user_id = u.id and m.company_id = :'mini' and m.status = 'active')
   and not coalesce((select p.is_super_admin from public.profiles p where p.id = u.id), false)
 limit 1 \gset
set role authenticated;
select t.login(:'outsider');
select t.throws(format('select public.reader_stats(%L)', :'mini'), '', 'someone outside the company sees no reading figures');
select t.throws(format('select public.read_rules_save(%L, %L, %L)', :'mini', :'ven', 'x'), '', 'nor writes rules');
reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
