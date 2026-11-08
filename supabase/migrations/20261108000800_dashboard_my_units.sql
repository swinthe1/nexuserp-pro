-- =============================================================================
-- DrisPRO · the dashboard and the day's sentence show a person only the units they work in (audit, wave 1)
--   Someone whose access is limited to some units (Users › units) sees the tills, cash, refunds, voids
--   and stock of those units, and no invoices of the company (invoices belong to no unit). Everyone
--   else sees the whole company, as before.
-- =============================================================================

-- what the tills of some units sold, the same way app.sales_between counts the whole company
create or replace function app.sales_between_for(p_company uuid, p_mine uuid[], p_regs uuid[], p_tz text, p_from date, p_to date, p_cut timestamptz)
returns numeric language sql stable set search_path = '' as $$
  select case when p_mine is null then app.sales_between(p_company, p_tz, p_from, p_to, p_cut)
    else coalesce((select sum(case when o.is_refund then -abs(o.total) else o.total end) from public.pos_orders o
                    where o.company_id = p_company and o.status = 'paid' and o.register_id = any (p_regs)
                      and o.order_at >= p_from::timestamp at time zone p_tz and o.order_at < least(p_cut, (p_to + 1)::timestamp at time zone p_tz)), 0)
         + coalesce((select sum(case when h.kind = 'sale_return' then -abs(h.total) else h.total end) from public.history_documents h
                    where h.company_id = p_company and h.kind in ('sale', 'pos_sale', 'sale_return') and h.warehouse_id = any (p_mine)
                      and h.doc_date between p_from and p_to and h.created_at < p_cut), 0) end
$$;
revoke all on function app.sales_between_for(uuid, uuid[], uuid[], text, date, date, timestamptz) from public, anon;

