-- =============================================================================
-- NexusERP Pro · Phase 11: migration centre (moving a client from another program)
--
-- The client's position on the cut-over date comes in from spreadsheets:
--   * open customer invoices and open vendor bills  → real invoices/bills marked
--     is_opening (they age, take payments, count in credit limits) but stay out of
--     sales, purchase and VAT figures; one journal entry on the cut-over date:
--     receivables/payables against 1091 Opening balance equity
--   * opening balances of the other accounts (trial balance) → one journal entry
--     on the cut-over date, the difference to 1091
--   * price lists
-- Products, partners, employees and opening stock keep using import_rows().
-- Every import is logged (migration_runs); migration_check() compares the totals
-- with the old program's reports. Column mappings can be saved as templates.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Opening documents
-- -----------------------------------------------------------------------------
alter table public.sales_invoices add column if not exists is_opening boolean not null default false;
alter table public.vendor_bills   add column if not exists is_opening boolean not null default false;

-- opening documents are posted in one migration entry, not one by one on their old dates
create or replace function app.tg_document_gl()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'posted' and old.status is distinct from 'posted' then
    if tg_table_name in ('sales_invoices','vendor_bills') and coalesce((to_jsonb(new) ->> 'is_opening')::boolean, false) then
      return null;
    end if;
    case tg_table_name
      when 'sales_invoices' then perform app.gl_sales_invoice(new.id);
      when 'vendor_bills'   then perform app.gl_vendor_bill(new.id);
      when 'landed_costs'   then perform app.gl_landed_cost(new.id);
    end case;
  end if;
  return null;
end $$;

-- keep opening documents out of sales, purchase and VAT figures (they still age and take payments)
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

select app._patch_function('app.vat_entries', $x$i.source <> 'pos'$x$, $x$i.source <> 'pos' and not i.is_opening$x$);
select app._patch_function('app.vat_entries', $x$b.status = 'posted' and b.deleted_at is null$x$, $x$b.status = 'posted' and b.deleted_at is null and not b.is_opening$x$);
select app._patch_function('app.sales_facts', $x$i.source <> 'pos'$x$, $x$i.source <> 'pos' and not i.is_opening$x$);
select app._patch_function('app.purchase_facts', $x$b.status = 'posted' and b.deleted_at is null$x$, $x$b.status = 'posted' and b.deleted_at is null and not b.is_opening$x$);
select app._patch_function('public.sales_overview',
  $x$inv_range as (select * from inv where invoice_date between p_from and p_to)$x$,
  $x$inv_range as (select * from inv where invoice_date between p_from and p_to and not is_opening)$x$);
select app._patch_function('public.sales_overview',
  $x$from inv where date_trunc('month', invoice_date) = m$x$,
  $x$from inv where not is_opening and date_trunc('month', invoice_date) = m$x$);
select app._patch_function('public.procurement_overview',
  $x$bills_range as (select * from bills where bill_date between p_from and p_to)$x$,
  $x$bills_range as (select * from bills where bill_date between p_from and p_to and not is_opening)$x$);
drop function app._patch_function(text, text, text);

do $$
declare v text;
begin
  v := pg_get_viewdef('public.v_sales_book'::regclass);
  if position($x$(i.source <> 'pos'::text)$x$ in v) = 0 then raise exception 'v_sales_book patch does not apply'; end if;
  execute 'create or replace view public.v_sales_book with (security_invoker = true) as '
       || replace(v, $x$(i.source <> 'pos'::text)$x$, $x$(i.source <> 'pos'::text) AND (NOT i.is_opening)$x$);
  v := pg_get_viewdef('public.v_purchase_book'::regclass);
  if position($x$(b.deleted_at IS NULL)$x$ in v) = 0 then raise exception 'v_purchase_book patch does not apply'; end if;
  execute 'create or replace view public.v_purchase_book with (security_invoker = true) as '
       || replace(v, $x$(b.deleted_at IS NULL)$x$, $x$(b.deleted_at IS NULL) AND (NOT b.is_opening)$x$);
