-- =============================================================================
-- DrisPRO · 0600 · Manufacturing
-- Multi-level BOMs: a component may itself have a default BOM (sub-assembly);
-- cycles are rejected by trigger. Work orders consume materials (stock
-- movements to the production location) and produce finished goods valued at
-- material + labor + overhead. Lot genealogy gives full traceability.
-- =============================================================================

create table public.work_centers (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id),
  code                  text not null,
  name                  text not null,
  warehouse_id          uuid,
  cost_per_hour         numeric(18,4) not null default 0 check (cost_per_hour >= 0),      -- labor
  overhead_per_hour     numeric(18,4) not null default 0 check (overhead_per_hour >= 0),
  capacity_hours_per_day numeric(6,2) not null default 8 check (capacity_hours_per_day > 0),
  efficiency_pct        numeric(5,2) not null default 100 check (efficiency_pct > 0),
  is_active             boolean not null default true,
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id)
);
select app.register_table('public.work_centers', 'manufacturing');
create unique index work_centers_code_key on public.work_centers (company_id, code) where deleted_at is null;

create table public.boms (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  code        text not null,
  variant_id  uuid not null,                -- what this BOM produces
  name        text not null,
  version     smallint not null default 1,
  bom_type    text not null default 'manufacture' check (bom_type in ('manufacture','kit')),
  quantity    numeric(18,4) not null default 1 check (quantity > 0),   -- output qty per BOM
  uom_id      uuid,
  is_default  boolean not null default true,
  is_active   boolean not null default true,
  valid_from  date,
  valid_to    date,
  notes       text,
  foreign key (company_id, variant_id) references public.product_variants(company_id, id),
  foreign key (company_id, uom_id)     references public.units_of_measure(company_id, id)
);
select app.register_table('public.boms', 'manufacturing', 'inventory');
create unique index boms_code_key on public.boms (company_id, code, version) where deleted_at is null;
create unique index boms_one_default on public.boms (company_id, variant_id) where is_default and deleted_at is null;

create table public.bom_operations (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null,
  bom_id               uuid not null,
  sequence             smallint not null,
  name                 text not null,
  work_center_id       uuid not null,
  setup_minutes        numeric(10,2) not null default 0 check (setup_minutes >= 0),
  run_minutes_per_unit numeric(10,4) not null default 0 check (run_minutes_per_unit >= 0),
  instructions         text,
  foreign key (company_id, bom_id)         references public.boms(company_id, id) on delete cascade,
  foreign key (company_id, work_center_id) references public.work_centers(company_id, id),
  unique (bom_id, sequence)
);
select app.register_table('public.bom_operations', 'manufacturing', 'inventory', p_soft_delete => false);

create table public.bom_lines (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null,
  bom_id               uuid not null,
  line_no              smallint not null,
  component_variant_id uuid not null,
  quantity             numeric(18,6) not null check (quantity > 0),  -- per bom.quantity of output
  uom_id               uuid,
  scrap_pct            numeric(5,2) not null default 0 check (scrap_pct between 0 and 100),
  operation_id         uuid,                 -- consumed at this operation
  is_optional          boolean not null default false,
  foreign key (company_id, bom_id)               references public.boms(company_id, id) on delete cascade,
  foreign key (company_id, component_variant_id) references public.product_variants(company_id, id),
  foreign key (company_id, uom_id)               references public.units_of_measure(company_id, id),
  foreign key (company_id, operation_id)         references public.bom_operations(company_id, id),
  unique (bom_id, line_no)
);
select app.register_table('public.bom_lines', 'manufacturing', 'inventory', p_soft_delete => false);
create index bom_lines_component_idx on public.bom_lines (company_id, component_variant_id);

