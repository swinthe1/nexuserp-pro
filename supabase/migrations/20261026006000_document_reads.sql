-- =============================================================================
-- DrisPRO · the supplier's invoice read from a photo or a PDF
--   Someone photographs the invoice (or picks the PDF). The cloud's postier sends it to the AI
--   with the DrisPRO key and gets back the vendor, number, date and lines. DrisPRO then finds
--   the vendor (by its NUI/NIPT, then by name) and each item (the vendor's own code, a barcode,
--   our code, then the name). The person checks the lines, picks what was not found, and a draft
--   goods receipt is made; posting it stays with them. What they pick is remembered as the
--   vendor's code for that item, so the next invoice from them is found by itself.
--   A local server hands the file to the cloud with its licence and fetches the answer.
--   Each licence can read up to 500 invoices a month (counted for the price of the plan).
-- =============================================================================

create table app.document_reads (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  kind         text not null default 'supplier_invoice' check (kind in ('supplier_invoice')),
  file_name    text,
  mime         text not null check (mime in ('image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf')),
  content      bytea not null,
  status       text not null default 'queued' check (status in ('queued', 'reading', 'done', 'failed', 'relayed')),
  attempts     int not null default 0,
  result       jsonb,
  error        text,
  relay_licence text,
  relay_id     uuid,
  receipt_id   uuid,
  input_tokens int,
  output_tokens int,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  done_at      timestamptz
);
revoke all on app.document_reads from public, anon, authenticated;
create index document_reads_company_idx on app.document_reads (company_id, created_at desc);
create index document_reads_due_idx on app.document_reads (created_at) where status in ('queued', 'reading');

-- any one of these permissions (the server itself may always)
create or replace function app.require_any_permission(p_company uuid, p_perms text[])
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null and current_user not in ('authenticated', 'anon') then return; end if;
  if not exists (select 1 from unnest(p_perms) x where app.has_permission(p_company, x)) then
    raise exception 'Permission denied: % required', array_to_string(p_perms, ' or ') using errcode = '42501';
  end if;
end $$;

