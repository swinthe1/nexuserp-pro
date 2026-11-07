-- =============================================================================
-- The deep check, phase 2 at the till: new prices during the day, a refund without a receipt, a sale on
-- account up to the credit limit, vouchers with a balance  (runs after 64, 80–88 on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select id as reg from public.pos_registers where company_id = :'co' and code = 'T10' \gset
select id as ses from public.pos_sessions where register_id = :'reg' and status = 'open' order by opened_at desc limit 1 \gset
select id as beer, product_id as beer_p from public.product_variants where company_id = :'co' and sku = 'KT-BEER' \gset
select m.id as besa_m from public.company_members m join public.profiles p on p.id = m.user_id where m.company_id = :'co' and p.email = 'besa@kt.al' \gset
select a.account_id as drawer_acc from public.pos_registers r join public.bank_accounts a on a.id = r.cash_account_id where r.id = :'reg' \gset
set role authenticated;

-- ---------------------------------------------------------------- new prices during the day
select t.login('cora@kt.al');
select t.ok((public.pos_catalog_changes(:'reg', null) ->> 'full')::boolean, 'the first look reads the whole catalog');
select clock_timestamp() as since \gset
select t.login(:'boss');
update public.products set sales_price = sales_price + 1 where id = :'beer_p';
select t.login('cora@kt.al');
select public.pos_catalog_changes(:'reg', :'since') as ch \gset
select t.ok(not (:'ch'::jsonb ->> 'full')::boolean and jsonb_path_exists(:'ch'::jsonb, '$.items[*] ? (@.sku == "KT-BEER")')
            and (select count(*) from jsonb_array_elements(:'ch'::jsonb -> 'items')) = 1, 'later looks bring only the item whose price changed');
select (e ->> 'price')::numeric as beer_price from jsonb_array_elements(:'ch'::jsonb -> 'items') e \gset
select t.ok(:beer_price = (select price from public.pos_catalog(:'reg') where variant_id = :'beer'), 'at the new price');
select clock_timestamp() as since2 \gset
select t.login(:'boss');
update public.products set is_sellable = false where id = :'beer_p';
select t.login('cora@kt.al');
select t.ok(public.pos_catalog_changes(:'reg', :'since2') -> 'gone' ? :'beer', 'an item no longer sold leaves the till');
select t.login(:'boss');
update public.products set is_sellable = true where id = :'beer_p';
select t.ok((public.pos_catalog_changes(:'reg', now() - interval '13 hours') ->> 'full')::boolean, 'after a long while, all of it again');

-- ---------------------------------------------------------------- refund without a receipt
select t.login('cora@kt.al');
select t.throws(format($q$select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', %L, 'is_refund', true, 'refund_reason', 'Kuponi humbi',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', -1, 'unit_price', %s)), 'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', -%s))))$q$,
  :'ses', :'beer', :beer_price, :beer_price), 'without a receipt needs', 'no receipt: a manager''s PIN');
select public.pos_approve(:'reg', :'besa_m', '5917', 'refund') ->> 'approval' as ap \gset
select t.throws(format($q$select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', %L, 'is_refund', true, 'approval', %L,
  'lines', jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', -1, 'unit_price', %s)), 'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', -%s))))$q$,
  :'ses', :'ap', :'beer', :beer_price, :beer_price), 'Say why', 'and a reason');
select t.throws(format($q$select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', %L, 'is_refund', true, 'approval', %L, 'refund_reason', 'Kuponi humbi',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', -1, 'unit_price', %s)), 'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', -%s))))$q$,
  :'ses', :'ap', :'beer', :beer_price + 5, :beer_price + 5), 'must equal', 'never more than the till''s price');
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses', 'is_refund', true, 'approval', :'ap', 'refund_reason', 'Kuponi humbi',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'beer', 'quantity', -1, 'unit_price', :beer_price)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', -:beer_price)))) as nr \gset
reset role;
select t.ok((select refund_reason from public.pos_orders where id = (:'nr'::jsonb ->> 'id')::uuid) = 'Kuponi humbi', 'the reason is kept on the refund');
select t.ok(exists (select 1 from public.notifications where company_id = :'co' and title = 'Refund without a receipt: ' || (:'nr'::jsonb ->> 'number')), 'the managers are told');
set role authenticated;
select t.login('cora@kt.al');
select t.throws(format($q$select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', %L, 'is_refund', true, 'approval', %L, 'refund_reason', 'Kuponi humbi',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', -1, 'unit_price', %s)), 'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', -%s))))$q$,
  :'ses', :'ap', :'beer', :beer_price, :beer_price), 'without a receipt needs', 'one PIN, one refund');

