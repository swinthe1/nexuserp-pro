-- =============================================================================
-- DrisPRO · 0300 · Inventory, costing, WMS, OMS
--
-- Source of truth for stock is the immutable stock_movements ledger.
-- stock_levels (per variant/location/lot) and item_costs (weighted average
-- cost per variant, company-wide) are projections maintained ONLY by system
-- posting functions (Phase 2) — clients can read them but never write them.
--   available = on_hand - reserved   (generated column)
-- =============================================================================

create table public.lots (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null,
  variant_id       uuid not null,
  lot_number       text not null,
  lot_type         text not null default 'lot' check (lot_type in ('lot','serial')),
  manufacture_date date,
  expiry_date      date,
  vendor_id        uuid,
  notes            text,
  foreign key (company_id, variant_id) references public.product_variants(company_id, id),
  foreign key (company_id, vendor_id)  references public.business_partners(company_id, id),
  check (expiry_date is null or manufacture_date is null or expiry_date >= manufacture_date)
);
select app.register_table('public.lots', 'inventory');
create unique index lots_key on public.lots (company_id, variant_id, lot_number) where deleted_at is null;
create index lots_expiry_idx on public.lots (company_id, expiry_date) where expiry_date is not null and deleted_at is null;

-- -----------------------------------------------------------------------------
-- Projections (system-maintained)
-- -----------------------------------------------------------------------------
create table public.stock_levels (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null,
  variant_id       uuid not null,
  warehouse_id     uuid not null,
  location_id      uuid not null,
  lot_id           uuid,
  on_hand          numeric(18,4) not null default 0,
  reserved         numeric(18,4) not null default 0 check (reserved >= 0),
  available        numeric(18,4) generated always as (on_hand - reserved) stored,
  last_movement_at timestamptz,
  foreign key (company_id, variant_id)   references public.product_variants(company_id, id),
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id),
  foreign key (company_id, location_id)  references public.warehouse_locations(company_id, id),
  foreign key (company_id, lot_id)       references public.lots(company_id, id),
  unique nulls not distinct (company_id, variant_id, location_id, lot_id)
);
select app.register_table('public.stock_levels', 'inventory', p_soft_delete => false, p_client_write => false, p_audit => false);
create index stock_levels_variant_wh_idx on public.stock_levels (company_id, variant_id, warehouse_id);
create index stock_levels_location_idx on public.stock_levels (location_id);

-- Weighted Average Cost state per variant (company-wide valuation)
create table public.item_costs (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null,
  variant_id      uuid not null,
  avg_cost        numeric(18,6) not null default 0 check (avg_cost >= 0),
  qty_on_hand     numeric(18,4) not null default 0,
  total_value     numeric(18,4) not null default 0,
  last_receipt_at timestamptz,
  foreign key (company_id, variant_id) references public.product_variants(company_id, id),
  unique (company_id, variant_id)
);
select app.register_table('public.item_costs', 'inventory', p_soft_delete => false, p_client_write => false, p_audit => false);

-- -----------------------------------------------------------------------------
-- The stock ledger (append-only)
-- -----------------------------------------------------------------------------
create table public.stock_movements (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null,
  movement_date       timestamptz not null default now(),
  movement_type       text not null check (movement_type in (
                        'receipt','purchase_return','delivery','sales_return','pos_sale','pos_return',
                        'transfer','adjustment_in','adjustment_out','production_consume','production_output',
                        'scrap','landed_cost','opening')),
  variant_id          uuid not null,
  lot_id              uuid,
  from_location_id    uuid not null,
  to_location_id      uuid not null,
  from_warehouse_id   uuid,
  to_warehouse_id     uuid,
  quantity            numeric(18,4) not null check (quantity >= 0),   -- 0 only for value-only (landed cost) movements
  unit_cost           numeric(18,6) not null default 0,
  total_cost          numeric(18,4) not null default 0,
  source_doc_type     text references public.document_types(key),
  source_doc_id       uuid,
  source_line_id      uuid,
  reference           text,
  reversed_movement_id uuid,
  journal_entry_id    uuid,                 -- FK added in finance migration
  notes               text,
  foreign key (company_id, variant_id)        references public.product_variants(company_id, id),
  foreign key (company_id, lot_id)            references public.lots(company_id, id),
  foreign key (company_id, from_location_id)  references public.warehouse_locations(company_id, id),
  foreign key (company_id, to_location_id)    references public.warehouse_locations(company_id, id),
  foreign key (company_id, from_warehouse_id) references public.warehouses(company_id, id),
  foreign key (company_id, to_warehouse_id)   references public.warehouses(company_id, id),
  check (from_location_id <> to_location_id)
);
select app.register_table('public.stock_movements', 'inventory', p_soft_delete => false, p_client_write => false,
                          p_immutable => true, p_audit => false);
