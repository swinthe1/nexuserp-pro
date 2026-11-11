-- =============================================================================
-- DrisPRO · the invoice reader learns from the corrections (11.11.2026)
--   · what a person corrects after a read (a quantity, a price, the item, a line left out, the number, the date) is kept
--     per supplier: app.read_feedback
--   · each supplier can have reading rules written in plain words ("the third column is the price without VAT",
--     "quantities are in packs of 12"): app.read_rules
--   · the next photo goes to the AI together with the rules and the latest corrections of the shop's suppliers;
--     the AI applies those of the supplier it sees on the invoice (app.read_hints, reader_claim → the postier)
--   · reader_stats: per supplier how many invoices were read, how many lines were corrected and in what
--   The AI model itself is not trained; the shop's memory travels with every read.
-- =============================================================================

alter table app.document_reads add column if not exists hints text;
-- the supplier, when the person says whose invoice it is before the photo (hand-written invoices read far better so)
alter table app.document_reads add column if not exists vendor_id uuid references public.business_partners(id) on delete set null;

create table if not exists app.read_rules (
  company_id uuid not null references public.companies(id) on delete cascade,
  vendor_id  uuid not null references public.business_partners(id) on delete cascade,
  notes      text not null,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (company_id, vendor_id)
);

create table if not exists app.read_feedback (
  read_id     uuid primary key references app.document_reads(id) on delete cascade,
  company_id  uuid not null references public.companies(id) on delete cascade,
  vendor_id   uuid references public.business_partners(id) on delete cascade,
  lines_read  int not null default 0,
  lines_fixed int not null default 0,
  fields      jsonb not null default '{}'::jsonb,   -- {quantity: 2, unit_price: 1, item: 3, left_out: 1, number: 1, date: 0}
  examples    jsonb not null default '[]'::jsonb,   -- [{name, code, field, read, right}]
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists read_feedback_vendor on app.read_feedback (company_id, vendor_id, created_at desc);

-- the person goes on from the checked read: what they changed against what was read
create or replace function public.doc_read_feedback(p_id uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d app.document_reads; m jsonb; l jsonb; r jsonb; i int; v_vendor uuid; n_read int := 0; n_fixed int := 0; fixed boolean;
        f_qty int := 0; f_price int := 0; f_item int := 0; f_out int := 0; f_no int := 0; f_date int := 0; ex jsonb := '[]'::jsonb;
        q_read numeric; q_right numeric; p_read numeric; p_right numeric;
begin
  select * into d from app.document_reads where id = p_id;
  if d.id is null or d.result is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform app.require_any_permission(d.company_id, array['wms.write', 'inventory.write', 'procurement.write']);
  m := app.doc_read_match(d.company_id, d.result || case when d.vendor_id is not null then jsonb_build_object('for_vendor', d.vendor_id) else '{}'::jsonb end);
  v_vendor := nullif(p ->> 'vendor_id', '')::uuid;
  if v_vendor is not null and not exists (select 1 from public.business_partners where id = v_vendor and company_id = d.company_id) then v_vendor := null; end if;
  n_read := jsonb_array_length(coalesce(m -> 'lines', '[]'::jsonb));
  for l in select * from jsonb_array_elements(coalesce(p -> 'lines', '[]'::jsonb)) loop
    i := (l ->> 'i')::int;
    r := m -> 'lines' -> i;
    continue when r is null;
    fixed := false;
    if not coalesce((l ->> 'use')::boolean, true) then
      f_out := f_out + 1; fixed := true;
      ex := ex || jsonb_build_object('name', left(r ->> 'name', 80), 'field', 'left_out');
    else
      q_read := coalesce((r ->> 'quantity')::numeric, 0); q_right := coalesce((l ->> 'quantity')::numeric, 0);
      p_read := coalesce((r ->> 'unit_price')::numeric, 0); p_right := coalesce((l ->> 'unit_price')::numeric, 0);
      if abs(q_read - q_right) > 0.0005 then
        f_qty := f_qty + 1; fixed := true;
        ex := ex || jsonb_build_object('name', left(r ->> 'name', 80), 'code', r ->> 'code', 'field', 'quantity', 'read', q_read, 'right', q_right, 'unit', r ->> 'unit');
      end if;
      if abs(p_read - p_right) > 0.005 then
        f_price := f_price + 1; fixed := true;
        ex := ex || jsonb_build_object('name', left(r ->> 'name', 80), 'code', r ->> 'code', 'field', 'unit_price', 'read', p_read, 'right', p_right,
                                       'vat_rate', r -> 'vat_rate', 'line_total', r -> 'line_total');
      end if;
      -- the item: found wrong, or not found at all (that one the aliases remember; it is counted, not sent to the AI)
      if nullif(l ->> 'variant_id', '') is distinct from (r ->> 'variant_id') then f_item := f_item + 1; fixed := true; end if;
    end if;
    if fixed then n_fixed := n_fixed + 1; end if;
  end loop;
  if coalesce(nullif(btrim(p ->> 'number'), ''), '') is distinct from coalesce(nullif(btrim(m ->> 'number'), ''), '') then
    f_no := 1; ex := ex || jsonb_build_object('field', 'number', 'read', m ->> 'number', 'right', p ->> 'number');
  end if;
  if nullif(p ->> 'date', '') is not null and nullif(m ->> 'date', '') is not null and (p ->> 'date') <> (m ->> 'date') then
    f_date := 1; ex := ex || jsonb_build_object('field', 'date', 'read', m ->> 'date', 'right', p ->> 'date');
  end if;
  insert into app.read_feedback (read_id, company_id, vendor_id, lines_read, lines_fixed, fields, examples)
  values (d.id, d.company_id, v_vendor, n_read, n_fixed,
          jsonb_build_object('quantity', f_qty, 'unit_price', f_price, 'item', f_item, 'left_out', f_out, 'number', f_no, 'date', f_date),
          (select coalesce(jsonb_agg(e), '[]'::jsonb) from (select e from jsonb_array_elements(ex) e limit 12) x))
  on conflict (read_id) do update set vendor_id = excluded.vendor_id, lines_read = excluded.lines_read, lines_fixed = excluded.lines_fixed,
        fields = excluded.fields, examples = excluded.examples, created_at = now();
  return jsonb_build_object('lines_read', n_read, 'lines_fixed', n_fixed);
end $$;

-- one supplier's part of what goes to the AI: the rules, then the latest corrections of quantities, prices and headers
create or replace function app.read_vendor_hint(p_company uuid, p_vendor uuid)
returns text language sql stable security definer set search_path = '' as $$
  select nullif(concat_ws(E'\n',
    (select 'Rules written by the shop: ' || replace(left(r.notes, 600), E'\n', ' ') from app.read_rules r where r.company_id = p_company and r.vendor_id = p_vendor),
    (select 'Corrections people made on its earlier invoices: ' || string_agg(x.say, '; ')
       from (select case e ->> 'field'
                      when 'quantity' then format('"%s" quantity was read %s, right was %s', e ->> 'name', e ->> 'read', e ->> 'right')
                      when 'unit_price' then format('"%s" unit price without VAT was read %s, right was %s%s', e ->> 'name', e ->> 'read', e ->> 'right',
                                                    case when e ->> 'vat_rate' is not null then format(' (VAT %s%%)', e ->> 'vat_rate') else '' end)
                      when 'left_out' then format('"%s" is not goods and was left out', e ->> 'name')
                      when 'number' then format('invoice number was read "%s", right was "%s"', e ->> 'read', e ->> 'right')
                      when 'date' then format('date was read %s, right was %s', e ->> 'read', e ->> 'right') end as say
               from (select f.examples, f.created_at from app.read_feedback f
                      where f.company_id = p_company and f.vendor_id = p_vendor and f.lines_fixed + coalesce((f.fields ->> 'number')::int, 0) + coalesce((f.fields ->> 'date')::int, 0) > 0
                      order by f.created_at desc limit 3) f
               cross join lateral jsonb_array_elements(f.examples) e
              limit 8) x where x.say is not null)), '')
$$;

-- what this supplier usually delivers, with the last price: a hand-written name is then chosen among them, not guessed
create or replace function app.read_vendor_items(p_company uuid, p_vendor uuid)
returns text language sql stable security definer set search_path = '' as $$
  select string_agg(x.say, '; ') from (
    select format('%s%s%s', coalesce(nullif(vp.vendor_product_name, ''), v.name),
                  case when nullif(vp.vendor_sku, '') is not null then format(' [code %s]', vp.vendor_sku) else '' end,
                  case when vp.price > 0 then format(' ~%s without VAT', trim_scale(round(vp.price, 4))) else '' end) as say
      from public.vendor_products vp join public.product_variants v on v.id = vp.variant_id and v.deleted_at is null
     where vp.company_id = p_company and vp.vendor_id = p_vendor and vp.deleted_at is null
     order by vp.updated_at desc nulls last limit 120) x
$$;

-- for the next read: the suppliers with rules or corrections, the most recently corrected first (at most 12, 6 000 characters)
create or replace function app.read_hints(p_company uuid)
returns text language sql stable security definer set search_path = '' as $$
  with v as (
    select bp.id, bp.name, coalesce(nullif(bp.tax_number, ''), nullif(bp.vat_number, '')) as tax,
           greatest(coalesce((select max(f.created_at) from app.read_feedback f where f.company_id = p_company and f.vendor_id = bp.id), '-infinity'),
                    coalesce((select r.updated_at from app.read_rules r where r.company_id = p_company and r.vendor_id = bp.id), '-infinity')) as at
      from public.business_partners bp
     where bp.company_id = p_company and bp.deleted_at is null
       and (exists (select 1 from app.read_rules r where r.company_id = p_company and r.vendor_id = bp.id)
         or exists (select 1 from app.read_feedback f where f.company_id = p_company and f.vendor_id = bp.id))),
  h as (select v.at, format('Supplier "%s"%s:', v.name, case when v.tax is not null then format(' (tax number %s)', v.tax) else '' end) || E'\n' || app.read_vendor_hint(p_company, v.id) as txt
          from v where app.read_vendor_hint(p_company, v.id) is not null order by v.at desc limit 12)
  select left(string_agg(h.txt, E'\n\n' order by h.at desc), 6000) from h
$$;

CREATE OR REPLACE FUNCTION public.reader_claim()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d app.document_reads;
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  select * into d from app.document_reads
   where (status = 'queued' or (status = 'reading' and created_at < now() - interval '10 minutes')) and attempts < 3
   order by created_at limit 1 for update skip locked;
  if d.id is null then return null; end if;
  update app.document_reads set status = 'reading', attempts = attempts + 1 where id = d.id;
  -- what the shop has learned about its suppliers' invoices goes with the photo (a local server sent its own along)
  return jsonb_build_object('id', d.id, 'kind', d.kind, 'mime', d.mime, 'file', encode(d.content, 'base64'), 'name', d.file_name, 'relay_id', d.relay_id,
    'hints', case when d.kind = 'supplier_invoice' then coalesce(d.hints,
      case when d.vendor_id is not null then left(concat_ws(E'\n',
          (select format('THIS invoice is from the supplier "%s"%s.', bp.name, coalesce(' (tax number ' || nullif(bp.tax_number, '') || ')', '')) from public.business_partners bp where bp.id = d.vendor_id),
          app.read_vendor_hint(d.company_id, d.vendor_id),
          'Items this supplier usually delivers (choose the name among these when the writing fits one of them): ' || app.read_vendor_items(d.company_id, d.vendor_id)), 9000)
      else app.read_hints(d.company_id) end) end);
end $function$;

-- a local server sends its own hints along with the photo
drop function if exists public.licence_read_submit(text, uuid, text, text, text, text);
CREATE OR REPLACE FUNCTION public.licence_read_submit(p_code text, p_server uuid, p_file text, p_mime text, p_name text DEFAULT NULL::text, p_kind text DEFAULT 'supplier_invoice'::text, p_hints text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare l public.licenses; v_id uuid; v_bytes bytea;
begin
  l := app.backup_licence(p_code, p_server);
  perform app.ai_reads_check(l.company_id);
  v_bytes := decode(p_file, 'base64');
  if length(v_bytes) > 8 * 1024 * 1024 then raise exception 'The file is larger than 8 MB; take the photo again at a lower size' using errcode = '22023'; end if;
  insert into app.document_reads (company_id, kind, file_name, mime, content, relay_licence, hints)
  values (l.company_id, case when p_kind in ('expense', 'z_report', 'asset') then p_kind else 'supplier_invoice' end, left(p_name, 200), p_mime, v_bytes, l.code, left(nullif(btrim(p_hints), ''), 8000)) returning id into v_id;
  return v_id;
end $function$;
revoke execute on function public.licence_read_submit(text, uuid, text, text, text, text, text) from public;
grant execute on function public.licence_read_submit(text, uuid, text, text, text, text, text) to anon, authenticated, service_role;

-- the supplier named before the photo is the supplier of the read
CREATE OR REPLACE FUNCTION public.doc_read_get(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare d app.document_reads;
begin
  select * into d from app.document_reads where id = p_id;
  if d.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform app.require_permission(d.company_id, 'core.read');
  return jsonb_build_object('id', d.id, 'status', case when d.status = 'relayed' then 'reading' else d.status end, 'error', d.error, 'file_name', d.file_name,
    'receipt_id', d.receipt_id, 'created_at', d.created_at,
    'result', case when d.status = 'done' then app.doc_read_match(d.company_id, d.result || case when d.vendor_id is not null then jsonb_build_object('for_vendor', d.vendor_id) else '{}'::jsonb end) end);
end $function$;

-- the person may say whose invoice it is before the photo
drop function if exists public.doc_read_submit(uuid, text, text, text, text);
CREATE OR REPLACE FUNCTION public.doc_read_submit(p_company uuid, p_file text, p_mime text, p_name text DEFAULT NULL::text, p_kind text DEFAULT 'supplier_invoice'::text, p_vendor uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_bytes bytea; v_id uuid;
begin
  if p_kind in ('expense', 'z_report', 'asset') then perform app.require_any_permission(p_company, array['finance.write', 'invoicing.write', 'procurement.write']);
  else perform app.require_any_permission(p_company, array['wms.write', 'inventory.write', 'procurement.write']); end if;
  perform app.ai_reads_check(p_company);
  v_bytes := decode(regexp_replace(coalesce(p_file, ''), '^data:[^,]*,', ''), 'base64');
  if length(v_bytes) < 200 then raise exception 'The file is empty' using errcode = '22023'; end if;
  if length(v_bytes) > 8 * 1024 * 1024 then raise exception 'The file is larger than 8 MB; take the photo again at a lower size' using errcode = '22023'; end if;
  insert into app.document_reads (company_id, kind, file_name, mime, content, vendor_id)
  values (p_company, coalesce(p_kind, 'supplier_invoice'), left(p_name, 200), p_mime, v_bytes,
          (select bp.id from public.business_partners bp where bp.id = p_vendor and bp.company_id = p_company)) returning id into v_id;
  return v_id;
end $function$;
revoke execute on function public.doc_read_submit(uuid, text, text, text, text, uuid) from public, anon;
grant execute on function public.doc_read_submit(uuid, text, text, text, text, uuid) to authenticated;

-- the rules of one supplier, with what the reader has learned about it
create or replace function public.read_rules_get(p_company uuid, p_vendor uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_any_permission(p_company, array['wms.write', 'inventory.write', 'procurement.write', 'invoicing.read']);
  return jsonb_build_object(
    'notes', (select r.notes from app.read_rules r where r.company_id = p_company and r.vendor_id = p_vendor),
    'learned', (select coalesce(jsonb_agg(e order by f.created_at desc), '[]'::jsonb)
                  from (select f.examples, f.created_at from app.read_feedback f where f.company_id = p_company and f.vendor_id = p_vendor order by f.created_at desc limit 3) f
                  cross join lateral jsonb_array_elements(f.examples) e));
end $$;

create or replace function public.read_rules_save(p_company uuid, p_vendor uuid, p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_any_permission(p_company, array['wms.write', 'inventory.write', 'procurement.write']);
  if not exists (select 1 from public.business_partners where id = p_vendor and company_id = p_company) then raise exception 'Supplier not found' using errcode = 'P0002'; end if;
  if nullif(btrim(p_notes), '') is null then
    delete from app.read_rules where company_id = p_company and vendor_id = p_vendor;
  else
    insert into app.read_rules (company_id, vendor_id, notes) values (p_company, p_vendor, left(btrim(p_notes), 1000))
    on conflict (company_id, vendor_id) do update set notes = excluded.notes, updated_by = auth.uid(), updated_at = now();
  end if;
end $$;

-- how well it reads: per supplier the invoices checked, the lines read and corrected, and what was corrected
create or replace function public.reader_stats(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_any_permission(p_company, array['wms.write', 'inventory.write', 'procurement.write', 'invoicing.read']);
  return jsonb_build_object(
    'reads', (select count(*) from app.read_feedback f where f.company_id = p_company),
    'lines_read', (select coalesce(sum(f.lines_read), 0) from app.read_feedback f where f.company_id = p_company),
    'lines_fixed', (select coalesce(sum(f.lines_fixed), 0) from app.read_feedback f where f.company_id = p_company),
    'vendors', coalesce((select jsonb_agg(x order by x.reads desc, x.name) from (
        select bp.id, bp.name, count(f.read_id) as reads, coalesce(sum(f.lines_read), 0) as lines_read, coalesce(sum(f.lines_fixed), 0) as lines_fixed,
               coalesce(sum((f.fields ->> 'quantity')::int), 0) as quantity, coalesce(sum((f.fields ->> 'unit_price')::int), 0) as unit_price,
               coalesce(sum((f.fields ->> 'item')::int), 0) as item, coalesce(sum((f.fields ->> 'left_out')::int), 0) as left_out,
               coalesce(sum((f.fields ->> 'number')::int + (f.fields ->> 'date')::int), 0) as header,
               max(f.created_at) as last_at,
               -- the last three invoices against the ones before: is it getting better
               (select round(100.0 * sum(z.lines_fixed) / nullif(sum(z.lines_read), 0), 1) from (select f2.lines_fixed, f2.lines_read from app.read_feedback f2
                  where f2.company_id = p_company and f2.vendor_id = bp.id order by f2.created_at desc limit 3) z) as recent_pct,
               (select round(100.0 * sum(z.lines_fixed) / nullif(sum(z.lines_read), 0), 1) from (select f2.lines_fixed, f2.lines_read from app.read_feedback f2
                  where f2.company_id = p_company and f2.vendor_id = bp.id order by f2.created_at desc offset 3) z) as before_pct,
               exists (select 1 from app.read_rules r where r.company_id = p_company and r.vendor_id = bp.id) as has_rules
          from public.business_partners bp
          left join app.read_feedback f on f.company_id = p_company and f.vendor_id = bp.id
         where bp.company_id = p_company and bp.deleted_at is null
           and (f.read_id is not null or exists (select 1 from app.read_rules r where r.company_id = p_company and r.vendor_id = bp.id))
         group by bp.id, bp.name) x), '[]'::jsonb));
end $$;

revoke execute on function public.doc_read_feedback(uuid, jsonb), public.read_rules_get(uuid, uuid), public.read_rules_save(uuid, uuid, text), public.reader_stats(uuid) from public, anon;
grant execute on function public.doc_read_feedback(uuid, jsonb), public.read_rules_get(uuid, uuid), public.read_rules_save(uuid, uuid, text), public.reader_stats(uuid) to authenticated;
revoke all on function app.read_hints(uuid), app.read_vendor_hint(uuid, uuid), app.read_vendor_items(uuid, uuid) from public, anon, authenticated;
