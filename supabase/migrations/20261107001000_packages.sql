-- =============================================================================
-- DrisPRO · packages by business: what a client has is decided when the Super Admin creates it
--   A package is a type of business and its size ("Market · Mini market": 1 unit, 2 tills, 4 users).
--   It starts with the modules that business uses; the Super Admin adds or removes single modules.
--   The licence then holds exactly the modules the client has (licenses.plan = 'package', the
--   package in licenses.package, the modules in licenses.extra_features) and its limits: units,
--   tills (new) and users.
--   A module that is off: not in the menu, its pages do not open, and the server refuses it
--   (the till, CRM, production, logistics, people and payroll, web shop by their permissions;
--   the rest at the functions that do their work). The client's administrator can only hide
--   more for himself, never switch a module on.
--   Clients on the older plans (Basic, Standard, Pro) keep everything they have: the finer
--   modules added here are all in those plans.
-- =============================================================================

alter table public.licenses add column if not exists package text;
alter table public.licenses add column if not exists max_registers int;
alter table public.licenses drop constraint if exists licenses_max_registers_check;
alter table public.licenses add constraint licenses_max_registers_check check (max_registers is null or max_registers > 0);
grant select (package, max_registers) on public.licenses to authenticated;
comment on column public.licenses.package is 'the business package the client was set up with (plan = package); null on the older plans';
comment on column public.licenses.max_registers is 'how many tills the client may have (null = no limit)';

-- ----------------------------------------------------------------------------- the modules
-- the finer modules (in every older plan, so nothing changes for the clients on them)
create or replace function app.fine_modules() returns text[] language sql immutable set search_path = '' as $$
  select array['pos', 'safe', 'promotions', 'scales', 'purchase_orders', 'quotes', 'sales_orders', 'agents', 'price_lists', 'crm', 'hotel', 'appointments']
$$;
-- every module a licence can hold
create or replace function app.all_modules() returns text[] language sql immutable set search_path = '' as $$
  select array['transfers', 'accounting', 'restaurant', 'imports', 'approvals', 'hr', 'wms', 'manufacturing', 'logistics', 'ecommerce', 'livesync',
               'ai_reads', 'ai_assistant', 'whatsapp'] || app.fine_modules()
$$;

create or replace function app.plan_features(p_plan text)
returns text[] language sql immutable set search_path = '' as $$
  select case p_plan
    -- a package: the modules are the licence's own list
    when 'package' then '{}'::text[]
    when 'basic' then app.fine_modules()
    when 'standard' then array['transfers', 'accounting', 'restaurant', 'imports', 'approvals', 'hr'] || app.fine_modules()
    else array['transfers', 'accounting', 'restaurant', 'imports', 'approvals', 'hr',
               'wms', 'manufacturing', 'logistics', 'ecommerce', 'livesync'] || app.fine_modules()   -- pro, trial
  end
$$;
create or replace function app.plan_max_warehouses(p_plan text)
returns int language sql immutable set search_path = '' as $$
  select case p_plan when 'basic' then 1 when 'standard' then 5 else null end
$$;

-- whole modules by their permissions: a permission of a module that is off is not granted
create or replace function app.module_allowed(p_plan text, p_extra text[], p_module text)
returns boolean language sql immutable set search_path = '' as $$
  select case
    when p_module = 'manufacturing' then ('manufacturing' = any (app.plan_features(p_plan) || p_extra)) or ('restaurant' = any (app.plan_features(p_plan) || p_extra))
    when p_module = 'logistics' then 'logistics' = any (app.plan_features(p_plan) || p_extra)
    when p_module in ('hr', 'payroll') then 'hr' = any (app.plan_features(p_plan) || p_extra)
    when p_module in ('ecommerce', 'oms') then 'ecommerce' = any (app.plan_features(p_plan) || p_extra)
    -- the till: a shop's or a restaurant's
    when p_module = 'pos' then ('pos' = any (app.plan_features(p_plan) || p_extra)) or ('restaurant' = any (app.plan_features(p_plan) || p_extra))
    when p_module = 'crm' then 'crm' = any (app.plan_features(p_plan) || p_extra)
    else true end
$$;

