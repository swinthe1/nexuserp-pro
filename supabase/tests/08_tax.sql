-- =============================================================================
-- DrisPRO · Phase 8 tax tests (runs after 01–07; reuses t.ok / t.throws / t.login)
-- Albania: every VAT treatment in one month, expected figures worked out by hand:
--   sales    20%: 10,000 + EUR 50 × 100 − credit 1,000 = 14,000 (VAT 2,800); 6%: 2,000 (120);
--            export 3,000; exempt 500
--   purchases domestic 20%: 20,000 − credit 2,000 = 18,000 (3,600); capital 50,000 (10,000);
--            reverse charge 10,000 (2,000 out and in); non-deductible 1,000 + 200; import 30,000 (6,000)
--   output 4,920 · input 21,600 · credit 16,680
-- Kosovo: credit notes cross to the other book ([16]/[17] and [53]/[54]).
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

insert into auth.users (email, raw_user_meta_data) values
  ('tina@tax.al', '{"full_name":"Tina Tax"}'),
  ('sam@tax.al',  '{"full_name":"Sam Sales"}');

create or replace function pg_temp.bal(p_co uuid, p_code text) returns numeric language sql security definer as $$
  select coalesce(sum(jl.debit - jl.credit), 0) from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
   where jl.company_id = p_co and jl.account_id = (select id from public.accounts where company_id = p_co and code = p_code)
     and e.status in ('posted','reversed') $$;
create or replace function pg_temp.box(p jsonb, k text) returns numeric language sql immutable as $$ select coalesce((p -> 'boxes' ->> k)::numeric, 0) $$;

set role authenticated;
select t.login('alice@alba.al');
select public.create_company('Tatim Test', 'AL', 'ALL', 'K12345678L') as co \gset
select public.invite_member(:'co', 'tina@tax.al', array['accountant']);
select public.invite_member(:'co', 'sam@tax.al', array['sales_rep']);
select date_trunc('month', current_date)::date as m1, extract(year from current_date)::int as y, extract(month from current_date)::int as mo \gset
select (date_trunc('month', current_date) + interval '1 month')::date as m2 \gset
select id as wh    from public.warehouses where company_id = :'co' and code = 'WH' \gset
select id as stock from public.warehouse_locations where company_id = :'co' and code = 'WH/STOCK' \gset
select id as pcs   from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select id as vat20 from public.tax_codes where company_id = :'co' and code = 'VAT20' \gset
select id as vat6  from public.tax_codes where company_id = :'co' and code = 'VAT6' \gset
select id as vat0  from public.tax_codes where company_id = :'co' and code = 'VAT0' \gset
select id as exm   from public.tax_codes where company_id = :'co' and code = 'EXEMPT' \gset
select id as rc20  from public.tax_codes where company_id = :'co' and code = 'VAT20-RC' \gset
select t.ok(exists (select 1 from public.tax_codes where company_id = :'co' and code = 'VAT10' and rate = 10), 'Albanian companies get the 10% rate');
select t.ok(exists (select 1 from public.accounts where company_id = :'co' and code = '4455'), 'VAT settlement account 4455 exists');
insert into public.tax_codes (company_id, code, name, rate, scope, country_code, is_deductible) values (:'co', 'ND20', 'VAT 20% non-deductible', 20, 'purchase', 'AL', false)
returning id as nd20 \gset

insert into public.business_partners (company_id, code, name, kind, is_customer, tax_number) values (:'co', 'C1', 'Klienti Shpk', 'company', true, 'L11111111A') returning id as cust \gset
insert into public.business_partners (company_id, code, name, kind, is_customer, currency_code) values (:'co', 'C2', 'Kunde GmbH', 'company', true, 'EUR') returning id as cust_eu \gset
insert into public.business_partners (company_id, code, name, kind, is_vendor, tax_number) values (:'co', 'V1', 'Qiraja Shpk', 'company', true, 'L22222222B') returning id as vend \gset
insert into public.business_partners (company_id, code, name, kind, is_vendor) values (:'co', 'V2', 'Cloud Ltd (Ireland)', 'company', true) returning id as vend_rc \gset
select id as a612 from public.accounts where company_id = :'co' and code = '612' \gset
select id as a213 from public.accounts where company_id = :'co' and code = '213' \gset
select id as a602 from public.accounts where company_id = :'co' and code = '602' \gset

