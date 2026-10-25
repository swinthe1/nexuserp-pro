-- =============================================================================
-- NexusERP Pro · 0400 · CRM & Sales
-- Leads → Opportunities → Quotes → Sales Orders → Deliveries → Invoices
--
-- Line amounts are generated columns (tax-exclusive pricing):
--   line_subtotal = round(qty * unit_price * (1 - discount%), 2)
--   tax_amount    = round(line_subtotal * tax_rate%, 2)
--   line_total    = line_subtotal + tax_amount
-- tax_rate is snapshotted from tax_codes on insert / tax code change.
-- Header subtotal/discount/tax/total are recalculated from lines by trigger.
-- =============================================================================

create table public.crm_pipeline_stages (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  name        text not null,
  sort_order  smallint not null default 0,
  probability numeric(5,2) not null default 0 check (probability between 0 and 100),
  is_won      boolean not null default false,
  is_lost     boolean not null default false,
  check (not (is_won and is_lost))
);
select app.register_table('public.crm_pipeline_stages', 'crm', 'core');

create table public.leads (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  number          text not null,
  status          text not null default 'new',
  title           text not null,
  contact_name    text,
  company_name    text,
  email           text,
  phone           text,
  source          text not null default 'other' check (source in ('website','referral','walk_in','campaign','cold_call','social','event','other')),
  owner_id        uuid references auth.users(id),
  estimated_value numeric(18,2),
  currency_code   char(3) references public.currencies(code),
  score           smallint check (score between 0 and 100),
  partner_id      uuid,                    -- set on conversion
  lost_reason     text,
  notes           text,
  foreign key (company_id, partner_id) references public.business_partners(company_id, id)
);
select app.register_table('public.leads', 'crm');
select app.register_document('public.leads', 'lead', 'created_at');
create index leads_owner_idx on public.leads (company_id, owner_id) where deleted_at is null;

create table public.opportunities (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id),
  number              text not null,
  status              text not null default 'open',
  name                text not null,
  partner_id          uuid,
  lead_id             uuid,
  stage_id            uuid not null,
  owner_id            uuid references auth.users(id),
  expected_value      numeric(18,2) not null default 0,
  currency_code       char(3) not null references public.currencies(code),
  probability         numeric(5,2) not null default 0 check (probability between 0 and 100),
  weighted_value      numeric(18,2) generated always as (round(expected_value * probability / 100, 2)) stored,
  expected_close_date date,
  closed_at           timestamptz,
  lost_reason         text,
  foreign key (company_id, partner_id) references public.business_partners(company_id, id),
  foreign key (company_id, lead_id)    references public.leads(company_id, id),
  foreign key (company_id, stage_id)   references public.crm_pipeline_stages(company_id, id)
);
select app.register_table('public.opportunities', 'crm');
select app.register_document('public.opportunities', 'opportunity', 'created_at');
create index opportunities_stage_idx on public.opportunities (company_id, stage_id) where deleted_at is null;

-- -----------------------------------------------------------------------------
-- Quotes
-- -----------------------------------------------------------------------------
create table public.sales_quotes (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id),
  number              text not null,
  status              text not null default 'draft',
  partner_id          uuid not null,
  opportunity_id      uuid,
  quote_date          date not null default current_date,
  valid_until         date,
  currency_code       char(3) not null references public.currencies(code),
  exchange_rate       numeric(18,8) not null default 1 check (exchange_rate > 0),
  price_list_id       uuid,
  payment_term_id     uuid,
  salesperson_id      uuid references auth.users(id),
  billing_address_id  uuid,
  shipping_address_id uuid,
  subtotal            numeric(18,2) not null default 0,
  discount_total      numeric(18,2) not null default 0,
  tax_total           numeric(18,2) not null default 0,
  total               numeric(18,2) not null default 0,
  total_base          numeric(18,2) generated always as (round(total * exchange_rate, 2)) stored,
  notes               text,
  terms               text,
  foreign key (company_id, partner_id)          references public.business_partners(company_id, id),
  foreign key (company_id, opportunity_id)      references public.opportunities(company_id, id),
  foreign key (company_id, price_list_id)       references public.price_lists(company_id, id),
  foreign key (company_id, payment_term_id)     references public.payment_terms(company_id, id),
  foreign key (company_id, billing_address_id)  references public.partner_addresses(company_id, id),
  foreign key (company_id, shipping_address_id) references public.partner_addresses(company_id, id),
  check (valid_until is null or valid_until >= quote_date)
);
select app.register_table('public.sales_quotes', 'sales');
select app.register_document('public.sales_quotes', 'sales_quote', 'quote_date');
create index sales_quotes_partner_idx on public.sales_quotes (company_id, partner_id);

