-- =============================================================================
-- NexusERP Pro · what each plan includes
--   Basic     one store: till, stock, buying and selling, VAT, cash and bank
--   Standard  + transfers between stores, full accounting, restaurant, imports, approvals, people & payroll
--   Pro       + advanced warehouse, production, logistics, web shop, live link with the old program
-- The platform owner can add single modules to a client (licenses.extra_features) and change
-- the store limit (licenses.max_warehouses). Enforced here, not only by hiding the menu:
--   * whole modules (production, logistics, people, web shop) through the permission check
--   * the other features at the functions that do their work
-- =============================================================================

alter table public.licenses
  add column extra_features text[] not null default '{}',
  add column max_warehouses int check (max_warehouses is null or max_warehouses > 0);
grant select (extra_features, max_warehouses) on public.licenses to authenticated;

create or replace function app.plan_features(p_plan text)
returns text[] language sql immutable set search_path = '' as $$
  select case p_plan
    when 'basic' then '{}'::text[]
    when 'standard' then array['transfers', 'accounting', 'restaurant', 'imports', 'approvals', 'hr']
    else array['transfers', 'accounting', 'restaurant', 'imports', 'approvals', 'hr',
               'wms', 'manufacturing', 'logistics', 'ecommerce', 'livesync']   -- pro, trial
  end
$$;

create or replace function app.plan_max_warehouses(p_plan text)
returns int language sql immutable set search_path = '' as $$
  select case p_plan when 'basic' then 1 when 'standard' then 5 else null end
$$;

