-- =============================================================================
-- DrisPRO · a truck without an order is received at the door (audit, wave 1)
--   The scanner starts a receipt itself: the supplier, the delivery note number and the unit; then
--   every item scanned goes on it. Lines without a price take a provisional cost (the supplier's
--   price, else the last purchase, else the average cost); the supplier's invoice, when it is
--   entered, corrects it, as with any goods received before their invoice.
-- =============================================================================
create or replace function public.dock_receipt_start(p_company uuid, p_vendor uuid, p_warehouse uuid, p_note text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not (app.has_permission(p_company, 'wms.write') or app.has_permission(p_company, 'inventory.write')) then
    raise exception 'Permission denied: wms.write required' using errcode = '42501';
  end if;
  perform app.check_warehouse(p_company, p_warehouse);
  if not exists (select 1 from public.business_partners where id = p_vendor and company_id = p_company and deleted_at is null) then
    raise exception 'Choose the supplier' using errcode = '23514';
  end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse and company_id = p_company and deleted_at is null) then
    raise exception 'Choose the unit' using errcode = '23514';
  end if;
  insert into public.goods_receipts (company_id, vendor_id, warehouse_id, receipt_type, receipt_date, vendor_delivery_note, notes)
  values (p_company, p_vendor, p_warehouse, 'purchase', current_date, nullif(btrim(p_note), ''), 'Pranuar te dera pa porosi')
  returning id into v_id;
  return v_id;
end $$;

-- a provisional cost for the lines that have none (no order, no price)
create or replace function public.dock_receipt_costs(p_receipt uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare r public.goods_receipts; n int;
begin
  select * into r from public.goods_receipts where id = p_receipt and deleted_at is null;
  if r.id is null then raise exception 'Receipt not found' using errcode = 'P0002'; end if;
  if not (app.has_permission(r.company_id, 'wms.write') or app.has_permission(r.company_id, 'inventory.write')) then
    raise exception 'Permission denied: wms.write required' using errcode = '42501';
  end if;
  if r.status <> 'draft' then return 0; end if;
  update public.goods_receipt_lines l set unit_cost = round(coalesce(
           (select gp.unit_price from public.get_purchase_price(r.company_id, r.vendor_id, l.variant_id, l.quantity, null, r.receipt_date) gp
             where gp.unit_price > 0 and coalesce(gp.currency_code, (select base_currency from public.companies where id = r.company_id))
                   = (select base_currency from public.companies where id = r.company_id) limit 1),
           (select gl.unit_cost from public.goods_receipt_lines gl join public.goods_receipts g on g.id = gl.receipt_id
             where gl.variant_id = l.variant_id and g.company_id = r.company_id and g.status = 'done' and g.receipt_type = 'purchase' and gl.unit_cost > 0
             order by g.receipt_date desc, gl.created_at desc limit 1),
           (select ic.avg_cost from public.item_costs ic where ic.company_id = r.company_id and ic.variant_id = l.variant_id and ic.avg_cost > 0),
           0), 6)
   where l.receipt_id = r.id and l.unit_cost is null and l.unit_price is null and l.po_line_id is null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.dock_receipt_start(uuid, uuid, uuid, text), public.dock_receipt_costs(uuid) from public, anon;
grant execute on function public.dock_receipt_start(uuid, uuid, uuid, text), public.dock_receipt_costs(uuid) to authenticated;
