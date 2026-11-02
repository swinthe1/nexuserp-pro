-- =============================================================================
-- DrisPRO · ABC-XYZ classification of items
--   ABC: by the value that leaves the stock in the last months (sales, till and raw material used
--        in production, returns taken off), at cost: A = the items making the first 80 % of it,
--        B = the next 15 %, C = the rest. (Or by quantity, for those who prefer.)
--   XYZ: by how regularly it leaves, week after week (coefficient of variation of the weekly
--        quantity, over the weeks since the item first sold): X steady, Y changing, Z rare or irregular.
--   Classified for the whole company and for each unit; recalculated every week (and on demand).
--   Counting by class: A every month, B every three months, C once a year; the program says what
--   is due and makes the count.
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

alter table public.company_settings add column if not exists abc_settings jsonb not null default '{}'::jsonb;

create table if not exists public.item_classes (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  variant_id   uuid not null,
  warehouse_id uuid,                                  -- null: the whole company
  abc          text not null check (abc in ('A', 'B', 'C')),
  xyz          text not null check (xyz in ('X', 'Y', 'Z')),
  value        numeric(18,2) not null default 0,      -- what left the stock in the period, at cost
  qty          numeric(18,4) not null default 0,
  share        numeric(8,3) not null default 0,       -- % of the scope's total (by the chosen basis)
  cum_share    numeric(8,3) not null default 0,       -- cumulative %, best first
  months_sold  int not null default 0,
  cv           numeric(10,3),                         -- variation of the weekly quantity
  weeks        int not null default 0,                -- complete weeks the variation is measured over
  rank         int not null,
  on_hand      numeric(18,4) not null default 0,
  stock_value  numeric(18,2) not null default 0,
  computed_at  timestamptz not null default now(),
  foreign key (company_id, variant_id) references public.product_variants(company_id, id),
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id)
);
select app.register_table('public.item_classes', 'inventory', p_soft_delete => false, p_client_write => false, p_audit => false);
create unique index if not exists item_classes_key on public.item_classes (company_id, variant_id, coalesce(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid));
create index if not exists item_classes_scope_idx on public.item_classes (company_id, warehouse_id, rank);

