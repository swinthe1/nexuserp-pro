-- =============================================================================
-- The till in three steps: the cashier opens her shift, closes it with her count, the manager reconciles it (returns it
-- for a recount, or confirms with her own count); the sales are booked at the close, the cash when the manager confirms.
-- Each cashier sells in her own shift, every receipt keeps its cashier.  (on "Kontrolle Test" of 64)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select email as boss from public.profiles where is_super_admin limit 1 \gset
select id as co from public.companies where name = 'Kontrolle Test' \gset
select id as shop from public.warehouses where company_id = :'co' order by created_at limit 1 \gset
select id as floor from public.warehouse_locations where company_id = :'co' and warehouse_id = :'shop' order by created_at limit 1 \gset
select id as cora from public.profiles where email = 'cora@kt.al' \gset
select id as besa from public.profiles where email = 'besa@kt.al' \gset
insert into auth.users (email, raw_user_meta_data) values ('erza@kt.al', '{"full_name":"Erza Arkëtare"}') on conflict do nothing;
select v.id as beer from public.product_variants v join public.products p on p.id = v.product_id where p.company_id = :'co' and p.code = 'KT-BEER' \gset
-- two tills of their own; whatever earlier tests left open stays closed for cora
set session_replication_role = replica;
update public.pos_sessions set status = 'closed', closed_at = now() where company_id = :'co' and status <> 'closed';
set session_replication_role = origin;
update public.company_settings set pos_close_witness = 'never', pos_review = 'manager' where company_id = :'co';
insert into public.pos_registers (company_id, code, name, warehouse_id, location_id, cash_account_id, journal_id)
select :'co', 'T21', 'Till 21', :'shop', :'floor', cash_account_id, journal_id from public.pos_registers where company_id = :'co' and code = 'T10' returning id as t21 \gset
insert into public.pos_registers (company_id, code, name, warehouse_id, location_id, cash_account_id, journal_id)
select :'co', 'T22', 'Till 22', :'shop', :'floor', cash_account_id, journal_id from public.pos_registers where company_id = :'co' and code = 'T10' returning id as t22 \gset
create function pg_temp.sale(p_session uuid, p_variant uuid, p_amount numeric, p_cashier uuid default null) returns jsonb language sql as $$
  select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', p_session, 'cashier_id', p_cashier,
    'lines', jsonb_build_array(jsonb_build_object('variant_id', p_variant, 'quantity', p_amount, 'unit_price', 1, 'discount_pct', 0, 'manual_pct', 0)),
    'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', p_amount)))) $$;

-- 1. she opens her shift and sells
set role authenticated;
select t.login(:'boss');
select public.invite_member(:'co', 'erza@kt.al', array['pos_cashier']);
select t.accept_invites();
select t.login('cora@kt.al');
select public.pos_before_open(:'t21') as before \gset
select public.open_pos_session(:'t21', 20) as ses \gset
select t.throws(format($q$select public.open_pos_session(%L, 0)$q$, :'t22'), 'already have an open shift', 'one market shift at a time for a cashier');
select pg_temp.sale(:'ses', :'beer', 10);
select t.login('erza@kt.al');
select t.throws(format($q$select pg_temp.sale(%L, %L, 5)$q$, :'ses', :'beer'), 'NOT_YOUR_SHIFT', 'another cashier does not sell in her shift');
-- a receipt she made offline and the manager's device sent later still counts as hers
select pg_temp.sale(:'ses', :'beer', 5, :'cora');
reset role;
select t.ok((select bool_and(cashier_id = :'cora') and count(*) = 2 from public.pos_orders where session_id = :'ses'), 'every receipt keeps its cashier');
select t.ok((:'before'::jsonb ->> 'blind')::boolean, 'the count is blind unless the company says otherwise');

-- 2. she closes it: the sales are booked, the cash waits for the manager
set role authenticated;
select t.login('cora@kt.al');
select public.pos_close(:'ses', '{"counted": 33}');
reset role;
select t.ok((select review_status = 'pending' and closed_by = :'cora' and cashier_counted = 33 and expected_cash = 35
                    and journal_entry_id is not null and cash_journal_entry_id is null from public.pos_sessions where id = :'ses'),
            'closed by her with 33 of 35: sales booked, the cash waits for the manager');
set role authenticated;
select t.login('besa@kt.al');
select public.pos_review_list(:'co') as waiting \gset
select t.ok(exists (select 1 from jsonb_array_elements(:'waiting'::jsonb) x where x ->> 'id' = :'ses' and (x ->> 'cashier_difference')::numeric = -2),
            'the manager sees it waiting, 2 short by the cashier''s count');

-- 3. the manager returns it, the cashier counts again, the manager confirms with her own count
select public.pos_review_return(:'ses', 'Numëroje edhe një herë kutinë e monedhave');
select t.throws(format($q$select public.pos_reconcile(%L)$q$, :'ses'), 'back with the cashier', 'returned: the cashier counts first');
select t.login('cora@kt.al');
select t.throws(format($q$select public.pos_reconcile(%L)$q$, :'ses'), 'Permission', 'the cashier does not confirm her own shift');
select public.pos_recount(:'ses', '{"counted": 34, "note": "Gjeta 1 euro"}');
select t.login('besa@kt.al');
select t.throws(format($q$select public.pos_reconcile(%L, '{"counted": 35}')$q$, :'ses'), 'Say why', 'a count other than the cashier''s needs a reason');
select public.pos_reconcile(:'ses', '{"counted": 35, "note": "1 euro ishte në sirtar"}') as rec \gset
reset role;
select t.ok((select review_status = 'reconciled' and reviewed_by = :'besa' and closing_cash_counted = 35 and cash_difference = 0
                    and cashier_counted = 34 and cash_journal_entry_id is not null from public.pos_sessions where id = :'ses'),
            'reconciled by the manager: 35 counted, nothing missing, the cash booked to the safe');
select t.ok((select string_agg(action, ',' order by at) = 'returned,recounted,reconciled' from public.pos_session_reviews where session_id = :'ses'),
            'every step is kept');
set role authenticated;
select t.login('besa@kt.al');
select t.ok(not exists (select 1 from jsonb_array_elements(public.pos_review_list(:'co')) x where x ->> 'id' = :'ses'), 'reconciled: no longer waiting');
reset role;

-- a company that does not reconcile: the close is final, as before
update public.company_settings set pos_review = 'off' where company_id = :'co';
set role authenticated;
select t.login('cora@kt.al');
select public.open_pos_session(:'t22', 0) as ses2 \gset
select public.pos_close(:'ses2', '{"counted": 0}');
reset role;
select t.ok((select review_status = 'reconciled' and closed_by = :'cora' from public.pos_sessions where id = :'ses2'), 'without reconciling the close is final');
update public.company_settings set pos_review = 'manager' where company_id = :'co';

\set QUIET off
select count(*) as assertions_passed from t.results;
