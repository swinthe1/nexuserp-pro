-- =============================================================================
-- DrisPRO · the sales overview counts the tills too (audit, wave 1)
--   Before, it counted only invoices, so a market saw sales near zero. Now it also gives what the
--   tills sold (without VAT, refunds taken off, receipts already turned into an invoice left out so
--   nothing counts twice), the number of receipts, and the tills month by month for the chart.
-- =============================================================================
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;

select app._patch_function('public.sales_overview',
  $x$  opps_closed as ($x$,
  $x$  till as (
    select (o.order_at at time zone coalesce(c.timezone, 'Europe/Tirane'))::date as d,
           case when o.is_refund then -1 else 1 end * (abs(o.total) - abs(o.tax_total)) as net, o.is_refund
      from public.pos_orders o join public.companies c on c.id = o.company_id
     where o.company_id = p_company and o.status = 'paid' and o.deleted_at is null and o.sales_invoice_id is null
       and o.order_at >= (p_to - interval '12 months')::date::timestamp at time zone 'UTC' - interval '1 day'
  ),
  opps_closed as ($x$);
select app._patch_function('public.sales_overview',
  $x$    'invoice_count', (select count(*) from inv_range where sgn = 1),$x$,
  $x$    'invoice_count', (select count(*) from inv_range where sgn = 1),
    'till_revenue', coalesce((select round(sum(net), 2) from till where d between p_from and p_to), 0),
    'till_receipts', (select count(*) from till where d between p_from and p_to and not is_refund),$x$);
select app._patch_function('public.sales_overview',
  $x$               coalesce((select sum(sgn * round(subtotal * exchange_rate, 2)) from inv where not is_opening and date_trunc('month', invoice_date) = m), 0) as revenue$x$,
  $x$               coalesce((select sum(sgn * round(subtotal * exchange_rate, 2)) from inv where not is_opening and date_trunc('month', invoice_date) = m), 0) as revenue,
               coalesce((select round(sum(net), 2) from till where date_trunc('month', d) = m), 0) as till$x$);
drop function app._patch_function(text, text, text);
