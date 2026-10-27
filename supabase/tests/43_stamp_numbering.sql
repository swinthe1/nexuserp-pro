-- =============================================================================
-- DrisPRO · stamp on documents, the store in the document number, stock at selling prices (runs after 01–42)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Numbering Test', 'country', 'XK', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 10,
  'valid_until', (current_date + 365)::text)) as co \gset
select t.login('alice@alba.al');
select public.print_stamp_save(:'co', 'data:image/png;base64,iVBORw0KGgo=');
select t.ok((public.print_company_preview(:'co') ->> 'stamp') like 'data:image/png%', 'the stamp travels with every printed document');
select t.throws(format($q$select public.print_stamp_save(%L, 'not a picture')$q$, :'co'), 'picture', 'only a picture is a stamp');

reset role;
update public.document_sequences set include_location = true where company_id = :'co' and doc_type = 'sales_order';
insert into public.document_sequences (company_id, doc_type, prefix, include_location)
select :'co', 'sales_order', 'SO-', true where not exists (select 1 from public.document_sequences where company_id = :'co' and doc_type = 'sales_order');
select id as wh, code as whcode from public.warehouses where company_id = :'co' order by code limit 1 \gset
select t.ok(app.next_document_number(:'co', 'sales_order', current_date, :'whcode') like '%' || upper(:'whcode') || '-%', 'the store code is inside the number');
select app.next_document_number(:'co', 'sales_order', current_date, 'B2') as b1 \gset
select app.next_document_number(:'co', 'sales_order', current_date, 'B2') as b2 \gset
select app.next_document_number(:'co', 'sales_order', current_date, 'C3') as c1 \gset
select t.ok(right(:'b2', 1)::int = right(:'b1', 1)::int + 1 and right(:'c1', 4) = right(:'b1', 4), 'each store counts on its own');
select t.ok(app.doc_location_code(jsonb_build_object('warehouse_id', :'wh')) = :'whcode', 'a document finds its store from the warehouse');

set role authenticated;
select t.login('alice@alba.al');
select t.ok((public.run_report(:'co', 'inventory', '{}'::jsonb) -> 'columns') @> '[{"key":"sales_value"},{"key":"expected_margin"}]', 'the stock is valued at selling prices too');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