create table public.sales_quote_lines (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,
  quote_id      uuid not null,
  line_no       smallint not null,
  variant_id    uuid,
  description   text not null,
  quantity      numeric(18,4) not null check (quantity > 0),
  uom_id        uuid,
  unit_price    numeric(18,4) not null check (unit_price >= 0),
  discount_pct  numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  tax_code_id   uuid,
  tax_rate      numeric(7,4) not null default 0,
  line_subtotal numeric(18,2) generated always as (round(quantity * unit_price * (1 - discount_pct / 100), 2)) stored,
  tax_amount    numeric(18,2) generated always as (round(round(quantity * unit_price * (1 - discount_pct / 100), 2) * tax_rate / 100, 2)) stored,
  line_total    numeric(18,2) generated always as (round(quantity * unit_price * (1 - discount_pct / 100), 2)
                                                  + round(round(quantity * unit_price * (1 - discount_pct / 100), 2) * tax_rate / 100, 2)) stored,
  foreign key (company_id, quote_id)    references public.sales_quotes(company_id, id) on delete cascade,
  foreign key (company_id, variant_id)  references public.product_variants(company_id, id),
  foreign key (company_id, uom_id)      references public.units_of_measure(company_id, id),
  foreign key (company_id, tax_code_id) references public.tax_codes(company_id, id),
  unique (quote_id, line_no)
);
select app.register_table('public.sales_quote_lines', 'sales', p_soft_delete => false);
select app.register_lines('public.sales_quote_lines', 'sales_quotes', 'quote_id', 'draft');

-- -----------------------------------------------------------------------------
-- Sales orders
-- -----------------------------------------------------------------------------
create table public.sales_orders (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id),
  number              text not null,
  status              text not null default 'draft',
  invoice_status      text not null default 'not_invoiced' check (invoice_status in ('not_invoiced','partially_invoiced','invoiced')),
  partner_id          uuid not null,
  quote_id            uuid,
  order_date          date not null default current_date,
  requested_date      date,
  warehouse_id        uuid not null,
  currency_code       char(3) not null references public.currencies(code),
  exchange_rate       numeric(18,8) not null default 1 check (exchange_rate > 0),
  price_list_id       uuid,
  payment_term_id     uuid,
  salesperson_id      uuid references auth.users(id),
  billing_address_id  uuid,
  shipping_address_id uuid,
  channel             text not null default 'direct' check (channel in ('direct','phone','email','ecommerce','pos','marketplace')),
  customer_reference  text,
  subtotal            numeric(18,2) not null default 0,
  discount_total      numeric(18,2) not null default 0,
  tax_total           numeric(18,2) not null default 0,
  total               numeric(18,2) not null default 0,
  total_base          numeric(18,2) generated always as (round(total * exchange_rate, 2)) stored,
  confirmed_at        timestamptz,
  cancel_reason       text,
  notes               text,
  foreign key (company_id, partner_id)          references public.business_partners(company_id, id),
  foreign key (company_id, quote_id)            references public.sales_quotes(company_id, id),
  foreign key (company_id, warehouse_id)        references public.warehouses(company_id, id),
  foreign key (company_id, price_list_id)       references public.price_lists(company_id, id),
  foreign key (company_id, payment_term_id)     references public.payment_terms(company_id, id),
  foreign key (company_id, billing_address_id)  references public.partner_addresses(company_id, id),
  foreign key (company_id, shipping_address_id) references public.partner_addresses(company_id, id)
);
select app.register_table('public.sales_orders', 'sales');
select app.register_document('public.sales_orders', 'sales_order', 'order_date');
create index sales_orders_partner_idx on public.sales_orders (company_id, partner_id);
create index sales_orders_date_idx    on public.sales_orders (company_id, order_date desc) where deleted_at is null;

