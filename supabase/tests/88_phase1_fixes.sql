-- =============================================================================
-- The deep check, phase 1: roles, the till's tables, refunds, bills from receipts, a till sale in a
-- declared VAT month  (runs after 64, 80–87 on "Kontrolle Test")
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
select id as ses from public.pos_sessions where register_id = :'reg' and status = 'open' order by opened_at desc limit 1 \gset
select id as beer from public.product_variants where company_id = :'co' and sku = 'KT-BEER' \gset
select app.main_location(:'shop') as loc \gset
select app.purchase_tax(:'co', 18) as vat18 \gset
select m.id as besa_m from public.company_members m join public.profiles p on p.id = m.user_id where m.company_id = :'co' and p.email = 'besa@kt.al' \gset
select m.id as cora_m from public.company_members m join public.profiles p on p.id = m.user_id where m.company_id = :'co' and p.email = 'cora@kt.al' \gset
select m.id as wanda_m from public.company_members m join public.profiles p on p.id = m.user_id where m.company_id = :'co' and p.email = 'wanda@kt.al' \gset
select m.id as ivo_m, m.user_id as ivo_u from public.company_members m join public.profiles p on p.id = m.user_id where m.company_id = :'co' and p.email = 'ivo@kt.al' \gset
select id as r_admin from public.roles where key = 'company_admin' and company_id is null \gset
select id as r_cashier from public.roles where key = 'pos_cashier' and company_id is null \gset
select id as r_inv from public.roles where key = 'inventory_manager' and company_id is null \gset
select id as r_acc from public.roles where key = 'accountant' and company_id is null \gset
update public.company_settings set pos_void_approval = true where company_id = :'co';
set role authenticated;

-- ---------------------------------------------------------------- roles: nobody gives what they do not have
select t.login(:'boss');
select public.save_custom_role(:'co', null, 'Menaxher përdoruesish', null, array['admin.read', 'admin.write', 'pos.read']) as r_um \gset
select public.set_member_roles(:'wanda_m', array[:'r_um']::uuid[]);
select t.login('wanda@kt.al');
select t.throws(format($q$select public.set_member_roles(%L, array[%L]::uuid[])$q$, :'wanda_m', :'r_admin'), 'rights you do not have', 'a user manager cannot make herself admin');
select t.throws(format($q$select public.set_member_roles(%L, array[%L]::uuid[])$q$, :'cora_m', :'r_cashier'), 'rights you do not have', 'nor give a role with rights she lacks');
select t.throws(format($q$select public.save_custom_role(%L, null, 'Më shumë', null, array['finance.write'])$q$, :'co'), 'rights you do not have', 'nor write such a role');
select public.save_custom_role(:'co', null, 'Vetëm arka', null, array['pos.read']) as r_small \gset
select t.ok(:'r_small' is not null, 'a role within her own rights is fine');

-- ---------------------------------------------------------------- the till's tables: through its functions only
select t.login('cora@kt.al');
select t.throws(format($q$insert into public.pos_payments (company_id, pos_order_id, method, amount) select %L, id, 'cash', -50 from public.pos_orders where session_id = %L limit 1$q$, :'co', :'ses'),
  'row-level security', 'a cashier cannot write a payment straight into the table');
select t.throws(format($q$insert into public.pos_cash_movements (company_id, session_id, movement_type, amount, reason) values (%L, %L, 'cash_out', 20, 'x')$q$, :'co', :'ses'),
  'row-level security', 'nor take cash out past the till');

-- ---------------------------------------------------------------- refunds
select t.login(:'boss');
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses', 'cashier_id', (select id from public.profiles where email = 'cora@kt.al'),
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'beer', 'quantity', 1, 'unit_price', 1, 'discount_pct', 0, 'manual_pct', 0),
                             jsonb_build_object('variant_id', :'beer', 'quantity', 1, 'unit_price', 1, 'discount_pct', 50, 'manual_pct', 50)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1.5)))) ->> 'id' as sale \gset
