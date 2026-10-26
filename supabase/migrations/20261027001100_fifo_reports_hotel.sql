-- =============================================================================
-- FIFO costing, saved reports with a cross table, and the hotel
--   * costing_method 'fifo': every receipt is a cost layer; what leaves takes the
--     cost of the oldest layers first. Value changes made elsewhere (landed
--     costs, revaluations) are spread over the layers still in stock.
--   * run_report: a second grouping (pivot_by) for a cross table; saved_reports
--     keep a report as someone set it up (grouping, filters, period)
--   * hotel: room types, rooms with their cleaning state, reservations on a
--     calendar, check-in, extras, check-out to an invoice
-- =============================================================================

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- =============================================================================
-- 1. FIFO
-- =============================================================================
alter table public.company_settings drop constraint if exists company_settings_costing_method_check;
alter table public.company_settings add constraint company_settings_costing_method_check check (costing_method in ('weighted_average', 'fifo'));

create table public.cost_layers (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  variant_id  uuid not null,
  movement_id uuid,
  layer_at    timestamptz not null default now(),
  qty_in      numeric(18,4) not null,
  qty_left    numeric(18,4) not null check (qty_left >= 0),
  unit_cost   numeric(18,6) not null,
  created_at  timestamptz not null default now(),
  foreign key (company_id, variant_id) references public.product_variants(company_id, id)
);
select app.register_table('public.cost_layers', 'inventory', p_soft_delete => false, p_client_write => false, p_audit => false);
create index cost_layers_open_idx on public.cost_layers (company_id, variant_id, layer_at) where qty_left > 0;

do $$ begin
  if position('v_fifo' in pg_get_functiondef('app.post_stock_move'::regproc)) = 0 then
    perform app._patch_function('app.post_stock_move',
      $o$v_cost numeric; v_total numeric; v_q1 numeric; v_v1 numeric; v_avg numeric; v_mv uuid; v_variance numeric := 0;$o$,
      $n$v_cost numeric; v_total numeric; v_q1 numeric; v_v1 numeric; v_avg numeric; v_mv uuid; v_variance numeric := 0;
  v_fifo boolean; v_need numeric; v_take numeric; lay record;$n$);
    perform app._patch_function('app.post_stock_move',
      $o$  select * into ic from public.item_costs where company_id = p_company and variant_id = p_variant for update;
$o$,
      $n$  select * into ic from public.item_costs where company_id = p_company and variant_id = p_variant for update;
  select coalesce(costing_method, 'weighted_average') = 'fifo' into v_fifo from public.company_settings where company_id = p_company;
  v_fifo := coalesce(v_fifo, false);
$n$);
    perform app._patch_function('app.post_stock_move',
      $o$    v_cost  := ic.avg_cost;
    v_total := case when p_qty = ic.qty_on_hand then ic.total_value else round(p_qty * v_cost, 4) end;
    v_q1    := ic.qty_on_hand - p_qty;
    v_v1    := case when v_q1 = 0 then 0 else ic.total_value - v_total end;
    v_avg   := ic.avg_cost;$o$,
      $n$    if v_fifo then
      -- FIFO: the oldest layers go first; beyond the layers (negative stock) at the last average
      v_need := p_qty; v_total := 0;
      for lay in select * from public.cost_layers where company_id = p_company and variant_id = p_variant and qty_left > 0
                  order by layer_at, created_at for update loop
        exit when v_need <= 0;
        v_take := least(lay.qty_left, v_need);
        update public.cost_layers set qty_left = qty_left - v_take where id = lay.id;
        v_total := v_total + round(v_take * lay.unit_cost, 4);
        v_need := v_need - v_take;
      end loop;
      if v_need > 0 then v_total := v_total + round(v_need * ic.avg_cost, 4); end if;
      if p_qty = ic.qty_on_hand then v_total := ic.total_value; end if;
      v_cost := round(v_total / p_qty, 4);
      v_q1   := ic.qty_on_hand - p_qty;
      v_v1   := case when v_q1 = 0 then 0 else ic.total_value - v_total end;
      v_avg  := case when v_q1 > 0 then round(v_v1 / v_q1, 6) else ic.avg_cost end;
    else
    v_cost  := ic.avg_cost;
    v_total := case when p_qty = ic.qty_on_hand then ic.total_value else round(p_qty * v_cost, 4) end;
    v_q1    := ic.qty_on_hand - p_qty;
    v_v1    := case when v_q1 = 0 then 0 else ic.total_value - v_total end;
    v_avg   := ic.avg_cost;
    end if;$n$);
    perform app._patch_function('app.post_stock_move',
      $o$  if v_out then perform app.bump_stock_level(p_company, p_variant, v_from.warehouse_id, p_from, p_lot, -p_qty, 0, p_date); end if;$o$,
      $n$  -- FIFO: what comes in is a new layer (less what settles negative stock)
  if v_fifo and v_in and not v_out and least(p_qty, greatest(v_q1, 0)) > 0 then
    insert into public.cost_layers (company_id, variant_id, movement_id, layer_at, qty_in, qty_left, unit_cost)
    values (p_company, p_variant, v_mv, p_date, p_qty, least(p_qty, greatest(v_q1, 0)), v_cost);
  end if;
  if v_out then perform app.bump_stock_level(p_company, p_variant, v_from.warehouse_id, p_from, p_lot, -p_qty, 0, p_date); end if;$n$);
  end if;
