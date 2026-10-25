-- =============================================================================
-- DrisPRO · 0200 · Master data
-- Chart of accounts, cost centers, fiscal calendar, payment terms, tax codes,
-- units of measure, price lists, business partners, warehouses & locations,
-- product catalog (templates, attributes, variants, barcodes), vendor pricing.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Chart of accounts
-- -----------------------------------------------------------------------------
create table public.accounts (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),
  code               text not null,
  name               text not null,
  account_type       text not null check (account_type in ('asset','liability','equity','revenue','expense')),
  account_subtype    text not null check (account_subtype in (
                       'cash','bank','receivable','inventory','current_asset','fixed_asset','accumulated_depreciation',
                       'non_current_asset','payable','tax','current_liability','long_term_liability','equity',
                       'retained_earnings','revenue','other_income','cogs','expense','depreciation','other_expense')),
  parent_id          uuid,
  is_postable        boolean not null default true,     -- false = group/header account
  is_reconcilable    boolean not null default false,    -- AR/AP/bank: open items tracked
  currency_code      char(3) references public.currencies(code),  -- null = any currency
  cash_flow_category text check (cash_flow_category in ('operating','investing','financing')),
  normal_balance     text generated always as (case when account_type in ('asset','expense') then 'debit' else 'credit' end) stored,
  description        text,
  is_active          boolean not null default true
);
select app.register_table('public.accounts', 'finance', 'core');
alter table public.accounts add foreign key (company_id, parent_id) references public.accounts(company_id, id);
create unique index accounts_code_key on public.accounts (company_id, code) where deleted_at is null;

create table public.cost_centers (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  code       text not null,
  name       text not null,
  parent_id  uuid,
  manager_id uuid references auth.users(id),
  is_active  boolean not null default true
);
select app.register_table('public.cost_centers', 'finance', 'core');
alter table public.cost_centers add foreign key (company_id, parent_id) references public.cost_centers(company_id, id);
create unique index cost_centers_code_key on public.cost_centers (company_id, code) where deleted_at is null;

create table public.fiscal_years (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name       text not null,
  start_date date not null,
  end_date   date not null,
  status     text not null default 'open' check (status in ('open','closed')),
  check (end_date > start_date)
);
select app.register_table('public.fiscal_years', 'finance', 'core');
alter table public.fiscal_years add constraint fiscal_years_no_overlap
  exclude using gist (company_id extensions.gist_uuid_ops with =, daterange(start_date, end_date, '[]') with &&)
  where (deleted_at is null);

create table public.fiscal_periods (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null,
  fiscal_year_id uuid not null,
  period_no      smallint not null check (period_no between 1 and 13),
  name           text not null,
  start_date     date not null,
  end_date       date not null,
  status         text not null default 'open' check (status in ('open','closed','locked')),
  foreign key (company_id, fiscal_year_id) references public.fiscal_years(company_id, id),
  check (end_date >= start_date),
  unique (fiscal_year_id, period_no)
);
select app.register_table('public.fiscal_periods', 'finance', 'core', p_soft_delete => false);
alter table public.fiscal_periods add constraint fiscal_periods_no_overlap
  exclude using gist (company_id extensions.gist_uuid_ops with =, daterange(start_date, end_date, '[]') with &&);

-- -----------------------------------------------------------------------------
-- Payment terms, tax codes, units of measure
-- -----------------------------------------------------------------------------
create table public.payment_terms (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  code          text not null,
  name          text not null,
  due_days      smallint not null default 0 check (due_days >= 0),
  discount_pct  numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  discount_days smallint not null default 0,
  is_active     boolean not null default true
);
select app.register_table('public.payment_terms', 'finance', 'core');
create unique index payment_terms_code_key on public.payment_terms (company_id, code) where deleted_at is null;

create table public.tax_codes (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id),
  code                  text not null,
  name                  text not null,
  rate                  numeric(7,4) not null check (rate >= 0 and rate <= 100),
  scope                 text not null default 'both' check (scope in ('sales','purchase','both')),
  tax_type              text not null default 'vat' check (tax_type in ('vat','excise','withholding','other')),
  country_code          char(2),
  is_exempt             boolean not null default false,
  exemption_code        text,           -- fiscal exemption reason (e.g. AL TYPE_1 / export)
  is_reverse_charge     boolean not null default false,
  vat_book_column       text,           -- which Sales/Purchase-book column the base lands in
  output_account_id     uuid,           -- VAT payable
  input_account_id      uuid,           -- VAT receivable
  is_active             boolean not null default true,
  foreign key (company_id, output_account_id) references public.accounts(company_id, id),
  foreign key (company_id, input_account_id)  references public.accounts(company_id, id)
);
select app.register_table('public.tax_codes', 'tax', 'core');
create unique index tax_codes_code_key on public.tax_codes (company_id, code) where deleted_at is null;

