-- =============================================================================
-- DrisPRO · the day's card on the home page says how much of the month came from the tills and how much from invoices (11.11.2026)
-- =============================================================================

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
    -- the month at the tills alone, so the card can say how much came from the tills and how much from invoices
    'month_tills', coalesce((select sum(case when o.is_refund then -abs(o.total) else o.total end) from public.pos_orders o
                              where o.company_id = p_company and o.status = 'paid' and (v_regs is null or o.register_id = any (v_regs))
                                and o.order_at >= v_month_start::timestamp at time zone tz and o.order_at < v_now), 0),
    'top', v_top);
end $function$;
