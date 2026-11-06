-- =============================================================================
-- #8, all automatic: the scales of the company and what each one holds.
--  · an item sold by the kilogram gets the next free PLU by itself, once the company has a scale
--  · each scale (unit, IP) knows the PLU, the name and the price it was last sent for every item;
--    scale_pending says what to send and what to take away, scale_synced records what was sent
--  · the DrisPRO program for Windows on a computer of the store does the sending (the scale is only
--    reachable inside the store), and reports back: the screen shows each scale in sync or its error
-- =============================================================================

create table if not exists public.scales (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id),
  warehouse_id  uuid references public.warehouses (id),
  name          text not null,
  ip            text not null check (ip ~ '^[0-9]{1,3}(\.[0-9]{1,3}){3}$'),
  port          int not null default 5001 check (port between 1 and 65535),
  model         text not null default 'rongta' check (model in ('rongta')),
  is_active     boolean not null default true,
  agent         text,              -- the computer that sends to it
  last_seen_at  timestamptz,       -- the computer asked what to send
  last_sync_at  timestamptz,       -- the scale took everything
  last_error    text
);
do $$ begin
  if not exists (select 1 from app.table_registry where table_name = 'scales') then
    perform app.register_table('public.scales', 'inventory');
  end if;
end $$;

create table if not exists public.scale_sync (
  company_id  uuid not null references public.companies (id),
  scale_id    uuid not null references public.scales (id) on delete cascade,
  product_id  uuid not null references public.products (id),
  plu         text not null,
  name        text not null,
  price       numeric(18,2) not null,
  synced_at   timestamptz not null default now(),
  primary key (scale_id, product_id)
);
alter table public.scale_sync add column if not exists id uuid not null default gen_random_uuid();
do $$ begin
  if not exists (select 1 from app.table_registry where table_name = 'scale_sync') then
    perform app.register_table('public.scale_sync', 'inventory', p_soft_delete => false, p_client_write => false, p_audit => false);
  end if;
end $$;

alter table public.company_settings add column if not exists scale_auto_plu boolean not null default true;

-- ---------------------------------------------------------------- the PLU by itself
create or replace function app.is_weighed_uom(p_uom uuid)
returns boolean language sql stable set search_path = '' as $$
  select coalesce((select lower(code) in ('kg', 'g', 'gr', 'kilogram') from public.units_of_measure where id = p_uom), false)
$$;

create or replace function app.next_scale_plu(p_company uuid)
returns text language sql stable set search_path = '' as $$
  select (coalesce(max(ltrim(scale_plu, '0')::bigint) filter (where ltrim(scale_plu, '0') <> ''), 0) + 1)::text
    from public.products where company_id = p_company and deleted_at is null and scale_plu is not null
$$;

create or replace function app.tg_auto_scale_plu()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.scale_plu is not null or new.deleted_at is not null then return new; end if;
  if tg_op = 'UPDATE' and new.uom_id is not distinct from old.uom_id then return new; end if;
  if not app.is_weighed_uom(new.uom_id) then return new; end if;
  if not exists (select 1 from public.scales where company_id = new.company_id and is_active and deleted_at is null) then return new; end if;
  if not coalesce((select scale_auto_plu from public.company_settings where company_id = new.company_id), true) then return new; end if;
  new.scale_plu := app.next_scale_plu(new.company_id);
  return new;
end $$;
drop trigger if exists trg_06_auto_scale_plu on public.products;
create trigger trg_06_auto_scale_plu before insert or update of uom_id on public.products
  for each row execute function app.tg_auto_scale_plu();

-- ---------------------------------------------------------------- the scales
create or replace function public.scales_list(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'inventory.read');
  return jsonb_build_object(
    'auto_plu', coalesce((select scale_auto_plu from public.company_settings where company_id = p_company), true),
    'next_plu', app.next_scale_plu(p_company),
    'scales', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'warehouse_id', s.warehouse_id, 'warehouse', w.name,
          'ip', s.ip, 'port', s.port, 'model', s.model, 'is_active', s.is_active, 'agent', s.agent,
          'last_seen_at', s.last_seen_at, 'last_sync_at', s.last_sync_at, 'last_error', s.last_error,
          'items', (select count(*) from public.scale_sync x where x.scale_id = s.id),
          'pending', (select jsonb_array_length(p -> 'upsert') + jsonb_array_length(p -> 'remove') from app.scale_pending_for(s.id) p))
        order by s.name)
      from public.scales s left join public.warehouses w on w.id = s.warehouse_id
     where s.company_id = p_company and s.deleted_at is null), '[]'::jsonb));
end $$;
revoke execute on function public.scales_list(uuid) from public, anon;
grant execute on function public.scales_list(uuid) to authenticated;