CREATE OR REPLACE FUNCTION public.dashboard_market(p_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.companies; tz text; v_now timestamptz := now(); v_today date; v_start timestamptz; v_month date;
  can_sales boolean; can_stock boolean; can_pos boolean; can_buy boolean;
  v jsonb := '{}'::jsonb; x record; v_mine uuid[]; v_regs uuid[];
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
  -- a person who works in some units sees those units: their tills and stock, not the company's invoices
  v_mine := app.my_warehouses(p_company);
  if v_mine is not null then select coalesce(array_agg(r.id), '{}') into v_regs from public.pos_registers r where r.company_id = p_company and r.warehouse_id = any (v_mine); end if;
  can_sales := app.has_permission(p_company, 'sales.read');
  can_stock := app.has_permission(p_company, 'inventory.read');
  can_pos := app.has_permission(p_company, 'pos.read') or can_sales;
  can_buy := app.has_permission(p_company, 'invoicing.read') or app.has_permission(p_company, 'procurement.read');
  v := jsonb_build_object('currency', c.base_currency, 'my_stores', to_jsonb(v_mine));

  if can_sales then
    select count(*) filter (where not o.is_refund) as receipts,
           coalesce(sum(o.total) filter (where not o.is_refund), 0) as gross
      into x from public.pos_orders o
     where o.company_id = p_company and o.status = 'paid' and (v_regs is null or o.register_id = any (v_regs)) and o.order_at >= v_start and o.order_at < v_now;
    v := v || jsonb_build_object(
      'today', app.sales_between_for(p_company, v_mine, v_regs, tz, v_today, v_today, v_now),
      'week_ago', app.sales_between_for(p_company, v_mine, v_regs, tz, v_today - 7, v_today - 7, v_now - interval '7 days'),
      'receipts', x.receipts,
      'basket', case when x.receipts > 0 then round(x.gross / x.receipts, 2) end,
      'receipts_week_ago', (select count(*) from public.pos_orders o where o.company_id = p_company and o.status = 'paid' and (v_regs is null or o.register_id = any (v_regs)) and not o.is_refund
                              and o.order_at >= v_start - interval '7 days' and o.order_at < v_now - interval '7 days'),
      'month', app.sales_between_for(p_company, v_mine, v_regs, tz, v_month, v_today, v_now));
    -- the month's gross margin without VAT: till lines and invoice lines against what the goods cost
    select coalesce(sum(net), 0) as net, coalesce(sum(cost), 0) as cost into x from (
      select case when o.is_refund then -abs(l.line_subtotal) else l.line_subtotal end as net,
             case when o.is_refund then -abs(l.quantity) else l.quantity end * coalesce(l.unit_cost, 0) as cost
        from public.pos_order_lines l join public.pos_orders o on o.id = l.pos_order_id
       where o.company_id = p_company and o.status = 'paid' and (v_regs is null or o.register_id = any (v_regs)) and o.order_at >= v_month::timestamp at time zone tz
      union all
      select sign_ * il.line_subtotal * coalesce(i.exchange_rate, 1),
             sign_ * il.quantity * coalesce(ic.avg_cost, 0)
        from public.sales_invoices i
        cross join lateral (select case when i.document_type = 'credit_note' then -1 else 1 end as sign_) s
        join public.sales_invoice_lines il on il.invoice_id = i.id
        left join public.item_costs ic on ic.company_id = i.company_id and ic.variant_id = il.variant_id
       where i.company_id = p_company and i.status = 'posted' and v_mine is null and i.deleted_at is null and i.invoice_date between v_month and v_today
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
     where s.company_id = p_company and s.status = 'open' and (v_regs is null or s.register_id = any (v_regs)) and s.deleted_at is null;
    v := v || jsonb_build_object('open_shifts', x.open_shifts, 'shifts_left_open', x.left_open, 'cash_in_tills', x.cash);
    select count(*) filter (where abs(coalesce(s.cash_difference, 0)) >= 0.01) as n,
           coalesce(sum(s.cash_difference), 0) as total, coalesce(sum(abs(s.cash_difference)), 0) as abs_total
      into x from public.pos_sessions s
     where s.company_id = p_company and s.status = 'closed' and (v_regs is null or s.register_id = any (v_regs)) and s.deleted_at is null and s.closed_at >= v_month::timestamp at time zone tz;
    v := v || jsonb_build_object('till_diff_count', x.n, 'till_diff', x.total, 'till_diff_abs', x.abs_total);
    select count(*) filter (where o.is_refund) as refunds, coalesce(-sum(o.total) filter (where o.is_refund), 0) as refunded
      into x from public.pos_orders o
     where o.company_id = p_company and o.status = 'paid' and (v_regs is null or o.register_id = any (v_regs)) and o.order_at >= v_start;
    v := v || jsonb_build_object('refunds_today', x.refunds, 'refunded_today', abs(x.refunded));
    select count(*) as n, coalesce(sum(abs(g.amount)), 0) as amount into x from public.pos_till_log g
     where g.company_id = p_company and (v_regs is null or g.register_id = any (v_regs)) and g.kind in ('void_line', 'void_qty', 'void_sale') and g.at >= v_start;
    v := v || jsonb_build_object('voids_today', x.n, 'voided_today', x.amount);
  end if;

  if can_stock then
    -- goods that expire: lots still in stock, valued at the average cost
    select count(distinct l.id) filter (where l.expiry_date < v_today) as expired,
           count(distinct l.id) filter (where l.expiry_date between v_today and v_today + 7) as week,
           coalesce(sum(sl.on_hand * coalesce(ic.avg_cost, 0)) filter (where l.expiry_date <= v_today + 7), 0) as week_value,
           count(distinct l.id) filter (where l.expiry_date between v_today and v_today + 30) as month
      into x from public.lots l
      join public.stock_levels sl on sl.lot_id = l.id and sl.on_hand > 0 and (v_mine is null or sl.warehouse_id = any (v_mine))
      left join public.item_costs ic on ic.company_id = l.company_id and ic.variant_id = l.variant_id
     where l.company_id = p_company and l.deleted_at is null and l.expiry_date is not null and l.expiry_date <= v_today + 30;
    v := v || jsonb_build_object('expired_lots', x.expired, 'expiring_week', x.week, 'expiring_week_value', x.week_value, 'expiring_month', x.month);
    -- items that sold in the last 30 days and have nothing left to sell
    with sold as (
      select distinct l.variant_id from public.pos_order_lines l join public.pos_orders o on o.id = l.pos_order_id
       where o.company_id = p_company and o.status = 'paid' and (v_regs is null or o.register_id = any (v_regs)) and not o.is_refund and o.order_at >= v_now - interval '30 days' and l.variant_id is not null
      union
      select distinct il.variant_id from public.sales_invoice_lines il join public.sales_invoices i on i.id = il.invoice_id
       where i.company_id = p_company and i.status = 'posted' and v_mine is null and i.deleted_at is null and i.invoice_date >= v_today - 30 and il.variant_id is not null),
    have as (select sl.variant_id, sum(sl.available) as available from public.stock_levels sl where sl.company_id = p_company and (v_mine is null or sl.warehouse_id = any (v_mine)) group by sl.variant_id)
    select count(*) into x from sold s left join have h on h.variant_id = s.variant_id
      join public.product_variants pv on pv.id = s.variant_id and pv.deleted_at is null and pv.is_active
      join public.products p on p.id = pv.product_id and p.deleted_at is null and coalesce(p.product_type, 'stockable') = 'stockable'
     where coalesce(h.available, 0) <= 0;
    v := v || jsonb_build_object('out_of_stock_selling', x.count);
    -- stock that has not sold in 60 days (and came in more than 60 days ago)
    with stock as (select sl.variant_id, sum(sl.on_hand) as qty from public.stock_levels sl where sl.company_id = p_company and (v_mine is null or sl.warehouse_id = any (v_mine)) group by sl.variant_id having sum(sl.on_hand) > 0),
    recent as (
      select distinct l.variant_id from public.pos_order_lines l join public.pos_orders o on o.id = l.pos_order_id
       where o.company_id = p_company and o.status = 'paid' and (v_regs is null or o.register_id = any (v_regs)) and o.order_at >= v_now - interval '60 days'
      union
      select distinct il.variant_id from public.sales_invoice_lines il join public.sales_invoices i on i.id = il.invoice_id
       where i.company_id = p_company and i.status = 'posted' and v_mine is null and i.deleted_at is null and i.invoice_date >= v_today - 60)
    select count(*) as n, coalesce(sum(s.qty * coalesce(ic.avg_cost, 0)), 0) as value into x
      from stock s left join public.item_costs ic on ic.company_id = p_company and ic.variant_id = s.variant_id
     where s.variant_id not in (select variant_id from recent where variant_id is not null)
       and coalesce(ic.last_receipt_at, '-infinity') < v_now - interval '60 days';
    v := v || jsonb_build_object('dead_items', x.n, 'dead_value', x.value);
    v := v || jsonb_build_object('price_changes', (select count(*) from public.price_suggestions ps where ps.company_id = p_company and ps.status = 'pending'));
  end if;

  if can_buy or can_stock then
    select count(*) as n, min(g.receipt_date) as oldest into x from public.goods_receipts g
     where g.company_id = p_company and g.deleted_at is null and g.status = 'done' and (v_mine is null or g.warehouse_id = any (v_mine)) and g.fiscal_status = 'pending_invoice';
    v := v || jsonb_build_object('receipts_waiting_invoice', x.n, 'oldest_waiting_days', case when x.oldest is not null then v_today - x.oldest end);
  end if;
  return v;
end $function$;

CREATE OR REPLACE FUNCTION public.sales_pulse(p_company uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.companies; tz text; v_now timestamptz := now(); v_today date; v_start timestamptz;
  v_month_start date; v_prev_day date; v_top jsonb; v_mine uuid[]; v_regs uuid[];
begin
  perform app.require_permission(p_company, 'sales.read');
  select * into c from public.companies where id = p_company;
  tz := coalesce(c.timezone, 'Europe/Tirane');
  v_today := (v_now at time zone tz)::date;
  v_start := v_today::timestamp at time zone tz;
  v_month_start := date_trunc('month', v_today)::date;
  v_mine := app.my_warehouses(p_company);
  if v_mine is not null then select coalesce(array_agg(r.id), '{}') into v_regs from public.pos_registers r where r.company_id = p_company and r.warehouse_id = any (v_mine); end if;
  -- the same day of last month (on the 31st after a short month: its last day)
  v_prev_day := least((v_today - interval '1 month')::date, v_month_start - 1);

  -- today's best seller, by sales with VAT, at the till and on invoices
  select jsonb_build_object('name', x.name, 'amount', x.amount, 'quantity', x.qty) into v_top
    from (select max(l.description) name, sum(l.amount) amount, sum(l.qty) qty
            from (select ol.variant_id, ol.description, case when o.is_refund then -abs(ol.line_total) else ol.line_total end amount,
                         case when o.is_refund then -abs(ol.quantity) else ol.quantity end qty
                    from public.pos_order_lines ol join public.pos_orders o on o.id = ol.pos_order_id
                   where o.company_id = p_company and o.status = 'paid' and (v_regs is null or o.register_id = any (v_regs)) and o.order_at >= v_start and o.order_at < v_now
                  union all
                  select il.variant_id, il.description, il.line_total * i.exchange_rate * case when i.document_type = 'credit_note' then -1 else 1 end,
                         il.quantity * case when i.document_type = 'credit_note' then -1 else 1 end
                    from public.sales_invoice_lines il join public.sales_invoices i on i.id = il.invoice_id
                   where i.company_id = p_company and i.status = 'posted' and v_mine is null and i.deleted_at is null and i.invoice_date = v_today) l
           where l.variant_id is not null
           group by l.variant_id having sum(l.amount) > 0
           order by sum(l.amount) desc limit 1) x;

  return jsonb_build_object(
    'currency', c.base_currency, 'my_stores', to_jsonb(v_mine),
    'now', v_now, 'weekday', extract(isodow from v_today)::int, 'day', extract(day from v_today)::int,
    'today', app.sales_between_for(p_company, v_mine, v_regs, tz, v_today, v_today, v_now),
    'receipts', (select count(*) from public.pos_orders o where o.company_id = p_company and o.status = 'paid' and (v_regs is null or o.register_id = any (v_regs)) and not o.is_refund
                   and o.order_at >= v_start and o.order_at < v_now),
    'week_ago', app.sales_between_for(p_company, v_mine, v_regs, tz, v_today - 7, v_today - 7, v_now - interval '7 days'),
    'month', app.sales_between_for(p_company, v_mine, v_regs, tz, v_month_start, v_today, v_now),
    'prev_month', app.sales_between_for(p_company, v_mine, v_regs, tz, (v_month_start - interval '1 month')::date, v_prev_day,
                                    least(v_now - interval '1 month', v_month_start::timestamp at time zone tz)),
    'top', v_top);
end $function$;
