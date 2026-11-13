-- =============================================================================
-- DrisPRO · 20261113000300 · The business's own documents (request K-0012)
-- One place for the papers a business is asked for (a visit of the tax administration, a bank, a tender): the
-- business certificate, the VAT and fiscal certificates, licences, contracts. Each is a file kept with what it
-- is and until when it holds. With them goes a sheet made by the program: the business's data and its units
-- with their addresses. All of it prints and goes by email as attachments from the company mailbox.
-- Seen by those who manage the company (admin.read); the files sit in company-assets under business-docs/.
-- =============================================================================
create table public.company_documents (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) deferrable,
  kind         text not null default 'other' check (kind in ('business_certificate', 'fiscal_certificate', 'vat_certificate', 'licence', 'lease', 'bank', 'statute', 'other')),
  title        text not null check (btrim(title) <> ''),
  valid_until  date,
  note         text,
  storage_path text not null,
  file_name    text not null,
  mime_type    text,
  size_bytes   bigint check (size_bytes >= 0),
  check (split_part(storage_path, '/', 1) = company_id::text and split_part(storage_path, '/', 2) = 'business-docs')
);
select app.register_table('public.company_documents', 'admin', p_soft_delete => false);
create index company_documents_company_idx on public.company_documents (company_id, kind);
create unique index company_documents_path_key on public.company_documents (storage_path);

-- the files: only those who manage the company read and put them (the bucket itself is open to every member).
-- coalesce: a file at the top of the company folder has no second folder, and a null here would refuse it
do $$
begin
  if to_regclass('storage.objects') is null then return; end if;
  execute 'drop policy if exists "business documents: read" on storage.objects';
  execute 'drop policy if exists "business documents: upload" on storage.objects';
  execute 'drop policy if exists "business documents: remove" on storage.objects';
  execute $p$create policy "business documents: read" on storage.objects as restrictive for select to authenticated
    using (not (bucket_id = 'company-assets' and coalesce((storage.foldername(name))[2], '') = 'business-docs')
           or (storage.foldername(name))[1] = any ((select app.company_ids_with('admin.read'))::text[]))$p$;
  execute $p$create policy "business documents: upload" on storage.objects as restrictive for insert to authenticated
    with check (not (bucket_id = 'company-assets' and coalesce((storage.foldername(name))[2], '') = 'business-docs')
           or (storage.foldername(name))[1] = any ((select app.company_ids_with('admin.write'))::text[]))$p$;
  execute $p$create policy "business documents: remove" on storage.objects as restrictive for delete to authenticated
    using (not (bucket_id = 'company-assets' and coalesce((storage.foldername(name))[2], '') = 'business-docs')
           or (storage.foldername(name))[1] = any ((select app.company_ids_with('admin.write'))::text[]))$p$;
end $$;

-- the sheet: the business's data and its units with their addresses
create or replace function public.business_sheet(p_company uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.companies;
begin
  perform app.require_permission(p_company, 'admin.read');
  select * into c from public.companies where id = p_company;
  return jsonb_build_object(
    'company', app.print_company(p_company),
    'business', jsonb_build_object('name', c.name, 'legal_name', c.legal_name, 'tax_number', c.tax_number, 'vat_number', c.vat_number,
      'business_number', c.business_number, 'address', concat_ws(', ', nullif(c.address_line1, ''), nullif(c.address_line2, '')), 'city', c.city,
      'postal_code', c.postal_code, 'phone', c.phone, 'email', c.email, 'website', c.website, 'business_type', c.business_type),
    'units', coalesce((select jsonb_agg(jsonb_build_object('code', w.code, 'name', w.name, 'kind', w.warehouse_type, 'address', w.address_line1, 'city', w.city,
        'unit_no', w.atk_unit_no, 'manager', (select p.full_name from public.profiles p where p.id = w.manager_id),
        'tills', (select count(*) from public.pos_registers r where r.warehouse_id = w.id and r.deleted_at is null and r.is_active)) order by w.code)
      from public.warehouses w where w.company_id = p_company and w.deleted_at is null and w.is_active and w.warehouse_type <> 'transit'), '[]'::jsonb),
    'printed_by', (select full_name from public.profiles where id = auth.uid()), 'printed_at', now());
end $$;
revoke execute on function public.business_sheet(uuid) from public, anon;
grant execute on function public.business_sheet(uuid) to authenticated;

-- by email: the chosen files (and the sheet) as attachments of one message from the company mailbox
create or replace function public.business_documents_email(p_company uuid, p_to text, p_subject text, p_message text, p_files jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; f jsonb; v_files jsonb := '[]'::jsonb; v_size bigint := 0;
begin
  perform app.require_permission(p_company, 'admin.read');
  if coalesce(btrim(p_to), '') !~ '^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$' then raise exception 'Write a valid email address' using errcode = '22023'; end if;
  if not exists (select 1 from app.mail_accounts where company_id = p_company and is_active) then
    raise exception 'Set up the company mailbox first (Automations › Email)' using errcode = '55000';
  end if;
  if jsonb_typeof(p_files) is distinct from 'array' or jsonb_array_length(p_files) = 0 then raise exception 'Choose at least one document' using errcode = '22023'; end if;
  if jsonb_array_length(p_files) > 12 then raise exception 'At most 12 files in one message' using errcode = '22023'; end if;
  for f in select * from jsonb_array_elements(p_files) loop
    if coalesce(f ->> 'data', '') = '' or f ->> 'data' !~ '^[A-Za-z0-9+/=\s]+$' then raise exception 'A file is empty or damaged' using errcode = '22023'; end if;
    if coalesce(f ->> 'mime', '') not in ('application/pdf', 'image/jpeg', 'image/png') then raise exception 'Only PDF, JPG and PNG files go by email' using errcode = '22023'; end if;
    v_size := v_size + length(f ->> 'data');
    v_files := v_files || jsonb_build_object('name', left(regexp_replace(coalesce(nullif(btrim(f ->> 'name'), ''), 'dokument'), '[\r\n"\\/]', '-', 'g'), 120), 'mime', f ->> 'mime', 'data', f ->> 'data');
  end loop;
  if v_size > 14000000 then raise exception 'The files together are too large for one message (10 MB)' using errcode = '22023'; end if;
  v_id := app.enqueue_message(p_company, 'email', btrim(p_to), left(coalesce(nullif(btrim(p_subject), ''), 'Dokumentet e biznesit'), 300),
            coalesce(p_message, ''), null, 'document', null, null, 'company_documents', p_company);
  update app.message_outbox set attachments = v_files where id = v_id;
  return v_id;
end $$;
revoke execute on function public.business_documents_email(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.business_documents_email(uuid, text, text, text, jsonb) to authenticated;
