-- =============================================================================
-- The history of the tills: every report answers, a manager sees everyone and a cashier her own,
-- the differences go to who counted the shift, the X-report reads the shift without closing it.
-- (on "Kontrolle Test" of 64 and the shifts of 108–110)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select id as t22 from public.pos_registers where company_id = :'co' and code = 'T22' \gset
select id as cora from public.profiles where email = 'cora@kt.al' \gset
select v.id as beer from public.product_variants v join public.products p on p.id = v.product_id where p.company_id = :'co' and p.code = 'KT-BEER' \gset
select to_char(current_date - 30, 'YYYY-MM-DD') as d0, to_char(current_date + 1, 'YYYY-MM-DD') as d1 \gset
create function pg_temp.h(p_report text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select public.pos_history((select id from public.companies where name = 'Kontrolle Test'),
    jsonb_build_object('report', p_report, 'from', to_char(current_date - 30, 'YYYY-MM-DD'), 'to', to_char(current_date + 1, 'YYYY-MM-DD')) || p_extra) $$;

-- 1. the manager: every report answers
set role authenticated;
select t.login('besa@kt.al');
select t.ok((select bool_and(jsonb_typeof(pg_temp.h(r) -> 'rows') = 'array') from unnest(array['shifts','cashiers','tills','movements','voids','differences','hours','z_archive']) r),
  'the eight reports answer');
select t.ok(exists (select 1 from jsonb_array_elements(pg_temp.h('cashiers') -> 'rows') x where x ->> 'key' = :'cora' and (x ->> 'receipts')::int >= 2 and (x ->> 'short')::numeric <= -5),
  'per cashier: her receipts, and the 5 short she counted');
select t.ok(exists (select 1 from jsonb_array_elements(pg_temp.h('tills', jsonb_build_object('registers', jsonb_build_array(:'t22'))) -> 'rows') x where x ->> 'key' = :'t22'),
  'per till, one till asked');
select t.ok((select sum((x ->> 'receipts')::int) from jsonb_array_elements(pg_temp.h('hours') -> 'rows') x) > 0, 'the receipts by hour of the day');
select t.throws($q$select pg_temp.h('nonsense')$q$, 'Unknown report', 'an unknown report is refused');
select t.throws($q$select public.pos_history((select id from public.companies where name = 'Kontrolle Test'), '{"report":"shifts","from":"2020-01-01","to":"2026-12-31"}')$q$,
  'At most 400 days', 'at most 400 days at once');

-- 2. a cashier: only her own shifts
select t.login('erza@kt.al');
select t.ok(not exists (select 1 from jsonb_array_elements(pg_temp.h('shifts') -> 'rows') x where x ->> 'opened_by' = 'Cora Arkëtare'), 'another cashier does not see her shifts');
select t.login('cora@kt.al');
select t.ok((select bool_and(x ->> 'opened_by' = 'Cora Arkëtare' or x ->> 'closed_by' = 'Cora Arkëtare') from jsonb_array_elements(pg_temp.h('shifts', jsonb_build_object('people', '[]'::jsonb)) -> 'rows') x),
  'she sees her own, even when she asks for everyone');

-- 3. the X-report: the shift so far, without the expected cash for a cashier who counts blind
select public.open_pos_session(:'t22', 10) as x \gset
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'x',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'beer', 'quantity', 4, 'unit_price', 1, 'discount_pct', 0, 'manual_pct', 0)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 4))));
select t.ok((public.pos_x_report(:'x') ->> 'order_count')::int = 1 and public.pos_x_report(:'x') ->> 'expected_cash' is null, 'her X-report: 1 receipt, no expected cash');
select t.login('besa@kt.al');
select t.ok((public.pos_x_report(:'x') ->> 'expected_cash')::numeric = 14, 'the manager''s X-report: 14 expected');
reset role;
select t.ok((select status = 'open' from public.pos_sessions where id = :'x'), 'the shift stays open');
set session_replication_role = replica;
update public.pos_sessions set status = 'closed', closed_at = now(), review_status = 'reconciled' where id = :'x';
set session_replication_role = origin;

\set QUIET off
select count(*) as assertions_passed from t.results;
