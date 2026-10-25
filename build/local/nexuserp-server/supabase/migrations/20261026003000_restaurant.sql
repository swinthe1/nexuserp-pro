-- =============================================================================
-- NexusERP Pro · restaurant and café
--
-- * a till can work in restaurant mode: tables instead of a single basket
-- * areas (Salla, Tarraca…) and tables per store; kitchen/bar stations that get
--   the items of their categories
-- * a table order stays open while the waiter adds items; "send" puts the new items
--   on the kitchen/bar screen and ticket; paying (all of it or some items) goes through
--   pos_submit_order, so stock, fiscal receipt, Z-report and accounting stay one path
-- * recipes: a product with a kit bill of materials takes its ingredients out of stock
--   when sold (espresso → 7 g coffee, a cup of milk…)
-- =============================================================================

alter table public.pos_registers add column if not exists mode text not null default 'retail';
alter table public.pos_registers drop constraint if exists pos_registers_mode_check;
alter table public.pos_registers add constraint pos_registers_mode_check check (mode in ('retail', 'restaurant'));

create table public.restaurant_areas (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  warehouse_id uuid not null,
  name         text not null check (length(btrim(name)) between 1 and 60),
  sort_order   int not null default 0,
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id)
);
select app.register_table('public.restaurant_areas', 'pos');

create table public.restaurant_tables (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  area_id     uuid not null,
  name        text not null check (length(btrim(name)) between 1 and 30),
  seats       int not null default 4 check (seats between 1 and 99),
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  foreign key (company_id, area_id) references public.restaurant_areas(company_id, id)
);
select app.register_table('public.restaurant_tables', 'pos');

create table public.kitchen_stations (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  warehouse_id uuid not null,
  name         text not null check (length(btrim(name)) between 1 and 40),
  category_ids uuid[] not null default '{}',     -- items of these categories go here
  is_default   boolean not null default false,   -- everything else
  sort_order   int not null default 0,
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id)
);
select app.register_table('public.kitchen_stations', 'pos');

insert into public.document_types (key, name, module, table_name, default_prefix)
values ('table_order', 'Table order', 'pos', 'table_orders', 'POR-') on conflict (key) do nothing;

create table public.table_orders (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  number        text not null,
  warehouse_id  uuid not null,
  register_id   uuid not null,
  table_id      uuid,                                   -- null = takeaway / at the bar
  label         text,                                   -- a name for a takeaway order
  status        text not null default 'open' check (status in ('open', 'paid', 'cancelled')),
  guests        int not null default 1 check (guests between 1 and 99),
  waiter_id     uuid not null default auth.uid(),
  opened_at     timestamptz not null default now(),
  closed_at     timestamptz,
  note          text,
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id),
  foreign key (company_id, register_id) references public.pos_registers(company_id, id),
  foreign key (company_id, table_id) references public.restaurant_tables(company_id, id)
);
select app.register_table('public.table_orders', 'pos', p_client_write => false);
create unique index table_orders_one_open on public.table_orders (table_id) where status = 'open' and table_id is not null;
create index table_orders_open_idx on public.table_orders (company_id, warehouse_id) where status = 'open';

create table public.table_order_lines (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id),
  table_order_id uuid not null,
  variant_id     uuid not null,
  name           text not null,
  quantity       numeric(18,3) not null check (quantity > 0),
  unit_price     numeric(18,2) not null check (unit_price >= 0),     -- VAT included, fixed when ordered
  note           text,                                                -- "pa sheqer", "mesatarisht"
  station_id     uuid,
  status         text not null default 'new' check (status in ('new', 'sent', 'ready', 'served', 'void')),
  waiter_id      uuid not null default auth.uid(),
  sent_at        timestamptz,
  ready_at       timestamptz,
  void_reason    text,
  pos_order_id   uuid,                                                -- set when paid
  foreign key (company_id, table_order_id) references public.table_orders(company_id, id),
  foreign key (company_id, variant_id) references public.product_variants(company_id, id),
  foreign key (company_id, station_id) references public.kitchen_stations(company_id, id),
  foreign key (company_id, pos_order_id) references public.pos_orders(company_id, id)
);
select app.register_table('public.table_order_lines', 'pos', p_soft_delete => false, p_client_write => false);
create index table_order_lines_tab_idx on public.table_order_lines (table_order_id);
create index table_order_lines_kitchen_idx on public.table_order_lines (company_id, station_id) where status in ('sent', 'ready');

