-- =============================================================================
-- DrisPRO · the manager's panel: sales against the target, customers, average receipt, margin,
-- losses, stock turnover, sales per hour worked, voids and cash differences (runs after 01–64)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
insert into auth.users (email, raw_user_meta_data) values ('kpi.cashier@kt.al', '{"full_name":"Kaltrina Arkëtare"}'), ('kpi.boss2@kt.al', '{"full_name":"Driton Përgjegjës"}')
on conflict do nothing;

select email as boss from public.profiles where is_super_admin limit 1 \gset
set role authenticated;
select t.login(:'boss');
select public.create_company('KPI Test', 'XK') as co \gset
select public.invite_member(:'co', 'kpi.cashier@kt.al', array['pos_cashier']);
select public.invite_member(:'co', 'kpi.boss2@kt.al', array['store_manager']);
select t.accept_invites();
select t.login(:'boss');
select id as shop from public.warehouses where company_id = :'co' order by created_at limit 1 \gset
select id as floor from public.warehouse_locations where company_id = :'co' and warehouse_id = :'shop' order by created_at limit 1 \gset
select id as pcs from public.units_of_measure where company_id = :'co' and code = 'pcs' \gset
insert into public.warehouses (company_id, code, name) values (:'co', 'D2', 'Dyqani 2') returning id as shop2 \gset
insert into public.warehouse_locations (company_id, warehouse_id, code, name) values (:'co', :'shop2', 'D2-1', 'Rafti') returning id as floor2 \gset
insert into public.bank_accounts (company_id, name, account_kind, currency_code, account_id)
select :'co', 'Arka K1', 'cash', 'EUR', id from public.accounts where company_id = :'co' and code = '5311' returning id as drawer \gset
insert into public.pos_registers (company_id, code, name, warehouse_id, location_id, cash_account_id, journal_id)
select :'co', 'K1', 'Arka 1', :'shop', :'floor', :'drawer', id from public.journals where company_id = :'co' and code = 'POS' returning id as reg \gset
insert into public.pos_registers (company_id, code, name, warehouse_id, location_id, cash_account_id, journal_id)
select :'co', 'K2', 'Arka 2', :'shop2', :'floor2', :'drawer', id from public.journals where company_id = :'co' and code = 'POS' returning id as reg2 \gset

select public.create_product(jsonb_build_object('company_id', :'co', 'code', 'KPI-W', 'name', 'Ujë 0.5L', 'uom_id', :'pcs', 'sales_price', 2)) as p \gset
select id as water from public.product_variants where product_id = :'p' \gset
insert into public.stock_adjustments (company_id, warehouse_id, adjustment_date, reason) values (:'co', :'shop', current_date - 40, 'opening') returning id as op \gset
insert into public.stock_adjustment_lines (company_id, adjustment_id, variant_id, location_id, quantity_change, unit_cost) values (:'co', :'op', :'water', :'floor', 100, 1);
select public.post_stock_adjustment(:'op');

select date_trunc('month', current_date)::date as m1, (date_trunc('month', current_date) + interval '1 month' - interval '1 day')::date as m2 \gset

-- nobody without the reports sees the panel or sets a target
select t.login('kpi.cashier@kt.al');
select t.throws(format($q$select public.kpi_panel('%s', '%s', '%s')$q$, :'co', :'m1', :'m2'), 'reports.read', 'a cashier does not see the panel');
select t.throws(format($q$select public.kpi_target_save('%s', '%s', '%s', 1000)$q$, :'co', :'shop', :'m1'), 'only a manager', 'nor sets the targets');

-- a day at the till: three receipts, one void, a drawer 4 short
select t.login(:'boss');
select public.open_pos_session(:'reg', 20) as ses \gset
select public.pos_submit_order(jsonb_build_object('client_uuid', gen_random_uuid(), 'session_id', :'ses',
  'lines', jsonb_build_array(jsonb_build_object('variant_id', :'water', 'quantity', q, 'unit_price', 2, 'discount_pct', 0, 'manual_pct', 0)),
  'payments', jsonb_build_array(jsonb_build_object('method', 'cash', 'amount', 2 * q)))) from unnest(array[2, 3, 5]) q;
