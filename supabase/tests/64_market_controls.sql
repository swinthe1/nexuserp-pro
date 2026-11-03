-- =============================================================================
-- DrisPRO · market controls: voids with the manager's PIN, the count by note and coin, short dates
-- (no age check at the till) (runs after 01–63)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
insert into auth.users (email, raw_user_meta_data) values ('besa@kt.al', '{"full_name":"Besa Përgjegjëse"}'), ('cora@kt.al', '{"full_name":"Cora Arkëtare"}'),
  ('wanda@kt.al', '{"full_name":"Wanda Sektoriste"}'), ('ivo@kt.al', '{"full_name":"Ivo Magazinier"}') on conflict do nothing;

select email as boss from public.profiles where is_super_admin limit 1 \gset
set role authenticated;
select t.login(:'boss');
select public.create_company('Kontrolle Test', 'XK') as co \gset
select public.invite_member(:'co', 'besa@kt.al', array['store_manager']);
select public.invite_member(:'co', 'cora@kt.al', array['pos_cashier']);
select public.invite_member(:'co', 'wanda@kt.al', array['warehouse_operator']);
select public.invite_member(:'co', 'ivo@kt.al', array['inventory_manager']);
select t.accept_invites();
select t.login(:'boss');
select id as shop from public.warehouses where company_id = :'co' order by created_at limit 1 \gset
select id as floor from public.warehouse_locations where company_id = :'co' and warehouse_id = :'shop' order by created_at limit 1 \gset
select id as pcs from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
insert into public.bank_accounts (company_id, name, account_kind, currency_code, account_id)
select :'co', 'Till 10 drawer', 'cash', 'EUR', id from public.accounts where company_id = :'co' and code = '5311' returning id as drawer \gset
insert into public.pos_registers (company_id, code, name, warehouse_id, location_id, cash_account_id, journal_id)
select :'co', 'T10', 'Till 10', :'shop', :'floor', :'drawer', id from public.journals where company_id = :'co' and code = 'POS' returning id as reg \gset
select m.id as besa_m from public.company_members m join public.profiles p on p.id = m.user_id where m.company_id = :'co' and p.email = 'besa@kt.al' \gset
select m.id as cora_m from public.company_members m join public.profiles p on p.id = m.user_id where m.company_id = :'co' and p.email = 'cora@kt.al' \gset

-- products: beer and cigarettes sell like anything else, no age is asked
insert into public.product_categories (company_id, name) values (:'co', 'Pije alkoolike') returning id as c_alc \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'KT-BEER', 'name', 'Birra Peja', 'uom_id', :'pcs', 'sales_price', 1, 'category_id', :'c_alc')) as p \gset
select id as beer from public.product_variants where product_id = :'p' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'KT-CIG', 'name', 'Cigare', 'uom_id', :'pcs', 'sales_price', 3)) as p_cig \gset
select id as cig from public.product_variants where product_id = :'p_cig' \gset
select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'KT-MILK', 'name', 'Qumësht 1L', 'uom_id', :'pcs', 'sales_price', 1.2,
  'tracking', 'lot', 'track_expiry', true)) as p \gset
select id as milk from public.product_variants where product_id = :'p' \gset

select public.pos_till_options(:'reg') as opt \gset
select t.ok(not (:'opt'::jsonb ? 'adults_only') and not (:'opt'::jsonb ? 'age_check') and not (:'opt'::jsonb ? 'min_age'), 'the till is told nothing about ages');
select t.ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and column_name in ('adults_only', 'pos_age_check', 'pos_min_age')),
  'no adults-only mark and no age setting is kept anywhere');
select t.ok((:'opt'::jsonb ->> 'void_approval')::boolean and :'opt'::jsonb ->> 'close_witness' = 'difference', 'the defaults: voids need the manager, the count is confirmed when it is off');
select t.ok(not (:'opt'::jsonb -> 'managers' @> jsonb_build_array(jsonb_build_object('member_id', :'besa_m'))), 'a manager without a PIN cannot confirm at the till');
select public.member_set_pin(:'besa_m', '5917');
select t.ok(public.pos_till_options(:'reg') -> 'managers' @> jsonb_build_array(jsonb_build_object('member_id', :'besa_m')), 'with a PIN the manager is offered');

-- the cashier: voids confirmed by the manager
select t.login('cora@kt.al');
select public.open_pos_session(:'reg', 50) as ses \gset
select t.ok((public.pos_approve(:'reg', :'besa_m', '0000', 'void') ->> 'error') = 'Wrong PIN', 'a wrong PIN is refused');
select t.throws(format($q$select public.pos_approve('%s', '%s', '5917', 'void')$q$, :'reg', :'cora_m'), 'someone else', 'the cashier cannot confirm her own void');
select public.pos_approve(:'reg', :'besa_m', '5917', 'void') ->> 'approval' as ap \gset
select t.ok(public.pos_log(:'ses', jsonb_build_array(
  jsonb_build_object('id', gen_random_uuid(), 'kind', 'void_line', 'variant_id', :'beer', 'description', 'Birra Peja', 'quantity', 2, 'amount', 2, 'at', now(), 'approval', :'ap'),
  jsonb_build_object('id', '00000000-0000-4000-8000-000000000064', 'kind', 'void_sale', 'description', 'Sale cleared', 'amount', 7.5, 'at', now(), 'offline', true),
  jsonb_build_object('id', gen_random_uuid(), 'kind', 'age_ok', 'variant_id', :'cig', 'at', now()))) = 2, 'the till sends its log (an age step from an older till is skipped)');
