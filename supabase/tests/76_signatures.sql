-- =============================================================================
-- DrisPRO · signatures on documents: who may sign with whose signature, and the history of it
-- (runs after 69 "Agjent Test", 74)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Agjent Test' \gset
select id as inv from public.sales_invoices where company_id = :'co' and status = 'posted' and deleted_at is null order by created_at limit 1 \gset
set role authenticated;

select t.login('vesa@agjent.xk');
select auth.uid() as vesa \gset
select t.throws(format($q$select public.signature_save(%L, null, 'Drita', 'Drejtoreshë', 'data:image/png;base64,AAAA', '{}')$q$, :'co'),
                'Permission denied|admin', 'a cashier does not add signatures');

select t.login('drita@agjent.xk');
select public.signature_save(:'co', null, 'Drita Krasniqi', 'Drejtoreshë', 'data:image/png;base64,AAAA', '{}', true) as sig \gset
select t.throws(format($q$select public.signature_save(%L, null, 'X', null, 'not a picture', '{}')$q$, :'co'), 'picture', 'only a picture');
select t.ok((public.my_signatures(:'co') -> 0 ->> 'name') = 'Drita Krasniqi' and not (public.my_signatures(:'co') -> 0 ? 'image'), 'the list of signatures, without the pictures');

select t.login('vesa@agjent.xk');
select t.ok((select count(*) = 0 from public.company_signatures), 'someone not allowed does not see the signature');
select t.throws(format($q$select public.document_sign('sales_invoice', %L, %L)$q$, :'inv', :'sig'), 'may not sign', 'nor signs with it');

select t.login('drita@agjent.xk');
select public.signature_save(:'co', :'sig', 'Drita Krasniqi', 'Drejtoreshë', null, array[:'vesa']::uuid[], true);
select t.login('vesa@agjent.xk');
select (public.document_sign('sales_invoice', :'inv', :'sig', 'email') ->> 'image') as img \gset
select t.ok(:'img' = 'data:image/png;base64,AAAA', 'once allowed, the cashier signs the invoice with it');
reset role;
select t.ok(exists (select 1 from public.entity_activities where entity_id = :'inv' and metadata ->> 'kind' = 'signed' and metadata ->> 'person' = 'Drita Krasniqi' and metadata ->> 'how' = 'email'),
            'the invoice history says it went out signed, and how');

set role authenticated;
select t.login('drita@agjent.xk');
select public.signature_delete(:'sig');
select t.ok(public.my_signatures(:'co') = '[]'::jsonb, 'a deleted signature is gone from the choice');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