create index stock_movements_variant_idx on public.stock_movements (company_id, variant_id, movement_date desc);
create index stock_movements_source_idx  on public.stock_movements (company_id, source_doc_type, source_doc_id);
create index stock_movements_lot_idx     on public.stock_movements (lot_id) where lot_id is not null;
create index stock_movements_date_idx    on public.stock_movements (company_id, movement_date desc);

create table public.item_cost_history (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null,
  variant_id      uuid not null,
  movement_id     uuid,
  qty_before      numeric(18,4) not null,
  avg_cost_before numeric(18,6) not null,
  qty_in          numeric(18,4) not null,
  unit_cost_in    numeric(18,6) not null,
  avg_cost_after  numeric(18,6) not null,
  reason          text not null,
  foreign key (company_id, variant_id)  references public.product_variants(company_id, id),
  foreign key (company_id, movement_id) references public.stock_movements(company_id, id)
);
select app.register_table('public.item_cost_history', 'inventory', p_soft_delete => false, p_client_write => false,
                          p_immutable => true, p_audit => false);
create index item_cost_history_variant_idx on public.item_cost_history (company_id, variant_id, created_at desc);

create table public.stock_reservations (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null,
  variant_id      uuid not null,
  warehouse_id    uuid not null,
  location_id     uuid,
  lot_id          uuid,
  quantity        numeric(18,4) not null check (quantity > 0),
  source_doc_type text not null references public.document_types(key),
  source_doc_id   uuid not null,
  source_line_id  uuid,
  status          text not null default 'active' check (status in ('active','released','consumed')),
  expires_at      timestamptz,
  foreign key (company_id, variant_id)   references public.product_variants(company_id, id),
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id),
  foreign key (company_id, location_id)  references public.warehouse_locations(company_id, id),
  foreign key (company_id, lot_id)       references public.lots(company_id, id)
);
select app.register_table('public.stock_reservations', 'inventory', p_soft_delete => false, p_client_write => false);
create index stock_reservations_active_idx on public.stock_reservations (company_id, variant_id, warehouse_id) where status = 'active';
create index stock_reservations_source_idx on public.stock_reservations (source_doc_type, source_doc_id);

-- -----------------------------------------------------------------------------
-- Adjustments (inventory module; can require approval)
-- -----------------------------------------------------------------------------
create table public.stock_adjustments (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  number           text not null,
  status           text not null default 'draft',
  warehouse_id     uuid not null,
  adjustment_date  date not null default current_date,
  reason           text not null check (reason in ('opening','correction','damage','loss','theft','found','expiry','count')),
  total_value      numeric(18,2) not null default 0,
  journal_entry_id uuid,
  posted_at        timestamptz,
  notes            text,
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id)
);
select app.register_table('public.stock_adjustments', 'inventory');
select app.register_document('public.stock_adjustments', 'stock_adjustment', 'adjustment_date');

create table public.stock_adjustment_lines (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null,
  adjustment_id   uuid not null,
  variant_id      uuid not null,
  location_id     uuid not null,
  lot_id          uuid,
  quantity_change numeric(18,4) not null check (quantity_change <> 0),  -- signed
  unit_cost       numeric(18,6),           -- for increases; null = current average cost
  notes           text,
  foreign key (company_id, adjustment_id) references public.stock_adjustments(company_id, id) on delete cascade,
  foreign key (company_id, variant_id)    references public.product_variants(company_id, id),
  foreign key (company_id, location_id)   references public.warehouse_locations(company_id, id),
  foreign key (company_id, lot_id)        references public.lots(company_id, id)
);
select app.register_table('public.stock_adjustment_lines', 'inventory', p_soft_delete => false);
select app.register_lines('public.stock_adjustment_lines', 'stock_adjustments', 'adjustment_id', 'draft', p_totals => false, p_tax => false);

