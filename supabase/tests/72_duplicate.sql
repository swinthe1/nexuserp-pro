-- =============================================================================
-- DrisPRO · "Dupliko": a new draft with the same lines (runs after 69: the shop "Agjent Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Agjent Test' \gset
select id as po from public.purchase_orders where company_id = :'co' order by created_at limit 1 \gset
select id as inv from public.sales_invoices where company_id = :'co' order by created_at limit 1 \gset
select id as tr from public.stock_transfers where company_id = :'co' order by created_at limit 1 \gset
-- the invoice is posted, so its copy must leave the posting behind
update public.sales_invoices set status = 'posted' where id = :'inv' and status = 'draft';
set role authenticated;

select t.login('drita@agjent.xk');
select public.duplicate_document('purchase_orders', :'po') as d1 \gset
select t.ok((select status = 'draft' and order_date = current_date and number <> (select number from public.purchase_orders where id = :'po')
               from public.purchase_orders where id = (:'d1'::jsonb ->> 'id')::uuid)
            and (select count(*) from public.purchase_order_lines where purchase_order_id = (:'d1'::jsonb ->> 'id')::uuid)
              = (select count(*) from public.purchase_order_lines where purchase_order_id = :'po')
            and not exists (select 1 from public.purchase_order_lines where purchase_order_id = (:'d1'::jsonb ->> 'id')::uuid and (qty_received <> 0 or qty_billed <> 0))
            and (:'d1'::jsonb ->> 'href') = '/procurement/orders/' || (:'d1'::jsonb ->> 'id'),
            'a purchase order copied: a new draft of today, the same lines, nothing received or billed yet');
select public.duplicate_document('sales_invoices', :'inv') as d2 \gset
select t.ok((select status = 'draft' and posted_at is null and journal_entry_id is null and coalesce(amount_paid, 0) = 0 and partner_id = (select partner_id from public.sales_invoices where id = :'inv')
               from public.sales_invoices where id = (:'d2'::jsonb ->> 'id')::uuid),
            'a posted invoice copied: a draft for the same customer, not posted, nothing paid');
select t.ok((public.duplicate_document('stock_transfers', :'tr') ->> 'href') like '/inventory/transfers/%', 'a transfer too');
select t.throws($q$select public.duplicate_document('payments', gen_random_uuid())$q$, 'This document cannot be duplicated', 'only documents with lines that make sense twice');
select t.throws(format($q$select public.duplicate_document('purchase_orders', %L)$q$, gen_random_uuid()), 'Not found', 'a document that is not there');
select t.login('vesa@agjent.xk');
select t.throws(format($q$select public.duplicate_document('purchase_orders', %L)$q$, :'po'), '.', 'a cashier cannot copy what she cannot write');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