alter table public.company_settings
  add foreign key (company_id, default_sales_tax_code_id)    references public.tax_codes(company_id, id),
  add foreign key (company_id, default_purchase_tax_code_id) references public.tax_codes(company_id, id);

create table public.units_of_measure (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  code         text not null,
  name         text not null,
  category     text not null check (category in ('unit','weight','volume','length','area','time')),
  ratio        numeric(18,8) not null default 1 check (ratio > 0),  -- relative to the category reference unit
  is_reference boolean not null default false,
  rounding     numeric(18,8) not null default 0.0001,
  is_active    boolean not null default true
);
select app.register_table('public.units_of_measure', 'inventory', 'core');
create unique index uom_code_key on public.units_of_measure (company_id, code) where deleted_at is null;
create unique index uom_one_reference on public.units_of_measure (company_id, category) where is_reference and deleted_at is null;

-- -----------------------------------------------------------------------------
-- Price lists
-- -----------------------------------------------------------------------------
create table public.price_lists (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  name          text not null,
  list_type     text not null default 'sales' check (list_type in ('sales','purchase')),
  currency_code char(3) not null references public.currencies(code),
  prices_include_tax boolean not null default false,
  is_default    boolean not null default false,
  valid_from    date,
  valid_to      date,
  is_active     boolean not null default true
);
select app.register_table('public.price_lists', 'sales', 'core');
create unique index price_lists_one_default on public.price_lists (company_id, list_type) where is_default and deleted_at is null;

-- -----------------------------------------------------------------------------
-- Business partners (customers + vendors in one table)
-- -----------------------------------------------------------------------------
create table public.business_partners (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id),
  code                  text not null,
  name                  text not null,
  legal_name            text,
  kind                  text not null default 'company' check (kind in ('company','individual')),
  is_customer           boolean not null default false,
  is_vendor             boolean not null default false,
  tax_number            text,             -- NIPT / NUI / personal number
  vat_number            text,
  email                 text,
  phone                 text,
  website               text,
  currency_code         char(3) references public.currencies(code),
  payment_term_id       uuid,
  price_list_id         uuid,
  credit_limit          numeric(18,2) check (credit_limit >= 0),
  receivable_account_id uuid,
  payable_account_id    uuid,
  salesperson_id        uuid references auth.users(id),
  tags                  text[] not null default '{}',
  notes                 text,
  is_active             boolean not null default true,
  foreign key (company_id, payment_term_id)       references public.payment_terms(company_id, id),
  foreign key (company_id, price_list_id)         references public.price_lists(company_id, id),
  foreign key (company_id, receivable_account_id) references public.accounts(company_id, id),
  foreign key (company_id, payable_account_id)    references public.accounts(company_id, id),
  check (is_customer or is_vendor)
);
select app.register_table('public.business_partners', 'partners');
create unique index business_partners_code_key on public.business_partners (company_id, code) where deleted_at is null;
create index business_partners_name_trgm on public.business_partners using gin (name extensions.gin_trgm_ops);
create index business_partners_tax_idx on public.business_partners (company_id, tax_number) where deleted_at is null;

create table public.partner_contacts (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  partner_id uuid not null,
  name       text not null,
  job_title  text,
  email      text,
  phone      text,
  is_primary boolean not null default false,
  foreign key (company_id, partner_id) references public.business_partners(company_id, id)
);
select app.register_table('public.partner_contacts', 'partners');
create index on public.partner_contacts (partner_id);

create table public.partner_addresses (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null,
  partner_id   uuid not null,
  address_type text not null default 'both' check (address_type in ('billing','shipping','both')),
  label        text,
  line1        text not null,
  line2        text,
  city         text not null,
  postal_code  text,
  region       text,
  country_code char(2) not null default 'AL',
  latitude     numeric(9,6),
  longitude    numeric(9,6),
  is_default   boolean not null default false,
  foreign key (company_id, partner_id) references public.business_partners(company_id, id)
);
select app.register_table('public.partner_addresses', 'partners');
create index on public.partner_addresses (partner_id);

