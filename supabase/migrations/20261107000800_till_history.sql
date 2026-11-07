-- =============================================================================
-- DrisPRO · the till, step 4: history and reports, per till and per cashier
--   public.pos_history(company, {report, from, to, registers, units, people}) — one call, eight reports:
--     shifts       every shift: who opened, closed, reconciled; hours; receipts, sales, refunds, discounts,
--                  voids; cash, card and the rest; cash in and out; expected, counted, difference
--     cashiers     per cashier: shifts, hours, receipts (by the cashier on each receipt), sales, average
--                  receipt, receipts an hour, refunds, voids (and without a manager), differences
--     tills        the same per till
--     movements    every cash in and out of the drawers: payments to suppliers, expenses, vouchers
--     voids        every item taken off a sale, with who and who confirmed
--     differences  per month and cashier: shifts off, short, over, the largest short
--     hours        per hour of the day: receipts, sales, average receipt, receipts a day
--     z_archive    the Z-reports of the period
--   A manager (pos.approve) sees everyone; a cashier sees her own, and while she counts blind no
--   expected cash or difference of a shift not yet reconciled.
--   public.pos_x_report: the shift so far, without closing it (the X-report)
--   The safe's report of differences counts a shift's difference for the one who counted it (closed it).
-- =============================================================================

-- ----------------------------------------------------------------------------- the shifts asked for
create or replace function app.pos_hist_sessions(p_company uuid, p jsonb, p_people boolean default true)
returns setof uuid language plpgsql stable security definer set search_path = '' as $$
declare v_tz text := coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane');
  v_regs uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'registers', '[]'::jsonb))::uuid);
  v_units uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'units', '[]'::jsonb))::uuid);
  v_people uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'people', '[]'::jsonb))::uuid);
begin
  return query
    select s.id from public.pos_sessions s join public.pos_registers r on r.id = s.register_id
     where s.company_id = p_company and s.deleted_at is null
       and (s.opened_at at time zone v_tz)::date between (p ->> 'from')::date and (p ->> 'to')::date
       and (cardinality(v_regs) = 0 or r.id = any(v_regs))
       and (cardinality(v_units) = 0 or r.warehouse_id = any(v_units))
       and (not p_people or cardinality(v_people) = 0 or s.opened_by = any(v_people) or s.closed_by = any(v_people));
end $$;
revoke execute on function app.pos_hist_sessions(uuid, jsonb, boolean) from public, anon, authenticated;

-- ----------------------------------------------------------------------------- one row per shift, with its numbers
create or replace function app.pos_hist_shift_rows(p_company uuid, p jsonb)
returns table (id uuid, number text, register_id uuid, register text, unit text, opened_at timestamptz, closed_at timestamptz, hours numeric,
               opened_by uuid, closed_by uuid, reviewed_by uuid, status text, review_status text,
               receipts bigint, refunds_n bigint, sales numeric, refunds numeric, net_sales numeric, discounts numeric, change numeric,
               cash numeric, card numeric, other_pay numeric, cash_in numeric, cash_out numeric, voids_n bigint, voids numeric, voids_unconfirmed bigint,
               opening numeric, expected numeric, counted numeric, difference numeric, offline bigint)
