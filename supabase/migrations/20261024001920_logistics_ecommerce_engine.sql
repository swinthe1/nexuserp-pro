-- =============================================================================
-- NexusERP Pro · 1920 · Logistics & e-commerce engine (Phase 8)
--
-- Logistics
--   delivery (picked) → shipment → route stop (own fleet) or carrier hand-off
--   → in transit → delivered / failed (re-scheduled or cancelled).
--   Leaving the warehouse posts the delivery (stock out, COGS) if the
--   warehouse has not already. Every change is a tracking event.
--   Cash on delivery: collected by the driver, then settled into a cash or
--   bank account as a customer receipt allocated to the order's invoices.
-- E-commerce (placeholders for the connectors)
--   Channel orders are ingested idempotently by external id from a normalised
--   payload (the `channel-webhook` Edge Function maps Shopify / WooCommerce /
--   … to it), matched to customers and SKUs, and become sales orders.
--   Stock sync computes what would be pushed and logs it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Who runs logistics: a Logistics Manager role; warehouse staff (and drivers)
--    record dispatches and stops; sales managers handle web orders
-- -----------------------------------------------------------------------------
insert into public.roles (key, name, description, is_assignable, sort_order)
values ('logistics_manager', 'Logistics Manager', 'Plans routes, ships with carriers, tracks deliveries and cash on delivery', true, 9)
on conflict do nothing;
insert into public.role_permissions (role_id, permission)
select r.id, p from public.roles r cross join unnest(array['core.read','collab.*','logistics.*','wms.read','wms.write','sales.read','partners.read',
                                                           'inventory.read','hr.read','reports.read']) p
 where r.key = 'logistics_manager'
on conflict do nothing;
insert into public.role_permissions (role_id, permission)
select r.id, p.p from public.roles r join (values ('warehouse_operator', 'logistics.write'), ('sales_manager', 'ecommerce.write')) p(k, p) on p.k = r.key
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 1. Tracking events
-- -----------------------------------------------------------------------------
create table public.shipment_events (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null,
  shipment_id uuid not null,
  event_at    timestamptz not null default now(),
  status      text not null,
  location    text,
  note        text,
  source      text not null default 'system' check (source in ('system','driver','carrier','office')),
  foreign key (company_id, shipment_id) references public.shipments(company_id, id) on delete cascade
);
select app.register_table('public.shipment_events', 'logistics', p_soft_delete => false, p_client_write => false, p_audit => false);
create index shipment_events_shipment_idx on public.shipment_events (shipment_id, event_at);

alter table public.shipments
  add column cod_settled_at timestamptz,
  add column cod_payment_id uuid,
  add column attempts smallint not null default 0,
  add column address_text text,
  add column city text,
  add foreign key (company_id, cod_payment_id) references public.payments(company_id, id);

alter table public.route_stops add column outcome_note text;

create trigger trg_04_system_statuses before insert or update of status on public.shipments
  for each row execute function app.tg_system_statuses('in_transit','delivered','failed');
create trigger trg_04_system_statuses before insert or update of status on public.delivery_routes
  for each row execute function app.tg_system_statuses('in_progress','completed');

create or replace function app.shipment_event(p_shipment uuid, p_status text, p_note text default null, p_location text default null, p_source text default 'system')
returns void language sql security definer set search_path = '' as $$
  insert into public.shipment_events (company_id, shipment_id, status, note, location, source)
  select company_id, id, p_status, p_note, p_location, p_source from public.shipments where id = p_shipment;
$$;

