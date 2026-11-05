-- =============================================================================
-- The deep check, phase 2:
--   min and max from sales   for many items at once: how much each sold a day in the last weeks, the
--                            supplier's delivery days and a few days of safety give the minimum; a cover
--                            of days on top gives the maximum. Shown first, written only when asked.
--   picking store transfers  the central warehouse picks the shops' transfers with the same pick lists as
--                            deliveries: bin by bin, short when short; the transfer then leaves with what
--                            was picked
-- =============================================================================

-- ---------------------------------------------------------------- min and max from sales
create or replace function public.replenishment_from_sales(p_company uuid, p_warehouse uuid, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_days int := greatest(coalesce((p ->> 'days')::int, 28), 7);
  v_lead int := nullif(p ->> 'lead_days', '')::int;
  v_safety numeric := greatest(coalesce((p ->> 'safety_days')::numeric, 2), 0);
  v_cover numeric := greatest(coalesce((p ->> 'cover_days')::numeric, 7), 1);
  v_method text := coalesce(nullif(p ->> 'method', ''), 'buy');
  v_source uuid := nullif(p ->> 'source_warehouse_id', '')::uuid;
  v_category uuid := nullif(p ->> 'category_id', '')::uuid;
  v_apply boolean := coalesce((p ->> 'apply')::boolean, false);
  v_tz text; v_today date; v_rows jsonb; v_n int := 0; r record;
begin
  perform app.require_permission(p_company, case when v_apply then 'procurement.write' else 'procurement.read' end);
  if not exists (select 1 from public.warehouses where id = p_warehouse and company_id = p_company) then
    raise exception 'Choose the warehouse or store' using errcode = '23514';
  end if;
  if v_method not in ('buy', 'transfer') then raise exception 'Bought from a supplier or brought from another warehouse' using errcode = '22023'; end if;
  if v_method = 'transfer' and (v_source is null or v_source = p_warehouse) then
    raise exception 'Choose the warehouse the goods come from' using errcode = '23514';
  end if;
  select timezone into v_tz from public.companies where id = p_company;
  v_today := (now() at time zone coalesce(v_tz, 'Europe/Tirane'))::date;

  create temporary table if not exists _rfs (variant_id uuid, sku text, name text, sold numeric, per_day numeric, lead int, cur_min numeric, cur_max numeric,
                                             new_min numeric, new_max numeric, multiple numeric, rule_id uuid) on commit drop;
  truncate _rfs;
  insert into _rfs
  select x.variant_id, x.sku, x.name, x.sold, round(x.sold / v_days, 3), x.lead, x.min_qty, x.max_qty,
         -- whole units, rounded up to the order multiple
         ceil(ceil(x.sold / v_days * (x.lead + v_safety)) / x.mult) * x.mult,
         ceil(ceil(x.sold / v_days * (x.lead + v_safety + v_cover)) / x.mult) * x.mult,
         x.mult, x.rule_id
    from (
      select v.id as variant_id, v.sku, v.name, s.sold, ru.id as rule_id, ru.min_qty, ru.max_qty, coalesce(nullif(ru.multiple_qty, 0), 1) as mult,
             coalesce(v_lead, ru.lead_time_days::int, 2) as lead
        from (select m.variant_id,
                     sum(case when m.from_warehouse_id = p_warehouse then m.quantity else -m.quantity end) as sold
                from public.stock_movements m
               where m.company_id = p_company and m.movement_type in ('pos_sale', 'pos_return', 'delivery', 'sales_return')
                 and (m.from_warehouse_id = p_warehouse or m.to_warehouse_id = p_warehouse)
                 and m.movement_date >= (v_today - v_days)::timestamp and m.reversed_movement_id is null
               group by m.variant_id) s
        join public.product_variants v on v.id = s.variant_id and v.is_active and v.deleted_at is null
        join public.products p on p.id = v.product_id and p.is_active and p.product_type = 'stockable' and (v_method <> 'buy' or p.is_purchasable)
        left join public.replenishment_rules ru on ru.variant_id = v.id and ru.warehouse_id = p_warehouse and ru.deleted_at is null
       where s.sold > 0 and (v_category is null or p.category_id = v_category)
    ) x;

  if v_apply then
    for r in select * from _rfs where new_max > 0 loop
      if r.rule_id is not null then
        update public.replenishment_rules set min_qty = r.new_min, max_qty = greatest(r.new_max, r.new_min), lead_time_days = r.lead, is_active = true
         where id = r.rule_id;
      else
        insert into public.replenishment_rules (company_id, variant_id, warehouse_id, min_qty, max_qty, multiple_qty, lead_time_days, replenish_method, source_warehouse_id, is_active)
        values (p_company, r.variant_id, p_warehouse, r.new_min, greatest(r.new_max, r.new_min), 1, r.lead, v_method, case when v_method = 'transfer' then v_source end, true);
      end if;
      v_n := v_n + 1;
    end loop;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('variant_id', variant_id, 'sku', sku, 'name', name, 'sold', sold, 'per_day', per_day, 'lead', lead,
           'cur_min', cur_min, 'cur_max', cur_max, 'new_min', new_min, 'new_max', new_max, 'has_rule', rule_id is not null) order by per_day desc, name), '[]'::jsonb)
    into v_rows from _rfs;
  return jsonb_build_object('days', v_days, 'rows', v_rows, 'written', v_n);