end $$;

-- journal entries made by the migration point back to it
insert into public.document_types (key, name, module, table_name, default_prefix)
values ('migration', 'Migration', 'finance', 'migration_runs', 'MIG-') on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Log of imports and saved column mappings
-- -----------------------------------------------------------------------------
create table public.migration_runs (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  kind         text not null,
  file_name    text,
  cutover_date date,
  rows         int not null default 0,
  created      int not null default 0,
  updated      int not null default 0,
  skipped      int not null default 0,
  total        numeric(18,2),
  journal_entry_id uuid,
  run_by       uuid default auth.uid(),
  run_at       timestamptz not null default now()
);
create index migration_runs_company_idx on public.migration_runs (company_id, kind, run_at desc);
alter table public.migration_runs enable row level security;
revoke all on public.migration_runs from anon, authenticated;
grant select on public.migration_runs to authenticated;
create policy migration_runs_select on public.migration_runs for select to authenticated
  using (company_id = any ((select app.company_ids_with('admin.read'))::uuid[]));

create table public.import_templates (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references public.companies(id) on delete cascade,   -- null: shared by the platform administrator
  kind          text not null,
  name          text not null,
  source_system text,
  mapping       jsonb not null,                                           -- {field: "header in the file"}
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index import_templates_name_key on public.import_templates (coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid), kind, lower(name));
alter table public.import_templates enable row level security;
revoke all on public.import_templates from anon, authenticated;
grant select on public.import_templates to authenticated;
create policy import_templates_select on public.import_templates for select to authenticated
  using (company_id is null or company_id = any ((select app.my_company_ids())::uuid[]));