select public.pos_log(:'ses', jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'kind', 'void_line', 'variant_id', :'water', 'quantity', 1, 'amount', 2, 'at', now())));
select public.pos_close(:'ses', jsonb_build_object('counted', 36));
-- a broken carton, eight hours on the attendance sheet
insert into public.stock_adjustments (company_id, warehouse_id, adjustment_date, reason) values (:'co', :'shop', current_date, 'damage') returning id as dmg \gset
insert into public.stock_adjustment_lines (company_id, adjustment_id, variant_id, location_id, quantity_change, unit_cost) values (:'co', :'dmg', :'water', :'floor', -3, 1);
select public.post_stock_adjustment(:'dmg');
insert into public.employees (company_id, first_name, last_name, hire_date) values (:'co', 'Kaltrina', 'Arkëtare', current_date - 100) returning id as emp \gset
insert into public.attendance_records (company_id, employee_id, work_date, check_in, check_out) values (:'co', :'emp', current_date, now() - interval '9 hours', now() - interval '1 hour');

select round(sum(l.line_subtotal), 2) as sales, round(sum(l.quantity * l.unit_cost), 2) as cost
  from public.pos_order_lines l join public.pos_orders o on o.id = l.pos_order_id where o.company_id = :'co' \gset
select public.kpi_panel(:'co', :'m1', :'m2') as k \gset
select t.ok((:'k'::jsonb -> 'now' ->> 'sales')::numeric = :'sales'::numeric and :'sales'::numeric > 0, 'the sales of the period, without VAT');
select t.ok((:'k'::jsonb -> 'now' ->> 'receipts')::int = 3 and (:'k'::jsonb -> 'now' ->> 'avg_receipt')::numeric = round(:'sales'::numeric / 3, 2),
  'three customers and the average receipt');
select t.ok((:'k'::jsonb -> 'now' ->> 'margin')::numeric = :'sales'::numeric - :'cost'::numeric and (:'k'::jsonb -> 'now' ->> 'cost')::numeric = 10,
  'the margin after the cost of the goods (10 pieces at 1)');
select t.ok((:'k'::jsonb -> 'now' ->> 'losses')::numeric = 3 and (:'k'::jsonb -> 'now' ->> 'losses_pct')::numeric = round(300 / :'sales'::numeric, 2),
  'the broken carton is a loss, as a share of sales');
select t.ok((:'k'::jsonb -> 'now' ->> 'hours')::numeric = 8 and (:'k'::jsonb -> 'now' ->> 'sales_per_hour')::numeric = round(:'sales'::numeric / 8, 2),
  'sales per hour worked');
select t.ok((:'k'::jsonb -> 'now' ->> 'shifts')::int = 1 and (:'k'::jsonb -> 'now' ->> 'voids')::int = 1 and (:'k'::jsonb -> 'now' ->> 'cash_diff')::numeric = 4
  and (:'k'::jsonb -> 'now' ->> 'diff_shifts')::int = 1, 'one shift, one void, 4 short in the drawer');
select t.ok((:'k'::jsonb -> 'now' ->> 'stock_end')::numeric = 87 and (:'k'::jsonb -> 'now' ->> 'stock_start')::numeric = 100
  and (:'k'::jsonb -> 'now' ->> 'turnover')::numeric = round(10 / 93.5, 2), 'the stock at cost before and after, and its turnover');
select t.ok((:'k'::jsonb -> 'now' ->> 'target') is null and (:'k'::jsonb -> 'now' ->> 'plan_pct') is null, 'no target, no plan');
select t.ok((:'k'::jsonb -> 'before' ->> 'sales')::numeric = 0 and (:'k'::jsonb -> 'before' ->> 'receipts')::int = 0, 'the period before had no sales');
select t.ok(jsonb_array_length(:'k'::jsonb -> 'days') = (:'m2'::date - :'m1'::date + 1), 'every day of the period is there');
select t.ok((select sum((d ->> 'sales')::numeric) from jsonb_array_elements(:'k'::jsonb -> 'days') d) = :'sales'::numeric, 'and the days add up to the period');
select t.ok((select sum((h ->> 'receipts')::int) from jsonb_array_elements(:'k'::jsonb -> 'hours') h) = 3, 'the hours of the day hold the three receipts');
select t.ok(jsonb_array_length(:'k'::jsonb -> 'stores') = 2
  and (select (s ->> 'sales')::numeric from jsonb_array_elements(:'k'::jsonb -> 'stores') s where (s ->> 'warehouse_id')::uuid = :'shop') = :'sales'::numeric
  and (select (s ->> 'sales')::numeric from jsonb_array_elements(:'k'::jsonb -> 'stores') s where (s ->> 'warehouse_id')::uuid = :'shop2') = 0,
  'both stores side by side');