end $$;
revoke execute on function public.replenishment_from_sales(uuid, uuid, jsonb) from public, anon;
grant execute on function public.replenishment_from_sales(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- picking store transfers
alter table public.stock_transfers add column if not exists picked_at timestamptz;

create or replace function public.create_transfer_pick_list(p_transfers uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare x record; v_wh uuid; v_company uuid; v_task uuid; v_ref text;
begin
  if coalesce(array_length(p_transfers, 1), 0) = 0 then raise exception 'Choose at least one transfer' using errcode = '23514'; end if;
  select company_id into v_company from public.stock_transfers where id = p_transfers[1];
  if v_company is null then raise exception 'Transfer not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_company, 'wms.write');
  for x in select * from public.stock_transfers where id = any (p_transfers) order by number for update loop
    v_wh := coalesce(v_wh, x.from_warehouse_id);
    if x.company_id <> v_company or x.from_warehouse_id <> v_wh then
      raise exception 'A pick list covers one warehouse; % leaves from another', x.number using errcode = '23514';
    end if;
    if x.status <> 'draft' or x.deleted_at is not null then raise exception 'Transfer % is %; only transfers not yet sent are picked', x.number, x.status using errcode = '55000'; end if;
    if x.is_request then raise exception '% is still a request: accept it first', x.number using errcode = '23514'; end if;
    if exists (select 1 from public.warehouse_task_lines tl join public.warehouse_tasks t on t.id = tl.task_id
                where tl.source_doc_id = x.id and t.task_type = 'pick' and t.status in ('open', 'in_progress') and t.deleted_at is null) then
      raise exception 'Transfer % is already on an open pick list', x.number using errcode = '23514';
    end if;
  end loop;
  select string_agg(number, ', ' order by number) into v_ref from public.stock_transfers where id = any (p_transfers);
  v_task := app.new_task(v_company, 'pick', v_wh, v_ref);
  insert into public.warehouse_task_lines (company_id, task_id, sequence, variant_id, lot_id, from_location_id, quantity, source_doc_type, source_doc_id, source_line_id)
  select v_company, v_task, row_number() over (order by loc.code, v.sku, tl.created_at), tl.variant_id, tl.lot_id, tl.from_location_id, tl.quantity,
         'stock_transfer', tl.transfer_id, tl.id
    from public.stock_transfer_lines tl
    join public.warehouse_locations loc on loc.id = tl.from_location_id
    join public.product_variants v on v.id = tl.variant_id
   where tl.transfer_id = any (p_transfers) and tl.quantity > 0;
  if not found then raise exception 'The transfers have no lines to pick' using errcode = '23514'; end if;
  return v_task;
end $$;
revoke execute on function public.create_transfer_pick_list(uuid[]) from public, anon;
grant execute on function public.create_transfer_pick_list(uuid[]) to authenticated;

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, left(p_old, 60); end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- the bin and the lot picked go onto the transfer's line
select app._patch_function('public.confirm_pick',
  $x$  update public.delivery_lines set location_id = loc.id, lot_id = v_lot where id = tl.source_line_id
     and (location_id is distinct from loc.id or lot_id is distinct from v_lot);$x$,
  $x$  if tl.source_doc_type = 'stock_transfer' then
    update public.stock_transfer_lines set from_location_id = loc.id, lot_id = v_lot where id = tl.source_line_id
       and (from_location_id is distinct from loc.id or lot_id is distinct from v_lot);
  else
    update public.delivery_lines set location_id = loc.id, lot_id = v_lot where id = tl.source_line_id
       and (location_id is distinct from loc.id or lot_id is distinct from v_lot);
  end if;$x$);

-- finishing: a transfer keeps what was picked and is ready to leave
select app._patch_function('public.complete_pick_list',
  $x$declare t public.warehouse_tasks; l record; d record; v_ready int := 0; v_short int := 0; v_empty int := 0;$x$,
  $x$declare t public.warehouse_tasks; l record; d record; v_ready int := 0; v_short int := 0; v_empty int := 0; v_transfers int := 0;$x$);
select app._patch_function('public.complete_pick_list',
  $x$    if l.quantity_done < l.quantity then
      v_short := v_short + 1;
      if l.quantity_done = 0 then delete from public.delivery_lines where id = l.source_line_id;
      else update public.delivery_lines set quantity = l.quantity_done where id = l.source_line_id; end if;
    end if;$x$,
  $x$    if l.quantity_done < l.quantity then
      v_short := v_short + 1;
      if l.source_doc_type = 'stock_transfer' then
        if l.quantity_done = 0 then delete from public.stock_transfer_lines where id = l.source_line_id;
        else update public.stock_transfer_lines set quantity = l.quantity_done where id = l.source_line_id; end if;
      elsif l.quantity_done = 0 then delete from public.delivery_lines where id = l.source_line_id;
      else update public.delivery_lines set quantity = l.quantity_done where id = l.source_line_id; end if;
    end if;$x$);
select app._patch_function('public.complete_pick_list',
  $x$  for d in select distinct tl.source_doc_id as id from public.warehouse_task_lines tl where tl.task_id = t.id loop$x$,
  $x$  for d in select distinct tl.source_doc_id as id from public.warehouse_task_lines tl where tl.task_id = t.id and tl.source_doc_type = 'stock_transfer' loop
    if exists (select 1 from public.stock_transfer_lines where transfer_id = d.id) then
      update public.stock_transfers set picked_at = now() where id = d.id and status = 'draft';
      v_transfers := v_transfers + 1;
    else
      update public.stock_transfers set status = 'cancelled', notes = coalesce(notes || E'\n', '') || 'Nothing could be picked (' || t.number || ')'
       where id = d.id and status = 'draft';
      v_empty := v_empty + 1;
    end if;
  end loop;
  for d in select distinct tl.source_doc_id as id from public.warehouse_task_lines tl where tl.task_id = t.id and coalesce(tl.source_doc_type, 'delivery') = 'delivery' loop$x$);
select app._patch_function('public.complete_pick_list',
  $x$  return jsonb_build_object('ready', v_ready, 'short_lines', v_short, 'nothing_picked', v_empty);$x$,
  $x$  return jsonb_build_object('ready', v_ready, 'transfers', v_transfers, 'short_lines', v_short, 'nothing_picked', v_empty);$x$);

-- a transfer on an open pick list leaves when the picking is done
select app._patch_function('public.ship_stock_transfer',
  $x$  v_road := app.transit_location(t.company_id);$x$,
  $x$  if exists (select 1 from public.warehouse_task_lines tl join public.warehouse_tasks k on k.id = tl.task_id
              where tl.source_doc_id = t.id and k.task_type = 'pick' and k.status in ('open', 'in_progress') and k.deleted_at is null) then
    raise exception 'Transfer % is on a pick list still open: finish the picking first', t.number using errcode = '55000';
  end if;
  v_road := app.transit_location(t.company_id);$x$);
drop function app._patch_function(text, text, text);
