-- =============================================================================
-- What a unit is: a market, a shop, a restaurant, a café, a bakery, a hotel, a pharmacy, a wholesale
-- store, a warehouse, a kitchen... (warehouses.unit_category). The stock side stays as it was
-- (warehouse_type: store, warehouse, production); the category says what the unit does, picks its tills
-- (restaurant tills for a restaurant, café or fast food) and is shown wherever the unit is.
--
-- The platform's super administrator sees a client's units and adds or changes them, for any client.
-- =============================================================================

alter table public.warehouses add column if not exists unit_category text
  check (unit_category is null or unit_category in ('market', 'shop', 'restaurant', 'cafe', 'fast_food', 'bakery', 'hotel', 'pharmacy',
                                                    'wholesale', 'warehouse', 'production', 'services', 'other'));
grant select (unit_category) on public.warehouses to authenticated;

-- the units there already: from their tills and the company's kind of business
update public.warehouses w set unit_category = case
    when w.warehouse_type = 'warehouse' then 'warehouse'
    when w.warehouse_type = 'production' then 'production'
    when exists (select 1 from public.pos_registers r where r.warehouse_id = w.id and r.mode = 'restaurant' and r.deleted_at is null)
      then case when c.business_type = 'cafe' then 'cafe' else 'restaurant' end
    when c.business_type = 'wholesale' then 'wholesale'
    when c.business_type = 'hotel' then 'hotel'
    when c.business_type = 'services' then 'services'
    when c.business_type in ('retail', 'general') then 'market'
    else 'shop' end
  from public.companies c
 where c.id = w.company_id and w.unit_category is null and w.warehouse_type <> 'transit';

create or replace function app.unit_category_type(p_category text)
returns text language sql immutable set search_path = '' as $$
  select case p_category when 'warehouse' then 'warehouse' when 'production' then 'production' else 'store' end
$$;
create or replace function app.unit_category_mode(p_category text)
returns text language sql immutable set search_path = '' as $$
  select case when p_category in ('restaurant', 'cafe', 'fast_food') then 'restaurant' else 'retail' end
$$;