end $$;

-- value changed elsewhere (landed costs, revaluation): the layers in stock follow it
create or replace function app.tg_fifo_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_qty numeric; v_val numeric;
begin
  if not exists (select 1 from public.company_settings where company_id = new.company_id and costing_method = 'fifo') then return null; end if;
  if new.qty_on_hand <= 0 then
    update public.cost_layers set qty_left = 0 where company_id = new.company_id and variant_id = new.variant_id and qty_left > 0;
    return null;
  end if;
  select coalesce(sum(qty_left), 0), coalesce(sum(qty_left * unit_cost), 0) into v_qty, v_val
    from public.cost_layers where company_id = new.company_id and variant_id = new.variant_id and qty_left > 0;
  if v_qty > 0 and abs(v_val - new.total_value) > 0.01 then
    update public.cost_layers set unit_cost = greatest(unit_cost + (new.total_value - v_val) / v_qty, 0)
     where company_id = new.company_id and variant_id = new.variant_id and qty_left > 0;
  end if;
  return null;
end $$;
drop trigger if exists trg_90_fifo_sync on public.item_costs;
create trigger trg_90_fifo_sync after update of total_value, qty_on_hand on public.item_costs for each row execute function app.tg_fifo_sync();

-- switching: FIFO starts from what is in stock now, at its average cost
create or replace function public.costing_method_set(p_company uuid, p_method text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_old text; n int := 0;
begin
  perform app.require_permission(p_company, 'finance.approve');
  if p_method not in ('weighted_average', 'fifo') then raise exception 'Unknown costing method' using errcode = '22023'; end if;
  select costing_method into v_old from public.company_settings where company_id = p_company for update;
  if v_old = p_method then return jsonb_build_object('method', p_method, 'layers', 0); end if;
  delete from public.cost_layers where company_id = p_company;
  if p_method = 'fifo' then
    insert into public.cost_layers (company_id, variant_id, layer_at, qty_in, qty_left, unit_cost)
    select company_id, variant_id, least(coalesce(last_receipt_at, now()), now()), qty_on_hand, qty_on_hand, case when qty_on_hand > 0 then total_value / qty_on_hand else avg_cost end
      from public.item_costs where company_id = p_company and qty_on_hand > 0;
    get diagnostics n = row_count;
  end if;
  update public.company_settings set costing_method = p_method where company_id = p_company;
  return jsonb_build_object('method', p_method, 'layers', n);
end $$;

-- the layers of an item still in stock
create or replace function public.cost_layers_of(p_variant uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('at', l.layer_at, 'qty_in', l.qty_in, 'qty_left', l.qty_left, 'unit_cost', l.unit_cost,
           'reference', m.reference, 'source_type', m.source_doc_type, 'source_id', m.source_doc_id) order by l.layer_at, l.created_at), '[]'::jsonb)
    from public.cost_layers l left join public.stock_movements m on m.id = l.movement_id
   where l.variant_id = p_variant and l.qty_left > 0
     and l.company_id = any ((select app.company_ids_with('inventory.read'))::uuid[])