-- Reject BOM structures where a product (directly or through sub-assemblies)
-- contains itself.
create or replace function app.tg_bom_cycle_check()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_output uuid; v_cycle boolean;
begin
  select variant_id into v_output from public.boms where id = new.bom_id;
  if new.component_variant_id = v_output then
    raise exception 'A BOM cannot contain the product it produces' using errcode = '23514';
  end if;
  with recursive tree(variant_id, depth) as (
    select new.component_variant_id, 1
    union all
    select bl.component_variant_id, t.depth + 1
      from tree t
      join public.boms b       on b.variant_id = t.variant_id and b.company_id = new.company_id
                              and b.deleted_at is null and b.is_active
      join public.bom_lines bl on bl.bom_id = b.id
     where t.depth < 25
  )
  select exists (select 1 from tree where variant_id = v_output) into v_cycle;
  if v_cycle then
    raise exception 'Circular BOM: component % eventually contains the finished product', new.component_variant_id
      using errcode = '23514';
  end if;
  return new;
end $$;
create trigger trg_05_bom_cycle before insert or update of component_variant_id on public.bom_lines
  for each row execute function app.tg_bom_cycle_check();

-- -----------------------------------------------------------------------------
-- Work orders
-- -----------------------------------------------------------------------------
create table public.work_orders (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id),
  number               text not null,
  status               text not null default 'draft',
  bom_id               uuid not null,
  variant_id           uuid not null,
  parent_work_order_id uuid,                 -- sub-assembly WO feeding a parent WO
  sales_order_id       uuid,                 -- make-to-order
  quantity_planned     numeric(18,4) not null check (quantity_planned > 0),
  quantity_produced    numeric(18,4) not null default 0 check (quantity_produced >= 0),
  quantity_scrapped    numeric(18,4) not null default 0 check (quantity_scrapped >= 0),
  uom_id               uuid,
  warehouse_id         uuid not null,
  component_location_id uuid not null,       -- where materials are taken from
  output_location_id   uuid not null,        -- where finished goods go
  planned_start        timestamptz,
  planned_end          timestamptz,
  actual_start         timestamptz,
  actual_end           timestamptz,
  priority             smallint not null default 3 check (priority between 1 and 5),
  responsible_id       uuid references auth.users(id),
  material_cost        numeric(18,4) not null default 0,
  labor_cost           numeric(18,4) not null default 0,
  overhead_cost        numeric(18,4) not null default 0,
  total_cost           numeric(18,4) generated always as (material_cost + labor_cost + overhead_cost) stored,
  unit_cost            numeric(18,6) generated always as (
                         case when quantity_produced > 0
                              then round((material_cost + labor_cost + overhead_cost) / quantity_produced, 6)
                              else 0 end) stored,
  journal_entry_id     uuid,
  notes                text,
  foreign key (company_id, bom_id)                references public.boms(company_id, id),
  foreign key (company_id, variant_id)            references public.product_variants(company_id, id),
  foreign key (company_id, sales_order_id)        references public.sales_orders(company_id, id),
  foreign key (company_id, uom_id)                references public.units_of_measure(company_id, id),
  foreign key (company_id, warehouse_id)          references public.warehouses(company_id, id),
  foreign key (company_id, component_location_id) references public.warehouse_locations(company_id, id),
  foreign key (company_id, output_location_id)    references public.warehouse_locations(company_id, id),
  check (planned_end is null or planned_start is null or planned_end >= planned_start)
);
select app.register_table('public.work_orders', 'manufacturing');
alter table public.work_orders add foreign key (company_id, parent_work_order_id) references public.work_orders(company_id, id);
select app.register_document('public.work_orders', 'work_order', 'planned_start');
create index work_orders_parent_idx on public.work_orders (parent_work_order_id) where parent_work_order_id is not null;

alter table public.replenishment_suggestions
  add foreign key (company_id, work_order_id) references public.work_orders(company_id, id);

create table public.work_order_materials (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null,
  work_order_id     uuid not null,
  bom_line_id       uuid,
  variant_id        uuid not null,
  quantity_required numeric(18,4) not null check (quantity_required >= 0),
  quantity_consumed numeric(18,4) not null default 0 check (quantity_consumed >= 0),
  quantity_reserved numeric(18,4) not null default 0 check (quantity_reserved >= 0),
  foreign key (company_id, work_order_id) references public.work_orders(company_id, id) on delete cascade,
  foreign key (company_id, bom_line_id)   references public.bom_lines(company_id, id),
  foreign key (company_id, variant_id)    references public.product_variants(company_id, id)
);
select app.register_table('public.work_order_materials', 'manufacturing', p_soft_delete => false);
select app.register_lines('public.work_order_materials', 'work_orders', 'work_order_id', 'draft,released', p_totals => false, p_tax => false);