-- -----------------------------------------------------------------------------
-- 2. Shipments
-- -----------------------------------------------------------------------------
-- p: {carrier_id, ship_date, packages, weight_kg, cod_amount, tracking_number, notes}
create or replace function public.create_shipment(p_delivery uuid, p jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare d public.deliveries; a public.partner_addresses; v_id uuid; v_weight numeric;
begin
  select * into d from public.deliveries where id = p_delivery;
  if d.id is null then raise exception 'Delivery not found' using errcode = 'P0002'; end if;
  perform app.require_permission(d.company_id, 'logistics.write');
  if d.status = 'cancelled' then raise exception 'Delivery % is cancelled', d.number using errcode = '55000'; end if;
  if exists (select 1 from public.shipments where delivery_id = d.id and deleted_at is null and status not in ('cancelled','failed')) then
    raise exception 'Delivery % already has a shipment', d.number using errcode = '23505';
  end if;
  select * into a from public.partner_addresses where id = d.shipping_address_id;
  if a.id is null then
    select * into a from public.partner_addresses where partner_id = d.partner_id and deleted_at is null
     order by (address_type = 'shipping') desc, is_default desc limit 1;
  end if;
  -- weight from the products when the warehouse did not weigh the parcels
  select coalesce(d.shipping_weight_kg, nullif(sum(l.quantity * coalesce(v.weight_kg, 0)), 0)) into v_weight
    from public.delivery_lines l join public.product_variants v on v.id = l.variant_id where l.delivery_id = d.id;
  insert into public.shipments (company_id, delivery_id, carrier_id, partner_id, shipping_address_id, tracking_number, ship_date, packages,
                                weight_kg, cod_amount, notes, address_text, city, status)
  values (d.company_id, d.id, coalesce(nullif(p->>'carrier_id', '')::uuid, d.carrier_id), d.partner_id, a.id,
          coalesce(nullif(p->>'tracking_number', ''), d.tracking_number), coalesce(nullif(p->>'ship_date', '')::date, d.scheduled_date, current_date),
          greatest(coalesce((p->>'packages')::int, d.package_count, 1), 1), coalesce((p->>'weight_kg')::numeric, v_weight),
          coalesce((p->>'cod_amount')::numeric, 0), p->>'notes',
          nullif(concat_ws(', ', a.line1, a.line2, a.postal_code || ' ' || a.city), ''), a.city, 'draft')
  returning id into v_id;
  perform app.shipment_event(v_id, 'draft', 'Shipment created from ' || d.number);
  return v_id;
end $$;

-- Stock leaves when the shipment leaves: post the delivery if the warehouse has not
create or replace function app.shipment_dispatch(p_shipment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.shipments; d public.deliveries;
begin
  select * into s from public.shipments where id = p_shipment;
  select * into d from public.deliveries where id = s.delivery_id for update;
  if d.id is not null and d.status <> 'done' then
    if d.status <> 'ready' then raise exception 'Delivery % is not picked yet', d.number using errcode = '55000'; end if;
    update public.deliveries set carrier_id = coalesce(s.carrier_id, carrier_id), tracking_number = coalesce(s.tracking_number, tracking_number),
                                 package_count = s.packages, shipping_weight_kg = coalesce(s.weight_kg, shipping_weight_kg), shipped_by = auth.uid()
     where id = d.id;
    perform public.post_delivery(d.id);
  end if;
  update public.shipments set status = 'in_transit', ship_date = coalesce(ship_date, current_date) where id = s.id;
end $$;

-- External carrier: hand over with a tracking number
create or replace function public.ship_with_carrier(p_shipment uuid, p_carrier uuid, p_tracking text)
returns text language plpgsql security definer set search_path = '' as $$
declare s public.shipments; c public.carriers;
begin
  select * into s from public.shipments where id = p_shipment for update;
  if s.id is null then raise exception 'Shipment not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'logistics.write');
  if s.status not in ('draft','scheduled') then raise exception 'Shipment % is %', s.number, s.status using errcode = '55000'; end if;
  select * into c from public.carriers where id = p_carrier and company_id = s.company_id;
  if c.id is null then raise exception 'Choose a carrier' using errcode = '23514'; end if;
  if c.carrier_type = 'external' and nullif(btrim(p_tracking), '') is null then raise exception 'Enter the carrier''s tracking number' using errcode = '23514'; end if;
  update public.shipments set carrier_id = c.id, tracking_number = nullif(btrim(p_tracking), ''), route_id = null,
                              status = case when status = 'draft' then 'scheduled' else status end
   where id = s.id;
  perform app.shipment_dispatch(s.id);
  perform app.shipment_event(s.id, 'in_transit', 'Handed to ' || c.name || coalesce(' · ' || nullif(btrim(p_tracking), ''), ''), null, 'office');
  return 'in_transit';
end $$;

-- Status updates from the carrier, the driver or the office
create or replace function public.update_shipment(p_shipment uuid, p_status text, p_note text default null, p_location text default null,
                                                  p_cod_collected boolean default null)
returns text language plpgsql security definer set search_path = '' as $$
declare s public.shipments;
begin
  select * into s from public.shipments where id = p_shipment for update;
  if s.id is null then raise exception 'Shipment not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'logistics.write');
  if p_status not in ('in_transit','delivered','failed','scheduled','cancelled','note') then
    raise exception 'Unknown status %', p_status using errcode = '22023';
  end if;
  if p_status = 'note' then perform app.shipment_event(s.id, s.status, p_note, p_location, 'office'); return s.status; end if;
  if p_status = 'failed' and nullif(btrim(p_note), '') is null then raise exception 'Say why the delivery failed' using errcode = '23514'; end if;
  if p_status = 'delivered' and s.cod_amount > 0 and p_cod_collected is not true then
    raise exception 'Collect % cash on delivery before confirming', to_char(s.cod_amount, 'FM999G999G990D00') using errcode = '23514';
  end if;
  if p_status = 'scheduled' and s.status = 'failed' then
    update public.shipments set status = 'scheduled', route_id = null, failure_reason = null where id = s.id;
  else
    update public.shipments set status = p_status,
           delivered_at = case when p_status = 'delivered' then now() else delivered_at end,
           failure_reason = case when p_status = 'failed' then btrim(p_note) else failure_reason end,
           attempts = attempts + case when p_status in ('delivered','failed') then 1 else 0 end,
           cod_collected = coalesce(p_cod_collected, cod_collected)
     where id = s.id;
  end if;
  perform app.shipment_event(s.id, p_status, p_note, p_location, 'office');
  if p_status = 'failed' then
    perform app.notify_role(s.company_id, (select id from public.roles where key = 'sales_manager'), 'alert', 'Delivery failed: ' || s.number,
                            btrim(p_note), '/logistics/shipments/' || s.id, 'shipments', s.id);
  end if;
  return p_status;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Routes (own fleet)
-- -----------------------------------------------------------------------------
create or replace function public.create_route(p_company uuid, p_date date, p_warehouse uuid, p_vehicle uuid default null,
                                               p_driver uuid default null, p_shipments uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_driver uuid;
begin
  perform app.require_permission(p_company, 'logistics.write');
  if p_date < current_date then raise exception 'Plan routes for today or later' using errcode = '23514'; end if;
  v_driver := coalesce(p_driver, (select driver_employee_id from public.vehicles where id = p_vehicle));
  if v_driver is not null and exists (select 1 from public.delivery_routes where company_id = p_company and route_date = p_date
                                         and driver_employee_id = v_driver and status in ('planned','in_progress') and deleted_at is null) then
    raise exception 'That driver already has a route on %', to_char(p_date, 'DD Mon') using errcode = '23505';
  end if;
  if p_vehicle is not null and exists (select 1 from public.delivery_routes where company_id = p_company and route_date = p_date
                                          and vehicle_id = p_vehicle and status in ('planned','in_progress') and deleted_at is null) then
    raise exception 'That vehicle is already on a route on %', to_char(p_date, 'DD Mon') using errcode = '23505';
  end if;
  insert into public.delivery_routes (company_id, route_date, warehouse_id, vehicle_id, driver_employee_id)
  values (p_company, p_date, p_warehouse, p_vehicle, v_driver) returning id into v_id;
  if cardinality(p_shipments) > 0 then perform public.assign_to_route(v_id, p_shipments); end if;
  return v_id;
end $$;

-- Adds shipments as stops (end of the route), grouped by city; checks the vehicle's capacity
create or replace function public.assign_to_route(p_route uuid, p_shipments uuid[])
returns int language plpgsql security definer set search_path = '' as $$
declare r public.delivery_routes; v public.vehicles; s record; v_seq int; v_load numeric; v_n int := 0;
begin
  select * into r from public.delivery_routes where id = p_route for update;
  if r.id is null then raise exception 'Route not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'logistics.write');
  if r.status <> 'planned' then raise exception 'Route % is %; stops are added while it is planned', r.number, r.status using errcode = '55000'; end if;
  select coalesce(max(sequence), 0) into v_seq from public.route_stops where route_id = r.id;
  for s in select sh.* from public.shipments sh where sh.id = any (p_shipments) order by sh.city nulls last, sh.address_text loop
    if s.company_id <> r.company_id then raise exception 'Unknown shipment' using errcode = '23503'; end if;
    if s.status not in ('draft','scheduled') or (s.route_id is not null and s.route_id <> r.id) then
      raise exception 'Shipment % is % and cannot go on this route', s.number, case when s.route_id is not null then 'on another route' else s.status end
        using errcode = '55000';
    end if;
    continue when s.route_id = r.id;
    if s.address_text is null then raise exception 'Shipment % has no delivery address', s.number using errcode = '23514'; end if;
    v_seq := v_seq + 1;
    insert into public.route_stops (company_id, route_id, sequence, shipment_id, address_text, latitude, longitude)
    select r.company_id, r.id, v_seq, s.id, s.address_text, a.latitude, a.longitude
      from (select 1) x left join public.partner_addresses a on a.id = s.shipping_address_id;
    update public.shipments set route_id = r.id, status = 'scheduled', ship_date = r.route_date where id = s.id;
    perform app.shipment_event(s.id, 'scheduled', 'Planned on route ' || r.number || ' for ' || to_char(r.route_date, 'DD Mon'));
    v_n := v_n + 1;
  end loop;
  select * into v from public.vehicles where id = r.vehicle_id;
  if v.capacity_kg is not null then
    select coalesce(sum(weight_kg), 0) into v_load from public.shipments where route_id = r.id and status = 'scheduled';
    if v_load > v.capacity_kg then
      raise exception '% would carry % kg; its capacity is % kg', v.name, trim_scale(v_load), trim_scale(v.capacity_kg) using errcode = '23514';
    end if;
  end if;
  return v_n;
end $$;

create or replace function public.remove_from_route(p_shipment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.shipments; r public.delivery_routes;
begin
  select * into s from public.shipments where id = p_shipment for update;
  select * into r from public.delivery_routes where id = s.route_id;
  perform app.require_permission(s.company_id, 'logistics.write');
  if r.status <> 'planned' then raise exception 'Route % has started', r.number using errcode = '55000'; end if;
  delete from public.route_stops where shipment_id = s.id and route_id = r.id;
  -- close the gap in the sequence
  update public.route_stops set sequence = sequence + 10000 where route_id = r.id;
  update public.route_stops x set sequence = y.n from (select id, row_number() over (order by sequence) as n from public.route_stops where route_id = r.id) y
   where x.id = y.id;
  update public.shipments set route_id = null, status = 'scheduled' where id = s.id;
  perform app.shipment_event(s.id, 'scheduled', 'Removed from route ' || r.number);
end $$;

create or replace function public.reorder_route(p_route uuid, p_stop_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare r public.delivery_routes;
begin
  select * into r from public.delivery_routes where id = p_route for update;
  perform app.require_permission(r.company_id, 'logistics.write');
  if r.status <> 'planned' then raise exception 'Route % has started', r.number using errcode = '55000'; end if;
  if (select count(*) from public.route_stops where route_id = r.id) <> cardinality(p_stop_ids)
     or exists (select 1 from unnest(p_stop_ids) x where not exists (select 1 from public.route_stops s where s.id = x and s.route_id = r.id)) then
    raise exception 'Send every stop of the route, in the new order' using errcode = '23514';
  end if;
  update public.route_stops set sequence = sequence + 10000 where route_id = r.id;
  update public.route_stops s set sequence = x.n from unnest(p_stop_ids) with ordinality x(id, n) where s.id = x.id;
end $$;

create or replace function public.start_route(p_route uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare r public.delivery_routes; s record; v_n int := 0;
begin
  select * into r from public.delivery_routes where id = p_route for update;
  if r.id is null then raise exception 'Route not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'logistics.write');
  if r.status <> 'planned' then raise exception 'Route % is %', r.number, r.status using errcode = '55000'; end if;
  if not exists (select 1 from public.route_stops where route_id = r.id) then raise exception 'Add stops first' using errcode = '23514'; end if;
  for s in select sh.id from public.route_stops st join public.shipments sh on sh.id = st.shipment_id where st.route_id = r.id order by st.sequence loop
    perform app.shipment_dispatch(s.id);
    perform app.shipment_event(s.id, 'in_transit', 'Out for delivery on ' || r.number, null, 'driver');
    v_n := v_n + 1;
  end loop;
  update public.delivery_routes set status = 'in_progress', started_at = now() where id = r.id;
  return v_n;
end $$;

-- The driver at a stop: delivered (with cash collected when it is COD) or failed with a reason
create or replace function public.record_stop(p_stop uuid, p_outcome text, p_note text default null, p_cod_collected boolean default null)
returns text language plpgsql security definer set search_path = '' as $$
declare st public.route_stops; r public.delivery_routes;
begin
  select * into st from public.route_stops where id = p_stop for update;
  if st.id is null then raise exception 'Stop not found' using errcode = 'P0002'; end if;
  select * into r from public.delivery_routes where id = st.route_id;
  perform app.require_permission(r.company_id, 'logistics.write');
  if r.status <> 'in_progress' then raise exception 'Start route % first', r.number using errcode = '55000'; end if;
  if st.status not in ('pending','arrived') then raise exception 'Stop % is already %', st.sequence, st.status using errcode = '55000'; end if;
  if p_outcome not in ('delivered','failed','skipped') then raise exception 'Unknown outcome %', p_outcome using errcode = '22023'; end if;
  if st.shipment_id is not null and p_outcome <> 'skipped' then
    perform public.update_shipment(st.shipment_id, p_outcome, p_note, st.address_text, p_cod_collected);
  elsif st.shipment_id is not null then
    perform public.update_shipment(st.shipment_id, 'failed', coalesce(nullif(btrim(p_note), ''), 'Stop skipped'), st.address_text);
  end if;
  update public.route_stops set status = p_outcome, actual_arrival = now(), outcome_note = nullif(btrim(p_note), '') where id = st.id;
  return p_outcome;
end $$;

create or replace function public.complete_route(p_route uuid, p_km numeric default null)
returns text language plpgsql security definer set search_path = '' as $$
declare r public.delivery_routes;
begin
  select * into r from public.delivery_routes where id = p_route for update;
  perform app.require_permission(r.company_id, 'logistics.write');
  if r.status <> 'in_progress' then raise exception 'Route % is %', r.number, r.status using errcode = '55000'; end if;
  if exists (select 1 from public.route_stops where route_id = r.id and status in ('pending','arrived')) then
    raise exception 'Record every stop first' using errcode = '55000';
  end if;
  update public.delivery_routes set status = 'completed', completed_at = now(), actual_distance_km = coalesce(p_km, actual_distance_km) where id = r.id;
  return 'completed';
end $$;

-- -----------------------------------------------------------------------------
-- 4. Cash on delivery settlement → customer receipts
-- -----------------------------------------------------------------------------
create or replace function public.settle_cod(p_shipments uuid[], p_bank_account uuid, p_date date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s record; v_company uuid; v_pay uuid; v_left numeric; i record; v_out jsonb := '[]'::jsonb; b public.bank_accounts;
begin
  select company_id into v_company from public.shipments where id = any (p_shipments) limit 1;
  if v_company is null then raise exception 'Select shipments to settle' using errcode = '23514'; end if;
  perform app.require_permission(v_company, 'invoicing.write');
  select * into b from public.bank_accounts where id = p_bank_account and company_id = v_company;
  if b.id is null then raise exception 'Choose where the cash goes' using errcode = '23514'; end if;
  for s in select sh.*, d.sales_order_id from public.shipments sh left join public.deliveries d on d.id = sh.delivery_id
            where sh.id = any (p_shipments) order by sh.number for update of sh loop
    if s.company_id <> v_company then raise exception 'Unknown shipment' using errcode = '23503'; end if;
    if not s.cod_collected or s.cod_amount <= 0 then raise exception 'Shipment % has no collected cash on delivery', s.number using errcode = '23514'; end if;
    if s.cod_settled_at is not null then raise exception 'Shipment % is already settled', s.number using errcode = '55000'; end if;
    insert into public.payments (company_id, document_type, partner_id, payment_date, method, amount, currency_code, bank_account_id, reference, notes)
    values (v_company, 'customer_payment', s.partner_id, coalesce(p_date, current_date), 'cash', s.cod_amount, b.currency_code, b.id,
            'COD ' || s.number, 'Cash on delivery collected by the driver')
    returning id into v_pay;
    v_left := s.cod_amount;
    for i in select si.id, si.amount_due from public.sales_invoices si
              where si.company_id = v_company and si.partner_id = s.partner_id and si.status = 'posted' and si.document_type = 'sales_invoice'
                and si.amount_due > 0 and (s.sales_order_id is null or si.sales_order_id = s.sales_order_id)
              order by si.invoice_date, si.number loop
      exit when v_left <= 0;
      insert into public.payment_allocations (company_id, payment_id, sales_invoice_id, amount) values (v_company, v_pay, i.id, least(v_left, i.amount_due));
      v_left := v_left - least(v_left, i.amount_due);
    end loop;
    perform public.post_payment(v_pay);
    update public.shipments set cod_settled_at = now(), cod_payment_id = v_pay where id = s.id;
    perform app.shipment_event(s.id, s.status, 'Cash on delivery settled · ' || (select number from public.payments where id = v_pay), null, 'office');
    v_out := v_out || jsonb_build_object('shipment', s.number, 'payment_id', v_pay, 'unallocated', v_left);
  end loop;
  return v_out;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Planning board and overview
-- -----------------------------------------------------------------------------
-- What can go out: picked or open deliveries without a live shipment, and shipments not yet on a route
create or replace function public.dispatch_queue(p_company uuid, p_warehouse uuid default null)
returns table (kind text, id uuid, number text, delivery_id uuid, delivery_number text, partner text, city text, address text,
               scheduled_date date, status text, weight_kg numeric, packages int, cod_amount numeric)
language sql stable security definer set search_path = '' as $$
  select 'delivery', d.id, d.number, d.id, d.number, p.name, a.city, concat_ws(', ', a.line1, a.city), d.scheduled_date, d.status,
         coalesce(d.shipping_weight_kg, (select nullif(sum(l.quantity * coalesce(v.weight_kg, 0)), 0) from public.delivery_lines l
                                           join public.product_variants v on v.id = l.variant_id where l.delivery_id = d.id)),
         d.package_count, 0::numeric
    from public.deliveries d join public.business_partners p on p.id = d.partner_id
    left join lateral (select * from public.partner_addresses x where x.id = d.shipping_address_id
                        or (d.shipping_address_id is null and x.partner_id = d.partner_id and x.deleted_at is null)
                        order by (x.id = d.shipping_address_id) desc nulls last, x.is_default desc limit 1) a on true
   where d.company_id = p_company and d.deleted_at is null and d.status in ('draft','ready') and d.delivery_type = 'outbound'
     and (p_warehouse is null or d.warehouse_id = p_warehouse)
     and not exists (select 1 from public.shipments s where s.delivery_id = d.id and s.deleted_at is null and s.status not in ('cancelled','failed'))
     and app.has_permission(p_company, 'logistics.read')
  union all
  select 'shipment', s.id, s.number, s.delivery_id, d.number, p.name, s.city, s.address_text, s.ship_date, s.status, s.weight_kg, s.packages, s.cod_amount
    from public.shipments s join public.business_partners p on p.id = s.partner_id left join public.deliveries d on d.id = s.delivery_id
   where s.company_id = p_company and s.deleted_at is null and s.status in ('draft','scheduled','failed') and s.route_id is null
     and (p_warehouse is null or d.warehouse_id = p_warehouse)
     and app.has_permission(p_company, 'logistics.read')
   order by 9 nulls last, 7 nulls last, 3
$$;

create or replace function public.logistics_overview(p_company uuid, p_from date default null, p_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_from date := coalesce(p_from, date_trunc('month', current_date)::date); v_to date := coalesce(p_to, current_date); v jsonb;
begin
  if not app.has_permission(p_company, 'logistics.read') then raise exception 'Permission denied: logistics.read required' using errcode = '42501'; end if;
  select jsonb_build_object(
    'to_dispatch', (select count(*) from public.dispatch_queue(p_company)),
    'in_transit', (select count(*) from public.shipments where company_id = p_company and status = 'in_transit' and deleted_at is null),
    'routes_today', (select count(*) from public.delivery_routes where company_id = p_company and route_date = current_date and status <> 'cancelled' and deleted_at is null),
    'delivered', (select count(*) from public.shipments where company_id = p_company and status = 'delivered' and delivered_at::date between v_from and v_to),
    'failed', (select count(*) from public.shipment_events e join public.shipments s on s.id = e.shipment_id
                where s.company_id = p_company and e.status = 'failed' and e.event_at::date between v_from and v_to),
    'on_time_pct', (select round(100.0 * count(*) filter (where delivered_at::date <= ship_date + 1) / nullif(count(*), 0), 1)
                      from public.shipments where company_id = p_company and status = 'delivered' and delivered_at::date between v_from and v_to),
    'first_attempt_pct', (select round(100.0 * count(*) filter (where attempts = 1) / nullif(count(*), 0), 1)
                            from public.shipments where company_id = p_company and status = 'delivered' and delivered_at::date between v_from and v_to),
    'cod_to_settle', (select coalesce(sum(cod_amount), 0) from public.shipments where company_id = p_company and cod_collected and cod_settled_at is null),
    'cod_outstanding', (select coalesce(sum(cod_amount), 0) from public.shipments where company_id = p_company and cod_amount > 0 and not cod_collected
                          and status in ('scheduled','in_transit','failed')),
    'by_carrier', (select coalesce(jsonb_agg(x order by x.shipments desc), '[]') from (
                     select coalesce(c.name, 'Own fleet') as carrier, count(*) as shipments,
                            count(*) filter (where s.status = 'delivered') as delivered, count(*) filter (where s.status = 'failed') as failed,
                            round(avg(extract(epoch from (s.delivered_at - s.ship_date::timestamptz)) / 86400) filter (where s.status = 'delivered'), 1) as avg_days
                       from public.shipments s left join public.carriers c on c.id = s.carrier_id
                      where s.company_id = p_company and s.deleted_at is null and s.ship_date between v_from and v_to
                      group by c.name) x),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('day', d, 'delivered', n, 'failed', f) order by d), '[]') from (
                 select s.delivered_at::date as d, count(*) as n, 0 as f from public.shipments s
                  where s.company_id = p_company and s.status = 'delivered' and s.delivered_at::date between v_from and v_to group by 1) y))
  into v;
  return v;
end $$;

-- -----------------------------------------------------------------------------
-- 6. E-commerce
-- -----------------------------------------------------------------------------
-- Normalised payload:
-- {"id":"…","number":"#1001","created_at":"…","currency":"ALL","prices_include_tax":true,
--  "customer":{"email":"…","name":"…","phone":"…"},
--  "shipping_address":{"line1":"…","city":"…","postal_code":"…","country":"AL"},
--  "lines":[{"sku":"…","quantity":2,"price":1200}], "shipping":300, "payment":"cod"|"paid"}
create or replace function public.ingest_channel_order(p_channel uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  ch public.sales_channels; co public.channel_orders; v_partner uuid; v_order uuid; v_wh uuid; l jsonb; v_var record; v_n int := 0;
  v_net numeric; v_err text; v_missing text; v_email text; v_cur text; v_log uuid; v_incl boolean;
begin
  select * into ch from public.sales_channels where id = p_channel;
  if ch.id is null then raise exception 'Channel not found' using errcode = 'P0002'; end if;
  -- the webhook Edge Function calls with the service role key; people need ecommerce.write
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', current_setting('request.jwt.claim.role', true), '') <> 'service_role' then
    perform app.require_permission(ch.company_id, 'ecommerce.write');
  end if;
  if nullif(p_payload ->> 'id', '') is null then raise exception 'The order has no id' using errcode = '23514'; end if;

  insert into public.channel_orders (company_id, channel_id, external_order_id, external_order_number, payload)
  values (ch.company_id, ch.id, p_payload ->> 'id', p_payload ->> 'number', p_payload)
  on conflict (channel_id, external_order_id) do nothing
  returning * into co;
  if co.id is null then
    select * into co from public.channel_orders where channel_id = ch.id and external_order_id = p_payload ->> 'id';
    if co.import_status in ('imported','ignored') then
      return jsonb_build_object('status', 'duplicate', 'channel_order_id', co.id, 'sales_order_id', co.sales_order_id);
    end if;
    update public.channel_orders set payload = p_payload where id = co.id;
  end if;
  insert into public.channel_sync_logs (company_id, channel_id, sync_type, direction, status) values (ch.company_id, ch.id, 'orders', 'inbound', 'running')
  returning id into v_log;

  begin
    -- SKUs first: an order with unknown items is not imported
    select string_agg(x ->> 'sku', ', ') into v_missing from jsonb_array_elements(p_payload -> 'lines') x
     where not exists (select 1 from public.product_variants v where v.company_id = ch.company_id and v.deleted_at is null and v.sku = x ->> 'sku')
       and not exists (select 1 from public.channel_product_links k where k.channel_id = ch.id
                         and (k.external_variant_id = x ->> 'sku' or k.external_product_id = x ->> 'sku'));
    if v_missing is not null then raise exception 'Unknown SKU: %', v_missing using errcode = 'P0002'; end if;
    if jsonb_array_length(coalesce(p_payload -> 'lines', '[]')) = 0 then raise exception 'The order has no lines' using errcode = '23514'; end if;

    v_email := lower(nullif(btrim(p_payload #>> '{customer,email}'), ''));
    if v_email is not null then
      select id into v_partner from public.business_partners where company_id = ch.company_id and lower(email) = v_email and deleted_at is null
       order by is_customer desc limit 1;
      if v_partner is null then
        insert into public.business_partners (company_id, code, name, kind, is_customer, email, phone, tags, notes)
        values (ch.company_id, app.next_document_number(ch.company_id, 'customer_code'),
                coalesce(nullif(btrim(p_payload #>> '{customer,name}'), ''), v_email), 'individual', true, v_email, p_payload #>> '{customer,phone}',
                array['web'], 'Created from ' || ch.name)
        returning id into v_partner;
        insert into public.partner_addresses (company_id, partner_id, address_type, line1, city, postal_code, country_code, is_default)
        select ch.company_id, v_partner, 'shipping', p_payload #>> '{shipping_address,line1}', p_payload #>> '{shipping_address,city}',
               p_payload #>> '{shipping_address,postal_code}', coalesce(p_payload #>> '{shipping_address,country}', (select country_code from public.companies where id = ch.company_id)), true
         where p_payload #>> '{shipping_address,line1}' is not null;
      end if;
    end if;
    v_partner := coalesce(v_partner, ch.default_customer_id);
    if v_partner is null then raise exception 'The order has no customer email and the channel has no default customer' using errcode = '23514'; end if;

    v_wh := coalesce(ch.warehouse_id, (select default_warehouse_id from public.company_settings where company_id = ch.company_id),
                     (select id from public.warehouses where company_id = ch.company_id and deleted_at is null order by created_at limit 1));
    v_cur := coalesce(p_payload ->> 'currency', (select base_currency from public.companies where id = ch.company_id));
    v_incl := coalesce((p_payload ->> 'prices_include_tax')::boolean, (ch.settings ->> 'prices_include_tax')::boolean, true);
    insert into public.sales_orders (company_id, partner_id, warehouse_id, currency_code, price_list_id, channel, customer_reference, order_date, notes,
                                     shipping_address_id)
    values (ch.company_id, v_partner, v_wh, v_cur, ch.price_list_id, case when ch.channel_type = 'marketplace' then 'marketplace' else 'ecommerce' end,
            coalesce(p_payload ->> 'number', p_payload ->> 'id'), coalesce((p_payload ->> 'created_at')::date, current_date),
            ch.name || ' order ' || coalesce(p_payload ->> 'number', p_payload ->> 'id') || case when p_payload ->> 'payment' = 'cod' then ' · cash on delivery' else '' end,
            (select id from public.partner_addresses where partner_id = v_partner and deleted_at is null order by (address_type = 'shipping') desc, is_default desc limit 1))
    returning id into v_order;
    for l in select * from jsonb_array_elements(p_payload -> 'lines') loop
      select v.id, v.name, p.sales_tax_code_id, coalesce(t.rate, 0) as rate into v_var
        from public.product_variants v join public.products p on p.id = v.product_id left join public.tax_codes t on t.id = p.sales_tax_code_id
       where v.company_id = ch.company_id and v.deleted_at is null
         and (v.sku = l ->> 'sku' or v.id = (select k.variant_id from public.channel_product_links k where k.channel_id = ch.id
                                                and (k.external_variant_id = l ->> 'sku' or k.external_product_id = l ->> 'sku') limit 1))
       limit 1;
      v_n := v_n + 1;
      v_net := (l ->> 'price')::numeric / case when v_incl then 1 + v_var.rate / 100 else 1 end;
      insert into public.sales_order_lines (company_id, sales_order_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
      values (ch.company_id, v_order, v_n, v_var.id, v_var.name, (l ->> 'quantity')::numeric, round(v_net, 4), v_var.sales_tax_code_id);
    end loop;
    if coalesce((p_payload ->> 'shipping')::numeric, 0) > 0 then
      v_n := v_n + 1;
      insert into public.sales_order_lines (company_id, sales_order_id, line_no, description, quantity, unit_price, tax_code_id)
      select ch.company_id, v_order, v_n, 'Shipping', 1,
             round((p_payload ->> 'shipping')::numeric / case when v_incl then 1 + coalesce(t.rate, 0) / 100 else 1 end, 4), s.default_sales_tax_code_id
        from public.company_settings s left join public.tax_codes t on t.id = s.default_sales_tax_code_id where s.company_id = ch.company_id;
    end if;
    update public.channel_orders set import_status = 'imported', sales_order_id = v_order, imported_at = now(), error_message = null where id = co.id;
    update public.channel_sync_logs set status = 'success', records_processed = 1, finished_at = now() where id = v_log;
    update public.sales_channels set last_synced_at = now() where id = ch.id;
    perform app.notify_role(ch.company_id, (select id from public.roles where key = 'sales_manager'), 'info',
                            'New ' || ch.name || ' order ' || coalesce(p_payload ->> 'number', ''), null, '/sales/orders/' || v_order, 'sales_orders', v_order);
    return jsonb_build_object('status', 'imported', 'channel_order_id', co.id, 'sales_order_id', v_order);
  exception when others then
    get stacked diagnostics v_err = message_text;
    update public.channel_orders set import_status = 'failed', error_message = v_err where id = co.id;
    update public.channel_sync_logs set status = 'failed', records_failed = 1, error_message = v_err, finished_at = now() where id = v_log;
    return jsonb_build_object('status', 'failed', 'channel_order_id', co.id, 'error', v_err);
  end;
end $$;

create or replace function public.retry_channel_order(p_channel_order uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare co public.channel_orders;
begin
  select * into co from public.channel_orders where id = p_channel_order;
  if co.id is null then raise exception 'Channel order not found' using errcode = 'P0002'; end if;
  perform app.require_permission(co.company_id, 'ecommerce.write');
  if co.import_status <> 'failed' then raise exception 'Only failed imports are retried' using errcode = '55000'; end if;
  return public.ingest_channel_order(co.channel_id, co.payload);
end $$;

-- Links every active variant by SKU (placeholder for the connector's product sync)
create or replace function public.link_channel_products(p_channel uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare ch public.sales_channels; v_n int;
begin
  select * into ch from public.sales_channels where id = p_channel;
  perform app.require_permission(ch.company_id, 'ecommerce.write');
  insert into public.channel_product_links (company_id, channel_id, variant_id, external_product_id, external_variant_id)
  select ch.company_id, ch.id, v.id, v.sku, v.sku from public.product_variants v join public.products p on p.id = v.product_id
   where v.company_id = ch.company_id and v.deleted_at is null and v.is_active and p.is_sellable
  on conflict (channel_id, variant_id) do nothing;
  get diagnostics v_n = row_count;
  insert into public.channel_sync_logs (company_id, channel_id, sync_type, direction, status, records_processed, finished_at)
  values (ch.company_id, ch.id, 'products', 'outbound', 'success', v_n, now());
  return v_n;
end $$;

-- What a stock sync pushes: available quantity per linked SKU in the channel's warehouse
create or replace function public.sync_channel_stock(p_channel uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ch public.sales_channels; v jsonb; v_n int;
begin
  select * into ch from public.sales_channels where id = p_channel;
  perform app.require_permission(ch.company_id, 'ecommerce.write');
  select coalesce(jsonb_agg(jsonb_build_object('sku', k.external_variant_id, 'available', greatest(coalesce(s.avail, 0), 0)) order by k.external_variant_id), '[]'),
         count(*)
    into v, v_n
    from public.channel_product_links k
    left join lateral (select sum(sl.available) as avail from public.stock_levels sl join public.warehouse_locations wl on wl.id = sl.location_id
                        where sl.variant_id = k.variant_id and (ch.warehouse_id is null or sl.warehouse_id = ch.warehouse_id)
                          and wl.location_type in ('internal','picking','putaway','packing')) s on true
   where k.channel_id = ch.id and k.sync_enabled;
  update public.channel_product_links set last_synced_at = now() where channel_id = ch.id and sync_enabled;
  insert into public.channel_sync_logs (company_id, channel_id, sync_type, direction, status, records_processed, finished_at, error_message)
  values (ch.company_id, ch.id, 'stock', 'outbound', case when ch.is_active then 'success' else 'partial' end, v_n, now(),
          case when not ch.is_active then 'Channel is not active: quantities computed, nothing sent' end);
  update public.sales_channels set last_synced_at = now() where id = ch.id;
  return jsonb_build_object('items', v, 'count', v_n, 'sent', ch.is_active);
end $$;

-- -----------------------------------------------------------------------------
-- 7. Grants
-- -----------------------------------------------------------------------------
revoke execute on function app.shipment_event(uuid, text, text, text, text), app.shipment_dispatch(uuid) from public, anon, authenticated;
grant execute on function public.create_shipment(uuid, jsonb), public.ship_with_carrier(uuid, uuid, text),
  public.update_shipment(uuid, text, text, text, boolean), public.create_route(uuid, date, uuid, uuid, uuid, uuid[]),
  public.assign_to_route(uuid, uuid[]), public.remove_from_route(uuid), public.reorder_route(uuid, uuid[]), public.start_route(uuid),
  public.record_stop(uuid, text, text, boolean), public.complete_route(uuid, numeric), public.settle_cod(uuid[], uuid, date),
  public.dispatch_queue(uuid, uuid), public.logistics_overview(uuid, date, date), public.ingest_channel_order(uuid, jsonb),
  public.retry_channel_order(uuid), public.link_channel_products(uuid), public.sync_channel_stock(uuid) to authenticated;
grant execute on function public.ingest_channel_order(uuid, jsonb) to service_role;