create or replace function public.save_import_template(p_company uuid, p_kind text, p_name text, p_source text, p_mapping jsonb, p_shared boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid; v_company uuid := case when p_shared then null else p_company end;
begin
  if p_shared then perform app.require_super_admin(); else perform app.require_permission(p_company, 'admin.write'); end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Give the template a name' using errcode = '23514'; end if;
  if jsonb_typeof(p_mapping) <> 'object' then raise exception 'The column mapping is missing' using errcode = '23514'; end if;
  select id into v from public.import_templates
   where coalesce(company_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_company, '00000000-0000-0000-0000-000000000000'::uuid)
     and kind = p_kind and lower(name) = lower(btrim(p_name));
  if v is null then
    insert into public.import_templates (company_id, kind, name, source_system, mapping)
    values (v_company, p_kind, btrim(p_name), nullif(btrim(p_source), ''), p_mapping) returning id into v;
  else
    update public.import_templates set mapping = p_mapping, source_system = nullif(btrim(p_source), ''), updated_at = now() where id = v;
  end if;
  return v;
end $$;

create or replace function public.delete_import_template(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.import_templates;
begin
  select * into t from public.import_templates where id = p_id;
  if t.id is null then raise exception 'Template not found' using errcode = 'P0002'; end if;
  if t.company_id is null then perform app.require_super_admin(); else perform app.require_permission(t.company_id, 'admin.write'); end if;
  delete from public.import_templates where id = p_id;
end $$;

-- log entry for the existing importer (products, partners, employees, opening stock)
create or replace function public.log_migration_run(p_company uuid, p_kind text, p_file text, p_rows int, p_created int, p_updated int, p_skipped int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'core.read');
  insert into public.migration_runs (company_id, kind, file_name, rows, created, updated, skipped)
  values (p_company, p_kind, p_file, p_rows, p_created, p_updated, p_skipped);
end $$;

-- -----------------------------------------------------------------------------
-- 3. Imports for the cut-over position
-- -----------------------------------------------------------------------------
create or replace function app.mig_num(p text)
returns numeric language plpgsql immutable as $$
declare v text := btrim(coalesce(p, ''));
begin
  if v = '' then return null; end if;
  v := replace(replace(v, ' ', ''), chr(160), '');
  -- 1.234,56 (Albanian/European) or 1,234.56; a single comma is a decimal comma
  if v ~ '^-?[0-9.]+,[0-9]+$' then v := replace(replace(v, '.', ''), ',', '.');
  elsif v ~ '^-?[0-9,]+\.[0-9]+$' then v := replace(v, ',', '');
  elsif v ~ '^-?[0-9]+,[0-9]+$' then v := replace(v, ',', '.');
  end if;
  return v::numeric;
exception when others then
  return 'NaN'::numeric;
end $$;

create or replace function app.mig_partner(p_company uuid, p_key text, p_role text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.business_partners p
   where p.company_id = p_company and p.deleted_at is null
     and (p_role = 'customer' and p.is_customer or p_role = 'vendor' and p.is_vendor)
     and (upper(p.code) = upper(btrim(p_key)) or upper(coalesce(p.tax_number, '')) = upper(btrim(p_key))
          or upper(coalesce(p.vat_number, '')) = upper(btrim(p_key)) or lower(p.name) = lower(btrim(p_key)))
   order by (upper(p.code) = upper(btrim(p_key))) desc, (upper(coalesce(p.tax_number, '')) = upper(btrim(p_key))) desc
   limit 1
$$;

-- p_rows: [{field: value}] with the fields of each kind (see the app's column list)
create or replace function public.migration_import(p_company uuid, p_kind text, p_rows jsonb, p_dry_run boolean default true,
                                                   p_cutover date default current_date, p_file text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.companies; r jsonb; i int := 0; v_errors jsonb := '[]'::jsonb; v_ok int := 0; v_created int := 0; v_updated int := 0;
  v_partner uuid; v_amount numeric; v_date date; v_due date; v_cur text; v_rate numeric; v_number text; v_doc uuid; v_acct uuid;
  v_total numeric := 0; v_lines jsonb := '[]'::jsonb; v_je uuid; v_open uuid; v_err text; v_field text;
  v_dr numeric; v_cr numeric; a public.accounts; v_list uuid; v_variant uuid; v_minq numeric; v_period text;
  v_docs uuid[] := '{}';
begin
  select * into c from public.companies where id = p_company and deleted_at is null;
  if c.id is null then raise exception 'Company not found' using errcode = 'P0002'; end if;
  perform app.require_permission(p_company, 'admin.write');
  if p_kind not in ('open_receivables','open_payables','opening_balances','price_lists') then
    raise exception 'Unknown import %', p_kind using errcode = '22023';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Rows must be a list' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 20000 then raise exception 'Import at most 20,000 rows at a time' using errcode = '54000'; end if;

  if p_kind in ('open_receivables','open_payables','opening_balances') then
    select status into v_period from public.fiscal_periods where company_id = p_company and p_cutover between start_date and end_date;
    if v_period is null then
      raise exception 'No fiscal period covers the cut-over date %. Add the financial year under Finance setup first.', p_cutover using errcode = '23514';
    elsif v_period <> 'open' then
      raise exception 'The fiscal period for the cut-over date % is %', p_cutover, v_period using errcode = '23514';
    end if;
    v_open := app.acct(p_company, 'opening_balance');
  end if;
  if p_kind = 'opening_balances' and not p_dry_run and exists (
       select 1 from public.migration_runs mr join public.journal_entries e on e.id = mr.journal_entry_id
        where mr.company_id = p_company and mr.kind = 'opening_balances' and e.status = 'posted') then
    raise exception 'Opening balances are already imported. Reverse that journal entry first to import them again.' using errcode = '23505';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; v_err := null; v_field := null;
    begin
      -- ------------------------------------------------ open invoices / bills
      if p_kind in ('open_receivables','open_payables') then
        v_field := 'partner';
        if nullif(btrim(r ->> 'partner'), '') is null then v_err := 'Required'; end if;
        if v_err is null then
          v_partner := app.mig_partner(p_company, r ->> 'partner', case when p_kind = 'open_receivables' then 'customer' else 'vendor' end);
          if v_partner is null then
            v_err := case when p_kind = 'open_receivables' then 'No customer with this code, NUI/NIPT or name. Import customers first.'
                          else 'No vendor with this code, NUI/NIPT or name. Import vendors first.' end;
          end if;
        end if;
        if v_err is null then
          v_field := 'number'; v_number := nullif(btrim(r ->> 'number'), '');
          if v_number is null then v_err := 'Required'; end if;
        end if;
        if v_err is null then
          v_field := 'amount'; v_amount := app.mig_num(r ->> 'amount');
          if v_amount is null then v_err := 'Required';
          elsif v_amount = 'NaN'::numeric then v_err := 'Not a number';
          elsif v_amount = 0 then v_err := 'The amount is zero; leave paid documents out'; end if;
        end if;
        if v_err is null then
          v_field := 'date';
          begin v_date := coalesce(nullif(btrim(r ->> 'date'), '')::date, p_cutover);
          exception when others then v_err := 'Not a date'; end;
        end if;
        if v_err is null then
          v_field := 'due_date';
          begin v_due := coalesce(nullif(btrim(r ->> 'due_date'), '')::date, v_date);
          exception when others then v_err := 'Not a date'; end;
          if v_err is null and v_due < v_date then v_due := v_date; end if;
          if v_err is null and v_date > p_cutover then v_field := 'date'; v_err := 'The document is dated after the cut-over date'; end if;
        end if;
        if v_err is null then
          v_field := 'currency'; v_cur := upper(coalesce(nullif(btrim(r ->> 'currency'), ''), c.base_currency));
          if not exists (select 1 from public.currencies where code = v_cur) then v_err := 'Unknown currency';
          else
            v_rate := case when v_cur = c.base_currency then 1 else app.mig_num(r ->> 'rate') end;
            if v_rate is null or v_rate = 'NaN'::numeric or v_rate <= 0 then v_field := 'rate'; v_err := 'Give the exchange rate for foreign-currency documents'; end if;
          end if;
        end if;
        if v_err is null then
          v_field := 'number';
          if p_kind = 'open_receivables' and exists (select 1 from public.sales_invoices where company_id = p_company and partner_id = v_partner
                                                       and is_opening and number = v_number and deleted_at is null)
             or p_kind = 'open_payables' and exists (select 1 from public.vendor_bills where company_id = p_company and vendor_id = v_partner
                                                       and lower(vendor_invoice_number) = lower(v_number) and deleted_at is null) then
            v_err := 'Already imported';
          end if;
        end if;
        if v_err is null and not p_dry_run then
          if p_kind = 'open_receivables' then
            insert into public.sales_invoices (company_id, number, document_type, partner_id, source, invoice_date, due_date, currency_code,
                                               exchange_rate, is_opening, notes)
            values (p_company,
                    case when exists (select 1 from public.sales_invoices where company_id = p_company and number = v_number and deleted_at is null) then null else v_number end,
                    case when v_amount < 0 then 'credit_note' else 'sales_invoice' end, v_partner, 'manual', v_date, v_due, v_cur, v_rate, true,
                    'Opening balance from the previous program · ' || v_number)
            returning id into v_doc;
            insert into public.sales_invoice_lines (company_id, invoice_id, line_no, description, account_id, quantity, unit_price)
            values (p_company, v_doc, 1, 'Open balance on ' || to_char(p_cutover, 'DD.MM.YYYY') || ' · ' || v_number, v_open, 1, abs(v_amount));
            update public.sales_invoices set status = 'posted', posted_at = now() where id = v_doc;
            select coalesce(receivable_account_id, app.acct(p_company, 'receivable')) into v_acct from public.business_partners where id = v_partner;
            v_lines := v_lines || jsonb_build_object('account_id', v_acct, 'amount', round(v_amount * v_rate, 2), 'partner_id', v_partner,
                                                     'currency_code', v_cur, 'amount_currency', v_amount, 'description', v_number);
          else
            insert into public.vendor_bills (company_id, document_type, vendor_id, vendor_invoice_number, bill_date, due_date, currency_code,
                                             exchange_rate, match_status, is_opening, notes)
            values (p_company, case when v_amount < 0 then 'vendor_credit' else 'vendor_bill' end, v_partner, v_number, v_date, v_due, v_cur, v_rate,
                    'not_applicable', true, 'Opening balance from the previous program · ' || v_number)
            returning id into v_doc;
            insert into public.vendor_bill_lines (company_id, bill_id, line_no, description, account_id, quantity, unit_price, match_status)
            values (p_company, v_doc, 1, 'Open balance on ' || to_char(p_cutover, 'DD.MM.YYYY') || ' · ' || v_number, v_open, 1, abs(v_amount), 'not_applicable');
            update public.vendor_bills set status = 'posted', posted_at = now() where id = v_doc;
            select coalesce(payable_account_id, app.acct(p_company, 'payable')) into v_acct from public.business_partners where id = v_partner;
            v_lines := v_lines || jsonb_build_object('account_id', v_acct, 'amount', -round(v_amount * v_rate, 2), 'partner_id', v_partner,
                                                     'currency_code', v_cur, 'amount_currency', -v_amount, 'description', v_number);
          end if;
          v_docs := v_docs || v_doc;
          v_created := v_created + 1;
        end if;
        if v_err is null then v_total := v_total + round(v_amount * coalesce(v_rate, 1), 2); end if;

      -- ------------------------------------------------ trial balance
      elsif p_kind = 'opening_balances' then
        v_field := 'account';
        select * into a from public.accounts where company_id = p_company and code = btrim(coalesce(r ->> 'account', '')) and deleted_at is null;
        if nullif(btrim(r ->> 'account'), '') is null then v_err := 'Required';
        elsif a.id is null then v_err := 'No account with this code in the chart of accounts. Add it under Finance or change the code.';
        elsif not a.is_postable then v_err := 'This is a group account; use one of the accounts under it';
        elsif not a.is_active then v_err := 'This account is switched off';
        elsif a.id = v_open then v_err := 'Leave out the opening balance account; it takes the difference by itself';
        elsif a.account_subtype in ('receivable','payable') then
          v_err := 'Customer and vendor balances come from the open invoices and bills imports, not from here';
        elsif a.account_subtype = 'inventory' then v_err := 'Stock value comes from the opening stock import, not from here';
        end if;
        if v_err is null then
          v_dr := coalesce(app.mig_num(r ->> 'debit'), 0); v_cr := coalesce(app.mig_num(r ->> 'credit'), 0);
          if nullif(btrim(r ->> 'balance'), '') is not null then
            v_amount := app.mig_num(r ->> 'balance');
            if v_amount = 'NaN'::numeric then v_field := 'balance'; v_err := 'Not a number';
            else v_dr := greatest(v_amount, 0); v_cr := greatest(-v_amount, 0); end if;
          elsif v_dr = 'NaN'::numeric then v_field := 'debit'; v_err := 'Not a number';
          elsif v_cr = 'NaN'::numeric then v_field := 'credit'; v_err := 'Not a number';
          end if;
        end if;
        if v_err is null and v_dr - v_cr <> 0 then
          v_lines := v_lines || jsonb_build_object('account_id', a.id, 'amount', round(v_dr - v_cr, 2), 'description', 'Opening balance');
          v_total := v_total + round(v_dr - v_cr, 2);
          v_created := v_created + 1;
        end if;

      -- ------------------------------------------------ price lists
      elsif p_kind = 'price_lists' then
        v_field := 'sku';
        select v.id into v_variant from public.product_variants v where v.company_id = p_company and upper(v.sku) = upper(btrim(coalesce(r ->> 'sku', ''))) and v.deleted_at is null;
        if nullif(btrim(r ->> 'sku'), '') is null then v_err := 'Required';
        elsif v_variant is null then v_err := 'No product with this code. Import products first.'; end if;
        if v_err is null then
          v_field := 'price'; v_amount := app.mig_num(r ->> 'price');
          if v_amount is null then v_err := 'Required'; elsif v_amount = 'NaN'::numeric or v_amount < 0 then v_err := 'Not a number'; end if;
        end if;
        if v_err is null then
          v_field := 'min_quantity'; v_minq := coalesce(app.mig_num(r ->> 'min_quantity'), 1);
          if v_minq = 'NaN'::numeric or v_minq <= 0 then v_err := 'Not a number'; end if;
        end if;
        if v_err is null then
          v_field := 'price_list';
          if nullif(btrim(r ->> 'price_list'), '') is null then v_err := 'Required'; end if;
          v_cur := upper(coalesce(nullif(btrim(r ->> 'currency'), ''), c.base_currency));
          if v_err is null and not exists (select 1 from public.currencies where code = v_cur) then v_field := 'currency'; v_err := 'Unknown currency'; end if;
        end if;
        if v_err is null and not p_dry_run then
          select id into v_list from public.price_lists where company_id = p_company and lower(name) = lower(btrim(r ->> 'price_list')) and deleted_at is null;
          if v_list is null then
            insert into public.price_lists (company_id, name, list_type, currency_code) values (p_company, btrim(r ->> 'price_list'), 'sales', v_cur)
            returning id into v_list;
          end if;
          update public.price_list_items set price = v_amount
           where price_list_id = v_list and variant_id = v_variant and min_quantity = v_minq and deleted_at is null;
          if found then v_updated := v_updated + 1;
          else
            insert into public.price_list_items (company_id, price_list_id, variant_id, min_quantity, price) values (p_company, v_list, v_variant, v_minq, v_amount);
            v_created := v_created + 1;
          end if;
        end if;
      end if;
    exception when others then
      v_err := sqlerrm;
    end;
    if v_err is not null then
      v_errors := v_errors || jsonb_build_object('row', i, 'field', v_field, 'message', v_err);
    else
      v_ok := v_ok + 1;
    end if;
  end loop;

  -- documents and balances go in all together or not at all
  if not p_dry_run and p_kind in ('open_receivables','open_payables','opening_balances') and jsonb_array_length(v_errors) > 0 then
    raise exception 'Fix the % rows with problems first; nothing was imported', jsonb_array_length(v_errors) using errcode = '23514';
  end if;

  if not p_dry_run and jsonb_array_length(v_lines) > 0 then
    v_lines := v_lines || jsonb_build_object('account_id', v_open,
                 'amount', -(select coalesce(sum((l ->> 'amount')::numeric), 0) from jsonb_array_elements(v_lines) l),
                 'description', 'Opening balance');
    v_je := app.gl_post(p_company, 'GEN', p_cutover, 'migration', null,
                        case p_kind when 'open_receivables' then 'OPEN-AR' when 'open_payables' then 'OPEN-AP' else 'OPEN-GL' end,
                        case p_kind when 'open_receivables' then 'Open customer invoices on ' when 'open_payables' then 'Open vendor bills on '
                                    else 'Opening balances on ' end || to_char(p_cutover, 'DD.MM.YYYY'),
                        v_lines);
    if p_kind = 'open_receivables' then update public.sales_invoices set journal_entry_id = v_je where id = any (v_docs);
    elsif p_kind = 'open_payables' then update public.vendor_bills set journal_entry_id = v_je where id = any (v_docs); end if;
  end if;

  if not p_dry_run then
    insert into public.migration_runs (company_id, kind, file_name, cutover_date, rows, created, updated, skipped, total, journal_entry_id)
    values (p_company, p_kind, p_file, case when p_kind <> 'price_lists' then p_cutover end, i, v_created, v_updated,
            jsonb_array_length(v_errors), case when p_kind <> 'price_lists' then v_total end, v_je);
  end if;

  return jsonb_build_object('rows', i, 'ok', v_ok, 'created', case when p_dry_run then v_ok else v_created end, 'updated', v_updated,
                            'errors', v_errors, 'total', v_total, 'journal_entry_id', v_je);
end $$;

-- -----------------------------------------------------------------------------
-- 4. Checklist and totals to compare with the old program
-- -----------------------------------------------------------------------------
create or replace function public.migration_check(p_company uuid, p_cutover date default current_date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_open uuid;
begin
  perform app.require_permission(p_company, 'admin.read');
  select account_id into v_open from public.company_account_defaults where company_id = p_company and key = 'opening_balance';
  return jsonb_build_object(
    'products', (select count(*) from public.product_variants where company_id = p_company and deleted_at is null),
    'customers', (select count(*) from public.business_partners where company_id = p_company and is_customer and deleted_at is null),
    'vendors', (select count(*) from public.business_partners where company_id = p_company and is_vendor and deleted_at is null),
    'employees', (select count(*) from public.employees where company_id = p_company and deleted_at is null),
    'price_list_items', (select count(*) from public.price_list_items where company_id = p_company and deleted_at is null),
    'stock_value', coalesce((select sum(value) from app.stock_as_of(p_company, p_cutover)), 0),
    'stock_lines', (select count(*) from app.stock_as_of(p_company, p_cutover) where qty <> 0),
    'receivables', coalesce((select sum(case when document_type = 'credit_note' then -1 else 1 end * round(amount_due * exchange_rate, 2))
                               from public.sales_invoices where company_id = p_company and is_opening and status = 'posted' and deleted_at is null), 0),
    'receivables_count', (select count(*) from public.sales_invoices where company_id = p_company and is_opening and status = 'posted' and deleted_at is null),
    'payables', coalesce((select sum(case when document_type = 'vendor_credit' then -1 else 1 end * round(amount_due * exchange_rate, 2))
                            from public.vendor_bills where company_id = p_company and is_opening and status = 'posted' and deleted_at is null), 0),
    'payables_count', (select count(*) from public.vendor_bills where company_id = p_company and is_opening and status = 'posted' and deleted_at is null),
    'opening_account_balance', coalesce((select sum(l.debit - l.credit) from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
                                          where l.company_id = p_company and l.account_id = v_open and e.status in ('posted','reversed')), 0),
    'classes', coalesce((select jsonb_agg(x order by x.class) from (
        select left(a.code, 1) as class, sum(l.debit) as debit, sum(l.credit) as credit
          from public.journal_lines l join public.journal_entries e on e.id = l.entry_id join public.accounts a on a.id = l.account_id
         where l.company_id = p_company and e.status in ('posted','reversed') and e.entry_date <= p_cutover
         group by 1) x), '[]'::jsonb),
    'runs', coalesce((select jsonb_agg(x order by x.run_at desc) from (
        select mr.id, mr.kind, mr.file_name, mr.cutover_date, mr.rows, mr.created, mr.updated, mr.skipped, mr.total, mr.journal_entry_id,
               mr.run_at, p.full_name as run_by
          from public.migration_runs mr left join public.profiles p on p.id = mr.run_by
         where mr.company_id = p_company order by mr.run_at desc limit 100) x), '[]'::jsonb));
end $$;

revoke execute on function app.mig_num(text), app.mig_partner(uuid, text, text) from public, anon;
revoke execute on function public.migration_import(uuid, text, jsonb, boolean, date, text), public.migration_check(uuid, date),
  public.save_import_template(uuid, text, text, text, jsonb, boolean), public.delete_import_template(uuid),
  public.log_migration_run(uuid, text, text, int, int, int, int) from public, anon;
grant execute on function public.migration_import(uuid, text, jsonb, boolean, date, text), public.migration_check(uuid, date),
  public.save_import_template(uuid, text, text, text, jsonb, boolean), public.delete_import_template(uuid),
  public.log_migration_run(uuid, text, text, int, int, int, int) to authenticated;
grant execute on function app.mig_num(text), app.mig_partner(uuid, text, text) to authenticated, service_role;
