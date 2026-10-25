-- =============================================================================
-- DrisPRO · 0900 · Point of sale
-- Offline-first: the till generates client_uuid for every receipt; the server
-- enforces UNIQUE(company_id, client_uuid) so replaying a queued sale after
-- reconnecting is idempotent. Retail prices in AL/XK are tax-inclusive, so
-- POS lines derive net and VAT from the gross price.
-- Closing a session (Phase 6) posts stock + GL and generates the Z-report.
-- =============================================================================

create table public.pos_registers (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  code            text not null,
  name            text not null,
  warehouse_id    uuid not null,
  location_id     uuid not null,             -- stock leaves from here
  price_list_id   uuid,
  cash_account_id uuid not null,             -- bank_accounts row of kind 'cash'
  journal_id      uuid,
  default_customer_id uuid,                  -- walk-in customer
  fiscal_tcr_code text,                      -- AL: TCR code registered with tax authority
  fiscal_device_serial text,                 -- XK: fiscal device / electronic cash register serial
  receipt_header  text,
  receipt_footer  text,
  is_active       boolean not null default true,
  foreign key (company_id, warehouse_id)        references public.warehouses(company_id, id),
  foreign key (company_id, location_id)         references public.warehouse_locations(company_id, id),
  foreign key (company_id, price_list_id)       references public.price_lists(company_id, id),
  foreign key (company_id, cash_account_id)     references public.bank_accounts(company_id, id),
  foreign key (company_id, journal_id)          references public.journals(company_id, id),
  foreign key (company_id, default_customer_id) references public.business_partners(company_id, id)
);
select app.register_table('public.pos_registers', 'admin', 'pos');
create unique index pos_registers_code_key on public.pos_registers (company_id, code) where deleted_at is null;

create table public.pos_sessions (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id),
  number               text not null,
  status               text not null default 'open',
  register_id          uuid not null,
  opened_by            uuid not null default auth.uid() references auth.users(id),
  opened_at            timestamptz not null default now(),
  closed_at            timestamptz,
  opening_cash         numeric(18,2) not null default 0 check (opening_cash >= 0),
  expected_cash        numeric(18,2),
  closing_cash_counted numeric(18,2),
  cash_difference      numeric(18,2) generated always as (closing_cash_counted - expected_cash) stored,
  journal_entry_id     uuid,
  notes                text,
  foreign key (company_id, register_id)      references public.pos_registers(company_id, id),
  foreign key (company_id, journal_entry_id) references public.journal_entries(company_id, id)
);
select app.register_table('public.pos_sessions', 'pos');
select app.register_document('public.pos_sessions', 'pos_session', 'opened_at');
create unique index pos_sessions_one_open on public.pos_sessions (register_id) where status <> 'closed' and deleted_at is null;

create table public.pos_orders (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id),
  number            text not null,
  status            text not null default 'paid',
  client_uuid       uuid not null,            -- idempotency key generated on the device
  session_id        uuid not null,
  register_id       uuid not null,
  partner_id        uuid,
  cashier_id        uuid not null default auth.uid() references auth.users(id),
  is_refund         boolean not null default false,
  refund_of_id      uuid,
  order_at          timestamptz not null default now(),   -- device time of sale
  offline_created   boolean not null default false,
  synced_at         timestamptz not null default now(),
  subtotal          numeric(18,2) not null default 0,
  discount_total    numeric(18,2) not null default 0,
  tax_total         numeric(18,2) not null default 0,
  total             numeric(18,2) not null default 0,
  amount_paid       numeric(18,2) not null default 0,
  change_given      numeric(18,2) not null default 0 check (change_given >= 0),
  sales_invoice_id  uuid,                      -- when a B2B invoice is requested at the till
  fiscal_status     text not null default 'not_required' check (fiscal_status in ('not_required','pending','fiscalized','failed')),
  foreign key (company_id, session_id)       references public.pos_sessions(company_id, id),
  foreign key (company_id, register_id)      references public.pos_registers(company_id, id),
  foreign key (company_id, partner_id)       references public.business_partners(company_id, id),
  foreign key (company_id, sales_invoice_id) references public.sales_invoices(company_id, id),
  unique (company_id, client_uuid)
);
select app.register_table('public.pos_orders', 'pos');
alter table public.pos_orders add foreign key (company_id, refund_of_id) references public.pos_orders(company_id, id);
select app.register_document('public.pos_orders', 'pos_order', 'order_at');
create index pos_orders_session_idx on public.pos_orders (session_id);

