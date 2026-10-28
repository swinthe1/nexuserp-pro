-- =============================================================================
-- DrisPRO · the guard: a look at an invoice before it is posted (runs after 01–45, uses the demo market of 32)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

reset role;
select id as co from public.companies where name = 'Market Demo X' \gset
-- an item sold often, and a customer
select il.variant_id as var, max(il.tax_code_id::text) as tax from public.sales_invoice_lines il join public.sales_invoices i on i.id = il.invoice_id
 where i.company_id = :'co' and i.status = 'posted' and il.variant_id is not null group by 1 having count(*) >= 3 order by count(*) desc limit 1 \gset
select i.partner_id as cust from public.sales_invoices i where i.company_id = :'co' and i.status = 'posted' limit 1 \gset
select avg_cost as cost from public.item_costs where company_id = :'co' and variant_id = :'var' \gset
update public.business_partners set kind = 'company', tax_number = null where id = :'cust';

set role authenticated;
select t.login('demo@market-test.com');
select public.save_document('sales_invoices', jsonb_build_object('company_id', :'co', 'partner_id', :'cust', 'invoice_date', current_date + 3, 'due_date', current_date + 30, 'currency_code', 'EUR'),
  jsonb_build_object('sales_invoice_lines', jsonb_build_array(jsonb_build_object('line_no', 1, 'variant_id', :'var', 'description', 'x',
    'quantity', 50000, 'unit_price', round(:'cost'::numeric / 2, 2), 'tax_code_id', :'tax')))) as inv \gset
select public.document_checks('sales_invoice', :'inv') as f \gset
select t.ok(:'f'::jsonb @> '[{"code":"qty_unusual","line":1}]', 'a quantity far above the usual is caught');
select t.ok(:'f'::jsonb @> '[{"code":"below_cost"}]', 'a sale under cost');
select t.ok(:'f'::jsonb @> '[{"code":"date_future"}]', 'a date in the future');
select t.ok(:'f'::jsonb @> '[{"code":"customer_no_nui"}]', 'a business customer without NUI');
select t.ok((select bool_and(x ->> 'level' = 'warn') from jsonb_array_elements(:'f'::jsonb) x), 'all of them only warn');

-- a normal invoice: nothing to say
select public.save_document('sales_invoices', jsonb_build_object('id', :'inv', 'invoice_date', current_date),
  jsonb_build_object('sales_invoice_lines', jsonb_build_array(jsonb_build_object('line_no', 1, 'variant_id', :'var', 'description', 'x',
    'quantity', 1, 'unit_price', round(:'cost'::numeric * 1.3, 2), 'tax_code_id', :'tax')))) \gset
select t.ok(not (public.document_checks('sales_invoice', :'inv') @> '[{"code":"qty_unusual"}]') and not (public.document_checks('sales_invoice', :'inv') @> '[{"code":"below_cost"}]'),
  'a usual quantity at a normal price passes');

select public.guard_ack('sales_invoice', :'inv', array['customer_no_nui']);
reset role;
select t.ok((select count(*) = 1 from app.guard_events where doc_id = :'inv' and code = 'customer_no_nui'), 'what was waved through is kept');
set role authenticated;
select t.login('bob@kosova.xk');
select t.throws(format($q$select public.document_checks('sales_invoice', %L)$q$, :'inv'), 'Permission denied', 'another company cannot look');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
