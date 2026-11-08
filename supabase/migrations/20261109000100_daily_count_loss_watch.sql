-- =============================================================================
-- DrisPRO · the count that never closes the shop, and the loss watch (9.11.2026)
--   1. Every day each person who works in a store counts a few items: not chosen by chance, but those
--      where the stock is most likely wrong (negative stock, a difference at the last count, items taken
--      off at the till, refunds without a receipt, an item that stopped selling although the program
--      says it is there, the valuable class A, never counted or not for long). Blind, as every count.
--   2. How right the stock is in each unit: of the lines counted in the last 30 days, how many had no
--      difference, and what the differences were worth.
--   3. The loss watch: what in the tills, the waiters' handovers and the counts looks out of line,
--      compared with the other cashiers of the same company. A short list, not fifty reports.
-- =============================================================================

alter table public.cycle_counts drop constraint if exists cycle_counts_scope_check;
alter table public.cycle_counts add constraint cycle_counts_scope_check
  check (scope in ('full', 'location', 'category', 'abc_class', 'random', 'risk'));
alter table public.cycle_count_lines add column if not exists reasons text[];

create index if not exists pos_orders_company_at_idx on public.pos_orders (company_id, order_at);
create index if not exists pos_till_log_register_at_idx on public.pos_till_log (register_id, at);
create index if not exists stock_movements_from_wh_date_idx on public.stock_movements (from_warehouse_id, movement_date) where from_warehouse_id is not null;

-- -----------------------------------------------------------------------------
-- 1. How likely the stock of each item in a unit is wrong
-- -----------------------------------------------------------------------------
create or replace function app.count_risk(p_warehouse uuid)
returns table (variant_id uuid, on_hand numeric, score int, reasons text[])
language sql stable security definer set search_path = '' as $$
  with w as (select id, company_id from public.warehouses where id = p_warehouse),
  stock as (
    select sl.variant_id, sum(sl.on_hand) as on_hand
      from public.stock_levels sl join public.warehouse_locations loc on loc.id = sl.location_id and loc.location_type = 'internal'
     where sl.warehouse_id = p_warehouse and sl.on_hand <> 0
     group by sl.variant_id),
  tills as (select id from public.pos_registers where warehouse_id = p_warehouse),
  voids as (
    select tl.variant_id, count(*) as n from public.pos_till_log tl
     where tl.register_id in (select id from tills) and tl.kind in ('void_line', 'void_qty') and tl.variant_id is not null
       and tl.at > now() - interval '30 days'
     group by tl.variant_id),
  refunds as (
    select ol.variant_id, count(*) as n from public.pos_order_lines ol join public.pos_orders o on o.id = ol.pos_order_id
     where o.register_id in (select id from tills) and o.is_refund and o.refund_of_id is null and o.deleted_at is null
       and o.order_at > now() - interval '30 days'
     group by ol.variant_id),
  sales as (
    select m.variant_id, max(m.movement_date) as last_sale, count(*) as n
      from public.stock_movements m, w
     where m.company_id = w.company_id and m.from_warehouse_id = p_warehouse and m.movement_type in ('pos_sale', 'delivery')
       and m.movement_date > now() - interval '90 days'
     group by m.variant_id),
  last_count as (
    select distinct on (cl.variant_id) cl.variant_id, cl.counted_at,
           exists (select 1 from public.stock_adjustment_lines al
                    where al.adjustment_id = cc.adjustment_id and al.variant_id = cl.variant_id and al.quantity_change <> 0) as had_diff
      from public.cycle_count_lines cl join public.cycle_counts cc on cc.id = cl.cycle_count_id
     where cc.warehouse_id = p_warehouse and cc.status = 'posted' and cl.counted_at is not null
     order by cl.variant_id, cl.counted_at desc),
  open_counts as (
    select distinct ol.variant_id from public.cycle_count_lines ol join public.cycle_counts oc on oc.id = ol.cycle_count_id
     where oc.warehouse_id = p_warehouse and oc.status in ('draft', 'in_progress', 'review') and oc.deleted_at is null),
  x as (
    select s.variant_id, s.on_hand,
           s.on_hand < 0 as neg,
           coalesce(lc.had_diff, false) as last_diff,
           coalesce(v.n, 0) as voids,
           coalesce(r.n, 0) as refunds,
           (s.on_hand > 0 and coalesce(sa.n, 0) >= 3 and sa.last_sale < now() - interval '14 days') as no_sales,
           app.item_class_at(s.variant_id, p_warehouse) = 'A' as class_a,
           lc.variant_id is null as never,
           lc.counted_at < now() - interval '90 days' as long_ago,
           lc.counted_at > now() - interval '7 days' as just_counted
      from stock s
      left join last_count lc on lc.variant_id = s.variant_id
      left join voids v on v.variant_id = s.variant_id
      left join refunds r on r.variant_id = s.variant_id
      left join sales sa on sa.variant_id = s.variant_id
     where s.variant_id not in (select variant_id from open_counts))
  select x.variant_id, x.on_hand,
         (case when x.neg then 100 else 0 end
          + case when x.last_diff then 40 else 0 end
          + least(30, x.voids * 5)::int
          + least(30, x.refunds * 10)::int
          + case when x.no_sales then 35 else 0 end
          + case when x.class_a then 20 else 0 end
          + case when x.never then 15 when coalesce(x.long_ago, false) then 10 else 0 end)::int,
         array_remove(array[
           case when x.neg then 'negative' end,
           case when x.last_diff then 'last_diff' end,
           case when x.voids >= 2 then 'voids' end,
           case when x.refunds >= 1 then 'refunds' end,
           case when x.no_sales then 'no_sales' end,
           case when x.class_a then 'class_a' end,
           case when x.never then 'never' when coalesce(x.long_ago, false) then 'long_ago' end], null)
    from x
   -- counted in the last week and nothing wrong since: it waits its turn
   where not (coalesce(x.just_counted, false) and not x.neg)
