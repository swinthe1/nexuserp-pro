-- =============================================================================
-- NexusERP Pro · 0500 · Procurement & purchasing
-- Requisitions → Purchase orders → Goods receipts → Vendor bills
-- Three-way match: each bill line links to its PO line and receipt line;
-- match_status / variances are computed at bill posting (Phase 4) against the
-- tolerances in company_settings. Landed costs re-value receipt lines and
-- flow into weighted average cost.
-- =============================================================================

create table public.purchase_requisitions (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  number          text not null,
  status          text not null default 'draft',
  requested_by    uuid not null default auth.uid() references auth.users(id),
  warehouse_id    uuid,
  required_date   date,
  justification   text,
  estimated_total numeric(18,2) not null default 0,
  approved_at     timestamptz,
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id)
);
select app.register_table('public.purchase_requisitions', 'requisitions');
select app.register_document('public.purchase_requisitions', 'purchase_requisition', 'created_at');

create table public.purchase_requisition_lines (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null,
  requisition_id      uuid not null,
  variant_id          uuid,
  description         text not null,
  quantity            numeric(18,4) not null check (quantity > 0),
  uom_id              uuid,
  estimated_unit_cost numeric(18,4) not null default 0 check (estimated_unit_cost >= 0),
  suggested_vendor_id uuid,
  required_date       date,
  foreign key (company_id, requisition_id)      references public.purchase_requisitions(company_id, id) on delete cascade,
  foreign key (company_id, variant_id)          references public.product_variants(company_id, id),
  foreign key (company_id, uom_id)              references public.units_of_measure(company_id, id),
  foreign key (company_id, suggested_vendor_id) references public.business_partners(company_id, id)
);
select app.register_table('public.purchase_requisition_lines', 'requisitions', p_soft_delete => false);
select app.register_lines('public.purchase_requisition_lines', 'purchase_requisitions', 'requisition_id', 'draft,rejected',
                          p_totals => false, p_tax => false);

create or replace function app.tg_requisition_total()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(new.requisition_id, old.requisition_id);
begin
  update public.purchase_requisitions
     set estimated_total = coalesce((select sum(round(quantity * estimated_unit_cost, 2))
                                       from public.purchase_requisition_lines where requisition_id = v_id), 0)
   where id = v_id;
  return null;
end $$;
create trigger trg_90_totals after insert or update or delete on public.purchase_requisition_lines
  for each row execute function app.tg_requisition_total();

-- -----------------------------------------------------------------------------
-- Purchase orders
-- -----------------------------------------------------------------------------
create table public.purchase_orders (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  number           text not null,
  status           text not null default 'draft',
  billing_status   text not null default 'not_billed' check (billing_status in ('not_billed','partially_billed','billed')),
  vendor_id        uuid not null,
  requisition_id   uuid,
  order_date       date not null default current_date,
  expected_date    date,
  warehouse_id     uuid not null,
  currency_code    char(3) not null references public.currencies(code),
  exchange_rate    numeric(18,8) not null default 1 check (exchange_rate > 0),
  payment_term_id  uuid,
  buyer_id         uuid references auth.users(id),
  vendor_reference text,
  incoterm         text check (incoterm in ('EXW','FCA','FAS','FOB','CFR','CIF','CPT','CIP','DAP','DPU','DDP')),
  subtotal         numeric(18,2) not null default 0,
  discount_total   numeric(18,2) not null default 0,
  tax_total        numeric(18,2) not null default 0,
  total            numeric(18,2) not null default 0,
  total_base       numeric(18,2) generated always as (round(total * exchange_rate, 2)) stored,
  approved_at      timestamptz,
  sent_at          timestamptz,
  notes            text,
  foreign key (company_id, vendor_id)       references public.business_partners(company_id, id),
  foreign key (company_id, requisition_id)  references public.purchase_requisitions(company_id, id),
  foreign key (company_id, warehouse_id)    references public.warehouses(company_id, id),
  foreign key (company_id, payment_term_id) references public.payment_terms(company_id, id)
);
select app.register_table('public.purchase_orders', 'procurement');
select app.register_document('public.purchase_orders', 'purchase_order', 'order_date');
create index purchase_orders_vendor_idx on public.purchase_orders (company_id, vendor_id);

