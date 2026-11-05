-- =============================================================================
-- From the meeting with the administrative staff, #22: balancing the stock between the units.
-- For each item: how many days each unit's stock lasts at its own sales of the last days; where a
-- unit runs short and another holds more than it needs, a transfer is proposed. The person picks
-- the lines and the quantities; a draft transfer "unit → unit" is made for each pair.
-- =============================================================================

-- p: days (the sales looked at, default 30), cover (days of stock wanted, default 14), units[], groups[]
-- returns {rows:[{variant_id, sku, name, uom, group, from_id, from, from_on_hand, from_daily, from_days,
--                 to_id, to, to_on_hand, to_daily, to_days, quantity}], days, cover}
create or replace function public.stock_balance(p_company uuid, p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_days int := least(greatest(coalesce((p ->> 'days')::int, 30), 7), 180);
  v_cover numeric := least(greatest(coalesce((p ->> 'cover')::numeric, 14), 1), 90);
  v_units uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'units', '[]'))::uuid);
  v_groups uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'groups', '[]'))::uuid);
  v_today date := (now() at time zone coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane'))::date;
  v_rows jsonb := '[]'::jsonb; it record; d record; s record; v_need numeric; v_take numeric; v_whole boolean;
begin
  if not (app.has_permission(p_company, 'inventory.read')) then raise exception 'Permission denied' using errcode = '42501'; end if;

  create temp table if not exists _bal (variant_id uuid, warehouse_id uuid, on_hand numeric, daily numeric, need numeric, extra numeric) on commit drop;
  truncate _bal;
  with wh as (
    select w.id from public.warehouses w
     where w.company_id = p_company and w.deleted_at is null and w.is_active and app.main_location(w.id) is not null
       and (cardinality(v_units) = 0 or w.id = any (v_units))),
  st as (
    select sl.variant_id, sl.warehouse_id, sum(sl.on_hand - coalesce(sl.reserved, 0)) as on_hand
      from public.stock_levels sl join wh on wh.id = sl.warehouse_id
     where sl.company_id = p_company group by 1, 2),
  sa as (
    select f.variant_id, f.warehouse_id, sum(f.qty) / v_days as daily
      from app.analysis_sales(p_company, v_today - v_days + 1, v_today) f join wh on wh.id = f.warehouse_id
     group by 1, 2 having sum(f.qty) > 0),
  x as (
    select coalesce(st.variant_id, sa.variant_id) as variant_id, coalesce(st.warehouse_id, sa.warehouse_id) as warehouse_id,
           greatest(coalesce(st.on_hand, 0), 0) as on_hand, coalesce(sa.daily, 0) as daily
      from st full join sa on sa.variant_id = st.variant_id and sa.warehouse_id = st.warehouse_id)
  insert into _bal
  select x.variant_id, x.warehouse_id, x.on_hand, x.daily,
         greatest(v_cover * x.daily - x.on_hand, 0),
         -- a unit that does not sell the item keeps none of it for itself; one that does keeps its cover
         greatest(x.on_hand - v_cover * x.daily, 0)
    from x join public.product_variants v on v.id = x.variant_id and v.is_active and v.deleted_at is null
    join public.products pr on pr.id = v.product_id and pr.product_type = 'stockable'
    left join public.product_categories c on c.id = pr.category_id
   where cardinality(v_groups) = 0 or c.id = any (v_groups) or c.parent_id = any (v_groups);

  -- the items where one unit is short and another has more than it needs
  for it in select b.variant_id from _bal b group by b.variant_id having sum(b.need) > 0 and sum(b.extra) > 0 loop
    select pr.uom_id is not null and lower(coalesce(u.code, '')) not in ('kg', 'kgm', 'l', 'ltr', 'm') into v_whole
      from public.product_variants v join public.products pr on pr.id = v.product_id left join public.units_of_measure u on u.id = pr.uom_id where v.id = it.variant_id;
    for d in select * from _bal where variant_id = it.variant_id and need > 0 order by need desc loop
      v_need := d.need;
      for s in select * from _bal where variant_id = it.variant_id and extra > 0 and warehouse_id <> d.warehouse_id order by extra desc loop
        exit when v_need <= 0;
        v_take := least(v_need, s.extra);
        v_take := case when v_whole then floor(v_take) else round(v_take, 3) end;
        continue when v_take <= 0;
        update _bal set extra = extra - v_take where variant_id = s.variant_id and warehouse_id = s.warehouse_id;
        v_need := v_need - v_take;
        v_rows := v_rows || jsonb_build_object(
          'variant_id', it.variant_id, 'quantity', v_take,
          'from_id', s.warehouse_id, 'from_on_hand', round(s.on_hand, 3), 'from_daily', round(s.daily, 3),
          'from_days', case when s.daily > 0 then round(s.on_hand / s.daily, 1) end,
          'to_id', d.warehouse_id, 'to_on_hand', round(d.on_hand, 3), 'to_daily', round(d.daily, 3),
          'to_days', case when d.daily > 0 then round(d.on_hand / d.daily, 1) end);
      end loop;
    end loop;
  end loop;

  return jsonb_build_object('days', v_days, 'cover', v_cover, 'rows', coalesce((
    select jsonb_agg(r || jsonb_build_object('sku', v.sku, 'name', v.name, 'uom', u.code, 'group', coalesce(pc.name, c.name),
                                             'from', wf.name, 'to', wt.name)
                     order by wt.name, coalesce(pc.name, c.name), v.name)
      from jsonb_array_elements(v_rows) r
      join public.product_variants v on v.id = (r ->> 'variant_id')::uuid
      join public.products pr on pr.id = v.product_id
      left join public.units_of_measure u on u.id = pr.uom_id
      left join public.product_categories c on c.id = pr.category_id
      left join public.product_categories pc on pc.id = c.parent_id
      join public.warehouses wf on wf.id = (r ->> 'from_id')::uuid
      join public.warehouses wt on wt.id = (r ->> 'to_id')::uuid), '[]'::jsonb));
end $$;
-- the work table above: the function cannot be stable
alter function public.stock_balance(uuid, jsonb) volatile;
revoke execute on function public.stock_balance(uuid, jsonb) from public, anon;
grant execute on function public.stock_balance(uuid, jsonb) to authenticated;

-- the lines chosen become draft transfers, one for each pair of units
-- p: note, lines: [{variant_id, from_id, to_id, quantity}]
create or replace function public.stock_balance_create(p_company uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare pr record; l jsonb; v_tr uuid; v_out jsonb := '[]'::jsonb; v_fl uuid; v_tl uuid; v_n int;
begin
  if not (app.has_permission(p_company, 'inventory.write') or app.has_permission(p_company, 'wms.write')) then
    raise exception 'Permission denied: wms.write required' using errcode = '42501';
  end if;
  if jsonb_typeof(p -> 'lines') <> 'array' or jsonb_array_length(p -> 'lines') = 0 then raise exception 'Choose the lines to move' using errcode = '23514'; end if;
  for pr in select distinct (x ->> 'from_id')::uuid as f, (x ->> 'to_id')::uuid as t from jsonb_array_elements(p -> 'lines') x loop
    if pr.f = pr.t then raise exception 'Choose two different units' using errcode = '23514'; end if;
    if not exists (select 1 from public.warehouses where id = pr.f and company_id = p_company and deleted_at is null)
       or not exists (select 1 from public.warehouses where id = pr.t and company_id = p_company and deleted_at is null) then
      raise exception 'Unknown warehouse' using errcode = '23514';
    end if;
    v_fl := app.main_location(pr.f); v_tl := app.main_location(pr.t);
    if v_fl is null or v_tl is null then raise exception 'The unit % has no shelf for stock', (select name from public.warehouses where id = coalesce(case when v_fl is null then pr.f end, pr.t)) using errcode = '23514'; end if;
    insert into public.stock_transfers (company_id, from_warehouse_id, to_warehouse_id, notes)
    values (p_company, pr.f, pr.t, coalesce(nullif(btrim(p ->> 'note'), ''), 'Balancimi i stokut')) returning id into v_tr;
    v_n := 0;
    for l in select * from jsonb_array_elements(p -> 'lines') x where (x ->> 'from_id')::uuid = pr.f and (x ->> 'to_id')::uuid = pr.t loop
      if coalesce((l ->> 'quantity')::numeric, 0) <= 0 then continue; end if;
      if not exists (select 1 from public.product_variants where id = (l ->> 'variant_id')::uuid and company_id = p_company) then
        raise exception 'Item not found' using errcode = 'P0002';
      end if;
      insert into public.stock_transfer_lines (company_id, transfer_id, variant_id, from_location_id, to_location_id, quantity)
      values (p_company, v_tr, (l ->> 'variant_id')::uuid, v_fl, v_tl, (l ->> 'quantity')::numeric);
      v_n := v_n + 1;
    end loop;
    if v_n = 0 then delete from public.stock_transfers where id = v_tr; continue; end if;
    v_out := v_out || jsonb_build_object('id', v_tr, 'number', (select number from public.stock_transfers where id = v_tr),
                                         'from', (select name from public.warehouses where id = pr.f), 'to', (select name from public.warehouses where id = pr.t), 'lines', v_n);
  end loop;
  return v_out;
end $$;
revoke execute on function public.stock_balance_create(uuid, jsonb) from public, anon;
grant execute on function public.stock_balance_create(uuid, jsonb) to authenticated;
