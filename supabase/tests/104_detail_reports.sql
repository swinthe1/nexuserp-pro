-- =============================================================================
-- "Blerjet e detajuara" and "Shitjet e detajuara": the same figures whichever way they are grouped, the import
-- costs on the purchase lines, the till as lines or as a total a day, and the advanced filters.  (after 08, 64)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);

-- ---------- purchases ("Tatim Test": its bills, and the import of 10 machine parts with 1,500 duty on them) ----------
select id as co from public.companies where name = 'Tatim Test' \gset
select rl.id as rline, rl.variant_id as imp from public.goods_receipt_lines rl join public.landed_cost_allocations a on a.receipt_line_id = rl.id
 where a.company_id = :'co' limit 1 \gset
select vendor_id as vendor from public.vendor_bills where company_id = :'co' and status = 'posted' limit 1 \gset
-- the bill of those parts, outside the VAT book (written straight in: what is checked here is the report, not the bill)
set session_replication_role = replica;
insert into public.vendor_bills (company_id, number, vendor_id, vendor_invoice_number, currency_code, bill_date, due_date, status, document_type,
  in_vat_book, subtotal, tax_total, total, amount_paid, payment_status, exchange_rate)
values (:'co', 'FB-T-104', :'vendor', 'IMP-104', 'EUR', current_date - 40, current_date - 5, 'posted', 'vendor_bill', false, 28500, 0, 28500, 0, 'unpaid', 1)
returning id as bill \gset
insert into public.vendor_bill_lines (company_id, bill_id, line_no, description, variant_id, quantity, unit_price, discount1_pct, discount2_pct, discount_pct,
  tax_rate, receipt_line_id)
values (:'co', :'bill', 1, 'Imported machine part', :'imp', 10, 3000, 5, 0, 5, 0, :'rline');
set session_replication_role = origin;

set role authenticated;
select t.login('alice@alba.al');
select public.purchase_detail(:'co', '{"report": "lines_landed", "from": "2026-01-01", "to": "2027-12-31"}') as pl \gset
select public.purchase_detail(:'co', '{"report": "lines_landed", "landed_basis": "quantity", "from": "2026-01-01", "to": "2027-12-31"}') as plq \gset
select public.purchase_detail(:'co', '{"report": "detailed", "from": "2026-01-01", "to": "2027-12-31"}') as pd \gset
select public.purchase_detail(:'co', '{"report": "by_item", "from": "2026-01-01", "to": "2027-12-31"}') as pi \gset
select public.purchase_detail(:'co', '{"report": "by_vendor", "from": "2026-01-01", "to": "2027-12-31"}') as pv \gset
select public.purchase_detail(:'co', '{"report": "detailed", "vat_book": "out", "from": "2026-01-01", "to": "2027-12-31"}') as pout \gset
select public.purchase_detail(:'co', '{"report": "detailed", "payment": ["overdue"], "from": "2026-01-01", "to": "2027-12-31"}') as pover \gset
select public.purchase_detail(:'co', '{"report": "detailed", "doc_types": ["credit"], "from": "2026-01-01", "to": "2027-12-31"}') as pcr \gset
select public.purchase_detail(:'co', '{"report": "detailed", "min_total": 20000, "from": "2026-01-01", "to": "2027-12-31"}') as pmin \gset
select public.purchase_detail(:'co', '{"report": "detailed", "limit": 1, "from": "2026-01-01", "to": "2027-12-31"}') as plim \gset
reset role;
create temp table pr (k text, v jsonb);
insert into pr values ('pl', :'pl'), ('plq', :'plq'), ('pd', :'pd'), ('pi', :'pi'), ('pv', :'pv');
create function pg_temp.tot(k text, f text) returns numeric language sql as $$ select sum((x ->> f)::numeric) from pr, jsonb_array_elements(pr.v -> 'rows') x where pr.k = $1 $$;

select t.ok((select (x ->> 'landed')::numeric = 1500 and (x ->> 'landed_unit')::numeric = 150 and (x ->> 'cost_unit')::numeric = 3000
               and (x ->> 'price_list')::numeric = 3000 and (x ->> 'discount1')::numeric = 5 and (x ->> 'price_net')::numeric = 2850
               from jsonb_array_elements(:'pl'::jsonb -> 'rows') x where x ->> 'number' = 'FB-T-104'),
            'the import line: list price, its discount, the net price, and the duty on it (1,500 = 150 a piece, 3,000 a piece in all)');
select t.ok((select (x ->> 'landed')::numeric = 1500 from jsonb_array_elements(:'plq'::jsonb -> 'rows') x where x ->> 'number' = 'FB-T-104'),
            'spread again by quantity it is the same: one line on the receipt');
select t.ok(pg_temp.tot('pd', 'net') = pg_temp.tot('pl', 'net') and pg_temp.tot('pd', 'net') = pg_temp.tot('pi', 'net') and pg_temp.tot('pd', 'gross') = pg_temp.tot('pv', 'gross'),
            'per document, per item, per vendor and line by line: the same totals');