-- ----------------------------------------------------------------------------- making a unit, one way
-- p: company_id, category (or the older kind: store, restaurant, warehouse, production), name, code, city,
-- address, atk_branch_id, tills, supplied_from_id, price_list_id
create or replace function app.unit_create_core(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_co uuid := (p ->> 'company_id')::uuid; v_code text := upper(btrim(coalesce(p ->> 'code', '')));
  v_cat text := nullif(p ->> 'category', ''); v_kind text := coalesce(nullif(p ->> 'kind', ''), 'store');
  v_tills int := least(greatest(coalesce((p ->> 'tills')::int, 0), 0), 20);
  v_unit uuid; v_loc uuid; v_cash uuid; v_journal uuid; v_from uuid := nullif(p ->> 'supplied_from_id', '')::uuid; i int; v_regs jsonb := '[]';
  v_type text; v_mode text;
begin
  if nullif(btrim(p ->> 'name'), '') is null then raise exception 'Write the name of the unit' using errcode = '23514'; end if;
  if v_code = '' then raise exception 'Write a short code for the unit' using errcode = '23514'; end if;
  if v_cat is null then
    if v_kind not in ('store', 'restaurant', 'warehouse', 'production') then raise exception 'Unknown kind of unit: %', v_kind using errcode = '23514'; end if;
    v_cat := case v_kind when 'store' then 'market' else v_kind end;
  end if;
  if v_cat not in ('market', 'shop', 'restaurant', 'cafe', 'fast_food', 'bakery', 'hotel', 'pharmacy', 'wholesale', 'warehouse', 'production', 'services', 'other') then
    raise exception 'Unknown kind of unit: %', v_cat using errcode = '23514';
  end if;
  v_type := app.unit_category_type(v_cat);
  v_mode := app.unit_category_mode(v_cat);
  if v_type in ('warehouse', 'production') then v_tills := 0; end if;
  if exists (select 1 from public.warehouses where company_id = v_co and upper(code) = v_code and deleted_at is null) then
    raise exception 'The code % is used by another unit of this company', v_code using errcode = '23505';
  end if;
  if v_from is not null and not exists (select 1 from public.warehouses where id = v_from and company_id = v_co and deleted_at is null) then
    raise exception 'The supplying unit is not of this company' using errcode = '23514';
  end if;

  insert into public.warehouses (company_id, code, name, warehouse_type, unit_category, city, address_line1, country_code, atk_branch_id, supplied_from_id)
  select v_co, v_code, btrim(p ->> 'name'), v_type, v_cat, nullif(btrim(p ->> 'city'), ''), nullif(btrim(p ->> 'address'), ''), c.country_code,
         nullif(p ->> 'atk_branch_id', '')::int, v_from
    from public.companies c where c.id = v_co
  returning id into v_unit;
  perform app.unit_locations(v_co, v_unit, v_code);
  select id into v_loc from public.warehouse_locations where warehouse_id = v_unit and location_type = 'internal' order by code limit 1;

  if v_tills > 0 then
    -- the tills put their cash where the other tills of the company do (else the first cash box)
    select r.cash_account_id into v_cash from public.pos_registers r where r.company_id = v_co and r.deleted_at is null
     group by r.cash_account_id order by count(*) desc limit 1;
    v_cash := coalesce(v_cash, (select id from public.bank_accounts where company_id = v_co and account_kind = 'cash' and is_active and deleted_at is null order by created_at limit 1));
    if v_cash is null then raise exception 'Add a cash account first (Finance → Bank and cash)' using errcode = '23514'; end if;
    select id into v_journal from public.journals where company_id = v_co and code = 'POS';
    for i in 1 .. v_tills loop
      insert into public.pos_registers (company_id, code, name, warehouse_id, location_id, cash_account_id, journal_id, mode, price_list_id)
      values (v_co, v_code || '-' || i, 'Arka ' || i || ' – ' || btrim(p ->> 'name'), v_unit, v_loc, v_cash, v_journal, v_mode,
              nullif(p ->> 'price_list_id', '')::uuid);
      v_regs := v_regs || jsonb_build_array(v_code || '-' || i);
    end loop;
  end if;
  return jsonb_build_object('id', v_unit, 'tills', v_regs, 'category', v_cat);
end $$;
revoke execute on function app.unit_create_core(jsonb) from public, anon, authenticated;

-- the company's own "New unit": its own rights
create or replace function public.unit_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_co uuid := (p ->> 'company_id')::uuid;
begin
  perform app.require_permission(v_co, 'inventory.write');
  if coalesce((p ->> 'tills')::int, 0) > 0 then perform app.require_permission(v_co, 'pos.write'); end if;
  return app.unit_create_core(p);
end $$;
revoke execute on function public.unit_create(jsonb) from public, anon;
grant execute on function public.unit_create(jsonb) to authenticated;

-- ----------------------------------------------------------------------------- a unit changed, one way
-- p: name, code, category, city, address, atk_branch_id, atk_unit_no, supplied_from_id, is_active
-- A new category changes the tills' kind (shop ↔ restaurant) for the tills not open now.
create or replace function app.unit_update_core(p_unit uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w public.warehouses; v_cat text; v_code text; v_type text; v_mode text; v_changed int := 0; v_open int := 0;
begin
  select * into w from public.warehouses where id = p_unit and deleted_at is null for update;
  if w.id is null then raise exception 'This unit does not exist' using errcode = 'P0002'; end if;
  if w.warehouse_type = 'transit' then raise exception 'The goods on the way are not a unit to change' using errcode = '23514'; end if;
  v_cat := coalesce(nullif(p ->> 'category', ''), w.unit_category);
  if v_cat not in ('market', 'shop', 'restaurant', 'cafe', 'fast_food', 'bakery', 'hotel', 'pharmacy', 'wholesale', 'warehouse', 'production', 'services', 'other') then
    raise exception 'Unknown kind of unit: %', v_cat using errcode = '23514';
  end if;
  v_type := app.unit_category_type(v_cat);
  if v_type <> w.warehouse_type then
    -- a unit with tills stays a selling unit; one with stock does not become a kitchen or a warehouse by a click
    if v_type <> 'store' and exists (select 1 from public.pos_registers r where r.warehouse_id = w.id and r.deleted_at is null and r.is_active) then
      raise exception 'This unit has tills: a unit with tills cannot become a warehouse or a kitchen' using errcode = '23514';
    end if;
  end if;
  v_code := upper(btrim(coalesce(nullif(p ->> 'code', ''), w.code)));
  if v_code <> upper(w.code) and exists (select 1 from public.warehouses where company_id = w.company_id and upper(code) = v_code and deleted_at is null and id <> w.id) then
    raise exception 'The code % is used by another unit of this company', v_code using errcode = '23505';
  end if;
  if nullif(p ->> 'supplied_from_id', '') is not null and ((p ->> 'supplied_from_id')::uuid = w.id
     or not exists (select 1 from public.warehouses where id = (p ->> 'supplied_from_id')::uuid and company_id = w.company_id and deleted_at is null)) then
    raise exception 'The supplying unit is not of this company' using errcode = '23514';
  end if;

  update public.warehouses set
    name = coalesce(nullif(btrim(p ->> 'name'), ''), name),
    code = v_code,
    unit_category = v_cat,
    warehouse_type = v_type,
    city = case when p ? 'city' then nullif(btrim(p ->> 'city'), '') else city end,
    address_line1 = case when p ? 'address' then nullif(btrim(p ->> 'address'), '') else address_line1 end,
    atk_branch_id = case when p ? 'atk_branch_id' then nullif(p ->> 'atk_branch_id', '')::smallint else atk_branch_id end,
    atk_unit_no = case when p ? 'atk_unit_no' then nullif(btrim(p ->> 'atk_unit_no'), '') else atk_unit_no end,
    supplied_from_id = case when p ? 'supplied_from_id' then nullif(p ->> 'supplied_from_id', '')::uuid else supplied_from_id end,
    is_active = coalesce((p ->> 'is_active')::boolean, is_active)
   where id = w.id;

  v_mode := app.unit_category_mode(v_cat);
  select count(*) into v_open from public.pos_registers r
   where r.warehouse_id = w.id and r.deleted_at is null and r.mode <> v_mode
     and exists (select 1 from public.pos_sessions s where s.register_id = r.id and s.status = 'open');
  update public.pos_registers r set mode = v_mode
   where r.warehouse_id = w.id and r.deleted_at is null and r.mode <> v_mode
     and not exists (select 1 from public.pos_sessions s where s.register_id = r.id and s.status = 'open');
  get diagnostics v_changed = row_count;
  return jsonb_build_object('id', w.id, 'category', v_cat, 'tills_changed', v_changed, 'tills_open', v_open);
end $$;
revoke execute on function app.unit_update_core(uuid, jsonb) from public, anon, authenticated;

create or replace function public.unit_update(p_unit uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_permission((select company_id from public.warehouses where id = p_unit), 'inventory.write');
  return app.unit_update_core(p_unit, p);
end $$;
revoke execute on function public.unit_update(uuid, jsonb) from public, anon;
grant execute on function public.unit_update(uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------------------- the platform: a client's units
create or replace function public.platform_client_units(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  return jsonb_build_object(
    'limit', (select coalesce(l.max_warehouses, app.plan_max_warehouses(l.plan)) from public.licenses l where l.company_id = p_company),
    'restaurant', app.has_feature(p_company, 'restaurant'),
    'units', coalesce((select jsonb_agg(jsonb_build_object(
        'id', w.id, 'code', w.code, 'name', w.name, 'category', w.unit_category, 'type', w.warehouse_type, 'city', w.city,
        'address', w.address_line1, 'atk_branch_id', w.atk_branch_id, 'atk_unit_no', w.atk_unit_no, 'is_active', w.is_active,
        'supplied_from_id', w.supplied_from_id,
        'tills', (select count(*) from public.pos_registers r where r.warehouse_id = w.id and r.deleted_at is null and r.is_active),
        'restaurant_tills', (select count(*) from public.pos_registers r where r.warehouse_id = w.id and r.deleted_at is null and r.is_active and r.mode = 'restaurant'))
      order by w.is_active desc, w.code)
      from public.warehouses w where w.company_id = p_company and w.deleted_at is null and w.warehouse_type <> 'transit'), '[]'));
end $$;
revoke execute on function public.platform_client_units(uuid) from public, anon;
grant execute on function public.platform_client_units(uuid) to authenticated;

-- p as for unit_create, and add_restaurant: also give the licence the restaurant module
create or replace function public.platform_unit_create(p_company uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  perform app.require_super_admin();
  if not exists (select 1 from public.companies where id = p_company and deleted_at is null) then raise exception 'This client does not exist' using errcode = 'P0002'; end if;
  if coalesce((p ->> 'add_restaurant')::boolean, false) then
    update public.licenses set extra_features = array(select distinct unnest(extra_features || array['restaurant'])) where company_id = p_company;
  end if;
  r := app.unit_create_core(p || jsonb_build_object('company_id', p_company));
  perform app.platform_log('unit_created', p_company, jsonb_build_object('unit', p ->> 'name', 'code', upper(btrim(p ->> 'code')), 'category', r ->> 'category', 'tills', r -> 'tills'));
  return r;
end $$;
revoke execute on function public.platform_unit_create(uuid, jsonb) from public, anon;
grant execute on function public.platform_unit_create(uuid, jsonb) to authenticated;

create or replace function public.platform_unit_update(p_unit uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_co uuid := (select company_id from public.warehouses where id = p_unit); r jsonb;
begin
  perform app.require_super_admin();
  if v_co is null then raise exception 'This unit does not exist' using errcode = 'P0002'; end if;
  if coalesce((p ->> 'add_restaurant')::boolean, false) then
    update public.licenses set extra_features = array(select distinct unnest(extra_features || array['restaurant'])) where company_id = v_co;
  end if;
  r := app.unit_update_core(p_unit, p);
  perform app.platform_log('unit_changed', v_co, jsonb_build_object('unit', (select name from public.warehouses where id = p_unit)) || (p - 'add_restaurant'));
  return r;
end $$;
revoke execute on function public.platform_unit_update(uuid, jsonb) from public, anon;
grant execute on function public.platform_unit_update(uuid, jsonb) to authenticated;
