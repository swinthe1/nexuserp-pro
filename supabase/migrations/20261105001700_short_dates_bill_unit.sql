-- =============================================================================
-- Short dates from purchase invoices (#9): a bill made for an order or a receipt has no unit of its
-- own; the unit is the receipt's, else the order's. Before, such lines never showed.
-- =============================================================================
create or replace function app.bill_short_dates(p_company uuid, p_warehouse uuid, p_until date, p_today date)
returns table (variant_id uuid, warehouse_id uuid, expiry_date date, ref text, quantity numeric, supplier_id uuid)
language sql stable security definer set search_path = '' as $$
  with x as (
    select l.variant_id, l.expiry_date, l.quantity, b.bill_date, b.vendor_id, coalesce(b.vendor_invoice_number, b.number) as ref,
           coalesce(b.warehouse_id,
                    (select g.warehouse_id from public.goods_receipt_lines gl join public.goods_receipts g on g.id = gl.receipt_id where gl.id = l.receipt_line_id),
                    (select g.warehouse_id from public.goods_receipts g where g.id = b.receipt_id),
                    (select po.warehouse_id from public.purchase_orders po where po.id = b.purchase_order_id)) as wh
      from public.vendor_bill_lines l join public.vendor_bills b on b.id = l.bill_id
      join public.product_variants v on v.id = l.variant_id join public.products p on p.id = v.product_id
     where b.company_id = p_company and b.status = 'posted' and b.deleted_at is null and l.expiry_date is not null
       and p.tracking = 'none' and l.expiry_date <= p_until and l.expiry_date >= p_today - 30)
  select distinct on (x.variant_id, x.wh, x.expiry_date)
         x.variant_id, x.wh, x.expiry_date, x.ref,
         least(x.quantity, coalesce((select sum(sl.on_hand) from public.stock_levels sl where sl.variant_id = x.variant_id and sl.warehouse_id = x.wh), 0)),
         x.vendor_id
    from x
   where x.wh is not null and (p_warehouse is null or x.wh = p_warehouse)
   order by x.variant_id, x.wh, x.expiry_date, x.bill_date desc
$$;
revoke execute on function app.bill_short_dates(uuid, uuid, date, date) from public, anon, authenticated;
