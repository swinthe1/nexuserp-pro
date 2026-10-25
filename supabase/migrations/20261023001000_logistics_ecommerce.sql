-- =============================================================================
-- DrisPRO · 1000 · Logistics & e-commerce integration
-- Shipments carry deliveries to customers (own fleet routes or carriers),
-- including cash-on-delivery, which is common in AL/XK. Sales channels hold
-- integration settings; secrets live in Supabase Vault and are referenced by
-- id only — never stored in table columns.
-- =============================================================================

create table public.carriers (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id),
  code                  text not null,
  name                  text not null,
  carrier_type          text not null default 'external' check (carrier_type in ('own_fleet','external')),
  tracking_url_template text,              -- e.g. https://track.example/{tracking}
  phone                 text,
  email                 text,
  partner_id            uuid,               -- vendor record for carrier invoices
  is_active             boolean not null default true,
  foreign key (company_id, partner_id) references public.business_partners(company_id, id)
);
select app.register_table('public.carriers', 'logistics', 'core');
create unique index carriers_code_key on public.carriers (company_id, code) where deleted_at is null;

alter table public.deliveries add foreign key (company_id, carrier_id) references public.carriers(company_id, id);

create table public.vehicles (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),
  plate_number       text not null,
  name               text not null,
  vehicle_type       text not null default 'van' check (vehicle_type in ('van','truck','car','motorbike','other')),
  capacity_kg        numeric(10,2),
  capacity_m3        numeric(10,3),
  driver_employee_id uuid,
  fixed_asset_id     uuid,
  is_active          boolean not null default true,
  foreign key (company_id, driver_employee_id) references public.employees(company_id, id),
  foreign key (company_id, fixed_asset_id)     references public.fixed_assets(company_id, id)
);
select app.register_table('public.vehicles', 'logistics');
create unique index vehicles_plate_key on public.vehicles (company_id, upper(plate_number)) where deleted_at is null;

create table public.delivery_routes (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),
  number             text not null,
  status             text not null default 'planned',
  route_date         date not null,
  vehicle_id         uuid,
  driver_employee_id uuid,
  warehouse_id       uuid not null,
  planned_distance_km numeric(10,2),
  actual_distance_km  numeric(10,2),
  started_at         timestamptz,
  completed_at       timestamptz,
  notes              text,
  foreign key (company_id, vehicle_id)         references public.vehicles(company_id, id),
  foreign key (company_id, driver_employee_id) references public.employees(company_id, id),
  foreign key (company_id, warehouse_id)       references public.warehouses(company_id, id)
);
select app.register_table('public.delivery_routes', 'logistics');
select app.register_document('public.delivery_routes', 'delivery_route', 'route_date');

create table public.shipments (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id),
  number              text not null,
  status              text not null default 'draft',
  delivery_id         uuid,
  route_id            uuid,
  carrier_id          uuid,
  partner_id          uuid not null,
  shipping_address_id uuid,
  tracking_number     text,
  ship_date           date,
  delivered_at        timestamptz,
  packages            smallint not null default 1 check (packages > 0),
  weight_kg           numeric(10,3),
  shipping_cost       numeric(18,2) not null default 0,
  cod_amount          numeric(18,2) not null default 0 check (cod_amount >= 0),   -- cash on delivery
  cod_collected       boolean not null default false,
  proof_of_delivery_path text,
  failure_reason      text,
  notes               text,
  foreign key (company_id, delivery_id)         references public.deliveries(company_id, id),
  foreign key (company_id, route_id)            references public.delivery_routes(company_id, id),
  foreign key (company_id, carrier_id)          references public.carriers(company_id, id),
  foreign key (company_id, partner_id)          references public.business_partners(company_id, id),
  foreign key (company_id, shipping_address_id) references public.partner_addresses(company_id, id)
);
select app.register_table('public.shipments', 'logistics');
select app.register_document('public.shipments', 'shipment', 'ship_date');
create index shipments_delivery_idx on public.shipments (delivery_id);
create index shipments_route_idx    on public.shipments (route_id);

create table public.route_stops (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null,
  route_id        uuid not null,
  sequence        smallint not null,
  shipment_id     uuid,
  address_text    text not null,
  latitude        numeric(9,6),
  longitude       numeric(9,6),
  planned_arrival timestamptz,
  actual_arrival  timestamptz,
  status          text not null default 'pending' check (status in ('pending','arrived','delivered','failed','skipped')),
  notes           text,
  foreign key (company_id, route_id)    references public.delivery_routes(company_id, id) on delete cascade,
  foreign key (company_id, shipment_id) references public.shipments(company_id, id),
  unique (route_id, sequence)
);
select app.register_table('public.route_stops', 'logistics', p_soft_delete => false);

-- -----------------------------------------------------------------------------
-- E-commerce channels (connectors are placeholders until Phase 8)
-- -----------------------------------------------------------------------------
create table public.sales_channels (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id),
  name                  text not null,
  channel_type          text not null check (channel_type in ('shopify','woocommerce','magento','prestashop','custom_api','marketplace')),
  store_url             text,
  warehouse_id          uuid,
  price_list_id         uuid,
  default_customer_id   uuid,
  credentials_secret_id uuid,               -- Supabase Vault secret id
  sync_products         boolean not null default true,
  sync_stock            boolean not null default true,
  import_orders         boolean not null default true,
  last_synced_at        timestamptz,
  settings              jsonb not null default '{}'::jsonb,
  is_active             boolean not null default false,
  foreign key (company_id, warehouse_id)        references public.warehouses(company_id, id),
  foreign key (company_id, price_list_id)       references public.price_lists(company_id, id),
  foreign key (company_id, default_customer_id) references public.business_partners(company_id, id)
);
select app.register_table('public.sales_channels', 'ecommerce');

create table public.channel_product_links (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null,
  channel_id          uuid not null,
  variant_id          uuid not null,
  external_product_id text not null,
  external_variant_id text,
  sync_enabled        boolean not null default true,
  last_synced_at      timestamptz,
  foreign key (company_id, channel_id) references public.sales_channels(company_id, id),
  foreign key (company_id, variant_id) references public.product_variants(company_id, id),
  unique (channel_id, variant_id)
);
select app.register_table('public.channel_product_links', 'ecommerce', p_soft_delete => false);

create table public.channel_orders (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null,
  channel_id            uuid not null,
  external_order_id     text not null,
  external_order_number text,
  import_status         text not null default 'pending' check (import_status in ('pending','imported','failed','ignored')),
  payload               jsonb not null,
  sales_order_id        uuid,
  error_message         text,
  imported_at           timestamptz,
  foreign key (company_id, channel_id)     references public.sales_channels(company_id, id),
  foreign key (company_id, sales_order_id) references public.sales_orders(company_id, id),
  unique (channel_id, external_order_id)    -- idempotent webhook ingestion
);
select app.register_table('public.channel_orders', 'ecommerce', p_soft_delete => false, p_client_write => false, p_audit => false);

create table public.channel_sync_logs (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null,
  channel_id        uuid not null,
  sync_type         text not null check (sync_type in ('products','stock','prices','orders','fulfillment')),
  direction         text not null check (direction in ('inbound','outbound')),
  status            text not null check (status in ('running','success','partial','failed')),
  records_processed integer not null default 0,
  records_failed    integer not null default 0,
  error_message     text,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  foreign key (company_id, channel_id) references public.sales_channels(company_id, id)
);
select app.register_table('public.channel_sync_logs', 'ecommerce', p_soft_delete => false, p_client_write => false, p_audit => false);
create index channel_sync_logs_channel_idx on public.channel_sync_logs (channel_id, started_at desc);
