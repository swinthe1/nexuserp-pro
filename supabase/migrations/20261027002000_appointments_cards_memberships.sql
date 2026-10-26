-- =============================================================================
-- For businesses that serve people by appointment: salons and barbers, clinics and dentists,
-- vets, car services, gyms and clubs.
--   · Appointments: who (a person, a chair, a room, a lift) does which service when; a day calendar;
--     the client arrives, the work is done and becomes an invoice with one click; reminders by email.
--   · Client cards: a vehicle (plate, VIN, km), a patient, a pet, a device — with the history of every visit.
--   · Memberships: monthly, yearly or by visits; sold to an invoice, checked in at the door, renewed, expiring ones flagged.
-- New types of business: beauty, clinic, auto_service, fitness.
-- =============================================================================

alter table public.companies drop constraint if exists companies_business_type_check;
alter table public.companies add constraint companies_business_type_check
  check (business_type in ('general', 'retail', 'cafe', 'restaurant', 'wholesale', 'manufacturing', 'services', 'hotel', 'beauty', 'clinic', 'auto_service', 'fitness'));

-- the menu: the new part 'Appointments' only for those who use it
create or replace function app.business_type_hidden_menu(p_type text)
returns text[] language sql immutable set search_path = '' as $$
  select case p_type
    when 'retail' then array['Warehouse|menu', 'Manufacturing', 'Logistics', 'Hotel', 'Appointments',
      '/pos/waiters', '/manufacturing/boms', '/crm/pipeline', '/crm/leads', '/sales/quotes', '/sales/recurring', '/agent', '/sales/agents',
      '/oms/fulfillment', '/procurement/requisitions']
    when 'cafe' then array['Warehouse|menu', 'Manufacturing', 'Logistics', 'Hotel', 'Appointments',
      '/sales', '/crm/pipeline', '/crm/leads', '/sales/quotes', '/sales/orders', '/sales/deliveries', '/sales/recurring', '/agent', '/sales/agents', '/sales/price-lists',
      '/inventory/labels', '/inventory/levelling', '/inventory/landed-costs', '/oms/fulfillment', '/procurement/requisitions', '/procurement/replenishment']
    when 'restaurant' then array['Warehouse|menu', 'Manufacturing', 'Logistics', 'Hotel', 'Appointments',
      '/sales', '/crm/pipeline', '/crm/leads', '/sales/quotes', '/sales/orders', '/sales/deliveries', '/sales/recurring', '/agent', '/sales/agents', '/sales/price-lists',
      '/inventory/labels', '/inventory/levelling', '/inventory/landed-costs', '/oms/fulfillment', '/procurement/requisitions', '/procurement/replenishment']
    when 'wholesale' then array['Retail', 'Manufacturing', 'Hotel', 'Appointments', '/sales/promotions']
    when 'manufacturing' then array['Retail', 'Hotel', 'Appointments', '/sales/promotions', '/inventory/levelling']
    -- services: quotes, invoices, appointments with cards, the books and staff; no goods
    when 'services' then array['Inventory|menu', 'Warehouse|menu', 'Retail', 'Manufacturing', 'Logistics', 'Hotel',
      '/appointments/memberships', '/sales/deliveries', '/sales/promotions', '/agent', '/sales/agents', '/oms/fulfillment', '/procurement/replenishment', '/procurement/vendor-prices']
    when 'hotel' then array['Warehouse|menu', 'Manufacturing', 'Logistics', 'Appointments',
      '/sales/deliveries', '/sales/promotions', '/sales/recurring', '/agent', '/sales/agents', '/oms/fulfillment',
      '/inventory/labels', '/inventory/levelling', '/inventory/landed-costs', '/procurement/requisitions', '/procurement/replenishment']
    -- a salon or barber: appointments, client cards, the till for products, stock of what is sold and used
    when 'beauty' then array['Warehouse|menu', 'Manufacturing', 'Logistics', 'Hotel',
      '/pos/waiters', '/crm/pipeline', '/crm/leads', '/sales/quotes', '/sales/orders', '/sales/deliveries', '/sales/recurring', '/agent', '/sales/agents', '/sales/price-lists',
      '/inventory/labels', '/inventory/levelling', '/inventory/landed-costs', '/oms/fulfillment', '/procurement/requisitions', '/procurement/replenishment']
    -- a clinic, dentist or vet: appointments, patient cards, invoices, the materials used
    when 'clinic' then array['Warehouse|menu', 'Manufacturing', 'Logistics', 'Hotel', '/appointments/memberships',
      '/pos/waiters', '/crm/pipeline', '/crm/leads', '/sales/orders', '/sales/deliveries', '/sales/promotions', '/agent', '/sales/agents', '/sales/price-lists',
      '/inventory/labels', '/inventory/levelling', '/inventory/landed-costs', '/oms/fulfillment', '/procurement/requisitions']
    -- a car service: appointments for the lifts, vehicle cards with the km, parts in stock, quotes and invoices
    when 'auto_service' then array['Warehouse|menu', 'Manufacturing', 'Logistics', 'Hotel', '/appointments/memberships',
      '/pos/waiters', '/crm/pipeline', '/crm/leads', '/sales/deliveries', '/sales/promotions', '/sales/recurring', '/agent', '/sales/agents',
      '/inventory/levelling', '/oms/fulfillment']
    -- a gym or club: memberships and check-in at the door, the till for drinks and supplements
    when 'fitness' then array['Warehouse|menu', 'Manufacturing', 'Logistics', 'Hotel',
      '/pos/waiters', '/crm/pipeline', '/sales/quotes', '/sales/orders', '/sales/deliveries', '/agent', '/sales/agents', '/sales/price-lists',
      '/inventory/labels', '/inventory/levelling', '/inventory/landed-costs', '/oms/fulfillment', '/procurement/requisitions', '/procurement/replenishment']
    else array['Hotel', 'Appointments']::text[] end