-- ----------------------------------------------------------------------------- the packages
-- the type of business each package sets (the menu it starts with), and its limits
create or replace function app.package_info(p_package text)
returns jsonb language sql immutable set search_path = '' as $$
  select case p_package
    when 'retail_mini'   then '{"business_type": "retail", "stores": 1, "tills": 2, "users": 4}'
    when 'retail_market' then '{"business_type": "retail", "stores": 5, "tills": 10, "users": 15}'
    when 'retail_chain'  then '{"business_type": "retail", "stores": null, "tills": null, "users": 50}'
    when 'cafe'          then '{"business_type": "cafe", "stores": 1, "tills": 2, "users": 8}'
    when 'restaurant'    then '{"business_type": "restaurant", "stores": 1, "tills": 3, "users": 15}'
    when 'wholesale'     then '{"business_type": "wholesale", "stores": 3, "tills": 2, "users": 15}'
    when 'manufacturing' then '{"business_type": "manufacturing", "stores": 3, "tills": 1, "users": 20}'
    when 'services'      then '{"business_type": "services", "stores": 1, "tills": 1, "users": 10}'
    when 'hotel'         then '{"business_type": "hotel", "stores": 1, "tills": 3, "users": 15}'
    when 'beauty'        then '{"business_type": "beauty", "stores": 1, "tills": 1, "users": 6}'
    when 'clinic'        then '{"business_type": "clinic", "stores": 1, "tills": 1, "users": 10}'
    when 'auto_service'  then '{"business_type": "auto_service", "stores": 1, "tills": 1, "users": 8}'
    when 'fitness'       then '{"business_type": "fitness", "stores": 1, "tills": 2, "users": 8}'
    when 'general'       then '{"business_type": "general", "stores": null, "tills": null, "users": 25}'
  end::jsonb
$$;

-- the Super Admin sets the client's package, modules and limits (on creation, and at any time after)
create or replace function public.platform_set_package(p_company uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_pkg text := nullif(btrim(p ->> 'package'), ''); v_info jsonb; v_modules text[]; v_stores int; v_tills int; v_users int; v_n int;
begin
  perform app.require_super_admin();
  v_info := app.package_info(v_pkg);
  if v_info is null then raise exception 'Unknown package' using errcode = '23514'; end if;
  v_modules := coalesce((select array_agg(distinct m order by m) from jsonb_array_elements_text(coalesce(p -> 'modules', '[]'::jsonb)) m
                          where m = any (app.all_modules())), '{}');
  v_stores := case when p ? 'max_stores' then nullif(p ->> 'max_stores', '')::int else (v_info ->> 'stores')::int end;
  v_tills := case when p ? 'max_tills' then nullif(p ->> 'max_tills', '')::int else (v_info ->> 'tills')::int end;
  v_users := coalesce(nullif(p ->> 'max_users', '')::int, (v_info ->> 'users')::int, 5);
  -- a limit below what the client already has would lock him out of his own units and tills
  select count(*) into v_n from public.warehouses where company_id = p_company and deleted_at is null and is_active and warehouse_type <> 'transit';
  if v_stores is not null and v_n > v_stores then raise exception 'The client already has % units; keep the limit at least that high', v_n using errcode = '23514'; end if;
  select count(*) into v_n from public.pos_registers where company_id = p_company and deleted_at is null and is_active;
  if v_tills is not null and v_n > v_tills then raise exception 'The client already has % tills; keep the limit at least that high', v_n using errcode = '23514'; end if;
  update public.licenses set plan = 'package', package = v_pkg, extra_features = v_modules,
         max_warehouses = v_stores, max_registers = v_tills, max_users = v_users, updated_by = auth.uid(), updated_at = now()
   where company_id = p_company;
  if not found then raise exception 'Client not found' using errcode = 'P0002'; end if;
  -- the type of business: the menu the client starts with (only when asked: a change later keeps the client's own choices)
  if coalesce((p ->> 'apply_type')::boolean, false) then
    perform public.platform_set_business_type(p_company, v_info ->> 'business_type', true);
  end if;
end $$;
revoke execute on function public.platform_set_package(uuid, jsonb) from public, anon;
grant execute on function public.platform_set_package(uuid, jsonb) to authenticated;

-- a new client with a package: created as before, then the package set
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
select app._patch_function('public.platform_create_client',
  $x$  perform app.client_units(v_company, p);$x$,
  $x$  -- a package: its modules and limits (the units are created after, within its limit)
  if nullif(btrim(p ->> 'package'), '') is not null then
    perform public.platform_set_package(v_company, jsonb_build_object('package', p ->> 'package', 'modules', coalesce(p -> 'modules', '[]'::jsonb),
      'max_users', p -> 'max_users', 'apply_type', false)
      || case when p ? 'max_stores' then jsonb_build_object('max_stores', p -> 'max_stores') else '{}'::jsonb end
      || case when p ? 'max_tills' then jsonb_build_object('max_tills', p -> 'max_tills') else '{}'::jsonb end);
  end if;
  perform app.client_units(v_company, p);$x$);

-- the extra modules list accepts the finer ones too
select app._patch_function('public.platform_set_plan_extras',
  $x$                                     where f in ('transfers', 'accounting', 'restaurant', 'imports', 'approvals', 'hr',
                                                 'wms', 'manufacturing', 'logistics', 'ecommerce', 'livesync',
                                                 'ai_reads', 'ai_assistant', 'whatsapp')), '{}'),$x$,
  $x$                                     where f = any (app.all_modules())), '{}'),$x$);