-- ---------- sales -------------------------------------------------------------------------------
create or replace function pg_temp.inv(p_co uuid, p_partner uuid, p_cur text, p_rate numeric, p_lines jsonb) returns uuid language plpgsql as $$
declare v uuid; l jsonb; n int := 0;
begin
  insert into public.sales_invoices (company_id, partner_id, currency_code, exchange_rate) values (p_co, p_partner, p_cur, p_rate) returning id into v;
  for l in select * from jsonb_array_elements(p_lines) loop
    n := n + 1;
    insert into public.sales_invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price, tax_code_id)
    values (p_co, v, n, l ->> 'd', (l ->> 'q')::numeric, (l ->> 'p')::numeric, (l ->> 't')::uuid);
  end loop;
  perform public.post_sales_invoice(v);
  return v;
end $$;
select pg_temp.inv(:'co', :'cust', 'ALL', 1, jsonb_build_array(jsonb_build_object('d','Goods 20%','q',10,'p',1000,'t',:'vat20'),
                                                              jsonb_build_object('d','Books 6%','q',5,'p',400,'t',:'vat6'))) as i1 \gset
select pg_temp.inv(:'co', :'cust_eu', 'EUR', 100, jsonb_build_array(jsonb_build_object('d','Service','q',1,'p',50,'t',:'vat20'))) as i2 \gset
select pg_temp.inv(:'co', :'cust_eu', 'ALL', 1, jsonb_build_array(jsonb_build_object('d','Export','q',1,'p',3000,'t',:'vat0'))) as i3 \gset
select pg_temp.inv(:'co', :'cust', 'ALL', 1, jsonb_build_array(jsonb_build_object('d','Exempt service','q',1,'p',500,'t',:'exm'))) as i4 \gset
select public.create_credit_note(:'i1') as cn1 \gset
delete from public.sales_invoice_lines where invoice_id = :'cn1' and tax_code_id = :'vat6';
update public.sales_invoice_lines set quantity = 1 where invoice_id = :'cn1';
select public.post_sales_invoice(:'cn1');

-- ---------- purchases ---------------------------------------------------------------------------
create or replace function pg_temp.bill(p_co uuid, p_vendor uuid, p_no text, p_acc uuid, p_amount numeric, p_tax uuid) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.vendor_bills (company_id, vendor_id, vendor_invoice_number, currency_code) values (p_co, p_vendor, p_no, 'ALL') returning id into v;
  insert into public.vendor_bill_lines (company_id, bill_id, line_no, description, account_id, quantity, unit_price, tax_code_id)
  values (p_co, v, 1, p_no, p_acc, 1, p_amount, p_tax);
  perform public.post_vendor_bill(v);
  return v;
end $$;
select pg_temp.bill(:'co', :'vend', 'Q-RENT-1', :'a612', 20000, :'vat20') as b1 \gset
select pg_temp.bill(:'co', :'vend', 'Q-MACH-1', :'a213', 50000, :'vat20') as b2 \gset
select pg_temp.bill(:'co', :'vend_rc', 'IE-2291', :'a602', 10000, :'rc20') as b3 \gset
select pg_temp.bill(:'co', :'vend', 'Q-CAR-1', :'a602', 1000, :'nd20') as b4 \gset
select public.create_vendor_credit(:'b1') as vc1 \gset
update public.vendor_bill_lines set unit_price = 2000 where bill_id = :'vc1';
select public.post_vendor_bill(:'vc1');

select t.ok((select (tax_rate, line_total) = (0.0000, 10000.00) from public.vendor_bill_lines where bill_id = :'b3'), 'reverse charge: the vendor charges no VAT');
select t.ok((select total from public.vendor_bills where id = :'b3') = 10000, 'reverse charge: payable to the vendor excludes VAT');
select t.ok((select count(*) from public.journal_lines where entry_id = (select journal_entry_id from public.vendor_bills where id = :'b3')
               and account_id in (select id from public.accounts where company_id = :'co' and code in ('4456','4457')) and (debit = 2000 or credit = 2000)) = 2,
            'reverse charge: self-assessed 2,000 as input and output VAT');
select t.ok((select count(*) from public.journal_lines where entry_id = (select journal_entry_id from public.vendor_bills where id = :'b4')
               and account_id = (select id from public.accounts where company_id = :'co' and code = '4456')) = 0
            and (select sum(debit) from public.journal_lines where entry_id = (select journal_entry_id from public.vendor_bills where id = :'b4') and account_id = :'a602') = 1200,
            'non-deductible VAT is expensed, not recovered');