$$;
revoke execute on function app.count_risk(uuid) from public, anon, authenticated;

-- the list a manager sees: the riskiest items of a unit and why
create or replace function public.count_risk_list(p_warehouse uuid, p_limit int default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare w public.warehouses;
begin
  select * into w from public.warehouses where id = p_warehouse and deleted_at is null;
  if w.id is null then raise exception 'Warehouse not found' using errcode = 'P0002'; end if;
  if not (app.has_permission(w.company_id, 'wms.read') or app.has_permission(w.company_id, 'inventory.read')) then
    raise exception 'Permission denied: wms.read required' using errcode = '42501';
  end if;
  perform app.check_warehouse(w.company_id, w.id);
  return coalesce((
    select jsonb_agg(jsonb_build_object('variant_id', r.variant_id, 'sku', v.sku, 'name', v.name, 'on_hand', r.on_hand,
                                       'score', r.score, 'reasons', to_jsonb(r.reasons)) order by r.score desc, v.name)
      from (select * from app.count_risk(p_warehouse) where score >= 15 order by score desc limit greatest(1, least(coalesce(p_limit, 30), 200))) r
      join public.product_variants v on v.id = r.variant_id), '[]'::jsonb);
end $$;

-- -----------------------------------------------------------------------------
-- 2. The day's counts: a few of the riskiest items for each person of each unit
-- -----------------------------------------------------------------------------
create or replace function app.daily_counts(p_company uuid, p_per int, p_today date)
returns int language plpgsql security definer set search_path = '' as $$
declare w public.warehouses; v_people uuid[]; v_who uuid; v_id uuid; v_n int; v_made int := 0; v_number text;
begin
  for w in select * from public.warehouses where company_id = p_company and deleted_at is null and is_active
             and warehouse_type in ('store', 'warehouse') order by code loop
    -- the people who work in this unit and may count
    v_people := array(select m.user_id from public.company_members m
                       where m.company_id = p_company and m.status = 'active' and m.deleted_at is null and m.user_id is not null
                         and w.id = any (m.warehouse_ids) and app.has_permission_of(m.user_id, p_company, 'wms.write')
                       order by m.joined_at nulls last, m.created_at);
    if coalesce(cardinality(v_people), 0) = 0 then
      v_who := app.first_with_role(p_company, array['store_manager', 'inventory_manager', 'warehouse_operator', 'company_admin']);
      v_people := case when v_who is null then '{}'::uuid[] else array[v_who] end;
    end if;
    foreach v_who in array v_people loop
      -- one at a time: yesterday's count not done yet waits, nothing piles up
      continue when exists (select 1 from public.cycle_counts where company_id = p_company and warehouse_id = w.id and scope = 'risk'
                              and assigned_to = v_who and deleted_at is null and (status = 'in_progress' or count_date = p_today));
      insert into public.cycle_counts (company_id, warehouse_id, count_date, scope, scope_filter, blind_count, assigned_to)
      values (p_company, w.id, p_today, 'risk', jsonb_build_object('daily', true, 'limit', p_per), true, v_who)
      returning id, number into v_id, v_number;
      with picked as (
        select r.variant_id, r.score, r.reasons from app.count_risk(w.id) r
         where r.score >= 15 order by r.score desc, random() limit greatest(1, p_per))
      insert into public.cycle_count_lines (company_id, cycle_count_id, variant_id, location_id, lot_id, system_qty, reasons)
      select p_company, v_id, sl.variant_id, sl.location_id, sl.lot_id, sl.on_hand, p.reasons
        from picked p join public.stock_levels sl on sl.variant_id = p.variant_id and sl.warehouse_id = w.id and sl.on_hand <> 0
        join public.warehouse_locations loc on loc.id = sl.location_id and loc.location_type = 'internal'
       order by p.score desc;
      get diagnostics v_n = row_count;
      if v_n = 0 then
        delete from public.cycle_counts where id = v_id;
        exit;   -- nothing risky left in this unit today
      end if;
      update public.cycle_counts set status = 'in_progress',
             scope_filter = scope_filter || jsonb_build_object('items', (select count(distinct variant_id) from public.cycle_count_lines where cycle_count_id = v_id))
       where id = v_id;
      perform app.auto_task(p_company, 'daily_count:' || v_id,
        'Numëro sot ' || (select count(distinct variant_id) from public.cycle_count_lines where cycle_count_id = v_id) || ' artikuj në ' || w.name,
        v_who, p_today, 2::smallint, 'cycle_counts', v_id, v_number,
        'Artikujt janë zgjedhur aty ku stoku ka më shumë gjasë të jetë gabim. Numëroji në raft dhe dërgoje numërimin.');
      v_made := v_made + 1;
    end loop;
  end loop;
  return v_made;
end $$;
revoke execute on function app.daily_counts(uuid, int, date) from public, anon, authenticated;

-- by hand, from the counts page: today's counts now
create or replace function public.daily_counts_now(p_company uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare s jsonb; c public.companies;
begin
  perform app.require_permission(p_company, 'wms.write');
  select * into c from public.companies where id = p_company;
  select coalesce(task_automations, '{}') into s from public.company_settings where company_id = p_company;
  return app.daily_counts(p_company, greatest(1, least(30, app.auto_days(s, 'daily_count', 8))),
                          (now() at time zone coalesce(c.timezone, 'Europe/Tirane'))::date);
end $$;

-- a count sent for review or posted closes its task
create or replace function app.tg_count_done_tasks()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('review', 'posted', 'cancelled') and old.status is distinct from new.status then
    update public.tasks set status = 'done', completed_at = now()
     where company_id = new.company_id and auto_key = 'daily_count:' || new.id and status not in ('done', 'cancelled') and deleted_at is null;
  end if;
  return null;
end $$;
drop trigger if exists trg_92_done_tasks on public.cycle_counts;
create trigger trg_92_done_tasks after update of status on public.cycle_counts for each row execute function app.tg_count_done_tasks();

-- -----------------------------------------------------------------------------
-- 3. How right the stock is: per unit, the lines counted and posted in the last days
-- -----------------------------------------------------------------------------
create or replace function public.count_accuracy(p_company uuid, p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_mine uuid[] := app.my_warehouses(p_company);
begin
  if not (app.has_permission(p_company, 'wms.read') or app.has_permission(p_company, 'inventory.read')) then
    raise exception 'Permission denied: wms.read required' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('warehouse_id', x.warehouse_id, 'name', x.name, 'lines', x.lines, 'exact', x.lines - x.off,
                     'pct', case when x.lines > 0 then round(100.0 * (x.lines - x.off) / x.lines, 1) end,
                     'lost', x.lost, 'found', x.found) order by x.name)
      from (
        select w.id as warehouse_id, w.name,
               count(cl.id) as lines,
               count(cl.id) filter (where exists (select 1 from public.stock_adjustment_lines al where al.adjustment_id = cc.adjustment_id
                                                     and al.variant_id = cl.variant_id and al.location_id = cl.location_id and al.quantity_change <> 0)) as off,
               coalesce((select sum(-al.quantity_change * al.unit_cost) from public.stock_adjustment_lines al join public.cycle_counts c2 on c2.adjustment_id = al.adjustment_id
                          where c2.warehouse_id = w.id and c2.status = 'posted' and c2.posted_at > now() - make_interval(days => greatest(1, p_days)) and al.quantity_change < 0), 0) as lost,
               coalesce((select sum(al.quantity_change * al.unit_cost) from public.stock_adjustment_lines al join public.cycle_counts c2 on c2.adjustment_id = al.adjustment_id
                          where c2.warehouse_id = w.id and c2.status = 'posted' and c2.posted_at > now() - make_interval(days => greatest(1, p_days)) and al.quantity_change > 0), 0) as found
          from public.warehouses w
          left join public.cycle_counts cc on cc.warehouse_id = w.id and cc.status = 'posted' and cc.deleted_at is null
                                          and cc.posted_at > now() - make_interval(days => greatest(1, p_days))
          left join public.cycle_count_lines cl on cl.cycle_count_id = cc.id and cl.counted_qty is not null
         where w.company_id = p_company and w.deleted_at is null and w.is_active and w.warehouse_type in ('store', 'warehouse')
           and (v_mine is null or w.id = any (v_mine))
         group by w.id, w.name) x), '[]'::jsonb);
