-- =============================================================================
-- NexusERP Pro · 0700 · Finance & accounting
--
-- Every operational posting (receipt, delivery, invoice, bill, payment, POS
-- session, work order, adjustment, depreciation, payroll) produces ONE
-- journal entry referencing its source document (source_doc_type/id), and the
-- source stores journal_entry_id back — full two-way traceability.
--
-- Integrity enforced in the database (not just the UI):
--   * a posted entry must balance (Σdebit = Σcredit > 0, ≥ 2 lines)
--   * only active, postable (leaf) accounts can be used
--   * the entry date must fall in an OPEN fiscal period
--   * posted entries and their lines are frozen; correct by reversal
-- =============================================================================

create table public.journals (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),
  code               text not null,
  name               text not null,
  journal_type       text not null check (journal_type in ('sales','purchase','cash','bank','general','inventory','payroll','pos','manufacturing','depreciation')),
  default_account_id uuid,
  is_active          boolean not null default true,
  foreign key (company_id, default_account_id) references public.accounts(company_id, id)
);
select app.register_table('public.journals', 'finance', 'core');
create unique index journals_code_key on public.journals (company_id, code) where deleted_at is null;

-- Posting rules: which account the automatic GL engine uses for each role.
-- Category- and partner-level overrides take precedence where they exist.
create table public.company_account_defaults (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  key        text not null check (key in (
               'receivable','payable','customer_advances','vendor_advances',
               'inventory','grni','cogs','purchase_price_variance','inventory_adjustment','landed_cost_clearing',
               'wip','labor_absorbed','overhead_absorbed','production_variance',
               'sales_revenue','sales_discount','vat_output','vat_input',
               'cash','bank','pos_cash','card_clearing','rounding','exchange_gain','exchange_loss',
               'retained_earnings','current_year_earnings',
               'salary_expense','salary_payable','social_security_payable','health_insurance_payable',
               'pension_payable','income_tax_payable','employer_contribution_expense',
               'depreciation_expense','accumulated_depreciation','asset_disposal_gain','asset_disposal_loss')),
  account_id uuid not null,
  foreign key (company_id, account_id) references public.accounts(company_id, id),
  unique (company_id, key)
);
select app.register_table('public.company_account_defaults', 'finance', 'core', p_soft_delete => false);

create table public.journal_entries (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  number          text not null,
  status          text not null default 'draft',
  journal_id      uuid not null,
  entry_date      date not null default current_date,
  period_id       uuid,
  reference       text,
  memo            text,
  source_doc_type text references public.document_types(key),
  source_doc_id   uuid,
  is_automatic    boolean not null default false,
  reversal_of_id  uuid,
  reversed_by_id  uuid,
  currency_code   char(3) references public.currencies(code),
  total_debit     numeric(18,2) not null default 0,
  total_credit    numeric(18,2) not null default 0,
  posted_at       timestamptz,
  posted_by       uuid,
  foreign key (company_id, journal_id) references public.journals(company_id, id),
  foreign key (company_id, period_id)  references public.fiscal_periods(company_id, id)
);
select app.register_table('public.journal_entries', 'finance');
alter table public.journal_entries
  add foreign key (company_id, reversal_of_id) references public.journal_entries(company_id, id),
  add foreign key (company_id, reversed_by_id) references public.journal_entries(company_id, id);
select app.register_document('public.journal_entries', 'journal_entry', 'entry_date');
create index journal_entries_date_idx   on public.journal_entries (company_id, entry_date) where status = 'posted';
create index journal_entries_source_idx on public.journal_entries (company_id, source_doc_type, source_doc_id);
-- One live automatic entry per source document
create unique index journal_entries_one_auto_per_source on public.journal_entries (company_id, source_doc_type, source_doc_id)
  where is_automatic and status = 'posted' and reversal_of_id is null;

