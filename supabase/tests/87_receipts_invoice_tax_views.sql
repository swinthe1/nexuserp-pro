-- =============================================================================
-- From the meeting with the administrative staff, #4 and #2 as restated: goods in first, the tax
-- invoice later; the VAT book reads tax invoices only; the profit tax and the management view of
-- the expenses; internal costs for management only  (runs after 64, 80–86)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select id as ven from public.business_partners where company_id = :'co' and code = 'FT1' \gset
select id as reg from public.pos_registers where company_id = :'co' and code = 'T10' \gset
select warehouse_id as shop from public.pos_registers where id = :'reg' \gset
select id as beer from public.product_variants where company_id = :'co' and sku = 'KT-BEER' \gset
select app.main_location(:'shop') as loc \gset
select app.purchase_tax(:'co', 18) as vat18, app.purchase_tax(:'co', 0) as vat0 \gset
set role authenticated;
select t.login(:'boss');

-- ---------------------------------------------------------------- 1. goods in, the invoice later
insert into public.goods_receipts (company_id, warehouse_id, vendor_id, receipt_date, vendor_delivery_note, fiscal_status)
values (:'co', :'shop', :'ven', current_date - 3, 'FL-501', 'tax_invoice_received') returning id as gr \gset
select t.ok((select fiscal_status is null from public.goods_receipts where id = :'gr'), 'the fiscal status is the server''s to set');
insert into public.goods_receipt_lines (company_id, receipt_id, variant_id, location_id, quantity, unit_cost, unit_price)
values (:'co', :'gr', :'beer', :'loc', 10, 0.5, 0.5);
select coalesce(sum(on_hand), 0) as before from public.stock_levels where variant_id = :'beer' and warehouse_id = :'shop' \gset
select public.post_goods_receipt(:'gr');
select t.ok((select sum(on_hand) from public.stock_levels where variant_id = :'beer' and warehouse_id = :'shop') = :'before'::numeric + 10, 'the stock is in at once, to be sold');
select t.ok((select fiscal_status from public.goods_receipts where id = :'gr') = 'pending_invoice', 'waiting for the supplier''s tax invoice');
select public.receipts_pending_invoice(:'co') as p \gset
select t.ok(exists (select 1 from jsonb_array_elements(:'p'::jsonb -> 'rows') x where (x ->> 'id')::uuid = :'gr' and (x ->> 'pending_value')::numeric = 5 and (x ->> 'days')::int = 3),
  'listed among the goods waiting for the invoice, with its value and days');
select t.ok((:'p'::jsonb ->> 'grni_balance')::numeric >= 5, 'next to the account 4081 of the books');
reset role;
select t.ok(not exists (select 1 from app.vat_entries(:'co', current_date - 10, current_date) where doc_id = :'gr'), 'a receipt never enters the VAT book');
set role authenticated;

-- the invoice comes
select public.create_bill_from_receipt(:'gr') as bill \gset
update public.vendor_bill_lines set tax_code_id = :'vat18' where bill_id = :'bill';
update public.vendor_bills set vendor_invoice_number = 'FT-9001', bill_date = current_date where id = :'bill';
select public.post_vendor_bill(:'bill');
select t.ok((select fiscal_status from public.goods_receipts where id = :'gr') = 'tax_invoice_received', 'the invoice posted: the receipt has its tax invoice');
reset role;
select t.ok(exists (select 1 from app.vat_entries(:'co', current_date, current_date) where doc_id = :'bill' and side = 'purchase' and vat = 0.9), 'the invoice enters the purchase book, on its own date');
set role authenticated;
select t.ok(not exists (select 1 from jsonb_array_elements(public.receipts_pending_invoice(:'co') -> 'rows') x where (x ->> 'id')::uuid = :'gr'), 'no longer waiting');

-- billed with a till receipt: outside the VAT book, no VAT deducted
insert into public.goods_receipts (company_id, warehouse_id, vendor_id, receipt_date) values (:'co', :'shop', :'ven', current_date) returning id as gr2 \gset
insert into public.goods_receipt_lines (company_id, receipt_id, variant_id, location_id, quantity, unit_cost, unit_price) values (:'co', :'gr2', :'beer', :'loc', 4, 0.5, 0.5);
select public.post_goods_receipt(:'gr2');
select public.create_bill_from_receipt(:'gr2') as bill2 \gset
update public.vendor_bills set in_vat_book = false, vendor_invoice_number = 'KUPON-77' where id = :'bill2';
update public.vendor_bill_lines set tax_code_id = :'vat18' where bill_id = :'bill2';
select t.throws(format($q$select public.post_vendor_bill(%L)$q$, :'bill2'), 'outside the VAT book has no VAT', 'a document outside the VAT book deducts no VAT');
update public.vendor_bill_lines set tax_code_id = :'vat0' where bill_id = :'bill2';
select public.post_vendor_bill(:'bill2');
select t.ok((select fiscal_status from public.goods_receipts where id = :'gr2') = 'other_document', 'billed, but not with a tax invoice');
reset role;
select t.ok(not exists (select 1 from app.vat_entries(:'co', current_date, current_date) where doc_id = :'bill2'), 'it stays out of the purchase book');
set role authenticated;
select t.throws(format($q$update public.vendor_bills set in_vat_book = true where id = %L$q$, :'bill2'), 'cannot be changed', 'once posted, it is not moved in or out of the book');

