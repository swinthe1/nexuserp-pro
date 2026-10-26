-- =============================================================================
-- Expenses from a photo
--   Someone photographs a fuel receipt, the electricity bill, a restaurant bill… DrisPRO reads the
--   seller, number, date, the VAT by rate and what it was for, then proposes the expense account.
--   It learns: what a person books for a seller is proposed for that seller next time (and the
--   accounts already used for that vendor in the books count too). One click books it as a posted
--   vendor bill, paid from the till or the bank when it was paid at once.
-- =============================================================================

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

alter table app.document_reads drop constraint if exists document_reads_kind_check;
alter table app.document_reads add constraint document_reads_kind_check check (kind in ('supplier_invoice', 'expense'));
alter table app.document_reads add column if not exists bill_id uuid;

-- sending a file: the kind of document comes along
drop function if exists public.doc_read_submit(uuid, text, text, text);
create or replace function public.doc_read_submit(p_company uuid, p_file text, p_mime text, p_name text default null, p_kind text default 'supplier_invoice')
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_bytes bytea; v_id uuid;
begin
  if p_kind = 'expense' then perform app.require_any_permission(p_company, array['finance.write', 'invoicing.write', 'procurement.write']);
  else perform app.require_any_permission(p_company, array['wms.write', 'inventory.write', 'procurement.write']); end if;
  perform app.ai_reads_check(p_company);
  v_bytes := decode(regexp_replace(coalesce(p_file, ''), '^data:[^,]*,', ''), 'base64');
  if length(v_bytes) < 200 then raise exception 'The file is empty' using errcode = '22023'; end if;
  if length(v_bytes) > 8 * 1024 * 1024 then raise exception 'The file is larger than 8 MB; take the photo again at a lower size' using errcode = '22023'; end if;
  insert into app.document_reads (company_id, kind, file_name, mime, content) values (p_company, coalesce(p_kind, 'supplier_invoice'), left(p_name, 200), p_mime, v_bytes) returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.doc_read_submit(uuid, text, text, text, text) from public, anon;
grant execute on function public.doc_read_submit(uuid, text, text, text, text) to authenticated;

-- a local server hands expenses to the cloud too
drop function if exists public.licence_read_submit(text, uuid, text, text, text);
create or replace function public.licence_read_submit(p_code text, p_server uuid, p_file text, p_mime text, p_name text default null, p_kind text default 'supplier_invoice')
returns uuid language plpgsql security definer set search_path = '' as $$
declare l public.licenses; v_id uuid; v_bytes bytea;
begin
  l := app.backup_licence(p_code, p_server);
  perform app.ai_reads_check(l.company_id);
  v_bytes := decode(p_file, 'base64');
  if length(v_bytes) > 8 * 1024 * 1024 then raise exception 'The file is larger than 8 MB; take the photo again at a lower size' using errcode = '22023'; end if;
  insert into app.document_reads (company_id, kind, file_name, mime, content, relay_licence)
  values (l.company_id, case when p_kind = 'expense' then 'expense' else 'supplier_invoice' end, left(p_name, 200), p_mime, v_bytes, l.code) returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.licence_read_submit(text, uuid, text, text, text, text) from public;
grant execute on function public.licence_read_submit(text, uuid, text, text, text, text) to anon, authenticated;

-- the worker learns which question to ask
do $$ begin
  perform app._patch_function('public.reader_claim',
    'return jsonb_build_object(''id'', d.id, ''mime'', d.mime,',
    'return jsonb_build_object(''id'', d.id, ''kind'', d.kind, ''mime'', d.mime,');
  -- the goods page lists supplier invoices only
  perform app._patch_function('public.doc_reads_list',
    'from app.document_reads d where d.company_id = p_company order by',
    'from app.document_reads d where d.company_id = p_company and d.kind = ''supplier_invoice'' order by');
end $$;

