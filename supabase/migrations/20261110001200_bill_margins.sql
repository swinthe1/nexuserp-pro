-- =============================================================================
-- DrisPRO · the average margin of each purchase bill (10.11.2026)
--   · counted once the bill is completed: the selling prices the price clerk set on it (kept without VAT;
--     the item's selling price now where she left it as it was) against what the bill paid for the goods
--     (without VAT, after the discounts, in the company's money); services and expenses are left out.
-- =============================================================================

create or replace function public.bill_margins(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.has_permission(p_company, 'invoicing.read') or app.has_permission(p_company, 'procurement.read')) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_object_agg(bill_id, round(100 * (sell - cost) / nullif(sell, 0), 1)) from (
      select l.bill_id,
             sum(l.quantity * coalesce(l.sales_price_new, v.sales_price_override, p.sales_price, 0)) as sell,
             sum(l.line_subtotal * coalesce(nullif(b.exchange_rate, 0), 1)) as cost
        from public.vendor_bills b
        join public.vendor_bill_lines l on l.bill_id = b.id and l.variant_id is not null and l.quantity > 0
        join public.product_variants v on v.id = l.variant_id
        join public.products p on p.id = v.product_id and p.product_type <> 'service'
       where b.company_id = p_company and b.deleted_at is null and b.document_type = 'vendor_bill' and b.status = 'posted'
       group by l.bill_id) x where sell > 0), '{}'::jsonb);
end $$;
revoke execute on function public.bill_margins(uuid) from public, anon;
grant execute on function public.bill_margins(uuid) to authenticated;