create table public.sales_order_lines (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null,
  sales_order_id uuid not null,
  line_no        smallint not null,
  variant_id     uuid,
  description    text not null,
  quantity       numeric(18,4) not null check (quantity > 0),
  qty_reserved   numeric(18,4) not null default 0 check (qty_reserved >= 0),
  qty_delivered  numeric(18,4) not null default 0 check (qty_delivered >= 0),
  qty_invoiced   numeric(18,4) not null default 0 check (qty_invoiced >= 0),
  uom_id         uuid,
  unit_price     numeric(18,4) not null check (unit_price >= 0),
  discount_pct   numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  tax_code_id    uuid,
  tax_rate       numeric(7,4) not null default 0,
  line_subtotal  numeric(18,2) generated always as (round(quantity * unit_price * (1 - discount_pct / 100), 2)) stored,
  tax_amount     numeric(18,2) generated always as (round(round(quantity * unit_price * (1 - discount_pct / 100), 2) * tax_rate / 100, 2)) stored,
  line_total     numeric(18,2) generated always as (round(quantity * unit_price * (1 - discount_pct / 100), 2)
                                                   + round(round(quantity * unit_price * (1 - discount_pct / 100), 2) * tax_rate / 100, 2)) stored,
  requested_date date,
  foreign key (company_id, sales_order_id) references public.sales_orders(company_id, id) on delete cascade,
  foreign key (company_id, variant_id)     references public.product_variants(company_id, id),
  foreign key (company_id, uom_id)         references public.units_of_measure(company_id, id),
  foreign key (company_id, tax_code_id)    references public.tax_codes(company_id, id),
  unique (sales_order_id, line_no)
);
select app.register_table('public.sales_order_lines', 'sales', p_soft_delete => false);
select app.register_lines('public.sales_order_lines', 'sales_orders', 'sales_order_id', 'draft');
create index sales_order_lines_variant_idx on public.sales_order_lines (company_id, variant_id);

-- -----------------------------------------------------------------------------
-- Deliveries (outbound; WMS module)
-- -----------------------------------------------------------------------------
create table public.deliveries (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id),
  number              text not null,
  status              text not null default 'draft',
  delivery_type       text not null default 'outbound' check (delivery_type in ('outbound','return')),
  sales_order_id      uuid,
  partner_id          uuid not null,
  warehouse_id        uuid not null,
  shipping_address_id uuid,
  scheduled_date      date not null default current_date,
  done_at             timestamptz,
  carrier_id          uuid,                -- FK added in logistics migration
  tracking_number     text,
  total_cost          numeric(18,2) not null default 0,   -- COGS of the delivery (set at posting)
  journal_entry_id    uuid,
  notes               text,
  foreign key (company_id, sales_order_id)      references public.sales_orders(company_id, id),
  foreign key (company_id, partner_id)          references public.business_partners(company_id, id),
  foreign key (company_id, warehouse_id)        references public.warehouses(company_id, id),
  foreign key (company_id, shipping_address_id) references public.partner_addresses(company_id, id)
);
select app.register_table('public.deliveries', 'wms', 'sales');
select app.register_document('public.deliveries', 'delivery', 'scheduled_date');
create index deliveries_order_idx on public.deliveries (sales_order_id);

create table public.delivery_lines (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null,
  delivery_id         uuid not null,
  sales_order_line_id uuid,
  variant_id          uuid not null,
  lot_id              uuid,
  location_id         uuid not null,
  quantity            numeric(18,4) not null check (quantity > 0),
  unit_cost           numeric(18,6),         -- WAC snapshot at posting (COGS)
  foreign key (company_id, delivery_id)         references public.deliveries(company_id, id) on delete cascade,
  foreign key (company_id, sales_order_line_id) references public.sales_order_lines(company_id, id),
  foreign key (company_id, variant_id)          references public.product_variants(company_id, id),
  foreign key (company_id, lot_id)              references public.lots(company_id, id),
  foreign key (company_id, location_id)         references public.warehouse_locations(company_id, id)
);
select app.register_table('public.delivery_lines', 'wms', 'sales', p_soft_delete => false);
select app.register_lines('public.delivery_lines', 'deliveries', 'delivery_id', 'draft,ready', p_totals => false, p_tax => false);

