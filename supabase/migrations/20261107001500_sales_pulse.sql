-- =============================================================================
-- DrisPRO · the day in one sentence, and the contact for the public packages page
--   sales_pulse: today's sales so far against the same weekday a week ago up to the same hour,
--   the month so far against the same days of last month, and today's best seller. Till receipts,
--   posted invoices and the old program's sales, with VAT, in the company's currency. No AI: the
--   numbers come straight from the documents, so they cost nothing and are always the same.
--   public_contact: only the ways to reach DrisPRO, for the public packages page (no prices).
-- =============================================================================

-- sales from one day to another, counting only what was in the program at the cut: till receipts by
-- their time, invoices once posted, the old program's sales once they arrived (a fair "same hour")
create or replace function app.sales_between(p_company uuid, p_tz text, p_from date, p_to date, p_cut timestamptz)
returns numeric language sql stable set search_path = '' as $$
  select coalesce((select sum(case when o.is_refund then -abs(o.total) else o.total end) from public.pos_orders o
                    where o.company_id = p_company and o.status = 'paid'
                      and o.order_at >= p_from::timestamp at time zone p_tz and o.order_at < least(p_cut, (p_to + 1)::timestamp at time zone p_tz)), 0)
       + coalesce((select sum(case when i.document_type = 'credit_note' then -i.total_base else i.total_base end) from public.sales_invoices i
                    where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null
                      and i.invoice_date between p_from and p_to and coalesce(i.posted_at, i.created_at) < p_cut), 0)
       + coalesce((select sum(case when h.kind = 'sale_return' then -abs(h.total) else h.total end) from public.history_documents h
                    where h.company_id = p_company and h.kind in ('sale', 'pos_sale', 'sale_return')
                      and h.doc_date between p_from and p_to and h.created_at < p_cut), 0)
$$;
revoke all on function app.sales_between(uuid, text, date, date, timestamptz) from public;

create or replace function public.sales_pulse(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c public.companies; tz text; v_now timestamptz := now(); v_today date; v_start timestamptz;
  v_month_start date; v_prev_day date; v_top jsonb;
begin
  perform app.require_permission(p_company, 'sales.read');
  select * into c from public.companies where id = p_company;
  tz := coalesce(c.timezone, 'Europe/Tirane');
  v_today := (v_now at time zone tz)::date;
  v_start := v_today::timestamp at time zone tz;
  v_month_start := date_trunc('month', v_today)::date;
  -- the same day of last month (on the 31st after a short month: its last day)
  v_prev_day := least((v_today - interval '1 month')::date, v_month_start - 1);

  -- today's best seller, by sales with VAT, at the till and on invoices
  select jsonb_build_object('name', x.name, 'amount', x.amount, 'quantity', x.qty) into v_top
    from (select max(l.description) name, sum(l.amount) amount, sum(l.qty) qty
            from (select ol.variant_id, ol.description, case when o.is_refund then -abs(ol.line_total) else ol.line_total end amount,
                         case when o.is_refund then -abs(ol.quantity) else ol.quantity end qty
                    from public.pos_order_lines ol join public.pos_orders o on o.id = ol.pos_order_id
                   where o.company_id = p_company and o.status = 'paid' and o.order_at >= v_start and o.order_at < v_now
                  union all
                  select il.variant_id, il.description, il.line_total * i.exchange_rate * case when i.document_type = 'credit_note' then -1 else 1 end,
                         il.quantity * case when i.document_type = 'credit_note' then -1 else 1 end
                    from public.sales_invoice_lines il join public.sales_invoices i on i.id = il.invoice_id
                   where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and i.invoice_date = v_today) l
           where l.variant_id is not null
           group by l.variant_id having sum(l.amount) > 0
           order by sum(l.amount) desc limit 1) x;

  return jsonb_build_object(
    'currency', c.base_currency,
    'now', v_now, 'weekday', extract(isodow from v_today)::int, 'day', extract(day from v_today)::int,
    'today', app.sales_between(p_company, tz, v_today, v_today, v_now),
    'receipts', (select count(*) from public.pos_orders o where o.company_id = p_company and o.status = 'paid' and not o.is_refund
                   and o.order_at >= v_start and o.order_at < v_now),
    'week_ago', app.sales_between(p_company, tz, v_today - 7, v_today - 7, v_now - interval '7 days'),
    'month', app.sales_between(p_company, tz, v_month_start, v_today, v_now),
    'prev_month', app.sales_between(p_company, tz, (v_month_start - interval '1 month')::date, v_prev_day,
                                    least(v_now - interval '1 month', v_month_start::timestamp at time zone tz)),
    'top', v_top);
end $$;
revoke execute on function public.sales_pulse(uuid) from public, anon;
grant execute on function public.sales_pulse(uuid) to authenticated;

-- the ways to reach DrisPRO, for the public packages page (the prices stay off it)
create or replace function public.public_contact()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce((select jsonb_build_object('email', email, 'phone', phone, 'whatsapp', whatsapp) from app.public_contact limit 1), '{}'::jsonb)
$$;
revoke execute on function public.public_contact() from public;
grant execute on function public.public_contact() to anon, authenticated;
