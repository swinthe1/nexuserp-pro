-- =============================================================================
-- From the meeting with the administrative staff: paying a supplier or an expense from the till
-- (#11), and the managers told of every item taken off (#26). (runs after 64 "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select id as reg from public.pos_registers where company_id = :'co' and code = 'T10' \gset
select m.id as besa_m from public.company_members m join public.profiles p on p.id = m.user_id where m.company_id = :'co' and p.email = 'besa@kt.al' \gset
select id as besa from auth.users where email = 'besa@kt.al' \gset
select id as cora from auth.users where email = 'cora@kt.al' \gset
select a.account_id as drawer_acc from public.pos_registers r join public.bank_accounts a on a.id = r.cash_account_id where r.id = :'reg' \gset
select id as shop from public.warehouses where company_id = :'co' order by created_at limit 1 \gset
select id as beer from public.product_variants where company_id = :'co' and sku = 'KT-BEER' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
set role authenticated;
select t.login(:'boss');
-- a supplier with two completed invoices (20 and 15)
insert into public.business_partners (company_id, code, name, is_vendor, tax_number) values (:'co', 'FT1', 'Furra e Qytetit', true, '811990011') returning id as ven \gset
select public.save_document('vendor_bills', jsonb_build_object('company_id', :'co', 'document_type', 'vendor_bill', 'vendor_id', :'ven', 'vendor_invoice_number', 'A-101',
   'bill_date', current_date - 10, 'due_date', current_date, 'currency_code', 'EUR', 'warehouse_id', :'shop'),
   jsonb_build_object('vendor_bill_lines', jsonb_build_array(jsonb_build_object('line_no', 1, 'variant_id', :'beer', 'description', 'Birra', 'quantity', 20, 'unit_price', 1)))) as b1 \gset
select public.purchase_invoice_complete(:'b1');
select public.save_document('vendor_bills', jsonb_build_object('company_id', :'co', 'document_type', 'vendor_bill', 'vendor_id', :'ven', 'vendor_invoice_number', 'A-102',
   'bill_date', current_date - 5, 'due_date', current_date, 'currency_code', 'EUR', 'warehouse_id', :'shop'),
   jsonb_build_object('vendor_bill_lines', jsonb_build_array(jsonb_build_object('line_no', 1, 'variant_id', :'beer', 'description', 'Birra', 'quantity', 15, 'unit_price', 1)))) as b2 \gset
select public.purchase_invoice_complete(:'b2');
reset role;
select t.ok((select sum(total) from public.vendor_bills where vendor_id = :'ven' and status = 'posted') = 35, 'the supplier is owed 35');
select id as acc_exp from public.accounts where company_id = :'co' and account_type = 'expense' and account_subtype = 'expense' and is_postable order by code limit 1 \gset
set role authenticated;

-- ---------------------------------------------------------------- 11. paying from the drawer
select t.ok(public.pos_till_options(:'reg') ->> 'payouts' = 'manager', 'by default a manager, or a cashier with the manager''s PIN, pays from the till');
select t.login('cora@kt.al');
select public.open_pos_session(:'reg', 100) as ses \gset
select t.ok(jsonb_path_exists(public.pos_payees(:'reg'), '$.vendors[*] ? (@.name == "Furra e Qytetit" && @.open == 35)'), 'the till lists the supplier with what is owed');
select t.ok(jsonb_array_length(public.pos_vendor_bills(:'reg', :'ven')) = 2, 'and its open invoices');
select t.throws(format($q$select public.pos_pay_out(%L, jsonb_build_object('kind', 'supplier', 'amount', 25, 'partner_id', %L))$q$, :'ses', :'ven'), 'manager confirms', 'a cashier alone cannot pay');
select public.pos_approve(:'reg', :'besa_m', '5917', 'payout') ->> 'approval' as pap \gset
select public.pos_pay_out(:'ses', jsonb_build_object('kind', 'supplier', 'amount', 25, 'partner_id', :'ven', 'document_no', 'A-101/2', 'approval', :'pap')) as po \gset
select t.ok((:'po'::jsonb ->> 'allocated')::numeric = 25 and (:'po'::jsonb ->> 'advance')::numeric = 0, 'with the manager''s PIN the supplier is paid, all of it onto invoices');
reset role;
select t.ok((select amount_paid from public.vendor_bills where id = :'b1') = 20 and (select amount_paid from public.vendor_bills where id = :'b2') = 5, 'the oldest invoice first, the rest onto the next');
select t.ok((select status from public.payments where id = (:'po'::jsonb ->> 'payment_id')::uuid) = 'posted', 'the payment is posted at once');
select t.ok((select sum(jl.credit) from public.journal_lines jl join public.payments p on p.journal_entry_id = jl.entry_id
              where p.id = (:'po'::jsonb ->> 'payment_id')::uuid and jl.account_id = :'drawer_acc') = 25, 'the money leaves the till''s drawer account');
select t.ok((select approved_by from public.pos_cash_movements where id = (:'po'::jsonb ->> 'id')::uuid) = :'besa', 'who confirmed is kept');
set role authenticated;
select t.login('cora@kt.al');
select t.ok(jsonb_path_exists(public.pos_payees(:'reg'), '$.vendors[*] ? (@.name == "Furra e Qytetit" && @.open == 10)'), 'the supplier''s card shows 10 still owed');
select t.throws(format($q$select public.pos_pay_out(%L, jsonb_build_object('kind', 'supplier', 'amount', 5, 'partner_id', %L, 'approval', %L))$q$, :'ses', :'ven', :'pap'), 'manager confirms', 'a confirmation is good once');
select t.ok((app.pos_summary_all(:'ses') ->> 'expected_cash')::numeric = 75, 'the cash expected at closing is 25 less');

-- the manager herself: an expense, and a supplier paid more than owed
select t.login('besa@kt.al');
select t.throws(format($q$select public.pos_pay_out(%L, jsonb_build_object('kind', 'expense', 'amount', 5, 'account_id', %L))$q$, :'ses', :'acc_exp'), 'Write what was paid', 'an expense says what was paid');
select t.throws(format($q$select public.pos_pay_out(%L, jsonb_build_object('kind', 'expense', 'amount', 500, 'account_id', %L, 'note', 'x'))$q$, :'ses', :'acc_exp'), 'drawer holds', 'not more than the drawer holds');
select public.pos_pay_out(:'ses', jsonb_build_object('kind', 'expense', 'amount', 5.5, 'account_id', :'acc_exp', 'note', 'Mjete pastrimi', 'document_no', 'K-55')) as ex \gset
reset role;
select t.ok((select jl.debit from public.journal_lines jl where jl.entry_id = (:'ex'::jsonb ->> 'journal_entry_id')::uuid and jl.account_id = :'acc_exp') = 5.5
        and (select jl.credit from public.journal_lines jl where jl.entry_id = (:'ex'::jsonb ->> 'journal_entry_id')::uuid and jl.account_id = :'drawer_acc') = 5.5,
        'the expense is booked against the drawer');
set role authenticated;
select t.login('besa@kt.al');
select public.pos_pay_out(:'ses', jsonb_build_object('kind', 'supplier', 'amount', 30, 'partner_id', :'ven', 'bills', jsonb_build_array(jsonb_build_object('id', :'b2')))) as po2 \gset
select t.ok((:'po2'::jsonb ->> 'allocated')::numeric = 10 and (:'po2'::jsonb ->> 'advance')::numeric = 20, 'more than owed: the rest stays on the card as paid in advance');
select t.ok(jsonb_array_length(public.pos_vendor_bills(:'reg', :'ven')) = 0, 'no invoice is left open');

-- the company's choice
select public.automation_settings_save(:'co', '{"pos_payouts": "anyone"}');
select t.login('cora@kt.al');
select t.ok(public.pos_pay_out(:'ses', jsonb_build_object('kind', 'expense', 'amount', 2, 'account_id', :'acc_exp', 'note', 'Ujë')) ? 'id', 'set to every cashier, no PIN is asked');
select t.ok(jsonb_array_length(public.pos_session_payouts(:'ses')) = 4, 'the shift lists what was paid from it');
select t.login('besa@kt.al');
select public.automation_settings_save(:'co', '{"pos_payouts": "off"}');
select t.login('cora@kt.al');
select t.throws(format($q$select public.pos_pay_out(%L, jsonb_build_object('kind', 'expense', 'amount', 1, 'account_id', %L, 'note', 'x'))$q$, :'ses', :'acc_exp'), 'switched off', 'switched off: only in Finance');

-- ---------------------------------------------------------------- 26. an item taken off
select public.pos_log(:'ses', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'kind', 'void_line', 'description', 'Bukë', 'quantity', 1, 'amount', 0.5, 'at', now())));
reset role;
select t.ok(not exists (select 1 from public.notifications where company_id = :'co' and type = 'pos_void'), 'nobody is told unless the company asks for it');
set role authenticated;
select t.login('besa@kt.al');
select public.automation_settings_save(:'co', '{"pos_void_notify": true, "pos_void_notify_over": 1, "pos_void_whatsapp": ["044 111 222", " "]}');
reset role;
select t.ok((select pos_void_whatsapp = '{044 111 222}' from public.company_settings where company_id = :'co'), 'the WhatsApp numbers are kept, empty ones dropped');
set role authenticated;
select t.login('cora@kt.al');
select public.pos_log(:'ses', jsonb_build_array(
  jsonb_build_object('id', gen_random_uuid(), 'kind', 'void_line', 'description', 'Çokollatë', 'quantity', 1, 'amount', 0.8, 'at', now()),
  jsonb_build_object('id', gen_random_uuid(), 'kind', 'void_line', 'description', 'Birra Peja', 'quantity', 3, 'amount', 3, 'at', now())));
reset role;
select t.ok((select count(*) from public.notifications where company_id = :'co' and type = 'pos_void' and user_id = :'besa') = 1, 'the store manager is told once: the smaller void is under the amount chosen');
select t.ok(exists (select 1 from public.notifications where company_id = :'co' and type = 'pos_void' and user_id = :'besa'
                     and title like 'Item taken off at Till 10 (%): Birra Peja' and body like 'Quantity 3, 3,00 €, %, cashier Cora Arkëtare, without a manager'),
        'with the item, the till, the quantity, the amount, the time and the cashier');
select t.ok(not exists (select 1 from public.notifications where company_id = :'co' and type = 'pos_void' and user_id = :'cora'), 'the cashier herself is not told');

\set QUIET off
select count(*) as assertions_passed from t.results;