end $$;

-- -----------------------------------------------------------------------------
-- 4. The loss watch
-- -----------------------------------------------------------------------------
create or replace function app.loss_watch_data(p_company uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_tz text; v_a timestamptz; v_b timestamptz; v_cash jsonb; v_wait jsonb; v_items jsonb; v_neg jsonb; v_sig jsonb := '[]'::jsonb;
        m_void numeric; m_disc numeric; m_clear numeric; m_wvoid numeric; r record;
begin
  select coalesce(timezone, 'Europe/Tirane') into v_tz from public.companies where id = p_company;
  v_a := (p_from::timestamp) at time zone v_tz;
  v_b := ((p_to + 1)::timestamp) at time zone v_tz;

  -- the cashiers, side by side
  with o as (
    select o.id, o.cashier_id, o.total, o.is_refund, o.refund_of_id, o.loyalty_card_id from public.pos_orders o
     where o.company_id = p_company and o.order_at >= v_a and o.order_at < v_b and o.deleted_at is null and o.status = 'paid' and o.cashier_id is not null),
  base as (
    select cashier_id, count(*) filter (where not is_refund) as receipts, coalesce(sum(total) filter (where not is_refund), 0) as sales,
           count(*) filter (where is_refund and refund_of_id is null) as refunds_nr,
           coalesce(-sum(total) filter (where is_refund and refund_of_id is null), 0) as refunds_nr_amount
      from o group by cashier_id),
  disc as (
    select o.cashier_id, coalesce(sum(round(l.quantity * l.unit_price * l.discount_pct / 100, 2)), 0) as amount
      from o join public.pos_order_lines l on l.pos_order_id = o.id
     where not o.is_refund and o.loyalty_card_id is null and l.promotion_id is null and l.discount_pct > 0
     group by o.cashier_id),
  logs as (
    select tl.cashier_id, count(*) filter (where tl.kind in ('void_line', 'void_qty')) as voids,
           coalesce(sum(tl.amount) filter (where tl.kind in ('void_line', 'void_qty')), 0) as void_amount,
           count(*) filter (where tl.kind = 'void_sale') as cleared
      from public.pos_till_log tl
     where tl.company_id = p_company and tl.at >= v_a and tl.at < v_b
     group by tl.cashier_id),
  cash as (
    select s.opened_by as cashier_id, coalesce(sum(s.cash_difference), 0) as diff, count(*) filter (where s.cash_difference < -0.5) as shorts
      from public.pos_sessions s
     where s.company_id = p_company and s.closed_at >= v_a and s.closed_at < v_b and s.deleted_at is null and s.cash_difference is not null
     group by s.opened_by),
  who as (select cashier_id from base union select cashier_id from logs union select cashier_id from cash)
  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', w.cashier_id, 'name', coalesce(p.full_name, '?'),
           'receipts', coalesce(b.receipts, 0), 'sales', coalesce(b.sales, 0),
           'voids', coalesce(l.voids, 0), 'void_amount', coalesce(l.void_amount, 0),
           'void_pct', case when coalesce(b.sales, 0) > 0 then round(100 * coalesce(l.void_amount, 0) / b.sales, 2) end,
           'cleared', coalesce(l.cleared, 0),
           'refunds_nr', coalesce(b.refunds_nr, 0), 'refunds_nr_amount', coalesce(b.refunds_nr_amount, 0),
           'discount_amount', coalesce(d.amount, 0),
           'discount_pct', case when coalesce(b.sales, 0) > 0 then round(100 * coalesce(d.amount, 0) / b.sales, 2) end,
           'cash_diff', coalesce(c.diff, 0), 'shorts', coalesce(c.shorts, 0)) order by coalesce(b.sales, 0) desc), '[]'::jsonb)
    into v_cash
    from who w left join base b on b.cashier_id = w.cashier_id left join logs l on l.cashier_id = w.cashier_id
    left join disc d on d.cashier_id = w.cashier_id left join cash c on c.cashier_id = w.cashier_id
    left join public.profiles p on p.id = w.cashier_id;

  -- the waiters: what they handed over against what they owed, and items taken back after the kitchen had them
  with h as (
    select waiter_id, count(*) as handovers, coalesce(sum(difference), 0) as diff
      from public.pos_waiter_handovers where company_id = p_company and at >= v_a and at < v_b group by waiter_id),
  v as (
    select waiter_id, count(*) as voided from public.table_order_lines
     where company_id = p_company and status = 'void' and sent_at is not null and waiter_id is not null and updated_at >= v_a and updated_at < v_b
     group by waiter_id),
  who as (select waiter_id from h union select waiter_id from v)
  select coalesce(jsonb_agg(jsonb_build_object('user_id', w.waiter_id, 'name', coalesce(p.full_name, '?'), 'handovers', coalesce(h.handovers, 0),
           'diff', coalesce(h.diff, 0), 'voided', coalesce(v.voided, 0)) order by coalesce(h.diff, 0)), '[]'::jsonb)
    into v_wait
    from who w left join h on h.waiter_id = w.waiter_id left join v on v.waiter_id = w.waiter_id left join public.profiles p on p.id = w.waiter_id;

  -- what the counts found missing, the costliest first
  select coalesce(jsonb_agg(x order by (x ->> 'value_lost')::numeric desc), '[]'::jsonb) into v_items
    from (select jsonb_build_object('variant_id', v.id, 'sku', v.sku, 'name', v.name, 'warehouse', w.name,
                   'qty_lost', sum(-al.quantity_change), 'value_lost', round(sum(-al.quantity_change * al.unit_cost), 2)) as x
            from public.stock_adjustment_lines al join public.stock_adjustments a on a.id = al.adjustment_id
            join public.product_variants v on v.id = al.variant_id join public.warehouses w on w.id = a.warehouse_id
           where a.company_id = p_company and a.reason = 'count' and a.status = 'posted' and al.quantity_change < 0
             and a.posted_at >= v_a and a.posted_at < v_b
           group by v.id, v.sku, v.name, w.name
           order by sum(-al.quantity_change * al.unit_cost) desc limit 10) q;

  -- units with many items below zero: goods sold that were never received, or sold as another item
  select coalesce(jsonb_agg(jsonb_build_object('warehouse_id', x.id, 'name', x.name, 'items', x.n) order by x.n desc), '[]'::jsonb) into v_neg
    from (select w.id, w.name, count(distinct sl.variant_id) as n from public.stock_levels sl join public.warehouses w on w.id = sl.warehouse_id
           where w.company_id = p_company and w.deleted_at is null and sl.on_hand < 0 group by w.id, w.name) x;

  -- the signals: who stands out from the others of the same company
  select percentile_cont(0.5) within group (order by (e ->> 'void_pct')::numeric),
         percentile_cont(0.5) within group (order by (e ->> 'discount_pct')::numeric),
         percentile_cont(0.5) within group (order by 100.0 * (e ->> 'cleared')::numeric / (e ->> 'receipts')::numeric)
    into m_void, m_disc, m_clear
    from jsonb_array_elements(v_cash) e where (e ->> 'receipts')::int >= 20;
  select percentile_cont(0.5) within group (order by (e ->> 'voided')::numeric) into m_wvoid from jsonb_array_elements(v_wait) e;

  for r in select e from jsonb_array_elements(v_cash) e loop
    if (r.e ->> 'voids')::int >= 5 and (r.e ->> 'void_pct')::numeric >= greatest(2 * coalesce(m_void, 0), 1) then
      v_sig := v_sig || jsonb_build_object('kind', 'voids', 'level', case when (r.e ->> 'void_pct')::numeric >= greatest(4 * coalesce(m_void, 0), 3) then 3 else 2 end,
                 'user_id', r.e -> 'user_id', 'name', r.e -> 'name', 'n', r.e -> 'voids', 'value', r.e -> 'void_amount', 'pct', r.e -> 'void_pct', 'peer', round(coalesce(m_void, 0), 2));
    end if;
    if (r.e ->> 'cleared')::int >= 3 and (r.e ->> 'receipts')::int > 0
       and 100.0 * (r.e ->> 'cleared')::numeric / (r.e ->> 'receipts')::numeric >= greatest(2 * coalesce(m_clear, 0), 1) then
      v_sig := v_sig || jsonb_build_object('kind', 'cleared', 'level', 2, 'user_id', r.e -> 'user_id', 'name', r.e -> 'name', 'n', r.e -> 'cleared');
    end if;
    if (r.e ->> 'refunds_nr')::int >= 2 and (r.e ->> 'refunds_nr_amount')::numeric >= 10 then
      v_sig := v_sig || jsonb_build_object('kind', 'refunds', 'level', case when (r.e ->> 'refunds_nr')::int >= 5 then 3 else 2 end,
                 'user_id', r.e -> 'user_id', 'name', r.e -> 'name', 'n', r.e -> 'refunds_nr', 'value', r.e -> 'refunds_nr_amount');
    end if;
    if (r.e ->> 'discount_amount')::numeric >= 10 and (r.e ->> 'discount_pct')::numeric >= greatest(2 * coalesce(m_disc, 0), 2) then
      v_sig := v_sig || jsonb_build_object('kind', 'discounts', 'level', 2, 'user_id', r.e -> 'user_id', 'name', r.e -> 'name',
                 'value', r.e -> 'discount_amount', 'pct', r.e -> 'discount_pct', 'peer', round(coalesce(m_disc, 0), 2));
    end if;
    if (r.e ->> 'cash_diff')::numeric <= -10 or (r.e ->> 'shorts')::int >= 3 then
      v_sig := v_sig || jsonb_build_object('kind', 'cash_short', 'level', case when (r.e ->> 'cash_diff')::numeric <= -50 then 3 else 2 end,
                 'user_id', r.e -> 'user_id', 'name', r.e -> 'name', 'n', r.e -> 'shorts', 'value', r.e -> 'cash_diff');
    end if;
  end loop;
  for r in select e from jsonb_array_elements(v_wait) e loop
    if (r.e ->> 'diff')::numeric <= -5 then
      v_sig := v_sig || jsonb_build_object('kind', 'waiter_short', 'level', case when (r.e ->> 'diff')::numeric <= -30 then 3 else 2 end,
                 'user_id', r.e -> 'user_id', 'name', r.e -> 'name', 'value', r.e -> 'diff');
    end if;
    if (r.e ->> 'voided')::int >= 5 and (r.e ->> 'voided')::numeric >= 2 * coalesce(m_wvoid, 0) and jsonb_array_length(v_wait) > 1 then
      v_sig := v_sig || jsonb_build_object('kind', 'waiter_voids', 'level', 2, 'user_id', r.e -> 'user_id', 'name', r.e -> 'name', 'n', r.e -> 'voided', 'peer', m_wvoid);
    end if;
  end loop;
  for r in select q.e from jsonb_array_elements(v_items) with ordinality as q(e, i) where q.i <= 3 loop
    if (r.e ->> 'value_lost')::numeric >= 20 then
      v_sig := v_sig || jsonb_build_object('kind', 'stock_loss', 'level', case when (r.e ->> 'value_lost')::numeric >= 100 then 2 else 1 end,
                 'name', r.e -> 'name', 'sku', r.e -> 'sku', 'warehouse', r.e -> 'warehouse', 'n', r.e -> 'qty_lost', 'value', r.e -> 'value_lost');
    end if;
  end loop;
  for r in select e from jsonb_array_elements(v_neg) e loop
    if (r.e ->> 'items')::int >= 5 then
      v_sig := v_sig || jsonb_build_object('kind', 'negative', 'level', 1, 'warehouse', r.e -> 'name', 'warehouse_id', r.e -> 'warehouse_id', 'n', r.e -> 'items');
    end if;
  end loop;

  return jsonb_build_object('from', p_from, 'to', p_to,
    'signals', (select coalesce(jsonb_agg(s order by (s ->> 'level')::int desc, s ->> 'kind'), '[]'::jsonb) from jsonb_array_elements(v_sig) s),
    'cashiers', v_cash, 'waiters', v_wait, 'items', v_items, 'negative', v_neg);
