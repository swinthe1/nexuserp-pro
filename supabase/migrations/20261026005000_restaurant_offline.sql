-- =============================================================================
-- NexusERP Pro · the restaurant without internet
--   A waiter's device keeps working when the connection drops: tables are opened, items added,
--   sent and paid on the device, and each step is sent later, in order. For that the server:
--   * takes the id the device made up for a new order and for each new item, so a step sent twice
--     does nothing the second time;
--   * remembers, when the device opened a table someone else had opened meanwhile, that the
--     device's order is that one (an alias), so all later steps land on the right bill;
--   * accepts a payment again without doing it twice (client_uuid), with the time it happened;
--   * gives all open orders of a till in one call, so the device has them before the cut.
-- =============================================================================

create table public.table_order_aliases (
  id              uuid primary key,          -- the id the device used
  company_id      uuid not null references public.companies(id),
  table_order_id  uuid not null references public.table_orders(id) on delete cascade,
  created_at      timestamptz not null default now()
);
select app.register_table('public.table_order_aliases', 'pos', p_soft_delete => false, p_client_write => false, p_audit => false);

create or replace function app.tab_id(p_tab uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce((select a.table_order_id from public.table_order_aliases a where a.id = p_tab), p_tab)
$$;

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- every step on an order finds it by the device's id too
select app._patch_function('app.tab_for_update',
  $x$select * into o from public.table_orders where id = p_tab for update;$x$,
  $x$select * into o from public.table_orders where id = app.tab_id(p_tab) for update;$x$);
select app._patch_function('public.restaurant_tab',
  $x$select * into o from public.table_orders where id = p_tab;$x$,
  $x$select * into o from public.table_orders where id = app.tab_id(p_tab);$x$);

-- a line removed already, or cancelled already, is fine when the step comes again
select app._patch_function('public.restaurant_change_line',
  $x$if l.id is null then raise exception 'Line not found' using errcode = 'P0002'; end if;$x$,
  $x$if l.id is null then
    if coalesce(p_quantity, 0) <= 0 then return; end if;
    raise exception 'Line not found' using errcode = 'P0002';
  end if;$x$);
select app._patch_function('public.restaurant_void',
  $x$if l.id is null then raise exception 'Line not found' using errcode = 'P0002'; end if;$x$,
  $x$if l.id is null then raise exception 'Line not found' using errcode = 'P0002'; end if;
  if l.status = 'void' then return; end if;$x$);
-- freeing a table that is closed already
select app._patch_function('public.restaurant_close_empty',
  $x$  o := app.tab_for_update(p_tab);$x$,
  $x$  if exists (select 1 from public.table_orders where id = app.tab_id(p_tab) and status <> 'open') then return; end if;
  o := app.tab_for_update(p_tab);$x$);

-- new items may carry their own id (made on the device)
select app._patch_function('public.restaurant_add',
  $x$    insert into public.table_order_lines (company_id, table_order_id, variant_id, name, quantity, unit_price, note, station_id)
    select o.company_id, o.id, v.id, v.name, (x ->> 'quantity')::numeric, v_price, nullif(btrim(x ->> 'note'), ''),
           app.restaurant_station(o.company_id, o.warehouse_id, v.id)
      from public.product_variants v where v.id = (x ->> 'variant_id')::uuid and v.company_id = o.company_id;$x$,
  $x$    if nullif(x ->> 'id', '') is not null and exists (select 1 from public.table_order_lines where id = (x ->> 'id')::uuid) then continue; end if;
    insert into public.table_order_lines (id, company_id, table_order_id, variant_id, name, quantity, unit_price, note, station_id)
    select coalesce(nullif(x ->> 'id', '')::uuid, gen_random_uuid()), o.company_id, o.id, v.id, v.name, (x ->> 'quantity')::numeric, v_price, nullif(btrim(x ->> 'note'), ''),
           app.restaurant_station(o.company_id, o.warehouse_id, v.id)
      from public.product_variants v where v.id = (x ->> 'variant_id')::uuid and v.company_id = o.company_id;$x$);

-- paying again (the answer was lost on the way): the receipt that was made already
select app._patch_function('public.restaurant_pay',
  $x$begin
  o := app.tab_for_update((p ->> 'tab_id')::uuid);$x$,
  $x$begin
  if nullif(p ->> 'client_uuid', '') is not null then
    select jsonb_build_object('id', po.id, 'number', po.number, 'total', po.total, 'change', 0, 'replayed', true,
                              'closed', not exists (select 1 from public.table_orders t2 where t2.id = app.tab_id((p ->> 'tab_id')::uuid) and t2.status = 'open'))
      into v_res from public.pos_orders po where po.client_uuid = (p ->> 'client_uuid')::uuid;
    if v_res is not null then return v_res; end if;
  end if;
  o := app.tab_for_update((p ->> 'tab_id')::uuid);$x$);
-- the time it was paid on the device, and that it was offline
select app._patch_function('public.restaurant_pay',
  $x$v_payload := jsonb_build_object('client_uuid', p ->> 'client_uuid', 'session_id', s.id, 'device_ref', p ->> 'device_ref', 'partner_id', p ->> 'partner_id',$x$,
  $x$v_payload := jsonb_build_object('client_uuid', p ->> 'client_uuid', 'session_id', s.id, 'device_ref', p ->> 'device_ref', 'partner_id', p ->> 'partner_id',
    'order_at', p ->> 'order_at', 'offline', coalesce((p ->> 'offline')::boolean, false),$x$);

drop function app._patch_function(text, text, text);

-- open a table with the device's id; when the table was opened meanwhile, the device's id becomes that order
drop function public.restaurant_open(uuid, uuid, int, text);
create or replace function public.restaurant_open(p_register uuid, p_table uuid, p_guests int default 1, p_label text default null, p_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.pos_registers; v_id uuid;
begin
  select * into r from public.pos_registers where id = p_register;
  if r.id is null then raise exception 'Till not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'pos.write');
  if p_id is not null then
    if exists (select 1 from public.table_orders where id = p_id and company_id = r.company_id) then return p_id; end if;
    select table_order_id into v_id from public.table_order_aliases where id = p_id and company_id = r.company_id;
    if v_id is not null then return v_id; end if;
  end if;
  if p_table is not null then
    if not exists (select 1 from public.restaurant_tables tb join public.restaurant_areas a on a.id = tb.area_id
                    where tb.id = p_table and a.warehouse_id = r.warehouse_id and tb.deleted_at is null) then
      raise exception 'This table is not in this store' using errcode = '23514';
    end if;
    select id into v_id from public.table_orders where table_id = p_table and status = 'open';
    if v_id is not null then
      if p_id is not null then
        insert into public.table_order_aliases (id, company_id, table_order_id) values (p_id, r.company_id, v_id) on conflict (id) do nothing;
        update public.table_orders set guests = greatest(guests, coalesce(p_guests, 1)) where id = v_id;
      end if;
      return v_id;
    end if;
  end if;
  insert into public.table_orders (id, company_id, number, warehouse_id, register_id, table_id, label, guests)
  values (coalesce(p_id, gen_random_uuid()), r.company_id, app.next_document_number(r.company_id, 'table_order'), r.warehouse_id, r.id, p_table,
          nullif(btrim(p_label), ''), greatest(coalesce(p_guests, 1), 1))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.restaurant_open(uuid, uuid, int, text, uuid) from public, anon;
grant execute on function public.restaurant_open(uuid, uuid, int, text, uuid) to authenticated;

-- every open order of the till's store with its items, for the device to keep before a cut
create or replace function public.restaurant_open_tabs(p_register uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.pos_registers;
begin
  select * into r from public.pos_registers where id = p_register;
  if r.id is null then raise exception 'Till not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'pos.read');
  return coalesce((select jsonb_agg(public.restaurant_tab(o.id) order by o.opened_at)
                     from public.table_orders o where o.company_id = r.company_id and o.warehouse_id = r.warehouse_id and o.status = 'open'), '[]'::jsonb);
end $$;
revoke execute on function public.restaurant_open_tabs(uuid) from public, anon;
grant execute on function public.restaurant_open_tabs(uuid) to authenticated;
