-- =============================================================================
-- The Kosovo business register (ARBK) inside DrisPRO
--   The public register (arbk.rks-gov.net, open data) is loaded on the server: every registered,
--   passive or dissolved business with its NUI, official and trade name, legal form, activity,
--   town and status. Wherever a customer or a supplier is chosen, typing a NUI or a few letters
--   of a name finds it there too; picking it adds the partner with the official data.
--   Partners already in a company are checked against it every night: one that is dissolved or
--   made passive in the register is flagged to the people who work with it.
-- =============================================================================

create table if not exists public.business_registry (
  nui           text primary key,
  name          text not null,
  trade_name    text,
  legal_form    text,
  activity      text,
  sector        text,
  employees     int,
  size          text,
  city          text,
  status        text,             -- Regjistruar · Pasiv-dd/mm/yyyy · Shuar… as the register writes it
  registered    text,             -- year-month of registration
  dissolved_on  date,
  phone         text,
  email         text,
  address       text,
  source        text not null default 'arbk',
  updated_at    timestamptz not null default now()
);
alter table public.business_registry enable row level security;   -- read through the functions below only
revoke all on public.business_registry from anon, authenticated;
drop policy if exists business_registry_through_functions on public.business_registry;
create policy business_registry_through_functions on public.business_registry for select to authenticated using (false);
create index if not exists business_registry_name_trgm on public.business_registry using gin (name extensions.gin_trgm_ops);
create index if not exists business_registry_trade_trgm on public.business_registry using gin (trade_name extensions.gin_trgm_ops);
create index if not exists business_registry_name_prefix on public.business_registry (lower(name) text_pattern_ops);
create index if not exists business_registry_trade_prefix on public.business_registry (lower(trade_name) text_pattern_ops);

-- a load comes into this table first, then replaces what changed
create table if not exists app.business_registry_load (like public.business_registry including defaults);
alter table app.business_registry_load drop constraint if exists business_registry_load_pkey;
revoke all on app.business_registry_load from public, anon, authenticated;

create or replace function app.registry_active(p_status text)
returns boolean language sql immutable as $$ select coalesce(p_status, '') ilike 'Regjistruar%' or coalesce(p_status, '') ilike 'Aktiv%' $$;

-- what was loaded becomes the register (contact details found later are kept when the file has none)
create or replace function app.registry_apply()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n_new int; n_upd int;
begin
  delete from app.business_registry_load where coalesce(btrim(nui), '') = '' or coalesce(btrim(name), '') = '';
  with d as (select distinct on (nui) * from app.business_registry_load order by nui),
  up as (
    insert into public.business_registry as r (nui, name, trade_name, legal_form, activity, sector, employees, size, city, status, registered, dissolved_on, phone, email, address, source, updated_at)
    select btrim(nui), btrim(name), nullif(btrim(trade_name), ''), nullif(legal_form, ''), nullif(activity, ''), nullif(sector, ''), employees, nullif(size, ''),
           nullif(btrim(city), ''), nullif(status, ''), nullif(registered, ''), dissolved_on, nullif(phone, ''), nullif(email, ''), nullif(address, ''), coalesce(source, 'arbk'), now()
      from d
    on conflict (nui) do update set name = excluded.name, trade_name = excluded.trade_name, legal_form = excluded.legal_form, activity = excluded.activity,
      sector = excluded.sector, employees = excluded.employees, size = excluded.size, city = excluded.city, status = excluded.status, registered = excluded.registered,
      dissolved_on = excluded.dissolved_on, phone = coalesce(excluded.phone, r.phone), email = coalesce(excluded.email, r.email), address = coalesce(excluded.address, r.address),
      updated_at = now()
     where (r.name, r.trade_name, r.status, r.city, r.dissolved_on, r.legal_form) is distinct from (excluded.name, excluded.trade_name, excluded.status, excluded.city, excluded.dissolved_on, excluded.legal_form)
        or (excluded.phone is not null and excluded.phone is distinct from r.phone) or (excluded.email is not null and excluded.email is distinct from r.email)
    returning (xmax = 0) as inserted)
  select count(*) filter (where inserted), count(*) filter (where not inserted) into n_new, n_upd from up;
  truncate app.business_registry_load;
  perform app.registry_check_partners();
  return jsonb_build_object('new', n_new, 'changed', n_upd, 'total', (select count(*) from public.business_registry));