$$;

-- =============================================================================
-- 2. Reports: a cross table, and saved reports
-- =============================================================================
do $$ begin
  if position('pivot_by' in pg_get_functiondef('public.run_report'::regproc)) = 0 then
    perform app._patch_function('public.run_report',
      $o$v_perm text; v_key text; v_label text; v_sort text; v_href text := 'null::text'; f record;$o$,
      $n$v_perm text; v_key text; v_label text; v_sort text; v_href text := 'null::text'; f record; v_pv text := nullif(p ->> 'pivot_by', ''); v_pivot jsonb;$n$);
    perform app._patch_function('public.run_report',
      $o$  execute format('select to_jsonb(t) from (select %s from %s where %s) t', v_measures, v_src, v_where) into v_totals;$o$,
      $n$  execute format('select to_jsonb(t) from (select %s from %s where %s) t', v_measures, v_src, v_where) into v_totals;
  -- a second grouping across: one cell per row key and column key
  if v_pv is not null and v_pv <> v_dim then
    if not v_dims ? v_pv then raise exception 'Cannot group % by %', p_report, v_pv using errcode = '22023'; end if;
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]'') from (select %s as key, %s as col, %s as col_label, %s from %s where %s group by %s, %s) t',
                   v_key, v_dims -> v_pv ->> 0, v_dims -> v_pv ->> 1, v_measures, v_src, v_where, v_key, v_dims -> v_pv ->> 0) into v_pivot;
  end if;$n$);
    perform app._patch_function('public.run_report',
      $o$'columns', v_cols, 'rows', v_rows, 'totals', v_totals);$o$,
      $n$'columns', v_cols, 'rows', v_rows, 'totals', v_totals, 'pivot_by', case when v_pivot is not null then v_pv end, 'pivot', v_pivot);$n$);
  end if;
end $$;

create table public.saved_reports (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name       text not null check (length(btrim(name)) between 1 and 80),
  report     text not null,
  params     jsonb not null default '{}'::jsonb,   -- {period, from, to, group_by, pivot_by, measure, filters, chart}
  owner_id   uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  is_shared  boolean not null default false
);
select app.register_table('public.saved_reports', 'core', p_soft_delete => false, p_policies => false);
alter table public.saved_reports enable row level security;
-- one's own, or shared in the company
create policy saved_reports_select on public.saved_reports for select to authenticated
  using (company_id = any ((select app.company_ids_with('core.read'))::uuid[]) and (owner_id = auth.uid() or is_shared));
create policy saved_reports_insert on public.saved_reports for insert to authenticated
  with check (company_id = any ((select app.company_ids_with('core.read'))::uuid[]) and owner_id = auth.uid());
create policy saved_reports_update on public.saved_reports for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy saved_reports_delete on public.saved_reports for delete to authenticated using (owner_id = auth.uid());

-- =============================================================================
-- 3. Hotel
-- =============================================================================
alter table public.companies drop constraint if exists companies_business_type_check;
alter table public.companies add constraint companies_business_type_check
  check (business_type in ('general', 'retail', 'cafe', 'restaurant', 'wholesale', 'manufacturing', 'services', 'hotel'));
