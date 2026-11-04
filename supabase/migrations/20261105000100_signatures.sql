-- =============================================================================
-- DrisPRO · signatures on documents: a document goes out as a PDF signed and stamped, without
-- printing it and scanning it back
--   · the company keeps the signature of the owner, the director, the finance director… as a picture
--     (the stamp stays where it was, in the print settings)
--   · each signature says who may sign with it; nobody else even sees the picture
--   · every time a document goes out with a signature, its history says who signed it with whose
--     signature (a picture of a signature, not a qualified electronic signature)
-- =============================================================================

create table if not exists public.company_signatures (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  person_name   text not null check (length(btrim(person_name)) between 2 and 120),
  person_title  text check (length(person_title) <= 120),
  image         text not null check (image like 'data:image/%' and length(image) < 700000),
  -- who may sign documents with it; the company's administrators always may
  user_ids      uuid[] not null default '{}',
  is_default    boolean not null default false,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index if not exists company_signatures_co_idx on public.company_signatures (company_id) where deleted_at is null;
alter table public.company_signatures enable row level security;
revoke all on public.company_signatures from anon;
revoke insert, update, delete on public.company_signatures from authenticated;
grant select on public.company_signatures to authenticated;
drop policy if exists company_signatures_read on public.company_signatures;
create policy company_signatures_read on public.company_signatures for select to authenticated
  using (deleted_at is null and company_id = any ((select app.my_company_ids())::uuid[])
         and (auth.uid() = any (user_ids) or app.has_permission(company_id, 'admin.write')));

-- add or change a signature (administrators)
create or replace function public.signature_save(p_company uuid, p_id uuid, p_name text, p_title text, p_image text, p_user_ids uuid[], p_default boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform app.require_permission(p_company, 'admin.write');
  if p_image is not null and (p_image not like 'data:image/%' or length(p_image) >= 700000) then
    raise exception 'The signature must be a picture smaller than 500 KB' using errcode = '23514';
  end if;
  if exists (select 1 from unnest(coalesce(p_user_ids, '{}')) u
              where not exists (select 1 from public.company_members m where m.company_id = p_company and m.user_id = u and m.status = 'active')) then
    raise exception 'Only people of this company can sign with it' using errcode = '23514';
  end if;
  if p_default then update public.company_signatures set is_default = false where company_id = p_company and is_default; end if;
  if p_id is null then
    if p_image is null then raise exception 'Choose the picture of the signature' using errcode = '23514'; end if;
    insert into public.company_signatures (company_id, person_name, person_title, image, user_ids, is_default)
    values (p_company, btrim(p_name), nullif(btrim(coalesce(p_title, '')), ''), p_image, coalesce(p_user_ids, '{}'), coalesce(p_default, false))
    returning id into v_id;
  else
    update public.company_signatures
       set person_name = btrim(p_name), person_title = nullif(btrim(coalesce(p_title, '')), ''), image = coalesce(p_image, image),
           user_ids = coalesce(p_user_ids, '{}'), is_default = coalesce(p_default, false), updated_at = now()
     where id = p_id and company_id = p_company and deleted_at is null
    returning id into v_id;
    if v_id is null then raise exception 'Signature not found' using errcode = 'P0002'; end if;
  end if;
  insert into public.audit_log (company_id, table_name, record_id, action, new_data, actor_id)
  values (p_company, 'company_signatures', v_id, case when p_id is null then 'INSERT' else 'UPDATE' end,
          jsonb_build_object('person_name', btrim(p_name), 'person_title', p_title, 'user_ids', p_user_ids, 'picture_changed', p_image is not null), auth.uid());
  return v_id;
end $$;
revoke all on function public.signature_save(uuid, uuid, text, text, text, uuid[], boolean) from public, anon;
grant execute on function public.signature_save(uuid, uuid, text, text, text, uuid[], boolean) to authenticated;

create or replace function public.signature_delete(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_co uuid;
begin
  select company_id into v_co from public.company_signatures where id = p_id and deleted_at is null;
  if v_co is null then raise exception 'Signature not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_co, 'admin.write');
  -- the picture goes; the history of the documents it signed stays
  update public.company_signatures set deleted_at = now(), image = 'data:image/png;base64,', is_default = false where id = p_id;
  insert into public.audit_log (company_id, table_name, record_id, action, actor_id) values (v_co, 'company_signatures', p_id, 'DELETE', auth.uid());
end $$;
revoke all on function public.signature_delete(uuid) from public, anon;
grant execute on function public.signature_delete(uuid) to authenticated;

-- the signatures this person may sign with (without the pictures): for the choice when sending
create or replace function public.my_signatures(p_company uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.person_name, 'title', s.person_title, 'is_default', s.is_default)
                            order by s.is_default desc, s.person_name), '[]')
    from public.company_signatures s
   where s.company_id = p_company and s.deleted_at is null and p_company = any (app.my_company_ids())
     and (auth.uid() = any (s.user_ids) or app.has_permission(p_company, 'admin.write'))
$$;
revoke all on function public.my_signatures(uuid) from public, anon;
grant execute on function public.my_signatures(uuid) to authenticated;

-- the document → its table, for the documents that print
create or replace function app.print_table(p_kind text)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_kind = 'sales_invoice' then 'sales_invoices'
    when p_kind in ('sales_quote', 'proforma_quote') then 'sales_quotes'
    when p_kind in ('sales_order', 'proforma') then 'sales_orders'
    when p_kind = 'delivery' then 'deliveries'
    when p_kind = 'payment' then 'payments'
    when p_kind = 'purchase_order' then 'purchase_orders'
    when p_kind = 'goods_receipt' then 'goods_receipts'
  end
$$;

-- sign one document: the picture to draw, and a line in the document's history
create or replace function public.document_sign(p_kind text, p_id uuid, p_signature uuid, p_how text default 'pdf')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_table text := app.print_table(p_kind); v_co uuid; v_number text; s public.company_signatures;
begin
  if v_table is null then raise exception 'Unknown document kind %', p_kind using errcode = '22023'; end if;
  execute format('select company_id, number from public.%I where id = $1 and deleted_at is null', v_table) into v_co, v_number using p_id;
  if v_co is null then raise exception 'Document not found' using errcode = 'P0002'; end if;
  if not (v_co = any (app.my_company_ids())) then raise exception 'Document not found' using errcode = 'P0002'; end if;
  select * into s from public.company_signatures where id = p_signature and company_id = v_co and deleted_at is null;
  if s.id is null then raise exception 'Signature not found' using errcode = 'P0002'; end if;
  if not (auth.uid() = any (s.user_ids) or app.has_permission(v_co, 'admin.write')) then
    raise exception 'You may not sign with the signature of %', s.person_name using errcode = '42501';
  end if;
  insert into public.entity_activities (company_id, entity_type, entity_id, activity_type, title, metadata)
  values (v_co, v_table, p_id, 'system', 'Signed: ' || s.person_name,
          jsonb_build_object('kind', 'signed', 'signature_id', s.id, 'person', s.person_name, 'title', s.person_title,
                             'how', left(coalesce(p_how, 'pdf'), 20), 'number', v_number));
  return jsonb_build_object('name', s.person_name, 'title', s.person_title, 'image', s.image);
end $$;
revoke all on function public.document_sign(text, uuid, uuid, text) from public, anon;
grant execute on function public.document_sign(text, uuid, uuid, text) to authenticated;
