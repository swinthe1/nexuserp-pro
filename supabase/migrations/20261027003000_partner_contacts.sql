-- =============================================================================
-- Contact details of partners, filled in by themselves or from their own invoices
--   · An invoice read from a photo carries the seller's address, phone, e-mail and IBAN: an empty
--     field of the supplier is filled at once; a different value is offered, never overwritten.
--   · "Ask for the details": a link the company sends to a customer or supplier (e-mail, WhatsApp);
--     the partner fills in address, phone, e-mail, IBAN and a contact person, once, within 14 days.
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

-- the contact details printed on an invoice, cleaned
create or replace function app.read_contact(r jsonb)
returns jsonb language sql immutable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'phone', nullif(left(btrim(regexp_replace(coalesce(r ->> 'vendor_phone', ''), '[^0-9+ /()-]', '', 'g')), 40), ''),
    'email', case when coalesce(r ->> 'vendor_email', '') ~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then lower(btrim(r ->> 'vendor_email')) end,
    'iban', nullif(upper(regexp_replace(coalesce(r ->> 'vendor_iban', ''), '\s', '', 'g')), ''),
    'address', nullif(left(btrim(coalesce(r ->> 'vendor_address', '')), 200), ''),
    'city', nullif(left(btrim(coalesce(r ->> 'vendor_city', '')), 80), '')))
$$;

-- empty fields of the partner are filled; what differs is returned for a person to decide
create or replace function app.partner_fill_contact(p_partner uuid, c jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare bp public.business_partners; a public.partner_addresses; v_diff jsonb := '{}';
begin
  select * into bp from public.business_partners where id = p_partner;
  if bp.id is null or c is null or c = '{}'::jsonb then return '{}'; end if;
  update public.business_partners set phone = coalesce(nullif(phone, ''), c ->> 'phone'), email = coalesce(nullif(email, ''), c ->> 'email'),
         bank_iban = coalesce(nullif(bank_iban, ''), c ->> 'iban')
   where id = p_partner;
  if bp.phone is not null and c ? 'phone' and regexp_replace(bp.phone, '\D', '', 'g') <> regexp_replace(c ->> 'phone', '\D', '', 'g') then
    v_diff := v_diff || jsonb_build_object('phone', jsonb_build_object('now', bp.phone, 'invoice', c ->> 'phone')); end if;
  if bp.email is not null and c ? 'email' and lower(bp.email) <> c ->> 'email' then
    v_diff := v_diff || jsonb_build_object('email', jsonb_build_object('now', bp.email, 'invoice', c ->> 'email')); end if;
  if bp.bank_iban is not null and c ? 'iban' and upper(replace(bp.bank_iban, ' ', '')) <> c ->> 'iban' then
    v_diff := v_diff || jsonb_build_object('iban', jsonb_build_object('now', bp.bank_iban, 'invoice', c ->> 'iban')); end if;
  if c ? 'address' then
    select * into a from public.partner_addresses where partner_id = p_partner and deleted_at is null order by is_default desc, created_at limit 1;
    if a.id is null then
      insert into public.partner_addresses (company_id, partner_id, address_type, line1, city, country_code, is_default)
      values (bp.company_id, p_partner, 'billing', c ->> 'address', c ->> 'city', 'XK', true);
    elsif coalesce(a.line1, '') = '' or a.line1 = a.city then
      update public.partner_addresses set line1 = c ->> 'address', city = coalesce(city, c ->> 'city') where id = a.id;
    elsif lower(a.line1) <> lower(c ->> 'address') then
      v_diff := v_diff || jsonb_build_object('address', jsonb_build_object('now', a.line1, 'invoice', c ->> 'address'));
    end if;
  end if;
  return v_diff;
end $$;

-- what a person chose to take from the invoice
create or replace function public.partner_contact_apply(p_partner uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare bp public.business_partners; a uuid;
begin
  select * into bp from public.business_partners where id = p_partner and deleted_at is null;
  if bp.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform app.require_any_permission(bp.company_id, array['partners.write', 'invoicing.write', 'procurement.write']);
  update public.business_partners set phone = coalesce(nullif(p ->> 'phone', ''), phone), email = coalesce(nullif(p ->> 'email', ''), email),
         bank_iban = coalesce(nullif(p ->> 'iban', ''), bank_iban)
   where id = p_partner;
  if nullif(p ->> 'address', '') is not null then
    select id into a from public.partner_addresses where partner_id = p_partner and deleted_at is null order by is_default desc, created_at limit 1;
    if a is null then
      insert into public.partner_addresses (company_id, partner_id, address_type, line1, country_code, is_default) values (bp.company_id, p_partner, 'billing', p ->> 'address', 'XK', true);
    else update public.partner_addresses set line1 = p ->> 'address' where id = a; end if;
  end if;
end $$;

-- the readers fill the supplier as they book
do $$ begin
  perform app._patch_function('public.doc_read_to_receipt',
    E'  v_vendor := nullif(p ->> ''vendor_id'', '''')::uuid;\n',
    E'  v_vendor := nullif(p ->> ''vendor_id'', '''')::uuid;\n  if v_vendor is not null then perform app.partner_fill_contact(v_vendor, app.read_contact(d.result)); end if;\n');
  perform app._patch_function('public.expense_book',
    E'  if v_number is not null and exists (select 1 from public.vendor_bills where company_id = v_co and vendor_id = v_vendor',
    E'  if d.id is not null then perform app.partner_fill_contact(v_vendor, app.read_contact(d.result)); end if;\n  if v_number is not null and exists (select 1 from public.vendor_bills where company_id = v_co and vendor_id = v_vendor');
  perform app._patch_function('public.asset_book',
    E'  perform public.activate_fixed_asset(v_asset, null);',
    E'  perform public.activate_fixed_asset(v_asset, null);\n  if d.id is not null then perform app.partner_fill_contact(v_bill.vendor_id, app.read_contact(d.result)); end if;');
  -- the review of an expense or an asset invoice shows what the invoice says that differs
  perform app._patch_function('app.expense_match',
    E'  return p || jsonb_build_object(''vendor_id'', v_vendor, ''vendor_match_name'', v_vname,',
    E'  return p || jsonb_build_object(''contact_diff'', case when v_vendor is not null then app.partner_contact_diff(v_vendor, app.read_contact(p)) end, ''vendor_id'', v_vendor, ''vendor_match_name'', v_vname,');
end $$;

-- the same comparison, without changing anything (for the review screens)
create or replace function app.partner_contact_diff(p_partner uuid, c jsonb)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'phone', case when bp.phone is not null and c ? 'phone' and regexp_replace(bp.phone, '\D', '', 'g') <> regexp_replace(c ->> 'phone', '\D', '', 'g') then jsonb_build_object('now', bp.phone, 'invoice', c ->> 'phone') end,
    'email', case when bp.email is not null and c ? 'email' and lower(bp.email) <> c ->> 'email' then jsonb_build_object('now', bp.email, 'invoice', c ->> 'email') end,
    'iban', case when bp.bank_iban is not null and c ? 'iban' and upper(replace(bp.bank_iban, ' ', '')) <> c ->> 'iban' then jsonb_build_object('now', bp.bank_iban, 'invoice', c ->> 'iban') end))
  from public.business_partners bp where bp.id = p_partner