create table public.purchase_order_lines (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null,
  purchase_order_id   uuid not null,
  line_no             smallint not null,
  requisition_line_id uuid,
  variant_id          uuid,
  description         text not null,
  quantity            numeric(18,4) not null check (quantity > 0),
  qty_received        numeric(18,4) not null default 0 check (qty_received >= 0),
  qty_billed          numeric(18,4) not null default 0 check (qty_billed >= 0),
  uom_id              uuid,
  unit_price          numeric(18,4) not null check (unit_price >= 0),
  discount_pct        numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  tax_code_id         uuid,
  tax_rate            numeric(7,4) not null default 0,
  line_subtotal       numeric(18,2) generated always as (round(quantity * unit_price * (1 - discount_pct / 100), 2)) stored,
  tax_amount          numeric(18,2) generated always as (round(round(quantity * unit_price * (1 - discount_pct / 100), 2) * tax_rate / 100, 2)) stored,
  line_total          numeric(18,2) generated always as (round(quantity * unit_price * (1 - discount_pct / 100), 2)
                                                        + round(round(quantity * unit_price * (1 - discount_pct / 100), 2) * tax_rate / 100, 2)) stored,
  expected_date       date,
  foreign key (company_id, purchase_order_id)   references public.purchase_orders(company_id, id) on delete cascade,
  foreign key (company_id, requisition_line_id) references public.purchase_requisition_lines(company_id, id),
  foreign key (company_id, variant_id)          references public.product_variants(company_id, id),
  foreign key (company_id, uom_id)              references public.units_of_measure(company_id, id),
  foreign key (company_id, tax_code_id)         references public.tax_codes(company_id, id),
  unique (purchase_order_id, line_no)
);
select app.register_table('public.purchase_order_lines', 'procurement', p_soft_delete => false);
select app.register_lines('public.purchase_order_lines', 'purchase_orders', 'purchase_order_id', 'draft');
create index purchase_order_lines_variant_idx on public.purchase_order_lines (company_id, variant_id);

alter table public.replenishment_suggestions
  add foreign key (company_id, purchase_order_id) references public.purchase_orders(company_id, id);

-- -----------------------------------------------------------------------------
-- Goods receipts (WMS module)
-- -----------------------------------------------------------------------------
create table public.goods_receipts (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id),
  number               text not null,
  status               text not null default 'draft',
  receipt_type         text not null default 'purchase' check (receipt_type in ('purchase','customer_return','other')),
  purchase_order_id    uuid,
  vendor_id            uuid,
  warehouse_id         uuid not null,
  receipt_date         date not null default current_date,
  vendor_delivery_note text,
  received_by          uuid references auth.users(id),
  total_value          numeric(18,2) not null default 0,  -- base currency, set at posting
  journal_entry_id     uuid,
  done_at              timestamptz,
  notes                text,
  foreign key (company_id, purchase_order_id) references public.purchase_orders(company_id, id),
  foreign key (company_id, vendor_id)         references public.business_partners(company_id, id),
  foreign key (company_id, warehouse_id)      references public.warehouses(company_id, id)
);
select app.register_table('public.goods_receipts', 'wms', 'procurement');
select app.register_document('public.goods_receipts', 'goods_receipt', 'receipt_date');
create index goods_receipts_po_idx on public.goods_receipts (purchase_order_id);

create table public.goods_receipt_lines (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null,
  receipt_id         uuid not null,
  po_line_id         uuid,
  variant_id         uuid not null,
  lot_id             uuid,
  location_id        uuid not null,
  quantity           numeric(18,4) not null check (quantity > 0),
  unit_cost          numeric(18,6),                 -- base currency, from PO price × rate at posting
  landed_cost_amount numeric(18,4) not null default 0,
  qc_status          text not null default 'accepted' check (qc_status in ('pending','accepted','rejected')),
  foreign key (company_id, receipt_id)  references public.goods_receipts(company_id, id) on delete cascade,
  foreign key (company_id, po_line_id)  references public.purchase_order_lines(company_id, id),
  foreign key (company_id, variant_id)  references public.product_variants(company_id, id),
  foreign key (company_id, lot_id)      references public.lots(company_id, id),
  foreign key (company_id, location_id) references public.warehouse_locations(company_id, id)
);
select app.register_table('public.goods_receipt_lines', 'wms', 'procurement', p_soft_delete => false);
select app.register_lines('public.goods_receipt_lines', 'goods_receipts', 'receipt_id', 'draft', p_totals => false, p_tax => false);
create index goods_receipt_lines_po_line_idx on public.goods_receipt_lines (po_line_id);

