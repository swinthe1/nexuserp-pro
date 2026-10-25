-- =============================================================================
-- DrisPRO · loyalty cards (runs after 01–15; uses the shop from 06)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

set role authenticated;
select t.login('alice@alba.al');
select id as co from public.companies where name = 'Magazina Test' \gset
select id as tea from public.product_variants where company_id = :'co' and sku = (select v.sku from public.product_variants v join public.products p on p.id = v.product_id
  where p.company_id = :'co' and p.category_id = (select id from public.product_categories where company_id = :'co' and name = 'Tea') limit 1) \gset
select id as c_dairy from public.product_categories where company_id = :'co' and name = 'Dairy' \gset
select id as shop from public.warehouses where company_id = :'co' and code = 'SHOP' \gset
select id as floor from public.warehouse_locations where company_id = :'co' and code = 'SHOP/FLOOR' \gset
insert into public.bank_accounts (company_id, name, account_kind, currency_code, account_id)
select :'co', 'Till 9 drawer', 'cash', 'ALL', id from public.accounts where company_id = :'co' and code = '5311' returning id as drawer \gset
insert into public.pos_registers (company_id, code, name, warehouse_id, location_id, cash_account_id, journal_id)
select :'co', 'T9', 'Till 9', :'shop', :'floor', :'drawer', id from public.journals where company_id = :'co' and code = 'POS' returning id as reg \gset

-- card types
select public.loyalty_save_program(jsonb_build_object('company_id', :'co', 'name', 'Gold', 'kind', 'discount', 'discount_pct', 5,
  'excluded_category_ids', jsonb_build_array(:'c_dairy'))) as gold \gset
select public.loyalty_save_program(jsonb_build_object('company_id', :'co', 'name', 'Pikë', 'kind', 'points',
  'points_per_unit', 1, 'point_value', 0.01, 'min_redeem_points', 100)) as pts \gset
select public.loyalty_save_program(jsonb_build_object('company_id', :'co', 'name', 'Staf', 'kind', 'staff', 'discount_pct', 20, 'monthly_limit', 50)) as staff \gset
select t.throws(format($q$select public.loyalty_save_program('{"company_id":"%s","name":"Bad","kind":"points"}')$q$, :'co'), 'points per euro', 'a points card needs its rules');

select t.login('cora@wms.al');
select t.throws(format($q$select public.loyalty_save_program('{"company_id":"%s","name":"X","discount_pct":50}')$q$, :'co'), 'permission', 'a cashier cannot make card types');
select public.loyalty_issue_card(jsonb_build_object('company_id', :'co', 'program_id', :'gold', 'holder_name', 'Arben Krasniqi', 'phone', '+383 44 123 456')) as gcard \gset
select (:'gcard'::jsonb ->> 'id') as gid, (:'gcard'::jsonb ->> 'card_number') as gnum \gset
select t.ok(:'gnum' like '29%' and length(:'gnum') = 13 and right(:'gnum', 1) = app.gtin_check_digit(left(:'gnum', 12))::text, 'a new card gets an EAN-13 number in the store range');
select t.throws(format($q$select public.loyalty_issue_card('{"company_id":"%s","program_id":"%s","holder_name":"Copy","phone":"044 123 456"}')$q$, :'co', :'gold'),
  'phone number already', 'one card per phone number');
select (public.loyalty_issue_card(jsonb_build_object('company_id', :'co', 'program_id', :'pts', 'holder_name', 'Drita'))) ->> 'id' as pid \gset
select (public.loyalty_issue_card(jsonb_build_object('company_id', :'co', 'program_id', :'staff', 'holder_name', 'Punonjësi'))) ->> 'id' as sid \gset
select card_number as pnum from public.loyalty_cards where id = :'pid' \gset
select card_number as snum from public.loyalty_cards where id = :'sid' \gset

select public.open_pos_session(:'reg', 0) as ses \gset

