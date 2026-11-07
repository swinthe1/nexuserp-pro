-- =============================================================================
-- The manager's reconciliation in full: one shift as the manager sees it (where the expected cash comes
-- from, every count), the blind count holding on the server too, and the shifts that counted right
-- confirmed at once.  (on "Kontrolle Test" of 64 and the tills of 108)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select id as t22 from public.pos_registers where company_id = :'co' and code = 'T22' \gset
select v.id as beer from public.product_variants v join public.products p on p.id = v.product_id where p.company_id = :'co' and p.code = 'KT-BEER' \gset
update public.company_settings set pos_review = 'manager', pos_blind_count = true, pos_cash_tolerance = 1, pos_close_witness = 'never' where company_id = :'co';
create function pg_temp.sale(p_session uuid, p_variant uuid, p_amount numeric) returns jsonb language sql as $$
  select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', p_session,
    'lines', jsonb_build_array(jsonb_build_object('variant_id', p_variant, 'quantity', p_amount, 'unit_price', 1, 'discount_pct', 0, 'manual_pct', 0)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', p_amount)))) $$;

-- 1. a shift counted right, and one 5 short
set role authenticated;
select t.login('cora@kt.al');
select public.open_pos_session(:'t22', 20) as a \gset
select pg_temp.sale(:'a', :'beer', 10);
select t.ok(public.pos_session_summary(:'a') ->> 'expected_cash' is null and (public.pos_session_summary(:'a') ->> 'orders')::int = 1,
  'counting blind, the cashier is not told what is expected, not even by the server');
select public.pos_close(:'a', '{"counted": 30, "notes_coins": {"20": 1, "10": 1}}');
select public.open_pos_session(:'t22', 20) as b \gset
select pg_temp.sale(:'b', :'beer', 10);
select public.pos_close(:'b', '{"counted": 25}');
select public.pos_review_detail(:'a') as mine \gset
select t.ok(not (:'mine'::jsonb ->> 'sees_expected')::boolean and :'mine'::jsonb ->> 'expected_cash' is null and :'mine'::jsonb -> 'cash' = 'null'::jsonb,
  'her own shift, still blind: no expected, no cash breakdown');
select t.login('erza@kt.al');
select t.throws(format($q$select public.pos_review_detail(%L)$q$, :'a'), 'ermission', 'another cashier does not look at her shift');

-- 2. the manager sees where the expected cash comes from, and every count with its notes
select t.login('besa@kt.al');
select public.pos_review_detail(:'a') as d \gset
select t.ok((:'d'::jsonb ->> 'expected_cash')::numeric = 30 and (:'d'::jsonb -> 'cash' ->> 'opening')::numeric = 20 and (:'d'::jsonb -> 'cash' ->> 'sales')::numeric = 10,
  'expected 30: 20 opening and 10 of cash sales');
select t.ok(jsonb_array_length(:'d'::jsonb -> 'counts') = 1 and :'d'::jsonb -> 'counts' -> 0 ->> 'kind' = 'close'
            and (:'d'::jsonb -> 'counts' -> 0 -> 'notes_coins' ->> '20')::int = 1, 'the cashier''s count at the close, by note');
select t.ok((:'d'::jsonb -> 'sales' ->> 'orders')::int = 1 and (:'d'::jsonb -> 'voids' ->> 'n')::int = 0, 'with the receipts and the voids of the shift');

-- 3. confirmed at once: only the shift counted right; the one 5 short waits for its own look
select public.pos_reconcile_many(array[:'a', :'b']::uuid[]) as many \gset
select t.ok((:'many'::jsonb ->> 'reconciled')::int = 1 and :'many'::jsonb -> 'left' -> 0 ->> 'id' = :'b', 'the right one confirmed, the one off left waiting');
reset role;
select t.ok((select review_status = 'reconciled' and cash_journal_entry_id is not null from public.pos_sessions where id = :'a')
            and (select review_status = 'pending' from public.pos_sessions where id = :'b'), 'the cash of the right one went to the safe');
set role authenticated;
select t.login('cora@kt.al');
select t.ok((public.pos_session_summary(:'a') ->> 'expected_cash')::numeric = 30, 'reconciled, the cashier sees how her shift came out');
select t.throws(format($q$select public.pos_reconcile_many(array[%L]::uuid[])$q$, :'b'), 'ermission', 'a cashier does not confirm shifts');
select t.login('besa@kt.al');
select public.pos_reconcile(:'b', '{"counted": 25, "note": "Mungojnë 5 euro"}');
reset role;
update public.company_settings set pos_cash_tolerance = 0 where company_id = :'co';

\set QUIET off
select count(*) as assertions_passed from t.results;