-- ---------------------------------------------------------------- send a file
create or replace function public.doc_read_submit(p_company uuid, p_file text, p_mime text, p_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_bytes bytea; v_id uuid;
begin
  perform app.require_any_permission(p_company, array['wms.write', 'inventory.write', 'procurement.write']);
  v_bytes := decode(regexp_replace(coalesce(p_file, ''), '^data:[^,]*,', ''), 'base64');
  if length(v_bytes) < 200 then raise exception 'The file is empty' using errcode = '22023'; end if;
  if length(v_bytes) > 8 * 1024 * 1024 then raise exception 'The file is larger than 8 MB; take the photo again at a lower size' using errcode = '22023'; end if;
  insert into app.document_reads (company_id, file_name, mime, content) values (p_company, left(p_name, 200), p_mime, v_bytes) returning id into v_id;
  return v_id;
end $$;
grant execute on function public.doc_read_submit(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------- finding the vendor and the items
-- what a person matched once: the vendor's code or text on the invoice → our item
create table app.read_aliases (
  company_id uuid not null references public.companies(id) on delete cascade,
  vendor_id  uuid not null,
  key        text not null,
  variant_id uuid not null,
  updated_at timestamptz not null default now(),
  primary key (company_id, vendor_id, key)
);
revoke all on app.read_aliases from public, anon, authenticated;
create or replace function app.read_key(p text)
returns text language sql immutable set search_path = '' as $$ select lower(regexp_replace(coalesce(p, ''), '[^[:alnum:]]+', '', 'g')) $$;

create or replace function app.doc_read_match(p_company uuid, p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_vendor uuid; v_name text; l jsonb; v_lines jsonb := '[]'::jsonb; v_var uuid; v_how text; v_code text; v_bar text; v_tax text;
begin
  v_tax := nullif(regexp_replace(coalesce(p ->> 'vendor_tax_number', ''), '[^0-9A-Za-z]', '', 'g'), '');
  if v_tax is not null then
    select id into v_vendor from public.business_partners
     where company_id = p_company and deleted_at is null and is_vendor
       and (regexp_replace(coalesce(tax_number, ''), '[^0-9A-Za-z]', '', 'g') = v_tax or regexp_replace(coalesce(vat_number, ''), '[^0-9A-Za-z]', '', 'g') = v_tax) limit 1;
  end if;
  if v_vendor is null and coalesce(p ->> 'vendor_name', '') <> '' then
    select id into v_vendor from public.business_partners
     where company_id = p_company and deleted_at is null and is_vendor and extensions.similarity(lower(name), lower(p ->> 'vendor_name')) >= 0.45
     order by extensions.similarity(lower(name), lower(p ->> 'vendor_name')) desc limit 1;
  end if;
  select name into v_name from public.business_partners where id = v_vendor;

  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]'::jsonb)) loop
    v_var := null; v_how := null;
    v_code := nullif(btrim(l ->> 'code'), ''); v_bar := nullif(regexp_replace(coalesce(l ->> 'barcode', ''), '\D', '', 'g'), '');
    if v_vendor is not null then
      select a.variant_id into v_var from app.read_aliases a where a.company_id = p_company and a.vendor_id = v_vendor
         and a.key in ('c:' || app.read_key(v_code), 'n:' || app.read_key(l ->> 'name')) order by a.key limit 1;
      if v_var is not null then v_how := 'learned'; end if;
    end if;
    if v_var is null and v_vendor is not null and v_code is not null then
      select vp.variant_id into v_var from public.vendor_products vp where vp.company_id = p_company and vp.vendor_id = v_vendor and vp.deleted_at is null
         and upper(vp.vendor_sku) = upper(v_code) limit 1;
      if v_var is not null then v_how := 'vendor_code'; end if;
    end if;
    if v_var is null and coalesce(v_bar, v_code) ~ '^\d{8,14}$' then
      select b.variant_id into v_var from public.product_barcodes b where b.company_id = p_company and b.deleted_at is null and b.barcode = coalesce(v_bar, v_code) limit 1;
      if v_var is not null then v_how := 'barcode'; end if;
    end if;
    if v_var is null and v_code is not null then
      select v.id into v_var from public.product_variants v where v.company_id = p_company and v.deleted_at is null and upper(v.sku) = upper(v_code) limit 1;
      if v_var is not null then v_how := 'code'; end if;
    end if;
    if v_var is null and coalesce(l ->> 'name', '') <> '' then
      select v.id into v_var from public.product_variants v
       where v.company_id = p_company and v.deleted_at is null and v.is_active and extensions.similarity(lower(v.name), lower(l ->> 'name')) >= 0.5
       order by extensions.similarity(lower(v.name), lower(l ->> 'name')) desc limit 1;
      if v_var is not null then v_how := 'name'; end if;
    end if;
    v_lines := v_lines || jsonb_build_array(l || jsonb_build_object('variant_id', v_var, 'matched_by', v_how,
      'variant_name', (select name from public.product_variants where id = v_var), 'variant_sku', (select sku from public.product_variants where id = v_var)));
  end loop;
  return p || jsonb_build_object('vendor_id', v_vendor, 'vendor_match_name', v_name, 'lines', v_lines);
end $$;
revoke execute on function app.doc_read_match(uuid, jsonb) from public, anon, authenticated;

create or replace function public.doc_read_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d app.document_reads;
begin
  select * into d from app.document_reads where id = p_id;
  if d.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform app.require_permission(d.company_id, 'core.read');
  return jsonb_build_object('id', d.id, 'status', case when d.status = 'relayed' then 'reading' else d.status end, 'error', d.error, 'file_name', d.file_name,
    'receipt_id', d.receipt_id, 'created_at', d.created_at,
    'result', case when d.status = 'done' then app.doc_read_match(d.company_id, d.result) end);
end $$;
grant execute on function public.doc_read_get(uuid) to authenticated;

create or replace function public.doc_reads_list(p_company uuid)
returns table (id uuid, file_name text, status text, error text, vendor text, number text, total numeric, receipt_id uuid, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'core.read');
  return query select d.id, d.file_name, case when d.status = 'relayed' then 'reading' else d.status end, d.error, d.result ->> 'vendor_name', d.result ->> 'number',
    nullif(d.result ->> 'total', '')::numeric, d.receipt_id, d.created_at
    from app.document_reads d where d.company_id = p_company order by d.created_at desc limit 50;
end $$;
grant execute on function public.doc_reads_list(uuid) to authenticated;

-- ---------------------------------------------------------------- the draft receipt
-- p: {vendor_id, warehouse_id, date, number, lines: [{variant_id, quantity, unit_cost, code}]}
create or replace function public.doc_read_to_receipt(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare d app.document_reads; v_rec uuid; v_loc uuid; l jsonb; v_cur text; v_vendor uuid; n int := 0;
begin
  select * into d from app.document_reads where id = p_id for update;
  if d.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform app.require_any_permission(d.company_id, array['wms.write', 'inventory.write']);
  if d.receipt_id is not null and exists (select 1 from public.goods_receipts where id = d.receipt_id and deleted_at is null) then
    raise exception 'A receipt was already made from this invoice' using errcode = '23505';
  end if;
  v_vendor := nullif(p ->> 'vendor_id', '')::uuid;
  select id into v_loc from public.warehouse_locations where company_id = d.company_id and warehouse_id = (p ->> 'warehouse_id')::uuid and deleted_at is null
   order by (location_type = 'receiving') desc, (location_type = 'internal') desc, code limit 1;
  if v_loc is null then raise exception 'The warehouse has no location to receive into' using errcode = 'P0002'; end if;
  v_cur := coalesce(nullif(d.result ->> 'currency', ''), (select base_currency from public.companies where id = d.company_id));
  if not exists (select 1 from public.currencies where code = v_cur) then v_cur := (select base_currency from public.companies where id = d.company_id); end if;
  insert into public.goods_receipts (company_id, receipt_type, vendor_id, warehouse_id, receipt_date, vendor_delivery_note, currency_code, notes)
  values (d.company_id, 'purchase', v_vendor, (p ->> 'warehouse_id')::uuid, coalesce(nullif(p ->> 'date', '')::date, current_date),
          left(nullif(p ->> 'number', ''), 60), v_cur, 'Lexuar nga fatura ' || coalesce(nullif(p ->> 'number', ''), d.file_name, ''))
  returning id into v_rec;
  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]'::jsonb)) loop
    if nullif(l ->> 'variant_id', '') is null or coalesce((l ->> 'quantity')::numeric, 0) <= 0 then continue; end if;
    insert into public.goods_receipt_lines (company_id, receipt_id, variant_id, location_id, quantity, unit_cost, unit_price)
    values (d.company_id, v_rec, (l ->> 'variant_id')::uuid, v_loc, (l ->> 'quantity')::numeric, coalesce((l ->> 'unit_cost')::numeric, 0), coalesce((l ->> 'unit_cost')::numeric, 0));
    n := n + 1;
    -- what this line was, for the next invoice of this vendor
    if v_vendor is not null then
      insert into app.read_aliases (company_id, vendor_id, key, variant_id)
      select d.company_id, v_vendor, k, (l ->> 'variant_id')::uuid
        from unnest(array['c:' || app.read_key(l ->> 'code'), 'n:' || app.read_key(l ->> 'name')]) k where length(k) > 3
      on conflict (company_id, vendor_id, key) do update set variant_id = excluded.variant_id, updated_at = now();
      insert into public.vendor_products (company_id, vendor_id, variant_id, vendor_sku, vendor_product_name, price, currency_code)
      values (d.company_id, v_vendor, (l ->> 'variant_id')::uuid, nullif(btrim(l ->> 'code'), ''), left(l ->> 'name', 200), (l ->> 'unit_cost')::numeric, v_cur)
      on conflict (vendor_id, variant_id) where deleted_at is null do nothing;
    end if;
  end loop;
  if n = 0 then raise exception 'Choose the item for at least one line' using errcode = '23514'; end if;
  update app.document_reads set receipt_id = v_rec where id = d.id;
  return v_rec;
end $$;
grant execute on function public.doc_read_to_receipt(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- for the worker only
-- cloud: the next file to read (its own and those of local servers); local: the next to hand to the cloud
create or replace function public.reader_claim()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d app.document_reads;
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  select * into d from app.document_reads
   where (status = 'queued' or (status = 'reading' and created_at < now() - interval '10 minutes')) and attempts < 3
   order by created_at limit 1 for update skip locked;
  if d.id is null then return null; end if;
  update app.document_reads set status = 'reading', attempts = attempts + 1 where id = d.id;
  return jsonb_build_object('id', d.id, 'mime', d.mime, 'file', encode(d.content, 'base64'), 'name', d.file_name, 'relay_id', d.relay_id);
end $$;
revoke execute on function public.reader_claim() from public, anon, authenticated;
grant execute on function public.reader_claim() to service_role;

create or replace function public.reader_done(p_id uuid, p_ok boolean, p_result jsonb default null, p_error text default null,
  p_input_tokens int default null, p_output_tokens int default null, p_relay_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  update app.document_reads set
    status = case when p_relay_id is not null then 'relayed' when p_ok then 'done' when attempts >= 3 then 'failed' else 'queued' end,
    result = coalesce(p_result, result), error = case when p_ok then null else left(p_error, 500) end,
    relay_id = coalesce(p_relay_id, relay_id), input_tokens = p_input_tokens, output_tokens = p_output_tokens,
    done_at = case when p_ok and p_relay_id is null then now() end
  where id = p_id;
end $$;
revoke execute on function public.reader_done(uuid, boolean, jsonb, text, int, int, uuid) from public, anon, authenticated;
grant execute on function public.reader_done(uuid, boolean, jsonb, text, int, int, uuid) to service_role;

-- local: the files handed to the cloud, to ask for their answer
create or replace function public.reader_relayed()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'relay_id', relay_id)) from app.document_reads where status = 'relayed' and created_at > now() - interval '2 days'), '[]'::jsonb);
end $$;
revoke execute on function public.reader_relayed() from public, anon, authenticated;
grant execute on function public.reader_relayed() to service_role;