-- -----------------------------------------------------------------------------
-- Warehouses and locations
-- Virtual locations (supplier, customer, adjustment, production, scrap,
-- transit) have warehouse_id null; every stock movement goes from one
-- location to another, so stock is always conserved.
-- -----------------------------------------------------------------------------
create table public.warehouses (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id),
  code           text not null,
  name           text not null,
  warehouse_type text not null default 'warehouse' check (warehouse_type in ('warehouse','store','production','transit')),
  address_line1  text,
  city           text,
  country_code   char(2),
  manager_id     uuid references auth.users(id),
  is_active      boolean not null default true
);
select app.register_table('public.warehouses', 'inventory');
create unique index warehouses_code_key on public.warehouses (company_id, code) where deleted_at is null;

alter table public.company_settings
  add foreign key (company_id, default_warehouse_id) references public.warehouses(company_id, id);

create table public.warehouse_locations (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  warehouse_id  uuid,
  parent_id     uuid,
  code          text not null,
  name          text not null,
  location_type text not null default 'internal' check (location_type in (
                  'view','internal','receiving','putaway','picking','packing','shipping','quality','production',
                  'supplier','customer','adjustment','scrap','transit')),
  barcode       text,
  is_pickable   boolean not null default true,
  max_weight_kg numeric(12,3),
  is_active     boolean not null default true,
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id),
  check ((warehouse_id is null) = (location_type in ('supplier','customer','adjustment','scrap','transit')) or location_type = 'production')
);
select app.register_table('public.warehouse_locations', 'inventory');
alter table public.warehouse_locations add foreign key (company_id, parent_id) references public.warehouse_locations(company_id, id);
create unique index warehouse_locations_code_key on public.warehouse_locations (company_id, warehouse_id, code)
  nulls not distinct where deleted_at is null;
create unique index warehouse_locations_barcode_key on public.warehouse_locations (company_id, barcode)
  where barcode is not null and deleted_at is null;

-- -----------------------------------------------------------------------------
-- Product catalog
-- -----------------------------------------------------------------------------
create table public.product_categories (
  id                          uuid primary key default gen_random_uuid(),
  company_id                  uuid not null references public.companies(id),
  parent_id                   uuid,
  code                        text,
  name                        text not null,
  inventory_account_id        uuid,
  revenue_account_id          uuid,
  cogs_account_id             uuid,
  expense_account_id          uuid,
  price_difference_account_id uuid,
  foreign key (company_id, inventory_account_id)        references public.accounts(company_id, id),
  foreign key (company_id, revenue_account_id)          references public.accounts(company_id, id),
  foreign key (company_id, cogs_account_id)             references public.accounts(company_id, id),
  foreign key (company_id, expense_account_id)          references public.accounts(company_id, id),
  foreign key (company_id, price_difference_account_id) references public.accounts(company_id, id)
);
select app.register_table('public.product_categories', 'inventory');
alter table public.product_categories add foreign key (company_id, parent_id) references public.product_categories(company_id, id);

create table public.products (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id),
  code                 text not null,           -- template code; variants carry the SKU
  name                 text not null,
  description          text,
  product_type         text not null default 'stockable' check (product_type in ('stockable','consumable','service')),
  category_id          uuid,
  uom_id               uuid not null,
  purchase_uom_id      uuid,
  tracking             text not null default 'none' check (tracking in ('none','lot','serial')),
  track_expiry         boolean not null default false,
  is_sellable          boolean not null default true,
  is_purchasable       boolean not null default true,
  is_manufactured      boolean not null default false,
  sales_price          numeric(18,4) not null default 0 check (sales_price >= 0),
  sales_tax_code_id    uuid,
  purchase_tax_code_id uuid,
  brand                text,
  weight_kg            numeric(12,4),
  volume_m3            numeric(12,6),
  hs_code              text,                    -- customs tariff code
  image_path           text,
  tags                 text[] not null default '{}',
  is_active            boolean not null default true,
  foreign key (company_id, category_id)          references public.product_categories(company_id, id),
  foreign key (company_id, uom_id)               references public.units_of_measure(company_id, id),
  foreign key (company_id, purchase_uom_id)      references public.units_of_measure(company_id, id),
  foreign key (company_id, sales_tax_code_id)    references public.tax_codes(company_id, id),
  foreign key (company_id, purchase_tax_code_id) references public.tax_codes(company_id, id),
  check (product_type = 'stockable' or tracking = 'none')
);
select app.register_table('public.products', 'inventory');
create unique index products_code_key on public.products (company_id, code) where deleted_at is null;
create index products_name_trgm on public.products using gin (name extensions.gin_trgm_ops);
create index products_category_idx on public.products (company_id, category_id);