select t.login('cora@kt.al');
select t.throws(format($q$select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', %L, 'is_refund', true, 'refund_of_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', -2, 'unit_price', 1, 'discount_pct', 0)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', -1.5))))$q$, :'ses', :'sale', :'beer'), 'needs a manager', 'money back needs a manager');
select public.pos_approve(:'reg', :'besa_m', '5917', 'refund') ->> 'approval' as ap \gset
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses', 'is_refund', true, 'refund_of_id', :'sale', 'approval', :'ap',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'beer', 'quantity', -2, 'unit_price', 1, 'discount_pct', 0)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', -1.5)))) as rf \gset
select t.ok((:'rf'::jsonb ->> 'total')::numeric = -1.5, 'a full-price and a half-price beer: 1.50 back, not 2.00');
select public.pos_approve(:'reg', :'besa_m', '5917', 'refund') ->> 'approval' as ap2 \gset
select t.throws(format($q$select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', %L, 'is_refund', true, 'refund_of_id', %L, 'approval', %L,
  'lines', jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', -1, 'unit_price', 1, 'discount_pct', 0)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', -0.75))))$q$, :'ses', :'sale', :'ap2', :'beer'), 'more than', 'nothing more than the receipt');

-- ---------------------------------------------------------------- 4081: a bill made from a receipt
select t.login(:'boss');
insert into public.goods_receipts (company_id, warehouse_id, vendor_id, receipt_date) values (:'co', :'shop', :'ven', current_date) returning id as gr \gset
insert into public.goods_receipt_lines (company_id, receipt_id, variant_id, location_id, quantity, unit_cost, unit_price) values (:'co', :'gr', :'beer', :'loc', 10, 0.5, 0.5);
select public.post_goods_receipt(:'gr');
select public.create_bill_from_receipt(:'gr') as bill \gset
update public.vendor_bills set vendor_invoice_number = 'FT-4081-T', bill_date = current_date where id = :'bill';
update public.vendor_bill_lines set quantity = 12, tax_code_id = :'vat18' where bill_id = :'bill';
select t.throws(format($q$select public.post_vendor_bill(%L)$q$, :'bill'), 'received', 'no more is billed than came in');
update public.vendor_bill_lines set quantity = 10, unit_price = 0.45 where bill_id = :'bill';
select public.post_vendor_bill(:'bill');
reset role;
select t.ok((select sum(jl.debit - jl.credit) from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
              where jl.account_id = app.acct(:'co', 'grni') and e.source_doc_id in (:'gr'::uuid, :'bill'::uuid)) = 0,
  'a cheaper bill still clears 4081 at the receipt''s cost');
select t.ok((select capitalized_variance + expensed_variance from public.vendor_bill_lines where bill_id = :'bill') = -0.5, 'the 0.50 difference goes to the stock and 6011');
set role authenticated;

-- ---------------------------------------------------------------- a till sale in a declared VAT month
select t.login(:'boss');
select public.set_member_roles(:'ivo_m', array[:'r_inv', :'r_acc']::uuid[]);
reset role;
insert into public.vat_declarations (company_id, number, status, country_code, period_start, period_end)
values (:'co', 'DEK-TEST', 'draft', 'XK', date_trunc('month', current_date)::date, (date_trunc('month', current_date) + interval '1 month - 1 day')::date);
update public.vat_declarations set status = 'submitted', submitted_at = now() where company_id = :'co' and number = 'DEK-TEST';
set role authenticated;
select t.login(:'boss');
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'beer', 'quantity', 1, 'unit_price', 1, 'discount_pct', 0, 'manual_pct', 0)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 1)))) ->> 'id' as late \gset
reset role;
select t.ok(exists (select 1 from public.notifications where user_id = :'ivo_u' and entity_id = :'late'::uuid and title like '%arrived after the VAT%'),
  'the sale stands, and the accountant is told the declaration needs correcting');
select t.ok(not has_function_privilege('anon', 'app.rights_lacking(uuid, text[])', 'execute'), 'not for anonymous callers');

-- ---------------------------------------------------------------- the scales' barcodes: the item's PLU
update public.products set scale_plu = '01234' where id = (select product_id from public.product_variants where id = :'beer');
select t.ok((select scale_plu from public.pos_catalog(:'reg') where variant_id = :'beer') = '1234', 'the till knows the item''s scale PLU');
select t.throws(format($q$update public.products set scale_plu = '1234' where company_id = %L and code = 'KT-MILK'$q$, :'co'), 'duplicate', 'one PLU, one item');

\set QUIET off
select count(*) as assertions_passed from t.results;
