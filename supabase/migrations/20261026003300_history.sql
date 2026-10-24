-- =============================================================================
-- NexusERP Pro · history from the old program (Logmicro)
--
-- An archive, kept apart from the live books: every past sale, till receipt,
-- purchase, return, transfer and stock count with its lines; payments and cash
-- book lines; monthly balances of every account. It feeds reports and the
-- history screens; it never touches stock, accounting or the tax authority.
-- Product details (all barcodes, vendor codes, reorder levels), employees and
-- attendance go into the normal tables, where they belong.
-- Sent by the agent with the connection key (sync_history), resumable and idempotent.
-- =============================================================================

-- the live link and the history look products, partners and stores up by code, case-insensitive
create index if not exists product_variants_sku_upper_idx on public.product_variants (company_id, upper(sku)) where deleted_at is null;
create index if not exists business_partners_code_upper_idx on public.business_partners (company_id, upper(code)) where deleted_at is null;
create index if not exists warehouses_code_upper_idx on public.warehouses (company_id, upper(code)) where deleted_at is null;

create table public.history_documents (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  ext_id        text not null,
  kind          text not null check (kind in ('sale', 'pos_sale', 'sale_return', 'purchase', 'purchase_return', 'transfer', 'count', 'other')),
  doc_type      text,
  number        text,
  doc_date      date not null,
  partner_code  text,
  partner_name  text,
  partner_id    uuid,
  warehouse_code text,
  warehouse_id  uuid,
  total         numeric(18,2) not null default 0,
  net           numeric(18,2),
  tax           numeric(18,2),
  discount      numeric(18,2),
  paid          numeric(18,2),
  cashier       text,
  fiscal_code   text,
  description   text,
  foreign key (company_id, partner_id) references public.business_partners(company_id, id),
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id),
  unique (company_id, ext_id)
);
select app.register_table('public.history_documents', 'invoicing', p_soft_delete => false, p_client_write => false, p_audit => false);
create index history_documents_date_idx on public.history_documents (company_id, doc_date desc);
create index history_documents_kind_idx on public.history_documents (company_id, kind, doc_date desc);
create index history_documents_partner_idx on public.history_documents (company_id, partner_id, doc_date desc) where partner_id is not null;
create index history_documents_number_idx on public.history_documents (company_id, number);

create table public.history_document_lines (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  document_id  uuid not null,
  line_no      int not null default 0,
  sku          text,
  name         text,
  variant_id   uuid,
  quantity     numeric(18,4) not null default 0,
  unit_price   numeric(18,4),
  discount_pct numeric(7,3),
  net          numeric(18,2),
  total        numeric(18,2),
  tax_rate     numeric(6,2),
  unit_cost    numeric(18,4),
  foreign key (company_id, document_id) references public.history_documents(company_id, id) on delete cascade,
  foreign key (company_id, variant_id) references public.product_variants(company_id, id)
);
select app.register_table('public.history_document_lines', 'invoicing', p_soft_delete => false, p_client_write => false, p_audit => false);
create index history_document_lines_doc_idx on public.history_document_lines (document_id);
create index history_document_lines_variant_idx on public.history_document_lines (company_id, variant_id) where variant_id is not null;

create table public.history_payments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  ext_id        text not null,
  kind          text not null check (kind in ('cash', 'bank', 'payment')),
  number        text,
  pay_date      date not null,
  partner_code  text,
  partner_name  text,
  partner_id    uuid,
  amount        numeric(18,2) not null,          -- + money in, − money out
  book          text,                            -- cash book / bank account
  document      text,                            -- the invoice or receipt it paid
  description   text,
  foreign key (company_id, partner_id) references public.business_partners(company_id, id),
  unique (company_id, ext_id)
);
select app.register_table('public.history_payments', 'invoicing', p_soft_delete => false, p_client_write => false, p_audit => false);
create index history_payments_date_idx on public.history_payments (company_id, pay_date desc);
create index history_payments_partner_idx on public.history_payments (company_id, partner_id, pay_date desc) where partner_id is not null;

create table public.history_account_balances (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  account_code text not null,
  account_name text,
  period       date not null,                    -- first day of the month
  debit        numeric(18,2) not null default 0,
  credit       numeric(18,2) not null default 0,
  unique (company_id, account_code, period)
);
select app.register_table('public.history_account_balances', 'finance', p_soft_delete => false, p_client_write => false, p_audit => false);