-- discount card, found by phone
select public.loyalty_quote(:'reg', '044-123-456', jsonb_build_array(jsonb_build_object('variant_id', :'tea', 'quantity', 2, 'unit_price', 120, 'manual_pct', 0))) as q1 \gset
select t.ok((:'q1'::jsonb ->> 'holder_name') = 'Arben Krasniqi' and (:'q1'::jsonb -> 'lines' -> 0 ->> 'pct')::numeric = 5, 'the till finds the card by phone and gives 5%');
select t.ok((public.loyalty_quote(:'reg', :'gnum', jsonb_build_array(jsonb_build_object('category_id', :'c_dairy', 'quantity', 1, 'unit_price', 150, 'manual_pct', 0))) -> 'lines' -> 0 ->> 'eligible')::boolean = false,
  'excluded categories get no card discount');
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses', 'loyalty', jsonb_build_object('card_id', :'gid'),
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'tea', 'quantity', 2, 'unit_price', 120, 'discount_pct', 5, 'manual_pct', 0)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 228)))) as s1 \gset
select t.ok((:'s1'::jsonb ->> 'total')::numeric = 228, 'the card discount is on the receipt');
select t.ok((select loyalty_discount = 12 and loyalty_card_id = :'gid' from public.pos_orders where id = (:'s1'::jsonb ->> 'id')::uuid), 'the receipt remembers the card and the discount');
select t.ok((select sum(amount) from public.loyalty_ledger where card_id = :'gid' and kind = 'discount') = 12, 'the discount is in the card history');
select t.throws(format($q$select public.pos_submit_order('{"client_uuid":"%s","session_id":"%s","loyalty":{"card_id":"%s"},"lines":[{"variant_id":"%s","quantity":1,"unit_price":120,"discount_pct":9,"manual_pct":0}],"payments":[{"method":"cash","amount":110}]}')$q$,
  gen_random_uuid(), :'ses', :'gid', :'tea'), 'the card gives', 'nobody can type a bigger card discount');

-- points
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses', 'loyalty', jsonb_build_object('card_id', :'pid'),
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'tea', 'quantity', 2, 'unit_price', 120, 'discount_pct', 0, 'manual_pct', 0)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 240)))) as s2 \gset
select t.ok((select points_balance from public.loyalty_cards where id = :'pid') = 240, '1 point for each euro');
select t.login('alice@alba.al');
select public.loyalty_adjust_points(:'pid', 1000, 'Welcome gift');
select t.login('cora@wms.al');
select public.loyalty_quote(:'reg', :'pnum', jsonb_build_array(jsonb_build_object('variant_id', :'tea', 'quantity', 2, 'unit_price', 120, 'manual_pct', 0)), 500) as q2 \gset
select t.ok((:'q2'::jsonb ->> 'redeem_amount')::numeric = 5 and (:'q2'::jsonb -> 'lines' -> 0 ->> 'pct')::numeric = 2.08, '500 points take 5 off the receipt');
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses', 'loyalty', jsonb_build_object('card_id', :'pid', 'redeem_points', 500),
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'tea', 'quantity', 2, 'unit_price', 120, 'discount_pct', 2.08, 'manual_pct', 0)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 235.01)))) as s3 \gset
select t.ok((select points_balance from public.loyalty_cards where id = :'pid') = 1240 - 500 + 235, 'points spent and earned on the same receipt');
select t.ok((select points_redeemed = 500 and points_earned = 235 from public.pos_orders where id = (:'s3'::jsonb ->> 'id')::uuid), 'the receipt shows the points');
select t.ok((select amount from public.loyalty_ledger where pos_order_id = (:'s3'::jsonb ->> 'id')::uuid and kind = 'redeem') = 4.99
  and not exists (select 1 from public.loyalty_ledger where pos_order_id = (:'s3'::jsonb ->> 'id')::uuid and kind = 'discount'), 'the points row carries what they took off the receipt');
select t.ok((public.loyalty_quote(:'reg', :'pnum', '[{"quantity":1,"unit_price":10,"manual_pct":0}]'::jsonb, 50) ->> 'redeem_points')::numeric = 0, 'below the minimum nothing is spent');

-- a refund takes back the points
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses', 'is_refund', true, 'refund_of_id', (:'s2'::jsonb ->> 'id'),
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'tea', 'quantity', -1, 'unit_price', 120)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', -120)))) as s4 \gset
select t.ok((select points_balance from public.loyalty_cards where id = :'pid') = 975 - 120, 'refunding half takes back half the points');

