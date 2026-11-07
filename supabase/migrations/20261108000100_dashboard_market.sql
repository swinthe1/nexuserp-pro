-- =============================================================================
-- DrisPRO · the numbers a market looks at every day, for the dashboard
--   dashboard_market: today at the tills and on invoices (with VAT) against the same hour a week ago,
--   receipts and the average basket, the cash in the open tills, shifts left open, till differences,
--   refunds and items taken off today, the month's sales and gross margin, goods expiring, items that
--   sell but are out of stock, stock that has not sold in 60 days, new selling prices waiting and goods
--   waiting for the supplier's invoice. Each part only for someone allowed to see it (null otherwise).
--   Straight from the documents: no estimates, no AI.
-- =============================================================================
create or replace function public.dashboard_market(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.companies; tz text; v_now timestamptz := now(); v_today date; v_start timestamptz; v_month date;
  can_sales boolean; can_stock boolean; can_pos boolean; can_buy boolean;
  v jsonb := '{}'::jsonb; x record;
begin
  if not exists (select 1 from public.company_members m where m.company_id = p_company and m.user_id = auth.uid() and m.status = 'active')
     and not app.is_super_admin() then
    raise exception 'Not a member of this company' using errcode = '42501';
  end if;
  select * into c from public.companies where id = p_company;
  tz := coalesce(c.timezone, 'Europe/Tirane');
  v_today := (v_now at time zone tz)::date;
  v_start := v_today::timestamp at time zone tz;
  v_month := date_trunc('month', v_today)::date;
  can_sales := app.has_permission(p_company, 'sales.read');
  can_stock := app.has_permission(p_company, 'inventory.read');
  can_pos := app.has_permission(p_company, 'pos.read') or can_sales;
  can_buy := app.has_permission(p_company, 'invoicing.read') or app.has_permission(p_company, 'procurement.read');
  v := jsonb_build_object('currency', c.base_currency);

  if can_sales then
    select count(*) filter (where not o.is_refund) as receipts,
           coalesce(sum(o.total) filter (where not o.is_refund), 0) as gross
      into x from public.pos_orders o
     where o.company_id = p_company and o.status = 'paid' and o.order_at >= v_start and o.order_at < v_now;
    v := v || jsonb_build_object(
      'today', app.sales_between(p_company, tz, v_today, v_today, v_now),
      'week_ago', app.sales_between(p_company, tz, v_today - 7, v_today - 7, v_now - interval '7 days'),
      'receipts', x.receipts,
      'basket', case when x.receipts > 0 then round(x.gross / x.receipts, 2) end,
      'receipts_week_ago', (select count(*) from public.pos_orders o where o.company_id = p_company and o.status = 'paid' and not o.is_refund
                              and o.order_at >= v_start - interval '7 days' and o.order_at < v_now - interval '7 days'),
      'month', app.sales_between(p_company, tz, v_month, v_today, v_now));
    -- the month's gross margin without VAT: till lines and invoice lines against what the goods cost
    select coalesce(sum(net), 0) as net, coalesce(sum(cost), 0) as cost into x from (
      select case when o.is_refund then -abs(l.line_subtotal) else l.line_subtotal end as net,
             case when o.is_refund then -abs(l.quantity) else l.quantity end * coalesce(l.unit_cost, 0) as cost
        from public.pos_order_lines l join public.pos_orders o on o.id = l.pos_order_id
       where o.company_id = p_company and o.status = 'paid' and o.order_at >= v_month::timestamp at time zone tz
      union all
      select sign_ * il.line_subtotal * coalesce(i.exchange_rate, 1),
             sign_ * il.quantity * coalesce(ic.avg_cost, 0)
        from public.sales_invoices i
        cross join lateral (select case when i.document_type = 'credit_note' then -1 else 1 end as sign_) s
        join public.sales_invoice_lines il on il.invoice_id = i.id
        left join public.item_costs ic on ic.company_id = i.company_id and ic.variant_id = il.variant_id
       where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and i.invoice_date between v_month and v_today
         and il.variant_id is not null) m;
    v := v || jsonb_build_object('month_net', x.net, 'month_margin', x.net - x.cost,
                                 'month_margin_pct', case when x.net > 0 then round((x.net - x.cost) / x.net * 100, 1) end);
  end if;

  if can_pos then
    -- the cash that should be in the drawers of the open tills right now
    select count(*) as open_shifts,
           count(*) filter (where s.opened_at < v_start) as left_open,
           coalesce(sum(s.opening_cash
             + coalesce((select sum(pp.amount) from public.pos_payments pp join public.pos_orders o on o.id = pp.pos_order_id
                          where o.session_id = s.id and o.status = 'paid' and pp.method = 'cash'), 0)
             - coalesce((select sum(o.change_given) from public.pos_orders o where o.session_id = s.id and o.status = 'paid'), 0)
             + coalesce((select sum(case when m.movement_type = 'cash_in' then m.amount else -m.amount end) from public.pos_cash_movements m where m.session_id = s.id), 0)), 0) as cash
      into x from public.pos_sessions s
     where s.company_id = p_company and s.status = 'open' and s.deleted_at is null;
    v := v || jsonb_build_object('open_shifts', x.open_shifts, 'shifts_left_open', x.left_open, 'cash_in_tills', x.cash);
    select count(*) filter (where abs(coalesce(s.cash_difference, 0)) >= 0.01) as n,
           coalesce(sum(s.cash_difference), 0) as total, coalesce(sum(abs(s.cash_difference)), 0) as abs_total
      into x from public.pos_sessions s
     where s.company_id = p_company and s.status = 'closed' and s.deleted_at is null and s.closed_at >= v_month::timestamp at time zone tz;
    v := v || jsonb_build_object('till_diff_count', x.n, 'till_diff', x.total, 'till_diff_abs', x.abs_total);
    select count(*) filter (where o.is_refund) as refunds, coalesce(-sum(o.total) filter (where o.is_refund), 0) as refunded
      into x from public.pos_orders o
     where o.company_id = p_company and o.status = 'paid' and o.order_at >= v_start;
    v := v || jsonb_build_object('refunds_today', x.refunds, 'refunded_today', abs(x.refunded));
    select count(*) as n, coalesce(sum(abs(g.amount)), 0) as amount into x from public.pos_till_log g
     where g.company_id = p_company and g.kind in ('void_line', 'void_qty', 'void_sale') and g.at >= v_start;
    v := v || jsonb_build_object('voids_today', x.n, 'voided_today', x.amount);
  end if;

  if can_stock then
    -- goods that expire: lots still in stock, valued at the average cost
    select count(distinct l.id) filter (where l.expiry_date < v_today) as expired,
           count(distinct l.id) filter (where l.expiry_date between v_today and v_today + 7) as week,
           coalesce(sum(sl.on_hand * coalesce(ic.avg_cost, 0)) filter (where l.expiry_date <= v_today + 7), 0) as week_value,
           count(distinct l.id) filter (where l.expiry_date between v_today and v_today + 30) as month
      into x from public.lots l
      join public.stock_levels sl on sl.lot_id = l.id and sl.on_hand > 0
      left join public.item_costs ic on ic.company_id = l.company_id and ic.variant_id = l.variant_id
     where l.company_id = p_company and l.deleted_at is null and l.expiry_date is not null and l.expiry_date <= v_today + 30;
    v := v || jsonb_build_object('expired_lots', x.expired, 'expiring_week', x.week, 'expiring_week_value', x.week_value, 'expiring_month', x.month);
    -- items that sold in the last 30 days and have nothing left to sell
    with sold as (
      select distinct l.variant_id from public.pos_order_lines l join public.pos_orders o on o.id = l.pos_order_id
       where o.company_id = p_company and o.status = 'paid' and not o.is_refund and o.order_at >= v_now - interval '30 days' and l.variant_id is not null
      union
      select distinct il.variant_id from public.sales_invoice_lines il join public.sales_invoices i on i.id = il.invoice_id
       where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and i.invoice_date >= v_today - 30 and il.variant_id is not null),
    have as (select sl.variant_id, sum(sl.available) as available from public.stock_levels sl where sl.company_id = p_company group by sl.variant_id)
    select count(*) into x from sold s left join have h on h.variant_id = s.variant_id
      join public.product_variants pv on pv.id = s.variant_id and pv.deleted_at is null and pv.is_active
      join public.products p on p.id = pv.product_id and p.deleted_at is null and coalesce(p.product_type, 'stockable') = 'stockable'
     where coalesce(h.available, 0) <= 0;
    v := v || jsonb_build_object('out_of_stock_selling', x.count);
    -- stock that has not sold in 60 days (and came in more than 60 days ago)
    with stock as (select sl.variant_id, sum(sl.on_hand) as qty from public.stock_levels sl where sl.company_id = p_company group by sl.variant_id having sum(sl.on_hand) > 0),
    recent as (
      select distinct l.variant_id from public.pos_order_lines l join public.pos_orders o on o.id = l.pos_order_id
       where o.company_id = p_company and o.status = 'paid' and o.order_at >= v_now - interval '60 days'
      union
      select distinct il.variant_id from public.sales_invoice_lines il join public.sales_invoices i on i.id = il.invoice_id
       where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and i.invoice_date >= v_today - 60)
    select count(*) as n, coalesce(sum(s.qty * coalesce(ic.avg_cost, 0)), 0) as value into x
      from stock s left join public.item_costs ic on ic.company_id = p_company and ic.variant_id = s.variant_id
     where s.variant_id not in (select variant_id from recent where variant_id is not null)
       and coalesce(ic.last_receipt_at, '-infinity') < v_now - interval '60 days';
    v := v || jsonb_build_object('dead_items', x.n, 'dead_value', x.value);
    v := v || jsonb_build_object('price_changes', (select count(*) from public.price_suggestions ps where ps.company_id = p_company and ps.status = 'pending'));
  end if;

  if can_buy or can_stock then
    select count(*) as n, min(g.receipt_date) as oldest into x from public.goods_receipts g
     where g.company_id = p_company and g.deleted_at is null and g.status = 'done' and g.fiscal_status = 'pending_invoice';
    v := v || jsonb_build_object('receipts_waiting_invoice', x.n, 'oldest_waiting_days', case when x.oldest is not null then v_today - x.oldest end);
  end if;
  return v;
end $$;
revoke execute on function public.dashboard_market(uuid) from public, anon;
grant execute on function public.dashboard_market(uuid) to authenticated;