select t.ok((select bool_and((x ->> 'net')::numeric < 0) from jsonb_array_elements(:'pd'::jsonb -> 'rows') x where x ->> 'type' = 'credit'), 'credit notes count against');
select t.ok((select count(*) = 1 and bool_and(x ->> 'number' = 'FB-T-104') from jsonb_array_elements(:'pout'::jsonb -> 'rows') x), 'outside the VAT book: only the bill outside it');
select t.ok(exists (select 1 from jsonb_array_elements(:'pover'::jsonb -> 'rows') x where x ->> 'number' = 'FB-T-104' and x ->> 'payment_status' = 'overdue'), 'unpaid past its date: overdue');
select t.ok(jsonb_array_length(:'pcr'::jsonb -> 'rows') >= 1 and (select bool_and(x ->> 'type' = 'credit') from jsonb_array_elements(:'pcr'::jsonb -> 'rows') x), 'by kind of document');
select t.ok((select bool_and((x ->> 'gross')::numeric >= 20000) from jsonb_array_elements(:'pmin'::jsonb -> 'rows') x), 'by the amount of the document');
select t.ok((:'plim'::jsonb ->> 'truncated')::boolean and jsonb_array_length(:'plim'::jsonb -> 'rows') = 1, 'more than the limit: it says so');

-- ---------- sales ("Kontrolle Test": receipts at the tills) ----------
select id as ko from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
set role authenticated;
select t.login(:'boss');
select public.sales_detail(:'ko', '{"report": "lines", "from": "2026-01-01", "to": "2027-12-31"}') as sl \gset
select public.sales_detail(:'ko', '{"report": "lines", "till_mode": "daily", "from": "2026-01-01", "to": "2027-12-31"}') as sday \gset
select public.sales_detail(:'ko', '{"report": "detailed", "from": "2026-01-01", "to": "2027-12-31"}') as sd \gset
select public.sales_detail(:'ko', '{"report": "by_item", "from": "2026-01-01", "to": "2027-12-31"}') as si \gset
select public.sales_detail(:'ko', '{"report": "by_hour", "from": "2026-01-01", "to": "2027-12-31"}') as sh \gset
select public.sales_detail(:'ko', '{"report": "by_unit", "from": "2026-01-01", "to": "2027-12-31"}') as su \gset
select public.sales_detail(:'ko', '{"report": "detailed", "source": "invoices", "from": "2026-01-01", "to": "2027-12-31"}') as sinv \gset
select public.sales_detail(:'ko', '{"report": "detailed", "doc_types": ["till_refund"], "from": "2026-01-01", "to": "2027-12-31"}') as sref \gset
reset role;
insert into pr values ('sl', :'sl'), ('sday', :'sday'), ('sd', :'sd'), ('si', :'si'), ('sh', :'sh'), ('su', :'su');
select t.ok(pg_temp.tot('sl', 'net') = pg_temp.tot('sd', 'net') and pg_temp.tot('sd', 'net') = pg_temp.tot('si', 'net')
            and pg_temp.tot('si', 'net') = pg_temp.tot('sh', 'net') and pg_temp.tot('sh', 'net') = pg_temp.tot('su', 'net'),
            'line by line, per receipt, per item, per hour and per unit: the same sales');
select t.ok(pg_temp.tot('sl', 'net') = (select sum(l.line_subtotal) from public.pos_order_lines l join public.pos_orders o on o.id = l.pos_order_id
                                          where o.company_id = :'ko' and o.status = 'paid' and o.deleted_at is null), 'the till lines, all of them');
select t.ok(pg_temp.tot('sday', 'net') = pg_temp.tot('sl', 'net') and jsonb_array_length(:'sday'::jsonb -> 'rows') < jsonb_array_length(:'sl'::jsonb -> 'rows')
            and (select bool_and(x ->> 'type' = 'till_day') from jsonb_array_elements(:'sday'::jsonb -> 'rows') x where x ->> 'source' = 'till'),
            'the till as one total a day per item: fewer lines, the same sales');
select t.ok(pg_temp.tot('si', 'margin') = pg_temp.tot('si', 'net') - pg_temp.tot('si', 'cost'), 'the margin is the sales less their cost');
select t.ok(not exists (select 1 from jsonb_array_elements(:'sinv'::jsonb -> 'rows') x where x ->> 'source' = 'till'), 'only the invoices, when asked');
select t.ok((select coalesce(bool_and(x ->> 'type' = 'till_refund' and (x ->> 'net')::numeric <= 0), true) from jsonb_array_elements(:'sref'::jsonb -> 'rows') x),
            'the refunds at the till, against');

-- ---------- who may see ----------
set role authenticated;
select t.login('cora@kt.al');
select t.throws(format($q$select public.purchase_detail(%L, '{}')$q$, :'co'), 'permission', 'not for another company');
select t.throws(format($q$select public.sales_detail(%L, '{}')$q$, :'ko'), 'Permission denied', 'nor for a cashier: the margins are not hers to see');
select t.login(:'boss');
select t.throws(format($q$select public.sales_detail(%L, '{"report": "nope"}')$q$, :'ko'), 'Unknown report', 'a report we know');
select t.throws(format($q$select public.sales_detail(%L, '{"from": "2020-01-01", "to": "2026-01-01"}')$q$, :'ko'), 'three years', 'three years at most');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
