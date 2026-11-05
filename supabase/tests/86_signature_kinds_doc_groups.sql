-- =============================================================================
-- From the meeting with the administrative staff: a signature only on the documents it is for (#30);
-- the supplier's documents by the groups of their items (#16)  (runs after 64, 80–85)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select id as ven from public.business_partners where company_id = :'co' and code = 'FT1' \gset
select id as bill from public.vendor_bills where company_id = :'co' and vendor_invoice_number = 'DUE-1' \gset
select id as ivo from auth.users where email = 'ivo@kt.al' \gset
set role authenticated;
select t.login(:'boss');

-- ---------------------------------------------------------------- 30
select public.signature_save(:'co', null, 'Drejtori Financiar', 'CFO', 'data:image/png;base64,AAAA', array[:'ivo'::uuid], false) as sig \gset
select public.signature_set_kinds(:'sig', array['sales_invoice', 'payment']);
select t.ok((select x -> 'kinds' from jsonb_array_elements(public.my_signatures(:'co')) x where (x ->> 'id')::uuid = :'sig') = '["sales_invoice", "payment"]', 'the signature says which documents it is for');
select t.throws(format($q$select public.signature_set_kinds(%L, array['love_letter'])$q$, :'sig'), 'Unknown document kind', 'only documents that print');
select (select id from public.payments where company_id = :'co' limit 1) as pay \gset
select t.ok((public.document_sign('payment', :'pay', :'sig') ->> 'name') = 'Drejtori Financiar', 'it signs a payment');
select (select id from public.goods_receipts where company_id = :'co' limit 1) as gr \gset
select t.throws(format($q$select public.document_sign('goods_receipt', %L, %L)$q$, :'gr', :'sig'), 'not for this kind of document', 'not a goods receipt, even for the administrator');
select public.signature_set_kinds(:'sig', '{}');
select t.ok((public.document_sign('goods_receipt', :'gr', :'sig') ->> 'name') = 'Drejtori Financiar', 'emptied: every document');
select t.login('cora@kt.al');
select t.throws(format($q$select public.signature_set_kinds(%L, '{}')$q$, :'sig'), 'Permission denied', 'only the administrators set it');

-- ---------------------------------------------------------------- 16
select t.login(:'boss');
select public.doc_item_groups(:'co', 'vendor_bills') as g \gset
select t.ok((:'g'::jsonb -> :'bill' -> 'groups') ? 'Pije alkoolike', 'a purchase invoice knows the groups of its items');
select t.ok(jsonb_typeof(public.doc_item_groups(:'co', 'goods_receipts')) = 'object' and jsonb_typeof(public.doc_item_groups(:'co', 'purchase_orders')) = 'object', 'receipts and orders too');
select t.throws(format($q$select public.doc_item_groups(%L, 'payments')$q$, :'co'), 'Unknown document kind', 'only the supplier''s documents with items');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
