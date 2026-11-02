-- =============================================================================
-- DrisPRO · Where is it? One item across every store and warehouse
--   Scan an item (Zebra, phone camera or keyboard): how much each unit has, which units are
--   short, and where to take it from: the unit with the most to spare above its own minimum.
--   One tap asks that unit for it (a transfer request) and the people there are told.
--   Replenishment does the same before it buys: what another unit can spare is moved first.
-- =============================================================================
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

alter table public.company_settings add column if not exists replenish_from_units boolean not null default true;

-- What a unit can give without going short itself:
--   with a reorder rule: what is free above its minimum
--   a warehouse without a rule: everything free
--   a store without a rule: half of what is free (it sells it too); the daily automation takes none
create or replace function app.unit_spare(p_type text, p_has_rule boolean, p_free numeric, p_min numeric, p_for_auto boolean default false)
returns numeric language sql immutable set search_path = '' as $$
  select greatest(0, case
    when p_type not in ('warehouse', 'store') then 0
    when p_has_rule then p_free - coalesce(p_min, 0)
    when p_type = 'warehouse' then p_free
    when p_for_auto then 0
    else floor(p_free / 2) end)
$$;

-- one item in every active unit (not the "on the road" warehouse)
create or replace function app.item_units(p_company uuid, p_variant uuid)
returns table (id uuid, code text, name text, type text, on_hand numeric, reserved numeric, available numeric, outgoing numeric, incoming numeric,
               min_qty numeric, max_qty numeric, multiple_qty numeric, has_rule boolean, has_row boolean, sold_30 numeric)
language sql stable security definer set search_path = '' as $$
  select w.id, w.code, w.name, w.warehouse_type,
         coalesce(st.on_hand, 0), coalesce(st.reserved, 0), coalesce(st.on_hand, 0) - coalesce(st.reserved, 0),
         -- promised to another unit and not shipped yet
         coalesce((select sum(tl.quantity - tl.quantity_done) from public.stock_transfer_lines tl join public.stock_transfers t on t.id = tl.transfer_id
                    where t.from_warehouse_id = w.id and tl.variant_id = p_variant and t.status = 'draft' and t.deleted_at is null), 0),
         -- on its way here: transfers (asked for or on the road) and purchase orders
         coalesce((select sum(case when t.status = 'in_transit' then tl.quantity_done - coalesce(tl.quantity_received, 0) else tl.quantity - tl.quantity_done end)
                     from public.stock_transfer_lines tl join public.stock_transfers t on t.id = tl.transfer_id
                    where t.to_warehouse_id = w.id and tl.variant_id = p_variant and t.status in ('draft', 'in_transit') and t.deleted_at is null), 0)
         + coalesce((select sum(greatest(pl.quantity - pl.qty_received, 0)) from public.purchase_order_lines pl join public.purchase_orders po on po.id = pl.purchase_order_id
                      where pl.variant_id = p_variant and po.warehouse_id = w.id and po.deleted_at is null
                        and po.status in ('draft', 'pending_approval', 'approved', 'sent', 'partially_received')), 0),
         ru.min_qty, ru.max_qty, coalesce(ru.multiple_qty, 1), ru.id is not null, coalesce(st.n, 0) > 0,
         coalesce((select sum(m.quantity) from public.stock_movements m
                    where m.company_id = p_company and m.variant_id = p_variant and m.from_warehouse_id = w.id
                      and m.movement_type in ('pos_sale', 'delivery') and m.movement_date >= now() - interval '30 days'), 0)
    from public.warehouses w
    left join lateral (select sum(sl.on_hand) as on_hand, sum(sl.reserved) as reserved, count(*) as n
                         from public.stock_levels sl where sl.variant_id = p_variant and sl.warehouse_id = w.id) st on true
    left join public.replenishment_rules ru on ru.variant_id = p_variant and ru.warehouse_id = w.id and ru.is_active and ru.deleted_at is null
   where w.company_id = p_company and w.deleted_at is null and w.is_active and w.warehouse_type <> 'transit'
$$;

