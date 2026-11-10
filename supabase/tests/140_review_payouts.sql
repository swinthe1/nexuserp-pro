-- =============================================================================
-- Reconciling the tills: each shift shows what was paid out of the drawer to suppliers and for expenses.
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select s.company_id as co, s.id as sess from public.pos_sessions s where s.status = 'closed' and s.deleted_at is null order by s.closed_at desc limit 1 \gset
insert into public.pos_cash_movements (company_id, session_id, movement_type, amount, reason, kind) values
  (:'co', :'sess', 'cash_out', 40, 'Furnitori i bukës', 'supplier'),
  (:'co', :'sess', 'cash_out', 15.5, 'Detergjent', 'expense'),
  (:'co', :'sess', 'cash_out', 4.5, 'Kafe për stafin', 'expense'),
  (:'co', :'sess', 'cash_in', 100, 'Kusur', 'cash');
set role authenticated;
select t.login('zoe@platform.io');
select x as row from jsonb_array_elements(public.pos_review_list(:'co', '{"status":"all"}')) x where (x ->> 'id')::uuid = :'sess' \gset
select t.ok((:'row'::jsonb ->> 'supplier_paid')::numeric = 40 and (:'row'::jsonb ->> 'expenses')::numeric = 20, 'the shift shows 40 paid to suppliers and 20 in expenses');
reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