select t.ok(public.pos_log(:'ses', jsonb_build_array(jsonb_build_object('id', '00000000-0000-4000-8000-000000000064', 'kind', 'void_sale', 'amount', 7.5, 'at', now()))) = 0,
  'a step sent twice is kept once');
select t.ok((select approved_by = (select user_id from public.company_members where id = :'besa_m') from public.pos_till_log where session_id = :'ses' and kind = 'void_line'),
  'the void remembers who confirmed it');
select t.ok((select approved_by is null and offline from public.pos_till_log where session_id = :'ses' and kind = 'void_sale'), 'an unconfirmed step is kept as unconfirmed');
select public.pos_log(:'ses', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'kind', 'void_qty', 'amount', 1, 'at', now() - interval '1 day', 'approval', :'ap')));
select t.ok((select approved_by is null from public.pos_till_log where session_id = :'ses' and kind = 'void_qty'), 'a confirmation does not cover a step from another day');
select t.throws($q$insert into public.pos_till_log (id, company_id, session_id, register_id, kind, at, cashier_id) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'void_line', now(), gen_random_uuid())$q$,
  'row-level security', 'the log is written only by the till function');

-- closing: off by more than the tolerance needs the manager
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'beer', 'quantity', 10, 'unit_price', 1, 'discount_pct', 0, 'manual_pct', 0)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 10))));
select t.throws(format($q$select public.pos_close('%s', '{"counted": 50}')$q$, :'ses'), 'manager confirms', 'a drawer 10 short is not closed on the cashier''s word');
select t.ok((select status from public.pos_sessions where id = :'ses') = 'open', 'and the till stays open');
select t.throws(format($q$select public.close_pos_session('%s', 50)$q$, :'ses'), 'manager confirms', 'not by the older way either');
select public.pos_approve(:'reg', :'besa_m', '5917', 'close') ->> 'approval' as cap \gset
select t.throws(format($q$select public.pos_close('%s', '{"counted": 50, "approval": "%s"}')$q$, :'ses', :'ap'), 'expired', 'a void''s confirmation does not close a till');
select public.pos_close(:'ses', jsonb_build_object('counted', 50, 'notes', 'Mungojnë 10', 'approval', :'cap',
  'notes_coins', jsonb_build_object('20', 2, '10', 1, '5', 0, 'x', 3))) as z \gset
select t.ok((select status from public.pos_sessions where id = :'ses') = 'closed', 'with the manager''s PIN it closes');
select public.pos_session_controls(:'ses') as ctl \gset
select t.ok(:'ctl'::jsonb -> 'count' -> 'notes_coins' = '{"10": 1, "20": 2}'::jsonb, 'the count by note and coin is kept (nothing else)');
select t.ok(:'ctl'::jsonb -> 'count' ->> 'witnessed_by' = 'Besa Përgjegjëse' and (:'ctl'::jsonb -> 'count' ->> 'difference')::numeric = -10, 'with who confirmed it and the difference');
select t.ok((:'ctl'::jsonb -> 'voids' ->> 'count')::int = 3 and (:'ctl'::jsonb -> 'voids' ->> 'unconfirmed')::int = 2 and (:'ctl'::jsonb -> 'voids' ->> 'amount')::numeric = 10.5,
  'the shift shows its voids');
select t.ok(not (:'ctl'::jsonb ? 'age') and not exists (select 1 from public.pos_till_log where kind like 'age%'), 'and nothing about ages');
select t.throws(format($q$select public.pos_close('%s', '{"counted": 50, "approval": "%s"}')$q$, :'ses', :'cap'), 'already', 'a confirmation is good once');

-- a balanced drawer needs nobody; 'always' does
select public.open_pos_session(:'reg', 0) as ses2 \gset
select t.ok(public.pos_close(:'ses2', '{"counted": 0}') is not null, 'a drawer that balances closes on the cashier''s word');
select t.login(:'boss');
select public.automation_settings_save(:'co', '{"pos_close_witness": "always"}');
select t.login('cora@kt.al');
select public.open_pos_session(:'reg', 0) as ses3 \gset
select t.throws(format($q$select public.pos_close('%s', '{"counted": 0}')$q$, :'ses3'), 'manager confirms', 'set to always, every count is confirmed');
select t.login('besa@kt.al');
select t.ok(public.pos_close(:'ses3', '{"counted": 0}') is not null, 'a manager closing a till needs nobody else');
select t.login(:'boss');
select public.automation_settings_save(:'co', '{"pos_close_witness": "difference"}');

