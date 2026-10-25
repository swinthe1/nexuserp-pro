-- =============================================================================
-- DrisPRO · type of business per client
-- The platform administrator picks what the client is (shop, café, restaurant,
-- wholesaler, manufacturer, services). The type switches off the parts of the menu
-- that business does not use; the client's admin can switch them back on under
-- Company settings → Menu. Later modules (restaurant tables, kitchen) key off it.
-- =============================================================================
alter table public.companies add column if not exists business_type text not null default 'general';
alter table public.companies drop constraint if exists companies_business_type_check;
alter table public.companies add constraint companies_business_type_check
  check (business_type in ('general', 'retail', 'cafe', 'restaurant', 'wholesale', 'manufacturing', 'services'));

-- menu sections (labels of src/app/nav.ts) each type starts without
create or replace function app.business_type_hidden_menu(p_type text)
returns text[] language sql immutable set search_path = '' as $$
  select case p_type
    when 'retail'        then array['Manufacturing', 'Logistics']
    when 'cafe'          then array['Sales & CRM', 'Warehouse|menu', 'Manufacturing', 'Logistics']
    when 'restaurant'    then array['Sales & CRM', 'Warehouse|menu', 'Manufacturing', 'Logistics']
    when 'wholesale'     then array['Retail', 'Manufacturing']
    when 'manufacturing' then array['Retail']
    when 'services'      then array['Inventory|menu', 'Warehouse|menu', 'Retail', 'Manufacturing', 'Logistics']
    else array[]::text[] end
$$;

create or replace function public.platform_set_business_type(p_company uuid, p_type text, p_apply_menu boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  if p_type is null or p_type not in ('general', 'retail', 'cafe', 'restaurant', 'wholesale', 'manufacturing', 'services') then
    raise exception 'Unknown type of business' using errcode = '23514';
  end if;
  update public.companies set business_type = p_type where id = p_company and deleted_at is null;
  if not found then raise exception 'Client not found' using errcode = 'P0002'; end if;
  if p_apply_menu then
    update public.company_settings set hidden_menu_sections = app.business_type_hidden_menu(p_type) where company_id = p_company;
  end if;
end $$;
revoke execute on function public.platform_set_business_type(uuid, text, boolean) from public, anon;
grant execute on function public.platform_set_business_type(uuid, text, boolean) to authenticated;

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- a new client starts with the menu of its type
select app._patch_function('public.platform_create_client',
  $x$  return v_company;$x$,
  $x$  perform public.platform_set_business_type(v_company, coalesce(nullif(btrim(p ->> 'business_type'), ''), 'general'), true);
  return v_company;$x$);
select app._patch_function('public.platform_clients',
  $x$'created_at', c.created_at, 'is_training', c.is_training,$x$,
  $x$'created_at', c.created_at, 'is_training', c.is_training, 'business_type', c.business_type,$x$);
select app._patch_function('public.get_my_context',
  $x$'is_training', c.is_training,$x$,
  $x$'is_training', c.is_training, 'business_type', c.business_type,$x$);

drop function app._patch_function(text, text, text);
