-- =============================================================================
-- DrisPRO · 20261104000200 · ATK's units of measure and categories of goods and services
-- (ATK's lists "Njësitë Matëse" and "Kategoritë e mallrave dhe shërbimeve"): every coupon line carries
-- the ATK code of its unit (CP = copë, KGN, LTR…) and of its category (TT = të tjera, AU, PJA…).
-- =============================================================================

create or replace function app.atk_unit_codes() returns text[] language sql immutable set search_path = '' as $$
  select array['EA','CP','LTR','SEC','MIN','HUR','DAY','MON','ANN','KGB','KGN','TN','GRM','M4','UDH','KMT','LM','MTS','MTV','MSK','KWH',
               'NFJ','NFQ','PRQ','DP','OP','PRD','PAL','XBX','PK','SET']
$$;
create or replace function app.atk_type_codes() returns text[] language sql immutable set search_path = '' as $$
  select array['TT','UR','AU','VM','KO','AP','BM','PM','PP','PE','PS','PB','BB','KB','EE','PSE','SM','SJ','ST','SK','SMK','STR','PI','PT',
               'SEA','KS','MN','SHN','SDG','HT','SHB','STI','SHT','PBS','MPM','PPD','PPH','PPP','PPA','PHN','SHH','SUA','SHZ','PJA','PAL',
               'DUH','SHM','PRO','SFV','BSH','RPK','PTI']
$$;

alter table public.units_of_measure add column if not exists atk_unit text check (atk_unit is null or atk_unit = any (app.atk_unit_codes()));
alter table public.product_categories add column if not exists atk_type text check (atk_type is null or atk_type = any (app.atk_type_codes()));
alter table public.company_settings add column if not exists atk_default_type text not null default 'TT' check (atk_default_type = any (app.atk_type_codes()));

/** ATK's unit for one of DrisPRO's units, from its code (null when there is no sure match) */
create or replace function app.atk_unit_guess(p_code text) returns text language sql immutable set search_path = '' as $$
  select case lower(btrim(coalesce(p_code, '')))
    when 'pcs' then 'CP' when 'pc' then 'CP' when 'cope' then 'CP' when 'copë' then 'CP' when 'cp' then 'CP' when 'ea' then 'EA' when 'unit' then 'EA'
    when 'kg' then 'KGN' when 'g' then 'GRM' when 'gr' then 'GRM' when 't' then 'TN' when 'ton' then 'TN'
    when 'l' then 'LTR' when 'lt' then 'LTR' when 'ltr' then 'LTR'
    when 'm' then 'LM' when 'm2' then 'MTS' when 'm²' then 'MTS' when 'm3' then 'MTV' when 'm³' then 'MTV' when 'km' then 'KMT'
    when 'h' then 'HUR' when 'hr' then 'HUR' when 'min' then 'MIN' when 'day' then 'DAY' when 'd' then 'DAY' when 'month' then 'MON' when 'year' then 'ANN'
    when 'kwh' then 'KWH' when 'box' then 'XBX' when 'pack' then 'PK' when 'pk' then 'PK' when 'set' then 'SET' when 'pair' then 'PAL' when 'pr' then 'PAL'
    else null end
$$;
update public.units_of_measure set atk_unit = app.atk_unit_guess(code) where atk_unit is null and app.atk_unit_guess(code) is not null;

create or replace function app.tg_uom_atk_unit() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.atk_unit is null then new.atk_unit := app.atk_unit_guess(new.code); end if;
  return new;
end $$;
drop trigger if exists trg_06_atk_unit on public.units_of_measure;
create trigger trg_06_atk_unit before insert on public.units_of_measure for each row execute function app.tg_uom_atk_unit();

-- ----------------------------------------------------------------------------- what the till needs: the code of each item's unit and category
create or replace function public.atk_till(p_register uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.pos_registers; c public.companies; s public.company_settings; w public.warehouses;
begin
  select * into r from public.pos_registers where id = p_register;
  if r.id is null then raise exception 'Till not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'pos.read');
  select * into c from public.companies where id = r.company_id;
  select * into s from public.company_settings where company_id = r.company_id;
  select * into w from public.warehouses where id = r.warehouse_id;
  if c.country_code <> 'XK' or not s.fiscalization_enabled or not s.atk_sef_enabled or c.is_training then return jsonb_build_object('required', false); end if;
  return jsonb_build_object('required', true, 'env', s.fiscal_environment, 'nui', c.tax_number, 'business', coalesce(c.legal_name, c.name),
    'branch_id', w.atk_branch_id, 'pos_id', r.atk_pos_id, 'application_id', app.atk_application_id(s.fiscal_environment),
    'location', coalesce(nullif(w.city, ''), nullif(c.city, ''), w.name),
    'certified', r.atk_certificate is not null and r.atk_cert_env = s.fiscal_environment, 'public_key', r.atk_public_key,
    'last_seq', coalesce((select max((o.atk ->> 'seq')::bigint) from public.pos_orders o
                           where o.register_id = r.id and o.atk ->> 'env' = s.fiscal_environment and (o.atk ->> 'pos_id')::int = r.atk_pos_id), 0),
    'missing', app.atk_missing(r.id),
    'exempt_taxes', coalesce((select jsonb_agg(t.id) from public.tax_codes t where t.company_id = r.company_id and t.is_exempt), '[]'),
    'default_type', s.atk_default_type,
    -- only what differs from "CP" and from the company's category, so the list stays small
    'units', coalesce((select jsonb_object_agg(v.id, coalesce(u.atk_unit, app.atk_unit_guess(u.code), 'CP'))
                         from public.product_variants v join public.products p on p.id = v.product_id join public.units_of_measure u on u.id = p.uom_id
                        where p.company_id = r.company_id and p.deleted_at is null and coalesce(u.atk_unit, app.atk_unit_guess(u.code), 'CP') <> 'CP'), '{}'),
    'types', coalesce((select jsonb_object_agg(v.id, pc.atk_type)
                         from public.product_variants v join public.products p on p.id = v.product_id join public.product_categories pc on pc.id = p.category_id
                        where p.company_id = r.company_id and p.deleted_at is null and pc.atk_type is not null and pc.atk_type <> s.atk_default_type), '{}'));
end $$;

-- ----------------------------------------------------------------------------- the setup page
create or replace function public.atk_codes(p_company uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_any_permission(p_company, array['tax.read', 'pos.approve', 'admin.read']);
  return jsonb_build_object(
    'default_type', (select atk_default_type from public.company_settings where company_id = p_company),
    'units', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'code', u.code, 'name', u.name, 'atk_unit', u.atk_unit,
                                                          'items', (select count(*) from public.products p where p.uom_id = u.id and p.deleted_at is null)) order by u.name)
                         from public.units_of_measure u where u.company_id = p_company and u.deleted_at is null), '[]'),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', pc.id, 'name', pc.name, 'atk_type', pc.atk_type,
                                                               'items', (select count(*) from public.products p where p.category_id = pc.id and p.deleted_at is null)) order by pc.name)
                              from public.product_categories pc where pc.company_id = p_company and pc.deleted_at is null), '[]'));
end $$;

create or replace function public.atk_codes_save(p_company uuid, p_default_type text, p_units jsonb, p_categories jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare x jsonb;
begin
  if not app.atk_can(p_company, 'setup') then raise exception 'Only a manager with the tax rights sets the ATK numbers' using errcode = '42501'; end if;
  if p_default_type is not null then update public.company_settings set atk_default_type = p_default_type where company_id = p_company; end if;
  for x in select * from jsonb_array_elements(coalesce(p_units, '[]')) loop
    update public.units_of_measure set atk_unit = nullif(x ->> 'atk_unit', '') where id = (x ->> 'id')::uuid and company_id = p_company;
  end loop;
  for x in select * from jsonb_array_elements(coalesce(p_categories, '[]')) loop
    update public.product_categories set atk_type = nullif(x ->> 'atk_type', '') where id = (x ->> 'id')::uuid and company_id = p_company;
  end loop;
end $$;

do $$
declare f text;
begin
  foreach f in array array['public.atk_codes(uuid)', 'public.atk_codes_save(uuid,text,jsonb,jsonb)', 'public.atk_till(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