-- staff card with a monthly limit of 50
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses', 'loyalty', jsonb_build_object('card_id', :'sid'),
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'tea', 'quantity', 2, 'unit_price', 120, 'discount_pct', 20, 'manual_pct', 0)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 192)))) as s5 \gset
select public.loyalty_quote(:'reg', :'snum', jsonb_build_array(jsonb_build_object('variant_id', :'tea', 'quantity', 2, 'unit_price', 120, 'manual_pct', 0))) as q3 \gset
select t.ok((:'q3'::jsonb ->> 'month_left')::numeric = 2 and (:'q3'::jsonb -> 'lines' -> 0 ->> 'pct')::numeric < 1, 'the staff card stops at its monthly limit');
select t.throws(format($q$select public.pos_submit_order('{"client_uuid":"%s","session_id":"%s","loyalty":{"card_id":"%s"},"lines":[{"variant_id":"%s","quantity":2,"unit_price":120,"discount_pct":20,"manual_pct":0}],"payments":[{"method":"cash","amount":192}]}')$q$,
  gen_random_uuid(), :'ses', :'sid', :'tea'), 'the card gives', 'over the limit is refused online');
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses', 'offline', true, 'loyalty', jsonb_build_object('card_id', :'sid'),
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'tea', 'quantity', 1, 'unit_price', 120, 'discount_pct', 20, 'manual_pct', 0)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 96)))) as s6 \gset
select t.ok((:'s6'::jsonb ->> 'total')::numeric = 96, 'a sale made offline keeps the card discount it was sold with');

-- blocked card
select t.login('alice@alba.al');
select public.loyalty_update_card(:'gid', '{"status":"blocked"}');
select t.login('cora@wms.al');
select t.ok((public.loyalty_quote(:'reg', :'gnum', '[{"quantity":1,"unit_price":10,"manual_pct":0}]'::jsonb) ->> 'usable')::boolean = false, 'a blocked card gives nothing');
select t.throws(format($q$select public.pos_submit_order('{"client_uuid":"%s","session_id":"%s","loyalty":{"card_id":"%s"},"lines":[{"variant_id":"%s","quantity":1,"unit_price":120,"discount_pct":5,"manual_pct":0}],"payments":[{"method":"cash","amount":114}]}')$q$,
  gen_random_uuid(), :'ses', :'gid', :'tea'), 'blocked', 'and is refused at the till');

-- offline copy and the report
select t.ok(jsonb_array_length(public.pos_loyalty_data(:'reg') -> 'cards') = 2, 'the till keeps the active cards for offline use');
select t.login('alice@alba.al');
select public.loyalty_overview(:'co', current_date - 1, current_date) as ov \gset
select t.ok((:'ov'::jsonb ->> 'discount')::numeric > 12 and (:'ov'::jsonb ->> 'cards_active')::int = 2, 'the report adds up discounts and cards');
reset role;
select t.ok(not exists (select 1 from public.loyalty_ledger l join public.loyalty_cards c on c.id = l.card_id
                         group by c.id, c.points_balance having sum(l.points) <> c.points_balance), 'card balances equal their history');

-- points in the books: earned points are set aside, spent points released
select t.ok((select sum(jl.credit) - sum(jl.debit) from public.journal_lines jl join public.journal_entries je on je.id = jl.entry_id
              join public.loyalty_ledger l on l.id = je.source_doc_id
             where je.source_doc_type = 'loyalty' and l.pos_order_id = (:'s3'::jsonb ->> 'id')::uuid
               and jl.account_id = (select account_id from public.company_account_defaults d where d.company_id = je.company_id and d.key = 'loyalty_liability')) = -2.65,
  'on one receipt: 235 points set aside (2.35), 500 spent released (5.00)');
select t.ok(not exists (select 1 from public.loyalty_ledger l join public.loyalty_cards c on c.id = l.card_id join public.loyalty_programs p on p.id = c.program_id
                         where p.kind = 'points' and coalesce(p.point_value, 0) > 0 and l.points <> 0
                           and not exists (select 1 from public.journal_entries je where je.source_doc_type = 'loyalty' and je.source_doc_id = l.id)),
  'every points movement of a point card is in the books');

\set QUIET off
select count(*) as assertions_passed from t.results;
