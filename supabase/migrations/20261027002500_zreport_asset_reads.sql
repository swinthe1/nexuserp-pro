-- =============================================================================
-- Two more documents DrisPRO reads from a photo (accountants work this way):
--   · the Z report of a client's own fiscal cash register: the day's sales by VAT rate and how they
--     were paid become a sales entry (in the sales book and the revenue), paid in cash and by card;
--   · the invoice of a fixed asset (a vehicle, a machine, computers): booked as an investment
--     (in the purchase book as investment) and the asset is made and depreciated from that day.
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
alter table app.document_reads add constraint document_reads_kind_check check (kind in ('supplier_invoice', 'expense', 'z_report', 'asset'));
alter table app.document_reads add column if not exists invoice_id uuid;
alter table app.document_reads add column if not exists asset_id uuid;

do $$ begin
  -- who may send them
  perform app._patch_function('public.doc_read_submit',
    'if p_kind = ''expense'' then perform app.require_any_permission(p_company, array[''finance.write'', ''invoicing.write'', ''procurement.write'']);',
    'if p_kind in (''expense'', ''z_report'', ''asset'') then perform app.require_any_permission(p_company, array[''finance.write'', ''invoicing.write'', ''procurement.write'']);');
  perform app._patch_function('public.licence_read_submit',
    'case when p_kind = ''expense'' then ''expense'' else ''supplier_invoice'' end',
    'case when p_kind in (''expense'', ''z_report'', ''asset'') then p_kind else ''supplier_invoice'' end');
  -- an asset invoice does not teach the expense account of its seller
  perform app._patch_function('public.expense_book',
    E'else ''{}''::text[] end) k\n  on conflict (company_id, key)',
    E'else ''{}''::text[] end) k\n   where not coalesce((p ->> ''no_learn'')::boolean, false)\n  on conflict (company_id, key)');
end $$;