-- -----------------------------------------------------------------------------
-- 1. The lookup: by a scanned code, a typed name, or the item itself
-- -----------------------------------------------------------------------------
create or replace function public.item_where(p_company uuid, p_code text default null, p_variant uuid default null, p_here uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_var uuid; v_n int; v_q text := btrim(coalesce(p_code, '')); v_item jsonb; v_units jsonb; v_sugg jsonb := '[]'::jsonb;
        v_here uuid := p_here; v_mine uuid[]; v_used jsonb := '{}'::jsonb; v_avg numeric; v_need numeric; v_qty numeric; v_basis text;
        u record; s record; v_matches jsonb; v_mult numeric;
begin
  if not (app.has_permission(p_company, 'inventory.read') or app.has_permission(p_company, 'pos.read') or app.has_permission(p_company, 'wms.read')) then
    raise exception 'Permission denied: inventory.read required' using errcode = '42501';
  end if;

  if p_variant is not null then
    select v.id into v_var from public.product_variants v where v.id = p_variant and v.company_id = p_company and v.deleted_at is null;
  elsif v_q <> '' then
    select count(distinct f.variant_id), min(f.variant_id::text)::uuid into v_n, v_var from public.find_variant_by_code(p_company, v_q) f;
    if v_n > 1 then v_var := null; end if;
    if coalesce(v_n, 0) <> 1 then
      -- not a code: look for it by name (several words, any order)
      select jsonb_agg(jsonb_build_object('variant_id', x.id, 'sku', x.sku, 'name', x.name) order by x.name), count(*), min(x.id::text)::uuid
        into v_matches, v_n, v_var
        from (select v.id, v.sku, v.name from public.product_variants v join public.products p on p.id = v.product_id and p.deleted_at is null
               where v.company_id = p_company and v.deleted_at is null and v.is_active
                 and (v.id in (select f.variant_id from public.find_variant_by_code(p_company, v_q) f)
                      or not exists (select 1 from regexp_split_to_table(lower(v_q), '\s+') w
                                      where w <> '' and position(w in lower(v.name || ' ' || v.sku || ' ' || coalesce(p.brand, ''))) = 0))
               order by v.name limit 12) x;
      if coalesce(v_n, 0) <> 1 then
        return jsonb_build_object('found', false, 'matches', coalesce(v_matches, '[]'::jsonb));
      end if;
    end if;
  end if;
  if v_var is null then return jsonb_build_object('found', false, 'matches', '[]'::jsonb); end if;

  select jsonb_build_object('variant_id', v.id, 'product_id', p.id, 'sku', v.sku, 'name', v.name, 'product_type', p.product_type,
                            'price', round(coalesce(v.sales_price_override, p.sales_price) * (1 + coalesce(tc.rate, 0) / 100), 2), 'unit', uom.code,
                            'barcode', (select b.barcode from public.product_barcodes b where b.variant_id = v.id and b.deleted_at is null
                                         order by b.quantity, b.created_at limit 1))
    into v_item
    from public.product_variants v join public.products p on p.id = v.product_id
    left join public.units_of_measure uom on uom.id = p.uom_id
    left join public.tax_codes tc on tc.id = p.sales_tax_code_id
   where v.id = v_var;

  -- "my unit": the one asked about, or the only one a person works in
  v_mine := app.my_warehouses(p_company);
  if v_here is null and array_length(v_mine, 1) = 1 then v_here := v_mine[1]; end if;

  select jsonb_agg(jsonb_build_object(
           'id', x.id, 'code', x.code, 'name', x.name, 'type', x.type, 'on_hand', x.on_hand, 'reserved', x.reserved, 'available', x.available,
           'outgoing', x.outgoing, 'incoming', x.incoming, 'min_qty', x.min_qty, 'max_qty', x.max_qty, 'sold_30', x.sold_30,
           'spare', app.unit_spare(x.type, x.has_rule, x.available - x.outgoing, x.min_qty),
           'status', case when not x.has_row and not x.has_rule and x.on_hand = 0 then 'none'
                          when x.available <= 0 then 'out'
                          when x.has_rule and x.available <= x.min_qty then 'low'
                          else 'ok' end,
           'here', x.id = v_here, 'mine', v_mine is null or x.id = any (v_mine),
           'docs', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'number', t.number, 'status', t.status, 'is_request', t.is_request,
                                                                 'qty', case when t.status = 'in_transit' then tl.quantity_done else tl.quantity end,
                                                                 'from', (select fw.name from public.warehouses fw where fw.id = t.from_warehouse_id)) order by t.created_at)
                               from public.stock_transfers t join public.stock_transfer_lines tl on tl.transfer_id = t.id
                              where t.to_warehouse_id = x.id and tl.variant_id = v_var and t.status in ('draft', 'in_transit') and t.deleted_at is null), '[]'::jsonb))
           order by x.id = v_here desc, x.type <> 'warehouse', x.code)
    into v_units from app.item_units(p_company, v_var) x;
  v_units := coalesce(v_units, '[]'::jsonb);

  -- a unit with no sales of its own is guessed from the units that do sell it
  select avg(x.sold_30) into v_avg from jsonb_to_recordset(v_units) x(sold_30 numeric) where x.sold_30 > 0;

  -- the units that are short (or only "my unit", when there is one): where to take it from
  for u in
    select * from jsonb_to_recordset(v_units) x(id uuid, name text, type text, available numeric, incoming numeric, min_qty numeric, max_qty numeric,
                                                 sold_30 numeric, status text, here boolean)
     where x.type in ('warehouse', 'store') and x.status in ('out', 'low', 'none') and (x.here or (v_here is null and x.status <> 'none'))
     order by x.available - coalesce(x.min_qty, 0), x.name
  loop
    select coalesce(ru.multiple_qty, 1) as mult, ru.id is not null as has_rule into s
      from (select 1) one left join public.replenishment_rules ru on ru.variant_id = v_var and ru.warehouse_id = u.id and ru.is_active and ru.deleted_at is null;
    v_mult := s.mult;
    v_basis := case when s.has_rule then 'rule' when coalesce(nullif(u.sold_30, 0), v_avg, 0) > 0 then 'sales' else 'spare' end;
    v_need := case v_basis
                when 'rule' then u.max_qty - (u.available + u.incoming)
                when 'sales' then ceil(coalesce(nullif(u.sold_30, 0), v_avg) / 30 * 14) - (u.available + u.incoming) end;
    if v_basis = 'rule' and v_need > 0 then v_need := ceil(v_need / v_mult) * v_mult; end if;

    if u.incoming > 0 and (v_need <= 0 or (v_need is null and u.available + u.incoming > 0)) then
      v_sugg := v_sugg || jsonb_build_object('to', u.id, 'to_name', u.name, 'kind', 'coming', 'incoming', u.incoming, 'basis', v_basis);
      continue;
    end if;
    continue when v_need is not null and v_need <= 0;

    select x.id, x.name, x.available, x.spare - coalesce((v_used ->> x.id::text)::numeric, 0) as spare into s
      from jsonb_to_recordset(v_units) x(id uuid, name text, type text, available numeric, spare numeric)
     where x.id <> u.id
     order by x.spare - coalesce((v_used ->> x.id::text)::numeric, 0) desc, x.type = 'warehouse' desc, x.name limit 1;

    if s.id is not null and s.spare > 0 then
      v_qty := least(coalesce(v_need, ceil(s.spare / 2)), s.spare);
      if v_basis = 'rule' and v_mult <> 1 and floor(v_qty / v_mult) >= 1 then v_qty := floor(v_qty / v_mult) * v_mult; end if;
      v_qty := round(v_qty, 3);
      v_used := v_used || jsonb_build_object(s.id::text, coalesce((v_used ->> s.id::text)::numeric, 0) + v_qty);
      v_sugg := v_sugg || jsonb_build_object('to', u.id, 'to_name', u.name, 'kind', 'transfer', 'from', s.id, 'from_name', s.name,
                                             'from_available', s.available, 'from_spare', s.spare, 'qty', v_qty, 'need', v_need,
                                             'rest', greatest(coalesce(v_need, 0) - v_qty, 0), 'incoming', u.incoming, 'basis', v_basis);
    else
      v_sugg := v_sugg || jsonb_build_object('to', u.id, 'to_name', u.name, 'kind', 'buy', 'qty', v_need, 'incoming', u.incoming, 'basis', v_basis,
                                             'vendor_name', (select bp.name from public.business_partners bp where bp.id = app.preferred_vendor(p_company, v_var, u.id)));
    end if;
  end loop;

  return jsonb_build_object('found', true, 'item', v_item, 'here', v_here, 'units', v_units, 'suggestions', v_sugg,
                            'can_request', app.has_permission(p_company, 'inventory.write') or app.has_permission(p_company, 'wms.write'));
