-- =============================================================================
-- DrisPRO · a price for each package; nobody opens a company on his own
--   * the Super Admin's price list holds every package (Mini market, Café, Hotel…) next to the older
--     plans; the overview counts the income of package clients by their package
--   * open sign-up is gone: only the Super Admin creates companies (the switch is refused)
-- =============================================================================

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;   -- already done
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- ---------------------------------------------------------------- the packages in the price list
create or replace function app.price_keys() returns text[] language sql immutable set search_path = '' as $$
  select array['basic', 'standard', 'pro', 'retail_mini', 'retail_market', 'retail_chain', 'cafe', 'restaurant', 'hotel', 'wholesale', 'manufacturing',
               'services', 'beauty', 'clinic', 'auto_service', 'fitness', 'general']
$$;
alter table app.public_pricing drop constraint if exists public_pricing_plan_check;
alter table app.public_pricing add constraint public_pricing_plan_check check (plan = any (app.price_keys()));
insert into app.public_pricing (plan, users)
select k, coalesce((app.package_info(k) ->> 'users')::int, 1) from unnest(app.price_keys()) k where app.package_info(k) is not null
on conflict (plan) do nothing;

create or replace function public.public_pricing()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_super_admin() then raise exception 'Only the platform administrator sees the prices' using errcode = '42501'; end if;
  return jsonb_build_object(
    'plans', (select jsonb_agg(jsonb_build_object('plan', p.plan, 'package', app.package_info(p.plan) is not null,
                'price_month', p.price_month, 'price_year', p.price_year, 'per_user', p.per_user, 'users', p.users,
                'highlight', p.highlight, 'note', p.note, 'features', app.plan_features(p.plan), 'stores', app.plan_max_warehouses(p.plan), 'ai_reads', app.plan_ai_reads(p.plan))
                order by array_position(app.price_keys(), p.plan)) from app.public_pricing p),
    'contact', (select jsonb_build_object('email', email, 'phone', phone, 'whatsapp', whatsapp, 'currency', currency, 'vat_note', vat_note) from app.public_contact));
end $$;
revoke execute on function public.public_pricing() from public, anon;
grant execute on function public.public_pricing() to authenticated;

-- the overview: a package client is priced and counted by his package
select app._patch_function('public.platform_overview',
  $x$c.created_at, l.plan, l.max_users,$x$,
  $x$c.created_at, coalesce(l.package, l.plan) as plan, l.max_users,$x$);
select app._patch_function('public.platform_overview',
  $x$left join app.public_pricing p on p.plan = l.plan$x$,
  $x$left join app.public_pricing p on p.plan = coalesce(l.package, l.plan)$x$);

-- ---------------------------------------------------------------- only the Super Admin creates companies
update public.platform_settings set self_service = false, updated_at = now() where self_service;
create or replace function public.platform_set_self_service(p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  if p_on then raise exception 'Only the platform administrator creates companies; open sign-up is not offered' using errcode = '42501'; end if;
  update public.platform_settings set self_service = false, updated_at = now() where id;
end $$;
revoke execute on function public.platform_set_self_service(boolean) from public, anon;
grant execute on function public.platform_set_self_service(boolean) to authenticated;

drop function app._patch_function(text, text, text);
