-- =============================================================================
-- DrisPRO · the same item from different suppliers: who sold it cheapest and who dearest (10.11.2026)
--   · one item (one barcode) has one card; each supplier's purchases point at it, so their prices compare;
--   · the price of a purchase is the line without VAT, after the discounts, per unit, in the company's money;
--   · item_vendor_prices: one item, each supplier (last, lowest, highest, average price, how much bought);
--   · vendor_price_compare: the items bought from two suppliers or more in a period, the cheapest and the dearest.
-- =============================================================================

create or replace function app.purchase_prices(p_company uuid, p_from date, p_to date)
returns table (variant_id uuid, vendor_id uuid, bill_date date, bill_number text, qty numeric, price numeric)
language sql stable security definer set search_path = '' as $$
  select l.variant_id, b.vendor_id, b.bill_date, b.number, l.quantity,
         round(l.line_subtotal / nullif(l.quantity, 0) * coalesce(nullif(b.exchange_rate, 0), 1), 4)
    from public.vendor_bills b
    join public.vendor_bill_lines l on l.bill_id = b.id and l.variant_id is not null and l.quantity > 0 and not coalesce(l.is_return, false)
   where b.company_id = p_company and b.status = 'posted' and b.document_type = 'vendor_bill' and b.deleted_at is null
     and not coalesce(b.is_debit_note, false) and b.bill_date between p_from and p_to
$$;
revoke all on function app.purchase_prices(uuid, date, date) from public, anon, authenticated;

create or replace function public.item_vendor_prices(p_company uuid, p_variant uuid, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_from date := coalesce(p_from, current_date - 365); v_to date := coalesce(p_to, current_date);
begin
  if not (app.has_permission(p_company, 'procurement.read') or app.has_permission(p_company, 'invoicing.read')) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  return jsonb_build_object('from', v_from, 'to', v_to, 'vendors', coalesce((
    select jsonb_agg(x order by x.last_price, x.vendor) from (
      select pp.vendor_id, bp.name as vendor,
             (array_agg(pp.price order by pp.bill_date desc, pp.bill_number desc))[1] as last_price,
             max(pp.bill_date) as last_date,
             (array_agg(pp.bill_number order by pp.bill_date desc, pp.bill_number desc))[1] as last_bill,
             min(pp.price) as min_price, max(pp.price) as max_price,
             round(sum(pp.price * pp.qty) / nullif(sum(pp.qty), 0), 4) as avg_price,
             sum(pp.qty) as qty, count(*) as times,
             (select vp.price from public.vendor_products vp where vp.variant_id = p_variant and vp.vendor_id = pp.vendor_id and vp.deleted_at is null
               order by vp.updated_at desc nulls last limit 1) as list_price
        from app.purchase_prices(p_company, v_from, v_to) pp
        left join public.business_partners bp on bp.id = pp.vendor_id
       where pp.variant_id = p_variant
       group by pp.vendor_id, bp.name) x), '[]'::jsonb));
end $$;

create or replace function public.vendor_price_compare(p_company uuid, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_from date := coalesce(p_from, current_date - 180); v_to date := coalesce(p_to, current_date);
begin
  if not (app.has_permission(p_company, 'procurement.read') or app.has_permission(p_company, 'invoicing.read')) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  return jsonb_build_object('from', v_from, 'to', v_to, 'rows', coalesce((
    with last as (   -- each supplier's last price for each item in the period
      select distinct on (pp.variant_id, pp.vendor_id) pp.variant_id, pp.vendor_id, pp.price, pp.bill_date
        from app.purchase_prices(p_company, v_from, v_to) pp
       order by pp.variant_id, pp.vendor_id, pp.bill_date desc, pp.bill_number desc),
    agg as (
      select l.variant_id, count(*) as vendors,
             (array_agg(l.vendor_id order by l.price, l.bill_date desc))[1] as cheap_vendor, min(l.price) as cheap_price,
             (array_agg(l.vendor_id order by l.price desc, l.bill_date desc))[1] as dear_vendor, max(l.price) as dear_price
        from last l group by l.variant_id having count(*) >= 2)
    select jsonb_agg(jsonb_build_object(
             'variant_id', a.variant_id, 'item_no', v.item_no, 'sku', v.sku, 'name', v.name,
             'barcode', (select b.barcode from public.product_barcodes b where b.variant_id = v.id and b.deleted_at is null order by b.is_primary desc, b.created_at limit 1),
             'uom', u.code, 'vendors', a.vendors,
             'cheap_vendor', cb.name, 'cheap_vendor_id', a.cheap_vendor, 'cheap_price', a.cheap_price,
             'dear_vendor', db.name, 'dear_vendor_id', a.dear_vendor, 'dear_price', a.dear_price,
             'diff', a.dear_price - a.cheap_price, 'diff_pct', round(100 * (a.dear_price - a.cheap_price) / nullif(a.cheap_price, 0), 1),
             'avg_cost', ic.avg_cost)
           order by (a.dear_price - a.cheap_price) / nullif(a.cheap_price, 0) desc nulls last)
      from agg a
      join public.product_variants v on v.id = a.variant_id
      join public.products p on p.id = v.product_id
      left join public.units_of_measure u on u.id = p.uom_id
      left join public.business_partners cb on cb.id = a.cheap_vendor
      left join public.business_partners db on db.id = a.dear_vendor
      left join public.item_costs ic on ic.company_id = v.company_id and ic.variant_id = v.id), '[]'::jsonb));
end $$;

revoke execute on function public.item_vendor_prices(uuid, uuid, date, date), public.vendor_price_compare(uuid, date, date) from public, anon;
grant execute on function public.item_vendor_prices(uuid, uuid, date, date), public.vendor_price_compare(uuid, date, date) to authenticated;
