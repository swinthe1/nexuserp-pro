-- =============================================================================
-- The restaurant till: a waiter who takes the payment keeps the cash until he hands it over at the
-- till; the handover is counted, its difference stays with the waiter (booked to cash differences, the
-- drawer follows what came in); the shift does not close while a waiter still owes.
-- (on "Kontrolle Test" of 64; cora holds the drawer, erza waits the tables)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select id as shop from public.warehouses where company_id = :'co' order by created_at limit 1 \gset
select id as floor from public.warehouse_locations where company_id = :'co' and warehouse_id = :'shop' order by created_at limit 1 \gset
select id as erza from public.profiles where email = 'erza@kt.al' \gset
select v.id as beer from public.product_variants v join public.products p on p.id = v.product_id where p.company_id = :'co' and p.code = 'KT-BEER' \gset
insert into public.pos_registers (company_id, code, name, warehouse_id, location_id, cash_account_id, journal_id, mode)
select :'co', 'R30', 'Bar 30', :'shop', :'floor', cash_account_id, journal_id, 'restaurant' from public.pos_registers where company_id = :'co' and code = 'T10' returning id as bar \gset
update public.company_settings set pos_review = 'off', pos_close_witness = 'never' where company_id = :'co';
create function pg_temp.sale(p_session uuid, p_amount numeric) returns jsonb language sql as $$
  select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', p_session,
    'lines', jsonb_build_array(jsonb_build_object('variant_id', (select v.id from public.product_variants v join public.products p on p.id = v.product_id
                                                                  where p.code = 'KT-BEER' and p.company_id = (select id from public.companies where name = 'Kontrolle Test')),
                                                  'quantity', p_amount, 'unit_price', 1, 'discount_pct', 0, 'manual_pct', 0)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', p_amount)))) $$;

-- 1. cora holds the drawer; erza takes 20 at her tables, cora 5 at the bar
set role authenticated;
select t.login('cora@kt.al');
select public.open_pos_session(:'bar', 10) as ses \gset
select pg_temp.sale(:'ses', 5);
select t.login('erza@kt.al');
select pg_temp.sale(:'ses', 20);
select public.pos_waiters(:'ses') as mine \gset
select t.ok(jsonb_array_length(:'mine'::jsonb -> 'waiters') = 1 and (:'mine'::jsonb -> 'waiters' -> 0 ->> 'owed')::numeric = 20,
  'the waiter sees what he owes: 20');
select t.throws(format($q$select public.pos_waiter_handover(%L, '{"waiter": "%s", "counted": 20}')$q$, :'ses', :'erza'), 'person at the till', 'a waiter does not take in his own handover');

-- 2. the shift does not close while the waiter owes
select t.login('cora@kt.al');
select t.throws(format($q$select public.pos_close(%L, '{"counted": 35}')$q$, :'ses'), 'WAITERS_OWE', 'the shift waits for the waiter''s takings');

-- 3. she counts 18: the reason is needed; 2 short stay with the waiter, the drawer follows what came in
select t.throws(format($q$select public.pos_waiter_handover(%L, '{"waiter": "%s", "counted": 18}')$q$, :'ses', :'erza'), 'Say why', 'a handover that differs needs a reason');
select public.pos_waiter_handover(:'ses', jsonb_build_object('waiter', :'erza', 'counted', 18, 'note', 'I mungojnë 2 euro', 'notes_coins', jsonb_build_object('10', 1, '5', 1, '1', 3))) as h \gset
select t.ok((:'h'::jsonb ->> 'difference')::numeric = -2, 'the handover: 18 of 20, 2 short');
reset role;
select t.ok((select kind = 'waiter' and movement_type = 'cash_out' and amount = 2 from public.pos_cash_movements where session_id = :'ses'), 'the 2 short leave the drawer as the waiter''s');
select t.ok((app.pos_summary_all(:'ses') ->> 'expected_cash')::numeric = 33, 'expected in the drawer 10 + 25 − 2 = 33');
select t.ok(exists (select 1 from public.journal_entries je join public.journal_lines jl on jl.entry_id = je.id
                     where je.source_doc_type = 'pos_session' and je.source_doc_id = :'ses' and jl.account_id = app.acct(:'co', 'cash_difference') and jl.debit = 2),
  'the 2 short are booked to cash differences');

-- 4. handed over: the shift closes, balanced; the history keeps the handover
set role authenticated;
select t.login('cora@kt.al');
select t.ok((public.pos_waiters(:'ses') -> 'waiters' -> 0 ->> 'owed')::numeric = 0, 'nothing owed any more');
select public.pos_close(:'ses', '{"counted": 33}');
reset role;
select t.ok((select status = 'closed' and cash_difference = 0 from public.pos_sessions where id = :'ses'), 'the drawer balances: the 2 are the waiter''s, not the cashier''s');
set role authenticated;
select t.login('besa@kt.al');
select t.ok(exists (select 1 from jsonb_array_elements(public.pos_handover_history(:'co', jsonb_build_object('from', current_date - 1, 'to', current_date + 1)) -> 'rows') x
                    where x ->> 'key' = :'erza' and (x ->> 'difference')::numeric = -2), 'the manager sees the handover in the history');
reset role;
update public.company_settings set pos_review = 'manager' where company_id = :'co';

\set QUIET off
select count(*) as assertions_passed from t.results;