create table public.journal_lines (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null,
  entry_id        uuid not null,
  line_no         smallint not null,
  account_id      uuid not null,
  debit           numeric(18,2) not null default 0 check (debit >= 0),    -- base currency
  credit          numeric(18,2) not null default 0 check (credit >= 0),
  currency_code   char(3) references public.currencies(code),
  amount_currency numeric(18,2),                                         -- signed, foreign currency
  partner_id      uuid,
  cost_center_id  uuid,
  tax_code_id     uuid,
  variant_id      uuid,
  description     text,
  foreign key (company_id, entry_id)       references public.journal_entries(company_id, id) on delete cascade,
  foreign key (company_id, account_id)     references public.accounts(company_id, id),
  foreign key (company_id, partner_id)     references public.business_partners(company_id, id),
  foreign key (company_id, cost_center_id) references public.cost_centers(company_id, id),
  foreign key (company_id, tax_code_id)    references public.tax_codes(company_id, id),
  foreign key (company_id, variant_id)     references public.product_variants(company_id, id),
  check ((debit = 0) <> (credit = 0)),     -- exactly one side, non-zero
  unique (entry_id, line_no)
);
select app.register_table('public.journal_lines', 'finance', p_soft_delete => false);
create index journal_lines_entry_idx   on public.journal_lines (entry_id);
create index journal_lines_account_idx on public.journal_lines (company_id, account_id);
create index journal_lines_partner_idx on public.journal_lines (company_id, partner_id) where partner_id is not null;

-- Lines are editable only while the entry is a draft — for everyone, system included
create or replace function app.tg_journal_lines_lock()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
  select status into v_status from public.journal_entries
   where id = case when tg_op = 'DELETE' then old.entry_id else new.entry_id end;
  if v_status is distinct from 'draft' then
    raise exception 'Journal lines are frozen once the entry is %', v_status using errcode = '55000';
  end if;
  if tg_op = 'UPDATE' and new.entry_id <> old.entry_id then
    raise exception 'Lines cannot move between entries' using errcode = '55000';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger trg_05_lock before insert or update or delete on public.journal_lines
  for each row execute function app.tg_journal_lines_lock();

create or replace function app.tg_journal_totals()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(new.entry_id, old.entry_id);
begin
  update public.journal_entries e
     set total_debit  = coalesce((select sum(debit)  from public.journal_lines where entry_id = v_id), 0),
         total_credit = coalesce((select sum(credit) from public.journal_lines where entry_id = v_id), 0)
   where e.id = v_id;
  return null;
end $$;
create trigger trg_90_totals after insert or update or delete on public.journal_lines
  for each row execute function app.tg_journal_totals();

-- Header guard: resolve period, stamp posting, freeze posted entries
create or replace function app.tg_journal_entry_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_allowed text[] := array['status','reversed_by_id','updated_at','updated_by','total_debit','total_credit'];
begin
  if tg_op = 'UPDATE' and old.status <> 'draft' then
    if (to_jsonb(new) - v_allowed) is distinct from (to_jsonb(old) - v_allowed) then
      raise exception 'Posted journal entries are immutable; create a reversal instead' using errcode = '55000';
    end if;
  end if;

  if tg_op = 'INSERT' or new.entry_date is distinct from old.entry_date then
    select p.id into new.period_id from public.fiscal_periods p
     where p.company_id = new.company_id and new.entry_date between p.start_date and p.end_date;
  end if;

  if new.status = 'posted' and (tg_op = 'INSERT' or old.status <> 'posted') then
    new.posted_at := now();
    new.posted_by := auth.uid();
  end if;
  return new;
end $$;
create trigger trg_04_guard before insert or update on public.journal_entries
  for each row execute function app.tg_journal_entry_guard();

-- Deferred: runs at COMMIT so lines inserted after the header are counted
create or replace function app.tg_journal_entry_validate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare e public.journal_entries; v_lines int; v_dr numeric; v_cr numeric; v_bad text; v_period text;
begin
  select * into e from public.journal_entries where id = new.id;
  if e.status <> 'posted' then return null; end if;

  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    into v_lines, v_dr, v_cr from public.journal_lines where entry_id = e.id;
  if v_lines < 2 then
    raise exception 'Journal entry % needs at least two lines', e.number using errcode = '23514';
  end if;
  if v_dr <> v_cr or v_dr = 0 then
    raise exception 'Journal entry % is not balanced (debit %, credit %)', e.number, v_dr, v_cr using errcode = '23514';
  end if;

  select string_agg(a.code, ', ') into v_bad
    from public.journal_lines l join public.accounts a on a.id = l.account_id
   where l.entry_id = e.id and (not a.is_postable or not a.is_active or a.deleted_at is not null);
  if v_bad is not null then
    raise exception 'Accounts % cannot be posted to (group, inactive or deleted)', v_bad using errcode = '23514';
  end if;

  select status into v_period from public.fiscal_periods where id = e.period_id;
  if v_period is null then
    raise exception 'No fiscal period covers %', e.entry_date using errcode = '23514';
  elsif v_period <> 'open' and e.reversed_by_id is null then
    raise exception 'Fiscal period for % is %', e.entry_date, v_period using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger trg_validate_posted after insert or update on public.journal_entries
  deferrable initially deferred for each row execute function app.tg_journal_entry_validate();