$$;
-- the businesses there are already do not suddenly see a new part of the menu
update public.company_settings s set hidden_menu_sections = array_append(coalesce(s.hidden_menu_sections, '{}'), 'Appointments')
 where not ('Appointments' = any (coalesce(s.hidden_menu_sections, '{}')))
   and (select business_type from public.companies where id = s.company_id) not in ('services', 'beauty', 'clinic', 'auto_service', 'fitness');

-- a service sold by appointment or membership is a service item on the invoice (made once)
create or replace function app.service_variant(p_co uuid, p_name text, p_gross numeric, p_tax uuid, p_prefix text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_prod uuid; v_var uuid; v_uom uuid; v_tax uuid; v_code text;
begin
  select id into v_uom from public.units_of_measure where company_id = p_co and category = 'unit' and is_reference and deleted_at is null limit 1;
  v_tax := coalesce(p_tax, (select default_sales_tax_code_id from public.company_settings where company_id = p_co));
  v_code := p_prefix || '-' || upper(left(regexp_replace(p_name, '[^A-Za-z0-9]', '', 'g'), 10)) || '-' || left(replace(gen_random_uuid()::text, '-', ''), 4);
  insert into public.products (company_id, code, name, product_type, uom_id, sales_price, sales_tax_code_id, is_sellable, is_purchasable)
  values (p_co, v_code, p_name, 'service', v_uom, round(coalesce(p_gross, 0) / (1 + coalesce((select rate from public.tax_codes where id = v_tax), 0) / 100), 4), v_tax, true, false)
  returning id into v_prod;
  insert into public.product_variants (company_id, product_id, sku, name, is_default) values (p_co, v_prod, v_code, p_name, true) returning id into v_var;
  return v_var;
end $$;

-- a client by name and phone, made when there is none (as the hotel does for walk-in guests)
create or replace function app.client_for(p_co uuid, p_partner uuid, p_name text, p_phone text, p_email text, p_code_prefix text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  if p_partner is not null then return p_partner; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Give the client''s name' using errcode = '23514'; end if;
  select id into v from public.business_partners where company_id = p_co and is_customer and deleted_at is null
     and lower(name) = lower(btrim(p_name)) and coalesce(phone, '') = coalesce(nullif(btrim(p_phone), ''), coalesce(phone, '')) limit 1;
  if v is null then
    insert into public.business_partners (company_id, code, name, is_customer, phone, email, kind)
    values (p_co, public.next_partner_code(p_co, 'customer'), btrim(p_name), true, nullif(btrim(p_phone), ''), nullif(btrim(p_email), ''), 'individual')
    returning id into v;
  end if;
  return v;
end $$;

-- =============================================================================
-- Client cards (2b first: appointments point at them)
-- =============================================================================
create table if not exists public.client_cards (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  kind        text not null check (kind in ('vehicle', 'patient', 'pet', 'client', 'device')),
  partner_id  uuid,                       -- the owner / the patient's payer
  title       text not null,              -- the plate, the patient's or pet's name, the device
  attrs       jsonb not null default '{}',
  notes       text,
  is_active   boolean not null default true,
  foreign key (company_id, partner_id) references public.business_partners(company_id, id)
);
select app.register_table('public.client_cards', 'sales');
create index if not exists client_cards_search_idx on public.client_cards (company_id, kind, lower(title)) where deleted_at is null;
create index if not exists client_cards_partner_idx on public.client_cards (partner_id) where deleted_at is null;

create table if not exists public.card_entries (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id),
  card_id        uuid not null,
  entry_date     date not null default current_date,
  title          text not null,
  body           text,
  attrs          jsonb not null default '{}',   -- km, diagnosis, treatment, next visit…
  appointment_id uuid,
  invoice_id     uuid,
  foreign key (company_id, card_id) references public.client_cards(company_id, id) on delete cascade
);
select app.register_table('public.card_entries', 'sales', p_soft_delete => false);
create index if not exists card_entries_card_idx on public.card_entries (card_id, entry_date desc);

-- =============================================================================
-- Appointments
-- =============================================================================
create table if not exists public.appt_resources (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name       text not null,
  kind       text not null default 'person' check (kind in ('person', 'chair', 'room', 'bay', 'device')),
  user_id    uuid references auth.users(id),
  color      text not null default '#0E8A5F',
  -- opening hours by ISO weekday (1 Monday … 7 Sunday): [["08:00","12:00"],["13:00","17:00"]]
  hours      jsonb not null default '{"1":[["08:00","17:00"]],"2":[["08:00","17:00"]],"3":[["08:00","17:00"]],"4":[["08:00","17:00"]],"5":[["08:00","17:00"]],"6":[["08:00","14:00"]]}',
  sort       int not null default 0,
  is_active  boolean not null default true
);
select app.register_table('public.appt_resources', 'sales');

create table if not exists public.appt_services (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  name         text not null,
  duration_min int not null default 30 check (duration_min between 5 and 1440),
  price        numeric(18,2) not null default 0 check (price >= 0),   -- with VAT
  tax_code_id  uuid references public.tax_codes(id),
  variant_id   uuid,
  color        text,
  resource_ids uuid[] not null default '{}',                           -- who can do it; empty: everyone
  sort         int not null default 0,
  is_active    boolean not null default true,
  foreign key (company_id, variant_id) references public.product_variants(company_id, id)
);
select app.register_table('public.appt_services', 'sales');

create table if not exists public.appointments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  number       text,
  status       text not null default 'booked',
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  resource_id  uuid not null,
  service_id   uuid,
  partner_id   uuid,
  client_name  text not null,
  client_phone text,
  client_email text,
  card_id      uuid,
  price        numeric(18,2) not null default 0 check (price >= 0),
  notes        text,
  source       text not null default 'phone' check (source in ('phone', 'walk_in', 'online', 'whatsapp', 'social', 'other')),
  reminded_at  timestamptz,
  arrived_at   timestamptz,
  done_at      timestamptz,
  invoice_id   uuid,
  check (ends_at > starts_at),
  foreign key (company_id, resource_id) references public.appt_resources(company_id, id),
  foreign key (company_id, service_id) references public.appt_services(company_id, id),
  foreign key (company_id, partner_id) references public.business_partners(company_id, id),
  foreign key (company_id, card_id) references public.client_cards(company_id, id)
);
select app.register_table('public.appointments', 'sales');
insert into public.document_types (key, name, module, table_name, default_prefix)
values ('appointment', 'Appointment', 'sales', 'appointments', 'TER-') on conflict (key) do nothing;
insert into public.status_transitions (doc_type, from_status, to_status) values
  ('appointment', '__init__', 'booked'), ('appointment', 'booked', 'confirmed'), ('appointment', 'booked', 'arrived'), ('appointment', 'confirmed', 'arrived'),
  ('appointment', 'booked', 'done'), ('appointment', 'confirmed', 'done'), ('appointment', 'arrived', 'done'),
  ('appointment', 'booked', 'no_show'), ('appointment', 'confirmed', 'no_show'), ('appointment', 'booked', 'cancelled'), ('appointment', 'confirmed', 'cancelled'),
  ('appointment', 'arrived', 'cancelled'), ('appointment', 'cancelled', 'booked'), ('appointment', 'no_show', 'booked'), ('appointment', 'arrived', 'booked')
