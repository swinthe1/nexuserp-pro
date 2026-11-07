-- =============================================================================
-- DrisPRO · the till, step 3: the manager's reconciliation, in full
--   · public.pos_review_detail: one shift as the manager checks it: where the expected cash comes from
--     (opening, cash sales, change, cash in and out), the payments by method, the receipts, refunds,
--     voids and sales made offline, and every count of the drawer in order (the cashier's at the close,
--     her recounts, the manager's), each with its notes and coins
--   · the blind count holds on the server too: until the shift is reconciled, a cashier without
--     pos.approve does not get what is expected (pos_session_summary, pos_review_detail)
--   · public.pos_reconcile_many: the manager confirms at once the shifts whose count matched
-- =============================================================================

-- ----------------------------------------------------------------------------- may this person see what is expected?
-- a manager always; a cashier when the company does not count blind, or once the shift is reconciled
create or replace function app.pos_sees_expected(p_session uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_permission(s.company_id, 'pos.approve')
      or not coalesce((select cs.pos_blind_count from public.company_settings cs where cs.company_id = s.company_id), true)
      or (s.status = 'closed' and s.review_status = 'reconciled')
    from public.pos_sessions s where s.id = p_session
$$;
revoke execute on function app.pos_sees_expected(uuid) from public, anon;
grant execute on function app.pos_sees_expected(uuid) to authenticated;

-- the summary as it was (the person's own rights apply: it runs as them)
create or replace function app.pos_summary_all(p_session uuid)
returns jsonb language sql stable set search_path = '' as $$
  with o as (select * from public.pos_orders where session_id = p_session and status = 'paid'),
       pay as (select pp.method, sum(pp.amount) as amt from public.pos_payments pp join o on o.id = pp.pos_order_id group by pp.method),
       cm as (select coalesce(sum(amount) filter (where movement_type = 'cash_in'), 0) as cin,
                     coalesce(sum(amount) filter (where movement_type = 'cash_out'), 0) as cout
                from public.pos_cash_movements where session_id = p_session)
  select jsonb_build_object(
    'orders', (select count(*) from o where not is_refund), 'refunds', (select count(*) from o where is_refund),
    'gross', (select coalesce(sum(total), 0) from o where not is_refund), 'refunded', (select coalesce(-sum(total), 0) from o where is_refund),
    'net', (select coalesce(sum(subtotal), 0) from o), 'tax', (select coalesce(sum(tax_total), 0) from o),
    'payments', coalesce((select jsonb_object_agg(method, amt) from pay), '{}'::jsonb),
    'change', (select coalesce(sum(change_given), 0) from o),
    'cash_in', (select cin from cm), 'cash_out', (select cout from cm),
    'expected_cash', (select s.opening_cash from public.pos_sessions s where s.id = p_session)
                     + coalesce((select amt from pay where method = 'cash'), 0) - (select coalesce(sum(change_given), 0) from o)
                     + (select cin - cout from cm))
$$;
revoke execute on function app.pos_summary_all(uuid) from public, anon;
grant execute on function app.pos_summary_all(uuid) to authenticated;

-- the till's summary: a cashier who counts blind gets the receipts only
create or replace function public.pos_session_summary(p_session uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare v jsonb := app.pos_summary_all(p_session);
begin
  if coalesce(app.pos_sees_expected(p_session), false) then return v; end if;
  return jsonb_build_object('orders', v -> 'orders', 'refunds', v -> 'refunds', 'blind', true);
end $$;

-- the server's own checks (what the drawer holds before a payout, the demo's close) use the full summary
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then return; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;   -- already done
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;
select app._patch_function('public.pos_pay_out', 'public.pos_session_summary(s.id)', 'app.pos_summary_all(s.id)');
select app._patch_function('app.demo_till_day', 'public.pos_session_summary(v_ses)', 'app.pos_summary_all(v_ses)');
drop function app._patch_function(text, text, text);

-- ----------------------------------------------------------------------------- one shift, as the manager checks it
create or replace function public.pos_review_detail(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.pos_sessions; r public.pos_registers; v_sees boolean; v_sum jsonb; v_counts jsonb; v_cur text;
begin
  select * into s from public.pos_sessions where id = p_session;
  if s.id is null then raise exception 'Session not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'pos.read');
  -- a cashier sees her own shifts; the managers every shift
  if not app.has_permission(s.company_id, 'pos.approve') and auth.uid() is distinct from s.opened_by and auth.uid() is distinct from s.closed_by then
    raise exception 'Permission denied: pos.approve required' using errcode = '42501';
  end if;
  select * into r from public.pos_registers where id = s.register_id;
  v_sees := app.pos_sees_expected(s.id);
  v_cur := (select base_currency from public.companies where id = s.company_id);
  select jsonb_build_object(
      'orders', count(*) filter (where not o.is_refund), 'refunds', count(*) filter (where o.is_refund),
      'gross', coalesce(sum(o.total) filter (where not o.is_refund), 0), 'refunded', coalesce(-sum(o.total) filter (where o.is_refund), 0),
      'discounts', coalesce((select round(sum(l.quantity * l.unit_price - l.line_total), 2) from public.pos_order_lines l join public.pos_orders x on x.id = l.pos_order_id
                              where x.session_id = s.id and x.status = 'paid' and not x.is_refund), 0),
      'change', coalesce(sum(o.change_given), 0),
      'offline', count(*) filter (where o.offline_created),
      'average', case when count(*) filter (where not o.is_refund) > 0 then round(coalesce(sum(o.total) filter (where not o.is_refund), 0) / count(*) filter (where not o.is_refund), 2) end,
      'first_at', min(o.order_at), 'last_at', max(o.order_at))
    into v_sum from public.pos_orders o where o.session_id = s.id and o.status = 'paid';
  -- every count of the drawer, in order: the cashier's at the close, her recounts, the manager's
  select coalesce(jsonb_agg(c order by c ->> 'at'), '[]'::jsonb) into v_counts from (
    select jsonb_build_object('kind', 'close', 'at', cc.created_at, 'counted', cc.counted, 'notes_coins', cc.notes_coins,
             'by', app.person_name(coalesce(cc.counted_by, s.closed_by)), 'witness', app.person_name(cc.witnessed_by), 'note', s.notes,
             'difference', case when v_sees then cc.difference end) as c
      from public.pos_cash_counts cc where cc.session_id = s.id
    union all
    select jsonb_build_object('kind', rv.action, 'at', rv.at, 'counted', rv.counted, 'notes_coins', rv.notes_coins, 'by', app.person_name(rv.by_user),
             'note', rv.note, 'difference', case when v_sees then rv.difference end)
      from public.pos_session_reviews rv where rv.session_id = s.id) x;
  return jsonb_build_object(
    'id', s.id, 'number', s.number, 'status', s.status, 'review_status', s.review_status, 'currency', v_cur,
    'register', r.name, 'register_id', r.id, 'unit', (select w.name from public.warehouses w where w.id = r.warehouse_id),
    'opened_at', s.opened_at, 'closed_at', s.closed_at, 'reviewed_at', s.reviewed_at,
    'opened_by', app.person_name(s.opened_by), 'closed_by', app.person_name(s.closed_by), 'reviewed_by', app.person_name(s.reviewed_by),
    'sees_expected', v_sees,
    'opening_cash', s.opening_cash, 'cashier_counted', s.cashier_counted, 'counted', s.closing_cash_counted,
    'expected_cash', case when v_sees then coalesce(s.expected_cash, (app.pos_summary_all(s.id) ->> 'expected_cash')::numeric) end,
    'difference', case when v_sees and s.review_status = 'reconciled' then s.cash_difference end,
    'cashier_difference', case when v_sees and s.cashier_counted is not null then round(s.cashier_counted - s.expected_cash, 2) end,
    'tolerance', coalesce((select pos_cash_tolerance from public.company_settings where company_id = s.company_id), 0),
    -- where the expected cash comes from
    'cash', case when v_sees then jsonb_build_object(
        'opening', s.opening_cash,
        'sales', coalesce((select sum(pp.amount) from public.pos_payments pp join public.pos_orders o on o.id = pp.pos_order_id
                            where o.session_id = s.id and o.status = 'paid' and pp.method = 'cash' and not o.is_refund), 0),
        'refunds', coalesce((select -sum(pp.amount) from public.pos_payments pp join public.pos_orders o on o.id = pp.pos_order_id
                              where o.session_id = s.id and o.status = 'paid' and pp.method = 'cash' and o.is_refund), 0),
        'change', v_sum -> 'change',
        'cash_in', coalesce((select sum(amount) from public.pos_cash_movements where session_id = s.id and movement_type = 'cash_in'), 0),
        'cash_out', coalesce((select sum(amount) from public.pos_cash_movements where session_id = s.id and movement_type = 'cash_out'), 0),
        'movements', coalesce((select jsonb_agg(jsonb_build_object('type', m.movement_type, 'kind', m.kind, 'amount', m.amount, 'reason', m.reason, 'at', m.created_at) order by m.created_at)
                                 from public.pos_cash_movements m where m.session_id = s.id), '[]'::jsonb)) end,
    'payments', case when v_sees then coalesce((select jsonb_object_agg(x.method, x.amt) from (
                    select pp.method, sum(pp.amount) as amt from public.pos_payments pp join public.pos_orders o on o.id = pp.pos_order_id
                     where o.session_id = s.id and o.status = 'paid' group by pp.method) x), '{}'::jsonb) end,
    'sales', case when v_sees then v_sum else jsonb_build_object('orders', v_sum -> 'orders', 'refunds', v_sum -> 'refunds') end,
    'voids', (select jsonb_build_object('n', count(*), 'amount', coalesce(sum(l.amount), 0), 'unconfirmed', count(*) filter (where l.approved_by is null))
                from public.pos_till_log l where l.session_id = s.id and l.kind in ('void_line', 'void_qty', 'void_sale')),
    'moved_in', (select count(*) from public.pos_orders o where o.session_id = s.id and o.moved_from_session_id is not null),
    'z', (select jsonb_build_object('id', z.id, 'number', z.number) from public.z_reports z where z.session_id = s.id order by z.created_at desc limit 1),
    'counts', v_counts);
end $$;
revoke execute on function public.pos_review_detail(uuid) from public, anon;
grant execute on function public.pos_review_detail(uuid) to authenticated;

-- ----------------------------------------------------------------------------- confirm at once the shifts that matched
-- each one as pos_reconcile does it, the cashier's count kept; a shift that cannot be confirmed is left waiting, with why
create or replace function public.pos_reconcile_many(p_sessions uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_ok int := 0; v_left jsonb := '[]'::jsonb; s public.pos_sessions; v_tol numeric;
begin
  if cardinality(coalesce(p_sessions, '{}')) > 200 then raise exception 'At most 200 shifts at once' using errcode = '22023'; end if;
  foreach v_id in array coalesce(p_sessions, '{}') loop
    select * into s from public.pos_sessions where id = v_id;
    if s.id is null then continue; end if;
    perform app.require_permission(s.company_id, 'pos.approve');
    v_tol := coalesce((select pos_cash_tolerance from public.company_settings where company_id = s.company_id), 0);
    -- only a count within the company's tolerance is confirmed without looking at it
    if s.cashier_counted is null or abs(s.cashier_counted - s.expected_cash) > v_tol then
      v_left := v_left || jsonb_build_object('id', s.id, 'number', s.number, 'reason', 'The drawer is off: reconcile it on its own');
      continue;
    end if;
    begin
      perform public.pos_reconcile(s.id, '{}'::jsonb);
      v_ok := v_ok + 1;
    exception when others then
      v_left := v_left || jsonb_build_object('id', s.id, 'number', s.number, 'reason', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('reconciled', v_ok, 'left', v_left);
end $$;
revoke execute on function public.pos_reconcile_many(uuid[]) from public, anon;
grant execute on function public.pos_reconcile_many(uuid[]) to authenticated;

notify pgrst, 'reload schema';
