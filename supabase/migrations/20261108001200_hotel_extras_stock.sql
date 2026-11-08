-- =============================================================================
-- DrisPRO · goods charged to a room leave the stock (audit, wave 1)
--   An extra picked from the items (a minibar drink, a snack) keeps its item: at check-out it goes on
--   the invoice with the item's own VAT (as before), and now it also leaves the stock of the hotel's
--   unit, with its cost booked like any sale. When the stock cannot give it (nothing on the shelf and
--   selling below zero is off), check-out still goes through and the manager gets a task to fix it.
--   Services written as free text (laundry, a transfer) stay as they were.
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
select app._patch_function('public.hotel_check_out', $x$        v_cur text; v_std uuid;$x$, $x$        v_cur text; v_std uuid; v_wh uuid; g record;$x$);
select app._patch_function('public.hotel_check_out',
  $x$  update public.hotel_reservations set status = 'checked_out', checked_out_at = now(), invoice_id = v_inv,$x$,
  $x$  -- goods charged to the room leave the stock of the hotel's unit, as a sale does
  v_wh := coalesce((select default_warehouse_id from public.company_settings where company_id = s.company_id),
                   (select id from public.warehouses where company_id = s.company_id and deleted_at is null and is_active order by created_at limit 1));
  for g in select hc.variant_id, max(hc.description) as what, sum(hc.quantity) as qty
             from public.hotel_charges hc join public.product_variants v on v.id = hc.variant_id join public.products p on p.id = v.product_id
            where hc.reservation_id = s.id and coalesce(p.product_type, 'stockable') = 'stockable'
            group by hc.variant_id loop
    begin
      perform app.post_stock_move(s.company_id, 'delivery', g.variant_id, app.main_location(v_wh), app.virtual_location(s.company_id, 'customer'),
                                  g.qty, null, null, 'sales_invoice', v_inv, null, 'Qëndrimi ' || coalesce(s.number, ''));
    exception when others then
      perform app.auto_task(s.company_id, 'hotel_stock:' || s.id || ':' || g.variant_id, 'Nxirr nga stoku: ' || g.what || ' (qëndrimi ' || coalesce(s.number, '') || ')',
        app.first_with_role(s.company_id, array['store_manager', 'company_admin']), current_date + 1, 2::smallint, 'hotel_reservations', s.id, s.number,
        'Në check-out malli nuk doli dot nga stoku: ' || sqlerrm || '. Pranoni mallin ose bëni rregullimin e stokut.');
    end;
  end loop;
  update public.hotel_reservations set status = 'checked_out', checked_out_at = now(), invoice_id = v_inv,$x$);
drop function app._patch_function(text, text, text);