-- ---------------------------------------------------------------- on account
select t.login(:'boss');
insert into public.business_partners (company_id, code, name, is_customer, tax_number) values (:'co', 'KB1', 'Kafe Bujari', true, '811990077') returning id as cus \gset
select t.login('cora@kt.al');
select t.throws(format($q$select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', %L, 'partner_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', 2, 'unit_price', %s)), 'payments', jsonb_build_array(jsonb_build_object('method', 'account', 'amount', 2 * %s))))$q$,
  :'ses', :'cus', :'beer', :beer_price, :beer_price), 'no credit limit', 'no credit limit, no sale on account');
select t.throws(format($q$select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', 2, 'unit_price', %s)), 'payments', jsonb_build_array(jsonb_build_object('method', 'account', 'amount', 2 * %s))))$q$,
  :'ses', :'beer', :beer_price, :beer_price), 'Choose the customer', 'nor for the walk-in customer');
select t.login(:'boss');
update public.business_partners set credit_limit = 3 * :beer_price where id = :'cus';
select t.login('cora@kt.al');
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses', 'partner_id', :'cus',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'beer', 'quantity', 2, 'unit_price', :beer_price)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'account', 'amount', 2 * :beer_price)))) ->> 'id' as acc_sale \gset
select t.ok((public.pos_customer_credit(:'reg', :'cus') ->> 'owes')::numeric = 2 * :beer_price, 'the till sees what the customer owes before the shift closes');
select t.throws(format($q$select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', %L, 'partner_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', 2, 'unit_price', %s)), 'payments', jsonb_build_array(jsonb_build_object('method', 'account', 'amount', 2 * %s))))$q$,
  :'ses', :'cus', :'beer', :beer_price, :beer_price), 'Over the credit limit', 'not past the limit');

-- ---------------------------------------------------------------- vouchers
select public.pos_voucher_sell(:'ses', jsonb_build_object('amount', 10, 'method', 'cash')) as v \gset
select :'v'::jsonb ->> 'code' as vcode \gset
reset role;
select t.ok((select balance from public.gift_vouchers where code = :'vcode' and company_id = :'co') = 10, 'a voucher of 10 is sold');
select t.ok((select sum(jl.credit - jl.debit) from public.journal_lines jl join public.gift_vouchers g on g.journal_entry_id = jl.entry_id
              where g.code = :'vcode' and jl.account_id = app.acct(:'co', 'customer_advances')) = 10, 'owed to its holder, not sold goods');
select t.ok(exists (select 1 from public.pos_cash_movements where session_id = :'ses' and kind = 'voucher' and amount = 10), 'and the drawer expects the cash');
set role authenticated;
select t.login('cora@kt.al');
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'beer', 'quantity', 1, 'unit_price', 6)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'voucher', 'amount', 6, 'reference', :'vcode')))) is not null as ok \gset
select t.ok((public.pos_voucher_check(:'reg', :'vcode') ->> 'balance')::numeric = 4, 'spent 6: 4 left');
select t.throws(format($q$select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', 1, 'unit_price', 6)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'voucher', 'amount', 6, 'reference', %L))))$q$, :'ses', :'beer', :'vcode'), 'has 4.00 left', 'not more than is left');
select t.throws(format($q$select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', 1, 'unit_price', 1)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'voucher', 'amount', 1))))$q$, :'ses', :'beer'), 'No voucher', 'a voucher payment names its code');
select t.throws(format($q$select public.voucher_block((select id from public.gift_vouchers where code = %L), 'Humbur')$q$, :'vcode'), 'Only a manager', 'a cashier cannot block a voucher');
select t.login('besa@kt.al');
select public.voucher_block((select id from public.gift_vouchers where code = :'vcode'), 'Humbur');
select t.login('cora@kt.al');
select t.throws(format($q$select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', %L,
  'lines', jsonb_build_array(jsonb_build_object('variant_id', %L, 'quantity', 1, 'unit_price', 1)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'voucher', 'amount', 1, 'reference', %L))))$q$, :'ses', :'beer', :'vcode'), 'blocked', 'a blocked voucher is not spent');

-- ---------------------------------------------------------------- the shift closes: the debt is on the customer's card
select t.login(:'boss');
select public.close_pos_session(:'ses', (app.pos_summary_all(:'ses') ->> 'expected_cash')::numeric);
reset role;
select t.ok((select sum(jl.debit - jl.credit) from public.journal_lines jl join public.pos_sessions s on s.journal_entry_id = jl.entry_id
              where s.id = :'ses' and jl.partner_id = :'cus') = 2 * :beer_price, 'the shift''s entry puts the sale on account on the customer');
select t.ok((public.partner_balances(:'co', 'customer') -> 'rows') @> jsonb_build_array(jsonb_build_object('name', 'Kafe Bujari', 'balance', 2 * :beer_price)), 'and the customer''s balance shows it');

\set QUIET off
select count(*) as assertions_passed from t.results;