on conflict do nothing;
select app.register_document('public.appointments', 'appointment', 'starts_at');
create index if not exists appointments_time_idx on public.appointments (company_id, starts_at) where deleted_at is null;
create index if not exists appointments_resource_idx on public.appointments (resource_id, starts_at) where deleted_at is null;

-- one client at a time per person or chair
create or replace function app.tg_appt_no_overlap()
returns trigger language plpgsql set search_path = '' as $$
declare v text;
begin
  if new.status in ('cancelled', 'no_show') or new.deleted_at is not null then return new; end if;
  select coalesce(a.client_name, '') || ' ' || to_char(a.starts_at at time zone coalesce((select timezone from public.companies where id = a.company_id), 'Europe/Tirane'), 'HH24:MI')
    into v from public.appointments a
   where a.resource_id = new.resource_id and a.id <> new.id and a.deleted_at is null and a.status not in ('cancelled', 'no_show')
     and tstzrange(a.starts_at, a.ends_at) && tstzrange(new.starts_at, new.ends_at) limit 1;
  if v is not null then raise exception 'That time is already taken (%)', v using errcode = '23P01'; end if;
  return new;
end $$;
drop trigger if exists trg_06_no_overlap on public.appointments;
create trigger trg_06_no_overlap before insert or update of resource_id, starts_at, ends_at, status on public.appointments
  for each row execute function app.tg_appt_no_overlap();

