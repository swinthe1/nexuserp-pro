-- =============================================================================
-- DrisPRO · the purchase invoice that brings the goods in (runs after 01–23)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

set role authenticated;
select t.login('zoe@platform.io');
select public.platform_create_client(jsonb_build_object('name', 'Kalkulim Test', 'country', 'XK', 'owner_email', 'alice@alba.al', 'plan', 'pro', 'max_users', 10,
  'valid_until', (current_date + 365)::text)) as co \gset
select t.login('alice@alba.al');
create or replace function pg_temp.bal(p_co uuid, p_key text) returns numeric language sql as $$
  select coalesce(sum(jl.debit - jl.credit), 0) from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
   where jl.company_id = p_co and jl.account_id = app.acct(p_co, p_key) and e.status in ('posted','reversed') $$;
select id as pcs  from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
select id as vat  from public.tax_codes where company_id = :'co' and rate = 18 and deleted_at is null limit 1 \gset
select id as wh   from public.warehouses where company_id = :'co' and code = 'WH' \gset
select id as cash from public.bank_accounts where company_id = :'co' and account_kind = 'cash' limit 1 \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'SUX', 'name', 'Suxhuk', 'uom_id', :'pcs',
       'sales_price', 4.6525, 'sales_tax_code_id', :'vat', 'purchase_tax_code_id', :'vat')) as p_sux \gset
select id as sux from public.product_variants where product_id = :'p_sux' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'MILK', 'name', 'Qumësht', 'uom_id', :'pcs', 'tracking', 'lot', 'track_expiry', true,
       'sales_price', 1, 'sales_tax_code_id', :'vat', 'purchase_tax_code_id', :'vat')) as p_milk \gset
select id as milk from public.product_variants where product_id = :'p_milk' \gset
insert into public.business_partners (company_id, code, name, is_vendor) values (:'co', 'F1', 'Kluna', true) returning id as ven \gset

-- the invoice as it is typed on the screen
insert into public.vendor_bills (company_id, vendor_id, vendor_invoice_number, vendor_fiscal_number, currency_code, warehouse_id, pay_bank_account_id)
values (:'co', :'ven', '005571', '811172824', 'EUR', :'wh', :'cash') returning id as bill \gset
insert into public.vendor_bill_lines (company_id, bill_id, line_no, variant_id, description, quantity, unit_price, discount1_pct, discount2_pct, tax_code_id, sales_price_new)
values (:'co', :'bill', 1, :'sux', 'Suxhuk', 10, 4, 10, 5, :'vat', 5.0847);
select t.ok((select discount_pct from public.vendor_bill_lines where bill_id = :'bill') = 14.5, 'two discounts one after the other: 10 % then 5 % is 14.5 %');
insert into public.vendor_bill_lines (company_id, bill_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
values (:'co', :'bill', 2, :'milk', 'Qumësht', 20, 0.5, :'vat') returning id as ml \gset
select t.throws(format($q$select public.purchase_invoice_complete(%L)$q$, :'bill'), 'needs a lot number', 'items kept by lot need their lot');
update public.vendor_bill_lines set lot_number = 'L-2611', expiry_date = current_date + 20 where id = :'ml';

select t.ok((public.purchase_item_info(:'co', :'ven', array[:'sux']::uuid[]) -> 'items' -> :'sux' ->> 'sales_net')::numeric = 4.6525, 'the screen gets the selling price now');
select public.purchase_invoice_complete(:'bill') as r \gset
select t.ok((:'r'::jsonb ->> 'status') = 'posted' and (:'r'::jsonb ->> 'lines_received')::int = 2, 'one step: received and posted');
select t.ok((select sum(on_hand) from public.stock_levels where variant_id = :'sux' and warehouse_id = :'wh') = 10, 'the goods are in the warehouse');
select t.ok((select avg_cost from t.item_costs where variant_id = :'sux') = 3.42, 'at the price after both discounts (4 × 0.855)');
select t.ok(exists (select 1 from public.stock_levels sl join public.lots l on l.id = sl.lot_id where sl.variant_id = :'milk' and l.lot_number = 'L-2611' and l.expiry_date = current_date + 20),
  'with its lot and expiry date');
select t.ok((select sales_price from public.products where id = :'p_sux') = 5.0847, 'the new selling price is set');
select t.ok(exists (select 1 from public.price_changes where variant_id = :'sux' and new_price = 5.0847), 'and recorded among the price changes');
select t.ok((select payment_status from public.vendor_bills where id = :'bill') = 'paid', 'paid in cash at once');
select t.ok((select receipt_id is not null and vendor_fiscal_number = '811172824' from public.vendor_bills where id = :'bill'), 'the bill knows its receipt and the fiscal number');
select t.ok((public.purchase_item_info(:'co', :'ven', array[:'sux']::uuid[]) -> 'items' -> :'sux' -> 'last' ->> 'price')::numeric = 4, 'next time it shows the last price from this supplier');
select t.throws(format($q$select public.purchase_invoice_complete(%L)$q$, :'bill'), 'Only a draft', 'it cannot be completed twice');

-- no warehouse: not completed here
insert into public.vendor_bills (company_id, vendor_id, vendor_invoice_number, currency_code) values (:'co', :'ven', 'X-2', 'EUR') returning id as bill2 \gset
insert into public.vendor_bill_lines (company_id, bill_id, line_no, variant_id, description, quantity, unit_price, tax_code_id) values (:'co', :'bill2', 1, :'sux', 'Suxhuk', 1, 4, :'vat');
select t.throws(format($q$select public.purchase_invoice_complete(%L)$q$, :'bill2'), 'Choose the warehouse', 'the warehouse is needed');

reset role;
select t.ok(pg_temp.bal(:'co', 'grni') = 0, 'goods received and billed: nothing left waiting');
\set QUIET off
select count(*) as assertions_passed from t.results;