-- -----------------------------------------------------------------------------
-- Banking
-- -----------------------------------------------------------------------------
create table public.bank_accounts (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  name            text not null,
  account_kind    text not null default 'bank' check (account_kind in ('bank','cash','card','ewallet')),
  bank_name       text,
  iban            text,
  swift           text,
  account_number  text,
  currency_code   char(3) not null references public.currencies(code),
  account_id      uuid not null,             -- GL account
  journal_id      uuid,
  is_active       boolean not null default true,
  foreign key (company_id, account_id) references public.accounts(company_id, id),
  foreign key (company_id, journal_id) references public.journals(company_id, id)
);
select app.register_table('public.bank_accounts', 'finance', 'core');

create table public.bank_statements (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  bank_account_id uuid not null,
  statement_date  date not null,
  reference       text,
  opening_balance numeric(18,2) not null,
  closing_balance numeric(18,2) not null,
  status          text not null default 'open' check (status in ('open','reconciled')),
  foreign key (company_id, bank_account_id) references public.bank_accounts(company_id, id)
);
select app.register_table('public.bank_statements', 'finance');

create table public.bank_statement_lines (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null,
  statement_id            uuid not null,
  transaction_date        date not null,
  value_date              date,
  description             text not null,
  reference               text,
  amount                  numeric(18,2) not null check (amount <> 0),   -- + inflow / − outflow
  counterparty_name       text,
  counterparty_iban       text,
  partner_id              uuid,
  match_status            text not null default 'unmatched' check (match_status in ('unmatched','matched','ignored')),
  matched_payment_id      uuid,               -- FK below (payments created after)
  matched_journal_line_id uuid,
  foreign key (company_id, statement_id)            references public.bank_statements(company_id, id) on delete cascade,
  foreign key (company_id, partner_id)              references public.business_partners(company_id, id),
  foreign key (company_id, matched_journal_line_id) references public.journal_lines(company_id, id)
);
select app.register_table('public.bank_statement_lines', 'finance', p_soft_delete => false);
create index bank_statement_lines_unmatched on public.bank_statement_lines (company_id) where match_status = 'unmatched';

-- -----------------------------------------------------------------------------
-- Payments (customer receipts and vendor payments) and allocations
-- -----------------------------------------------------------------------------
create table public.payments (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  number           text not null,
  document_type    text not null check (document_type in ('customer_payment','vendor_payment')),
  status           text not null default 'draft',
  partner_id       uuid not null,
  payment_date     date not null default current_date,
  method           text not null check (method in ('cash','bank_transfer','card','cheque','offset','other')),
  amount           numeric(18,2) not null check (amount > 0),
  currency_code    char(3) not null references public.currencies(code),
  exchange_rate    numeric(18,8) not null default 1 check (exchange_rate > 0),
  amount_base      numeric(18,2) generated always as (round(amount * exchange_rate, 2)) stored,
  bank_account_id  uuid not null,
  reference        text,
  allocated_amount numeric(18,2) not null default 0 check (allocated_amount >= 0),
  unallocated      numeric(18,2) generated always as (amount - allocated_amount) stored,
  posted_at        timestamptz,
  journal_entry_id uuid,
  notes            text,
  foreign key (company_id, partner_id)       references public.business_partners(company_id, id),
  foreign key (company_id, bank_account_id)  references public.bank_accounts(company_id, id),
  foreign key (company_id, journal_entry_id) references public.journal_entries(company_id, id),
  check (allocated_amount <= amount)
);
select app.register_table('public.payments', 'invoicing');
select app.register_document('public.payments', 'customer_payment', 'payment_date');
create index payments_partner_idx on public.payments (company_id, partner_id, payment_date desc);

alter table public.bank_statement_lines
  add foreign key (company_id, matched_payment_id) references public.payments(company_id, id);

create table public.payment_allocations (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null,
  payment_id       uuid not null,
  sales_invoice_id uuid,
  vendor_bill_id   uuid,
  amount           numeric(18,2) not null check (amount > 0),   -- payment currency
  foreign key (company_id, payment_id)       references public.payments(company_id, id) on delete cascade,
  foreign key (company_id, sales_invoice_id) references public.sales_invoices(company_id, id),
  foreign key (company_id, vendor_bill_id)   references public.vendor_bills(company_id, id),
  check (num_nonnulls(sales_invoice_id, vendor_bill_id) = 1)
);
select app.register_table('public.payment_allocations', 'invoicing', p_soft_delete => false);
select app.register_lines('public.payment_allocations', 'payments', 'payment_id', 'draft', p_totals => false, p_tax => false);
create index payment_allocations_invoice_idx on public.payment_allocations (sales_invoice_id) where sales_invoice_id is not null;
create index payment_allocations_bill_idx    on public.payment_allocations (vendor_bill_id) where vendor_bill_id is not null;