-- -----------------------------------------------------------------------------
-- Vendor bills & vendor credit notes (invoicing module)
-- -----------------------------------------------------------------------------
create table public.vendor_bills (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id),
  number                text not null,
  document_type         text not null default 'vendor_bill' check (document_type in ('vendor_bill','vendor_credit')),
  status                text not null default 'draft',
  payment_status        text not null default 'unpaid' check (payment_status in ('unpaid','partially_paid','paid')),
  vendor_id             uuid not null,
  purchase_order_id     uuid,
  original_bill_id      uuid,
  vendor_invoice_number text not null,
  bill_date             date not null default current_date,
  due_date              date not null default current_date,
  currency_code         char(3) not null references public.currencies(code),
  exchange_rate         numeric(18,8) not null default 1 check (exchange_rate > 0),
  payment_term_id       uuid,
  subtotal              numeric(18,2) not null default 0,
  discount_total        numeric(18,2) not null default 0,
  tax_total             numeric(18,2) not null default 0,
  total                 numeric(18,2) not null default 0,
  total_base            numeric(18,2) generated always as (round(total * exchange_rate, 2)) stored,
  amount_paid           numeric(18,2) not null default 0 check (amount_paid >= 0),
  amount_due            numeric(18,2) generated always as (total - amount_paid) stored,
  match_status          text not null default 'not_matched'
                        check (match_status in ('not_matched','matched','exception','overridden','not_applicable')),
  match_override_by     uuid references auth.users(id),
  match_override_reason text,
  posted_at             timestamptz,
  journal_entry_id      uuid,
  notes                 text,
  foreign key (company_id, vendor_id)         references public.business_partners(company_id, id),
  foreign key (company_id, purchase_order_id) references public.purchase_orders(company_id, id),
  foreign key (company_id, payment_term_id)   references public.payment_terms(company_id, id),
  check (due_date >= bill_date),
  check (match_status <> 'overridden' or match_override_reason is not null)
);
select app.register_table('public.vendor_bills', 'invoicing');
alter table public.vendor_bills add foreign key (company_id, original_bill_id) references public.vendor_bills(company_id, id);
select app.register_document('public.vendor_bills', 'vendor_bill', 'bill_date');
-- Prevent entering the same vendor invoice twice
create unique index vendor_bills_vendor_invoice_key on public.vendor_bills (company_id, vendor_id, document_type, lower(vendor_invoice_number))
  where deleted_at is null and status <> 'cancelled';
create index vendor_bills_open_idx on public.vendor_bills (company_id, due_date)
  where status = 'posted' and payment_status <> 'paid' and deleted_at is null;   -- AP aging

create table public.vendor_bill_lines (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null,
  bill_id         uuid not null,
  line_no         smallint not null,
  po_line_id      uuid,
  receipt_line_id uuid,
  variant_id      uuid,
  description     text not null,
  account_id      uuid,                     -- expense account for non-stock lines
  cost_center_id  uuid,
  quantity        numeric(18,4) not null check (quantity > 0),
  uom_id          uuid,
  unit_price      numeric(18,4) not null check (unit_price >= 0),
  discount_pct    numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  tax_code_id     uuid,
  tax_rate        numeric(7,4) not null default 0,
  line_subtotal   numeric(18,2) generated always as (round(quantity * unit_price * (1 - discount_pct / 100), 2)) stored,
  tax_amount      numeric(18,2) generated always as (round(round(quantity * unit_price * (1 - discount_pct / 100), 2) * tax_rate / 100, 2)) stored,
  line_total      numeric(18,2) generated always as (round(quantity * unit_price * (1 - discount_pct / 100), 2)
                                                    + round(round(quantity * unit_price * (1 - discount_pct / 100), 2) * tax_rate / 100, 2)) stored,
  match_status    text not null default 'not_matched'
                  check (match_status in ('not_matched','matched','qty_variance','price_variance','no_receipt','not_applicable')),
  qty_variance    numeric(18,4),
  price_variance  numeric(18,4),
  foreign key (company_id, bill_id)         references public.vendor_bills(company_id, id) on delete cascade,
  foreign key (company_id, po_line_id)      references public.purchase_order_lines(company_id, id),
  foreign key (company_id, receipt_line_id) references public.goods_receipt_lines(company_id, id),
  foreign key (company_id, variant_id)      references public.product_variants(company_id, id),
  foreign key (company_id, account_id)      references public.accounts(company_id, id),
  foreign key (company_id, cost_center_id)  references public.cost_centers(company_id, id),
  foreign key (company_id, uom_id)          references public.units_of_measure(company_id, id),
  foreign key (company_id, tax_code_id)     references public.tax_codes(company_id, id),
  unique (bill_id, line_no)
);
select app.register_table('public.vendor_bill_lines', 'invoicing', p_soft_delete => false);
select app.register_lines('public.vendor_bill_lines', 'vendor_bills', 'bill_id', 'draft');