alter table public.pos_orders add column if not exists table_order_id uuid;
alter table public.pos_orders add column if not exists waiter_id uuid;
alter table public.pos_orders drop constraint if exists pos_orders_table_order_fk;
alter table public.pos_orders add constraint pos_orders_table_order_fk foreign key (company_id, table_order_id) references public.table_orders(company_id, id);

-- -----------------------------------------------------------------------------
-- helpers
-- -----------------------------------------------------------------------------
-- price at this till, VAT included (same rule as pos_catalog)
create or replace function app.restaurant_price(p_register uuid, p_variant uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select round(coalesce(gp.unit_price * (1 - coalesce(gp.discount_pct, 0) / 100), coalesce(v.sales_price_override, p.sales_price)) * (1 + coalesce(t.rate, 0) / 100), 2)
    from public.pos_registers r
    join public.product_variants v on v.id = p_variant and v.company_id = r.company_id
    join public.products p on p.id = v.product_id
    left join public.tax_codes t on t.id = p.sales_tax_code_id
    left join lateral public.get_price(r.company_id, r.default_customer_id, v.id, 1, current_date, r.price_list_id) gp on true
   where r.id = p_register
$$;

create or replace function app.restaurant_station(p_company uuid, p_warehouse uuid, p_variant uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select s.id from public.kitchen_stations s
   where s.company_id = p_company and s.warehouse_id = p_warehouse and s.deleted_at is null
     and (s.is_default or (select p.category_id from public.product_variants v join public.products p on p.id = v.product_id where v.id = p_variant) = any (s.category_ids))
   order by (s.is_default) asc, s.sort_order limit 1
$$;

create or replace function app.tab_for_update(p_tab uuid)
returns public.table_orders language plpgsql security definer set search_path = '' as $$
declare o public.table_orders;
begin
  select * into o from public.table_orders where id = p_tab for update;
  if o.id is null then raise exception 'Order not found' using errcode = 'P0002'; end if;
  perform app.require_permission(o.company_id, 'pos.write');
  if o.status <> 'open' then raise exception 'This order is already closed' using errcode = '55000'; end if;
  return o;
end $$;

-- -----------------------------------------------------------------------------
-- the floor: areas, tables and what is open on them
-- -----------------------------------------------------------------------------
create or replace function public.restaurant_floor(p_register uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.pos_registers;
begin
  select * into r from public.pos_registers where id = p_register;
  if r.id is null then raise exception 'Till not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'pos.read');
  return jsonb_build_object(
    'areas', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'tables',
        coalesce((select jsonb_agg(jsonb_build_object('id', tb.id, 'name', tb.name, 'seats', tb.seats) order by tb.sort_order, tb.name)
                    from public.restaurant_tables tb where tb.area_id = a.id and tb.deleted_at is null and tb.is_active), '[]'::jsonb)) order by a.sort_order, a.name)
      from public.restaurant_areas a where a.company_id = r.company_id and a.warehouse_id = r.warehouse_id and a.deleted_at is null), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'number', o.number, 'table_id', o.table_id, 'label', o.label, 'guests', o.guests,
        'opened_at', o.opened_at, 'waiter', (select coalesce(pr.full_name, '') from public.profiles pr where pr.id = o.waiter_id), 'waiter_id', o.waiter_id,
        'total', (select coalesce(sum(round(l.quantity * l.unit_price, 2)), 0) from public.table_order_lines l where l.table_order_id = o.id and l.status <> 'void' and l.pos_order_id is null),
        'new', (select count(*) from public.table_order_lines l where l.table_order_id = o.id and l.status = 'new'),
        'waiting', (select count(*) from public.table_order_lines l where l.table_order_id = o.id and l.status = 'sent'),
        'ready', (select count(*) from public.table_order_lines l where l.table_order_id = o.id and l.status = 'ready'),
        'last_sent_at', (select max(l.sent_at) from public.table_order_lines l where l.table_order_id = o.id)) order by o.opened_at)
      from public.table_orders o where o.company_id = r.company_id and o.warehouse_id = r.warehouse_id and o.status = 'open'), '[]'::jsonb),
    'stations', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'category_ids', s.category_ids, 'is_default', s.is_default) order by s.sort_order, s.name)
      from public.kitchen_stations s where s.company_id = r.company_id and s.warehouse_id = r.warehouse_id and s.deleted_at is null), '[]'::jsonb));
end $$;