create table public.work_order_operations (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null,
  work_order_id    uuid not null,
  bom_operation_id uuid,
  sequence         smallint not null,
  name             text not null,
  work_center_id   uuid not null,
  status           text not null default 'pending' check (status in ('pending','in_progress','paused','done')),
  planned_minutes  numeric(12,2) not null default 0,
  actual_minutes   numeric(12,2) not null default 0 check (actual_minutes >= 0),
  operator_id      uuid references auth.users(id),
  started_at       timestamptz,
  finished_at      timestamptz,
  foreign key (company_id, work_order_id)    references public.work_orders(company_id, id) on delete cascade,
  foreign key (company_id, bom_operation_id) references public.bom_operations(company_id, id),
  foreign key (company_id, work_center_id)   references public.work_centers(company_id, id),
  unique (work_order_id, sequence)
);
select app.register_table('public.work_order_operations', 'manufacturing', p_soft_delete => false);

create table public.work_order_consumptions (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,
  work_order_id uuid not null,
  material_id   uuid not null,
  variant_id    uuid not null,
  lot_id        uuid,
  location_id   uuid not null,
  quantity      numeric(18,4) not null check (quantity > 0),
  unit_cost     numeric(18,6) not null default 0,     -- WAC at consumption
  movement_id   uuid,
  consumed_at   timestamptz not null default now(),
  foreign key (company_id, work_order_id) references public.work_orders(company_id, id),
  foreign key (company_id, material_id)   references public.work_order_materials(company_id, id),
  foreign key (company_id, variant_id)    references public.product_variants(company_id, id),
  foreign key (company_id, lot_id)        references public.lots(company_id, id),
  foreign key (company_id, location_id)   references public.warehouse_locations(company_id, id),
  foreign key (company_id, movement_id)   references public.stock_movements(company_id, id)
);
select app.register_table('public.work_order_consumptions', 'manufacturing', p_soft_delete => false,
                          p_client_write => false, p_immutable => true);
create index work_order_consumptions_wo_idx on public.work_order_consumptions (work_order_id);

create table public.production_outputs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,
  work_order_id uuid not null,
  variant_id    uuid not null,
  lot_id        uuid,
  location_id   uuid not null,
  quantity      numeric(18,4) not null check (quantity > 0),
  output_type   text not null default 'finished' check (output_type in ('finished','byproduct','scrap')),
  unit_cost     numeric(18,6) not null default 0,
  movement_id   uuid,
  produced_at   timestamptz not null default now(),
  foreign key (company_id, work_order_id) references public.work_orders(company_id, id),
  foreign key (company_id, variant_id)    references public.product_variants(company_id, id),
  foreign key (company_id, lot_id)        references public.lots(company_id, id),
  foreign key (company_id, location_id)   references public.warehouse_locations(company_id, id),
  foreign key (company_id, movement_id)   references public.stock_movements(company_id, id)
);
select app.register_table('public.production_outputs', 'manufacturing', p_soft_delete => false,
                          p_client_write => false, p_immutable => true);
create index production_outputs_wo_idx on public.production_outputs (work_order_id);

-- Which input lots went into which output lots (forward & backward trace)
create table public.lot_genealogy (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,
  parent_lot_id uuid not null,              -- consumed
  child_lot_id  uuid not null,              -- produced
  work_order_id uuid not null,
  quantity      numeric(18,4) not null check (quantity > 0),
  foreign key (company_id, parent_lot_id) references public.lots(company_id, id),
  foreign key (company_id, child_lot_id)  references public.lots(company_id, id),
  foreign key (company_id, work_order_id) references public.work_orders(company_id, id),
  check (parent_lot_id <> child_lot_id)
);
select app.register_table('public.lot_genealogy', 'manufacturing', 'inventory', p_soft_delete => false,
                          p_client_write => false, p_immutable => true);
create index lot_genealogy_parent_idx on public.lot_genealogy (parent_lot_id);
create index lot_genealogy_child_idx  on public.lot_genealogy (child_lot_id);
