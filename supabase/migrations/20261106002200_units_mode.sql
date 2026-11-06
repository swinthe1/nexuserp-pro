-- =============================================================================
-- A client with one unit or with several. The Super Admin says it when creating the client:
--  · one unit (a shop, a restaurant): the company has one unit named after it; the program does not talk
--    about units at all (no unit to choose, no unit column), and a second unit cannot be added by mistake
--  · several units (LIDER MARKET: five markets, three restaurants, a central warehouse): the units are
--    entered with the client (name, kind, town), the licence allows them, and the program shows the unit
--    everywhere it matters (the unit chosen under the company, the unit of each document and stock line)
-- company_settings.multi_unit: false = one unit, true = several, null = not said (companies made before:
-- they behave by how many units they have).
-- =============================================================================

alter table public.company_settings add column if not exists multi_unit boolean;

-- one unit: a second one is not added by mistake (the Super Admin switches the client to several units)
create or replace function app.tg_single_unit()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.warehouse_type = 'transit' or not new.is_active or new.deleted_at is not null then return new; end if;
  if coalesce((select multi_unit from public.company_settings where company_id = new.company_id), true) then return new; end if;
  if exists (select 1 from public.warehouses w where w.company_id = new.company_id and w.id <> new.id and w.deleted_at is null and w.is_active
               and w.warehouse_type <> 'transit') then
    raise exception 'This client works with one unit. The Super Admin can switch it to several units' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_04b_single_unit on public.warehouses;
create trigger trg_04b_single_unit before insert or update of is_active, deleted_at, warehouse_type on public.warehouses
  for each row execute function app.tg_single_unit();

-- the standard places of a unit (as for the first one)
create or replace function app.unit_locations(p_company uuid, p_unit uuid, p_code text)
returns void language sql security definer set search_path = '' as $$
  insert into public.warehouse_locations (company_id, warehouse_id, code, name, location_type, is_pickable)
  select p_company, p_unit, p_code || x.suffix, x.name, x.type, x.pick
    from (values ('/RECEIVING', 'Receiving', 'receiving', false), ('/STOCK', 'Stock', 'internal', true), ('/SHIPPING', 'Shipping', 'shipping', false)) x(suffix, name, type, pick)
   where not exists (select 1 from public.warehouse_locations l where l.company_id = p_company and l.code = p_code || x.suffix)
$$;
revoke execute on function app.unit_locations(uuid, uuid, text) from public, anon, authenticated;

-- the units of a new client: {multi_unit, units: [{name, kind: store|warehouse|production, city, code}]}
create or replace function app.client_units(p_company uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_main uuid; v_multi boolean := (p ->> 'multi_unit')::boolean; u jsonb; i int := 0;
  v_code text; v_kind text; v_id uuid; v_n int;
begin
  -- not said (an older caller): as before, the company decides by the units it adds
  if v_multi is null then return; end if;
  select default_warehouse_id into v_main from public.company_settings where company_id = p_company;
  update public.company_settings set multi_unit = v_multi where company_id = p_company;
  if not v_multi then
    -- the one unit carries the name of the business
    update public.warehouses set name = coalesce(nullif(btrim(p ->> 'name'), ''), name),
           warehouse_type = case when coalesce(p ->> 'unit_kind', 'store') in ('store', 'warehouse', 'production') then coalesce(p ->> 'unit_kind', 'store') else 'store' end
     where id = v_main;
    return;
  end if;
  v_n := coalesce(jsonb_array_length(p -> 'units'), 0);
  if v_n < 2 then raise exception 'A client with several units needs at least two of them' using errcode = '23514'; end if;
  -- the licence allows the units the client has
  update public.licenses set max_warehouses = greatest(coalesce(max_warehouses, app.plan_max_warehouses(plan), 0), v_n) where company_id = p_company;
  for u in select * from jsonb_array_elements(p -> 'units') loop
    i := i + 1;
    if nullif(btrim(u ->> 'name'), '') is null then raise exception 'Unit % has no name', i using errcode = '23514'; end if;
    v_kind := case when u ->> 'kind' in ('store', 'warehouse', 'production') then u ->> 'kind' else 'store' end;
    v_code := upper(coalesce(nullif(btrim(u ->> 'code'), ''), 'N' || i));
    if exists (select 1 from public.warehouses where company_id = p_company and code = v_code and id is distinct from case when i = 1 then v_main end) then
      raise exception 'The code % is used twice', v_code using errcode = '23505';
    end if;
    if i = 1 then
      update public.warehouses set name = btrim(u ->> 'name'), code = v_code, warehouse_type = v_kind, city = nullif(btrim(u ->> 'city'), '') where id = v_main;
      update public.warehouse_locations set code = v_code || substr(code, position('/' in code)) where warehouse_id = v_main and code like 'WH/%';
    else
      insert into public.warehouses (company_id, code, name, warehouse_type, city, country_code)
      select p_company, v_code, btrim(u ->> 'name'), v_kind, nullif(btrim(u ->> 'city'), ''), c.country_code from public.companies c where c.id = p_company
      returning id into v_id;
      perform app.unit_locations(p_company, v_id, v_code);
    end if;
  end loop;
end $$;
revoke execute on function app.client_units(uuid, jsonb) from public, anon, authenticated;

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;
select app._patch_function('public.platform_create_client',
  $x$  perform public.platform_set_business_type(v_company, coalesce(nullif(btrim(p ->> 'business_type'), ''), 'general'), true);
  return v_company;$x$,
  $x$  perform public.platform_set_business_type(v_company, coalesce(nullif(btrim(p ->> 'business_type'), ''), 'general'), true);
  perform app.client_units(v_company, p);
  return v_company;$x$);
-- the client list says how the client is set up and how many units it has
select app._patch_function('public.platform_clients',
  $x$'business_type', c.business_type,$x$,
  $x$'business_type', c.business_type,
               'multi_unit', (select cs.multi_unit from public.company_settings cs where cs.company_id = c.id),
               'units', (select count(*) from public.warehouses w where w.company_id = c.id and w.deleted_at is null and w.is_active and w.warehouse_type <> 'transit'),$x$);
-- a store limit above one, given by the Super Admin, means several units
select app._patch_function('public.platform_set_plan_extras',
  $x$  if not found then raise exception 'Company not found' using errcode = 'P0002'; end if;$x$,
  $x$  if not found then raise exception 'Company not found' using errcode = 'P0002'; end if;
  if p_max_warehouses > 1 then update public.company_settings set multi_unit = true where company_id = p_company and multi_unit = false; end if;$x$);
drop function app._patch_function(text, text, text);

-- the Super Admin switches a client between one unit and several
create or replace function public.platform_set_multi_unit(p_company uuid, p_multi boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  if not p_multi and (select count(*) from public.warehouses where company_id = p_company and deleted_at is null and is_active and warehouse_type <> 'transit') > 1 then
    raise exception 'The client has more than one active unit: deactivate the others first' using errcode = '23514';
  end if;
  update public.company_settings set multi_unit = p_multi where company_id = p_company;
end $$;
revoke execute on function public.platform_set_multi_unit(uuid, boolean) from public, anon;
grant execute on function public.platform_set_multi_unit(uuid, boolean) to authenticated;