language sql stable security definer set search_path = '' as $$
  select s.id, s.number, r.id, r.name, w.name, s.opened_at, s.closed_at,
         round(extract(epoch from coalesce(s.closed_at, now()) - s.opened_at) / 3600.0, 2),
         s.opened_by, s.closed_by, s.reviewed_by, s.status, s.review_status,
         coalesce(o.receipts, 0), coalesce(o.refunds_n, 0), coalesce(o.sales, 0), coalesce(o.refunds, 0), coalesce(o.sales, 0) - coalesce(o.refunds, 0),
         coalesce(o.discounts, 0), coalesce(o.change, 0),
         coalesce(pay.cash, 0), coalesce(pay.card, 0), coalesce(pay.other, 0),
         coalesce(cm.cin, 0), coalesce(cm.cout, 0), coalesce(v.n, 0), coalesce(v.amount, 0), coalesce(v.unconfirmed, 0),
         s.opening_cash,
         coalesce(s.expected_cash, s.opening_cash + coalesce(pay.cash, 0) - coalesce(o.change, 0) + coalesce(cm.cin, 0) - coalesce(cm.cout, 0)),
         s.closing_cash_counted, s.cash_difference, coalesce(o.offline, 0)
    from app.pos_hist_sessions(p_company, p) f(sid)
    join public.pos_sessions s on s.id = f.sid
    join public.pos_registers r on r.id = s.register_id
    left join public.warehouses w on w.id = r.warehouse_id
    left join lateral (select count(*) filter (where not x.is_refund) as receipts, count(*) filter (where x.is_refund) as refunds_n,
                              sum(x.total) filter (where not x.is_refund) as sales, -sum(x.total) filter (where x.is_refund) as refunds,
                              sum(x.discount_total) as discounts, sum(x.change_given) as change, count(*) filter (where x.offline_created) as offline
                         from public.pos_orders x where x.session_id = s.id and x.status = 'paid') o on true
    left join lateral (select sum(pp.amount) filter (where pp.method = 'cash') as cash, sum(pp.amount) filter (where pp.method = 'card') as card,
                              sum(pp.amount) filter (where pp.method not in ('cash', 'card')) as other
                         from public.pos_payments pp join public.pos_orders x on x.id = pp.pos_order_id where x.session_id = s.id and x.status = 'paid') pay on true
    left join lateral (select sum(m.amount) filter (where m.movement_type = 'cash_in') as cin, sum(m.amount) filter (where m.movement_type = 'cash_out') as cout
                         from public.pos_cash_movements m where m.session_id = s.id) cm on true
    left join lateral (select count(*) as n, sum(l.amount) as amount, count(*) filter (where l.approved_by is null) as unconfirmed
                         from public.pos_till_log l where l.session_id = s.id and l.kind in ('void_line', 'void_qty', 'void_sale')) v on true
$$;
revoke execute on function app.pos_hist_shift_rows(uuid, jsonb) from public, anon, authenticated;

