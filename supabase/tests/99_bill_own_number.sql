-- =============================================================================
-- "Faturë blerje (pa TVSH)": the supplier's number is optional; left empty, the document carries its own
-- number in its place. A purchase invoice in the VAT book still needs the supplier's number.  (on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select id as ven from public.business_partners where company_id = :'co' and code = 'FT1' \gset
select warehouse_id as shop from public.pos_registers where company_id = :'co' and code = 'T10' \gset
set role authenticated;
select t.login(:'boss');

insert into public.vendor_bills (company_id, document_type, vendor_id, warehouse_id, bill_date, vendor_invoice_number, in_vat_book)
values (:'co', 'vendor_bill', :'ven', :'shop', current_date, '', false) returning id as b1, number as n1, vendor_invoice_number as r1 \gset
select t.ok(:'r1' = :'n1', 'outside the VAT book, without the supplier''s number: the document''s own number takes its place');
insert into public.vendor_bills (company_id, document_type, vendor_id, warehouse_id, bill_date, vendor_invoice_number, in_vat_book)
values (:'co', 'vendor_bill', :'ven', :'shop', current_date, '  ', false) returning id as b2, vendor_invoice_number as r2 \gset
select t.ok(:'r2' <> :'r1', 'a second one of the same supplier: its own number, no clash');
update public.vendor_bills set vendor_invoice_number = 'KUPON-991' where id = :'b2';
select t.ok((select vendor_invoice_number = 'KUPON-991' from public.vendor_bills where id = :'b2'), 'the supplier''s number can still be written');
select t.throws(format($q$insert into public.vendor_bills (company_id, document_type, vendor_id, warehouse_id, bill_date, vendor_invoice_number, in_vat_book)
                          values (%L, 'vendor_bill', %L, %L, current_date, '', true)$q$, :'co', :'ven', :'shop'),
                'invoice number', 'in the VAT book the supplier''s number is still needed');
delete from public.vendor_bills where id in (:'b1', :'b2');

\set QUIET off
select count(*) as assertions_passed from t.results;