$$;

-- ---------------------------------------------------------------------------------------------
-- "Ask for the details"
-- ---------------------------------------------------------------------------------------------
create table if not exists app.partner_info_requests (
  id           uuid primary key default gen_random_uuid(),
  token        text not null unique,
  company_id   uuid not null references public.companies(id) on delete cascade,
  partner_id   uuid not null references public.business_partners(id) on delete cascade,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '14 days',
  submitted_at timestamptz,
  data         jsonb
);
revoke all on app.partner_info_requests from public, anon, authenticated;

create or replace function public.partner_info_request(p_partner uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare bp public.business_partners; v_token text;
begin
  select * into bp from public.business_partners where id = p_partner and deleted_at is null;
  if bp.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform app.require_any_permission(bp.company_id, array['partners.write', 'sales.write', 'procurement.write']);
  -- one open link per partner: the same one is given again
  select token into v_token from app.partner_info_requests where partner_id = p_partner and submitted_at is null and expires_at > now() + interval '2 days' limit 1;
  if v_token is null then
    v_token := encode(extensions.gen_random_bytes(18), 'hex');
    insert into app.partner_info_requests (token, company_id, partner_id, created_by) values (v_token, bp.company_id, p_partner, auth.uid());
  end if;
  return (select jsonb_build_object('token', token, 'expires_at', expires_at, 'company', (select name from public.companies where id = bp.company_id),
            'partner', bp.name, 'email', bp.email, 'phone', bp.phone) from app.partner_info_requests where token = v_token);
end $$;

-- the public page: what the partner sees (only its own details)
create or replace function public.partner_info_form(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r app.partner_info_requests; bp public.business_partners; a public.partner_addresses; c public.partner_contacts;
begin
  select * into r from app.partner_info_requests where token = p_token;
  if r.id is null then raise exception 'This link is not valid' using errcode = 'P0002'; end if;
  if r.submitted_at is not null then return jsonb_build_object('done', true, 'company', (select name from public.companies where id = r.company_id)); end if;
  if r.expires_at < now() then raise exception 'This link has expired; ask for a new one' using errcode = '22023'; end if;
  select * into bp from public.business_partners where id = r.partner_id;
  select * into a from public.partner_addresses where partner_id = bp.id and deleted_at is null order by is_default desc, created_at limit 1;
  select * into c from public.partner_contacts where partner_id = bp.id and deleted_at is null order by is_primary desc, created_at limit 1;
  return jsonb_build_object('done', false, 'company', (select name from public.companies where id = r.company_id),
    'name', bp.name, 'legal_name', bp.legal_name, 'tax_number', bp.tax_number, 'vat_number', bp.vat_number, 'email', bp.email, 'phone', bp.phone,
    'iban', bp.bank_iban, 'website', bp.website, 'address', a.line1, 'city', a.city, 'postal_code', a.postal_code,
    'contact_name', c.name, 'contact_phone', c.phone, 'contact_email', c.email);
end $$;

create or replace function public.partner_info_submit(p_token text, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare r app.partner_info_requests; v_addr uuid; v_contact uuid; s jsonb := '{}'; k text;
begin
  select * into r from app.partner_info_requests where token = p_token for update;
  if r.id is null then raise exception 'This link is not valid' using errcode = 'P0002'; end if;
  if r.submitted_at is not null then raise exception 'The details were sent already. Thank you!' using errcode = '23505'; end if;
  if r.expires_at < now() then raise exception 'This link has expired; ask for a new one' using errcode = '22023'; end if;
  -- only these fields, trimmed and short
  foreach k in array array['legal_name', 'vat_number', 'email', 'phone', 'iban', 'website', 'address', 'city', 'postal_code', 'contact_name', 'contact_phone', 'contact_email'] loop
    if nullif(btrim(p ->> k), '') is not null then s := s || jsonb_build_object(k, left(btrim(p ->> k), 200)); end if;
  end loop;
  if s ? 'email' and s ->> 'email' !~* '^[^@\s]+@[^@\s]+\.[a-z]{2,}$' then raise exception 'Check the e-mail address' using errcode = '22023'; end if;
  if s ? 'iban' then s := s || jsonb_build_object('iban', upper(regexp_replace(s ->> 'iban', '\s', '', 'g'))); end if;
  update public.business_partners set legal_name = coalesce(s ->> 'legal_name', legal_name), vat_number = coalesce(s ->> 'vat_number', vat_number),
         email = coalesce(s ->> 'email', email), phone = coalesce(s ->> 'phone', phone), bank_iban = coalesce(s ->> 'iban', bank_iban), website = coalesce(s ->> 'website', website)
   where id = r.partner_id;
  if s ? 'address' or s ? 'city' then
    select id into v_addr from public.partner_addresses where partner_id = r.partner_id and deleted_at is null order by is_default desc, created_at limit 1;
    if v_addr is null then
      insert into public.partner_addresses (company_id, partner_id, address_type, line1, city, postal_code, country_code, is_default)
      values (r.company_id, r.partner_id, 'billing', coalesce(s ->> 'address', s ->> 'city'), s ->> 'city', s ->> 'postal_code', 'XK', true);
    else
      update public.partner_addresses set line1 = coalesce(s ->> 'address', line1), city = coalesce(s ->> 'city', city), postal_code = coalesce(s ->> 'postal_code', postal_code) where id = v_addr;
    end if;
  end if;
  if s ? 'contact_name' then
    select id into v_contact from public.partner_contacts where partner_id = r.partner_id and deleted_at is null and lower(name) = lower(s ->> 'contact_name') limit 1;
    if v_contact is null then
      insert into public.partner_contacts (company_id, partner_id, name, phone, email, is_primary)
      values (r.company_id, r.partner_id, s ->> 'contact_name', s ->> 'contact_phone', s ->> 'contact_email',
              not exists (select 1 from public.partner_contacts where partner_id = r.partner_id and deleted_at is null and is_primary));
    else
      update public.partner_contacts set phone = coalesce(s ->> 'contact_phone', phone), email = coalesce(s ->> 'contact_email', email) where id = v_contact;
    end if;
  end if;
  update app.partner_info_requests set submitted_at = now(), data = s where id = r.id;
  perform app.notify_permission(r.company_id, 'partners.read', 'info', format('%s sent their details', (select name from public.business_partners where id = r.partner_id)),
    'Address, phone and e-mail are on the partner card now.', '/partners/' || r.partner_id);
end $$;

revoke all on function public.partner_info_request(uuid), public.partner_contact_apply(uuid, jsonb) from public, anon;
grant execute on function public.partner_info_request(uuid), public.partner_contact_apply(uuid, jsonb) to authenticated;
revoke all on function public.partner_info_form(text), public.partner_info_submit(text, jsonb) from public;
grant execute on function public.partner_info_form(text), public.partner_info_submit(text, jsonb) to anon, authenticated;
revoke all on function app.partner_fill_contact(uuid, jsonb), app.partner_contact_diff(uuid, jsonb) from public;

drop function app._patch_function(text, text, text);