-- ---------------------------------------------------------------- a local server reads through the cloud
create or replace function public.licence_read_submit(p_code text, p_server uuid, p_file text, p_mime text, p_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare l public.licenses; v_month int; v_id uuid; v_bytes bytea;
begin
  l := app.backup_licence(p_code, p_server);
  select count(*) into v_month from app.document_reads where relay_licence = l.code and created_at > date_trunc('month', now());
  if v_month >= 500 then raise exception 'This licence has read 500 invoices this month' using errcode = '54000'; end if;
  v_bytes := decode(p_file, 'base64');
  if length(v_bytes) > 8 * 1024 * 1024 then raise exception 'The file is larger than 8 MB; take the photo again at a lower size' using errcode = '22023'; end if;
  insert into app.document_reads (company_id, file_name, mime, content, relay_licence) values (l.company_id, left(p_name, 200), p_mime, v_bytes, l.code) returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.licence_read_submit(text, uuid, text, text, text) from public;
grant execute on function public.licence_read_submit(text, uuid, text, text, text) to anon, authenticated;

create or replace function public.licence_read_result(p_code text, p_server uuid, p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.licenses; d app.document_reads;
begin
  l := app.backup_licence(p_code, p_server);
  select * into d from app.document_reads where id = p_id and relay_licence = l.code;
  if d.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  -- the answer is the vendor and lines as read; finding them in the catalogue happens on the local server
  return jsonb_build_object('status', d.status, 'result', d.result, 'error', d.error, 'input_tokens', d.input_tokens, 'output_tokens', d.output_tokens);
end $$;
revoke execute on function public.licence_read_result(text, uuid, uuid) from public;
grant execute on function public.licence_read_result(text, uuid, uuid) to anon, authenticated;

-- the cloud keeps the photos of local servers only until they are read
create or replace function app.doc_reads_cleanup()
returns void language sql security definer set search_path = '' as $$
  update app.document_reads set content = ''::bytea where relay_licence is not null and status in ('done', 'failed') and done_at < now() - interval '2 days' and length(content) > 0;
  delete from app.document_reads where created_at < now() - interval '180 days';
$$;

-- the worker's config: also the AI key
create or replace function public.postier_config()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  return jsonb_build_object(
    'whatsapp_token', (select value from app.server_secrets where key = 'whatsapp_token'),
    'whatsapp_phone_id', (select value from app.server_secrets where key = 'whatsapp_phone_id'),
    'anthropic_api_key', (select value from app.server_secrets where key = 'anthropic_api_key'),
    'ai_model', coalesce((select value from app.server_secrets where key = 'ai_model'), 'claude-sonnet-5-5'));
end $$;

-- the daily cleanup rides on the tick
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;
select app._patch_function('public.automation_tick',
  $x$    perform public.run_monthly_payroll();$x$,
  $x$    perform public.run_monthly_payroll();
    perform app.doc_reads_cleanup();$x$);
drop function app._patch_function(text, text, text);