-- POS lines: unit_price is TAX-INCLUSIVE; net and VAT are derived from it.
create table public.pos_order_lines (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null,
  pos_order_id    uuid not null,
  line_no         smallint not null,
  variant_id      uuid not null,
  lot_id          uuid,
  barcode_scanned text,
  description     text not null,
  quantity        numeric(18,4) not null check (quantity <> 0),   -- negative on refunds
  unit_price      numeric(18,4) not null check (unit_price >= 0),
  discount_pct    numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  tax_code_id     uuid,
  tax_rate        numeric(7,4) not null default 0,
  line_total      numeric(18,2) generated always as (round(quantity * unit_price * (1 - discount_pct / 100), 2)) stored,
  line_subtotal   numeric(18,2) generated always as (round(round(quantity * unit_price * (1 - discount_pct / 100), 2) / (1 + tax_rate / 100), 2)) stored,
  tax_amount      numeric(18,2) generated always as (round(quantity * unit_price * (1 - discount_pct / 100), 2)
                                                    - round(round(quantity * unit_price * (1 - discount_pct / 100), 2) / (1 + tax_rate / 100), 2)) stored,
  unit_cost       numeric(18,6),               -- WAC at session posting
  foreign key (company_id, pos_order_id) references public.pos_orders(company_id, id) on delete cascade,
  foreign key (company_id, variant_id)   references public.product_variants(company_id, id),
  foreign key (company_id, lot_id)       references public.lots(company_id, id),
  foreign key (company_id, tax_code_id)  references public.tax_codes(company_id, id),
  unique (pos_order_id, line_no)
);
select app.register_table('public.pos_order_lines', 'pos', p_soft_delete => false);
select app.register_lines('public.pos_order_lines', 'pos_orders', 'pos_order_id', 'draft');

create table public.pos_payments (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null,
  pos_order_id uuid not null,
  method       text not null check (method in ('cash','card','voucher','bank_transfer','other')),
  amount       numeric(18,2) not null check (amount <> 0),
  reference    text,
  paid_at      timestamptz not null default now(),
  foreign key (company_id, pos_order_id) references public.pos_orders(company_id, id) on delete cascade
);
select app.register_table('public.pos_payments', 'pos', p_soft_delete => false, p_immutable => true);
create index pos_payments_order_idx on public.pos_payments (pos_order_id);

create table public.pos_cash_movements (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,
  session_id    uuid not null,
  movement_type text not null check (movement_type in ('cash_in','cash_out')),
  amount        numeric(18,2) not null check (amount > 0),
  reason        text not null,
  foreign key (company_id, session_id) references public.pos_sessions(company_id, id)
);
select app.register_table('public.pos_cash_movements', 'pos', p_soft_delete => false, p_immutable => true);

create table public.z_reports (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id),
  number              text not null,
  status              text not null default 'final',
  session_id          uuid not null,
  register_id         uuid not null,
  report_date         date not null,
  order_count         integer not null default 0,
  refund_count        integer not null default 0,
  gross_sales         numeric(18,2) not null default 0,
  refunds_total       numeric(18,2) not null default 0,
  discounts_total     numeric(18,2) not null default 0,
  net_sales           numeric(18,2) not null default 0,
  tax_total           numeric(18,2) not null default 0,
  payments_by_method  jsonb not null default '{}'::jsonb,   -- {"cash": 1234.50, "card": 900}
  tax_breakdown       jsonb not null default '[]'::jsonb,   -- [{"rate":20,"base":...,"tax":...}]
  opening_cash        numeric(18,2) not null default 0,
  cash_in             numeric(18,2) not null default 0,
  cash_out            numeric(18,2) not null default 0,
  expected_cash       numeric(18,2) not null default 0,
  counted_cash        numeric(18,2),
  cash_difference     numeric(18,2),
  foreign key (company_id, session_id)  references public.pos_sessions(company_id, id),
  foreign key (company_id, register_id) references public.pos_registers(company_id, id),
  unique (session_id)
);
select app.register_table('public.z_reports', 'pos', p_soft_delete => false, p_client_write => false, p_immutable => true);
select app.register_document('public.z_reports', 'z_report', 'report_date');