-- -----------------------------------------------------------------------------
-- Landed costs (freight, customs, insurance… capitalised into inventory)
-- -----------------------------------------------------------------------------
create table public.landed_costs (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id),
  number            text not null,
  status            text not null default 'draft',
  landed_cost_date  date not null default current_date,
  allocation_method text not null default 'value' check (allocation_method in ('value','quantity','weight','volume','equal')),
  vendor_bill_id    uuid,
  total_amount      numeric(18,2) not null default 0,
  journal_entry_id  uuid,
  posted_at         timestamptz,
  notes             text,
  foreign key (company_id, vendor_bill_id) references public.vendor_bills(company_id, id)
);
select app.register_table('public.landed_costs', 'procurement');
select app.register_document('public.landed_costs', 'landed_cost', 'landed_cost_date');

create table public.landed_cost_receipts (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null,
  landed_cost_id uuid not null,
  receipt_id     uuid not null,
  foreign key (company_id, landed_cost_id) references public.landed_costs(company_id, id) on delete cascade,
  foreign key (company_id, receipt_id)     references public.goods_receipts(company_id, id),
  unique (landed_cost_id, receipt_id)
);
select app.register_table('public.landed_cost_receipts', 'procurement', p_soft_delete => false);
select app.register_lines('public.landed_cost_receipts', 'landed_costs', 'landed_cost_id', 'draft', p_totals => false, p_tax => false);

create table public.landed_cost_charges (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null,
  landed_cost_id uuid not null,
  charge_type    text not null check (charge_type in ('freight','customs','insurance','handling','storage','other')),
  description    text,
  amount         numeric(18,2) not null check (amount > 0),
  account_id     uuid,                       -- clearing account credited
  foreign key (company_id, landed_cost_id) references public.landed_costs(company_id, id) on delete cascade,
  foreign key (company_id, account_id)     references public.accounts(company_id, id)
);
select app.register_table('public.landed_cost_charges', 'procurement', p_soft_delete => false);
select app.register_lines('public.landed_cost_charges', 'landed_costs', 'landed_cost_id', 'draft', p_totals => false, p_tax => false);

create or replace function app.tg_landed_cost_total()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(new.landed_cost_id, old.landed_cost_id);
begin
  update public.landed_costs
     set total_amount = coalesce((select sum(amount) from public.landed_cost_charges where landed_cost_id = v_id), 0)
   where id = v_id;
  return null;
end $$;
create trigger trg_90_totals after insert or update or delete on public.landed_cost_charges
  for each row execute function app.tg_landed_cost_total();

create table public.landed_cost_allocations (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null,
  landed_cost_id   uuid not null,
  receipt_line_id  uuid not null,
  basis_value      numeric(18,4) not null,
  allocated_amount numeric(18,4) not null,
  foreign key (company_id, landed_cost_id)  references public.landed_costs(company_id, id) on delete cascade,
  foreign key (company_id, receipt_line_id) references public.goods_receipt_lines(company_id, id),
  unique (landed_cost_id, receipt_line_id)
);
select app.register_table('public.landed_cost_allocations', 'procurement', p_soft_delete => false, p_client_write => false);