-- ---------------------------------------------------------------------------------------------
-- where an expense goes
-- ---------------------------------------------------------------------------------------------
create table if not exists app.expense_rules (
  company_id     uuid not null references public.companies(id) on delete cascade,
  key            text not null,           -- v:<vendor id> or n:<seller's name, simplified>
  account_id     uuid not null,
  category       text,
  cost_center_id uuid,
  uses           int not null default 1,
  updated_at     timestamptz not null default now(),
  primary key (company_id, key)
);
revoke all on app.expense_rules from public, anon, authenticated;

-- the account of a kind of expense (made in class 6 when the chart has none yet)
create or replace function app.expense_account(p_co uuid, p_category text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_code text; v_name text; v_id uuid; v_parent uuid;
begin
  select c, n into v_code, v_name from (values
    ('fuel', '624', 'Fuel'), ('utilities', '614', 'Utilities and telecom'), ('telecom', '614', 'Utilities and telecom'),
    ('rent', '612', 'Rent'), ('supplies', '602', 'Purchased materials and services'), ('repairs', '615', 'Repairs and maintenance'),
    ('meals', '625', 'Representation and meals'), ('transport', '622', 'Transport and freight'), ('bank_fees', '662', 'Bank charges'),
    ('advertising', '623', 'Advertising'), ('insurance', '616', 'Insurance'), ('professional', '627', 'Professional services'),
    ('other', '602', 'Purchased materials and services')) x(k, c, n)
   where k = coalesce(p_category, 'other');
  if v_code is null then v_code := '602'; v_name := 'Purchased materials and services'; end if;
  select id into v_id from public.accounts where company_id = p_co and code = v_code and deleted_at is null and is_postable;
  if v_id is not null then return v_id; end if;
  select id into v_parent from public.accounts where company_id = p_co and code = '6' and deleted_at is null;
  insert into public.accounts (company_id, code, name, account_type, account_subtype, parent_id, is_postable, cash_flow_category)
  values (p_co, v_code, v_name, 'expense', 'expense', v_parent, true, 'operating')
  on conflict do nothing returning id into v_id;
  return coalesce(v_id, (select id from public.accounts where company_id = p_co and code = v_code and deleted_at is null limit 1));
end $$;

-- the purchase VAT code of a rate
create or replace function app.purchase_tax(p_co uuid, p_rate numeric)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.tax_codes
   where company_id = p_co and deleted_at is null and is_active and scope in ('both', 'purchase') and not is_reverse_charge and tax_type = 'vat'
     and rate = coalesce(p_rate, 0)
   order by is_exempt, code limit 1
$$;

-- what was read, with the seller found and the account proposed
create or replace function app.expense_match(p_co uuid, p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_vendor uuid; v_vname text; v_tax text; r app.expense_rules; v_acc uuid; v_how text; v_cat text; v_lines jsonb := '[]'; l jsonb; v_rate numeric; v_net numeric; v_vat numeric;
begin
  v_tax := nullif(regexp_replace(coalesce(p ->> 'vendor_tax_number', ''), '[^0-9A-Za-z]', '', 'g'), '');
  if v_tax is not null then
    select id into v_vendor from public.business_partners where company_id = p_co and deleted_at is null and is_vendor
       and (regexp_replace(coalesce(tax_number, ''), '[^0-9A-Za-z]', '', 'g') = v_tax or regexp_replace(coalesce(vat_number, ''), '[^0-9A-Za-z]', '', 'g') = v_tax) limit 1;
  end if;
  if v_vendor is null and coalesce(p ->> 'vendor_name', '') <> '' then
    select id into v_vendor from public.business_partners where company_id = p_co and deleted_at is null and is_vendor
       and extensions.similarity(lower(name), lower(p ->> 'vendor_name')) >= 0.45
     order by extensions.similarity(lower(name), lower(p ->> 'vendor_name')) desc limit 1;
  end if;
  select name into v_vname from public.business_partners where id = v_vendor;
  v_cat := coalesce(nullif(p ->> 'category', ''), 'other');

  -- learned for this seller, then what the books say for this vendor, then the kind of expense
  select * into r from app.expense_rules where company_id = p_co
     and key in ('v:' || coalesce(v_vendor::text, '-'), 'n:' || app.read_key(p ->> 'vendor_name')) order by key desc limit 1;
  if r.account_id is not null then v_acc := r.account_id; v_how := 'learned'; v_cat := coalesce(r.category, v_cat); end if;
  if v_acc is null and v_vendor is not null then
    select bl.account_id into v_acc from public.vendor_bill_lines bl join public.vendor_bills b on b.id = bl.bill_id
     where b.company_id = p_co and b.vendor_id = v_vendor and b.status = 'posted' and bl.account_id is not null and bl.variant_id is null
     group by bl.account_id order by count(*) desc limit 1;
    if v_acc is not null then v_how := 'history'; end if;
  end if;
  if v_acc is null then v_how := 'category'; end if;

  -- VAT by rate; a receipt with only a total is taken at the standard rate the seller printed
  for l in select * from jsonb_array_elements(coalesce(p -> 'vat', '[]')) loop
    v_rate := coalesce(nullif(l ->> 'rate', '')::numeric, 0);
    v_net := nullif(l ->> 'net', '')::numeric; v_vat := nullif(l ->> 'vat', '')::numeric;
    if v_net is null and nullif(l ->> 'gross', '') is not null then v_net := round((l ->> 'gross')::numeric / (1 + v_rate / 100), 2); end if;
    if v_net is null and v_vat is not null and v_rate > 0 then v_net := round(v_vat * 100 / v_rate, 2); end if;
    if v_net is null then continue; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('rate', v_rate, 'net', v_net, 'vat', coalesce(v_vat, round(v_net * v_rate / 100, 2)),
      'tax_code_id', app.purchase_tax(p_co, v_rate)));
  end loop;
  if jsonb_array_length(v_lines) = 0 and nullif(p ->> 'total', '') is not null then
    v_lines := jsonb_build_array(jsonb_build_object('rate', 0, 'net', (p ->> 'total')::numeric, 'vat', 0, 'tax_code_id', app.purchase_tax(p_co, 0)));
  end if;

  return p || jsonb_build_object('vendor_id', v_vendor, 'vendor_match_name', v_vname, 'category', v_cat,
    'account_id', v_acc, 'account_how', v_how, 'cost_center_id', r.cost_center_id, 'lines', v_lines,
    'already', (select jsonb_build_object('id', b.id, 'number', b.number) from public.vendor_bills b
                 where b.company_id = p_co and b.vendor_id = v_vendor and v_vendor is not null and b.deleted_at is null and b.status <> 'cancelled'
                   and nullif(btrim(p ->> 'number'), '') is not null and app.read_key(b.vendor_invoice_number) = app.read_key(p ->> 'number') limit 1));
end $$;

-- ---------------------------------------------------------------------------------------------
-- for the page
-- ---------------------------------------------------------------------------------------------
create or replace function public.expense_reads(p_company uuid)
returns table (id uuid, file_name text, status text, error text, vendor text, number text, date text, total numeric, category text, bill_id uuid, bill_number text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_any_permission(p_company, array['finance.read', 'invoicing.write', 'procurement.write']);
  return query select d.id, d.file_name, case when d.status = 'relayed' then 'reading' else d.status end, d.error, coalesce(bp.name, d.result ->> 'vendor_name'), d.result ->> 'number',
    d.result ->> 'date', nullif(d.result ->> 'total', '')::numeric, d.result ->> 'category', d.bill_id, b.number, d.created_at
    from app.document_reads d left join public.vendor_bills b on b.id = d.bill_id left join public.business_partners bp on bp.id = b.vendor_id
   where d.company_id = p_company and d.kind = 'expense' order by d.created_at desc limit 100;
end $$;

create or replace function public.expense_read_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d app.document_reads;
begin
  select * into d from app.document_reads where id = p_id and kind = 'expense';
  if d.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform app.require_any_permission(d.company_id, array['finance.read', 'invoicing.write', 'procurement.write']);
  return jsonb_build_object('id', d.id, 'status', case when d.status = 'relayed' then 'reading' else d.status end, 'error', d.error, 'file_name', d.file_name,
    'bill_id', d.bill_id, 'bill_number', (select number from public.vendor_bills where id = d.bill_id), 'created_at', d.created_at,
    'image', case when d.mime like 'image/%' and length(d.content) > 0 then 'data:' || d.mime || ';base64,' || encode(d.content, 'base64') end,
    'result', case when d.status = 'done' then app.expense_match(d.company_id, d.result) end);
end $$;

-- p: {vendor_id | vendor_name + vendor_tax_number, date, number, due_date, description, category, account_id, cost_center_id,
--     lines: [{net, tax_code_id}], pay: {bank_account_id, method} | null}
create or replace function public.expense_book(p_read uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d app.document_reads; v_co uuid; v_vendor uuid; v_bill uuid; l jsonb; n int := 0; v_date date; v_pay uuid; v_total numeric; v_cur text;
  v_acc uuid; v_desc text; v_number text; v_terms int;
begin
  if p_read is not null then
    select * into d from app.document_reads where id = p_read and kind = 'expense' for update;
    if d.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
    if d.bill_id is not null then raise exception 'This expense is already booked as %', (select number from public.vendor_bills where id = d.bill_id) using errcode = '23505'; end if;
    v_co := d.company_id;
  else
    v_co := (p ->> 'company_id')::uuid;
  end if;
  perform app.require_permission(v_co, 'invoicing.write');
  select base_currency into v_cur from public.companies where id = v_co;
  v_date := coalesce(nullif(p ->> 'date', '')::date, current_date);
  v_number := nullif(btrim(p ->> 'number'), '');
  v_acc := coalesce(nullif(p ->> 'account_id', '')::uuid, app.expense_account(v_co, p ->> 'category'));
  if not exists (select 1 from public.accounts where id = v_acc and company_id = v_co and is_postable and deleted_at is null) then
    raise exception 'Choose an expense account' using errcode = '23514';
  end if;

  -- the seller: found, or made now as a vendor
  v_vendor := nullif(p ->> 'vendor_id', '')::uuid;
  if v_vendor is null then
    if coalesce(btrim(p ->> 'vendor_name'), '') = '' then raise exception 'Who sold it? Give the seller''s name' using errcode = '23514'; end if;
    select id into v_vendor from public.business_partners where company_id = v_co and deleted_at is null and lower(name) = lower(btrim(p ->> 'vendor_name')) limit 1;
    if v_vendor is null then
      insert into public.business_partners (company_id, code, name, tax_number, is_vendor, is_customer)
      values (v_co, public.next_partner_code(v_co, 'vendor'), btrim(p ->> 'vendor_name'), nullif(regexp_replace(coalesce(p ->> 'vendor_tax_number', ''), '\s', '', 'g'), ''), true, false)
      returning id into v_vendor;
    else
      update public.business_partners set is_vendor = true where id = v_vendor and not is_vendor;
    end if;
  end if;
  if v_number is not null and exists (select 1 from public.vendor_bills where company_id = v_co and vendor_id = v_vendor and deleted_at is null and status <> 'cancelled'
                                        and app.read_key(vendor_invoice_number) = app.read_key(v_number)) then
    raise exception 'This expense is already booked: % from this seller', v_number using errcode = '23505';
  end if;
  select coalesce(pt.due_days, 0) into v_terms from public.business_partners bp left join public.payment_terms pt on pt.id = bp.payment_term_id where bp.id = v_vendor;
  if jsonb_typeof(p -> 'lines') <> 'array' or jsonb_array_length(p -> 'lines') = 0 then raise exception 'Give the amount' using errcode = '23514'; end if;

  insert into public.vendor_bills (company_id, vendor_id, vendor_invoice_number, bill_date, due_date, currency_code, notes)
  values (v_co, v_vendor, coalesce(v_number, 'SHP-' || to_char(v_date, 'YYYYMMDD') || '-' || left(replace(gen_random_uuid()::text, '-', ''), 4)), v_date,
          coalesce(nullif(p ->> 'due_date', '')::date, v_date + coalesce(v_terms, 0)), v_cur, nullif(btrim(p ->> 'description'), ''))
  returning id into v_bill;
  v_desc := coalesce(nullif(btrim(p ->> 'description'), ''), (select name from public.accounts where id = v_acc));
  for l in select * from jsonb_array_elements(p -> 'lines') loop
    if coalesce(nullif(l ->> 'net', '')::numeric, 0) = 0 then continue; end if;
    n := n + 1;
    insert into public.vendor_bill_lines (company_id, bill_id, line_no, description, account_id, cost_center_id, quantity, unit_price, tax_code_id)
    values (v_co, v_bill, n, left(v_desc, 300), v_acc, nullif(p ->> 'cost_center_id', '')::uuid, 1, round((l ->> 'net')::numeric, 2),
            coalesce(nullif(l ->> 'tax_code_id', '')::uuid, app.purchase_tax(v_co, 0)));
  end loop;
  if n = 0 then raise exception 'Give the amount' using errcode = '23514'; end if;
  perform public.post_vendor_bill(v_bill);

  -- paid at once: from the till or the bank
  if jsonb_typeof(p -> 'pay') = 'object' and nullif(p -> 'pay' ->> 'bank_account_id', '') is not null then
    select total into v_total from public.vendor_bills where id = v_bill;
    insert into public.payments (company_id, document_type, partner_id, method, amount, bank_account_id, payment_date, reference)
    values (v_co, 'vendor_payment', v_vendor, coalesce(nullif(p -> 'pay' ->> 'method', ''), 'cash'), v_total, (p -> 'pay' ->> 'bank_account_id')::uuid, v_date,
            (select vendor_invoice_number from public.vendor_bills where id = v_bill))
    returning id into v_pay;
    insert into public.payment_allocations (company_id, payment_id, vendor_bill_id, amount) values (v_co, v_pay, v_bill, v_total);
    perform public.post_payment(v_pay);
  end if;

  -- remember for next time
  insert into app.expense_rules as er (company_id, key, account_id, category, cost_center_id)
  select v_co, k, v_acc, nullif(p ->> 'category', ''), nullif(p ->> 'cost_center_id', '')::uuid
    from unnest(array['v:' || v_vendor::text] || case when coalesce(p ->> 'read_vendor_name', p ->> 'vendor_name', '') <> ''
                                                       then array['n:' || app.read_key(coalesce(p ->> 'read_vendor_name', p ->> 'vendor_name'))] else '{}'::text[] end) k
  on conflict (company_id, key) do update set account_id = excluded.account_id, category = coalesce(excluded.category, er.category),
    cost_center_id = excluded.cost_center_id, uses = er.uses + 1, updated_at = now();

  if d.id is not null then update app.document_reads set bill_id = v_bill where id = d.id; end if;
  return (select jsonb_build_object('bill_id', id, 'number', number, 'total', total, 'paid', v_pay is not null) from public.vendor_bills where id = v_bill);
end $$;

-- the till and bank accounts money can be paid from
create or replace function public.expense_pay_accounts(p_company uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', account_kind) order by account_kind desc, name), '[]'::jsonb)
    from public.bank_accounts where company_id = p_company and is_active and deleted_at is null and app.has_permission(p_company, 'invoicing.write')
$$;

revoke execute on function public.expense_reads(uuid), public.expense_read_get(uuid), public.expense_book(uuid, jsonb), public.expense_pay_accounts(uuid) from public, anon;
grant execute on function public.expense_reads(uuid), public.expense_read_get(uuid), public.expense_book(uuid, jsonb), public.expense_pay_accounts(uuid) to authenticated;

drop function app._patch_function(text, text, text);