-- -----------------------------------------------------------------------------
-- Fixed assets
-- -----------------------------------------------------------------------------
create table public.fixed_asset_categories (
  id                             uuid primary key default gen_random_uuid(),
  company_id                     uuid not null references public.companies(id),
  name                           text not null,
  useful_life_months             smallint not null check (useful_life_months > 0),
  depreciation_method            text not null default 'straight_line' check (depreciation_method in ('straight_line','declining_balance')),
  declining_rate_pct             numeric(5,2),
  asset_account_id               uuid not null,
  accumulated_depreciation_account_id uuid not null,
  depreciation_expense_account_id uuid not null,
  foreign key (company_id, asset_account_id)                    references public.accounts(company_id, id),
  foreign key (company_id, accumulated_depreciation_account_id) references public.accounts(company_id, id),
  foreign key (company_id, depreciation_expense_account_id)     references public.accounts(company_id, id)
);
select app.register_table('public.fixed_asset_categories', 'finance');

create table public.fixed_assets (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references public.companies(id),
  number                   text not null,
  status                   text not null default 'draft',
  name                     text not null,
  category_id              uuid not null,
  acquisition_date         date not null,
  in_service_date          date not null,
  acquisition_cost         numeric(18,2) not null check (acquisition_cost > 0),
  salvage_value            numeric(18,2) not null default 0 check (salvage_value >= 0),
  useful_life_months       smallint not null check (useful_life_months > 0),
  depreciation_method      text not null default 'straight_line' check (depreciation_method in ('straight_line','declining_balance')),
  declining_rate_pct       numeric(5,2),
  accumulated_depreciation numeric(18,2) not null default 0 check (accumulated_depreciation >= 0),
  book_value               numeric(18,2) generated always as (acquisition_cost - accumulated_depreciation) stored,
  cost_center_id           uuid,
  vendor_id                uuid,
  vendor_bill_id           uuid,
  serial_number            text,
  barcode                  text,
  location_note            text,
  custodian_employee_id    uuid,               -- FK added in HR migration
  disposal_date            date,
  disposal_amount          numeric(18,2),
  journal_entry_id         uuid,
  foreign key (company_id, category_id)      references public.fixed_asset_categories(company_id, id),
  foreign key (company_id, cost_center_id)   references public.cost_centers(company_id, id),
  foreign key (company_id, vendor_id)        references public.business_partners(company_id, id),
  foreign key (company_id, vendor_bill_id)   references public.vendor_bills(company_id, id),
  foreign key (company_id, journal_entry_id) references public.journal_entries(company_id, id),
  check (salvage_value < acquisition_cost),
  check (accumulated_depreciation <= acquisition_cost - salvage_value),
  check (in_service_date >= acquisition_date)
);
select app.register_table('public.fixed_assets', 'finance');
select app.register_document('public.fixed_assets', 'fixed_asset', 'acquisition_date');

create table public.asset_depreciation_lines (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null,
  asset_id                 uuid not null,
  period_date              date not null,
  amount                   numeric(18,2) not null check (amount > 0),
  accumulated_after        numeric(18,2) not null,
  status                   text not null default 'planned' check (status in ('planned','posted')),
  journal_entry_id         uuid,
  foreign key (company_id, asset_id)         references public.fixed_assets(company_id, id),
  foreign key (company_id, journal_entry_id) references public.journal_entries(company_id, id),
  unique (asset_id, period_date)
);
select app.register_table('public.asset_depreciation_lines', 'finance', p_soft_delete => false, p_client_write => false);

-- -----------------------------------------------------------------------------
-- Traceability: operational documents → their journal entry
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['stock_movements','stock_adjustments','deliveries','sales_invoices',
                           'goods_receipts','vendor_bills','landed_costs','work_orders'] loop
    execute format('alter table public.%I add foreign key (company_id, journal_entry_id) references public.journal_entries(company_id, id)', t);
    execute format('create index on public.%I (journal_entry_id) where journal_entry_id is not null', t);
  end loop;
end $$;