-- -----------------------------------------------------------------------------
-- the agent's door: one kind of data per call
-- -----------------------------------------------------------------------------
create or replace function app.sync_connection(p_key text)
returns public.sync_connections language plpgsql security definer set search_path = '' as $$
declare c public.sync_connections;
begin
  select * into c from public.sync_connections
   where key_hash = encode(extensions.digest(coalesce(p_key, ''), 'sha256'), 'hex') and is_active;
  if c.id is null then raise exception 'Unknown or switched-off connection key' using errcode = '28000'; end if;
  if not app.license_ok(c.company_id) then raise exception 'The licence for this company is not active' using errcode = '42501'; end if;
  update public.sync_connections set last_seen_at = now() where id = c.id;
  return c;
end $$;
revoke execute on function app.sync_connection(text) from public, anon, authenticated;

create or replace function public.sync_history(p_key text, p_kind text, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.sync_connections; v_co uuid; v_n int := 0; v_skip int := 0; r jsonb; v_var uuid; v_ven uuid; v_wh uuid; v_emp uuid; v_cur text; v_len int;
begin
  c := app.sync_connection(p_key);
  v_co := c.company_id;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Rows must be a list' using errcode = '22023'; end if;
  if jsonb_array_length(p_rows) > 3000 then raise exception 'Send at most 3,000 rows per push' using errcode = '54000'; end if;
  perform set_config('request.jwt.claim.sub', c.run_as::text, true);

  if p_kind = 'documents' then
    -- [{ext_id, kind, doc_type, number, date, partner, partner_name, warehouse, total, net, tax, discount, paid, cashier, fiscal, description,
    --   lines: [{line, sku, name, qty, price, discount, net, total, tax_rate, cost}]}]
    insert into public.history_documents as h (company_id, ext_id, kind, doc_type, number, doc_date, partner_code, partner_name, partner_id,
                                               warehouse_code, warehouse_id, total, net, tax, discount, paid, cashier, fiscal_code, description)
    select v_co, x.ext_id, case when x.kind in ('sale','pos_sale','sale_return','purchase','purchase_return','transfer','count') then x.kind else 'other' end,
           x.doc_type, x.number, x.date, x.partner, x.partner_name,
           (select bp.id from public.business_partners bp where bp.company_id = v_co and upper(bp.code) = upper(x.partner) and bp.deleted_at is null limit 1),
           x.warehouse, (select w.id from public.warehouses w where w.company_id = v_co and upper(w.code) = upper(x.warehouse) and w.deleted_at is null limit 1),
           coalesce(x.total, 0), x.net, x.tax, x.discount, x.paid, x.cashier, x.fiscal, x.description
      from jsonb_to_recordset(p_rows) as x(ext_id text, kind text, doc_type text, number text, date date, partner text, partner_name text, warehouse text,
                                            total numeric, net numeric, tax numeric, discount numeric, paid numeric, cashier text, fiscal text, description text)
     where x.ext_id is not null and x.date is not null
    on conflict (company_id, ext_id) do update set kind = excluded.kind, doc_type = excluded.doc_type, number = excluded.number, doc_date = excluded.doc_date,
      partner_code = excluded.partner_code, partner_name = excluded.partner_name, partner_id = excluded.partner_id, warehouse_code = excluded.warehouse_code,
      warehouse_id = excluded.warehouse_id, total = excluded.total, net = excluded.net, tax = excluded.tax, discount = excluded.discount, paid = excluded.paid,
      cashier = excluded.cashier, fiscal_code = excluded.fiscal_code, description = excluded.description;
    get diagnostics v_n = row_count;
    delete from public.history_document_lines l using public.history_documents h
     where l.document_id = h.id and h.company_id = v_co and h.ext_id in (select x ->> 'ext_id' from jsonb_array_elements(p_rows) x);
    insert into public.history_document_lines (company_id, document_id, line_no, sku, name, variant_id, quantity, unit_price, discount_pct, net, total, tax_rate, unit_cost)
    select v_co, h.id, coalesce(l.line, 0), l.sku, l.name,
           (select v.id from public.product_variants v where v.company_id = v_co and upper(v.sku) = upper(l.sku) and v.deleted_at is null limit 1),
           coalesce(l.qty, 0), l.price, l.discount, l.net, l.total, l.tax_rate, l.cost
      from jsonb_array_elements(p_rows) d
      join public.history_documents h on h.company_id = v_co and h.ext_id = d ->> 'ext_id'
      cross join lateral jsonb_to_recordset(coalesce(d -> 'lines', '[]'::jsonb)) as l(line int, sku text, name text, qty numeric, price numeric, discount numeric,
                                                                                       net numeric, total numeric, tax_rate numeric, cost numeric);

  elsif p_kind = 'payments' then
    insert into public.history_payments as h (company_id, ext_id, kind, number, pay_date, partner_code, partner_name, partner_id, amount, book, document, description)
    select v_co, x.ext_id, case when x.kind in ('cash','bank') then x.kind else 'payment' end, x.number, x.date, x.partner, x.partner_name,
           (select bp.id from public.business_partners bp where bp.company_id = v_co and upper(bp.code) = upper(x.partner) and bp.deleted_at is null limit 1),
           coalesce(x.amount, 0), x.book, x.document, x.description
      from jsonb_to_recordset(p_rows) as x(ext_id text, kind text, number text, date date, partner text, partner_name text, amount numeric, book text, document text, description text)
     where x.ext_id is not null and x.date is not null
    on conflict (company_id, ext_id) do update set kind = excluded.kind, number = excluded.number, pay_date = excluded.pay_date, partner_code = excluded.partner_code,
      partner_name = excluded.partner_name, partner_id = excluded.partner_id, amount = excluded.amount, book = excluded.book, document = excluded.document,
      description = excluded.description;
    get diagnostics v_n = row_count;

  elsif p_kind = 'balances' then
    insert into public.history_account_balances as h (company_id, account_code, account_name, period, debit, credit)
    select v_co, x.account, x.name, (x.period || '-01')::date, coalesce(x.debit, 0), coalesce(x.credit, 0)
      from jsonb_to_recordset(p_rows) as x(account text, name text, period text, debit numeric, credit numeric)
     where x.account is not null and x.period ~ '^\d{4}-\d{2}$'
    on conflict (company_id, account_code, period) do update set account_name = excluded.account_name, debit = excluded.debit, credit = excluded.credit;
    get diagnostics v_n = row_count;

  elsif p_kind = 'barcodes' then
    for r in select * from jsonb_array_elements(p_rows) loop
      v_var := (select v.id from public.product_variants v where v.company_id = v_co and upper(v.sku) = upper(btrim(r ->> 'sku')) and v.deleted_at is null limit 1);
      v_len := length(btrim(coalesce(r ->> 'barcode', '')));
      if v_var is null or btrim(coalesce(r ->> 'barcode', '')) !~ '^\d{8}$|^\d{12,13}$'
         or exists (select 1 from public.product_barcodes b where b.company_id = v_co and b.barcode = btrim(r ->> 'barcode') and b.deleted_at is null) then
        v_skip := v_skip + 1; continue;
      end if;
      begin
        insert into public.product_barcodes (company_id, variant_id, barcode, symbology, is_primary)
        values (v_co, v_var, btrim(r ->> 'barcode'), case v_len when 8 then 'ean8' when 12 then 'upca' else 'ean13' end,
                not exists (select 1 from public.product_barcodes b where b.variant_id = v_var and b.deleted_at is null));
        v_n := v_n + 1;
      exception when others then v_skip := v_skip + 1;   -- a wrong check digit
      end;
    end loop;

  elsif p_kind = 'vendor_products' then
    select base_currency into v_cur from public.companies where id = v_co;
    for r in select * from jsonb_array_elements(p_rows) loop
      v_var := (select v.id from public.product_variants v where v.company_id = v_co and upper(v.sku) = upper(btrim(r ->> 'sku')) and v.deleted_at is null limit 1);
      v_ven := (select bp.id from public.business_partners bp where bp.company_id = v_co and upper(bp.code) = upper(btrim(r ->> 'vendor')) and bp.deleted_at is null limit 1);
      if v_var is null or v_ven is null then v_skip := v_skip + 1; continue; end if;
      update public.vendor_products set vendor_sku = coalesce(nullif(btrim(r ->> 'vendor_sku'), ''), vendor_sku),
             vendor_product_name = coalesce(nullif(btrim(r ->> 'name'), ''), vendor_product_name)
       where company_id = v_co and vendor_id = v_ven and variant_id = v_var and deleted_at is null;
      if not found then
        insert into public.vendor_products (company_id, vendor_id, variant_id, vendor_sku, vendor_product_name, price, currency_code)
        values (v_co, v_ven, v_var, nullif(btrim(r ->> 'vendor_sku'), ''), nullif(btrim(r ->> 'name'), ''),
                greatest(coalesce(app.mig_num(r ->> 'price'), (select standard_cost from public.product_variants where id = v_var), 0), 0), v_cur);
      end if;
      v_n := v_n + 1;
    end loop;

  elsif p_kind = 'reorder' then
    for r in select * from jsonb_array_elements(p_rows) loop
      v_var := (select v.id from public.product_variants v where v.company_id = v_co and upper(v.sku) = upper(btrim(r ->> 'sku')) and v.deleted_at is null limit 1);
      v_wh := (select w.id from public.warehouses w where w.company_id = v_co and upper(w.code) = upper(btrim(r ->> 'warehouse')) and w.deleted_at is null limit 1);
      if v_var is null or v_wh is null or coalesce(app.mig_num(r ->> 'max'), 0) < coalesce(app.mig_num(r ->> 'min'), 0)
         or coalesce(app.mig_num(r ->> 'min'), 0) < 0 or (coalesce(app.mig_num(r ->> 'min'), 0) = 0 and coalesce(app.mig_num(r ->> 'max'), 0) = 0) then
        v_skip := v_skip + 1; continue;
      end if;
      update public.replenishment_rules set min_qty = app.mig_num(r ->> 'min'), max_qty = app.mig_num(r ->> 'max')
       where company_id = v_co and variant_id = v_var and warehouse_id = v_wh and deleted_at is null;
      if not found then
        insert into public.replenishment_rules (company_id, variant_id, warehouse_id, min_qty, max_qty)
        values (v_co, v_var, v_wh, app.mig_num(r ->> 'min'), app.mig_num(r ->> 'max'));
      end if;
      v_n := v_n + 1;
    end loop;

  elsif p_kind = 'employees' then
    for r in select * from jsonb_array_elements(p_rows) loop
      if nullif(btrim(r ->> 'code'), '') is null or nullif(btrim(r ->> 'last'), '') is null then v_skip := v_skip + 1; continue; end if;
      begin
        select id into v_emp from public.employees where company_id = v_co and number = btrim(r ->> 'code') and deleted_at is null;
        if v_emp is null then
          insert into public.employees (company_id, number, first_name, last_name, personal_number, date_of_birth, gender, hire_date, termination_date,
                                        employment_status, partner_id)
          values (v_co, btrim(r ->> 'code'), coalesce(nullif(btrim(r ->> 'first'), ''), '-'), btrim(r ->> 'last'),
                  case when not exists (select 1 from public.employees e where e.company_id = v_co and e.personal_number = nullif(btrim(r ->> 'personal'), '') and e.deleted_at is null)
                       then nullif(btrim(r ->> 'personal'), '') end,
                  nullif(r ->> 'birth', '')::date, case lower(r ->> 'gender') when 'm' then 'male' when 'f' then 'female' else null end,
                  coalesce(nullif(r ->> 'start', '')::date, current_date),
                  case when nullif(r ->> 'end', '')::date >= coalesce(nullif(r ->> 'start', '')::date, current_date) then nullif(r ->> 'end', '')::date end,
                  case when coalesce((r ->> 'active')::boolean, true) and nullif(r ->> 'end', '') is null then 'active' else 'terminated' end,
                  (select bp.id from public.business_partners bp where bp.company_id = v_co and upper(bp.code) = upper(r ->> 'partner') and bp.deleted_at is null limit 1));
        else
          update public.employees set first_name = coalesce(nullif(btrim(r ->> 'first'), ''), first_name), last_name = btrim(r ->> 'last'),
                 employment_status = case when coalesce((r ->> 'active')::boolean, true) and nullif(r ->> 'end', '') is null then 'active' else 'terminated' end
           where id = v_emp;
        end if;
        v_n := v_n + 1;
      exception when others then v_skip := v_skip + 1;
      end;
    end loop;

  elsif p_kind = 'attendance' then
    -- [{employee (code), date, in, out}]
    for r in select * from jsonb_array_elements(p_rows) loop
      select id into v_emp from public.employees where company_id = v_co and number = btrim(r ->> 'employee') and deleted_at is null;
      if v_emp is null or nullif(r ->> 'date', '') is null then v_skip := v_skip + 1; continue; end if;
      begin
        delete from public.attendance_records where employee_id = v_emp and work_date = (r ->> 'date')::date and source = 'import';
        insert into public.attendance_records (company_id, employee_id, work_date, check_in, check_out, source, notes)
        values (v_co, v_emp, (r ->> 'date')::date, nullif(r ->> 'in', '')::timestamptz,
                case when nullif(r ->> 'out', '')::timestamptz > nullif(r ->> 'in', '')::timestamptz then nullif(r ->> 'out', '')::timestamptz end, 'import', 'Logmicro');
        v_n := v_n + 1;
      exception when others then v_skip := v_skip + 1;
      end;
    end loop;
  else
    raise exception 'Unknown kind of history: %', p_kind using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true, 'saved', v_n, 'skipped', v_skip);
