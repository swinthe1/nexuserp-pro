-- =============================================================================
-- DrisPRO · goods back to the supplier by item, not by receipt (10.11.2026)
--   · the agreement with a supplier lets the shop send back some items (near or past their date) from what it
--     delivered over the months: one return with only those items, whatever receipts they came on;
--   · each item's quantity is taken from that supplier's receipts by itself (the lots that expire first, then
--     the newest), at the cost it came in at, from the shelf of the unit where it is;
--   · a return made this way may span several receipts: it then points at none.
-- =============================================================================

alter table public.vendor_returns alter column receipt_id drop not null;

-- what a supplier delivered to a unit and can still go back: per item, with what is on the shelves and the nearest date
create or replace function public.vendor_returnable_items(p_company uuid, p_vendor uuid, p_warehouse uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_permission(p_company, 'inventory.read') then raise exception 'Permission denied' using errcode = '42501'; end if;
  return coalesce((
    with got as (
      select gl.variant_id, sum(gl.quantity - coalesce((select sum(rl.quantity) from public.vendor_return_lines rl where rl.receipt_line_id = gl.id), 0)) as left_qty,
             max(g.receipt_date) as last_received
        from public.goods_receipts g
        join public.goods_receipt_lines gl on gl.receipt_id = g.id
       where g.company_id = p_company and g.vendor_id = p_vendor and g.warehouse_id = p_warehouse and g.receipt_type = 'purchase'
         and g.status = 'done' and g.deleted_at is null and gl.quantity > 0
       group by gl.variant_id)
    select jsonb_agg(jsonb_build_object(
             'variant_id', v.id, 'name', v.name, 'sku', v.sku, 'item_no', v.item_no, 'uom', u.code,
             'barcode', (select b.barcode from public.product_barcodes b where b.variant_id = v.id and b.deleted_at is null order by b.is_primary desc, b.created_at limit 1),
             'returnable', got.left_qty, 'last_received', got.last_received,
             'on_hand', coalesce((select sum(sl.on_hand) from public.stock_levels sl where sl.variant_id = v.id and sl.warehouse_id = p_warehouse), 0),
             'nearest_expiry', (select min(lt.expiry_date) from public.stock_levels sl join public.lots lt on lt.id = sl.lot_id
                                  where sl.variant_id = v.id and sl.warehouse_id = p_warehouse and sl.on_hand > 0))
           order by v.name)
      from got
      join public.product_variants v on v.id = got.variant_id and v.deleted_at is null
      join public.products p on p.id = v.product_id
      left join public.units_of_measure u on u.id = p.uom_id
     where got.left_qty > 0), '[]'::jsonb);
end $$;

create or replace function public.return_items_to_vendor(p_company uuid, p_vendor uuid, p_warehouse uuid, p_lines jsonb, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare x jsonb; l record; v_id uuid; v_number text; v_sup uuid; v_need numeric; v_take numeric; v_loc uuid; v_total numeric := 0; n int := 0;
        v_receipts uuid[] := '{}'; v_orders uuid[] := '{}'; v_name text;
begin
  perform app.require_permission(p_company, 'inventory.write');
  if nullif(btrim(p_reason), '') is null then raise exception 'Say why the goods go back' using errcode = '23514'; end if;
  if not exists (select 1 from public.business_partners where id = p_vendor and company_id = p_company) then raise exception 'Supplier not found' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.warehouses where id = p_warehouse and company_id = p_company) then raise exception 'Warehouse not found' using errcode = 'P0002'; end if;
  insert into public.vendor_returns (company_id, receipt_id, vendor_id, warehouse_id, return_date, reason)
  values (p_company, null, p_vendor, p_warehouse,
          (now() at time zone coalesce((select timezone from public.companies where id = p_company), 'Europe/Belgrade'))::date, btrim(p_reason))
  returning id, number into v_id, v_number;
  v_sup := app.virtual_location(p_company, 'supplier');
  for x in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_need := round(coalesce((x ->> 'quantity')::numeric, 0), 4);
    continue when v_need <= 0;
    -- first: did the supplier deliver that much to this unit, still not sent back?
    if v_need > coalesce((select sum(gl.quantity - coalesce((select sum(rl.quantity) from public.vendor_return_lines rl where rl.receipt_line_id = gl.id), 0))
                            from public.goods_receipts g join public.goods_receipt_lines gl on gl.receipt_id = g.id
                           where g.company_id = p_company and g.vendor_id = p_vendor and g.warehouse_id = p_warehouse and g.receipt_type = 'purchase'
                             and g.status = 'done' and g.deleted_at is null and gl.variant_id = (x ->> 'variant_id')::uuid
                             and ((x ->> 'lot_id') is null or gl.lot_id = (x ->> 'lot_id')::uuid)), 0) then
      select name into v_name from public.product_variants where id = (x ->> 'variant_id')::uuid;
      raise exception 'Not that much of % came from this supplier to this unit and can go back', coalesce(v_name, '?') using errcode = '23514';
    end if;
    -- this item's lines on the supplier's receipts to this unit: the lots that expire first, then the newest receipts
    for l in
      select gl.*, g.purchase_order_id, g.id as rid,
             gl.quantity - coalesce((select sum(rl.quantity) from public.vendor_return_lines rl where rl.receipt_line_id = gl.id), 0) as left_qty
        from public.goods_receipts g
        join public.goods_receipt_lines gl on gl.receipt_id = g.id
        left join public.lots lt on lt.id = gl.lot_id
       where g.company_id = p_company and g.vendor_id = p_vendor and g.warehouse_id = p_warehouse and g.receipt_type = 'purchase'
         and g.status = 'done' and g.deleted_at is null and gl.variant_id = (x ->> 'variant_id')::uuid
         and ((x ->> 'lot_id') is null or gl.lot_id = (x ->> 'lot_id')::uuid)
       order by lt.expiry_date nulls last, g.receipt_date desc, g.created_at desc
    loop
      exit when v_need <= 0;
      continue when l.left_qty <= 0;
      v_take := least(v_need, l.left_qty);
      -- from the shelf where the goods are now (the receipt's shelf first)
      select sl.location_id into v_loc from public.stock_levels sl
       where sl.variant_id = l.variant_id and sl.warehouse_id = p_warehouse and sl.lot_id is not distinct from l.lot_id and sl.on_hand > 0
       order by (sl.location_id = l.location_id) desc, sl.on_hand desc limit 1;
      perform app.post_stock_move(p_company, 'purchase_return', l.variant_id, coalesce(v_loc, l.location_id), v_sup, v_take, l.unit_cost, l.lot_id,
                                  'vendor_return', v_id, l.id, v_number, now());
      insert into public.vendor_return_lines (company_id, return_id, receipt_line_id, po_line_id, variant_id, lot_id, location_id, quantity, unit_cost)
      values (p_company, v_id, l.id, l.po_line_id, l.variant_id, l.lot_id, coalesce(v_loc, l.location_id), v_take, l.unit_cost);
      if l.po_line_id is not null then
        update public.purchase_order_lines set qty_received = greatest(qty_received - v_take, 0) where id = l.po_line_id;
        v_orders := v_orders || l.purchase_order_id;
      end if;
      v_receipts := v_receipts || l.rid;
      v_total := v_total + round(v_take * coalesce(l.unit_cost, 0), 2);
      v_need := v_need - v_take;
    end loop;
    if v_need > 0 then
      select name into v_name from public.product_variants where id = (x ->> 'variant_id')::uuid;
      raise exception 'Only % less of % came from this supplier to this unit and can go back', trim_scale(v_need), coalesce(v_name, '?') using errcode = '23514';
    end if;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Choose what goes back' using errcode = '23514'; end if;
  -- all from one receipt: the return points at it, as one made from the receipt does
  update public.vendor_returns set total_cost = v_total,
         receipt_id = case when (select count(distinct r) from unnest(v_receipts) r) = 1 then v_receipts[1] end
   where id = v_id;
  update public.purchase_orders set status = 'partially_received'
   where id = any (v_orders) and status in ('received', 'closed')
     and exists (select 1 from public.purchase_order_lines pl where pl.purchase_order_id = purchase_orders.id and pl.qty_received < pl.quantity);
  return v_id;
end $$;

revoke execute on function public.vendor_returnable_items(uuid, uuid, uuid), public.return_items_to_vendor(uuid, uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.vendor_returnable_items(uuid, uuid, uuid), public.return_items_to_vendor(uuid, uuid, uuid, jsonb, text) to authenticated;

-- the credit note of a return that spans several receipts
CREATE OR REPLACE FUNCTION public.vendor_credit_from_return(p_return uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.vendor_returns; v_bill public.vendor_bills; v_cn uuid; v_cur text; v_rate numeric := 1;
begin
  select * into v from public.vendor_returns where id = p_return for update;
  if v.id is null then raise exception 'Return not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v.company_id, 'invoicing.write');
  if v.vendor_credit_id is not null then return v.vendor_credit_id; end if;
  if v.vendor_id is null then raise exception 'The receipt has no vendor' using errcode = '23514'; end if;
  -- the bill these goods were on, when there is one
  select b.* into v_bill from public.vendor_bills b
   where b.company_id = v.company_id and b.document_type = 'vendor_bill' and b.status = 'posted' and b.deleted_at is null
     and exists (select 1 from public.vendor_bill_lines bl join public.vendor_return_lines rl on (rl.po_line_id is not null and rl.po_line_id = bl.po_line_id)
                                                                                           or rl.receipt_line_id = bl.receipt_line_id
                  where bl.bill_id = b.id and rl.return_id = v.id)
   order by b.bill_date desc limit 1;
  -- the money of the bill, else of the receipt the goods came on (a return by item may span several)
  select coalesce(v_bill.currency_code, gr.currency_code), coalesce(v_bill.exchange_rate, gr.exchange_rate, 1) into v_cur, v_rate
    from public.goods_receipts gr
   where gr.id = coalesce(v.receipt_id, (select gl.receipt_id from public.vendor_return_lines rl join public.goods_receipt_lines gl on gl.id = rl.receipt_line_id
                                          where rl.return_id = v.id limit 1));
  v_cur := coalesce(v_cur, (select base_currency from public.companies where id = v.company_id));
  v_rate := coalesce(v_rate, 1);
  insert into public.vendor_bills (company_id, document_type, vendor_id, purchase_order_id, original_bill_id, vendor_invoice_number,
                                   bill_date, due_date, currency_code, exchange_rate, notes)
  values (v.company_id, 'vendor_credit', v.vendor_id, v.purchase_order_id, v_bill.id, v.number,
          current_date, current_date, v_cur, v_rate, 'Goods returned: ' || v.number || ' · ' || v.reason)
  returning id into v_cn;
  insert into public.vendor_bill_lines (company_id, bill_id, line_no, po_line_id, receipt_line_id, variant_id, description, quantity,
                                        unit_price, discount_pct, tax_code_id, is_return)
  select v.company_id, v_cn, row_number() over (order by rl.id), rl.po_line_id, rl.receipt_line_id, rl.variant_id, pv.name, rl.quantity,
         coalesce(pl.unit_price, gl.unit_price, round(rl.unit_cost / nullif(v_rate, 0), 4)), coalesce(pl.discount_pct, 0),
         coalesce(pl.tax_code_id, p.purchase_tax_code_id), true
    from public.vendor_return_lines rl
    join public.product_variants pv on pv.id = rl.variant_id join public.products p on p.id = pv.product_id
    join public.goods_receipt_lines gl on gl.id = rl.receipt_line_id
    left join public.purchase_order_lines pl on pl.id = rl.po_line_id
   where rl.return_id = v.id;
  update public.vendor_returns set vendor_credit_id = v_cn where id = v.id;
  return v_cn;
end $function$;

-- the list and the return note name every receipt the goods came on
create or replace function public.vendor_returns_list(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.has_permission(p_company, 'inventory.read') or app.has_permission(p_company, 'invoicing.read')) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(x order by x.return_date desc, x.number desc) from (
    select r.id, r.number, r.return_date, r.reason, r.total_cost, r.vendor_id, bp.name as vendor, r.receipt_id, coalesce(g.number, (select string_agg(distinct gr.number, ', ') from public.vendor_return_lines rl
               join public.goods_receipt_lines gl on gl.id = rl.receipt_line_id join public.goods_receipts gr on gr.id = gl.receipt_id where rl.return_id = r.id)) as receipt_number,
           w.name as warehouse, r.vendor_credit_id, cn.number as credit_number,
           case when r.vendor_credit_id is null then 'none' when cn.status = 'posted' then 'posted' else 'draft' end as credit_state,
           case when r.vendor_credit_id is null or cn.status <> 'posted' then current_date - r.return_date end as days_waiting,
           (select count(*) from public.vendor_return_lines l where l.return_id = r.id) as lines
      from public.vendor_returns r
      left join public.business_partners bp on bp.id = r.vendor_id
      left join public.goods_receipts g on g.id = r.receipt_id
      left join public.warehouses w on w.id = r.warehouse_id
      left join public.vendor_bills cn on cn.id = r.vendor_credit_id
     where r.company_id = p_company) x), '[]'::jsonb);
end $$;

create or replace function public.vendor_return_doc(p_return uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.vendor_returns;
begin
  select * into r from public.vendor_returns where id = p_return;
  if r.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  if not (app.has_permission(r.company_id, 'inventory.read') or app.has_permission(r.company_id, 'invoicing.read')) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'number', r.number, 'date', r.return_date, 'reason', r.reason, 'total_cost', r.total_cost,
    'company', (select jsonb_build_object('name', coalesce(c.legal_name, c.name), 'tax_number', c.tax_number, 'address', concat_ws(', ', c.address_line1, c.city))
                  from public.companies c where c.id = r.company_id),
    'vendor', (select jsonb_build_object('name', coalesce(bp.legal_name, bp.name), 'tax_number', bp.tax_number) from public.business_partners bp where bp.id = r.vendor_id),
    'warehouse', (select name from public.warehouses where id = r.warehouse_id),
    'receipt', (select string_agg(distinct gr.number, ', ') from public.vendor_return_lines rl join public.goods_receipt_lines gl on gl.id = rl.receipt_line_id
                  join public.goods_receipts gr on gr.id = gl.receipt_id where rl.return_id = r.id),
    'delivery_note', (select vendor_delivery_note from public.goods_receipts where id = r.receipt_id),
    'made_by', app.person_name(r.created_by),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('sku', v.sku, 'name', v.name, 'uom', u.code, 'quantity', l.quantity, 'unit_cost', l.unit_cost,
                         'lot', lo.lot_number, 'value', round(l.quantity * l.unit_cost, 2)) order by v.sku)
                         from public.vendor_return_lines l
                         join public.product_variants v on v.id = l.variant_id join public.products p on p.id = v.product_id
                         left join public.units_of_measure u on u.id = p.uom_id
                         left join public.lots lo on lo.id = l.lot_id
                        where l.return_id = r.id), '[]'::jsonb));
end $$;