-- ---------------------------------------------------------------------------------------------
-- the lists: expenses and asset invoices share one page shape
-- ---------------------------------------------------------------------------------------------
drop function if exists public.expense_reads(uuid);
create or replace function public.expense_reads(p_company uuid, p_kind text default 'expense')
returns table (id uuid, file_name text, status text, error text, vendor text, number text, date text, total numeric, category text, bill_id uuid, bill_number text,
               created_at timestamptz, asset_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_any_permission(p_company, array['finance.read', 'invoicing.write', 'procurement.write']);
  return query select d.id, d.file_name, case when d.status = 'relayed' then 'reading' else d.status end, d.error, coalesce(bp.name, d.result ->> 'vendor_name'),
    d.result ->> 'number', d.result ->> 'date', nullif(d.result ->> 'total', '')::numeric, coalesce(d.result ->> 'category', d.result ->> 'asset_name'), d.bill_id, b.number,
    d.created_at, d.asset_id
    from app.document_reads d left join public.vendor_bills b on b.id = d.bill_id left join public.business_partners bp on bp.id = b.vendor_id
   where d.company_id = p_company and d.kind = case when p_kind = 'asset' then 'asset' else 'expense' end order by d.created_at desc limit 100;
end $$;
revoke execute on function public.expense_reads(uuid, text) from public, anon;
grant execute on function public.expense_reads(uuid, text) to authenticated;

-- the category of an asset from the words on the invoice
create or replace function app.asset_category_guess(p_co uuid, p_type text)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.fixed_asset_categories c
   where c.company_id = p_co and c.deleted_at is null
   order by case
     when p_type = 'vehicle' and c.name ilike any (array['%vehic%', '%automj%', '%mjete transp%']) then 0
     when p_type = 'it' and c.name ilike any (array['%IT%', '%kompjut%', '%furniture%', '%mobil%']) then 0
     when p_type = 'furniture' and c.name ilike any (array['%furniture%', '%mobil%', '%inventar%']) then 0
     when p_type = 'machine' and c.name ilike any (array['%machin%', '%equipment%', '%makin%', '%pajisj%']) then 0
     when p_type = 'building' and c.name ilike any (array['%build%', '%ndërt%', '%objekt%']) then 0
     else 1 end, c.name
   limit 1
$$;

drop function if exists public.expense_read_get(uuid);
create or replace function public.expense_read_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d app.document_reads; v_res jsonb;
begin
  select * into d from app.document_reads where id = p_id and kind in ('expense', 'asset');
  if d.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform app.require_any_permission(d.company_id, array['finance.read', 'invoicing.write', 'procurement.write']);
  if d.status = 'done' then
    v_res := app.expense_match(d.company_id, d.result);
    if d.kind = 'asset' then
      v_res := v_res || jsonb_build_object('category_id', app.asset_category_guess(d.company_id, d.result ->> 'asset_type'));
    end if;
  end if;
  return jsonb_build_object('id', d.id, 'kind', d.kind, 'status', case when d.status = 'relayed' then 'reading' else d.status end, 'error', d.error, 'file_name', d.file_name,
    'bill_id', d.bill_id, 'bill_number', (select number from public.vendor_bills where id = d.bill_id), 'created_at', d.created_at,
    'asset_id', d.asset_id, 'asset_number', (select number from public.fixed_assets where id = d.asset_id),
    'image', case when d.mime like 'image/%' and length(d.content) > 0 then 'data:' || d.mime || ';base64,' || encode(d.content, 'base64') end,
    'result', v_res);
end $$;
revoke execute on function public.expense_read_get(uuid) from public, anon;
grant execute on function public.expense_read_get(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- a fixed asset from its invoice
--   p: what expense_book takes (seller, number, date, lines, pay) + name, category_id, useful_life_months, cost_center_id
-- ---------------------------------------------------------------------------------------------
create or replace function public.asset_book(p_read uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d app.document_reads; v_co uuid; c public.fixed_asset_categories; r jsonb; v_bill public.vendor_bills; v_asset uuid; v_cost numeric;
begin
  if p_read is not null then
    select * into d from app.document_reads where id = p_read and kind = 'asset' for update;
    if d.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
    if d.asset_id is not null then raise exception 'This invoice is already booked as %', (select number from public.fixed_assets where id = d.asset_id) using errcode = '23505'; end if;
    v_co := d.company_id;
  else
    v_co := (p ->> 'company_id')::uuid;
  end if;
  perform app.require_permission(v_co, 'finance.write');
  select * into c from public.fixed_asset_categories where id = nullif(p ->> 'category_id', '')::uuid and company_id = v_co and deleted_at is null;
  if c.id is null then raise exception 'Choose the kind of asset' using errcode = '23514'; end if;
  if coalesce(btrim(p ->> 'name'), '') = '' then raise exception 'Give the asset a name' using errcode = '23514'; end if;

  -- the invoice: on the asset account, so it is an investment in the purchase book
  r := public.expense_book(null, p || jsonb_build_object('company_id', v_co, 'account_id', c.asset_account_id, 'no_learn', true,
         'description', coalesce(nullif(btrim(p ->> 'description'), ''), btrim(p ->> 'name'))));
  select * into v_bill from public.vendor_bills where id = (r ->> 'bill_id')::uuid;
  -- the cost is what was put on the asset account (VAT that cannot be deducted included)
  select coalesce(sum(jl.debit - jl.credit), v_bill.subtotal) into v_cost from public.journal_lines jl
   where jl.entry_id = v_bill.journal_entry_id and jl.account_id = c.asset_account_id;

  insert into public.fixed_assets (company_id, name, category_id, acquisition_date, in_service_date, acquisition_cost, useful_life_months,
                                   depreciation_method, declining_rate_pct, cost_center_id, vendor_id, vendor_bill_id, serial_number)
  values (v_co, btrim(p ->> 'name'), c.id, v_bill.bill_date, coalesce(nullif(p ->> 'in_service_date', '')::date, v_bill.bill_date), v_cost,
          coalesce(nullif(p ->> 'useful_life_months', '')::int, c.useful_life_months), c.depreciation_method, c.declining_rate_pct,
          nullif(p ->> 'cost_center_id', '')::uuid, v_bill.vendor_id, v_bill.id, nullif(btrim(p ->> 'serial_number'), ''))
  returning id into v_asset;
  perform public.activate_fixed_asset(v_asset, null);   -- the invoice already put it on the books

  if d.id is not null then update app.document_reads set bill_id = v_bill.id, asset_id = v_asset where id = d.id; end if;
  return r || (select jsonb_build_object('asset_id', id, 'asset_number', number) from public.fixed_assets where id = v_asset);
end $$;
revoke execute on function public.asset_book(uuid, jsonb) from public, anon;
grant execute on function public.asset_book(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- the Z report of a fiscal cash register
-- ---------------------------------------------------------------------------------------------
-- the sales VAT code of a rate
create or replace function app.sales_tax(p_co uuid, p_rate numeric)
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.tax_codes
   where company_id = p_co and deleted_at is null and is_active and scope in ('both', 'sales') and not is_reverse_charge and tax_type = 'vat'
     and rate = coalesce(p_rate, 0)
   order by is_exempt, code limit 1
$$;

-- what was read, made ready for the page: lines by rate with their VAT codes, the device's last booking
create or replace function app.zreport_match(p_co uuid, p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_lines jsonb := '[]'; l jsonb; v_rate numeric; v_net numeric; v_vat numeric;
begin
  for l in select * from jsonb_array_elements(coalesce(p -> 'vat', '[]')) loop
    v_rate := coalesce(nullif(l ->> 'rate', '')::numeric, 0);
    v_net := nullif(l ->> 'net', '')::numeric; v_vat := nullif(l ->> 'vat', '')::numeric;
    if v_net is null and nullif(l ->> 'gross', '') is not null then v_net := round((l ->> 'gross')::numeric / (1 + v_rate / 100), 2); end if;
    if v_net is null and v_vat is not null and v_rate > 0 then v_net := round(v_vat * 100 / v_rate, 2); end if;
    if v_net is null or v_net = 0 then continue; end if;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('rate', v_rate, 'net', v_net, 'vat', coalesce(v_vat, round(v_net * v_rate / 100, 2)),
      'tax_code_id', app.sales_tax(p_co, v_rate)));
  end loop;
  return p || jsonb_build_object('lines', v_lines,
    'already', (select jsonb_build_object('id', i.id, 'number', i.number) from public.sales_invoices i
                 where i.company_id = p_co and i.deleted_at is null and i.status <> 'cancelled' and nullif(btrim(p ->> 'z_number'), '') is not null
                   and i.notes like 'Z-raporti ' || btrim(p ->> 'z_number') || ' ·%'
                   and coalesce(i.notes, '') like '%' || coalesce(nullif(btrim(p ->> 'device'), ''), '') || '%' limit 1));
end $$;

create or replace function public.zreport_reads(p_company uuid)
returns table (id uuid, file_name text, status text, error text, z_number text, device text, date text, total numeric, invoice_id uuid, invoice_number text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_any_permission(p_company, array['finance.read', 'invoicing.write']);
  return query select d.id, d.file_name, case when d.status = 'relayed' then 'reading' else d.status end, d.error, d.result ->> 'z_number', d.result ->> 'device',
    d.result ->> 'date', nullif(d.result ->> 'total', '')::numeric, d.invoice_id, i.number, d.created_at
    from app.document_reads d left join public.sales_invoices i on i.id = d.invoice_id
   where d.company_id = p_company and d.kind = 'z_report' order by d.created_at desc limit 100;
end $$;

create or replace function public.zreport_read_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d app.document_reads;
begin
  select * into d from app.document_reads where id = p_id and kind = 'z_report';
  if d.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform app.require_any_permission(d.company_id, array['finance.read', 'invoicing.write']);
  return jsonb_build_object('id', d.id, 'status', case when d.status = 'relayed' then 'reading' else d.status end, 'error', d.error, 'file_name', d.file_name,
    'invoice_id', d.invoice_id, 'invoice_number', (select number from public.sales_invoices where id = d.invoice_id), 'created_at', d.created_at,
    'image', case when d.mime like 'image/%' and length(d.content) > 0 then 'data:' || d.mime || ';base64,' || encode(d.content, 'base64') end,
    'result', case when d.status = 'done' then app.zreport_match(d.company_id, d.result) end);
end $$;

-- p: {company_id, date, z_number, device, lines: [{net, tax_code_id}], cash_account_id, cash, card_account_id, card}
-- One sales invoice to "Shitje me arkë fiskale", already fiscalized by the register (not sent again),
-- with the cash and the card amounts paid at once; what is left (on credit, vouchers) stays open.
create or replace function public.zreport_book(p_read uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d app.document_reads; v_co uuid; v_partner uuid; v_inv uuid; v_cur text; v_date date; l jsonb; n int := 0; v_total numeric; v_z text; v_dev text;
  v_cash numeric; v_card numeric; v_pay uuid; v_paid numeric := 0; v_note text;
begin
  if p_read is not null then
    select * into d from app.document_reads where id = p_read and kind = 'z_report' for update;
    if d.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
    if d.invoice_id is not null then raise exception 'This Z report is already booked as %', (select number from public.sales_invoices where id = d.invoice_id) using errcode = '23505'; end if;
    v_co := d.company_id;
  else
    v_co := (p ->> 'company_id')::uuid;
  end if;
  perform app.require_permission(v_co, 'invoicing.write');
  select base_currency into v_cur from public.companies where id = v_co;
  v_date := coalesce(nullif(p ->> 'date', '')::date, current_date);
  v_z := nullif(btrim(p ->> 'z_number'), ''); v_dev := nullif(btrim(p ->> 'device'), '');
  if v_z is null then raise exception 'Give the number of the Z report' using errcode = '23514'; end if;
  v_note := 'Z-raporti ' || v_z || ' · ' || coalesce('arka ' || v_dev || ' · ', '') || to_char(v_date, 'DD.MM.YYYY');
  if exists (select 1 from public.sales_invoices where company_id = v_co and deleted_at is null and status <> 'cancelled'
              and notes like 'Z-raporti ' || v_z || ' ·%' and coalesce(notes, '') like '%' || coalesce(v_dev, '') || '%') then
    raise exception 'Z report % is already booked', v_z using errcode = '23505';
  end if;
  if jsonb_typeof(p -> 'lines') <> 'array' or jsonb_array_length(p -> 'lines') = 0 then raise exception 'Give the amount' using errcode = '23514'; end if;

  -- the customer of the register's sales
  select id into v_partner from public.business_partners where company_id = v_co and deleted_at is null and name = 'Shitje me arkë fiskale' limit 1;
  if v_partner is null then
    insert into public.business_partners (company_id, code, name, is_customer, is_vendor)
    values (v_co, public.next_partner_code(v_co, 'customer'), 'Shitje me arkë fiskale', true, false) returning id into v_partner;
  end if;

  insert into public.sales_invoices (company_id, partner_id, source, invoice_date, due_date, currency_code, exchange_rate, notes)
  values (v_co, v_partner, 'manual', v_date, v_date, v_cur, 1, v_note) returning id into v_inv;
  for l in select * from jsonb_array_elements(p -> 'lines') loop
    if coalesce(nullif(l ->> 'net', '')::numeric, 0) = 0 then continue; end if;
    n := n + 1;
    insert into public.sales_invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price, tax_code_id)
    values (v_co, v_inv, n, 'Shitje me arkë fiskale · ' || v_note, 1, round((l ->> 'net')::numeric, 2),
            coalesce(nullif(l ->> 'tax_code_id', '')::uuid, app.sales_tax(v_co, 0)));
  end loop;
  if n = 0 then raise exception 'Give the amount' using errcode = '23514'; end if;
  perform public.post_sales_invoice(v_inv);
  -- fiscalized already by the register: it is not sent to the tax office again
  delete from public.fiscalization_records where source_doc_id = v_inv and status = 'pending';
  update public.sales_invoices set fiscal_status = 'not_required' where id = v_inv;
  select total into v_total from public.sales_invoices where id = v_inv;

  -- the money: cash into the till, card into the bank
  v_cash := coalesce(nullif(p ->> 'cash', '')::numeric, 0); v_card := coalesce(nullif(p ->> 'card', '')::numeric, 0);
  if v_cash + v_card > v_total + 0.05 then raise exception 'Cash and card (%) are more than the total of the report (%)', v_cash + v_card, v_total using errcode = '23514'; end if;
  if v_cash > 0 and nullif(p ->> 'cash_account_id', '') is not null then
    insert into public.payments (company_id, document_type, partner_id, method, amount, bank_account_id, payment_date, reference)
    values (v_co, 'customer_payment', v_partner, 'cash', least(v_cash, v_total), (p ->> 'cash_account_id')::uuid, v_date, 'Z ' || v_z) returning id into v_pay;
    insert into public.payment_allocations (company_id, payment_id, sales_invoice_id, amount) values (v_co, v_pay, v_inv, least(v_cash, v_total));
    perform public.post_payment(v_pay);
    v_paid := v_paid + least(v_cash, v_total);
  end if;
  if v_card > 0 and nullif(p ->> 'card_account_id', '') is not null and v_total - v_paid > 0 then
    insert into public.payments (company_id, document_type, partner_id, method, amount, bank_account_id, payment_date, reference)
    values (v_co, 'customer_payment', v_partner, 'card', least(v_card, v_total - v_paid), (p ->> 'card_account_id')::uuid, v_date, 'Z ' || v_z) returning id into v_pay;
    insert into public.payment_allocations (company_id, payment_id, sales_invoice_id, amount) values (v_co, v_pay, v_inv, least(v_card, v_total - v_paid));
    perform public.post_payment(v_pay);
    v_paid := v_paid + least(v_card, v_total - v_paid);
  end if;

  if d.id is not null then update app.document_reads set invoice_id = v_inv where id = d.id; end if;
  return (select jsonb_build_object('invoice_id', id, 'number', number, 'total', total, 'paid', v_paid) from public.sales_invoices where id = v_inv);
end $$;

revoke execute on function public.zreport_reads(uuid), public.zreport_read_get(uuid), public.zreport_book(uuid, jsonb) from public, anon;
grant execute on function public.zreport_reads(uuid), public.zreport_read_get(uuid), public.zreport_book(uuid, jsonb) to authenticated;
revoke all on function app.zreport_match(uuid, jsonb), app.sales_tax(uuid, numeric), app.asset_category_guess(uuid, text) from public;

drop function app._patch_function(text, text, text);