create or replace function public.restaurant_tab(p_tab uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare o public.table_orders;
begin
  select * into o from public.table_orders where id = p_tab;
  if o.id is null then raise exception 'Order not found' using errcode = 'P0002'; end if;
  perform app.require_permission(o.company_id, 'pos.read');
  return jsonb_build_object('id', o.id, 'number', o.number, 'status', o.status, 'table_id', o.table_id, 'label', o.label, 'guests', o.guests,
    'opened_at', o.opened_at, 'note', o.note,
    'table', (select tb.name from public.restaurant_tables tb where tb.id = o.table_id),
    'waiter', (select coalesce(pr.full_name, '') from public.profiles pr where pr.id = o.waiter_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'variant_id', l.variant_id, 'name', l.name, 'quantity', l.quantity, 'unit_price', l.unit_price,
        'note', l.note, 'status', l.status, 'station_id', l.station_id, 'sent_at', l.sent_at, 'paid', l.pos_order_id is not null) order by l.created_at, l.id)
      from public.table_order_lines l where l.table_order_id = o.id), '[]'::jsonb));
end $$;

-- open a table (or join the order already open on it). p_table null = takeaway
create or replace function public.restaurant_open(p_register uuid, p_table uuid, p_guests int default 1, p_label text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.pos_registers; v_id uuid;
begin
  select * into r from public.pos_registers where id = p_register;
  if r.id is null then raise exception 'Till not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'pos.write');
  if p_table is not null then
    if not exists (select 1 from public.restaurant_tables tb join public.restaurant_areas a on a.id = tb.area_id
                    where tb.id = p_table and a.warehouse_id = r.warehouse_id and tb.deleted_at is null) then
      raise exception 'This table is not in this store' using errcode = '23514';
    end if;
    select id into v_id from public.table_orders where table_id = p_table and status = 'open';
    if v_id is not null then return v_id; end if;
  end if;
  insert into public.table_orders (company_id, number, warehouse_id, register_id, table_id, label, guests)
  values (r.company_id, app.next_document_number(r.company_id, 'table_order'), r.warehouse_id, r.id, p_table, nullif(btrim(p_label), ''), greatest(coalesce(p_guests, 1), 1))
  returning id into v_id;
  return v_id;
end $$;

-- p_items: [{variant_id, quantity, note}]
create or replace function public.restaurant_add(p_tab uuid, p_items jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.table_orders; x jsonb; v_price numeric;
begin
  o := app.tab_for_update(p_tab);
  for x in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    if coalesce((x ->> 'quantity')::numeric, 0) <= 0 then raise exception 'Quantity must be more than zero' using errcode = '23514'; end if;
    v_price := app.restaurant_price(o.register_id, (x ->> 'variant_id')::uuid);
    if v_price is null then raise exception 'Unknown product' using errcode = '23503'; end if;
    insert into public.table_order_lines (company_id, table_order_id, variant_id, name, quantity, unit_price, note, station_id)
    select o.company_id, o.id, v.id, v.name, (x ->> 'quantity')::numeric, v_price, nullif(btrim(x ->> 'note'), ''),
           app.restaurant_station(o.company_id, o.warehouse_id, v.id)
      from public.product_variants v where v.id = (x ->> 'variant_id')::uuid and v.company_id = o.company_id;
  end loop;
end $$;

-- change a line that has not gone to the kitchen yet (quantity 0 removes it)
create or replace function public.restaurant_change_line(p_line uuid, p_quantity numeric, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.table_order_lines; o public.table_orders;
begin
  select * into l from public.table_order_lines where id = p_line;
  if l.id is null then raise exception 'Line not found' using errcode = 'P0002'; end if;
  o := app.tab_for_update(l.table_order_id);
  if l.status <> 'new' then raise exception 'This item has gone to the kitchen already; cancel it instead' using errcode = '55000'; end if;
  if coalesce(p_quantity, 0) <= 0 then
    delete from public.table_order_lines where id = p_line;
  else
    update public.table_order_lines set quantity = p_quantity, note = nullif(btrim(p_note), '') where id = p_line;
  end if;
end $$;

-- cancel an item already sent: a manager decides
create or replace function public.restaurant_void(p_line uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.table_order_lines; o public.table_orders;
begin
  select * into l from public.table_order_lines where id = p_line;
  if l.id is null then raise exception 'Line not found' using errcode = 'P0002'; end if;
  o := app.tab_for_update(l.table_order_id);
  if l.pos_order_id is not null then raise exception 'This item is paid already' using errcode = '55000'; end if;
  if l.status <> 'new' and not app.has_permission(o.company_id, 'pos.approve') then
    raise exception 'Cancelling an item the kitchen has received needs a manager' using errcode = '42501';
  end if;
  if l.status <> 'new' and nullif(btrim(p_reason), '') is null then raise exception 'Write why the item is cancelled' using errcode = '23514'; end if;
  update public.table_order_lines set status = 'void', void_reason = nullif(btrim(p_reason), '') where id = p_line;
end $$;

-- new items go to the kitchen/bar; returns the tickets to print, one per station
create or replace function public.restaurant_send(p_tab uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.table_orders; v_out jsonb;
begin
  o := app.tab_for_update(p_tab);
  with sent as (
    update public.table_order_lines set status = 'sent', sent_at = now()
     where table_order_id = o.id and status = 'new' returning *)
  select coalesce(jsonb_agg(jsonb_build_object('station', coalesce(st.name, ''), 'lines', x.lines) order by st.sort_order), '[]'::jsonb) into v_out
    from (select station_id, jsonb_agg(jsonb_build_object('name', name, 'quantity', quantity, 'note', note) order by created_at) as lines from sent group by station_id) x
    left join public.kitchen_stations st on st.id = x.station_id;
  return jsonb_build_object('number', o.number, 'table', (select name from public.restaurant_tables where id = o.table_id), 'label', o.label,
    'waiter', (select coalesce(full_name, '') from public.profiles where id = auth.uid()), 'at', now(), 'tickets', v_out);
end $$;

-- the kitchen: ready / served
create or replace function public.restaurant_set_status(p_lines uuid[], p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_company uuid;
begin
  if p_status not in ('sent', 'ready', 'served') then raise exception 'Unknown status' using errcode = '23514'; end if;
  select company_id into v_company from public.table_order_lines where id = any (p_lines) limit 1;
  if v_company is null then return; end if;
  perform app.require_permission(v_company, 'pos.write');
  update public.table_order_lines set status = p_status, ready_at = case when p_status = 'ready' then now() else ready_at end
   where id = any (p_lines) and company_id = v_company and status in ('sent', 'ready', 'served');
end $$;

-- move to another table; when that table is taken the two orders become one
create or replace function public.restaurant_move(p_tab uuid, p_table uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare o public.table_orders; v_target uuid;
begin
  o := app.tab_for_update(p_tab);
  if not exists (select 1 from public.restaurant_tables tb join public.restaurant_areas a on a.id = tb.area_id
                  where tb.id = p_table and a.warehouse_id = o.warehouse_id and tb.deleted_at is null) then
    raise exception 'This table is not in this store' using errcode = '23514';
  end if;
  select id into v_target from public.table_orders where table_id = p_table and status = 'open' and id <> o.id for update;
  if v_target is null then
    update public.table_orders set table_id = p_table, label = null where id = o.id;
    return o.id;
  end if;
  update public.table_order_lines set table_order_id = v_target where table_order_id = o.id;
  update public.table_orders set guests = guests + o.guests where id = v_target;
  update public.table_orders set status = 'cancelled', closed_at = now(), note = coalesce(note || ' · ', '') || 'merged' where id = o.id;
  return v_target;
end $$;

create or replace function public.restaurant_set_guests(p_tab uuid, p_guests int)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.table_orders;
begin
  o := app.tab_for_update(p_tab);
  update public.table_orders set guests = greatest(coalesce(p_guests, 1), 1) where id = o.id;
end $$;

-- an empty order (opened by mistake) can be closed; one with items is cancelled item by item
create or replace function public.restaurant_close_empty(p_tab uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.table_orders;
begin
  o := app.tab_for_update(p_tab);
  if exists (select 1 from public.table_order_lines where table_order_id = o.id and status <> 'void' and pos_order_id is null) then
    raise exception 'The order still has items to pay or cancel' using errcode = '55000';
  end if;
  update public.table_orders set status = case when exists (select 1 from public.table_order_lines where table_order_id = o.id and pos_order_id is not null) then 'paid' else 'cancelled' end,
         closed_at = now() where id = o.id;
end $$;

-- pay: p = {tab_id, session_id, client_uuid, split?: [{line_id, quantity}], payments, loyalty?, partner_id?}
-- without split everything unpaid is paid. New items not sent yet are sent first (they are being served).
create or replace function public.restaurant_pay(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.table_orders; s public.pos_sessions; x jsonb; l public.table_order_lines; v_lines uuid[] := '{}'; v_new uuid; v_res jsonb; v_payload jsonb;
begin
  o := app.tab_for_update((p ->> 'tab_id')::uuid);
  select * into s from public.pos_sessions where id = (p ->> 'session_id')::uuid;
  if s.id is null or s.status <> 'open' then raise exception 'Open the till first; paying needs an open shift' using errcode = '55000'; end if;
  if s.company_id <> o.company_id then raise exception 'Session not found' using errcode = 'P0002'; end if;

  if jsonb_array_length(coalesce(p -> 'split', '[]'::jsonb)) > 0 then
    for x in select * from jsonb_array_elements(p -> 'split') loop
      select * into l from public.table_order_lines where id = (x ->> 'line_id')::uuid and table_order_id = o.id and status <> 'void' and pos_order_id is null for update;
      if l.id is null then raise exception 'An item of this bill is paid or cancelled already' using errcode = '55000'; end if;
      if coalesce((x ->> 'quantity')::numeric, l.quantity) <= 0 or coalesce((x ->> 'quantity')::numeric, l.quantity) > l.quantity then
        raise exception 'Pay between 0 and % of %', l.quantity, l.name using errcode = '23514';
      end if;
      if coalesce((x ->> 'quantity')::numeric, l.quantity) < l.quantity then
        -- part of a line: it splits in two
        update public.table_order_lines set quantity = quantity - (x ->> 'quantity')::numeric where id = l.id;
        insert into public.table_order_lines (company_id, table_order_id, variant_id, name, quantity, unit_price, note, station_id, status, waiter_id, sent_at, ready_at)
        values (l.company_id, l.table_order_id, l.variant_id, l.name, (x ->> 'quantity')::numeric, l.unit_price, l.note, l.station_id, l.status, l.waiter_id, l.sent_at, l.ready_at)
        returning id into v_new;
        v_lines := v_lines || v_new;
      else
        v_lines := v_lines || l.id;
      end if;
    end loop;
  else
    select coalesce(array_agg(id), '{}') into v_lines from public.table_order_lines where table_order_id = o.id and status <> 'void' and pos_order_id is null;
  end if;
  if cardinality(v_lines) = 0 then raise exception 'Nothing to pay on this order' using errcode = '23514'; end if;

  update public.table_order_lines set status = 'sent', sent_at = now() where id = any (v_lines) and status = 'new';

  v_payload := jsonb_build_object('client_uuid', p ->> 'client_uuid', 'session_id', s.id, 'device_ref', p ->> 'device_ref', 'partner_id', p ->> 'partner_id',
    'loyalty', p -> 'loyalty', 'payments', p -> 'payments',
    'lines', (select jsonb_agg(jsonb_build_object('variant_id', tl.variant_id, 'quantity', tl.quantity, 'unit_price', tl.unit_price,
                                                  'discount_pct', coalesce((select (y ->> 'discount_pct')::numeric from jsonb_array_elements(coalesce(p -> 'discounts', '[]'::jsonb)) y
                                                                            where (y ->> 'line_id')::uuid = tl.id or (y ->> 'variant_id')::uuid = tl.variant_id limit 1), 0),
                                                  'manual_pct', 0, 'description', tl.name) order by tl.created_at)
                from public.table_order_lines tl where tl.id = any (v_lines)));
  v_res := public.pos_submit_order(v_payload);

  update public.table_order_lines set pos_order_id = (v_res ->> 'id')::uuid where id = any (v_lines);
  update public.pos_orders set table_order_id = o.id, waiter_id = o.waiter_id where id = (v_res ->> 'id')::uuid;
  if not exists (select 1 from public.table_order_lines where table_order_id = o.id and status <> 'void' and pos_order_id is null) then
    update public.table_orders set status = 'paid', closed_at = now() where id = o.id;
  end if;
  return v_res || jsonb_build_object('closed', not exists (select 1 from public.table_orders where id = o.id and status = 'open'));
end $$;

-- the kitchen / bar screen
create or replace function public.restaurant_kitchen(p_warehouse uuid, p_station uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_company uuid;
begin
  select company_id into v_company from public.warehouses where id = p_warehouse;
  if v_company is null then raise exception 'Store not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_company, 'pos.read');
  return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'number', o.number, 'table', tb.name, 'label', o.label,
      'waiter', (select coalesce(pr.full_name, '') from public.profiles pr where pr.id = o.waiter_id),
      'lines', (select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'quantity', l.quantity, 'note', l.note, 'status', l.status, 'sent_at', l.sent_at,
                                                    'station_id', l.station_id) order by l.sent_at, l.created_at)
                  from public.table_order_lines l where l.table_order_id = o.id and l.status in ('sent', 'ready')
                   and (p_station is null or l.station_id = p_station)),
      'first_sent_at', (select min(l.sent_at) from public.table_order_lines l where l.table_order_id = o.id and l.status in ('sent', 'ready')
                         and (p_station is null or l.station_id = p_station))) order by o.opened_at)
    from public.table_orders o left join public.restaurant_tables tb on tb.id = o.table_id
   where o.company_id = v_company and o.warehouse_id = p_warehouse
     and exists (select 1 from public.table_order_lines l where l.table_order_id = o.id and l.status in ('sent', 'ready')
                  and (p_station is null or l.station_id = p_station))), '[]'::jsonb);
end $$;

-- -----------------------------------------------------------------------------
-- recipes: a product with a kit bill of materials takes its ingredients out of stock
-- -----------------------------------------------------------------------------
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

select app._patch_function('public.pos_submit_order',
  $x$v_max_disc numeric := 10; v_number text;$x$,
  $x$v_max_disc numeric := 10; v_number text; v_kit uuid; kc record;$x$);

select app._patch_function('public.pos_submit_order',
  $x$    continue when ln.product_type <> 'stockable';$x$,
  $x$    -- a recipe (kit): the ingredients leave stock instead of the dish
    select b.id into v_kit from public.boms b
     where b.company_id = s.company_id and b.variant_id = ln.variant_id and b.bom_type = 'kit' and b.is_active and b.deleted_at is null
       and (b.valid_from is null or b.valid_from <= v_order_at::date) and (b.valid_to is null or b.valid_to >= v_order_at::date)
     order by b.is_default desc, b.version desc limit 1;
    if v_kit is not null then
      v_cost := 0;
      for kc in select bl.component_variant_id as cv, bl.quantity * (1 + bl.scrap_pct / 100) / b.quantity as per
                  from public.boms b join public.bom_lines bl on bl.bom_id = b.id
                  join public.product_variants cv on cv.id = bl.component_variant_id join public.products cp on cp.id = cv.product_id
                 where b.id = v_kit and not bl.is_optional and cp.product_type = 'stockable' loop
        if ln.quantity > 0 then
          v_mv := app.post_stock_move(s.company_id, 'pos_sale', kc.cv, r.location_id, v_customer, round(ln.quantity * kc.per, 4), null, null,
                                      'pos_order', v_id, ln.id, v_number, v_order_at);
        else
          v_mv := app.post_stock_move(s.company_id, 'pos_return', kc.cv, v_customer, r.location_id, round(-ln.quantity * kc.per, 4), null, null,
                                      'pos_order', v_id, ln.id, v_number, v_order_at);
        end if;
        v_cost := v_cost + coalesce((select total_cost from public.stock_movements where id = v_mv), 0);
      end loop;
      update public.pos_order_lines set unit_cost = round(v_cost / abs(ln.quantity), 6) where id = ln.id;
      continue;
    end if;
    continue when ln.product_type <> 'stockable';$x$);

drop function app._patch_function(text, text, text);

-- live screens
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.table_orders, public.table_order_lines;
  end if;
end $$;

revoke execute on function app.restaurant_price(uuid, uuid), app.restaurant_station(uuid, uuid, uuid), app.tab_for_update(uuid) from public, anon, authenticated;
revoke execute on function public.restaurant_floor(uuid), public.restaurant_tab(uuid), public.restaurant_open(uuid, uuid, int, text), public.restaurant_add(uuid, jsonb),
  public.restaurant_change_line(uuid, numeric, text), public.restaurant_void(uuid, text), public.restaurant_send(uuid), public.restaurant_set_status(uuid[], text),
  public.restaurant_move(uuid, uuid), public.restaurant_set_guests(uuid, int), public.restaurant_close_empty(uuid), public.restaurant_pay(jsonb),
  public.restaurant_kitchen(uuid, uuid) from public, anon;
grant execute on function public.restaurant_floor(uuid), public.restaurant_tab(uuid), public.restaurant_open(uuid, uuid, int, text), public.restaurant_add(uuid, jsonb),
  public.restaurant_change_line(uuid, numeric, text), public.restaurant_void(uuid, text), public.restaurant_send(uuid), public.restaurant_set_status(uuid[], text),
  public.restaurant_move(uuid, uuid), public.restaurant_set_guests(uuid, int), public.restaurant_close_empty(uuid), public.restaurant_pay(jsonb),
  public.restaurant_kitchen(uuid, uuid) to authenticated;