create or replace function app.business_type_hidden_menu(p_type text)
returns text[] language sql immutable set search_path = '' as $$
  select case p_type
    when 'retail'        then array['Manufacturing', 'Logistics', 'Hotel']
    when 'cafe'          then array['Sales & CRM', 'Warehouse|menu', 'Manufacturing', 'Logistics', 'Hotel']
    when 'restaurant'    then array['Sales & CRM', 'Warehouse|menu', 'Manufacturing', 'Logistics', 'Hotel']
    when 'wholesale'     then array['Retail', 'Manufacturing', 'Hotel']
    when 'manufacturing' then array['Retail', 'Hotel']
    when 'services'      then array['Inventory|menu', 'Warehouse|menu', 'Retail', 'Manufacturing', 'Logistics', 'Hotel']
    when 'hotel'         then array['Warehouse|menu', 'Manufacturing', 'Logistics']
    else array['Hotel']::text[] end
$$;
do $$ begin
  if position('''hotel''' in pg_get_functiondef('public.platform_set_business_type'::regproc)) = 0 then
    perform app._patch_function('public.platform_set_business_type',
      $o$p_type not in ('general', 'retail', 'cafe', 'restaurant', 'wholesale', 'manufacturing', 'services')$o$,
      $n$p_type not in ('general', 'retail', 'cafe', 'restaurant', 'wholesale', 'manufacturing', 'services', 'hotel')$n$);
  end if;
end $$;
-- the new menu section stays out of sight for the businesses there are already
update public.company_settings s set hidden_menu_sections = array_append(coalesce(s.hidden_menu_sections, '{}'), 'Hotel')
 where not ('Hotel' = any (coalesce(s.hidden_menu_sections, '{}')))
   and (select business_type from public.companies where id = s.company_id) <> 'hotel';

create table public.hotel_room_types (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  name        text not null,
  capacity    int not null default 2 check (capacity > 0),
  rate        numeric(18,2) not null default 0 check (rate >= 0),   -- per night, with VAT
  tax_code_id uuid references public.tax_codes(id),                -- accommodation often has a reduced VAT; empty: the company's default
  variant_id  uuid,                                                -- the service invoiced for its nights
  sort        int not null default 0,
  foreign key (company_id, variant_id) references public.product_variants(company_id, id)
);
select app.register_table('public.hotel_room_types', 'sales');

create table public.hotel_rooms (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  number       text not null,
  room_type_id uuid not null,
  floor        text,
  housekeeping text not null default 'clean' check (housekeeping in ('clean', 'dirty', 'inspect', 'out_of_order')),
  notes        text,
  is_active    boolean not null default true,
  foreign key (company_id, room_type_id) references public.hotel_room_types(company_id, id)
);
select app.register_table('public.hotel_rooms', 'sales');
create unique index hotel_rooms_number_key on public.hotel_rooms (company_id, number) where deleted_at is null;

create table public.hotel_reservations (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  number        text,
  status        text not null default 'booked',
  room_id       uuid not null,
  partner_id    uuid,                         -- who pays (a company, an agency) — or the guest's own record
  guest_name    text not null,
  guest_phone   text,
  guest_email   text,
  guest_document text,                        -- passport or ID number
  adults        int not null default 1 check (adults > 0),
  children      int not null default 0 check (children >= 0),
  check_in      date not null,
  check_out     date not null,
  rate          numeric(18,2) not null check (rate >= 0),   -- per night, with VAT
  source        text not null default 'direct' check (source in ('direct', 'phone', 'email', 'walk_in', 'booking', 'airbnb', 'agency', 'other')),
  notes         text,
  checked_in_at timestamptz,
  checked_out_at timestamptz,
  invoice_id    uuid,
  check (check_out > check_in),
  foreign key (company_id, room_id) references public.hotel_rooms(company_id, id),
  foreign key (company_id, partner_id) references public.business_partners(company_id, id)
);
select app.register_table('public.hotel_reservations', 'sales');
insert into public.document_types (key, name, module, table_name, default_prefix)
values ('hotel_reservation', 'Reservation', 'sales', 'hotel_reservations', 'RES-') on conflict (key) do nothing;
insert into public.status_transitions (doc_type, from_status, to_status) values
  ('hotel_reservation', '__init__', 'booked'), ('hotel_reservation', 'booked', 'checked_in'), ('hotel_reservation', 'booked', 'cancelled'),
  ('hotel_reservation', 'booked', 'no_show'), ('hotel_reservation', 'checked_in', 'checked_out'), ('hotel_reservation', 'cancelled', 'booked'),
  ('hotel_reservation', 'no_show', 'booked')