-- ---------- import VAT on the customs declaration -------------------------------------------------
insert into public.goods_receipts (company_id, warehouse_id) values (:'co', :'wh') returning id as gr \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'IMP', 'name', 'Imported machine part', 'uom_id', :'pcs')) as p \gset
select id as imp from public.product_variants where product_id = :'p' \gset
insert into public.goods_receipt_lines (company_id, receipt_id, variant_id, location_id, quantity, unit_cost) values (:'co', :'gr', :'imp', :'stock', 10, 2850);
select public.post_goods_receipt(:'gr');
insert into public.landed_costs (company_id, allocation_method, customs_declaration_number, customs_value) values (:'co', 'value', 'DUD-AL-2026-55001', 30000)
returning id as lc \gset
insert into public.landed_cost_receipts (company_id, landed_cost_id, receipt_id) values (:'co', :'lc', :'gr');
insert into public.landed_cost_charges (company_id, landed_cost_id, charge_type, description, amount) values (:'co', :'lc', 'customs', 'Duty', 1500);
select t.ok((select (import_vat_rate, import_vat) = (20.0000, 6000.00) from public.landed_costs where id = :'lc'), 'import VAT defaults to 20% of the customs value');
select public.post_landed_cost(:'lc');
select t.ok(pg_temp.bal(:'co', '467') = -7500, 'customs clearing owes duty plus import VAT (1,500 + 6,000)');

-- ---------- the books -------------------------------------------------------------------------------
select t.login('tina@tax.al');
select t.ok((select count(*) from public.vat_book(:'co', :'m1', current_date, 'sales')) = 6, 'sales book: 4 invoices, 1 credit note, 1 reverse charge');
select t.ok((select cols = '{"b20": -1000.00, "v20": -200.00}'::jsonb from public.vat_book(:'co', :'m1', current_date, 'sales') where doc_type = 'credit_note'),
            'credit note is negative in its rate column');
select t.ok((select cols ->> 'b20' from public.vat_book(:'co', :'m1', current_date, 'sales') where partner = 'Kunde GmbH' and cols ? 'b20') = '5000.00',
            'EUR invoice in base currency at its rate (50 × 100)');
select t.ok((select count(*) from public.vat_book(:'co', :'m1', current_date, 'purchase')) = 6, 'purchase book: 4 bills, 1 credit, 1 customs declaration');
select t.ok((select cols = '{"impb": 30000.00, "impv": 6000.00}'::jsonb from public.vat_book(:'co', :'m1', current_date, 'purchase') where number = 'DUD-AL-2026-55001'),
            'customs declaration listed under its DUD number with import VAT');
select t.ok((select cols ->> 'nded' from public.vat_book(:'co', :'m1', current_date, 'purchase') where ref = 'Q-CAR-1') = '1200.00',
            'non-deductible purchase shown gross');

select public.vat_return_preview(:'co', :'m1', (:'m1'::date + interval '1 month - 1 day')::date) as pv \gset
select t.ok(pg_temp.box(:'pv', 's.b20') = 14000 and pg_temp.box(:'pv', 's.v20') = 2800 and pg_temp.box(:'pv', 's.b6') = 2000 and pg_temp.box(:'pv', 's.v6') = 120,
            'output by rate: 20% 14,000 / 2,800; 6% 2,000 / 120');
select t.ok(pg_temp.box(:'pv', 's.export') = 3000 and pg_temp.box(:'pv', 's.exempt') = 500, 'exports and exempt supplies');
select t.ok(pg_temp.box(:'pv', 'p.b20') = 18000 and pg_temp.box(:'pv', 'p.v20') = 3600 and pg_temp.box(:'pv', 'p.invv') = 10000
            and pg_temp.box(:'pv', 'p.impv') = 6000 and pg_temp.box(:'pv', 'p.rcv') = 2000 and pg_temp.box(:'pv', 'p.nded') = 1200,
            'input: domestic, capital, import, reverse charge; non-deductible apart');
