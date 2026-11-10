-- =============================================================================
-- DrisPRO · the goods-receipt report gives each line's item, so its quantities show their unit (10.11.2026)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.receipt_report(p_receipt uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare g public.goods_receipts;
begin
  select * into g from public.goods_receipts where id = p_receipt;
  if g.id is null then raise exception 'Receipt not found' using errcode = 'P0002'; end if;
  if not (app.has_permission(g.company_id, 'wms.read') or app.has_permission(g.company_id, 'inventory.read') or app.has_permission(g.company_id, 'procurement.read')) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  return (
  with l as (
    select gl.id, gl.po_line_id, gl.variant_id, v.sku, v.name, gl.quantity, gl.qc_status, gl.qc_reason, gl.temperature, p.max_temperature,
           pl.quantity as ordered,
           -- what was still expected when this receipt came: ordered less what other finished receipts brought before it
           pl.quantity - coalesce((select sum(x.quantity) from public.goods_receipt_lines x join public.goods_receipts y on y.id = x.receipt_id
                                    where x.po_line_id = gl.po_line_id and y.id <> g.id and y.status = 'done' and x.qc_status <> 'rejected'
                                      and (g.done_at is null or y.done_at < g.done_at)), 0) as expected
      from public.goods_receipt_lines gl
      join public.product_variants v on v.id = gl.variant_id join public.products p on p.id = v.product_id
      left join public.purchase_order_lines pl on pl.id = gl.po_line_id
     where gl.receipt_id = g.id
  ), per as (   -- one receipt can split a line (two lots): judged per order line
    select coalesce(po_line_id::text, id::text) as k, min(variant_id::text) as variant_id, min(sku) as sku, min(name) as name, max(expected) as expected,
           sum(quantity) filter (where qc_status <> 'rejected') as accepted, coalesce(sum(quantity) filter (where qc_status = 'rejected'), 0) as refused,
           string_agg(distinct qc_reason, '; ') filter (where qc_reason is not null) as reason,
           max(temperature) as temperature, max(max_temperature) as max_temperature,
           bool_or(max_temperature is not null and temperature is null and qc_status <> 'rejected') as not_measured
      from l group by 1
  ), missing as (   -- order lines that did not come at all with this receipt
    select pl.id::text as k, pl.variant_id::text as variant_id, v.sku, v.name, pl.quantity - pl.qty_received as expected
      from public.purchase_order_lines pl join public.product_variants v on v.id = pl.variant_id
     where g.purchase_order_id is not null and pl.purchase_order_id = g.purchase_order_id and g.status = 'done'
       and not exists (select 1 from l where l.po_line_id = pl.id) and pl.quantity > pl.qty_received
  ), rows as (
    select variant_id, sku, name, expected, coalesce(accepted, 0) as accepted, refused, reason, temperature, max_temperature,
           array_remove(array[case when expected is not null and coalesce(accepted, 0) < expected then 'short' end,
                              case when expected is not null and coalesce(accepted, 0) > expected then 'over' end,
                              case when refused > 0 then 'refused' end,
                              case when temperature > max_temperature then 'warm' end,
                              case when not_measured then 'not_measured' end], null) as issues
      from per
    union all
    select variant_id, sku, name, expected, 0, 0, null, null, null, array['short'] from missing
  )
  select jsonb_build_object(
    'id', g.id, 'number', g.number, 'status', g.status, 'date', g.receipt_date, 'done_at', g.done_at,
    'vendor', (select name from public.business_partners where id = g.vendor_id),
    'vendor_tax', (select tax_number from public.business_partners where id = g.vendor_id),
    'order', (select number from public.purchase_orders where id = g.purchase_order_id),
    'delivery_note', g.vendor_delivery_note, 'driver_name', g.driver_name,
    'warehouse', (select name from public.warehouses where id = g.warehouse_id),
    'received_by', app.person_name(coalesce(g.received_by, g.created_by)),
    'company', (select name from public.companies where id = g.company_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('variant_id', variant_id, 'sku', sku, 'name', name, 'expected', expected, 'accepted', accepted, 'refused', refused,
               'reason', reason, 'temperature', temperature, 'max_temperature', max_temperature, 'issues', to_jsonb(issues)) order by cardinality(issues) desc, sku)
               from rows), '[]'::jsonb),
    'issues', (select count(*) from rows where cardinality(issues) > 0)));
end $function$;