-- -----------------------------------------------------------------------------
-- Customer invoices & credit notes (invoicing module)
-- -----------------------------------------------------------------------------
create table public.sales_invoices (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id),
  number              text not null,
  document_type       text not null default 'sales_invoice' check (document_type in ('sales_invoice','credit_note')),
  status              text not null default 'draft',
  payment_status      text not null default 'unpaid' check (payment_status in ('unpaid','partially_paid','paid')),
  source              text not null default 'manual' check (source in ('manual','sales_order','pos','ecommerce')),
  partner_id          uuid not null,
  sales_order_id      uuid,
  original_invoice_id uuid,                  -- credit note → invoice it corrects
  invoice_date        date not null default current_date,
  due_date            date not null default current_date,
  currency_code       char(3) not null references public.currencies(code),
  exchange_rate       numeric(18,8) not null default 1 check (exchange_rate > 0),
  payment_term_id     uuid,
  salesperson_id      uuid references auth.users(id),
  billing_address_id  uuid,
  subtotal            numeric(18,2) not null default 0,
  discount_total      numeric(18,2) not null default 0,
  tax_total           numeric(18,2) not null default 0,
  total               numeric(18,2) not null default 0,
  total_base          numeric(18,2) generated always as (round(total * exchange_rate, 2)) stored,
  amount_paid         numeric(18,2) not null default 0 check (amount_paid >= 0),
  amount_due          numeric(18,2) generated always as (total - amount_paid) stored,
  posted_at           timestamptz,
  journal_entry_id    uuid,
  fiscal_status       text not null default 'not_required' check (fiscal_status in ('not_required','pending','fiscalized','failed')),
  notes               text,
  foreign key (company_id, partner_id)         references public.business_partners(company_id, id),
  foreign key (company_id, sales_order_id)     references public.sales_orders(company_id, id),
  foreign key (company_id, payment_term_id)    references public.payment_terms(company_id, id),
  foreign key (company_id, billing_address_id) references public.partner_addresses(company_id, id),
  check (due_date >= invoice_date),
  check (document_type = 'credit_note' or original_invoice_id is null)
);
select app.register_table('public.sales_invoices', 'invoicing', 'invoicing');
alter table public.sales_invoices add foreign key (company_id, original_invoice_id) references public.sales_invoices(company_id, id);
select app.register_document('public.sales_invoices', 'sales_invoice', 'invoice_date');
create index sales_invoices_partner_idx on public.sales_invoices (company_id, partner_id, status);
create index sales_invoices_open_idx    on public.sales_invoices (company_id, due_date)
  where status = 'posted' and payment_status <> 'paid' and deleted_at is null;   -- AR aging

create table public.sales_invoice_lines (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null,
  invoice_id          uuid not null,
  line_no             smallint not null,
  sales_order_line_id uuid,
  delivery_line_id    uuid,
  variant_id          uuid,
  description         text not null,
  account_id          uuid,                  -- revenue account override
  cost_center_id      uuid,
  quantity            numeric(18,4) not null check (quantity > 0),
  uom_id              uuid,
  unit_price          numeric(18,4) not null check (unit_price >= 0),
  discount_pct        numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  tax_code_id         uuid,
  tax_rate            numeric(7,4) not null default 0,
  line_subtotal       numeric(18,2) generated always as (round(quantity * unit_price * (1 - discount_pct / 100), 2)) stored,
  tax_amount          numeric(18,2) generated always as (round(round(quantity * unit_price * (1 - discount_pct / 100), 2) * tax_rate / 100, 2)) stored,
  line_total          numeric(18,2) generated always as (round(quantity * unit_price * (1 - discount_pct / 100), 2)
                                                        + round(round(quantity * unit_price * (1 - discount_pct / 100), 2) * tax_rate / 100, 2)) stored,
  foreign key (company_id, invoice_id)          references public.sales_invoices(company_id, id) on delete cascade,
  foreign key (company_id, sales_order_line_id) references public.sales_order_lines(company_id, id),
  foreign key (company_id, delivery_line_id)    references public.delivery_lines(company_id, id),
  foreign key (company_id, variant_id)          references public.product_variants(company_id, id),
  foreign key (company_id, account_id)          references public.accounts(company_id, id),
  foreign key (company_id, cost_center_id)      references public.cost_centers(company_id, id),
  foreign key (company_id, uom_id)              references public.units_of_measure(company_id, id),
  foreign key (company_id, tax_code_id)         references public.tax_codes(company_id, id),
  unique (invoice_id, line_no)
);
select app.register_table('public.sales_invoice_lines', 'invoicing', p_soft_delete => false);
select app.register_lines('public.sales_invoice_lines', 'sales_invoices', 'invoice_id', 'draft');