create table public.product_attributes (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  name         text not null,                   -- Size, Color, Flavor
  display_type text not null default 'select' check (display_type in ('select','color','pills')),
  sort_order   smallint not null default 0
);
select app.register_table('public.product_attributes', 'inventory');
create unique index product_attributes_name_key on public.product_attributes (company_id, lower(name)) where deleted_at is null;

create table public.product_attribute_values (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null,
  attribute_id uuid not null,
  value        text not null,
  color_hex    text check (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order   smallint not null default 0,
  foreign key (company_id, attribute_id) references public.product_attributes(company_id, id)
);
select app.register_table('public.product_attribute_values', 'inventory');
create unique index product_attribute_values_key on public.product_attribute_values (attribute_id, lower(value)) where deleted_at is null;

-- Every product has >= 1 variant; ALL transactional lines reference variants.
create table public.product_variants (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null,
  product_id           uuid not null,
  sku                  text not null,
  name                 text not null,            -- e.g. 'T-Shirt Basic / M / Navy'
  sales_price_override numeric(18,4) check (sales_price_override >= 0),
  standard_cost        numeric(18,6) not null default 0,  -- reference/planning cost; valuation uses item_costs
  weight_kg            numeric(12,4),
  is_default           boolean not null default false,
  is_active            boolean not null default true,
  foreign key (company_id, product_id) references public.products(company_id, id)
);
select app.register_table('public.product_variants', 'inventory');
create unique index product_variants_sku_key on public.product_variants (company_id, sku) where deleted_at is null;
create unique index product_variants_one_default on public.product_variants (product_id) where is_default and deleted_at is null;
create index product_variants_product_idx on public.product_variants (product_id);
create index product_variants_name_trgm on public.product_variants using gin (name extensions.gin_trgm_ops);

create table public.variant_attribute_values (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null,
  variant_id         uuid not null,
  attribute_value_id uuid not null,
  foreign key (company_id, variant_id)         references public.product_variants(company_id, id) on delete cascade,
  foreign key (company_id, attribute_value_id) references public.product_attribute_values(company_id, id),
  unique (variant_id, attribute_value_id)
);
select app.register_table('public.variant_attribute_values', 'inventory', p_soft_delete => false);

create table public.product_barcodes (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  variant_id uuid not null,
  barcode    text not null,
  symbology  text not null default 'ean13' check (symbology in ('ean13','ean8','upca','code128','code39','qr','datamatrix','internal')),
  uom_id     uuid,                               -- e.g. a carton barcode
  quantity   numeric(18,4) not null default 1 check (quantity > 0),  -- units per scan
  is_primary boolean not null default false,
  foreign key (company_id, variant_id) references public.product_variants(company_id, id),
  foreign key (company_id, uom_id)     references public.units_of_measure(company_id, id)
);
select app.register_table('public.product_barcodes', 'inventory');
create unique index product_barcodes_key on public.product_barcodes (company_id, barcode) where deleted_at is null;
create index product_barcodes_variant_idx on public.product_barcodes (variant_id);

create table public.price_list_items (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,
  price_list_id uuid not null,
  variant_id    uuid not null,
  min_quantity  numeric(18,4) not null default 1 check (min_quantity > 0),
  price         numeric(18,4) not null check (price >= 0),
  discount_pct  numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  valid_from    date,
  valid_to      date,
  foreign key (company_id, price_list_id) references public.price_lists(company_id, id),
  foreign key (company_id, variant_id)    references public.product_variants(company_id, id),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);
select app.register_table('public.price_list_items', 'sales', 'core');
create index price_list_items_lookup on public.price_list_items (price_list_id, variant_id, min_quantity) where deleted_at is null;

create table public.vendor_products (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null,
  vendor_id           uuid not null,
  variant_id          uuid not null,
  vendor_sku          text,
  vendor_product_name text,
  price               numeric(18,4) not null check (price >= 0),
  currency_code       char(3) not null references public.currencies(code),
  min_order_qty       numeric(18,4) not null default 1 check (min_order_qty > 0),
  lead_time_days      smallint not null default 0 check (lead_time_days >= 0),
  is_preferred        boolean not null default false,
  foreign key (company_id, vendor_id)  references public.business_partners(company_id, id),
  foreign key (company_id, variant_id) references public.product_variants(company_id, id)
);
select app.register_table('public.vendor_products', 'procurement', 'inventory');
create unique index vendor_products_key on public.vendor_products (vendor_id, variant_id) where deleted_at is null;
create unique index vendor_products_one_preferred on public.vendor_products (variant_id) where is_preferred and deleted_at is null;