-- short dates
select t.login(:'boss');
select public.ensure_lot(:'milk', 'M-KT', current_date + 2) as mlot \gset
insert into public.stock_adjustments (company_id, warehouse_id, adjustment_date, reason) values (:'co', :'shop', current_date, 'opening') returning id as op \gset
insert into public.stock_adjustment_lines (company_id, adjustment_id, variant_id, location_id, lot_id, quantity_change, unit_cost) values (:'co', :'op', :'milk', :'floor', :'mlot', 12, 0.8);
select public.post_stock_adjustment(:'op');

select t.login('wanda@kt.al');
select public.expiry_overview(:'co', :'shop', 7) as ov \gset
select t.ok(exists (select 1 from jsonb_array_elements(:'ov'::jsonb -> 'lots') x where (x ->> 'lot_id')::uuid = :'mlot' and (x ->> 'on_hand')::numeric = 12 and (x ->> 'days_left')::int = 2),
  'the milk expiring in two days is on the list');
select t.ok((:'ov'::jsonb -> 'can' ->> 'propose')::boolean and not (:'ov'::jsonb -> 'can' ->> 'decide')::boolean, 'the shelf worker proposes, she does not decide');
select public.expiry_propose(jsonb_build_object('company_id', :'co', 'warehouse_id', :'shop', 'lot_id', :'mlot', 'quantity', 12, 'discount_pct', 30, 'note', 'Rafti 3')) as md \gset
select t.throws(format($q$select public.expiry_propose('{"company_id":"%s","warehouse_id":"%s","lot_id":"%s","quantity":1,"discount_pct":10}')$q$, :'co', :'shop', :'mlot'),
  'already has a discount', 'one proposal per item and date');
select t.throws(format($q$select public.expiry_decide('%s', true)$q$, :'md'), 'permission', 'and cannot approve it herself');
select t.login('cora@kt.al');
select t.throws(format($q$select public.expiry_propose('{"company_id":"%s","warehouse_id":"%s","variant_id":"%s","expiry_date":"%s","quantity":1,"discount_pct":10}')$q$, :'co', :'shop', :'beer', current_date + 3),
  'permission', 'a cashier does not propose discounts');

select t.login('besa@kt.al');
select t.ok(exists (select 1 from public.notifications where user_id = auth.uid() and title = 'Discount for a short date: Qumësht 1L'), 'the store manager is told');
select public.expiry_decide(:'md', true, 40);
select t.ok((select status = 'approved' and discount_pct = 40 and promotion_id is not null from public.expiry_markdowns where id = :'md'), 'approved, with the manager''s %');
select t.ok(exists (select 1 from jsonb_array_elements(public.pos_promotions(:'reg')) x
                     where (x -> 'variant_ids') ? :'milk' and (x ->> 'value')::numeric = 40 and (x ->> 'ends_on')::date = current_date + 2), 'the till sells it 40% off until the date');
select t.throws(format($q$select public.expiry_decide('%s', false)$q$, :'md'), 'already', 'a proposal is decided once');

-- a manager can propose and approve at once, also for an item without lots
select public.expiry_propose(jsonb_build_object('company_id', :'co', 'warehouse_id', :'shop', 'variant_id', :'beer', 'expiry_date', current_date + 5, 'quantity', 6,
  'discount_pct', 20, 'approve', true)) as md2 \gset
select t.ok((select status from public.expiry_markdowns where id = :'md2') = 'approved', 'the manager proposes and approves in one step');
select t.throws(format($q$select public.expiry_decide('%s', true, 95)$q$, :'md2'), 'already', 'decided already');

-- what expired comes off the shelf as a loss (the shelf worker's write-off waits for the stock manager)
select t.login('wanda@kt.al');
select public.expiry_write_off(jsonb_build_object('markdown_id', :'md', 'quantity', 5)) as wo \gset
select t.ok(:'wo'::jsonb ->> 'status' = 'draft', 'the shelf worker''s write-off waits');
select t.ok((select status = 'written_off' and adjustment_id is not null from public.expiry_markdowns where id = :'md'), 'the proposal is closed');
select t.ok((select not k.is_active from public.promotions k join public.expiry_markdowns em on em.promotion_id = k.id where em.id = :'md'), 'and its discount ends');
select t.ok((select reason = 'expiry' from public.stock_adjustments where id = (:'wo'::jsonb ->> 'adjustment_id')::uuid), 'as an adjustment for expiry');
select t.throws(format($q$select public.expiry_write_off('{"markdown_id":"%s"}')$q$, :'md'), 'already off', 'once');
select t.login('ivo@kt.al');
select public.expiry_write_off(jsonb_build_object('company_id', :'co', 'warehouse_id', :'shop', 'lot_id', :'mlot', 'quantity', 2)) as wo2 \gset
select t.ok((:'wo2'::jsonb ->> 'status') in ('posted', 'pending_approval'), 'the stock manager''s write-off is posted (or goes for approval)');
select t.throws(format($q$select public.expiry_write_off('{"company_id":"%s","warehouse_id":"%s","lot_id":"%s","quantity":500}')$q$, :'co', :'shop', :'mlot'),
  'Only', 'not more than there is');

reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
