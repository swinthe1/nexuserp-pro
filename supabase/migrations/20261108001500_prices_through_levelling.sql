-- =============================================================================
-- DrisPRO · every change of a selling price goes through a levelling document (audit, wave 1)
--   A new selling price typed on the supplier's invoice, or on the item's card, now makes and posts a
--   levelling (NIV-) by itself: the old and the new price, the stock it touches and the value of the
--   change, in the price history with its number, as when a levelling is made by hand.
-- =============================================================================
alter table public.price_levels drop constraint if exists price_levels_source_check;
alter table public.price_levels add constraint price_levels_source_check
  check (source in ('manual', 'expiry', 'expiry_end', 'purchase_invoice', 'item_card'));

-- a levelling made and posted in one go: [{variant_id, price}] with the new prices without VAT
create or replace function app.price_level_auto(p_company uuid, p_source text, p_note text, p_items jsonb, p_warehouse uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; x jsonb; n int := 0;
begin
  if jsonb_array_length(coalesce(p_items, '[]')) = 0 then return null; end if;
  insert into public.price_levels (company_id, level_date, warehouse_id, notes, source)
  values (p_company, current_date, p_warehouse, left(p_note, 500), p_source) returning id into v_id;
  for x in select * from jsonb_array_elements(p_items) loop
    n := n + 1;
    insert into public.price_level_lines (company_id, level_id, line_no, variant_id, new_price)
    values (p_company, v_id, n, (x ->> 'variant_id')::uuid, round((x ->> 'price')::numeric, 4))
    on conflict (level_id, variant_id) do update set new_price = excluded.new_price;
  end loop;
  return public.price_level_post(v_id) || jsonb_build_object('id', v_id);
end $$;
revoke all on function app.price_level_auto(uuid, text, text, jsonb, uuid) from public, anon, authenticated;

-- the item card: a new price is a levelling of one line
create or replace function public.price_level_quick(p_variant uuid, p_price numeric, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_co uuid;
begin
  select company_id into v_co from public.product_variants where id = p_variant and deleted_at is null;
  if v_co is null then raise exception 'Item not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_co, 'inventory.write');
  if p_price is null or p_price < 0 then raise exception 'Enter a price of zero or more' using errcode = '23514'; end if;
  return app.price_level_auto(v_co, 'item_card', coalesce(p_note, 'Ndryshim çmimi te kartela e artikullit'),
                              jsonb_build_array(jsonb_build_object('variant_id', p_variant, 'price', p_price)));
end $$;
revoke all on function public.price_level_quick(uuid, numeric, text) from public, anon;
grant execute on function public.price_level_quick(uuid, numeric, text) to authenticated;

-- the supplier's invoice: its new selling prices become one levelling
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
select app._patch_function('public.purchase_invoice_complete', $x$  v_pay uuid; v_pay_status text; v_cur_net numeric; v_lines int := 0;$x$,
  $x$  v_pay uuid; v_pay_status text; v_cur_net numeric; v_lines int := 0; v_new jsonb := '[]'::jsonb;$x$);
select app._patch_function('public.purchase_invoice_complete',
$x$    perform app.require_permission(b.company_id, 'inventory.write');
    select count(*) = 1 into v_single from public.product_variants where product_id = l.product_id and deleted_at is null;
    if l.sales_price_override is not null and not v_single then
      update public.product_variants set sales_price_override = l.sales_price_new where id = l.variant_id;
    else
      update public.products set sales_price = l.sales_price_new where id = l.product_id;
      if l.sales_price_override is not null then update public.product_variants set sales_price_override = null where id = l.variant_id; end if;
    end if;$x$,
$x$    perform app.require_permission(b.company_id, 'inventory.write');
    v_new := v_new || jsonb_build_array(jsonb_build_object('variant_id', l.variant_id, 'price', l.sales_price_new));$x$);
select app._patch_function('public.purchase_invoice_complete',
$x$    v_prices := v_prices + 1;
  end loop;$x$,
$x$    v_prices := v_prices + 1;
  end loop;
  -- the new prices as one levelling document, posted, with the invoice in its note
  if jsonb_array_length(v_new) > 0 then
    perform app.price_level_auto(b.company_id, 'purchase_invoice',
      'Nga fatura e blerjes ' || coalesce(b.number, '') || coalesce(' (' || b.vendor_invoice_number || ')', ''), v_new);
  end if;$x$);
drop function app._patch_function(text, text, text);
