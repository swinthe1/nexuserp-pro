-- =============================================================================
-- Small things businesses see every day (from a look at another program):
--   · the company stamp and signature, printed on invoices and other documents;
--   · the code of the store or warehouse inside the document number (FAT-2026-01-0001), each store
--     counting on its own;
--   · the stock valued at the selling prices too, with the margin it would bring.
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

-- ---------------------------------------------------------------------------------------------
-- 1. Stamp and signature
-- ---------------------------------------------------------------------------------------------
alter table public.company_settings add column if not exists print_stamp text;

create or replace function public.print_stamp_save(p_company uuid, p_stamp text, p_clear boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'admin.write');
  if p_stamp is not null and (p_stamp not like 'data:image/%' or length(p_stamp) >= 700000) then
    raise exception 'The stamp must be a picture smaller than 500 KB' using errcode = '23514';
  end if;
  update public.company_settings set print_stamp = case when p_clear then null else coalesce(p_stamp, print_stamp) end where company_id = p_company;
end $$;
revoke all on function public.print_stamp_save(uuid, text, boolean) from public, anon;
grant execute on function public.print_stamp_save(uuid, text, boolean) to authenticated;

do $$ begin
  perform app._patch_function('app.print_company', E'''logo'', s.print_logo,', E'''logo'', s.print_logo, ''stamp'', s.print_stamp,');
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. The store in the document number
-- ---------------------------------------------------------------------------------------------
alter table public.document_sequences add column if not exists include_location boolean not null default false;

drop function if exists app.next_document_number(uuid, text, date);
create or replace function app.next_document_number(p_company uuid, p_doc_type text, p_date date default current_date, p_location text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare s public.document_sequences; v_period text; v_value bigint; v_loc text;
begin
  if auth.uid() is not null and not (p_company = any (app.my_company_ids())) then
    raise exception 'Not a member of this company' using errcode = '42501';
  end if;
  insert into public.document_sequences (company_id, doc_type, prefix)
  select p_company, dt.key, dt.default_prefix from public.document_types dt where dt.key = p_doc_type
  on conflict (company_id, doc_type) do nothing;

  select * into s from public.document_sequences where company_id = p_company and doc_type = p_doc_type;
  if not found then raise exception 'Unknown document type %', p_doc_type; end if;
  v_loc := case when s.include_location then nullif(upper(regexp_replace(coalesce(p_location, ''), '[^0-9A-Za-z]', '', 'g')), '') end;
  -- each store counts on its own
  v_period := case when s.reset_policy = 'yearly' then to_char(p_date, 'YYYY') else '' end || coalesce(':' || v_loc, '');

  insert into public.document_sequence_counters (company_id, doc_type, period_key)
  values (p_company, p_doc_type, v_period) on conflict do nothing;
  update public.document_sequence_counters
     set next_value = next_value + 1
   where company_id = p_company and doc_type = p_doc_type and period_key = v_period
  returning next_value - 1 into v_value;

  return s.prefix
      || case when s.include_year then to_char(p_date, 'YYYY') || '-' else '' end
      || coalesce(v_loc || '-', '')
      || lpad(v_value::text, s.padding, '0');
end $$;

-- the store of a document: its warehouse, the order's, or the till's
create or replace function app.doc_location_code(p_row jsonb)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v text; v_id uuid;
begin
  begin v_id := nullif(p_row ->> 'warehouse_id', '')::uuid; exception when others then v_id := null; end;
  if v_id is not null then select code into v from public.warehouses where id = v_id; if v is not null then return v; end if; end if;
  begin v_id := nullif(p_row ->> 'sales_order_id', '')::uuid; exception when others then v_id := null; end;
  if v_id is not null then
    select w.code into v from public.sales_orders so join public.warehouses w on w.id = so.warehouse_id where so.id = v_id;
    if v is not null then return v; end if;
  end if;
  begin v_id := nullif(p_row ->> 'register_id', '')::uuid; exception when others then v_id := null; end;
  if v_id is not null then
    select w.code into v from public.pos_registers r join public.warehouses w on w.id = r.warehouse_id where r.id = v_id;
    if v is not null then return v; end if;
  end if;
  return null;
end $$;

create or replace function app.tg_assign_number()
returns trigger language plpgsql set search_path = '' as $$
declare v_row jsonb := to_jsonb(new); v_type text;
begin
  if tg_op = 'INSERT' then
    if coalesce(new.number, '') = '' then
      v_type := coalesce(v_row ->> 'document_type', tg_argv[0]);
      new.number := app.next_document_number(
        new.company_id, v_type,
        coalesce((v_row ->> tg_argv[1])::date, current_date),
        case when exists (select 1 from public.document_sequences where company_id = new.company_id and doc_type = v_type and include_location)
             then app.doc_location_code(v_row) end);
    end if;
  elsif new.number is distinct from old.number then
    raise exception 'Document numbers cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;


create or replace function public.set_numbering_location(p_company uuid, p_doc_type text, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'admin.write');
  insert into public.document_sequences (company_id, doc_type, prefix)
  select p_company, dt.key, dt.default_prefix from public.document_types dt where dt.key = p_doc_type
  on conflict (company_id, doc_type) do nothing;
  update public.document_sequences set include_location = coalesce(p_on, false) where company_id = p_company and doc_type = p_doc_type;
end $$;

create or replace function public.numbering_location_types(p_company uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(doc_type), '{}') from public.document_sequences
   where company_id = p_company and include_location and app.has_permission(p_company, 'admin.read')
$$;
revoke all on function public.set_numbering_location(uuid, text, boolean), public.numbering_location_types(uuid) from public, anon;
grant execute on function public.set_numbering_location(uuid, text, boolean), public.numbering_location_types(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 3. The stock at selling prices
-- ---------------------------------------------------------------------------------------------
do $$ begin
  perform app._patch_function('public.run_report',
    E'(%L::date - coalesce(s.last_out, s.last_in)) as idle_days,',
    E'(%L::date - coalesce(s.last_out, s.last_in)) as idle_days, coalesce(v.sales_price_override, pr.sales_price, 0) as sales_price,');
  perform app._patch_function('public.run_report',
    E'jsonb_build_object(''key'',''idle_days'',''label'',''Days since last movement'',''type'',''int''));',
    E'jsonb_build_object(''key'',''idle_days'',''label'',''Days since last movement'',''type'',''int''));\n'
    || E'    if p_report = ''inventory'' then\n'
    || E'      v_measures := v_measures || '', round(sum(qty * sales_price), 2) as sales_value, round(sum(qty * sales_price) - sum(value), 2) as expected_margin'';\n'
    || E'      v_cols := v_cols || jsonb_build_array(jsonb_build_object(''key'',''sales_value'',''label'',''Value at selling prices'',''type'',''money''),\n'
    || E'        jsonb_build_object(''key'',''expected_margin'',''label'',''Margin when sold'',''type'',''money''));\n'
    || E'    end if;');
end $$;

drop function app._patch_function(text, text, text);