-- the rules, with their defaults
create or replace function app.abc_cfg(p_company uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('basis', 'value', 'months', 12, 'a', 80, 'b', 95, 'x', 0.25, 'y', 0.5, 'count_a', 30, 'count_b', 90, 'count_c', 365)
         || coalesce((select abc_settings from public.company_settings where company_id = p_company), '{}'::jsonb)
$$;

-- -----------------------------------------------------------------------------
-- 1. The calculation
-- -----------------------------------------------------------------------------
create or replace function app.abc_compute(p_company uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare cfg jsonb := app.abc_cfg(p_company); v_months int; v_from timestamptz; v_a numeric; v_b numeric; v_x numeric; v_y numeric; v_qty_basis boolean; v_n int;
begin
  v_months := greatest(3, least(24, (cfg ->> 'months')::int));
  v_from := date_trunc('month', now()) - make_interval(months => v_months - 1);
  v_a := (cfg ->> 'a')::numeric; v_b := (cfg ->> 'b')::numeric; v_x := (cfg ->> 'x')::numeric; v_y := (cfg ->> 'y')::numeric;
  v_qty_basis := cfg ->> 'basis' = 'qty';

  delete from public.item_classes where company_id = p_company;

  with mv as (   -- what left each unit, week by week (returns count back)
    select m.variant_id,
           case when m.movement_type in ('pos_return', 'sales_return') then m.to_warehouse_id else m.from_warehouse_id end as wh,
           date_trunc('week', m.movement_date) as wk, date_trunc('month', m.movement_date) as mon,
           sum(case when m.movement_type in ('pos_return', 'sales_return') then -m.quantity else m.quantity end) as q,
           sum(case when m.movement_type in ('pos_return', 'sales_return') then -m.total_cost else m.total_cost end) as v
      from public.stock_movements m
     where m.company_id = p_company and m.movement_date >= v_from
       and m.movement_type in ('pos_sale', 'delivery', 'production_consume', 'pos_return', 'sales_return')
     group by 1, 2, 3, 4),
  scoped as (
    select variant_id, wh, wk, mon, q, v from mv where wh is not null
    union all
    select variant_id, null, wk, mon, sum(q), sum(v) from mv group by variant_id, wk, mon),
  tot as (
    select variant_id, wh, sum(q) as qty, sum(v) as val from scoped group by 1, 2),
  mon as (   -- months in which it sold
    select variant_id, wh, count(*) filter (where q > 0) as months_sold
      from (select variant_id, wh, mon, sum(q) as q from scoped group by 1, 2, 3) x group by 1, 2),
  wkl as (   -- the weekly pattern, complete weeks only, from the week it first sold
    select variant_id, wh, sum(q) filter (where wk < date_trunc('week', now())) as wq, sum(q * q) filter (where wk < date_trunc('week', now())) as wsq,
           greatest(1, floor(extract(epoch from (date_trunc('week', now()) - greatest(min(wk), date_trunc('week', v_from)))) / 604800))::int as weeks
      from (select variant_id, wh, wk, sum(q) as q from scoped group by 1, 2, 3) x group by 1, 2),
  agg as (
    select t.variant_id, t.wh, t.qty, t.val, m.months_sold, w.wq, w.wsq, w.weeks
      from tot t
      join mon m on m.variant_id = t.variant_id and m.wh is not distinct from t.wh
      join wkl w on w.variant_id = t.variant_id and w.wh is not distinct from t.wh),
  stock as (   -- what is on the shelves now (items with stock but no sales are classified too: C, Z)
    select sl.variant_id, sl.warehouse_id as wh, sum(sl.on_hand) as on_hand, sum(sl.on_hand * coalesce(ic.avg_cost, 0)) as sv
      from public.stock_levels sl
      join public.warehouses w on w.id = sl.warehouse_id and w.warehouse_type <> 'transit'
      left join public.item_costs ic on ic.variant_id = sl.variant_id
     where sl.company_id = p_company
     group by 1, 2
    union all
    select sl.variant_id, null, sum(sl.on_hand), sum(sl.on_hand * coalesce(ic.avg_cost, 0))
      from public.stock_levels sl
      join public.warehouses w on w.id = sl.warehouse_id and w.warehouse_type <> 'transit'
      left join public.item_costs ic on ic.variant_id = sl.variant_id
     where sl.company_id = p_company
     group by 1),
  base as (
    select coalesce(a.variant_id, s.variant_id) as variant_id, case when a.variant_id is not null then a.wh else s.wh end as wh,
           greatest(coalesce(a.qty, 0), 0) as qty, greatest(coalesce(a.val, 0), 0) as val, coalesce(a.months_sold, 0) as months_sold,
           case when coalesce(a.wq, 0) > 0
                then sqrt(greatest(a.wsq / a.weeks - power(a.wq / a.weeks, 2), 0)) / (a.wq / a.weeks) end as cv, coalesce(a.weeks, 0) as weeks,
           coalesce(s.on_hand, 0) as on_hand, coalesce(s.sv, 0) as sv
      from agg a
      full join stock s on s.variant_id = a.variant_id and s.wh is not distinct from a.wh
     where coalesce(a.qty, 0) > 0 or coalesce(s.on_hand, 0) > 0),
  ranked as (
    select b.*, case when v_qty_basis then b.qty else b.val end as m,
           sum(case when v_qty_basis then b.qty else b.val end) over (partition by b.wh) as total,
           sum(case when v_qty_basis then b.qty else b.val end) over (partition by b.wh order by case when v_qty_basis then b.qty else b.val end desc, b.variant_id
                                                                     rows between unbounded preceding and current row) as cum,
           row_number() over (partition by b.wh order by case when v_qty_basis then b.qty else b.val end desc, b.variant_id) as rk
      from base b
      join public.product_variants pv on pv.id = b.variant_id
      join public.products p on p.id = pv.product_id and p.product_type = 'stockable')
  insert into public.item_classes (company_id, variant_id, warehouse_id, abc, xyz, value, qty, share, cum_share, months_sold, cv, weeks, rank, on_hand, stock_value)
  select p_company, r.variant_id, r.wh,
         case when r.m <= 0 or r.total <= 0 then 'C'
              when (r.cum - r.m) / r.total * 100 < v_a then 'A'
              when (r.cum - r.m) / r.total * 100 < v_b then 'B' else 'C' end,
         case when r.cv is null then 'Z' when r.cv <= v_x then 'X' when r.cv <= v_y then 'Y' else 'Z' end,
         round(r.val, 2), r.qty,
         case when r.total > 0 then round(r.m / r.total * 100, 3) else 0 end,
         case when r.total > 0 then round(r.cum / r.total * 100, 3) else 0 end,
         r.months_sold, round(r.cv, 3), r.weeks, r.rk, r.on_hand, round(r.sv, 2)
    from ranked r;
  get diagnostics v_n = row_count;
  update public.company_settings set abc_settings = abc_settings || jsonb_build_object('computed_at', now()) where company_id = p_company;
  return v_n;
end $$;

-- now, by hand
create or replace function public.abc_run(p_company uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'inventory.write');
  perform app.abc_compute(p_company);
  return public.abc_summary(p_company, null);
end $$;

-- the 3 × 3 matrix, the totals and items with stock that did not move
create or replace function public.abc_summary(p_company uuid, p_warehouse uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare cfg jsonb := app.abc_cfg(p_company); v jsonb;
begin
  if not (app.has_permission(p_company, 'inventory.read') or app.has_permission(p_company, 'wms.read')) then
    raise exception 'Permission denied: inventory.read required' using errcode = '42501';
  end if;
  select jsonb_build_object(
           'cells', coalesce((select jsonb_agg(jsonb_build_object('abc', c.abc, 'xyz', c.xyz, 'items', c.n, 'value', c.val, 'share', c.sh, 'stock_value', c.sv) order by c.abc, c.xyz)
                                from (select abc, xyz, count(*) as n, sum(value) as val, sum(share) as sh, sum(stock_value) as sv
                                        from public.item_classes where company_id = p_company and warehouse_id is not distinct from p_warehouse
                                       group by abc, xyz) c), '[]'::jsonb),
           'items', (select count(*) from public.item_classes where company_id = p_company and warehouse_id is not distinct from p_warehouse),
           'value', coalesce((select sum(value) from public.item_classes where company_id = p_company and warehouse_id is not distinct from p_warehouse), 0),
           'stock_value', coalesce((select sum(stock_value) from public.item_classes where company_id = p_company and warehouse_id is not distinct from p_warehouse), 0),
           'dead', (select jsonb_build_object('items', count(*), 'stock_value', coalesce(sum(stock_value), 0))
                      from public.item_classes where company_id = p_company and warehouse_id is not distinct from p_warehouse and months_sold = 0 and on_hand > 0),
           'computed_at', cfg ->> 'computed_at',
           'settings', cfg - 'computed_at')
    into v;
  return v;
end $$;

create or replace function public.abc_settings_save(p_company uuid, p_cfg jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c jsonb;
begin
  perform app.require_permission(p_company, 'inventory.write');
  c := (app.abc_cfg(p_company) - 'computed_at') || (p_cfg - 'computed_at');
  if c ->> 'basis' not in ('value', 'qty') then raise exception 'Choose value or quantity' using errcode = '22023'; end if;
  if not ((c ->> 'a')::numeric > 0 and (c ->> 'a')::numeric < (c ->> 'b')::numeric and (c ->> 'b')::numeric < 100) then
    raise exception 'A must be below B, and B below 100 %%' using errcode = '22023';
  end if;
  if not ((c ->> 'x')::numeric > 0 and (c ->> 'x')::numeric < (c ->> 'y')::numeric) then
    raise exception 'X must be below Y' using errcode = '22023';
  end if;
  if (c ->> 'months')::int not between 3 and 24 then raise exception 'Choose 3 to 24 months' using errcode = '22023'; end if;
  if least((c ->> 'count_a')::int, (c ->> 'count_b')::int, (c ->> 'count_c')::int) < 1 then raise exception 'Count every day at most' using errcode = '22023'; end if;
  update public.company_settings
     set abc_settings = jsonb_build_object('basis', c ->> 'basis', 'months', (c ->> 'months')::int, 'a', (c ->> 'a')::numeric, 'b', (c ->> 'b')::numeric,
                                           'x', (c ->> 'x')::numeric, 'y', (c ->> 'y')::numeric, 'count_a', (c ->> 'count_a')::int,
                                           'count_b', (c ->> 'count_b')::int, 'count_c', (c ->> 'count_c')::int)
                        || coalesce(jsonb_build_object('computed_at', abc_settings -> 'computed_at'), '{}'::jsonb)
   where company_id = p_company;
  perform app.abc_compute(p_company);
  return public.abc_summary(p_company, null);
end $$;

-- -----------------------------------------------------------------------------
-- 2. Counting by class: what is due, and a count of it
-- -----------------------------------------------------------------------------
-- an item's class in a unit: its own there, else the company's, else C
create or replace function app.item_class_at(p_variant uuid, p_warehouse uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select abc from public.item_classes where variant_id = p_variant and warehouse_id = p_warehouse),
                  (select abc from public.item_classes where variant_id = p_variant and warehouse_id is null), 'C')
$$;

create or replace function app.count_due_lines(p_warehouse uuid)
returns table (variant_id uuid, location_id uuid, lot_id uuid, on_hand numeric, abc text, last_counted timestamptz, due boolean)
language sql stable security definer set search_path = '' as $$
  with cfg as (select app.abc_cfg(w.company_id) as c from public.warehouses w where w.id = p_warehouse),
  items as (
    select sl.variant_id, sl.location_id, sl.lot_id, sl.on_hand, app.item_class_at(sl.variant_id, p_warehouse) as abc,
           (select max(cl.counted_at) from public.cycle_count_lines cl join public.cycle_counts cc on cc.id = cl.cycle_count_id
             where cl.variant_id = sl.variant_id and cc.warehouse_id = p_warehouse and cc.status = 'posted' and cl.counted_at is not null) as last_counted
      from public.stock_levels sl
      join public.warehouse_locations loc on loc.id = sl.location_id and loc.location_type = 'internal'
     where sl.warehouse_id = p_warehouse and sl.on_hand <> 0
       -- not already on an open count
       and not exists (select 1 from public.cycle_count_lines ol join public.cycle_counts oc on oc.id = ol.cycle_count_id
                        where ol.variant_id = sl.variant_id and ol.location_id = sl.location_id and oc.status in ('draft', 'in_progress', 'review') and oc.deleted_at is null))
  select i.variant_id, i.location_id, i.lot_id, i.on_hand, i.abc, i.last_counted,
         i.last_counted is null or i.last_counted < now() - make_interval(days => ((select c from cfg) ->> ('count_' || lower(i.abc)))::int)
    from items i
$$;

-- per unit: how many items of each class, how many are due
create or replace function public.count_plan(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_mine uuid[] := app.my_warehouses(p_company);
begin
  if not (app.has_permission(p_company, 'wms.read') or app.has_permission(p_company, 'inventory.read')) then
    raise exception 'Permission denied: wms.read required' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('warehouse_id', w.id, 'name', w.name, 'code', w.code,
             'classes', (select jsonb_object_agg(x.abc, jsonb_build_object('items', x.n, 'due', x.due))
                           from (select d.abc, count(distinct d.variant_id) as n, count(distinct d.variant_id) filter (where d.due) as due
                                   from app.count_due_lines(w.id) d group by d.abc) x),
             'due', (select count(distinct d.variant_id) from app.count_due_lines(w.id) d where d.due)) order by w.code)
      from public.warehouses w
     where w.company_id = p_company and w.deleted_at is null and w.is_active and w.warehouse_type in ('warehouse', 'store', 'production')
       and (v_mine is null or w.id = any (v_mine))), '[]'::jsonb);
end $$;

-- a count of what is due: A first, then B, then C, the longest-uncounted first; at most p_limit items
create or replace function public.create_count_due(p_warehouse uuid, p_limit int default 80, p_blind boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare w public.warehouses; v_id uuid; v_n int;
begin
  select * into w from public.warehouses where id = p_warehouse and deleted_at is null;
  if w.id is null then raise exception 'Warehouse not found' using errcode = 'P0002'; end if;
  perform app.require_permission(w.company_id, 'wms.write');
  insert into public.cycle_counts (company_id, warehouse_id, scope, scope_filter, blind_count, assigned_to)
  values (w.company_id, w.id, 'abc_class', jsonb_build_object('due', true, 'limit', p_limit), p_blind, auth.uid())
  returning id into v_id;
  with picked as (
    select d.variant_id from app.count_due_lines(w.id) d where d.due
     group by d.variant_id
     order by min(d.abc), min(d.last_counted) nulls first, d.variant_id
     limit greatest(coalesce(p_limit, 80), 1))
  insert into public.cycle_count_lines (company_id, cycle_count_id, variant_id, location_id, lot_id, system_qty)
  select w.company_id, v_id, d.variant_id, d.location_id, d.lot_id, d.on_hand
    from app.count_due_lines(w.id) d join picked p on p.variant_id = d.variant_id
   order by d.abc, d.variant_id;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Nothing is due for counting in this unit' using errcode = '23514'; end if;
  update public.cycle_counts set status = 'in_progress', scope_filter = scope_filter || jsonb_build_object('items', v_n) where id = v_id;
  return v_id;
end $$;

-- -----------------------------------------------------------------------------
-- 3. The class shows where the item is looked up
-- -----------------------------------------------------------------------------
select app._patch_function('public.item_where',
  $x$                                         order by b.quantity, b.created_at limit 1))$x$,
  $x$                                         order by b.quantity, b.created_at limit 1),
                            'class', (select ic.abc || ic.xyz from public.item_classes ic where ic.variant_id = v.id and ic.warehouse_id is null))$x$);