-- ----------------------------------------------------------------------------- the reports
create or replace function public.pos_history(p_company uuid, p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_report text := coalesce(p ->> 'report', 'shifts');
  v_mgr boolean; v_blind boolean; v_tol numeric; v_tz text; v_rows jsonb; v_people uuid[]; v_q jsonb := p; v_days int;
begin
  perform app.require_permission(p_company, 'pos.read');
  if (p ->> 'from') is null or (p ->> 'to') is null then raise exception 'Choose the dates' using errcode = '22023'; end if;
  if (p ->> 'to')::date - (p ->> 'from')::date > 400 then raise exception 'At most 400 days at once' using errcode = '22023'; end if;
  v_mgr := app.has_permission(p_company, 'pos.approve');
  -- a cashier sees her own history
  if not v_mgr then v_q := jsonb_set(v_q, '{people}', jsonb_build_array(auth.uid())); end if;
  v_people := array(select jsonb_array_elements_text(coalesce(v_q -> 'people', '[]'::jsonb))::uuid);
  v_blind := not v_mgr and coalesce((select pos_blind_count from public.company_settings where company_id = p_company), true);
  v_tol := coalesce((select pos_cash_tolerance from public.company_settings where company_id = p_company), 0);
  v_tz := coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane');
  v_days := greatest((p ->> 'to')::date - (p ->> 'from')::date + 1, 1);

  if v_report = 'shifts' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'number', x.number, 'register', x.register, 'unit', x.unit, 'opened_at', x.opened_at, 'closed_at', x.closed_at, 'hours', x.hours,
        'opened_by', app.person_name(x.opened_by), 'closed_by', app.person_name(x.closed_by), 'reviewed_by', app.person_name(x.reviewed_by),
        'status', x.status, 'review_status', case when x.status = 'closed' then x.review_status end,
        'receipts', x.receipts, 'refunds_n', x.refunds_n, 'sales', x.sales, 'refunds', x.refunds, 'net_sales', x.net_sales, 'discounts', x.discounts,
        'average', case when x.receipts > 0 then round(x.sales / x.receipts, 2) end,
        'cash', x.cash - x.change, 'card', x.card, 'other_pay', x.other_pay, 'cash_in', x.cash_in, 'cash_out', x.cash_out,
        'voids_n', x.voids_n, 'voids', x.voids, 'voids_unconfirmed', x.voids_unconfirmed, 'offline', x.offline, 'opening', x.opening,
        'expected', case when not (v_blind and coalesce(x.review_status, '') <> 'reconciled') then x.expected end,
        'counted', x.counted,
        'difference', case when x.status = 'closed' and not (v_blind and x.review_status <> 'reconciled') then x.difference end,
        'off', case when x.status = 'closed' and not (v_blind and x.review_status <> 'reconciled') then abs(coalesce(x.difference, 0)) > v_tol end)
      order by x.opened_at desc), '[]'::jsonb) into v_rows
      from app.pos_hist_shift_rows(p_company, v_q) x;

  elsif v_report in ('cashiers', 'tills') then
    with sh as (select * from app.pos_hist_shift_rows(p_company, case when v_report = 'cashiers' then v_q - 'people' else v_q end)),
    -- the receipts count for the cashier on each receipt; the shift, its hours and its difference for who opened and counted it
    base as (
      select case when v_report = 'cashiers' then coalesce(o.cashier_id, sh.opened_by) else sh.register_id end as k,
             count(*) filter (where not o.is_refund) as receipts, count(*) filter (where o.is_refund) as refunds_n,
             coalesce(sum(o.total) filter (where not o.is_refund), 0) as sales, coalesce(-sum(o.total) filter (where o.is_refund), 0) as refunds,
             coalesce(sum(o.discount_total), 0) as discounts
        from sh join public.pos_orders o on o.session_id = sh.id and o.status = 'paid' group by 1),
    shifts as (
      select case when v_report = 'cashiers' then sh.opened_by else sh.register_id end as k, count(*) as shifts, sum(sh.hours) as hours,
             sum(sh.cash_in) as cash_in, sum(sh.cash_out) as cash_out
        from sh group by 1),
    diffs as (
      select case when v_report = 'cashiers' then coalesce(sh.closed_by, sh.opened_by) else sh.register_id end as k,
             count(*) filter (where abs(coalesce(sh.difference, 0)) > v_tol) as off,
             coalesce(sum(least(sh.difference, 0)), 0) as short, coalesce(sum(greatest(sh.difference, 0)), 0) as over, coalesce(sum(sh.difference), 0) as net
        from sh where sh.status = 'closed' and not (v_blind and sh.review_status <> 'reconciled') group by 1),
    voids as (
      select case when v_report = 'cashiers' then l.cashier_id else sh.register_id end as k, count(*) as n, coalesce(sum(l.amount), 0) as amount,
             count(*) filter (where l.approved_by is null) as unconfirmed
        from sh join public.pos_till_log l on l.session_id = sh.id and l.kind in ('void_line', 'void_qty', 'void_sale') group by 1),
    keys as (select k from base union select k from shifts union select k from voids)
    select coalesce(jsonb_agg(jsonb_build_object(
        'key', keys.k,
        'name', case when v_report = 'cashiers' then coalesce(app.person_name(keys.k), '—') else (select r.name from public.pos_registers r where r.id = keys.k) end,
        'unit', case when v_report = 'tills' then (select w.name from public.pos_registers r join public.warehouses w on w.id = r.warehouse_id where r.id = keys.k) end,
        'shifts', coalesce(sh2.shifts, 0), 'hours', coalesce(sh2.hours, 0),
        'receipts', coalesce(b.receipts, 0), 'sales', coalesce(b.sales, 0), 'refunds_n', coalesce(b.refunds_n, 0), 'refunds', coalesce(b.refunds, 0),
        'net_sales', coalesce(b.sales, 0) - coalesce(b.refunds, 0), 'discounts', coalesce(b.discounts, 0),
        'average', case when coalesce(b.receipts, 0) > 0 then round(b.sales / b.receipts, 2) end,
        'per_hour', case when coalesce(sh2.hours, 0) > 0 then round(coalesce(b.receipts, 0) / sh2.hours, 1) end,
        'cash_in', coalesce(sh2.cash_in, 0), 'cash_out', coalesce(sh2.cash_out, 0),
        'voids_n', coalesce(v.n, 0), 'voids', coalesce(v.amount, 0), 'voids_unconfirmed', coalesce(v.unconfirmed, 0),
        'off', d.off, 'short', d.short, 'over', d.over, 'difference', d.net)
      order by coalesce(b.sales, 0) desc), '[]'::jsonb) into v_rows
      from keys left join base b on b.k = keys.k left join shifts sh2 on sh2.k = keys.k left join diffs d on d.k = keys.k left join voids v on v.k = keys.k
     where keys.k is not null and (v_report = 'tills' or cardinality(v_people) = 0 or keys.k = any(v_people));

  elsif v_report = 'movements' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'at', m.created_at, 'register', r.name, 'shift', s.number, 'session_id', s.id, 'person', app.person_name(m.created_by),
        'type', m.movement_type, 'kind', coalesce(m.kind, 'other'), 'amount', case when m.movement_type = 'cash_out' then -m.amount else m.amount end,
        'reason', m.reason, 'document_no', m.document_no, 'partner', (select bp.name from public.business_partners bp where bp.id = m.partner_id),
        'approved_by', app.person_name(m.approved_by)) order by m.created_at desc), '[]'::jsonb) into v_rows
      from app.pos_hist_sessions(p_company, v_q - 'people') f(sid)
      join public.pos_sessions s on s.id = f.sid join public.pos_registers r on r.id = s.register_id
      join public.pos_cash_movements m on m.session_id = s.id
     where cardinality(v_people) = 0 or m.created_by = any(v_people);

  elsif v_report = 'voids' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'at', l.at, 'register', r.name, 'shift', s.number, 'session_id', s.id, 'person', app.person_name(l.cashier_id),
        'kind', l.kind, 'description', l.description, 'quantity', l.quantity, 'amount', l.amount,
        'approved_by', app.person_name(l.approved_by), 'offline', l.offline) order by l.at desc), '[]'::jsonb) into v_rows
      from app.pos_hist_sessions(p_company, v_q - 'people') f(sid)
      join public.pos_sessions s on s.id = f.sid join public.pos_registers r on r.id = s.register_id
      join public.pos_till_log l on l.session_id = s.id and l.kind in ('void_line', 'void_qty', 'void_sale')
     where cardinality(v_people) = 0 or l.cashier_id = any(v_people);

  elsif v_report = 'differences' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'month', y.month, 'key', y.k, 'name', coalesce(app.person_name(y.k), '—'), 'shifts', y.shifts, 'off', y.off,
        'short', y.short, 'over', y.over, 'difference', y.net, 'largest_short', y.largest) order by y.month desc, y.net), '[]'::jsonb) into v_rows
      from (select to_char(x.closed_at at time zone v_tz, 'YYYY-MM') as month, coalesce(x.closed_by, x.opened_by) as k, count(*) as shifts,
                   count(*) filter (where abs(coalesce(x.difference, 0)) > v_tol) as off,
                   coalesce(sum(least(x.difference, 0)), 0) as short, coalesce(sum(greatest(x.difference, 0)), 0) as over,
                   coalesce(sum(x.difference), 0) as net, nullif(least(min(x.difference), 0), 0) as largest
              from app.pos_hist_shift_rows(p_company, v_q) x
             where x.status = 'closed' and not (v_blind and x.review_status <> 'reconciled')
             group by 1, 2) y;

  elsif v_report = 'hours' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'hour', h.hr, 'label', lpad(h.hr::text, 2, '0') || ':00–' || lpad(((h.hr + 1) % 24)::text, 2, '0') || ':00',
        'receipts', h.receipts, 'sales', h.sales, 'average', case when h.receipts > 0 then round(h.sales / h.receipts, 2) end,
        'per_day', round(h.receipts::numeric / v_days, 1), 'share', case when t.total > 0 then round(100 * h.sales / t.total, 1) end) order by h.hr), '[]'::jsonb) into v_rows
      from (select extract(hour from o.order_at at time zone v_tz)::int as hr, count(*) filter (where not o.is_refund) as receipts,
                   coalesce(sum(o.total), 0) as sales
              from app.pos_hist_sessions(p_company, v_q - 'people') f(sid) join public.pos_orders o on o.session_id = f.sid and o.status = 'paid'
             where cardinality(v_people) = 0 or o.cashier_id = any(v_people)
             group by 1) h
      cross join (select coalesce(sum(o.total), 0) as total from app.pos_hist_sessions(p_company, v_q - 'people') f(sid)
                    join public.pos_orders o on o.session_id = f.sid and o.status = 'paid'
                   where cardinality(v_people) = 0 or o.cashier_id = any(v_people)) t;

  elsif v_report = 'z_archive' then
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', z.id, 'number', z.number, 'date', z.report_date, 'register', r.name, 'shift', s.number, 'session_id', s.id,
        'closed_by', app.person_name(s.closed_by), 'receipts', z.order_count, 'refunds_n', z.refund_count, 'sales', z.gross_sales, 'refunds', z.refunds_total,
        'discounts', z.discounts_total, 'net', z.net_sales, 'vat', z.tax_total,
        'difference', case when not (v_blind and s.review_status <> 'reconciled') then z.cash_difference end) order by z.report_date desc, z.number desc), '[]'::jsonb) into v_rows
      from app.pos_hist_sessions(p_company, v_q) f(sid)
      join public.pos_sessions s on s.id = f.sid join public.pos_registers r on r.id = s.register_id
      join public.z_reports z on z.session_id = s.id;
  else
    raise exception 'Unknown report' using errcode = '22023';
  end if;

  return jsonb_build_object('rows', v_rows, 'currency', (select base_currency from public.companies where id = p_company),
                            'tolerance', v_tol, 'manager', v_mgr, 'blind', v_blind);