on conflict do nothing;
select app.register_document('public.hotel_reservations', 'hotel_reservation', 'check_in');
create index hotel_reservations_room_idx on public.hotel_reservations (room_id, check_in, check_out) where deleted_at is null;

-- a room holds one stay at a time
create or replace function app.tg_hotel_no_overlap()
returns trigger language plpgsql set search_path = '' as $$
declare v text;
begin
  if new.status in ('cancelled', 'no_show', 'checked_out') or new.deleted_at is not null then return new; end if;
  select r.number into v from public.hotel_reservations r
   where r.room_id = new.room_id and r.id <> new.id and r.deleted_at is null and r.status in ('booked', 'checked_in')
     and daterange(r.check_in, r.check_out) && daterange(new.check_in, new.check_out) limit 1;
  if v is not null then
    raise exception 'The room is already taken on those nights (%)', v using errcode = '23P01';
  end if;
  return new;
end $$;
create trigger trg_06_no_overlap before insert or update of room_id, check_in, check_out, status on public.hotel_reservations
  for each row execute function app.tg_hotel_no_overlap();

create table public.hotel_charges (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id),
  reservation_id uuid not null references public.hotel_reservations(id) on delete cascade,
  charge_date    date not null default current_date,
  description    text not null,
  variant_id     uuid,
  quantity       numeric(18,4) not null default 1 check (quantity > 0),
  unit_price     numeric(18,4) not null check (unit_price >= 0),   -- with VAT
  foreign key (company_id, variant_id) references public.product_variants(company_id, id)
);
select app.register_table('public.hotel_charges', 'sales', p_soft_delete => false);

-- the service item of a room type (made the first time it is needed)
create or replace function app.hotel_type_variant(p_type uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare k public.hotel_room_types; v_prod uuid; v_var uuid; v_uom uuid; v_tax uuid;
begin
  select * into k from public.hotel_room_types where id = p_type;
  if k.variant_id is not null then return k.variant_id; end if;
  select id into v_uom from public.units_of_measure where company_id = k.company_id and category = 'unit' and is_reference and deleted_at is null limit 1;
  v_tax := coalesce(k.tax_code_id, (select default_sales_tax_code_id from public.company_settings where company_id = k.company_id));
  insert into public.products (company_id, code, name, product_type, uom_id, sales_price, sales_tax_code_id, is_sellable, is_purchasable)
  values (k.company_id, 'ROOM-' || upper(left(regexp_replace(k.name, '[^A-Za-z0-9]', '', 'g'), 10)) || '-' || left(k.id::text, 4), 'Akomodim · ' || k.name,
          'service', v_uom, round(k.rate / (1 + coalesce((select rate from public.tax_codes where id = v_tax), 0) / 100), 4), v_tax, true, false)
  returning id into v_prod;
  insert into public.product_variants (company_id, product_id, sku, name, is_default)
  select k.company_id, v_prod, code, name, true from public.products where id = v_prod
  returning id into v_var;
  update public.hotel_room_types set variant_id = v_var where id = k.id;
  return v_var;
end $$;

-- the calendar: rooms and the stays that touch the days shown
create or replace function public.hotel_calendar(p_company uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'sales.read');
  return jsonb_build_object(
    'rooms', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'number', r.number, 'floor', r.floor, 'housekeeping', r.housekeeping,
                'type_id', t.id, 'type', t.name, 'rate', t.rate, 'capacity', t.capacity) order by t.sort, t.name, r.number)
       from public.hotel_rooms r join public.hotel_room_types t on t.id = r.room_type_id
      where r.company_id = p_company and r.deleted_at is null and r.is_active), '[]'::jsonb),
    'stays', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'number', s.number, 'room_id', s.room_id, 'status', s.status, 'guest', s.guest_name,
                'check_in', s.check_in, 'check_out', s.check_out, 'adults', s.adults, 'children', s.children, 'source', s.source, 'rate', s.rate))
       from public.hotel_reservations s
      where s.company_id = p_company and s.deleted_at is null and s.status in ('booked', 'checked_in', 'checked_out')
        and s.check_in <= p_to and s.check_out > p_from), '[]'::jsonb));