-- -----------------------------------------------------------------------------
-- WMS: transfers, cycle counts, tasks
-- -----------------------------------------------------------------------------
create table public.stock_transfers (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id),
  number            text not null,
  status            text not null default 'draft',
  from_warehouse_id uuid not null,
  to_warehouse_id   uuid not null,
  transfer_date     date not null default current_date,
  expected_date     date,
  shipped_at        timestamptz,
  received_at       timestamptz,
  notes             text,
  foreign key (company_id, from_warehouse_id) references public.warehouses(company_id, id),
  foreign key (company_id, to_warehouse_id)   references public.warehouses(company_id, id)
);
select app.register_table('public.stock_transfers', 'wms', 'inventory');
select app.register_document('public.stock_transfers', 'stock_transfer', 'transfer_date');

create table public.stock_transfer_lines (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null,
  transfer_id      uuid not null,
  variant_id       uuid not null,
  lot_id           uuid,
  from_location_id uuid not null,
  to_location_id   uuid not null,
  quantity         numeric(18,4) not null check (quantity > 0),
  quantity_done    numeric(18,4) not null default 0 check (quantity_done >= 0),
  foreign key (company_id, transfer_id)      references public.stock_transfers(company_id, id) on delete cascade,
  foreign key (company_id, variant_id)       references public.product_variants(company_id, id),
  foreign key (company_id, lot_id)           references public.lots(company_id, id),
  foreign key (company_id, from_location_id) references public.warehouse_locations(company_id, id),
  foreign key (company_id, to_location_id)   references public.warehouse_locations(company_id, id)
);
select app.register_table('public.stock_transfer_lines', 'wms', 'inventory', p_soft_delete => false);
select app.register_lines('public.stock_transfer_lines', 'stock_transfers', 'transfer_id', 'draft', p_totals => false, p_tax => false);

create table public.cycle_counts (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  number        text not null,
  status        text not null default 'draft',
  warehouse_id  uuid not null,
  count_date    date not null default current_date,
  scope         text not null default 'location' check (scope in ('full','location','category','abc_class','random')),
  scope_filter  jsonb not null default '{}'::jsonb,
  blind_count   boolean not null default true,   -- hide system qty from counters
  assigned_to   uuid references auth.users(id),
  adjustment_id uuid,
  foreign key (company_id, warehouse_id)  references public.warehouses(company_id, id),
  foreign key (company_id, adjustment_id) references public.stock_adjustments(company_id, id)
);
select app.register_table('public.cycle_counts', 'wms', 'inventory');
select app.register_document('public.cycle_counts', 'cycle_count', 'count_date');

create table public.cycle_count_lines (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null,
  cycle_count_id uuid not null,
  variant_id     uuid not null,
  location_id    uuid not null,
  lot_id         uuid,
  system_qty     numeric(18,4) not null default 0,
  counted_qty    numeric(18,4) check (counted_qty >= 0),
  variance       numeric(18,4) generated always as (counted_qty - system_qty) stored,
  counted_by     uuid references auth.users(id),
  counted_at     timestamptz,
  foreign key (company_id, cycle_count_id) references public.cycle_counts(company_id, id) on delete cascade,
  foreign key (company_id, variant_id)     references public.product_variants(company_id, id),
  foreign key (company_id, location_id)    references public.warehouse_locations(company_id, id),
  foreign key (company_id, lot_id)         references public.lots(company_id, id)
);
select app.register_table('public.cycle_count_lines', 'wms', 'inventory', p_soft_delete => false);
select app.register_lines('public.cycle_count_lines', 'cycle_counts', 'cycle_count_id', 'draft,in_progress', p_totals => false, p_tax => false);