end $$;

-- ---------------------------------------------------------------------------------------------
-- finding a business
-- ---------------------------------------------------------------------------------------------
create or replace function app.registry_json(r public.business_registry)
returns jsonb language sql immutable as $$
  select jsonb_build_object('nui', r.nui, 'name', r.name, 'trade_name', r.trade_name, 'legal_form', r.legal_form, 'activity', r.activity, 'city', r.city,
    'status', r.status, 'active', app.registry_active(r.status), 'phone', r.phone, 'email', r.email, 'address', r.address, 'employees', r.employees)
$$;

create or replace function public.registry_search(p_q text, p_limit int default 8)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare q text := btrim(coalesce(p_q, '')); v jsonb;
begin
  if auth.uid() is null and current_user in ('authenticated', 'anon') then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if length(q) < 3 then return '[]'::jsonb; end if;
  if q ~ '^[0-9]{3,}$' then
    select coalesce(jsonb_agg(app.registry_json(r) order by app.registry_active(r.status) desc, r.nui), '[]') into v
      from (select * from public.business_registry where nui like q || '%' order by nui limit least(coalesce(p_limit, 8), 20)) r;
  else
    select coalesce(jsonb_agg(app.registry_json(x.b) order by x.rank), '[]') into v
      from (select b, (case when app.registry_active(b.status) then 0 else 1 end) * 10
                       - greatest(extensions.similarity(lower(b.name), lower(q)), extensions.similarity(lower(coalesce(b.trade_name, '')), lower(q))) as rank
              from public.business_registry b
             where b.nui in (select c.nui from (
                     (select nui from public.business_registry where lower(name) like lower(q) || '%' limit 100)
                     union
                     (select nui from public.business_registry where lower(trade_name) like lower(q) || '%' limit 100)
                     union
                     (select nui from public.business_registry where length(q) >= 4 and name ilike '%' || q || '%' limit 150)
                     union
                     (select nui from public.business_registry where length(q) >= 4 and trade_name ilike '%' || q || '%' limit 150)) c)
             order by rank limit least(coalesce(p_limit, 8), 20)) x;
  end if;
  return v;
end $$;