end $$;

-- today at the front desk
create or replace function public.hotel_today(p_company uuid, p_date date default current_date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_rooms int; v_occ int;
begin
  perform app.require_permission(p_company, 'sales.read');
  select count(*) into v_rooms from public.hotel_rooms where company_id = p_company and deleted_at is null and is_active and housekeeping <> 'out_of_order';
  select count(*) into v_occ from public.hotel_reservations where company_id = p_company and deleted_at is null and status in ('booked', 'checked_in')
     and check_in <= p_date and check_out > p_date;
  return jsonb_build_object('date', p_date, 'rooms', v_rooms, 'occupied', v_occ,
    'occupancy', case when v_rooms > 0 then round(100.0 * v_occ / v_rooms, 1) else 0 end,
    'arrivals', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'number', s.number, 'guest', s.guest_name, 'room', r.number, 'nights', s.check_out - s.check_in,
                 'status', s.status, 'housekeeping', r.housekeeping) order by r.number)
        from public.hotel_reservations s join public.hotel_rooms r on r.id = s.room_id
       where s.company_id = p_company and s.deleted_at is null and s.check_in = p_date and s.status in ('booked', 'checked_in')), '[]'::jsonb),
    'departures', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'number', s.number, 'guest', s.guest_name, 'room', r.number, 'status', s.status) order by r.number)
        from public.hotel_reservations s join public.hotel_rooms r on r.id = s.room_id
       where s.company_id = p_company and s.deleted_at is null and s.check_out = p_date and s.status in ('checked_in', 'checked_out')), '[]'::jsonb),
    'in_house', (select count(*) from public.hotel_reservations where company_id = p_company and deleted_at is null and status = 'checked_in'),
    'dirty', (select count(*) from public.hotel_rooms where company_id = p_company and deleted_at is null and is_active and housekeeping = 'dirty'),
    'revenue_month', coalesce((select sum(i.total_base) from public.sales_invoices i join public.hotel_reservations s on s.invoice_id = i.id
       where s.company_id = p_company and i.status = 'posted' and i.invoice_date >= date_trunc('month', p_date)::date), 0));
end $$;