-- -----------------------------------------------------------------------------
-- 4. Every week, for every company with stock movements
-- -----------------------------------------------------------------------------
create or replace function app.abc_weekly()
returns int language plpgsql security definer set search_path = '' as $$
declare c record; v_n int := 0;
begin
  for c in select distinct m.company_id from public.stock_movements m where m.movement_date > now() - interval '120 days' loop
    begin
      perform app.abc_compute(c.company_id);
      v_n := v_n + 1;
    exception when others then
      raise warning 'ABC for %: %', c.company_id, sqlerrm;
    end;
  end loop;
  return v_n;
end $$;

revoke execute on function app.abc_cfg(uuid), app.abc_compute(uuid), app.item_class_at(uuid, uuid), app.count_due_lines(uuid), app.abc_weekly()
  from public, anon, authenticated;
revoke execute on function public.abc_run(uuid), public.abc_summary(uuid, uuid), public.abc_settings_save(uuid, jsonb), public.count_plan(uuid),
  public.create_count_due(uuid, int, boolean) from public, anon;
grant execute on function public.abc_run(uuid), public.abc_summary(uuid, uuid), public.abc_settings_save(uuid, jsonb), public.count_plan(uuid),
  public.create_count_due(uuid, int, boolean) to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('drispro-abc', '40 3 * * 1', 'select app.abc_weekly()');
  end if;
exception when others then
  raise notice 'pg_cron not available (%); schedule app.abc_weekly() externally', sqlerrm;
end $$;

-- the first classification, straight away
select app.abc_weekly();

drop function app._patch_function(text, text, text);