-- the features a company has (plan + extra modules)
create or replace function app.company_features(p_company uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce((select array(select distinct f from unnest(app.plan_features(l.plan) || l.extra_features) f order by f)
                     from public.licenses l where l.company_id = p_company), app.plan_features('pro'))
$$;

create or replace function app.has_feature(p_company uuid, p_feature text)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_feature = any (app.company_features(p_company))
$$;

create or replace function app.require_feature(p_company uuid, p_feature text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.has_feature(p_company, p_feature) then
    raise exception 'This is not in your plan (%)', p_feature using errcode = '42501', hint = 'feature:' || p_feature;
  end if;
end $$;

-- whole modules: a permission of a module outside the plan is not granted
-- (recipes are bills of materials, so the restaurant also opens the production tables)
create or replace function app.module_allowed(p_plan text, p_extra text[], p_module text)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when p_module = 'manufacturing' then ('manufacturing' = any (app.plan_features(p_plan) || p_extra)) or ('restaurant' = any (app.plan_features(p_plan) || p_extra))
    when p_module = 'logistics' then 'logistics' = any (app.plan_features(p_plan) || p_extra)
    when p_module in ('hr', 'payroll') then 'hr' = any (app.plan_features(p_plan) || p_extra)
    when p_module in ('ecommerce', 'oms') then 'ecommerce' = any (app.plan_features(p_plan) || p_extra)
    else true end
$$;

create or replace function app.company_ids_with(p_perm text)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select case when app.is_super_admin()
    then (select coalesce(array_agg(c.id), '{}') from public.companies c where c.deleted_at is null)
    else (
      select coalesce(array_agg(distinct m.company_id), '{}')
        from public.company_members m
        join public.companies c        on c.id = m.company_id and c.deleted_at is null
        join public.licenses l         on l.company_id = c.id and l.status = 'active'
                                      and current_date between l.valid_from and l.valid_until
                                      and app.module_allowed(l.plan, l.extra_features, split_part(p_perm, '.', 1))
        join public.member_roles mr    on mr.member_id = m.id and mr.company_id = m.company_id
        join public.role_permissions rp on rp.role_id = mr.role_id
       where m.user_id = auth.uid()
         and m.status = 'active'
         and rp.permission in (p_perm,
                               split_part(p_perm, '.', 1) || '.*',
                               '*.' || split_part(p_perm, '.', 2),
                               '*'))
  end
$$;

-- the other features: checked right after each function's own permission check
do $$
declare r record; v_def text; v_new text;
begin
  for r in select * from (values
      ('activate_fixed_asset', 'accounting'), ('dispose_fixed_asset', 'accounting'), ('reconcile_statement', 'accounting'),
      ('reverse_journal_entry', 'accounting'),
      ('create_pick_list', 'wms'), ('confirm_pick', 'wms'), ('complete_pick_list', 'wms'), ('create_putaway_task', 'wms'),
      ('save_approval_workflow', 'approvals'),
      ('ship_stock_transfer', 'transfers'),
      ('post_landed_cost', 'imports'),
      ('restaurant_open', 'restaurant')) x(fn, feature)
  loop
    select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    v_new := regexp_replace(v_def, '(perform app\.require_permission\(([^,]+), ''[^'']+''\);)',
                            '\1' || E'\n  ' || 'perform app.require_feature(\2, ''' || r.feature || ''');');
    if v_new = v_def then raise exception 'feature gate for % does not apply', r.fn; end if;
    execute v_new;
  end loop;
end $$;

-- the live link: the agent of a company without it is refused
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;
select app._patch_function('app.sync_connection',
  $x$  if not app.license_ok(c.company_id) then raise exception 'The licence for this company is not active' using errcode = '42501'; end if;$x$,
  $x$  if not app.license_ok(c.company_id) then raise exception 'The licence for this company is not active' using errcode = '42501'; end if;
  perform app.require_feature(c.company_id, 'livesync');$x$);
-- the app learns what the plan includes
select app._patch_function('public.get_my_context',
  $x$'license', (select jsonb_build_object('plan', l.plan, 'max_users', l.max_users, 'valid_until', l.valid_until)$x$,
  $x$'license', (select jsonb_build_object('plan', l.plan, 'max_users', l.max_users, 'valid_until', l.valid_until,
                                           'features', app.company_features(l.company_id),
                                           'max_warehouses', coalesce(l.max_warehouses, app.plan_max_warehouses(l.plan)))$x$);
-- a company made without choosing a plan starts with everything (the platform form always chooses)
select app._patch_function('public.create_company',
  $x$values (v_company, case when v_platform then 'standard' else 'trial' end,$x$,
  $x$values (v_company, case when v_platform then 'pro' else 'trial' end,$x$);
select app._patch_function('public.platform_clients',
  $x$'plan', l.plan, 'max_users', l.max_users,$x$,
  $x$'plan', l.plan, 'max_users', l.max_users, 'extra_features', l.extra_features, 'max_warehouses', l.max_warehouses,$x$);
select app._patch_function('public.platform_create_client',
  $x$values (v_company, coalesce(nullif(btrim(p ->> 'plan'), ''), 'standard'),$x$,
  $x$values (v_company, coalesce(nullif(btrim(p ->> 'plan'), ''), 'pro'),$x$);
drop function app._patch_function(text, text, text);

-- stores and warehouses within the plan (goods on the road do not count)
create or replace function app.tg_warehouse_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_max int; v_n int;
begin
  if new.warehouse_type = 'transit' then return new; end if;
  select coalesce(l.max_warehouses, app.plan_max_warehouses(l.plan)) into v_max from public.licenses l where l.company_id = new.company_id;
  if v_max is null then return new; end if;
  select count(*) into v_n from public.warehouses
   where company_id = new.company_id and deleted_at is null and is_active and warehouse_type <> 'transit';
  if v_n >= v_max then
    raise exception 'Your plan allows % store(s) or warehouse(s); ask your provider for more', v_max using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_04_warehouse_limit before insert on public.warehouses
  for each row execute function app.tg_warehouse_limit();

-- Clients made before plans meant anything keep everything (their "standard" was only a label);
-- the platform owner moves each one to its real plan. A licence written without a plan is Pro.
update public.licenses set plan = 'pro' where plan = 'standard';
alter table public.licenses alter column plan set default 'pro';

-- the platform saves the plan with its extra modules and store limit
create or replace function public.platform_set_plan_extras(p_company uuid, p_extra text[], p_max_warehouses int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  update public.licenses
     set extra_features = coalesce((select array_agg(distinct f order by f) from unnest(coalesce(p_extra, '{}')) f
                                     where f in ('transfers', 'accounting', 'restaurant', 'imports', 'approvals', 'hr',
                                                 'wms', 'manufacturing', 'logistics', 'ecommerce', 'livesync')), '{}'),
         max_warehouses = p_max_warehouses
   where company_id = p_company;
  if not found then raise exception 'Company not found' using errcode = 'P0002'; end if;
end $$;
revoke execute on function public.platform_set_plan_extras(uuid, text[], int) from public, anon;
grant execute on function public.platform_set_plan_extras(uuid, text[], int) to authenticated;