create or replace function public.hotel_check_in(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.hotel_reservations;
begin
  select * into s from public.hotel_reservations where id = p_id and deleted_at is null for update;
  if s.id is null then raise exception 'Reservation not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'sales.write');
  if s.status <> 'booked' then raise exception 'Only a booked stay can check in' using errcode = '55000'; end if;
  if s.check_in > current_date then raise exception 'The stay starts on %', to_char(s.check_in, 'DD.MM.YYYY') using errcode = '55000'; end if;
  if (select housekeeping from public.hotel_rooms where id = s.room_id) = 'out_of_order' then
    raise exception 'The room is out of order' using errcode = '55000';
  end if;
  update public.hotel_reservations set status = 'checked_in', checked_in_at = now() where id = s.id;
end $$;

-- check-out: the stay becomes an invoice (its nights and extras), the room goes to cleaning
create or replace function public.hotel_check_out(p_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.hotel_reservations; v_room record; v_var uuid; v_tax uuid; v_tr numeric; v_inv uuid; v_partner uuid; v_n int := 0; c record; v_nights int;
        v_cur text; v_std uuid;
begin
  select * into s from public.hotel_reservations where id = p_id and deleted_at is null for update;
  if s.id is null then raise exception 'Reservation not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'sales.write');
  perform app.require_permission(s.company_id, 'invoicing.write');
  if s.status <> 'checked_in' then raise exception 'Only a guest who checked in can check out' using errcode = '55000'; end if;
  select r.*, t.name as type_name, t.tax_code_id as type_tax into v_room from public.hotel_rooms r join public.hotel_room_types t on t.id = r.room_type_id where r.id = s.room_id;
  v_var := app.hotel_type_variant(v_room.room_type_id);
  select coalesce(v_room.type_tax, p.sales_tax_code_id) into v_tax from public.product_variants v join public.products p on p.id = v.product_id where v.id = v_var;
  select coalesce(rate, 0) into v_tr from public.tax_codes where id = v_tax;
  select base_currency into v_cur from public.companies where id = s.company_id;
  -- extras without an item of their own take the usual VAT, not the room's reduced one
  select default_sales_tax_code_id into v_std from public.company_settings where company_id = s.company_id;
  -- whoever pays; a walk-in guest gets a customer record of their own
  v_partner := s.partner_id;
  if v_partner is null then
    select id into v_partner from public.business_partners where company_id = s.company_id and is_customer and deleted_at is null
       and lower(name) = lower(s.guest_name) and coalesce(phone, '') = coalesce(s.guest_phone, '') limit 1;
    if v_partner is null then
      insert into public.business_partners (company_id, code, name, is_customer, phone, email, kind)
      values (s.company_id, 'G-' || coalesce(s.number, left(s.id::text, 8)), s.guest_name, true, s.guest_phone, s.guest_email, 'individual')
      returning id into v_partner;
    end if;
  end if;
  v_nights := greatest(least(current_date, s.check_out) - s.check_in, 1);
  insert into public.sales_invoices (company_id, partner_id, source, invoice_date, due_date, currency_code, exchange_rate, notes)
  values (s.company_id, v_partner, 'manual', current_date, current_date, v_cur, 1,
          'Qëndrimi ' || coalesce(s.number, '') || ' · ' || s.guest_name || ' · dhoma ' || v_room.number || ' · ' || to_char(s.check_in, 'DD.MM.YYYY') || ' – ' || to_char(s.check_in + v_nights, 'DD.MM.YYYY'))
  returning id into v_inv;
  v_n := 1;
  insert into public.sales_invoice_lines (company_id, invoice_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
  values (s.company_id, v_inv, 1, v_var, 'Akomodim · ' || v_room.type_name || ' · dhoma ' || v_room.number || ' · ' || v_nights || case when v_nights = 1 then ' natë' else ' netë' end,
          v_nights, round(s.rate / (1 + v_tr / 100), 4), v_tax);
  for c in select hc.*, p.sales_tax_code_id as tax from public.hotel_charges hc
             left join public.product_variants v on v.id = hc.variant_id left join public.products p on p.id = v.product_id
            where hc.reservation_id = s.id order by hc.charge_date, hc.created_at loop
    v_n := v_n + 1;
    insert into public.sales_invoice_lines (company_id, invoice_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
    values (s.company_id, v_inv, v_n, c.variant_id, c.description, c.quantity,
            round(c.unit_price / (1 + coalesce((select rate from public.tax_codes where id = coalesce(c.tax, v_std, v_tax)), 0) / 100), 4), coalesce(c.tax, v_std, v_tax));
  end loop;
  update public.hotel_reservations set status = 'checked_out', checked_out_at = now(), invoice_id = v_inv,
         check_out = case when current_date < check_out then greatest(current_date, check_in + 1) else check_out end where id = s.id;
  update public.hotel_rooms set housekeeping = 'dirty' where id = s.room_id;
  return v_inv;
end $$;

-- =============================================================================
revoke execute on function public.costing_method_set(uuid, text), public.cost_layers_of(uuid), public.hotel_calendar(uuid, date, date),
  public.hotel_today(uuid, date), public.hotel_check_in(uuid), public.hotel_check_out(uuid) from public, anon;
grant execute on function public.costing_method_set(uuid, text), public.cost_layers_of(uuid), public.hotel_calendar(uuid, date, date),
  public.hotel_today(uuid, date), public.hotel_check_in(uuid), public.hotel_check_out(uuid) to authenticated;

drop function app._patch_function(text, text, text);