end $$;
revoke execute on function app.loss_watch_data(uuid, date, date) from public, anon, authenticated;

create or replace function public.loss_watch(p_company uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'pos.approve');
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose the period' using errcode = '22023'; end if;
  if p_to - p_from > 366 then raise exception 'At most one year at a time' using errcode = '22023'; end if;
  return app.loss_watch_data(p_company, p_from, p_to);
end $$;

revoke execute on function public.count_risk_list(uuid, int), public.daily_counts_now(uuid), public.count_accuracy(uuid, int),
  public.loss_watch(uuid, date, date) from public, anon;
grant execute on function public.count_risk_list(uuid, int), public.daily_counts_now(uuid), public.count_accuracy(uuid, int),
  public.loss_watch(uuid, date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. The automatic tasks: the day's counts every morning; the loss watch on Mondays
-- -----------------------------------------------------------------------------
do $$
declare v_oid oid; v_def text; v_new text; v_anchor text := '  -- new contacts nobody has picked up within a day';
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'tasks_run';
  v_def := pg_get_functiondef(v_oid);
  if position('daily_count' in v_def) > 0 then return; end if;
  if position(v_anchor in v_def) = 0 then raise exception 'tasks_run: the place for the count tasks was not found'; end if;
  v_new := replace(v_def, v_anchor, $x$  -- the day's counts: each person of each unit counts a few of the riskiest items
  if app.auto_on(s, 'daily_count') then
    n := n + app.daily_counts(p_company, greatest(1, least(30, app.auto_days(s, 'daily_count', 8))), v_today);
  end if;

  -- Mondays: the loss watch of the past week, when it found something
  if app.auto_on(s, 'loss_watch') and extract(isodow from v_today) = 1 then
    d := (select count(*) from jsonb_array_elements(app.loss_watch_data(p_company, v_today - 7, v_today - 1) -> 'signals') e where (e ->> 'level')::int >= 2);
    if d > 0 then
      v_who := app.first_with_role(p_company, array['company_admin', 'store_manager']);
      if app.auto_task(p_company, 'loss_watch:' || v_today, 'Detektori i humbjeve: ' || d || ' gjëra për t''u parë nga java e kaluar',
                       v_who, v_today, 1::smallint, 'loss_watch', null, null) then n := n + 1; end if;
    end if;
  end if;

$x$ || v_anchor);
  execute v_new;
end $$;

-- -----------------------------------------------------------------------------
-- 6. The review of a count says why each item of the day's count was picked
-- -----------------------------------------------------------------------------
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;
select app._patch_function('app.count_review__all',
  $x$cl.counted_qty, cl.first_counted_qty, cl.recount,$x$,
  $x$cl.counted_qty, cl.first_counted_qty, cl.recount, cl.reasons,$x$);
select app._patch_function('app.count_review__all',
  $x$'first_counted', first_counted_qty, 'recount', recount,$x$,
  $x$'first_counted', first_counted_qty, 'recount', recount, 'reasons', reasons,$x$);
drop function app._patch_function(text, text, text);