select t.ok((:'pv'::jsonb ->> 'output_vat')::numeric = 4920 and (:'pv'::jsonb ->> 'input_vat')::numeric = 21600, 'output 4,920 and input 21,600');
select t.ok((:'pv'::jsonb ->> 'payable')::numeric = 0 and (:'pv'::jsonb ->> 'carry_forward')::numeric = 16680, 'a credit of 16,680 is carried forward');
select t.ok((:'pv'::jsonb #>> '{ledger,output_difference}')::numeric = 0 and (:'pv'::jsonb #>> '{ledger,input_difference}')::numeric = 0,
            'the books tie to VAT in the ledger');

-- ---------- declaration lifecycle -------------------------------------------------------------------
select public.create_vat_declaration(:'co', :'y', :'mo') as d1 \gset
select t.throws(format($q$select public.create_vat_declaration(%L, %s, %s)$q$, :'co', :'y', :'mo'), 'already a declaration', 'one declaration per month');
select public.refresh_vat_declaration(:'d1', 5000);
select t.ok((select (refund_requested, carry_forward, payable) = (5000.00, 11680.00, 0.00) from public.vat_declarations where id = :'d1'),
            'refund of 5,000 requested, 11,680 carried forward');
select t.throws(format($q$update public.vat_declarations set status = 'accepted' where id = %L$q$, :'d1'), 'set by its own action', 'status is not edited by hand');
select public.create_vat_declaration(:'co', extract(year from :'m2'::date)::int, extract(month from :'m2'::date)::int) as d2 \gset
select t.ok((select credit_brought_forward from public.vat_declarations where id = :'d2') = 0, 'nothing is carried from an unsubmitted month');
select t.throws(format($q$select public.submit_vat_declaration(%L)$q$, :'d2'), 'earlier declarations first', 'declarations are submitted in order');
select public.submit_vat_declaration(:'d1', 'DPT-REF-1');
select t.ok(pg_temp.bal(:'co', '4457') = 0 and pg_temp.bal(:'co', '4456') = 0 and pg_temp.bal(:'co', '4455') = 16680,
            'settlement clears output and input VAT into 4455 (16,680 credit)');
select public.refresh_vat_declaration(:'d2');
select t.ok((select credit_brought_forward from public.vat_declarations where id = :'d2') = 11680, 'next month starts with the 11,680 credit');
select t.throws(format($q$select pg_temp.inv(%L, %L, 'ALL', 1, jsonb_build_array(jsonb_build_object('d','Late','q',1,'p',100,'t',%L)))$q$, :'co', :'cust', :'vat20'),
                'already declared', 'no back-dated invoices into a declared month');
select public.decide_vat_declaration(:'d1', false, 'Wrong refund amount');
select t.ok(pg_temp.bal(:'co', '4455') = 0 and pg_temp.bal(:'co', '4457') = -4920, 'rejection reverses the settlement');
select public.reopen_vat_declaration(:'d1');
select public.refresh_vat_declaration(:'d1', 0);
select public.submit_vat_declaration(:'d1');
select public.decide_vat_declaration(:'d1', true);
select t.ok((select (status, carry_forward) = ('accepted', 16680.00) from public.vat_declarations where id = :'d1'), 'resubmitted without refund and accepted');
select t.ok(exists (select 1 from public.tax_calendar(:'co', 2) where obligation = 'vat'), 'tax calendar lists VAT obligations');

-- ---------- fiscalization ---------------------------------------------------------------------------
select t.ok((select count(*) from public.fiscalization_records where company_id = :'co' and status = 'pending' and iic ~ '^[0-9A-F]{32}$') = 5,
            'every posted invoice and credit note is queued with an IIC');
select t.ok((select request_payload ->> 'tin' from public.fiscalization_records where source_doc_id = :'i1') = 'K12345678L', 'queued with the issuer NIPT');
select t.ok((public.process_fiscal_queue(:'co')) ->> 'fiscalized' = '5', 'test environment: the queue is fiscalized');
select t.ok((select fiscal_status from public.sales_invoices where id = :'i1') = 'fiscalized'
            and (select qr_url like 'https://efiskalizimi-app-test.tatime.gov.al/%' from public.fiscalization_records where source_doc_id = :'i1'),
            'invoice fiscalized with an FIC and a verification QR link');
select t.ok((select fiscal_code is not null from public.vat_book(:'co', :'m1', current_date, 'sales') where number = (select number from public.sales_invoices where id = :'i1')),
            'the sales book shows the fiscal code (NIVF)');

-- ---------- permissions -----------------------------------------------------------------------------
select t.login('sam@tax.al');
select t.throws(format($q$select * from public.vat_book(%L, current_date, current_date, 'sales')$q$, :'co'), 'tax.read', 'sales reps cannot open the VAT books');
select t.throws(format($q$select public.create_vat_declaration(%L, 2026, 1)$q$, :'co'), 'Permission denied', 'or file declarations');

-- ---------- Kosovo: field numbers and credit notes in the other book ---------------------------------
select t.login('alice@alba.al');
select public.create_company('Tatim Kosova', 'XK', 'EUR') as xk \gset
select id as x18 from public.tax_codes where company_id = :'xk' and code = 'VAT18' \gset
select id as x8  from public.tax_codes where company_id = :'xk' and code = 'VAT8' \gset
select id as x0  from public.tax_codes where company_id = :'xk' and code = 'VAT0' \gset
select id as xex from public.tax_codes where company_id = :'xk' and code = 'EXEMPT' \gset
select id as xrc from public.tax_codes where company_id = :'xk' and code = 'VAT18-RC' \gset
select id as x602 from public.accounts where company_id = :'xk' and code = '602' \gset
insert into public.business_partners (company_id, code, name, kind, is_customer) values (:'xk', 'K1', 'Blerësi LLC', 'company', true) returning id as xc \gset
insert into public.business_partners (company_id, code, name, kind, is_vendor) values (:'xk', 'F1', 'Furnitori LLC', 'company', true) returning id as xv \gset
select pg_temp.inv(:'xk', :'xc', 'EUR', 1, jsonb_build_array(jsonb_build_object('d','A','q',1,'p',1000,'t',:'x18'), jsonb_build_object('d','B','q',1,'p',500,'t',:'x8'))) as xi1 \gset
select pg_temp.inv(:'xk', :'xc', 'EUR', 1, jsonb_build_array(jsonb_build_object('d','Export','q',1,'p',300,'t',:'x0'), jsonb_build_object('d','Exempt','q',1,'p',200,'t',:'xex'))) as xi2 \gset
select public.create_credit_note(:'xi1') as xcn \gset
delete from public.sales_invoice_lines where invoice_id = :'xcn' and tax_code_id = :'x8';
update public.sales_invoice_lines set unit_price = 100 where invoice_id = :'xcn';
select public.post_sales_invoice(:'xcn');
select pg_temp.bill(:'xk', :'xv', 'F-1', :'x602', 2000, :'x18') as xb1 \gset
select pg_temp.bill(:'xk', :'xv', 'F-2', :'x602', 400, :'x8') as xb2 \gset
select pg_temp.bill(:'xk', :'xv', 'F-3', :'x602', 600, :'xrc') as xb3 \gset
select public.create_vendor_credit(:'xb1') as xvc \gset
update public.vendor_bill_lines set unit_price = 200 where bill_id = :'xvc';
select public.post_vendor_bill(:'xvc');
select public.vat_return_preview(:'xk', :'m1', (:'m1'::date + interval '1 month - 1 day')::date) as xp \gset
select t.ok(pg_temp.box(:'xp', '12') = 1000 and pg_temp.box(:'xp', '13') = 180 and pg_temp.box(:'xp', '14') = 500 and pg_temp.box(:'xp', '15') = 40,
            'XK [12]/[13] and [14]/[15]: taxable supplies at 18% and 8%');
select t.ok(pg_temp.box(:'xp', '11') = 300 and pg_temp.box(:'xp', '9') = 200, 'XK [11] exports and [9] exempt');
select t.ok(pg_temp.box(:'xp', '53') = 100 and pg_temp.box(:'xp', '54') = 18, 'XK credit note issued goes to [53]/[54] in the purchase book');
select t.ok(pg_temp.box(:'xp', '16') = 200 and pg_temp.box(:'xp', '17') = 36, 'XK credit note received goes to [16]/[17] in the sales book');
select t.ok(pg_temp.box(:'xp', '28') = 600 and pg_temp.box(:'xp', '29') = 108 and pg_temp.box(:'xp', '65') = 600 and pg_temp.box(:'xp', '66') = 108,
            'XK reverse charge in [28]/[29] and [65]/[66]');
select t.ok(pg_temp.box(:'xp', '43') = 2000 and pg_temp.box(:'xp', '44') = 360 and pg_temp.box(:'xp', '45') = 400 and pg_temp.box(:'xp', '46') = 32,
            'XK domestic purchases [43]–[46]');
select t.ok(pg_temp.box(:'xp', '30') = 364 and pg_temp.box(:'xp', '67') = 518 and pg_temp.box(:'xp', '72') = 0 and pg_temp.box(:'xp', '69') = 154
            and pg_temp.box(:'xp', '71') = 154, 'XK [30] 364, [67] 518 → credit [69] 154 carried [71]');
select t.ok((:'xp'::jsonb #>> '{ledger,output_difference}')::numeric = 0 and (:'xp'::jsonb #>> '{ledger,input_difference}')::numeric = 0,
            'XK books tie to the ledger once credit notes are moved back');

reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