create table public.warehouse_tasks (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  number          text not null,
  status          text not null default 'open',
  task_type       text not null check (task_type in ('putaway','pick','pack','move','replenish','count')),
  warehouse_id    uuid not null,
  priority        smallint not null default 3 check (priority between 1 and 5),
  assigned_to     uuid references auth.users(id),
  source_doc_type text references public.document_types(key),
  source_doc_id   uuid,
  due_at          timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id)
);
select app.register_table('public.warehouse_tasks', 'wms', 'inventory');
select app.register_document('public.warehouse_tasks', 'warehouse_task', 'due_at');
create index warehouse_tasks_assignee_idx on public.warehouse_tasks (assigned_to, status) where deleted_at is null;

create table public.warehouse_task_lines (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null,
  task_id          uuid not null,
  sequence         smallint not null default 1,
  variant_id       uuid not null,
  lot_id           uuid,
  from_location_id uuid,
  to_location_id   uuid,
  quantity         numeric(18,4) not null check (quantity > 0),
  quantity_done    numeric(18,4) not null default 0 check (quantity_done >= 0),
  foreign key (company_id, task_id)          references public.warehouse_tasks(company_id, id) on delete cascade,
  foreign key (company_id, variant_id)       references public.product_variants(company_id, id),
  foreign key (company_id, lot_id)           references public.lots(company_id, id),
  foreign key (company_id, from_location_id) references public.warehouse_locations(company_id, id),
  foreign key (company_id, to_location_id)   references public.warehouse_locations(company_id, id)
);
select app.register_table('public.warehouse_task_lines', 'wms', 'inventory', p_soft_delete => false);
select app.register_lines('public.warehouse_task_lines', 'warehouse_tasks', 'task_id', 'open,in_progress', p_totals => false, p_tax => false);

-- -----------------------------------------------------------------------------
-- OMS: replenishment
-- -----------------------------------------------------------------------------
create table public.replenishment_rules (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null,
  variant_id          uuid not null,
  warehouse_id        uuid not null,
  min_qty             numeric(18,4) not null check (min_qty >= 0),
  max_qty             numeric(18,4) not null,
  multiple_qty        numeric(18,4) not null default 1 check (multiple_qty > 0),
  lead_time_days      smallint,
  preferred_vendor_id uuid,
  replenish_method    text not null default 'buy' check (replenish_method in ('buy','manufacture','transfer')),
  source_warehouse_id uuid,                -- for 'transfer'
  is_active           boolean not null default true,
  foreign key (company_id, variant_id)          references public.product_variants(company_id, id),
  foreign key (company_id, warehouse_id)        references public.warehouses(company_id, id),
  foreign key (company_id, preferred_vendor_id) references public.business_partners(company_id, id),
  foreign key (company_id, source_warehouse_id) references public.warehouses(company_id, id),
  check (max_qty >= min_qty)
);
select app.register_table('public.replenishment_rules', 'oms', 'inventory');
create unique index replenishment_rules_key on public.replenishment_rules (variant_id, warehouse_id) where deleted_at is null;

create table public.replenishment_suggestions (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null,
  rule_id           uuid,
  variant_id        uuid not null,
  warehouse_id      uuid not null,
  replenish_method  text not null check (replenish_method in ('buy','manufacture','transfer')),
  vendor_id         uuid,
  on_hand           numeric(18,4) not null,
  reserved          numeric(18,4) not null,
  incoming          numeric(18,4) not null,
  projected         numeric(18,4) not null,
  suggested_qty     numeric(18,4) not null check (suggested_qty > 0),
  status            text not null default 'open' check (status in ('open','converted','dismissed')),
  purchase_order_id uuid,                -- FK added in procurement migration
  work_order_id     uuid,                -- FK added in manufacturing migration
  generated_at      timestamptz not null default now(),
  foreign key (company_id, rule_id)      references public.replenishment_rules(company_id, id),
  foreign key (company_id, variant_id)   references public.product_variants(company_id, id),
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id),
  foreign key (company_id, vendor_id)    references public.business_partners(company_id, id)
);
select app.register_table('public.replenishment_suggestions', 'oms', 'inventory', p_soft_delete => false);
create index replenishment_suggestions_open_idx on public.replenishment_suggestions (company_id, status) where status = 'open';