-- the person's context: the package and the till limit
select app._patch_function('public.get_my_context',
  $x$'max_warehouses', coalesce(l.max_warehouses, app.plan_max_warehouses(l.plan)))$x$,
  $x$'max_warehouses', coalesce(l.max_warehouses, app.plan_max_warehouses(l.plan)), 'package', l.package, 'max_registers', l.max_registers)$x$);

-- a local server gets the package and the till limit with its licence
select app._patch_function('app.licence_payload',
  $x$'extra_features', to_jsonb(l.extra_features), 'max_warehouses', l.max_warehouses,$x$,
  $x$'extra_features', to_jsonb(l.extra_features), 'max_warehouses', l.max_warehouses, 'package', l.package, 'max_registers', l.max_registers,$x$);
select app._patch_function('app.apply_licence',
  $x$    max_warehouses = excluded.max_warehouses, code = excluded.code, updated_at = now();$x$,
  $x$    max_warehouses = excluded.max_warehouses, code = excluded.code, updated_at = now();
  update public.licenses set package = nullif(p ->> 'package', ''), max_registers = nullif(p ->> 'max_registers', '')::int where company_id = v_co;$x$);
drop function app._patch_function(text, text, text);

-- the store limit's message speaks of the licence, not a plan
create or replace function app.tg_warehouse_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_max int; v_n int;
begin
  if new.warehouse_type = 'transit' then return new; end if;
  select coalesce(l.max_warehouses, app.plan_max_warehouses(l.plan)) into v_max from public.licenses l where l.company_id = new.company_id;
  if v_max is null then return new; end if;
  select count(*) into v_n from public.warehouses
   where company_id = new.company_id and deleted_at is null and is_active and warehouse_type <> 'transit' and id is distinct from new.id;
  if v_n >= v_max then
    raise exception 'Your plan allows % store(s) or warehouse(s); ask your provider for more', v_max using errcode = '42501';
  end if;
  return new;
end $$;

-- ----------------------------------------------------------------------------- the till limit
create or replace function app.tg_register_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_max int; v_n int;
begin
  if not new.is_active or new.deleted_at is not null then return new; end if;
  if tg_op = 'UPDATE' and old.is_active and old.deleted_at is null then return new; end if;
  select l.max_registers into v_max from public.licenses l where l.company_id = new.company_id;
  if v_max is null then return new; end if;
  select count(*) into v_n from public.pos_registers where company_id = new.company_id and deleted_at is null and is_active and id <> new.id;
  if v_n >= v_max then
    raise exception 'Your licence allows % till(s); ask your provider for more', v_max using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_05_register_limit on public.pos_registers;
create trigger trg_05_register_limit before insert or update of is_active, deleted_at on public.pos_registers
  for each row execute function app.tg_register_limit();

-- the console's list of clients: the package, the till limit, the tills it has, the modules it really has
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
select app._patch_function('public.platform_clients',
  $x$'max_warehouses', l.max_warehouses, 'valid_from'$x$,
  $x$'max_warehouses', l.max_warehouses, 'package', l.package, 'max_registers', l.max_registers,
               'tills', (select count(*) from public.pos_registers r where r.company_id = c.id and r.deleted_at is null and r.is_active),
               'modules', to_jsonb(app.company_features(c.id)), 'valid_from'$x$);
drop function app._patch_function(text, text, text);

notify pgrst, 'reload schema';