-- a day (or several) of the calendar
create or replace function public.appt_board(p_company uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_tz text;
begin
  perform app.require_permission(p_company, 'sales.read');
  select coalesce(timezone, 'Europe/Tirane') into v_tz from public.companies where id = p_company;
  return jsonb_build_object(
    'timezone', v_tz,
    'resources', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', kind, 'color', color, 'hours', hours) order by sort, name), '[]')
                    from public.appt_resources where company_id = p_company and deleted_at is null and is_active),
    'services', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'duration_min', duration_min, 'price', price, 'color', color, 'resource_ids', resource_ids) order by sort, name), '[]')
                    from public.appt_services where company_id = p_company and deleted_at is null and is_active),
    'appointments', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'number', a.number, 'status', a.status, 'starts_at', a.starts_at, 'ends_at', a.ends_at,
                       'resource_id', a.resource_id, 'service_id', a.service_id, 'service', s.name, 'color', coalesce(s.color, r.color), 'partner_id', a.partner_id,
                       'client_name', a.client_name, 'client_phone', a.client_phone, 'client_email', a.client_email, 'card_id', a.card_id, 'card', c.title, 'card_kind', c.kind,
                       'price', a.price, 'notes', a.notes, 'source', a.source, 'invoice_id', a.invoice_id, 'reminded_at', a.reminded_at) order by a.starts_at), '[]')
                      from public.appointments a join public.appt_resources r on r.id = a.resource_id
                      left join public.appt_services s on s.id = a.service_id left join public.client_cards c on c.id = a.card_id
                     where a.company_id = p_company and a.deleted_at is null
                       and a.starts_at >= (p_from::timestamp at time zone v_tz) and a.starts_at < ((p_to + 1)::timestamp at time zone v_tz)));
end $$;

