-- =============================================================================
-- DrisPRO · the transfer and the stock adjustment can be printed (audit, wave 1)
--   A transfer note (from unit, to unit, lines, value at cost) signed by who delivered, who drove and
--   who received; an adjustment note (the reason, what went up or down and its value) signed by who
--   prepared and who approved it. The cost shows only to those who may see costs.
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
select app._patch_function('public.document_print', $x$  else
    raise exception 'Unknown document kind %', p_kind using errcode = '22023';$x$,
$x$  elsif p_kind = 'stock_transfer' then
    select r.company_id into v_co from public.stock_transfers r where r.id = p_id and r.deleted_at is null;
    if v_co is null then raise exception 'Document not found' using errcode = 'P0002'; end if;
    perform app.require_any_permission(v_co, array['inventory.read', 'wms.read']);
    select jsonb_agg(jsonb_build_object('code', v.sku, 'description', v.name, 'uom', u.code, 'qty', x.qty, 'pack', app.pack_text(l.variant_id, x.qty, null),
             'lot', lt.lot_number, 'location', fl.code, 'discount', 0, 'tax_rate', 0, 'tax', 0,
             'price', case when x.see then x.cost end, 'net', case when x.see then round(x.qty * x.cost, 2) else 0 end, 'total', case when x.see then round(x.qty * x.cost, 2) else 0 end)
             order by l.created_at, l.id)
      into v_lines from public.stock_transfer_lines l
      join public.stock_transfers tr on tr.id = l.transfer_id
      cross join lateral (select case when tr.status in ('draft', 'confirmed') then l.quantity else coalesce(nullif(l.quantity_done, 0), l.quantity) end as qty,
                                 coalesce((select ic.avg_cost from public.item_costs ic where ic.company_id = l.company_id and ic.variant_id = l.variant_id), 0) as cost,
                                 app.has_permission(l.company_id, 'inventory.costs') as see) x
      join public.product_variants v on v.id = l.variant_id join public.products p on p.id = v.product_id
      left join public.units_of_measure u on u.id = p.uom_id left join public.lots lt on lt.id = l.lot_id left join public.warehouse_locations fl on fl.id = l.from_location_id
     where l.transfer_id = p_id;
    select jsonb_build_object('kind', 'stock_transfer', 'number', r.number, 'date', r.transfer_date, 'expected_date', r.expected_date, 'status', r.status,
             'currency', (select base_currency from public.companies where id = r.company_id), 'notes', r.notes,
             'warehouse', (select name from public.warehouses where id = r.from_warehouse_id),
             'by', (select full_name from public.profiles where id = coalesce(r.shipped_by, r.created_by)),
             'partner', jsonb_build_object('name', (select name from public.warehouses where id = r.to_warehouse_id),
                                           'address', (select nullif(concat_ws(', ', w.address_line1, w.city), '') from public.warehouses w where w.id = r.to_warehouse_id)),
             'tax_total', 0, 'total', coalesce((select sum((l->>'total')::numeric) from jsonb_array_elements(coalesce(v_lines, '[]')) l), 0))
           || app.print_lines(v_lines)
      into v from public.stock_transfers r where r.id = p_id;

  elsif p_kind = 'stock_adjustment' then
    select r.company_id into v_co from public.stock_adjustments r where r.id = p_id and r.deleted_at is null;
    if v_co is null then raise exception 'Document not found' using errcode = 'P0002'; end if;
    perform app.require_permission(v_co, 'inventory.read');
    select jsonb_agg(jsonb_build_object('code', v.sku, 'description', v.name || coalesce(' · ' || l.notes, ''), 'uom', u.code, 'qty', l.quantity_change,
             'lot', lt.lot_number, 'location', loc.code, 'discount', 0, 'tax_rate', 0, 'tax', 0,
             'price', case when x.see then x.cost end, 'net', case when x.see then round(l.quantity_change * x.cost, 2) else 0 end,
             'total', case when x.see then round(l.quantity_change * x.cost, 2) else 0 end)
             order by l.created_at, l.id)
      into v_lines from public.stock_adjustment_lines l
      cross join lateral (select coalesce(l.unit_cost, (select ic.avg_cost from public.item_costs ic where ic.company_id = l.company_id and ic.variant_id = l.variant_id), 0) as cost,
                                 app.has_permission(l.company_id, 'inventory.costs') as see) x
      join public.product_variants v on v.id = l.variant_id join public.products p on p.id = v.product_id
      left join public.units_of_measure u on u.id = p.uom_id left join public.lots lt on lt.id = l.lot_id left join public.warehouse_locations loc on loc.id = l.location_id
     where l.adjustment_id = p_id;
    select jsonb_build_object('kind', 'stock_adjustment', 'number', r.number, 'date', r.adjustment_date, 'status', r.status,
             'currency', (select base_currency from public.companies where id = r.company_id), 'notes', r.notes, 'reference', r.reason,
             'warehouse', (select name from public.warehouses where id = r.warehouse_id),
             'by', (select full_name from public.profiles where id = r.created_by), 'partner', null,
             'tax_total', 0, 'total', coalesce((select sum((l->>'total')::numeric) from jsonb_array_elements(coalesce(v_lines, '[]')) l), 0))
           || app.print_lines(v_lines)
      into v from public.stock_adjustments r where r.id = p_id;
  else
    raise exception 'Unknown document kind %', p_kind using errcode = '22023';$x$);
drop function app._patch_function(text, text, text);