-- targets: by store, then for the whole company
select public.kpi_target_save(:'co', :'shop', :'m1', 3000);
select public.kpi_target_save(:'co', :'shop2', :'m1', 1000);
select public.kpi_panel(:'co', :'m1', :'m2') as k \gset
select t.ok((:'k'::jsonb -> 'now' ->> 'target')::numeric = 4000, 'without its own target the company uses the stores'' targets');
select t.ok((:'k'::jsonb -> 'now' ->> 'plan_pct')::numeric = round(100 * :'sales'::numeric / 4000, 1), 'and the plan reached');
select t.ok((select (s ->> 'target')::numeric from jsonb_array_elements(:'k'::jsonb -> 'stores') s where (s ->> 'warehouse_id')::uuid = :'shop') = 3000, 'each store has its own');
select t.ok((public.kpi_panel(:'co', :'m1', :'m2', :'shop') -> 'now' ->> 'target')::numeric = 3000, 'and so does the panel of one store');
select t.ok((public.kpi_panel(:'co', :'m1', :'m2', :'shop') -> 'now' ->> 'hours') is null, 'hours are not split by store');
select t.ok((public.kpi_panel(:'co', :'m1', :'m1', :'shop') -> 'now' ->> 'target')::numeric = round(3000.0 / extract(day from :'m2'::date), 2),
  'one day carries its share of the month');
select public.kpi_target_save(:'co', null, :'m1', 5000);
select t.ok((public.kpi_panel(:'co', :'m1', :'m2') -> 'now' ->> 'target')::numeric = 5000, 'the company''s own target wins');
select public.kpi_target_save(:'co', null, :'m1' :: date + 3, 6000);
select t.ok((select count(*) from public.sales_targets where company_id = :'co' and warehouse_id is null) = 1
  and (public.kpi_panel(:'co', :'m1', :'m2') -> 'now' ->> 'target')::numeric = 6000, 'one target per month: saving again changes it');
select public.kpi_target_save(:'co', null, :'m1', 0);
select t.ok((public.kpi_panel(:'co', :'m1', :'m2') -> 'now' ->> 'target')::numeric = 4000, 'nothing removes it');
select t.throws(format($q$select public.kpi_panel('%s', '%s', '%s')$q$, :'co', :'m2', :'m1'), 'Choose a period', 'a period runs forward');
select t.ok((select (k -> 'previous' ->> 'from')::date = (:'m1'::date - interval '1 month')::date and (k -> 'previous' ->> 'to')::date = :'m1'::date - 1
               from public.kpi_panel(:'co', :'m1', :'m2') k), 'a month is compared with the month before');
select t.ok((select (k -> 'previous' ->> 'from')::date = (:'m1'::date - interval '1 month')::date and (k -> 'previous' ->> 'to')::date = (:'m1'::date - interval '1 month')::date + 2
               from public.kpi_panel(:'co', :'m1', :'m1'::date + 2) k), 'the month so far with the same days of the month before');
select date_trunc('week', current_date)::date as mon \gset
select t.ok((select (k -> 'previous' ->> 'from')::date = :'mon'::date - 7 and (k -> 'previous' ->> 'to')::date = :'mon'::date - 5
               from public.kpi_panel(:'co', :'mon', :'mon'::date + 2) k), 'the week so far with the same days a week before');
select t.ok((select (k -> 'previous' ->> 'from')::date = :'m1'::date + 5 and (k -> 'previous' ->> 'to')::date = :'m1'::date + 9
               from public.kpi_panel(:'co', :'m1'::date + 10, :'m1'::date + 14) k), 'any other days with as many days just before');
select t.throws($q$insert into public.sales_targets (company_id, month, amount) values (gen_random_uuid(), date_trunc('month', current_date), 1)$q$,
  'row-level security', 'targets are written only through the panel');

-- a manager of the second store only sees that store
reset role;
update public.company_members set warehouse_ids = array[:'shop2'::uuid]
 where company_id = :'co' and user_id = (select id from public.profiles where email = 'kpi.boss2@kt.al');
set role authenticated;
select t.login('kpi.boss2@kt.al');
select public.kpi_panel(:'co', :'m1', :'m2') as k2 \gset
select t.ok((:'k2'::jsonb ->> 'warehouse_id')::uuid = :'shop2' and (:'k2'::jsonb -> 'now' ->> 'sales')::numeric = 0 and jsonb_array_length(:'k2'::jsonb -> 'stores') = 0,
  'a manager of one store sees that store, not the company');
select t.throws(format($q$select public.kpi_panel('%s', '%s', '%s', '%s')$q$, :'co', :'m1', :'m2', :'shop'), 'do not work', 'nor another store');

reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