-- free times for a service on a day: every 15 minutes inside the opening hours, around what is booked
create or replace function public.appt_slots(p_company uuid, p_service uuid, p_day date, p_resource uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_tz text; s public.appt_services; r record; h jsonb; v_from time; v_to time; t timestamptz; v_end timestamptz; v_out jsonb := '[]';
begin
  perform app.require_permission(p_company, 'sales.read');
  select coalesce(timezone, 'Europe/Tirane') into v_tz from public.companies where id = p_company;
  select * into s from public.appt_services where id = p_service and company_id = p_company;
  if s.id is null then raise exception 'Service not found' using errcode = 'P0002'; end if;
  for r in select * from public.appt_resources where company_id = p_company and deleted_at is null and is_active
             and (p_resource is null or id = p_resource) and (cardinality(s.resource_ids) = 0 or id = any (s.resource_ids)) order by sort, name loop
    for h in select * from jsonb_array_elements(coalesce(r.hours -> extract(isodow from p_day)::text, '[]')) loop
      v_from := (h ->> 0)::time; v_to := (h ->> 1)::time;
      t := (p_day + v_from) at time zone v_tz;
      while t + make_interval(mins => s.duration_min) <= (p_day + v_to) at time zone v_tz loop
        v_end := t + make_interval(mins => s.duration_min);
        if t > now() and not exists (select 1 from public.appointments a where a.resource_id = r.id and a.deleted_at is null and a.status not in ('cancelled', 'no_show')
                                       and tstzrange(a.starts_at, a.ends_at) && tstzrange(t, v_end)) then
          v_out := v_out || jsonb_build_array(jsonb_build_object('resource_id', r.id, 'resource', r.name, 'starts_at', t, 'ends_at', v_end));
        end if;
        t := t + interval '15 minutes';
      end loop;
    end loop;
  end loop;
  return v_out;
end $$;

-- book or change one
create or replace function public.appt_save(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; v_co uuid; s public.appt_services; v_start timestamptz; v_end timestamptz; v_partner uuid; v_price numeric; a public.appointments;
  v_name text; v_phone text; v_email text;
begin
  if v_id is not null then
    select * into a from public.appointments where id = v_id and deleted_at is null;
    if a.id is null then raise exception 'Appointment not found' using errcode = 'P0002'; end if;
    v_co := a.company_id;
    if a.invoice_id is not null then raise exception 'This appointment is already invoiced' using errcode = '55000'; end if;
  else
    v_co := (p ->> 'company_id')::uuid;
  end if;
  perform app.require_permission(v_co, 'sales.write');
  select * into s from public.appt_services where id = nullif(p ->> 'service_id', '')::uuid and company_id = v_co;
  v_start := (p ->> 'starts_at')::timestamptz;
  v_end := coalesce(nullif(p ->> 'ends_at', '')::timestamptz, v_start + make_interval(mins => coalesce(s.duration_min, 30)));
  v_price := coalesce(nullif(p ->> 'price', '')::numeric, s.price, 0);
  v_partner := nullif(p ->> 'partner_id', '')::uuid;
  v_name := nullif(btrim(p ->> 'client_name'), ''); v_phone := nullif(btrim(p ->> 'client_phone'), ''); v_email := nullif(btrim(p ->> 'client_email'), '');
  if v_partner is not null then
    select coalesce(v_name, name), coalesce(v_phone, phone), coalesce(v_email, email) into v_name, v_phone, v_email from public.business_partners where id = v_partner and company_id = v_co;
  end if;
  if v_name is null then raise exception 'Give the client''s name' using errcode = '23514'; end if;
  if v_id is null then
    insert into public.appointments (company_id, starts_at, ends_at, resource_id, service_id, partner_id, client_name, client_phone, client_email, card_id, price, notes, source)
    values (v_co, v_start, v_end, (p ->> 'resource_id')::uuid, s.id, v_partner, v_name, v_phone, v_email,
            nullif(p ->> 'card_id', '')::uuid, v_price, nullif(btrim(p ->> 'notes'), ''), coalesce(nullif(p ->> 'source', ''), 'phone'))
    returning id into v_id;
  else
    update public.appointments set starts_at = v_start, ends_at = v_end, resource_id = (p ->> 'resource_id')::uuid, service_id = s.id, partner_id = v_partner,
           client_name = v_name, client_phone = v_phone, client_email = v_email,
           card_id = nullif(p ->> 'card_id', '')::uuid, price = v_price, notes = nullif(btrim(p ->> 'notes'), ''), source = coalesce(nullif(p ->> 'source', ''), source),
           reminded_at = case when starts_at <> v_start then null else reminded_at end
     where id = v_id;
  end if;
  return v_id;
end $$;

create or replace function public.appt_set_status(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.appointments;
begin
  select * into a from public.appointments where id = p_id and deleted_at is null;
  if a.id is null then raise exception 'Appointment not found' using errcode = 'P0002'; end if;
  perform app.require_permission(a.company_id, 'sales.write');
  if a.invoice_id is not null then raise exception 'This appointment is already invoiced' using errcode = '55000'; end if;
  update public.appointments set status = p_status,
         arrived_at = case when p_status = 'arrived' then now() else arrived_at end,
         done_at = case when p_status = 'done' then now() else done_at end
   where id = p_id;
end $$;

-- done: the invoice (a draft to check, or straight to the till), and a line in the client's card
create or replace function public.appt_invoice(p_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.appointments; s public.appt_services; v_partner uuid; v_inv uuid; v_var uuid; v_tax uuid; v_tr numeric; v_cur text; v_tz text;
begin
  select * into a from public.appointments where id = p_id and deleted_at is null for update;
  if a.id is null then raise exception 'Appointment not found' using errcode = 'P0002'; end if;
  perform app.require_permission(a.company_id, 'sales.write');
  perform app.require_permission(a.company_id, 'invoicing.write');
  if a.invoice_id is not null then return a.invoice_id; end if;
  if a.status in ('cancelled', 'no_show') then raise exception 'A cancelled appointment is not invoiced' using errcode = '55000'; end if;
  select * into s from public.appt_services where id = a.service_id;
  select base_currency, coalesce(timezone, 'Europe/Tirane') into v_cur, v_tz from public.companies where id = a.company_id;
  v_partner := app.client_for(a.company_id, a.partner_id, a.client_name, a.client_phone, a.client_email, 'K');
  if s.id is not null then
    if s.variant_id is null then
      update public.appt_services set variant_id = app.service_variant(a.company_id, s.name, s.price, s.tax_code_id, 'SRV') where id = s.id returning variant_id into s.variant_id;
    end if;
    v_var := s.variant_id;
  end if;
  v_tax := coalesce(s.tax_code_id, (select p.sales_tax_code_id from public.product_variants v join public.products p on p.id = v.product_id where v.id = v_var),
                    (select default_sales_tax_code_id from public.company_settings where company_id = a.company_id));
  select coalesce(rate, 0) into v_tr from public.tax_codes where id = v_tax;
  insert into public.sales_invoices (company_id, partner_id, source, invoice_date, due_date, currency_code, exchange_rate, notes)
  values (a.company_id, v_partner, 'manual', current_date, current_date, v_cur, 1,
          'Termini ' || coalesce(a.number, '') || ' · ' || to_char(a.starts_at at time zone v_tz, 'DD.MM.YYYY HH24:MI')
            || coalesce(' · ' || (select title from public.client_cards where id = a.card_id), ''))
  returning id into v_inv;
  insert into public.sales_invoice_lines (company_id, invoice_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
  values (a.company_id, v_inv, 1, v_var, coalesce(s.name, 'Shërbim'), 1, round(a.price / (1 + coalesce(v_tr, 0) / 100), 4), v_tax);
  update public.appointments set invoice_id = v_inv, partner_id = v_partner, status = 'done', done_at = coalesce(done_at, now()) where id = a.id;
  if a.card_id is not null and not exists (select 1 from public.card_entries where appointment_id = a.id) then
    insert into public.card_entries (company_id, card_id, entry_date, title, appointment_id, invoice_id)
    values (a.company_id, a.card_id, (a.starts_at at time zone v_tz)::date, coalesce(s.name, 'Vizitë'), a.id, v_inv);
  end if;
  return v_inv;
end $$;

-- reminders the day before, by email (when the company has a mailbox)
create or replace function app.appt_reminders()
returns int language plpgsql security definer set search_path = '' as $$
declare a record; n int := 0; v_tz text;
begin
  for a in select ap.*, co.name as company, coalesce(co.timezone, 'Europe/Tirane') as tz, s.name as service, r.name as resource
             from public.appointments ap join public.companies co on co.id = ap.company_id
             join public.appt_resources r on r.id = ap.resource_id left join public.appt_services s on s.id = ap.service_id
            where ap.deleted_at is null and ap.status in ('booked', 'confirmed') and ap.reminded_at is null and ap.client_email is not null
              and (ap.starts_at at time zone coalesce(co.timezone, 'Europe/Tirane'))::date = (now() at time zone coalesce(co.timezone, 'Europe/Tirane'))::date + 1
              and exists (select 1 from app.mail_accounts m where m.company_id = ap.company_id and m.is_active) loop
    perform app.enqueue_message(a.company_id, 'email', a.client_email, 'Kujtesë: termini juaj nesër te ' || a.company,
      format(E'Përshëndetje %s,\n\nJu kujtojmë terminin tuaj nesër, %s në orën %s%s%s.\n\nNëse nuk mund të vini, ju lutemi na njoftoni.\n\n%s',
             a.client_name, to_char(a.starts_at at time zone a.tz, 'DD.MM.YYYY'), to_char(a.starts_at at time zone a.tz, 'HH24:MI'),
             coalesce(' për ' || a.service, ''), case when a.resource is not null then ' (' || a.resource || ')' else '' end, a.company),
      null, 'reminder', null, 'appt:' || a.id, 'appointments', a.id);
    update public.appointments set reminded_at = now() where id = a.id;
    n := n + 1;
  end loop;
  return n;
end $$;

-- =============================================================================
-- Memberships
-- =============================================================================
create table if not exists public.membership_plans (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  name         text not null,
  months       int not null default 1 check (months >= 0),
  days         int not null default 0 check (days >= 0),
  visits       int check (visits > 0),                 -- empty: unlimited within the period
  price        numeric(18,2) not null default 0 check (price >= 0),   -- with VAT
  tax_code_id  uuid references public.tax_codes(id),
  variant_id   uuid,
  sort         int not null default 0,
  is_active    boolean not null default true,
  check (months > 0 or days > 0),
  foreign key (company_id, variant_id) references public.product_variants(company_id, id)
);
select app.register_table('public.membership_plans', 'sales');

create table if not exists public.memberships (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  number      text,
  status      text not null default 'active',
  partner_id  uuid not null,
  plan_id     uuid not null,
  code        text not null,                    -- on the member's card, for the door
  starts_on   date not null,
  ends_on     date not null,
  visits      int,                              -- allowed; empty: unlimited
  visits_used int not null default 0,
  price       numeric(18,2) not null default 0,
  invoice_id  uuid,
  frozen_on   date,
  renewed_by  uuid,
  notes       text,
  check (ends_on >= starts_on),
  foreign key (company_id, partner_id) references public.business_partners(company_id, id),
  foreign key (company_id, plan_id) references public.membership_plans(company_id, id)
);
select app.register_table('public.memberships', 'sales');
insert into public.document_types (key, name, module, table_name, default_prefix)
values ('membership', 'Membership', 'sales', 'memberships', 'ANT-') on conflict (key) do nothing;
insert into public.status_transitions (doc_type, from_status, to_status) values
  ('membership', '__init__', 'active'), ('membership', 'active', 'frozen'), ('membership', 'frozen', 'active'), ('membership', 'active', 'expired'),
  ('membership', 'active', 'cancelled'), ('membership', 'frozen', 'cancelled'), ('membership', 'expired', 'active')
on conflict do nothing;
select app.register_document('public.memberships', 'membership', 'starts_on');
create index if not exists memberships_code_idx on public.memberships (company_id, code) where deleted_at is null;
create index if not exists memberships_partner_idx on public.memberships (partner_id) where deleted_at is null;

create table if not exists public.membership_visits (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  membership_id uuid not null,
  visited_at    timestamptz not null default now(),
  foreign key (company_id, membership_id) references public.memberships(company_id, id) on delete cascade
);
select app.register_table('public.membership_visits', 'sales', p_soft_delete => false, p_client_write => false);
create index if not exists membership_visits_idx on public.membership_visits (membership_id, visited_at desc);

-- sell: the membership and its invoice (a draft, or paid at the till)
create or replace function public.membership_sell(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_co uuid := (p ->> 'company_id')::uuid; pl public.membership_plans; v_partner uuid; v_start date; v_end date; v_id uuid; v_inv uuid; v_tax uuid; v_tr numeric; v_cur text;
  v_code text; v_price numeric; v_prev public.memberships;
begin
  perform app.require_permission(v_co, 'sales.write');
  perform app.require_permission(v_co, 'invoicing.write');
  select * into pl from public.membership_plans where id = (p ->> 'plan_id')::uuid and company_id = v_co and deleted_at is null;
  if pl.id is null then raise exception 'Choose a plan' using errcode = '23514'; end if;
  v_partner := app.client_for(v_co, nullif(p ->> 'partner_id', '')::uuid, p ->> 'client_name', p ->> 'client_phone', p ->> 'client_email', 'A');
  -- a renewal starts the day after the current one ends
  select * into v_prev from public.memberships where company_id = v_co and partner_id = v_partner and deleted_at is null and status in ('active', 'frozen')
   order by ends_on desc limit 1;
  v_start := coalesce(nullif(p ->> 'starts_on', '')::date, case when v_prev.ends_on >= current_date then v_prev.ends_on + 1 end, current_date);
  v_end := v_start + make_interval(months => pl.months, days => pl.days) - interval '1 day';
  v_price := coalesce(nullif(p ->> 'price', '')::numeric, pl.price);
  v_code := coalesce(nullif(btrim(p ->> 'code'), ''), v_prev.code,
                     (select code from public.memberships where partner_id = v_partner and deleted_at is null order by created_at desc limit 1),
                     lpad((floor(random() * 100000000))::bigint::text, 8, '0'));
  if pl.variant_id is null then
    update public.membership_plans set variant_id = app.service_variant(v_co, 'Anëtarësim · ' || pl.name, pl.price, pl.tax_code_id, 'MBR') where id = pl.id returning variant_id into pl.variant_id;
  end if;
  v_tax := coalesce(pl.tax_code_id, (select p2.sales_tax_code_id from public.product_variants v join public.products p2 on p2.id = v.product_id where v.id = pl.variant_id));
  select coalesce(rate, 0) into v_tr from public.tax_codes where id = v_tax;
  select base_currency into v_cur from public.companies where id = v_co;
  insert into public.memberships (company_id, partner_id, plan_id, code, starts_on, ends_on, visits, price, notes)
  values (v_co, v_partner, pl.id, v_code, v_start, v_end, pl.visits, v_price, nullif(btrim(p ->> 'notes'), '')) returning id into v_id;
  if v_prev.id is not null and v_prev.ends_on < v_start then update public.memberships set renewed_by = v_id where id = v_prev.id; end if;
  insert into public.sales_invoices (company_id, partner_id, source, invoice_date, due_date, currency_code, exchange_rate, notes)
  values (v_co, v_partner, 'manual', current_date, current_date, v_cur, 1,
          'Anëtarësim ' || pl.name || ' · ' || to_char(v_start, 'DD.MM.YYYY') || ' – ' || to_char(v_end, 'DD.MM.YYYY'))
  returning id into v_inv;
  insert into public.sales_invoice_lines (company_id, invoice_id, line_no, variant_id, description, quantity, unit_price, tax_code_id)
  values (v_co, v_inv, 1, pl.variant_id, 'Anëtarësim · ' || pl.name || ' · ' || to_char(v_start, 'DD.MM.YYYY') || ' – ' || to_char(v_end, 'DD.MM.YYYY'),
          1, round(v_price / (1 + coalesce(v_tr, 0) / 100), 4), v_tax);
  update public.memberships set invoice_id = v_inv where id = v_id;
  return (select jsonb_build_object('id', id, 'number', number, 'code', code, 'starts_on', starts_on, 'ends_on', ends_on, 'invoice_id', invoice_id) from public.memberships where id = v_id);
end $$;

-- at the door: by the code on the card, or by the member's name or phone
create or replace function public.membership_check_in(p_company uuid, p_code text, p_record boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m record; v_today date; v_last timestamptz; v_n int;
begin
  perform app.require_permission(p_company, 'sales.write');
  v_today := (now() at time zone coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane'))::date;
  select ms.*, bp.name as member, bp.phone, pl.name as plan into m
    from public.memberships ms join public.business_partners bp on bp.id = ms.partner_id join public.membership_plans pl on pl.id = ms.plan_id
   where ms.company_id = p_company and ms.deleted_at is null
     and (ms.code = btrim(p_code) or ms.number = upper(btrim(p_code)) or bp.phone = btrim(p_code) or lower(bp.name) = lower(btrim(p_code)))
   order by (ms.status = 'active' and v_today between ms.starts_on and ms.ends_on) desc, ms.ends_on desc limit 1;
  if m.id is null then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  select max(visited_at), count(*) filter (where visited_at >= v_today::timestamp) into v_last, v_n from public.membership_visits where membership_id = m.id;
  if m.status = 'frozen' then return jsonb_build_object('ok', false, 'reason', 'frozen', 'member', m.member, 'plan', m.plan, 'ends_on', m.ends_on, 'id', m.id); end if;
  if m.status <> 'active' or v_today > m.ends_on then
    return jsonb_build_object('ok', false, 'reason', 'expired', 'member', m.member, 'plan', m.plan, 'ends_on', m.ends_on, 'id', m.id, 'partner_id', m.partner_id);
  end if;
  if v_today < m.starts_on then return jsonb_build_object('ok', false, 'reason', 'not_yet', 'member', m.member, 'plan', m.plan, 'starts_on', m.starts_on, 'id', m.id); end if;
  if m.visits is not null and m.visits_used >= m.visits then
    return jsonb_build_object('ok', false, 'reason', 'no_visits', 'member', m.member, 'plan', m.plan, 'visits', m.visits, 'id', m.id, 'partner_id', m.partner_id);
  end if;
  if p_record and v_n = 0 then
    insert into public.membership_visits (company_id, membership_id) values (p_company, m.id);
    update public.memberships set visits_used = visits_used + 1 where id = m.id;
    m.visits_used := m.visits_used + 1;
  end if;
  return jsonb_build_object('ok', true, 'member', m.member, 'plan', m.plan, 'ends_on', m.ends_on, 'days_left', m.ends_on - v_today,
    'visits', m.visits, 'visits_used', m.visits_used, 'again_today', v_n > 0, 'id', m.id, 'partner_id', m.partner_id, 'code', m.code);
end $$;

create or replace function public.membership_freeze(p_id uuid, p_freeze boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.memberships;
begin
  select * into m from public.memberships where id = p_id and deleted_at is null;
  if m.id is null then raise exception 'Membership not found' using errcode = 'P0002'; end if;
  perform app.require_permission(m.company_id, 'sales.write');
  if p_freeze then
    update public.memberships set status = 'frozen', frozen_on = current_date where id = p_id and status = 'active';
  else
    -- the days it was frozen are added at the end
    update public.memberships set status = 'active', ends_on = ends_on + greatest(current_date - coalesce(frozen_on, current_date), 0), frozen_on = null
     where id = p_id and status = 'frozen';
  end if;
end $$;

-- every day: memberships past their end expire; staff hear of those ending in 3 days
create or replace function app.memberships_daily()
returns int language plpgsql security definer set search_path = '' as $$
declare n int; c record;
begin
  update public.memberships set status = 'expired' where deleted_at is null and status = 'active' and ends_on < current_date;
  get diagnostics n = row_count;
  for c in select company_id, count(*) as k from public.memberships
            where deleted_at is null and status = 'active' and ends_on between current_date and current_date + 3 and renewed_by is null
              and not exists (select 1 from public.memberships x where x.partner_id = memberships.partner_id and x.starts_on > memberships.ends_on and x.deleted_at is null)
            group by company_id loop
    perform app.notify_once(c.company_id, 'sales.write', 'Memberships ending in 3 days: ' || c.k, null, '/appointments/memberships?filter=ending');
  end loop;
  return n;
end $$;

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
do $$ begin
  perform app._patch_function('public.platform_set_business_type',
    '''manufacturing'', ''services'', ''hotel'')',
    '''manufacturing'', ''services'', ''hotel'', ''beauty'', ''clinic'', ''auto_service'', ''fitness'')');
  perform app._patch_function('public.automation_tick',
    '    perform app.doc_reads_cleanup();',
    '    perform app.doc_reads_cleanup();
    perform app.memberships_daily();');
  perform app._patch_function('public.automation_tick',
    '  perform app.assistant_cleanup();',
    '  if extract(hour from now() at time zone ''Europe/Tirane'') >= 17 then perform app.appt_reminders(); end if;
  perform app.assistant_cleanup();');
end $$;
drop function app._patch_function(text, text, text);

revoke execute on function public.appt_board(uuid, date, date), public.appt_slots(uuid, uuid, date, uuid), public.appt_save(jsonb), public.appt_set_status(uuid, text),
  public.appt_invoice(uuid), public.membership_sell(jsonb), public.membership_check_in(uuid, text, boolean), public.membership_freeze(uuid, boolean) from public, anon;
grant execute on function public.appt_board(uuid, date, date), public.appt_slots(uuid, uuid, date, uuid), public.appt_save(jsonb), public.appt_set_status(uuid, text),
  public.appt_invoice(uuid), public.membership_sell(jsonb), public.membership_check_in(uuid, text, boolean), public.membership_freeze(uuid, boolean) to authenticated;
