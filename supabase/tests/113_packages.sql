-- =============================================================================
-- Packages by business: the Super Admin creates a Mini market with its modules and limits; what is
-- off is refused by the server; the till limit holds; the clients on the older plans keep everything.
-- (after 13 and 101: zoe@platform.io is the platform owner)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
set role authenticated;
select t.login('zoe@platform.io');

-- 1. a Mini market: the till, the safe, promotions; 1 unit, 2 tills, 4 users
select public.platform_create_client(jsonb_build_object(
  'name', 'Mini Market Arbëri', 'country', 'XK', 'owner_email', 'pronari@arberi.xk', 'owner_password', 'sekret123',
  'plan', 'package', 'business_type', 'retail', 'multi_unit', false, 'package', 'retail_mini',
  'modules', jsonb_build_array('pos', 'safe', 'promotions'), 'max_users', 4, 'max_stores', 1, 'max_tills', 2)) as mini \gset
reset role;
select t.ok((select plan = 'package' and package = 'retail_mini' and max_registers = 2 and max_warehouses = 1 and max_users = 4 from public.licenses where company_id = :'mini'),
  'the licence holds the package and its limits');
select t.ok(app.company_features(:'mini') @> array['pos', 'safe', 'promotions'] and not ('crm' = any (app.company_features(:'mini')))
            and not ('hr' = any (app.company_features(:'mini'))) and not ('restaurant' = any (app.company_features(:'mini'))),
  'the client has exactly the modules chosen');

-- 2. the owner may do everything, but not in a module that is off
set role authenticated;
select t.login('pronari@arberi.xk');
select t.ok(app.has_permission(:'mini', 'pos.write'), 'the till is there');
select t.ok(not app.has_permission(:'mini', 'crm.read'), 'leads and pipeline are refused');
select t.ok(not app.has_permission(:'mini', 'hr.read') and not app.has_permission(:'mini', 'manufacturing.read'), 'people and production are refused');
select t.ok(((public.get_my_context() -> 'companies' -> 0 -> 'license' ->> 'max_registers'))::int = 2, 'the program knows the till limit');

-- 3. the till limit
reset role;
select count(*) as tills from public.pos_registers where company_id = :'mini' and deleted_at is null and is_active \gset
insert into public.pos_registers (company_id, code, name, warehouse_id, location_id, cash_account_id, journal_id)
select :'mini', 'X' || g, 'Arka ' || g, w.id, (select l.id from public.warehouse_locations l where l.warehouse_id = w.id order by l.created_at limit 1),
       (select b.id from public.bank_accounts b where b.company_id = :'mini' and b.account_kind = 'cash' limit 1), null
  from public.warehouses w, generate_series(1, 2 - :'tills'::int) g where w.company_id = :'mini' and w.warehouse_type = 'store';
select t.throws(format($q$insert into public.pos_registers (company_id, code, name, warehouse_id, location_id, cash_account_id)
  select %L, 'X9', 'Arka 9', w.id, (select l.id from public.warehouse_locations l where l.warehouse_id = w.id order by l.created_at limit 1),
         (select b.id from public.bank_accounts b where b.company_id = %L and b.account_kind = 'cash' limit 1)
    from public.warehouses w where w.company_id = %L and w.warehouse_type = 'store'$q$, :'mini', :'mini', :'mini'), 'allows 2 till', 'a third till is refused');

-- 4. later: the Super Admin adds a module; a limit under what the client uses is refused
set role authenticated;
select t.login('zoe@platform.io');
select public.platform_set_package(:'mini', '{"package": "retail_mini", "modules": ["pos", "safe", "promotions", "crm"], "max_stores": 1, "max_tills": 2, "max_users": 4}');
select t.throws(format($q$select public.platform_set_package(%L, '{"package": "retail_mini", "modules": ["pos"], "max_tills": 1}')$q$, :'mini'), 'already has 2 tills', 'a till limit under the tills it has is refused');
select t.throws(format($q$select public.platform_set_package(%L, '{"package": "nonsense"}')$q$, :'mini'), 'Unknown package', 'an unknown package is refused');
select t.login('pronari@arberi.xk');
select t.ok(app.has_permission(:'mini', 'crm.read'), 'added: leads and pipeline open');
select t.throws(format($q$select public.platform_set_package(%L, '{"package": "general", "modules": ["hr"]}')$q$, :'mini'), 'platform administrator', 'the client cannot change his own package');

-- 5. the clients on the older plans keep everything they had
reset role;
select t.ok((select bool_and(app.company_features(l.company_id) @> array['pos', 'safe', 'quotes', 'crm', 'purchase_orders']) from public.licenses l where l.plan <> 'package'),
  'an older plan has the finer modules too');

\set QUIET off
select count(*) as assertions_passed from t.results;