create or replace function public.registry_get(p_nui text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null and current_user in ('authenticated', 'anon') then raise exception 'Not authenticated' using errcode = '28000'; end if;
  return (select app.registry_json(r) from public.business_registry r where r.nui = regexp_replace(coalesce(p_nui, ''), '[^0-9]', '', 'g'));
end $$;

-- a partner from the register: the one with that NUI if the company has it, otherwise a new one
create or replace function public.partner_from_registry(p_company uuid, p_nui text, p_role text default 'customer')
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.business_registry; v_id uuid; v_vendor boolean := p_role = 'vendor';
begin
  perform app.require_any_permission(p_company, array['partners.write', 'sales.write', 'invoicing.write', 'procurement.write']);
  select * into r from public.business_registry where nui = regexp_replace(coalesce(p_nui, ''), '[^0-9]', '', 'g');
  if r.nui is null then raise exception 'NUI % is not in the business register', p_nui using errcode = 'P0002'; end if;
  select id into v_id from public.business_partners
   where company_id = p_company and deleted_at is null and regexp_replace(coalesce(tax_number, ''), '[^0-9]', '', 'g') = r.nui
   order by created_at limit 1;
  if v_id is not null then
    update public.business_partners set is_vendor = is_vendor or v_vendor, is_customer = is_customer or not v_vendor,
           phone = coalesce(phone, r.phone), email = coalesce(email, r.email), legal_name = coalesce(legal_name, r.name)
     where id = v_id;
    return v_id;
  end if;
  insert into public.business_partners (company_id, code, name, legal_name, tax_number, phone, email, is_vendor, is_customer, notes)
  values (p_company, public.next_partner_code(p_company, case when v_vendor then 'vendor' else 'customer' end),
          coalesce(r.trade_name, r.name), r.name, r.nui, r.phone, r.email, v_vendor, not v_vendor,
          concat_ws(' · ', r.legal_form, r.activity))
  returning id into v_id;
  if r.city is not null or r.address is not null then
    insert into public.partner_addresses (company_id, partner_id, address_type, line1, city, country_code, is_default)
    values (p_company, v_id, 'billing', coalesce(r.address, r.city), r.city, 'XK', true);
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------
-- partners that closed: told to the people who sell to them or buy from them
-- ---------------------------------------------------------------------------------------------
create table if not exists app.registry_partner_flags (
  partner_id uuid primary key references public.business_partners(id) on delete cascade,
  status     text,
  flagged_at timestamptz not null default now()
);
revoke all on app.registry_partner_flags from public, anon, authenticated;

create or replace function app.registry_check_partners()
returns int language plpgsql security definer set search_path = '' as $$
declare p record; n int := 0;
begin
  for p in select bp.id, bp.company_id, bp.name, bp.is_vendor, r.status
             from public.business_partners bp
             join public.business_registry r on r.nui = regexp_replace(coalesce(bp.tax_number, ''), '[^0-9]', '', 'g')
             left join app.registry_partner_flags f on f.partner_id = bp.id
            where bp.deleted_at is null and not app.registry_active(r.status) and f.status is distinct from r.status loop
    insert into app.registry_partner_flags (partner_id, status) values (p.id, p.status)
    on conflict (partner_id) do update set status = excluded.status, flagged_at = now();
    perform app.notify_permission(p.company_id, case when p.is_vendor then 'procurement.read' else 'sales.read' end, 'warning',
      format('%s is %s in the business register', p.name, p.status), 'Check before selling on credit or paying in advance.', '/partners/' || p.id);
    n := n + 1;
  end loop;
  -- back to active: the flag goes
  delete from app.registry_partner_flags f using public.business_partners bp, public.business_registry r
   where bp.id = f.partner_id and r.nui = regexp_replace(coalesce(bp.tax_number, ''), '[^0-9]', '', 'g') and app.registry_active(r.status);
  return n;
end $$;

-- the register as the screens of a partner see it
create or replace function public.partner_registry(p_partner uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare bp public.business_partners;
begin
  select * into bp from public.business_partners where id = p_partner;
  if bp.id is null or not app.has_permission(bp.company_id, 'core.read') then return null; end if;
  return (select app.registry_json(r) || jsonb_build_object('updated_at', r.updated_at)
            from public.business_registry r where r.nui = regexp_replace(coalesce(bp.tax_number, ''), '[^0-9]', '', 'g'));
end $$;

-- the AI reading an invoice: a seller found by NUI in the register gets its official name
do $$ begin
  if exists (select 1 from pg_proc where proname = 'expense_book' and pronamespace = 'public'::regnamespace) then
    execute replace(pg_get_functiondef('public.expense_book'::regproc),
      E'values (v_co, public.next_partner_code(v_co, ''vendor''), btrim(p ->> ''vendor_name''),',
      E'values (v_co, public.next_partner_code(v_co, ''vendor''), coalesce((select coalesce(r.trade_name, r.name) from public.business_registry r where r.nui = regexp_replace(coalesce(p ->> ''vendor_tax_number'', ''''), ''[^0-9]'', '''', ''g'')), btrim(p ->> ''vendor_name'')),');
  end if;
end $$;

revoke all on function public.registry_search(text, int), public.registry_get(text), public.partner_from_registry(uuid, text, text), public.partner_registry(uuid) from public, anon;
grant execute on function public.registry_search(text, int), public.registry_get(text), public.partner_from_registry(uuid, text, text), public.partner_registry(uuid) to authenticated;
revoke all on function app.registry_apply(), app.registry_check_partners() from public;