end $$;
revoke execute on function public.sync_history(text, text, jsonb) from public;
grant execute on function public.sync_history(text, text, jsonb) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- reading the history (screens and reports)
-- -----------------------------------------------------------------------------
-- p: {kind?: text[], from?, to?, partner_id?, warehouse_id?, q?, offset?, limit?, sort?: 'date'|'total', desc?}
create or replace function public.history_documents_page(p_company uuid, p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_lim int := least(greatest(coalesce((p ->> 'limit')::int, 50), 1), 500); v_off int := greatest(coalesce((p ->> 'offset')::int, 0), 0);
  v_q text := nullif(btrim(p ->> 'q'), '');
begin
  perform app.require_permission(p_company, 'invoicing.read');
  return (
    with f as (
      select h.* from public.history_documents h
       where h.company_id = p_company
         and (p -> 'kind' is null or jsonb_array_length(p -> 'kind') = 0 or h.kind in (select jsonb_array_elements_text(p -> 'kind')))
         and (nullif(p ->> 'from', '') is null or h.doc_date >= (p ->> 'from')::date)
         and (nullif(p ->> 'to', '') is null or h.doc_date <= (p ->> 'to')::date)
         and (nullif(p ->> 'partner_id', '') is null or h.partner_id = (p ->> 'partner_id')::uuid)
         and (nullif(p ->> 'warehouse_id', '') is null or h.warehouse_id = (p ->> 'warehouse_id')::uuid)
         and (v_q is null or h.number ilike v_q || '%' or h.partner_name ilike '%' || v_q || '%' or h.partner_code = v_q))
    select jsonb_build_object(
      'total_count', (select count(*) from f),
      'total_amount', (select coalesce(sum(total), 0) from f),
      'rows', coalesce((select jsonb_agg(to_jsonb(x) - 'company_id') from (
          select f.id, f.kind, f.doc_type, f.number, f.doc_date, f.partner_name, f.partner_code, f.partner_id, f.warehouse_code, f.total, f.tax, f.paid, f.cashier
            from f order by
              case when coalesce(p ->> 'sort', 'date') = 'total' and coalesce((p ->> 'desc')::boolean, true) then f.total end desc nulls last,
              case when coalesce(p ->> 'sort', 'date') = 'total' and not coalesce((p ->> 'desc')::boolean, true) then f.total end asc nulls last,
              case when coalesce((p ->> 'desc')::boolean, true) then f.doc_date end desc,
              case when not coalesce((p ->> 'desc')::boolean, true) then f.doc_date end asc,
              f.number desc
           limit v_lim offset v_off) x), '[]'::jsonb)));
end $$;

create or replace function public.history_document(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare h public.history_documents;
begin
  select * into h from public.history_documents where id = p_id;
  if h.id is null then raise exception 'Document not found' using errcode = 'P0002'; end if;
  perform app.require_permission(h.company_id, 'invoicing.read');
  return to_jsonb(h) || jsonb_build_object('lines', coalesce((select jsonb_agg(to_jsonb(l) - 'company_id' order by l.line_no) from public.history_document_lines l where l.document_id = h.id), '[]'::jsonb));
end $$;

create or replace function public.history_payments_page(p_company uuid, p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_lim int := least(greatest(coalesce((p ->> 'limit')::int, 50), 1), 500); v_off int := greatest(coalesce((p ->> 'offset')::int, 0), 0);
  v_q text := nullif(btrim(p ->> 'q'), '');
begin
  perform app.require_permission(p_company, 'invoicing.read');
  return (
    with f as (
      select h.* from public.history_payments h
       where h.company_id = p_company
         and (p -> 'kind' is null or jsonb_array_length(p -> 'kind') = 0 or h.kind in (select jsonb_array_elements_text(p -> 'kind')))
         and (nullif(p ->> 'from', '') is null or h.pay_date >= (p ->> 'from')::date)
         and (nullif(p ->> 'to', '') is null or h.pay_date <= (p ->> 'to')::date)
         and (nullif(p ->> 'partner_id', '') is null or h.partner_id = (p ->> 'partner_id')::uuid)
         and (v_q is null or h.number ilike v_q || '%' or h.partner_name ilike '%' || v_q || '%' or h.document ilike v_q || '%' or h.description ilike '%' || v_q || '%'))
    select jsonb_build_object(
      'total_count', (select count(*) from f),
      'money_in', (select coalesce(sum(amount) filter (where amount > 0), 0) from f),
      'money_out', (select coalesce(-sum(amount) filter (where amount < 0), 0) from f),
      'rows', coalesce((select jsonb_agg(to_jsonb(x)) from (
          select f.id, f.kind, f.number, f.pay_date, f.partner_name, f.partner_code, f.amount, f.book, f.document, f.description
            from f order by f.pay_date desc, f.number desc limit v_lim offset v_off) x), '[]'::jsonb)));
end $$;

-- sales and purchases per month and store, for the charts
create or replace function public.history_summary(p_company uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'invoicing.read');
  return jsonb_build_object(
    'documents', (select count(*) from public.history_documents where company_id = p_company),
    'first_date', (select min(doc_date) from public.history_documents where company_id = p_company),
    'last_date', (select max(doc_date) from public.history_documents where company_id = p_company),
    'payments', (select count(*) from public.history_payments where company_id = p_company),
    'accounts_months', (select count(*) from public.history_account_balances where company_id = p_company),
    'by_month', coalesce((select jsonb_agg(x order by x.month) from (
        select to_char(date_trunc('month', doc_date), 'YYYY-MM') as month,
               sum(total) filter (where kind in ('sale', 'pos_sale')) - coalesce(sum(abs(total)) filter (where kind = 'sale_return'), 0) as sales,
               sum(total) filter (where kind = 'purchase') - coalesce(sum(abs(total)) filter (where kind = 'purchase_return'), 0) as purchases,
               count(*) filter (where kind in ('sale', 'pos_sale')) as receipts
          from public.history_documents where company_id = p_company and doc_date between p_from and p_to
         group by 1) x), '[]'::jsonb),
    'by_store', coalesce((select jsonb_agg(x order by x.sales desc nulls last) from (
        select coalesce(w.name, h.warehouse_code, '—') as store,
               sum(h.total) filter (where h.kind in ('sale', 'pos_sale')) as sales, count(*) filter (where h.kind in ('sale', 'pos_sale')) as receipts
          from public.history_documents h left join public.warehouses w on w.id = h.warehouse_id
         where h.company_id = p_company and h.doc_date between p_from and p_to group by 1) x), '[]'::jsonb),
    'top_products', coalesce((select jsonb_agg(x order by x.amount desc) from (
        select coalesce(l.name, l.sku) as name, l.sku, sum(l.quantity) as quantity, sum(l.total) as amount
          from public.history_document_lines l join public.history_documents h on h.id = l.document_id
         where h.company_id = p_company and h.kind in ('sale', 'pos_sale') and h.doc_date between p_from and p_to
         group by 1, 2 order by sum(l.total) desc nulls last limit 15) x), '[]'::jsonb));
end $$;

-- accounts × months for a year
create or replace function public.history_balances(p_company uuid, p_year int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'finance.read');
  return jsonb_build_object(
    'years', coalesce((select jsonb_agg(distinct extract(year from period)::int order by extract(year from period)::int) from public.history_account_balances where company_id = p_company), '[]'::jsonb),
    'accounts', coalesce((select jsonb_agg(x order by x.code) from (
        select b.account_code as code, max(b.account_name) as name,
               (select a.account_type from public.accounts a where a.company_id = p_company and a.code = b.account_code and a.deleted_at is null limit 1) as type,
               jsonb_object_agg(to_char(b.period, 'MM'), jsonb_build_array(b.debit, b.credit)) as months,
               sum(b.debit) as debit, sum(b.credit) as credit,
               (select coalesce(sum(o.debit - o.credit), 0) from public.history_account_balances o
                 where o.company_id = p_company and o.account_code = b.account_code and o.period < make_date(p_year, 1, 1)) as opening
          from public.history_account_balances b
         where b.company_id = p_company and extract(year from b.period) = p_year
         group by b.account_code) x), '[]'::jsonb));
end $$;

revoke execute on function public.history_documents_page(uuid, jsonb), public.history_document(uuid), public.history_payments_page(uuid, jsonb),
  public.history_summary(uuid, date, date), public.history_balances(uuid, int) from public, anon;
grant execute on function public.history_documents_page(uuid, jsonb), public.history_document(uuid), public.history_payments_page(uuid, jsonb),
  public.history_summary(uuid, date, date), public.history_balances(uuid, int) to authenticated;