end $$;

-- -----------------------------------------------------------------------------
-- 2. Ask a unit for it: a transfer request from that unit to this one.
--    One open request per pair of units: what is asked later joins it.
-- -----------------------------------------------------------------------------
create or replace function public.item_request(p_company uuid, p_variant uuid, p_from uuid, p_to uuid, p_qty numeric, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_from public.warehouses; v_to public.warehouses; v_name text; v_fl uuid; v_tl uuid; v_tr uuid; v_no text; v_line uuid; v_merged boolean := false; v_told int;
begin
  if not (app.has_permission(p_company, 'inventory.write') or app.has_permission(p_company, 'wms.write')) then
    raise exception 'Permission denied: wms.write required' using errcode = '42501';
  end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'Quantity must be more than zero' using errcode = '23514'; end if;
  select * into v_from from public.warehouses where id = p_from and company_id = p_company and deleted_at is null and is_active;
  select * into v_to from public.warehouses where id = p_to and company_id = p_company and deleted_at is null and is_active;
  if v_from.id is null or v_to.id is null then raise exception 'Unknown warehouse' using errcode = '23514'; end if;
  if v_from.id = v_to.id then raise exception 'Choose two different units' using errcode = '23514'; end if;
  select v.name into v_name from public.product_variants v where v.id = p_variant and v.company_id = p_company and v.deleted_at is null;
  if v_name is null then raise exception 'Item not found' using errcode = 'P0002'; end if;
  v_fl := app.main_location(v_from.id);
  v_tl := app.main_location(v_to.id);
  if v_fl is null then raise exception 'The unit % has no shelf for stock', v_from.name using errcode = '23514'; end if;
  if v_tl is null then raise exception 'The unit % has no shelf for stock', v_to.name using errcode = '23514'; end if;

  select t.id, t.number into v_tr, v_no from public.stock_transfers t
   where t.company_id = p_company and t.from_warehouse_id = v_from.id and t.to_warehouse_id = v_to.id
     and t.status = 'draft' and t.is_request and t.deleted_at is null
   order by t.created_at desc limit 1 for update;
  if v_tr is null then
    insert into public.stock_transfers (company_id, from_warehouse_id, to_warehouse_id, notes, is_request)
    values (p_company, v_from.id, v_to.id, nullif(btrim(coalesce(p_note, '')), ''), true) returning id, number into v_tr, v_no;
  else
    v_merged := true;
  end if;
  select l.id into v_line from public.stock_transfer_lines l where l.transfer_id = v_tr and l.variant_id = p_variant and l.lot_id is null limit 1;
  if v_line is null then
    insert into public.stock_transfer_lines (company_id, transfer_id, variant_id, from_location_id, to_location_id, quantity)
    values (p_company, v_tr, p_variant, v_fl, v_tl, p_qty);
  else
    update public.stock_transfer_lines set quantity = quantity + p_qty where id = v_line;
  end if;

  -- the people of the sending unit hear about it (or, if nobody works only there, the stock managers)
  with who as (
    select distinct m.user_id from public.company_members m
     where m.company_id = p_company and m.status = 'active' and m.deleted_at is null and m.user_id is distinct from auth.uid()
       and v_from.id = any (m.warehouse_ids)
       and (app.has_permission_of(m.user_id, p_company, 'inventory.write') or app.has_permission_of(m.user_id, p_company, 'wms.write')))
  select count(*) into v_told from who;
  insert into public.notifications (company_id, user_id, type, title, body, link, entity_type, entity_id)
  select distinct p_company, m.user_id, 'transfer_request', format('Stock request from %s', v_to.name),
         format('%s × %s', trim_scale(p_qty), v_name), '/inventory/transfers/' || v_tr, 'stock_transfers', v_tr
    from public.company_members m
   where m.company_id = p_company and m.status = 'active' and m.deleted_at is null and m.user_id is distinct from auth.uid()
     and (case when v_told > 0 then v_from.id = any (m.warehouse_ids) else m.warehouse_ids is null end)
     and (app.has_permission_of(m.user_id, p_company, 'inventory.write') or (v_told > 0 and app.has_permission_of(m.user_id, p_company, 'wms.write')));

  return jsonb_build_object('id', v_tr, 'number', v_no, 'merged', v_merged);
end $$;

-- transfer requests sit with the other stock notifications
select app._patch_function('app.notification_category',
  $x$when p_entity in ('stock_alerts','lots','replenishment_runs','product_variants','purchase_orders') then 'stock'$x$,
  $x$when p_entity in ('stock_alerts','lots','replenishment_runs','product_variants','purchase_orders','stock_transfers') then 'stock'$x$);

-- -----------------------------------------------------------------------------
-- 3. Replenishment: before buying, move what another unit can spare (setting, on by default)
-- -----------------------------------------------------------------------------
select app._patch_function('app.replenish_core',
  $x$declare r record; v_need numeric; v_vendor uuid; v_moq numeric; v_n int := 0; v_free numeric; v_qty numeric;$x$,
  $x$declare r record; v_need numeric; v_vendor uuid; v_moq numeric; v_n int := 0; v_free numeric; v_qty numeric; v_src uuid;$x$);
select app._patch_function('app.replenish_core',
  $x$    v_vendor := null;
    if r.replenish_method = 'buy' then$x$,
  $x$    v_vendor := null;
    -- another unit has more than it needs: that goes first, the rest is bought
    if r.replenish_method = 'buy' and coalesce((select cs.replenish_from_units from public.company_settings cs where cs.company_id = p_company), true) then
      v_src := null; v_qty := 0;
      select x.id, x.spare into v_src, v_qty from (
        select u.id, u.type, app.unit_spare(u.type, u.has_rule, u.available - u.outgoing, u.min_qty, true)
               - coalesce((select sum(s2.suggested_qty) from public.replenishment_suggestions s2
                            where s2.company_id = p_company and s2.status = 'open' and s2.source_warehouse_id = u.id and s2.variant_id = r.variant_id), 0) as spare
          from app.item_units(p_company, r.variant_id) u where u.id <> r.warehouse_id) x
       where x.spare > 0 order by x.spare desc, x.type = 'warehouse' desc limit 1;
      v_qty := floor(least(coalesce(v_qty, 0), v_need) / r.multiple_qty) * r.multiple_qty;
      if v_src is not null and v_qty > 0 then
        insert into public.replenishment_suggestions (company_id, rule_id, variant_id, warehouse_id, replenish_method, vendor_id, source_warehouse_id,
                                                      on_hand, reserved, demand, incoming, projected, suggested_qty)
        values (p_company, r.id, r.variant_id, r.warehouse_id, 'transfer', null, v_src,
                r.on_hand, r.reserved, r.demand, r.incoming, r.on_hand - r.reserved - r.demand + r.incoming, v_qty);
        v_n := v_n + 1;
        v_need := v_need - v_qty;
        continue when v_need <= 0;
      end if;
    end if;
    if r.replenish_method = 'buy' then$x$);

drop function if exists public.set_replenishment_automation(uuid, boolean, text, int);
create or replace function public.set_replenishment_automation(p_company uuid, p_enabled boolean default null, p_action text default null, p_hour int default null,
                                                               p_from_units boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.company_settings;
begin
  perform app.require_permission(p_company, 'procurement.write');
  if p_action is not null and p_action not in ('suggest','draft_po','submit_po') then raise exception 'Unknown action %', p_action using errcode = '22023'; end if;
  if p_hour is not null and p_hour not between 0 and 23 then raise exception 'Choose an hour from 0 to 23' using errcode = '22023'; end if;
  update public.company_settings set auto_replenish_enabled = coalesce(p_enabled, auto_replenish_enabled),
         auto_replenish_action = coalesce(p_action, auto_replenish_action), auto_replenish_hour = coalesce(p_hour, auto_replenish_hour),
         replenish_from_units = coalesce(p_from_units, replenish_from_units)
   where company_id = p_company returning * into s;
  return jsonb_build_object('enabled', s.auto_replenish_enabled, 'action', s.auto_replenish_action, 'hour', s.auto_replenish_hour,
                            'from_units', s.replenish_from_units);
end $$;

revoke execute on function app.unit_spare(text, boolean, numeric, numeric, boolean), app.item_units(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.item_where(uuid, text, uuid, uuid), public.item_request(uuid, uuid, uuid, uuid, numeric, text),
  public.set_replenishment_automation(uuid, boolean, text, int, boolean) from public, anon;
grant execute on function public.item_where(uuid, text, uuid, uuid), public.item_request(uuid, uuid, uuid, uuid, numeric, text),
  public.set_replenishment_automation(uuid, boolean, text, int, boolean) to authenticated;

drop function app._patch_function(text, text, text);