create or replace function public.scale_save(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_co uuid := (p ->> 'company_id')::uuid; v_id uuid := nullif(p ->> 'id', '')::uuid;
begin
  perform app.require_permission(v_co, 'inventory.write');
  if v_id is null then
    insert into public.scales (company_id, warehouse_id, name, ip, port, is_active)
    values (v_co, nullif(p ->> 'warehouse_id', '')::uuid, btrim(p ->> 'name'), btrim(p ->> 'ip'), coalesce((p ->> 'port')::int, 5001), coalesce((p ->> 'is_active')::boolean, true))
    returning id into v_id;
  else
    update public.scales set warehouse_id = nullif(p ->> 'warehouse_id', '')::uuid, name = btrim(p ->> 'name'), ip = btrim(p ->> 'ip'),
           port = coalesce((p ->> 'port')::int, port), is_active = coalesce((p ->> 'is_active')::boolean, is_active),
           last_error = case when ip is distinct from btrim(p ->> 'ip') then null else last_error end
     where id = v_id and company_id = v_co and deleted_at is null;
    if not found then raise exception 'Scale not found' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $$;
revoke execute on function public.scale_save(jsonb) from public, anon;
grant execute on function public.scale_save(jsonb) to authenticated;

create or replace function public.scale_settings_save(p_company uuid, p_auto_plu boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'inventory.write');
  update public.company_settings set scale_auto_plu = p_auto_plu where company_id = p_company;
end $$;
revoke execute on function public.scale_settings_save(uuid, boolean) from public, anon;
grant execute on function public.scale_settings_save(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------- what a scale should receive
-- upsert: items with a PLU whose PLU, name or price differ from what the scale was last sent;
-- remove: what the scale holds that is no longer so (the item lost its PLU, moved to another or was deleted)
create or replace function app.scale_pending_for(p_scale uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with s as (select * from public.scales where id = p_scale),
  items as (
    select p.id as product_id, nullif(ltrim(p.scale_plu, '0'), '') as plu,
           case when v.is_default or coalesce(v.name, '') = '' then p.name else v.name end as name,
           round(coalesce(v.sales_price_override, p.sales_price, 0) * (1 + coalesce(tc.rate, 0) / 100), 2) as price,
           lower(coalesce(u.code, '')) as uom
      from public.products p join s on s.company_id = p.company_id
      join lateral (select * from public.product_variants x where x.product_id = p.id and x.deleted_at is null
                     order by x.is_default desc, x.created_at limit 1) v on true
      left join public.units_of_measure u on u.id = p.uom_id
      left join public.tax_codes tc on tc.id = p.sales_tax_code_id
     where p.deleted_at is null and nullif(ltrim(p.scale_plu, '0'), '') is not null),
  sent as (select * from public.scale_sync where scale_id = p_scale)
  select jsonb_build_object(
    'upsert', coalesce((select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'plu', i.plu, 'name', i.name, 'price', i.price,
                                  'by_piece', i.uom not in ('kg', 'g', 'gr', 'kilogram')) order by i.plu::bigint)
                         from items i left join sent x on x.product_id = i.product_id
                        where i.price > 0 and (x.product_id is null or x.plu <> i.plu or x.name <> i.name or x.price <> i.price)), '[]'::jsonb),
    'remove', coalesce((select jsonb_agg(jsonb_build_object('product_id', x.product_id, 'plu', x.plu))
                         from sent x left join items i on i.product_id = x.product_id
                        where i.product_id is null or i.plu <> x.plu), '[]'::jsonb))
$$;
revoke execute on function app.scale_pending_for(uuid) from public, anon, authenticated;

-- the computer of the store asks: what to send to this scale
create or replace function public.scale_pending(p_scale uuid, p_agent text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.scales;
begin
  select * into s from public.scales where id = p_scale and deleted_at is null;
  if s.id is null then raise exception 'Scale not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'inventory.read');
  update public.scales set last_seen_at = now(), agent = coalesce(nullif(btrim(p_agent), ''), agent) where id = s.id;
  return jsonb_build_object('scale', jsonb_build_object('id', s.id, 'name', s.name, 'ip', s.ip, 'port', s.port, 'model', s.model, 'is_active', s.is_active))
         || app.scale_pending_for(s.id);
end $$;
revoke execute on function public.scale_pending(uuid, text) from public, anon;
grant execute on function public.scale_pending(uuid, text) to authenticated;

-- … and tells what the scale took: {sent: [{product_id, plu, name, price}], removed: [product_id], error}
create or replace function public.scale_synced(p_scale uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.scales;
begin
  select * into s from public.scales where id = p_scale and deleted_at is null;
  if s.id is null then raise exception 'Scale not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'inventory.read');
  delete from public.scale_sync where scale_id = s.id
     and product_id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(p -> 'removed', '[]'::jsonb)) x);
  insert into public.scale_sync (company_id, scale_id, product_id, plu, name, price)
  select s.company_id, s.id, (x ->> 'product_id')::uuid, x ->> 'plu', x ->> 'name', (x ->> 'price')::numeric
    from jsonb_array_elements(coalesce(p -> 'sent', '[]'::jsonb)) x
    join public.products pr on pr.id = (x ->> 'product_id')::uuid and pr.company_id = s.company_id
  on conflict (scale_id, product_id) do update set plu = excluded.plu, name = excluded.name, price = excluded.price, synced_at = now();
  update public.scales set last_seen_at = now(),
         last_error = nullif(left(btrim(coalesce(p ->> 'error', '')), 500), ''),
         last_sync_at = case when nullif(btrim(coalesce(p ->> 'error', '')), '') is null then now() else last_sync_at end
   where id = s.id;
end $$;
revoke execute on function public.scale_synced(uuid, jsonb) from public, anon;
grant execute on function public.scale_synced(uuid, jsonb) to authenticated;