end $$;
revoke execute on function public.pos_history(uuid, jsonb) from public, anon;
grant execute on function public.pos_history(uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------------------- the X-report: the shift so far
create or replace function public.pos_x_report(p_session uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.pos_sessions; agg record; v_pay jsonb; v_in numeric; v_out numeric; v_sees boolean;
begin
  select * into s from public.pos_sessions where id = p_session;
  if s.id is null then raise exception 'Session not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'pos.read');
  if not app.has_permission(s.company_id, 'pos.approve') and auth.uid() is distinct from s.opened_by then
    raise exception 'Permission denied: pos.approve required' using errcode = '42501';
  end if;
  v_sees := app.pos_sees_expected(s.id);
  select count(*) filter (where not is_refund) as orders, count(*) filter (where is_refund) as refunds,
         coalesce(sum(total) filter (where not is_refund), 0) as gross, coalesce(-sum(total) filter (where is_refund), 0) as refunded,
         coalesce(sum(discount_total), 0) as disc, coalesce(sum(subtotal), 0) as net, coalesce(sum(tax_total), 0) as tax, coalesce(sum(change_given), 0) as change
    into agg from public.pos_orders where session_id = s.id and status = 'paid';
  select coalesce(jsonb_object_agg(method, amt), '{}'::jsonb) into v_pay
    from (select pp.method, sum(pp.amount) as amt from public.pos_payments pp join public.pos_orders o on o.id = pp.pos_order_id
           where o.session_id = s.id and o.status = 'paid' group by pp.method) m;
  select coalesce(sum(amount) filter (where movement_type = 'cash_in'), 0), coalesce(sum(amount) filter (where movement_type = 'cash_out'), 0)
    into v_in, v_out from public.pos_cash_movements where session_id = s.id;
  return jsonb_build_object(
    'number', 'X-' || s.number, 'session', s.number, 'opened_at', s.opened_at, 'at', app.clock(),
    'order_count', agg.orders, 'refund_count', agg.refunds, 'gross_sales', agg.gross, 'refunds_total', agg.refunded,
    'discounts_total', agg.disc, 'net_sales', agg.net, 'tax_total', agg.tax,
    'payments_by_method', v_pay || jsonb_build_object('change_given', agg.change),
    'tax_breakdown', coalesce((select jsonb_agg(jsonb_build_object('rate', rate, 'base', base, 'tax', tax) order by rate desc)
                      from (select ol.tax_rate as rate, sum(ol.line_subtotal) as base, sum(ol.tax_amount) as tax
                              from public.pos_order_lines ol join public.pos_orders o on o.id = ol.pos_order_id
                             where o.session_id = s.id and o.status = 'paid' group by ol.tax_rate) t), '[]'::jsonb),
    'opening_cash', s.opening_cash, 'cash_in', v_in, 'cash_out', v_out,
    'expected_cash', case when v_sees then s.opening_cash + coalesce((v_pay ->> 'cash')::numeric, 0) - agg.change + v_in - v_out end,
    'items', coalesce((select jsonb_agg(i) from (
             select jsonb_build_object('name', min(ol.description), 'quantity', sum(ol.quantity), 'total', sum(ol.line_total)) as i
               from public.pos_order_lines ol join public.pos_orders o on o.id = ol.pos_order_id
              where o.session_id = s.id and o.status = 'paid' group by ol.variant_id having sum(ol.quantity) <> 0
              order by sum(ol.line_total) desc limit 10) top), '[]'::jsonb));
end $$;
revoke execute on function public.pos_x_report(uuid) from public, anon;
grant execute on function public.pos_x_report(uuid) to authenticated;

-- ----------------------------------------------------------------------------- the safe's differences: a shift's for who counted it
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;   -- already done
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;
select app._patch_function('public.safe_differences', 'select ps.opened_by as uid,', 'select coalesce(ps.closed_by, ps.opened_by) as uid,');
select app._patch_function('public.safe_differences', 'group by ps.opened_by', 'group by coalesce(ps.closed_by, ps.opened_by)');
drop function app._patch_function(text, text, text);

notify pgrst, 'reload schema';