-- ---------------------------------------------------------------- 2. the profit tax: as the document says
select (public.cit_worksheet(:'co', extract(year from current_date)::int) ->> 'nondeductible_total')::numeric as nd0 \gset
select public.expense_book(null, jsonb_build_object('company_id', :'co', 'vendor_name', 'Restorant Ura', 'number', 'R-12', 'date', current_date, 'category', 'meals',
  'lines', jsonb_build_array(jsonb_build_object('net', 50, 'tax_code_id', :'vat18')), 'cit_deductible', false)) as e1 \gset
select t.ok((select bool_and(cit_deductible = false) from public.vendor_bill_lines where bill_id = (:'e1'::jsonb ->> 'bill_id')::uuid), 'the expense is marked: not recognised for the profit tax');
select t.ok((public.cit_worksheet(:'co', extract(year from current_date)::int) ->> 'nondeductible_total')::numeric = :'nd0'::numeric + 50, 'the profit tax adds it back');
reset role;
select t.ok(exists (select 1 from app.vat_entries(:'co', current_date, current_date) where doc_id = (:'e1'::jsonb ->> 'bill_id')::uuid and vat = 9),
  'its tax invoice is still in the VAT book: the VAT is a separate question');
set role authenticated;
-- a till receipt for an expense: whatever VAT is chosen, none is deducted
select public.expense_book(null, jsonb_build_object('company_id', :'co', 'vendor_name', 'Market Lagja', 'number', 'K-5', 'date', current_date, 'category', 'supplies',
  'lines', jsonb_build_array(jsonb_build_object('net', 23.6, 'tax_code_id', :'vat18')), 'in_vat_book', false)) as e2 \gset
select t.ok((select not in_vat_book and tax_total = 0 and total = 23.6 from public.vendor_bills where id = (:'e2'::jsonb ->> 'bill_id')::uuid), 'a till receipt: the whole amount is the cost');
reset role;
select t.ok(not exists (select 1 from app.vat_entries(:'co', current_date, current_date) where doc_id = (:'e2'::jsonb ->> 'bill_id')::uuid), 'and it stays out of the purchase book');
set role authenticated;

-- ---------------------------------------------------------------- 3. internal costs and the two views
insert into public.management_costs (company_id, warehouse_id, month, kind, description, amount)
values (:'co', :'shop', date_trunc('month', current_date)::date, 'internal_rent', 'Qiraja e brendshme e dyqanit', 300) returning id as mc \gset
select t.ok(public.management_costs_repeat(:'mc', (date_trunc('month', current_date) + interval '2 months')::date) = 2, 'the same cost for the next two months');
select t.ok(public.management_costs_repeat(:'mc', (date_trunc('month', current_date) + interval '2 months')::date) = 0, 'not twice');
select public.profit_report(:'co', jsonb_build_object('from', date_trunc('month', current_date)::date, 'to', current_date, 'by', 'unit')) as pr \gset
select t.ok((:'pr'::jsonb -> 'cells' -> :'shop' ->> 'internal')::numeric = 300
            and (:'pr'::jsonb -> 'cells' -> :'shop' ->> 'managerial_profit')::numeric = (:'pr'::jsonb -> 'cells' -> :'shop' ->> 'net_profit')::numeric - 300,
  'management view: the internal rent of this month, less from the unit''s profit');
select t.ok((:'pr'::jsonb -> 'cells' -> 'shared' ->> 'nondeductible')::numeric >= 50
            and (:'pr'::jsonb -> 'cells' -> 'shared' ->> 'tax_base')::numeric = (:'pr'::jsonb -> 'cells' -> 'shared' ->> 'net_profit')::numeric + (:'pr'::jsonb -> 'cells' -> 'shared' ->> 'nondeductible')::numeric,
  'tax view: the profit of the books plus what is not recognised');
select t.ok((select count(*) from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
              where e.company_id = :'co' and e.source_doc_type = 'management_costs') = 0, 'internal costs never reach the books');
select t.login('cora@kt.al');
select t.throws(format($q$select public.management_costs_repeat(%L, current_date + 400)$q$, :'mc'), 'Permission denied', 'only finance repeats them');
reset role;
select t.ok(not has_function_privilege('anon', 'public.receipts_pending_invoice(uuid, jsonb)', 'execute'), 'not for anonymous callers');

\set QUIET off
select count(*) as assertions_passed from t.results;
