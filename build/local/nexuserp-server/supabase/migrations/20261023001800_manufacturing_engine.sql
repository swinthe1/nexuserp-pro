-- =============================================================================
-- NexusERP Pro · 1800 · Manufacturing engine (Phase 7)
--
--   BOMs ............ multi-level: a component with its own default BOM is a sub-assembly.
--                     bom_explode (indented tree) and bom_cost (rolled-up material, labour, overhead).
--   Work orders ..... create_work_order copies the BOM (materials + operations), optionally creating
--                     child work orders for sub-assemblies that are short; release snapshots the planned cost.
--   Production ...... consume_materials (FEFO lots, stock → virtual production location, Dr WIP / Cr inventory),
--                     record_operation (labour + overhead: Dr WIP / Cr absorbed), produce (backflush, output at
--                     actual cost: Dr inventory / Cr WIP), close_work_order (what is left in WIP → production variance).
--   Traceability .... lot_genealogy: every consumed lot → every lot produced from it; lot_genealogy_tree up/down.
--   Planning ........ production_plan (demand vs stock vs work in progress), material_availability,
--                     work_center_load, manufacturing_overview; replenishment rules with method 'manufacture'.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Columns, guards, flow
-- -----------------------------------------------------------------------------
alter table public.work_orders
  add column output_value          numeric(18,4) not null default 0,   -- value moved WIP → finished goods
  add column variance_value        numeric(18,4) not null default 0,   -- WIP left at closing → production variance
  add column planned_material_cost numeric(18,4) not null default 0,
  add column planned_labor_cost    numeric(18,4) not null default 0,
  add column planned_overhead_cost numeric(18,4) not null default 0,
  add column output_lot_id         uuid,
  add column released_at           timestamptz,
  add column closed_at             timestamptz,
  add constraint work_orders_output_lot_fkey foreign key (company_id, output_lot_id) references public.lots(company_id, id);
alter table public.work_order_operations
  add column labor_cost    numeric(18,4) not null default 0,
  add column overhead_cost numeric(18,4) not null default 0;
alter table public.work_orders add constraint work_orders_responsible_profile_fkey foreign key (responsible_id) references public.profiles(id);

-- BOM lines and operations are re-saved as a whole (save_document); history on work orders must survive that
alter table public.work_order_materials drop constraint work_order_materials_company_id_bom_line_id_fkey;
alter table public.work_order_materials add constraint work_order_materials_company_id_bom_line_id_fkey
  foreign key (company_id, bom_line_id) references public.bom_lines(company_id, id) on delete set null (bom_line_id);
alter table public.work_order_operations drop constraint work_order_operations_company_id_bom_operation_id_fkey;
alter table public.work_order_operations add constraint work_order_operations_company_id_bom_operation_id_fkey
  foreign key (company_id, bom_operation_id) references public.bom_operations(company_id, id) on delete set null (bom_operation_id);
alter table public.bom_lines drop constraint bom_lines_company_id_operation_id_fkey;
alter table public.bom_lines add constraint bom_lines_company_id_operation_id_fkey
  foreign key (company_id, operation_id) references public.bom_operations(company_id, id) on delete set null (operation_id);

insert into app.document_children values
  ('boms', 'bom_lines', 'bom_id'),
  ('boms', 'bom_operations', 'bom_id')
on conflict do nothing;

-- statuses that only the production functions set
create trigger trg_04_system_statuses before insert or update of status on public.work_orders
  for each row execute function app.tg_system_statuses('released', 'in_progress', 'completed', 'closed');

-- quantities and costs are written by the engine only
create or replace function app.tg_mfg_protect()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not app.is_client_context() then return new; end if;
  if tg_table_name = 'work_orders' then
    if tg_op = 'INSERT' then
      new.quantity_produced := 0; new.quantity_scrapped := 0; new.material_cost := 0; new.labor_cost := 0; new.overhead_cost := 0;
      new.output_value := 0; new.variance_value := 0; new.actual_start := null; new.actual_end := null; new.journal_entry_id := null;
    elsif (new.quantity_produced, new.quantity_scrapped, new.material_cost, new.labor_cost, new.overhead_cost, new.output_value, new.variance_value,
           new.planned_material_cost, new.planned_labor_cost, new.planned_overhead_cost, new.actual_start, new.actual_end, new.output_lot_id)
          is distinct from
          (old.quantity_produced, old.quantity_scrapped, old.material_cost, old.labor_cost, old.overhead_cost, old.output_value, old.variance_value,
           old.planned_material_cost, old.planned_labor_cost, old.planned_overhead_cost, old.actual_start, old.actual_end, old.output_lot_id) then
      raise exception 'Produced quantities and costs are recorded by consuming, reporting work and producing' using errcode = '42501';
    elsif old.status not in ('draft','released') and (new.bom_id, new.variant_id, new.quantity_planned, new.warehouse_id)
                                                    is distinct from (old.bom_id, old.variant_id, old.quantity_planned, old.warehouse_id) then
      raise exception 'A work order in production cannot change its product, BOM or quantity' using errcode = '55000';
    end if;
  elsif tg_table_name = 'work_order_materials' then
    if tg_op = 'INSERT' then new.quantity_consumed := 0;
    elsif new.quantity_consumed is distinct from old.quantity_consumed then
      raise exception 'Consumed quantities come from material consumption' using errcode = '42501';
    end if;
  elsif tg_table_name = 'work_order_operations' then
    if tg_op = 'INSERT' then new.actual_minutes := 0; new.labor_cost := 0; new.overhead_cost := 0; new.status := 'pending';
    elsif (new.actual_minutes, new.labor_cost, new.overhead_cost, new.status) is distinct from (old.actual_minutes, old.labor_cost, old.overhead_cost, old.status) then
      raise exception 'Time on an operation is reported with "Report work"' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger trg_03_protect before insert or update on public.work_orders for each row execute function app.tg_mfg_protect();
create trigger trg_03_protect before insert or update on public.work_order_materials for each row execute function app.tg_mfg_protect();
create trigger trg_03_protect before insert or update on public.work_order_operations for each row execute function app.tg_mfg_protect();

-- a product with a BOM is a manufactured product
create or replace function app.tg_bom_marks_product()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.products p set is_manufactured = true
    from public.product_variants v where v.id = new.variant_id and p.id = v.product_id and not p.is_manufactured;
  return null;
end $$;
create trigger trg_90_mark_manufactured after insert or update of variant_id on public.boms
  for each row execute function app.tg_bom_marks_product();

-- -----------------------------------------------------------------------------
-- 1. Helpers
-- -----------------------------------------------------------------------------
-- Current cost of one unit: weighted average when there is stock history, else the planning (standard) cost
create or replace function app.mfg_unit_cost(p_variant uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(nullif((select ic.avg_cost from public.item_costs ic where ic.variant_id = p_variant), 0),
                  (select v.standard_cost from public.product_variants v where v.id = p_variant), 0)
$$;

create or replace function app.default_bom(p_variant uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select b.id from public.boms b
   where b.variant_id = p_variant and b.is_active and b.deleted_at is null and b.bom_type = 'manufacture'
     and (b.valid_from is null or b.valid_from <= current_date) and (b.valid_to is null or b.valid_to >= current_date)
   order by b.is_default desc, b.version desc limit 1
$$;

-- Where a warehouse keeps its stock: the first pickable internal bin, preferring "…/STOCK"
create or replace function app.main_location(p_warehouse uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select l.id from public.warehouse_locations l
   where l.warehouse_id = p_warehouse and l.is_pickable and l.is_active and l.deleted_at is null and l.location_type = 'internal'
   order by (l.code ilike '%/STOCK') desc, l.code limit 1
$$;

-- Minutes an operation takes for a quantity, corrected for the work center's efficiency
create or replace function app.op_minutes(p_setup numeric, p_run numeric, p_qty numeric, p_efficiency numeric)
returns numeric language sql immutable as $$
  select round((coalesce(p_setup, 0) + coalesce(p_run, 0) * p_qty) * 100 / greatest(coalesce(p_efficiency, 100), 1), 2)
$$;

-- -----------------------------------------------------------------------------
-- 2. BOM explosion and cost roll-up
-- -----------------------------------------------------------------------------
create or replace function public.bom_explode(p_bom uuid, p_qty numeric default null)
returns table (depth int, path text, line_id uuid, bom_id uuid, variant_id uuid, sku text, name text, uom text,
               qty_per numeric, quantity numeric, scrap_pct numeric, sub_bom_id uuid, unit_cost numeric, ext_cost numeric,
               on_hand numeric, available numeric, tracking text)
language sql stable security invoker set search_path = '' as $$
  with recursive tree as (
    select 1 as depth, lpad(bl.line_no::text, 3, '0') as path, bl.id as line_id, bl.bom_id, bl.component_variant_id as variant_id,
           bl.quantity as qty_per, bl.scrap_pct,
           round(bl.quantity * (1 + bl.scrap_pct / 100) * coalesce(p_qty, b.quantity) / b.quantity, 6) as quantity,
           app.default_bom(bl.component_variant_id) as sub_bom_id
      from public.bom_lines bl join public.boms b on b.id = bl.bom_id
     where bl.bom_id = p_bom
    union all
    select t.depth + 1, t.path || '.' || lpad(bl.line_no::text, 3, '0'), bl.id, bl.bom_id, bl.component_variant_id,
           bl.quantity, bl.scrap_pct, round(bl.quantity * (1 + bl.scrap_pct / 100) * t.quantity / b.quantity, 6),
           app.default_bom(bl.component_variant_id)
      from tree t join public.boms b on b.id = t.sub_bom_id join public.bom_lines bl on bl.bom_id = b.id
     where t.depth < 10)
  select t.depth, t.path, t.line_id, t.bom_id, t.variant_id, v.sku, v.name, u.code, t.qty_per, t.quantity, t.scrap_pct, t.sub_bom_id,
         app.mfg_unit_cost(t.variant_id), round(t.quantity * app.mfg_unit_cost(t.variant_id), 4),
         coalesce((select sum(sl.on_hand) from public.stock_levels sl where sl.variant_id = t.variant_id), 0),
         coalesce((select sum(sl.on_hand - sl.reserved) from public.stock_levels sl where sl.variant_id = t.variant_id), 0),
         p.tracking
    from tree t join public.product_variants v on v.id = t.variant_id join public.products p on p.id = v.product_id
    left join public.units_of_measure u on u.id = p.uom_id
   order by t.path
$$;

-- Rolled-up cost of making p_qty with a BOM. Sub-assemblies are costed at their own BOM (p_rollup) or at their
-- current cost when they are in stock (p_rollup = false, used for work orders that take them from stock).
create or replace function app.bom_cost_rec(p_bom uuid, p_qty numeric, p_rollup boolean, p_depth int default 0,
                                            out material numeric, out labor numeric, out overhead numeric)
language plpgsql stable security definer set search_path = '' as $$
declare b public.boms; l record; o record; sub record; v_qty numeric; v_sub uuid; v_min numeric;
begin
  material := 0; labor := 0; overhead := 0;
  select * into b from public.boms where id = p_bom;
  if b.id is null or p_depth > 10 then return; end if;
  for l in select * from public.bom_lines where bom_id = p_bom and not is_optional loop
    v_qty := l.quantity * (1 + l.scrap_pct / 100) * p_qty / b.quantity;
    v_sub := app.default_bom(l.component_variant_id);
    if v_sub is not null and (p_rollup or coalesce((select avg_cost from public.item_costs where variant_id = l.component_variant_id), 0) = 0) then
      select * into sub from app.bom_cost_rec(v_sub, v_qty, p_rollup, p_depth + 1);
      material := material + sub.material; labor := labor + sub.labor; overhead := overhead + sub.overhead;
    else
      material := material + v_qty * app.mfg_unit_cost(l.component_variant_id);
    end if;
  end loop;
  for o in select op.*, wc.cost_per_hour, wc.overhead_per_hour, wc.efficiency_pct
             from public.bom_operations op join public.work_centers wc on wc.id = op.work_center_id where op.bom_id = p_bom loop
    v_min := app.op_minutes(o.setup_minutes, o.run_minutes_per_unit, p_qty, o.efficiency_pct);
    labor := labor + v_min / 60 * o.cost_per_hour;
    overhead := overhead + v_min / 60 * o.overhead_per_hour;
  end loop;
end $$;

create or replace function public.bom_cost(p_bom uuid, p_qty numeric default null, p_rollup boolean default true)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare b public.boms; c record; v_qty numeric;
begin
  select * into b from public.boms where id = p_bom;
  if b.id is null then raise exception 'BOM not found' using errcode = 'P0002'; end if;
  v_qty := coalesce(p_qty, b.quantity);
  select * into c from app.bom_cost_rec(p_bom, v_qty, p_rollup);
  return jsonb_build_object('quantity', v_qty, 'material', round(c.material, 2), 'labor', round(c.labor, 2), 'overhead', round(c.overhead, 2),
                            'total', round(c.material + c.labor + c.overhead, 2),
                            'unit', round((c.material + c.labor + c.overhead) / v_qty, 4),
                            'operations', coalesce((select jsonb_agg(jsonb_build_object('sequence', op.sequence, 'name', op.name, 'work_center', wc.name,
                                  'minutes', app.op_minutes(op.setup_minutes, op.run_minutes_per_unit, v_qty, wc.efficiency_pct),
                                  'labor', round(app.op_minutes(op.setup_minutes, op.run_minutes_per_unit, v_qty, wc.efficiency_pct) / 60 * wc.cost_per_hour, 2),
                                  'overhead', round(app.op_minutes(op.setup_minutes, op.run_minutes_per_unit, v_qty, wc.efficiency_pct) / 60 * wc.overhead_per_hour, 2))
                                  order by op.sequence)
                               from public.bom_operations op join public.work_centers wc on wc.id = op.work_center_id where op.bom_id = p_bom), '[]'::jsonb));
end $$;

-- Products whose BOMs use a component (where-used, one level)
create or replace function public.bom_where_used(p_variant uuid)
returns table (bom_id uuid, bom_code text, variant_id uuid, sku text, name text, quantity numeric, bom_quantity numeric)
language sql stable security invoker set search_path = '' as $$
  select b.id, b.code, b.variant_id, v.sku, v.name, bl.quantity, b.quantity
    from public.bom_lines bl join public.boms b on b.id = bl.bom_id join public.product_variants v on v.id = b.variant_id
   where bl.component_variant_id = p_variant and b.deleted_at is null and b.is_active
   order by v.name
$$;

-- -----------------------------------------------------------------------------
-- 3. Work orders
-- -----------------------------------------------------------------------------
-- p: {bom_id | variant_id, quantity, warehouse_id, planned_start, planned_end, priority, sales_order_id, notes,
--     component_location_id, output_location_id, responsible_id, make_subassemblies, parent_work_order_id}
create or replace function public.create_work_order(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  b public.boms; v_bom uuid; v_qty numeric; v_wh uuid; v_comp uuid; v_out uuid; v_id uuid; l record; o record; v_start timestamptz; v_end timestamptz;
  v_min numeric; v_total_min numeric := 0; v_short numeric; v_sub uuid; c record;
begin
  v_bom := coalesce(nullif(p->>'bom_id', '')::uuid, app.default_bom(nullif(p->>'variant_id', '')::uuid));
  select * into b from public.boms where id = v_bom and deleted_at is null;
  if b.id is null then raise exception 'Choose a product with a bill of materials' using errcode = 'P0002'; end if;
  perform app.require_permission(b.company_id, 'manufacturing.write');
  if not b.is_active then raise exception 'BOM % is not active', b.code using errcode = '55000'; end if;
  if b.bom_type <> 'manufacture' then raise exception 'BOM % is a kit; kits are sold, not produced', b.code using errcode = '23514'; end if;
  if not exists (select 1 from public.bom_lines where bom_id = b.id) then raise exception 'BOM % has no components', b.code using errcode = '23514'; end if;
  v_qty := (p->>'quantity')::numeric;
  if v_qty is null or v_qty <= 0 then raise exception 'Enter the quantity to produce' using errcode = '23514'; end if;
  v_wh := coalesce(nullif(p->>'warehouse_id', '')::uuid,
                   (select id from public.warehouses where company_id = b.company_id and is_active and deleted_at is null order by created_at limit 1));
  v_comp := coalesce(nullif(p->>'component_location_id', '')::uuid, app.main_location(v_wh));
  v_out := coalesce(nullif(p->>'output_location_id', '')::uuid, app.main_location(v_wh));
  if v_comp is null or v_out is null then raise exception 'The warehouse has no stock location for materials and output' using errcode = '23514'; end if;
  if (select warehouse_id from public.warehouse_locations where id = v_comp) is distinct from v_wh
     or (select warehouse_id from public.warehouse_locations where id = v_out) is distinct from v_wh then
    raise exception 'Material and output locations must be in the work order''s warehouse' using errcode = '23514';
  end if;
  v_start := coalesce(nullif(p->>'planned_start', '')::timestamptz, date_trunc('hour', now()) + interval '1 hour');

  insert into public.work_orders (company_id, bom_id, variant_id, parent_work_order_id, sales_order_id, quantity_planned, uom_id, warehouse_id,
                                  component_location_id, output_location_id, planned_start, priority, responsible_id, notes)
  values (b.company_id, b.id, b.variant_id, nullif(p->>'parent_work_order_id', '')::uuid, nullif(p->>'sales_order_id', '')::uuid, v_qty, b.uom_id, v_wh,
          v_comp, v_out, v_start, coalesce((p->>'priority')::smallint, 3), coalesce(nullif(p->>'responsible_id', '')::uuid, auth.uid()), nullif(p->>'notes', ''))
  returning id into v_id;

  for l in select bl.* from public.bom_lines bl where bl.bom_id = b.id and not bl.is_optional order by bl.line_no loop
    insert into public.work_order_materials (company_id, work_order_id, bom_line_id, variant_id, quantity_required)
    values (b.company_id, v_id, l.id, l.component_variant_id, round(l.quantity * (1 + l.scrap_pct / 100) * v_qty / b.quantity, 4));
  end loop;
  for o in select op.*, wc.efficiency_pct from public.bom_operations op join public.work_centers wc on wc.id = op.work_center_id
            where op.bom_id = b.id order by op.sequence loop
    v_min := app.op_minutes(o.setup_minutes, o.run_minutes_per_unit, v_qty, o.efficiency_pct);
    v_total_min := v_total_min + v_min;
    insert into public.work_order_operations (company_id, work_order_id, bom_operation_id, sequence, name, work_center_id, planned_minutes)
    values (b.company_id, v_id, o.id, o.sequence, o.name, o.work_center_id, v_min);
  end loop;
  v_end := coalesce(nullif(p->>'planned_end', '')::timestamptz, v_start + make_interval(mins => greatest(v_total_min, 60)::int));
  select * into c from app.bom_cost_rec(b.id, v_qty, false);
  update public.work_orders set planned_end = v_end, planned_material_cost = round(c.material, 2), planned_labor_cost = round(c.labor, 2),
                                planned_overhead_cost = round(c.overhead, 2)
   where id = v_id;

  -- sub-assemblies that are short become their own work orders, due before this one starts
  if coalesce((p->>'make_subassemblies')::boolean, false) then
    for l in select m.*, app.default_bom(m.variant_id) as sub from public.work_order_materials m where m.work_order_id = v_id loop
      continue when l.sub is null;
      v_short := l.quantity_required
               - coalesce((select sum(sl.on_hand - sl.reserved) from public.stock_levels sl where sl.variant_id = l.variant_id and sl.warehouse_id = v_wh), 0)
               - coalesce((select sum(w.quantity_planned - w.quantity_produced) from public.work_orders w
                            where w.variant_id = l.variant_id and w.warehouse_id = v_wh and w.status in ('draft','released','in_progress') and w.deleted_at is null), 0);
      continue when v_short <= 0;
      perform public.create_work_order(jsonb_build_object('bom_id', l.sub, 'quantity', ceil(v_short), 'warehouse_id', v_wh,
                                                          'parent_work_order_id', v_id, 'sales_order_id', p->>'sales_order_id',
                                                          'planned_start', v_start - interval '1 day', 'planned_end', v_start,
                                                          'priority', coalesce((p->>'priority')::smallint, 3), 'make_subassemblies', true));
    end loop;
  end if;
  return v_id;
end $$;

-- What a work order needs, what it has used, and what is there to use
create or replace function public.material_availability(p_wo uuid)
returns table (material_id uuid, variant_id uuid, sku text, name text, uom text, tracking text, required numeric, consumed numeric, remaining numeric,
               available_at_location numeric, available_in_warehouse numeric, shortage numeric, sub_bom_id uuid, unit_cost numeric, child_work_order text)
language sql stable security invoker set search_path = '' as $$
  select m.id, m.variant_id, v.sku, v.name, u.code, p.tracking, m.quantity_required, m.quantity_consumed,
         greatest(m.quantity_required - m.quantity_consumed, 0),
         coalesce((select sum(sl.on_hand - sl.reserved) from public.stock_levels sl where sl.variant_id = m.variant_id and sl.location_id = w.component_location_id), 0),
         coalesce((select sum(sl.on_hand - sl.reserved) from public.stock_levels sl where sl.variant_id = m.variant_id and sl.warehouse_id = w.warehouse_id), 0),
         greatest(greatest(m.quantity_required - m.quantity_consumed, 0)
                  - coalesce((select sum(sl.on_hand - sl.reserved) from public.stock_levels sl where sl.variant_id = m.variant_id and sl.location_id = w.component_location_id), 0), 0),
         app.default_bom(m.variant_id), app.mfg_unit_cost(m.variant_id),
         (select string_agg(c.number || ' (' || c.status || ')', ', ') from public.work_orders c
           where c.parent_work_order_id = w.id and c.variant_id = m.variant_id and c.deleted_at is null)
    from public.work_order_materials m join public.work_orders w on w.id = m.work_order_id
    join public.product_variants v on v.id = m.variant_id join public.products p on p.id = v.product_id
    left join public.units_of_measure u on u.id = p.uom_id
   where m.work_order_id = p_wo
   order by v.sku
$$;

create or replace function public.release_work_order(p_wo uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w public.work_orders; c record; v_short jsonb;
begin
  select * into w from public.work_orders where id = p_wo for update;
  if w.id is null then raise exception 'Work order not found' using errcode = 'P0002'; end if;
  perform app.require_permission(w.company_id, 'manufacturing.write');
  if w.status <> 'draft' then raise exception 'Work order % is %', w.number, w.status using errcode = '55000'; end if;
  if not exists (select 1 from public.work_order_materials where work_order_id = w.id) then
    raise exception 'Work order % has no materials', w.number using errcode = '23514';
  end if;
  select * into c from app.bom_cost_rec(w.bom_id, w.quantity_planned, false);
  update public.work_orders set status = 'released', released_at = now(), planned_material_cost = round(c.material, 2),
                                planned_labor_cost = round(c.labor, 2), planned_overhead_cost = round(c.overhead, 2)
   where id = w.id;
  select coalesce(jsonb_agg(jsonb_build_object('sku', a.sku, 'name', a.name, 'shortage', a.shortage) order by a.sku), '[]'::jsonb) into v_short
    from public.material_availability(w.id) a where a.shortage > 0;
  return jsonb_build_object('status', 'released', 'shortages', v_short);
end $$;

create or replace function app.wo_start(p_wo uuid)
returns void language sql security definer set search_path = '' as $$
  update public.work_orders set status = 'in_progress', actual_start = coalesce(actual_start, now()) where id = p_wo and status = 'released';
$$;

-- One material line: consume a quantity, from a lot or first-expiry-first, at the work order's material location
create or replace function app.wo_consume_line(p_wo uuid, p_material uuid, p_qty numeric, p_lot uuid default null, p_location uuid default null)
returns numeric language plpgsql security definer set search_path = '' as $$
declare
  w public.work_orders; m public.work_order_materials; v_loc uuid; v_track text; v_prod uuid; v_left numeric; v_take numeric; lt record;
  v_mv uuid; v_cost numeric; v_total numeric := 0; v_free numeric; v_sku text;
begin
  select * into w from public.work_orders where id = p_wo;
  select * into m from public.work_order_materials where id = p_material and work_order_id = p_wo for update;
  if m.id is null then raise exception 'That material is not on work order %', w.number using errcode = '23514'; end if;
  if p_qty is null or p_qty <= 0 then return 0; end if;
  v_loc := coalesce(p_location, w.component_location_id);
  if (select warehouse_id from public.warehouse_locations where id = v_loc) is distinct from w.warehouse_id then
    raise exception 'Materials are taken from the work order''s own warehouse' using errcode = '23514';
  end if;
  select p.tracking, v.sku into v_track, v_sku from public.product_variants v join public.products p on p.id = v.product_id where v.id = m.variant_id;
  v_prod := app.virtual_location(w.company_id, 'production');
  v_left := p_qty;
  for lt in
    select sl.lot_id, sl.on_hand - sl.reserved as free
      from public.stock_levels sl left join public.lots x on x.id = sl.lot_id
     where sl.variant_id = m.variant_id and sl.location_id = v_loc and sl.on_hand - sl.reserved > 0
       and (p_lot is null or sl.lot_id = p_lot)
       and (v_track = 'none' or sl.lot_id is not null)
     order by (x.expiry_date < current_date) nulls first, x.expiry_date nulls last, x.lot_number, sl.lot_id nulls first
  loop
    exit when v_left <= 0;
    v_take := least(v_left, lt.free);
    v_mv := app.post_stock_move(w.company_id, 'production_consume', m.variant_id, v_loc, v_prod, v_take, null, lt.lot_id,
                                'work_order', w.id, m.id, w.number);
    v_cost := (select total_cost from public.stock_movements where id = v_mv);
    insert into public.work_order_consumptions (company_id, work_order_id, material_id, variant_id, lot_id, location_id, quantity, unit_cost, movement_id)
    values (w.company_id, w.id, m.id, m.variant_id, lt.lot_id, v_loc, v_take, round(v_cost / v_take, 6), v_mv);
    v_total := v_total + v_cost; v_left := v_left - v_take;
  end loop;
  if v_left > 0 then
    select coalesce(sum(on_hand - reserved), 0) into v_free from public.stock_levels where variant_id = m.variant_id and location_id = v_loc;
    raise exception 'Not enough % at % (% more needed%)', v_sku, (select code from public.warehouse_locations where id = v_loc), trim_scale(v_left),
      case when p_lot is not null then ' from that lot' else '' end using errcode = 'P0001';
  end if;
  update public.work_order_materials set quantity_consumed = quantity_consumed + p_qty where id = m.id;
  update public.work_orders set material_cost = material_cost + v_total where id = w.id;
  return v_total;
end $$;

-- p_items: [{material_id, quantity, lot_id, location_id}]; null = everything still required (backflush)
create or replace function public.consume_materials(p_wo uuid, p_items jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w public.work_orders; i jsonb; m record; v_value numeric := 0; v_lines int := 0; v_q numeric;
begin
  select * into w from public.work_orders where id = p_wo for update;
  if w.id is null then raise exception 'Work order not found' using errcode = 'P0002'; end if;
  perform app.require_permission(w.company_id, 'manufacturing.write');
  if w.status not in ('released','in_progress') then
    raise exception 'Release work order % before using materials (it is %)', w.number, w.status using errcode = '55000';
  end if;
  if p_items is null then
    for m in select * from public.work_order_materials where work_order_id = w.id and quantity_consumed < quantity_required loop
      v_value := v_value + app.wo_consume_line(w.id, m.id, m.quantity_required - m.quantity_consumed);
      v_lines := v_lines + 1;
    end loop;
  else
    for i in select * from jsonb_array_elements(p_items) loop
      v_q := (i->>'quantity')::numeric;
      continue when coalesce(v_q, 0) = 0;
      if v_q < 0 then raise exception 'Use "Return unused material" to give material back' using errcode = '23514'; end if;
      v_value := v_value + app.wo_consume_line(w.id, (i->>'material_id')::uuid, v_q, nullif(i->>'lot_id', '')::uuid, nullif(i->>'location_id', '')::uuid);
      v_lines := v_lines + 1;
    end loop;
  end if;
  perform app.wo_start(w.id);
  return jsonb_build_object('lines', v_lines, 'value', round(v_value, 2));
end $$;

-- Unused material goes back to stock at the cost it left with; the work order's material cost goes down
create or replace function public.return_materials(p_wo uuid, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w public.work_orders; i jsonb; m public.work_order_materials; v_q numeric; v_left numeric; c record; v_take numeric; v_mv uuid; v_value numeric := 0;
        v_prod uuid;
begin
  select * into w from public.work_orders where id = p_wo for update;
  if w.id is null then raise exception 'Work order not found' using errcode = 'P0002'; end if;
  perform app.require_permission(w.company_id, 'manufacturing.write');
  if w.status not in ('released','in_progress','completed') then raise exception 'Work order % is %', w.number, w.status using errcode = '55000'; end if;
  v_prod := app.virtual_location(w.company_id, 'production');
  for i in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_q := (i->>'quantity')::numeric;
    continue when coalesce(v_q, 0) <= 0;
    select * into m from public.work_order_materials where id = (i->>'material_id')::uuid and work_order_id = w.id for update;
    if m.id is null then raise exception 'That material is not on work order %', w.number using errcode = '23514'; end if;
    if v_q > m.quantity_consumed then raise exception 'Only % was used; that is the most that can come back', trim_scale(m.quantity_consumed) using errcode = '23514'; end if;
    v_left := v_q;
    -- newest consumptions come back first, lot by lot, at their own cost
    for c in select wc.lot_id, wc.unit_cost, sum(wc.quantity) as qty from public.work_order_consumptions wc
              where wc.material_id = m.id group by wc.lot_id, wc.unit_cost order by max(wc.consumed_at) desc loop
      exit when v_left <= 0;
      v_take := least(v_left, c.qty);
      v_mv := app.post_stock_move(w.company_id, 'production_output', m.variant_id, v_prod, w.component_location_id, v_take, c.unit_cost, c.lot_id,
                                  'work_order', w.id, m.id, w.number || ' return');
      v_value := v_value + (select total_cost from public.stock_movements where id = v_mv);
      v_left := v_left - v_take;
    end loop;
    update public.work_order_materials set quantity_consumed = quantity_consumed - v_q where id = m.id;
  end loop;
  update public.work_orders set material_cost = material_cost - v_value where id = w.id;
  return jsonb_build_object('value', round(v_value, 2));
end $$;

-- Report time on an operation: labour and overhead go into WIP at the work center's rates
create or replace function public.record_operation(p_op uuid, p_minutes numeric, p_finish boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.work_order_operations; w public.work_orders; wc public.work_centers; v_labor numeric; v_over numeric; v_tz text; v_lines jsonb;
begin
  select * into o from public.work_order_operations where id = p_op for update;
  if o.id is null then raise exception 'Operation not found' using errcode = 'P0002'; end if;
  select * into w from public.work_orders where id = o.work_order_id for update;
  perform app.require_permission(w.company_id, 'manufacturing.write');
  if w.status not in ('released','in_progress') then raise exception 'Work order % is %', w.number, w.status using errcode = '55000'; end if;
  if coalesce(p_minutes, 0) < 0 then raise exception 'Minutes cannot be negative' using errcode = '23514'; end if;
  if o.status = 'done' and coalesce(p_minutes, 0) > 0 then raise exception 'Operation % is already done', o.name using errcode = '55000'; end if;
  select * into wc from public.work_centers where id = o.work_center_id;
  v_labor := round(coalesce(p_minutes, 0) / 60 * wc.cost_per_hour, 2);
  v_over := round(coalesce(p_minutes, 0) / 60 * wc.overhead_per_hour, 2);
  update public.work_order_operations
     set actual_minutes = actual_minutes + coalesce(p_minutes, 0), labor_cost = labor_cost + v_labor, overhead_cost = overhead_cost + v_over,
         status = case when p_finish then 'done' else 'in_progress' end, started_at = coalesce(started_at, now()),
         finished_at = case when p_finish then now() else finished_at end, operator_id = coalesce(operator_id, auth.uid())
   where id = o.id;
  update public.work_orders set labor_cost = labor_cost + v_labor, overhead_cost = overhead_cost + v_over where id = w.id;
  if v_labor + v_over > 0 then
    select timezone into v_tz from public.companies where id = w.company_id;
    v_lines := jsonb_build_array(jsonb_build_object('account_id', app.acct(w.company_id, 'wip'), 'amount', v_labor + v_over, 'variant_id', w.variant_id,
                                                    'description', o.name || ' · ' || trim_scale(round(p_minutes, 2)) || ' min'));
    if v_labor > 0 then v_lines := v_lines || jsonb_build_object('account_id', app.acct(w.company_id, 'labor_absorbed'), 'amount', -v_labor, 'description', 'Labour ' || wc.name); end if;
    if v_over > 0 then v_lines := v_lines || jsonb_build_object('account_id', app.acct(w.company_id, 'overhead_absorbed'), 'amount', -v_over, 'description', 'Overhead ' || wc.name); end if;
    perform app.gl_post(w.company_id, 'MFG', (now() at time zone coalesce(v_tz, 'Europe/Tirane'))::date, 'work_order', w.id, w.number,
                        'Labour and overhead: ' || w.number || ' · ' || o.name, v_lines, 'op:' || o.id || ':' || txid_current() || ':' || clock_timestamp());
  end if;
  perform app.wo_start(w.id);
  return jsonb_build_object('labor', v_labor, 'overhead', v_over);
end $$;

-- Report finished goods. With p_backflush the materials and operations are brought up to the share of the
-- work order now made. Partial output is valued at the planned unit cost; the last output carries what is left in WIP.
create or replace function public.produce(p_wo uuid, p_qty numeric, p_lot_number text default null, p_expiry date default null,
                                          p_scrap numeric default 0, p_backflush boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  w public.work_orders; m record; o record; v_ratio numeric; v_need numeric; v_final boolean; v_wip numeric; v_value numeric; v_unit numeric;
  v_track text; v_expiry_tracked boolean; v_lot uuid; v_lot_no text; v_prod uuid; v_mv uuid; v_out uuid; g record;
begin
  select * into w from public.work_orders where id = p_wo for update;
  if w.id is null then raise exception 'Work order not found' using errcode = 'P0002'; end if;
  perform app.require_permission(w.company_id, 'manufacturing.write');
  if w.status not in ('released','in_progress') then raise exception 'Work order % is %', w.number, w.status using errcode = '55000'; end if;
  if coalesce(p_qty, 0) <= 0 then raise exception 'Enter the quantity produced' using errcode = '23514'; end if;
  if coalesce(p_scrap, 0) < 0 then raise exception 'Scrap cannot be negative' using errcode = '23514'; end if;

  v_ratio := (w.quantity_produced + w.quantity_scrapped + p_qty + coalesce(p_scrap, 0)) / w.quantity_planned;
  v_final := w.quantity_produced + p_qty >= w.quantity_planned;
  if p_backflush then
    for m in select * from public.work_order_materials where work_order_id = w.id loop
      v_need := round(m.quantity_required * case when v_final then greatest(v_ratio, 1) else v_ratio end, 4) - m.quantity_consumed;
      if v_need > 0 then perform app.wo_consume_line(w.id, m.id, v_need); end if;
    end loop;
    for o in select * from public.work_order_operations where work_order_id = w.id and status <> 'done' loop
      v_need := round(o.planned_minutes * least(v_ratio, 1), 2) - o.actual_minutes;
      if v_need > 0 or v_final then perform public.record_operation(o.id, greatest(v_need, 0), v_final); end if;
    end loop;
  end if;
  perform app.wo_start(w.id);
  select * into w from public.work_orders where id = p_wo;
  v_wip := w.material_cost + w.labor_cost + w.overhead_cost - w.output_value - w.variance_value;
  -- partial output at the planned unit cost (never more than WIP holds); the last output takes everything left,
  -- so the finished goods carry exactly what the work order cost
  v_value := case when v_final then v_wip
                  else least(v_wip, round(p_qty * (w.planned_material_cost + w.planned_labor_cost + w.planned_overhead_cost) / w.quantity_planned, 4)) end;
  if v_value < 0 then v_value := 0; end if;
  v_unit := round(v_value / p_qty, 6);

  -- the lot of the finished product (one lot per work order unless told otherwise)
  select p.tracking, p.track_expiry into v_track, v_expiry_tracked
    from public.product_variants v join public.products p on p.id = v.product_id where v.id = w.variant_id;
  if v_track <> 'none' then
    v_lot_no := coalesce(nullif(btrim(p_lot_number), ''), (select lot_number from public.lots where id = w.output_lot_id), w.number);
    if v_expiry_tracked and p_expiry is null and not exists (select 1 from public.lots where variant_id = w.variant_id and lot_number = v_lot_no and expiry_date is not null) then
      raise exception 'Enter the best-before date for lot %', v_lot_no using errcode = '23514';
    end if;
    select id into v_lot from public.lots where company_id = w.company_id and variant_id = w.variant_id and lot_number = v_lot_no and deleted_at is null;
    if v_lot is null then
      insert into public.lots (company_id, variant_id, lot_number, lot_type, manufacture_date, expiry_date, notes)
      values (w.company_id, w.variant_id, v_lot_no, case when v_track = 'serial' then 'serial' else 'lot' end, current_date, p_expiry, 'Produced by ' || w.number)
      returning id into v_lot;
    end if;
  end if;

  v_prod := app.virtual_location(w.company_id, 'production');
  v_mv := app.post_stock_move(w.company_id, 'production_output', w.variant_id, v_prod, w.output_location_id, p_qty, v_unit, v_lot,
                              'work_order', w.id, null, w.number);
  v_value := (select total_cost from public.stock_movements where id = v_mv);
  insert into public.production_outputs (company_id, work_order_id, variant_id, lot_id, location_id, quantity, output_type, unit_cost, movement_id)
  values (w.company_id, w.id, w.variant_id, v_lot, w.output_location_id, p_qty, 'finished', v_unit, v_mv) returning id into v_out;
  if coalesce(p_scrap, 0) > 0 then
    insert into public.production_outputs (company_id, work_order_id, variant_id, lot_id, location_id, quantity, output_type, unit_cost)
    values (w.company_id, w.id, w.variant_id, v_lot, v_prod, p_scrap, 'scrap', 0);
  end if;

  -- genealogy: every lot consumed so far feeds this lot (only what is not linked yet)
  if v_lot is not null then
    for g in select c.lot_id, sum(c.quantity) as qty from public.work_order_consumptions c
              where c.work_order_id = w.id and c.lot_id is not null group by c.lot_id loop
      v_need := g.qty - coalesce((select sum(quantity) from public.lot_genealogy where work_order_id = w.id and parent_lot_id = g.lot_id and child_lot_id = v_lot), 0);
      if v_need > 0 and g.lot_id <> v_lot then
        insert into public.lot_genealogy (company_id, parent_lot_id, child_lot_id, work_order_id, quantity) values (w.company_id, g.lot_id, v_lot, w.id, v_need);
      end if;
    end loop;
  end if;

  update public.work_orders
     set quantity_produced = quantity_produced + p_qty, quantity_scrapped = quantity_scrapped + coalesce(p_scrap, 0), output_value = output_value + v_value,
         output_lot_id = coalesce(output_lot_id, v_lot), status = case when v_final then 'completed' else status end,
         actual_start = coalesce(actual_start, now()), actual_end = case when v_final then now() else actual_end end
   where id = w.id;
  return jsonb_build_object('output_id', v_out, 'lot_id', v_lot, 'unit_cost', v_unit, 'value', v_value, 'completed', v_final);
end $$;

-- Stop producing early (fewer than planned); closing then settles the costs
create or replace function public.complete_work_order(p_wo uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare w public.work_orders;
begin
  select * into w from public.work_orders where id = p_wo for update;
  if w.id is null then raise exception 'Work order not found' using errcode = 'P0002'; end if;
  perform app.require_permission(w.company_id, 'manufacturing.write');
  if w.status = 'released' then perform app.wo_start(w.id); select * into w from public.work_orders where id = p_wo; end if;
  if w.status <> 'in_progress' then raise exception 'Work order % is %', w.number, w.status using errcode = '55000'; end if;
  update public.work_order_operations set status = 'done', finished_at = coalesce(finished_at, now()) where work_order_id = w.id and status <> 'done';
  update public.work_orders set status = 'completed', actual_end = now() where id = w.id;
  return 'completed';
end $$;

-- Close: whatever is still in WIP for this work order goes to production variance; the work order is final
create or replace function public.close_work_order(p_wo uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w public.work_orders; v_wip numeric; v_tz text; v_je uuid;
begin
  select * into w from public.work_orders where id = p_wo for update;
  if w.id is null then raise exception 'Work order not found' using errcode = 'P0002'; end if;
  perform app.require_permission(w.company_id, 'manufacturing.write');
  if w.status <> 'completed' then raise exception 'Complete work order % first (it is %)', w.number, w.status using errcode = '55000'; end if;
  if exists (select 1 from public.work_orders c where c.parent_work_order_id = w.id and c.status in ('draft','released','in_progress') and c.deleted_at is null) then
    raise exception 'Sub-assembly work orders of % are still open', w.number using errcode = '55000';
  end if;
  v_wip := round(w.material_cost + w.labor_cost + w.overhead_cost - w.output_value - w.variance_value, 2);
  if v_wip <> 0 then
    select timezone into v_tz from public.companies where id = w.company_id;
    v_je := app.gl_post(w.company_id, 'MFG', (now() at time zone coalesce(v_tz, 'Europe/Tirane'))::date, 'work_order', w.id, w.number,
                        'Production variance ' || w.number,
                        jsonb_build_array(jsonb_build_object('account_id', app.acct(w.company_id, 'production_variance'), 'amount', v_wip, 'variant_id', w.variant_id,
                                                             'description', case when v_wip > 0 then 'Cost not absorbed by output' else 'Output valued above cost' end),
                                          jsonb_build_object('account_id', app.acct(w.company_id, 'wip'), 'amount', -v_wip, 'variant_id', w.variant_id, 'description', 'WIP cleared')),
                        'close');
  end if;
  update public.work_orders set status = 'closed', closed_at = now(), variance_value = variance_value + v_wip, journal_entry_id = coalesce(v_je, journal_entry_id)
   where id = w.id;
  return jsonb_build_object('variance', v_wip, 'journal_entry_id', v_je);
end $$;

create or replace function public.cancel_work_order(p_wo uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare w public.work_orders;
begin
  select * into w from public.work_orders where id = p_wo for update;
  if w.id is null then raise exception 'Work order not found' using errcode = 'P0002'; end if;
  perform app.require_permission(w.company_id, 'manufacturing.write');
  if w.status not in ('draft','released') then raise exception 'Work order % is %; complete and close it instead', w.number, w.status using errcode = '55000'; end if;
  if exists (select 1 from public.work_order_consumptions where work_order_id = w.id) or w.labor_cost + w.overhead_cost > 0 then
    raise exception 'Material or time is already booked on %; complete and close it instead', w.number using errcode = '55000';
  end if;
  update public.work_orders set status = 'cancelled' where id = w.id;
  update public.work_orders set status = 'cancelled' where parent_work_order_id = w.id and status in ('draft','released')
     and not exists (select 1 from public.work_order_consumptions c where c.work_order_id = work_orders.id);
  return 'cancelled';
end $$;

-- -----------------------------------------------------------------------------
-- 4. Traceability
-- -----------------------------------------------------------------------------
-- 'up' = what this lot was made from (ingredients, to any depth); 'down' = everything made from it (recall)
create or replace function public.lot_genealogy_tree(p_lot uuid, p_direction text default 'up')
returns table (depth int, lot_id uuid, lot_number text, variant_id uuid, sku text, name text, expiry_date date, vendor text,
               quantity numeric, work_order_id uuid, work_order text, via_lot_id uuid)
language sql stable security invoker set search_path = '' as $$
  with recursive t as (
    select 1 as depth, case when p_direction = 'down' then g.child_lot_id else g.parent_lot_id end as lot_id, g.quantity, g.work_order_id,
           p_lot as via, array[p_lot] as seen
      from public.lot_genealogy g
     where (p_direction = 'down' and g.parent_lot_id = p_lot) or (p_direction <> 'down' and g.child_lot_id = p_lot)
    union all
    select t.depth + 1, case when p_direction = 'down' then g.child_lot_id else g.parent_lot_id end, g.quantity, g.work_order_id, t.lot_id,
           t.seen || t.lot_id
      from t join public.lot_genealogy g on (p_direction = 'down' and g.parent_lot_id = t.lot_id) or (p_direction <> 'down' and g.child_lot_id = t.lot_id)
     where t.depth < 10 and not (case when p_direction = 'down' then g.child_lot_id else g.parent_lot_id end = any (t.seen)))
  select t.depth, t.lot_id, l.lot_number, l.variant_id, v.sku, v.name, l.expiry_date, bp.name, sum(t.quantity), t.work_order_id, w.number, t.via
    from t join public.lots l on l.id = t.lot_id join public.product_variants v on v.id = l.variant_id
    left join public.business_partners bp on bp.id = l.vendor_id
    join public.work_orders w on w.id = t.work_order_id
   group by t.depth, t.lot_id, l.lot_number, l.variant_id, v.sku, v.name, l.expiry_date, bp.name, t.work_order_id, w.number, t.via
   order by t.depth, v.sku, l.lot_number
$$;

-- -----------------------------------------------------------------------------
-- 5. Planning
-- -----------------------------------------------------------------------------
-- Every manufactured product: demand, stock, what is already being made, and what to start
create or replace function public.production_plan(p_company uuid, p_warehouse uuid default null)
returns table (variant_id uuid, sku text, name text, bom_id uuid, bom_code text, bom_quantity numeric, on_hand numeric, reserved numeric,
               sales_demand numeric, component_demand numeric, min_qty numeric, max_qty numeric, in_production numeric,
               projected numeric, suggested numeric, unit_cost numeric, lead_minutes numeric)
language sql stable security invoker set search_path = '' as $$
  with prod as (
    select distinct on (b.variant_id) b.variant_id, b.id as bom_id, b.code, b.quantity
      from public.boms b where b.company_id = p_company and b.is_active and b.deleted_at is null and b.bom_type = 'manufacture'
     order by b.variant_id, b.is_default desc, b.version desc),
  x as (
    select pr.*, v.sku, v.name,
           coalesce((select sum(sl.on_hand) from public.stock_levels sl where sl.variant_id = pr.variant_id and (p_warehouse is null or sl.warehouse_id = p_warehouse)), 0) as on_hand,
           coalesce((select sum(sl.reserved) from public.stock_levels sl where sl.variant_id = pr.variant_id and (p_warehouse is null or sl.warehouse_id = p_warehouse)), 0) as reserved,
           coalesce((select sum(greatest(sol.quantity - coalesce(sol.qty_delivered, 0) - coalesce(sol.qty_reserved, 0), 0))
                       from public.sales_order_lines sol join public.sales_orders so on so.id = sol.sales_order_id
                      where sol.variant_id = pr.variant_id and so.status in ('confirmed','partially_delivered') and so.deleted_at is null
                        and (p_warehouse is null or so.warehouse_id = p_warehouse)), 0) as sales_demand,
           coalesce((select sum(greatest(m.quantity_required - m.quantity_consumed, 0)) from public.work_order_materials m
                       join public.work_orders w on w.id = m.work_order_id
                      where m.variant_id = pr.variant_id and w.status in ('draft','released','in_progress') and w.deleted_at is null
                        and (p_warehouse is null or w.warehouse_id = p_warehouse)), 0) as component_demand,
           coalesce((select sum(r.min_qty) from public.replenishment_rules r where r.variant_id = pr.variant_id and r.is_active and r.deleted_at is null
                        and (p_warehouse is null or r.warehouse_id = p_warehouse)), 0) as min_qty,
           coalesce((select sum(r.max_qty) from public.replenishment_rules r where r.variant_id = pr.variant_id and r.is_active and r.deleted_at is null
                        and (p_warehouse is null or r.warehouse_id = p_warehouse)), 0) as max_qty,
           coalesce((select sum(greatest(w.quantity_planned - w.quantity_produced, 0)) from public.work_orders w
                      where w.variant_id = pr.variant_id and w.status in ('draft','released','in_progress') and w.deleted_at is null
                        and (p_warehouse is null or w.warehouse_id = p_warehouse)), 0) as in_production
      from prod pr join public.product_variants v on v.id = pr.variant_id)
  select x.variant_id, x.sku, x.name, x.bom_id, x.code, x.quantity, x.on_hand, x.reserved, x.sales_demand, x.component_demand, x.min_qty, x.max_qty,
         x.in_production,
         x.on_hand - x.reserved - x.sales_demand - x.component_demand + x.in_production,
         case when x.on_hand - x.reserved - x.sales_demand - x.component_demand + x.in_production < x.min_qty
                or x.on_hand - x.reserved - x.sales_demand - x.component_demand + x.in_production < 0
              then ceil((greatest(x.max_qty, x.min_qty) - (x.on_hand - x.reserved - x.sales_demand - x.component_demand + x.in_production)) / x.quantity) * x.quantity
              else 0 end,
         coalesce(nullif(app.mfg_unit_cost(x.variant_id), 0),
                  (select round((c.material + c.labor + c.overhead) / x.quantity, 4) from app.bom_cost_rec(x.bom_id, x.quantity, true) c)),
         coalesce((select sum(app.op_minutes(op.setup_minutes, op.run_minutes_per_unit, x.quantity, wc.efficiency_pct))
                     from public.bom_operations op join public.work_centers wc on wc.id = op.work_center_id where op.bom_id = x.bom_id), 0)
    from x
   order by (case when x.on_hand - x.reserved - x.sales_demand - x.component_demand + x.in_production < x.min_qty then 0 else 1 end), x.name
$$;

-- Minutes booked on each work center per day (open work orders, by planned start) against capacity (Monday–Saturday)
create or replace function public.work_center_load(p_company uuid, p_from date, p_to date)
returns table (work_center_id uuid, code text, name text, day date, planned_minutes numeric, capacity_minutes numeric, work_orders int)
language sql stable security invoker set search_path = '' as $$
  with d as (select generate_series(p_from, p_to, interval '1 day')::date as day),
  ops as (
    select o.work_center_id, greatest(coalesce(w.planned_start, now())::date, current_date) as day,
           greatest(o.planned_minutes - o.actual_minutes, 0) as mins, w.id as wo
      from public.work_order_operations o join public.work_orders w on w.id = o.work_order_id
     where w.company_id = p_company and w.deleted_at is null and w.status in ('draft','released','in_progress') and o.status <> 'done')
  select wc.id, wc.code, wc.name, d.day,
         coalesce((select sum(ops.mins) from ops where ops.work_center_id = wc.id and ops.day = d.day), 0),
         case when extract(isodow from d.day) = 7 then 0 else wc.capacity_hours_per_day * 60 end,   -- Sundays off
         (select count(distinct ops.wo)::int from ops where ops.work_center_id = wc.id and ops.day = d.day)
    from public.work_centers wc cross join d
   where wc.company_id = p_company and wc.is_active and wc.deleted_at is null
   order by wc.code, d.day
$$;

create or replace function public.manufacturing_overview(p_company uuid, p_from date, p_to date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with w as (select * from public.work_orders where company_id = p_company and deleted_at is null),
  outp as (select po.* from public.production_outputs po join w on w.id = po.work_order_id
            where po.output_type = 'finished' and po.produced_at::date between p_from and p_to)
  select jsonb_build_object(
    'draft', (select count(*) from w where status = 'draft'),
    'released', (select count(*) from w where status = 'released'),
    'in_progress', (select count(*) from w where status = 'in_progress'),
    'completed', (select count(*) from w where status = 'completed'),
    'late', (select count(*) from w where status in ('draft','released','in_progress') and planned_end < now()),
    'produced_value', coalesce((select sum(quantity * unit_cost) from outp), 0),
    'produced_orders', (select count(distinct work_order_id) from outp),
    'wip', coalesce((select sum(material_cost + labor_cost + overhead_cost - output_value - variance_value) from w where status in ('released','in_progress','completed')), 0),
    'variance', coalesce((select sum(variance_value) from w where status = 'closed' and closed_at::date between p_from and p_to), 0),
    'planned_cost', coalesce((select sum(planned_material_cost + planned_labor_cost + planned_overhead_cost) from w where status = 'closed' and closed_at::date between p_from and p_to), 0),
    'actual_cost', coalesce((select sum(total_cost) from w where status = 'closed' and closed_at::date between p_from and p_to), 0),
    'to_make', (select count(*) from public.production_plan(p_company) pp where pp.suggested > 0),
    'by_day', coalesce((select jsonb_agg(jsonb_build_object('day', d, 'value', v) order by d) from (
        select produced_at::date as d, sum(quantity * unit_cost) as v from outp group by 1) x), '[]'::jsonb),
    'top', coalesce((select jsonb_agg(t) from (
        select jsonb_build_object('sku', v.sku, 'name', v.name, 'quantity', sum(outp.quantity), 'value', sum(outp.quantity * outp.unit_cost)) as t
          from outp join public.product_variants v on v.id = outp.variant_id group by v.sku, v.name order by sum(outp.quantity * outp.unit_cost) desc limit 6) y), '[]'::jsonb))
$$;

-- Replenishment: manufactured products count too, and work in progress is incoming supply
create or replace function public.generate_replenishment(p_company uuid, p_warehouse uuid default null)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; v_need numeric; v_vendor uuid; v_moq numeric; v_n int := 0;
begin
  if not (app.has_permission(p_company, 'oms.write') or app.has_permission(p_company, 'procurement.write') or app.has_permission(p_company, 'manufacturing.write')) then
    raise exception 'Permission denied: procurement.write required' using errcode = '42501';
  end if;
  delete from public.replenishment_suggestions
   where company_id = p_company and status = 'open' and (p_warehouse is null or warehouse_id = p_warehouse);
  for r in
    select ru.*,
           coalesce((select sum(sl.on_hand) from public.stock_levels sl where sl.variant_id = ru.variant_id and sl.warehouse_id = ru.warehouse_id), 0) as on_hand,
           coalesce((select sum(sl.reserved) from public.stock_levels sl where sl.variant_id = ru.variant_id and sl.warehouse_id = ru.warehouse_id), 0) as reserved,
           coalesce((select sum(greatest(pl.quantity - pl.qty_received, 0)) from public.purchase_order_lines pl
                       join public.purchase_orders po on po.id = pl.purchase_order_id
                      where pl.variant_id = ru.variant_id and po.warehouse_id = ru.warehouse_id and po.deleted_at is null
                        and po.status in ('draft','pending_approval','approved','sent','partially_received')), 0)
           + coalesce((select sum(greatest(w.quantity_planned - w.quantity_produced, 0)) from public.work_orders w
                        where w.variant_id = ru.variant_id and w.warehouse_id = ru.warehouse_id and w.deleted_at is null
                          and w.status in ('draft','released','in_progress')), 0) as incoming
      from public.replenishment_rules ru
      join public.product_variants v on v.id = ru.variant_id join public.products p on p.id = v.product_id
     where ru.company_id = p_company and ru.is_active and ru.deleted_at is null and v.is_active
       and (p.is_purchasable or ru.replenish_method <> 'buy')
       and (ru.replenish_method <> 'manufacture' or app.default_bom(ru.variant_id) is not null)
       and (p_warehouse is null or ru.warehouse_id = p_warehouse)
  loop
    continue when r.on_hand - r.reserved + r.incoming > r.min_qty;
    v_need := r.max_qty - (r.on_hand - r.reserved + r.incoming);
    continue when v_need <= 0;
    v_need := ceil(v_need / r.multiple_qty) * r.multiple_qty;
    v_vendor := case when r.replenish_method = 'buy' then app.preferred_vendor(p_company, r.variant_id, r.warehouse_id) end;
    select min_order_qty into v_moq from public.vendor_products where vendor_id = v_vendor and variant_id = r.variant_id and deleted_at is null;
    v_need := greatest(v_need, coalesce(v_moq, 0));
    insert into public.replenishment_suggestions (company_id, rule_id, variant_id, warehouse_id, replenish_method, vendor_id,
                                                  on_hand, reserved, incoming, projected, suggested_qty)
    values (p_company, r.id, r.variant_id, r.warehouse_id, r.replenish_method, v_vendor,
            r.on_hand, r.reserved, r.incoming, r.on_hand - r.reserved + r.incoming, v_need);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.create_wos_from_suggestions(p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s record; v_company uuid; v_wo uuid; v_out jsonb := '[]'::jsonb;
begin
  select company_id into v_company from public.replenishment_suggestions where id = any (p_ids) limit 1;
  if v_company is null then raise exception 'Select at least one suggestion' using errcode = '23514'; end if;
  perform app.require_permission(v_company, 'manufacturing.write');
  for s in select * from public.replenishment_suggestions where id = any (p_ids) order by created_at loop
    if s.company_id <> v_company or s.status <> 'open' then raise exception 'Some suggestions were already handled; refresh the list' using errcode = '55000'; end if;
    if s.replenish_method <> 'manufacture' then raise exception 'Only "manufacture" suggestions become work orders' using errcode = '23514'; end if;
    v_wo := public.create_work_order(jsonb_build_object('variant_id', s.variant_id, 'quantity', s.suggested_qty, 'warehouse_id', s.warehouse_id,
                                                        'notes', 'Replenishment', 'make_subassemblies', true));
    update public.replenishment_suggestions set status = 'converted', work_order_id = v_wo where id = s.id;
    v_out := v_out || jsonb_build_object('id', v_wo, 'number', (select number from public.work_orders where id = v_wo));
  end loop;
  return v_out;
end $$;

-- -----------------------------------------------------------------------------
-- 6. Search: work orders and BOMs
-- -----------------------------------------------------------------------------
create or replace function public.global_search(p_company uuid, p_query text, p_limit int default 6)
returns table (kind text, id uuid, title text, subtitle text, href text)
language sql stable security invoker set search_path = '' as $$
  with q as (select '%' || replace(replace(btrim(p_query), '%', '\%'), '_', '\_') || '%' as pat)
  (select 'product', p.id, v.name, v.sku, '/inventory/products/' || p.id
     from public.product_variants v join public.products p on p.id = v.product_id, q
    where v.company_id = p_company and v.deleted_at is null and p.deleted_at is null
      and (v.name ilike q.pat or v.sku ilike q.pat
           or exists (select 1 from public.product_barcodes b where b.variant_id = v.id and b.barcode = btrim(p_query)))
    order by v.name limit p_limit)
  union all
  (select 'partner', bp.id, bp.name, concat_ws(' · ', bp.code, bp.tax_number), '/partners/' || bp.id
     from public.business_partners bp, q
    where bp.company_id = p_company and bp.deleted_at is null
      and (bp.name ilike q.pat or bp.code ilike q.pat or bp.tax_number ilike q.pat or bp.email ilike q.pat)
    order by bp.name limit p_limit)
  union all
  (select 'account', a.id, a.code || ' ' || a.name, 'Account · ' || a.account_type, '/finance/accounts/' || a.id
     from public.accounts a, q
    where a.company_id = p_company and a.deleted_at is null and (a.code ilike btrim(p_query) || '%' or a.name ilike q.pat)
    order by a.code limit 4)
  union all
  (select 'opportunity', o.id, o.name, 'Opportunity · ' || o.status, '/crm/pipeline?open=' || o.id
     from public.opportunities o, q
    where o.company_id = p_company and o.deleted_at is null and (o.name ilike q.pat or o.number ilike q.pat)
    order by o.created_at desc limit 4)
  union all
  (select 'lead', l.id, l.title, concat_ws(' · ', l.company_name, l.contact_name), '/crm/leads?open=' || l.id
     from public.leads l, q
    where l.company_id = p_company and l.deleted_at is null
      and (l.title ilike q.pat or l.company_name ilike q.pat or l.contact_name ilike q.pat or l.number ilike q.pat or l.email ilike q.pat)
    order by l.created_at desc limit 4)
  union all
  (select 'lot', l.id, l.lot_number, 'Lot · ' || v.sku || coalesce(' · expires ' || to_char(l.expiry_date, 'DD Mon YYYY'), ''), '/wms/lots/' || l.id
     from public.lots l join public.product_variants v on v.id = l.variant_id, q
    where l.company_id = p_company and l.deleted_at is null and l.lot_number ilike q.pat
    order by l.expiry_date nulls last limit 4)
  union all
  (select 'bom', b.id, b.code || ' · ' || v.name, 'Bill of materials · v' || b.version, '/manufacturing/boms/' || b.id
     from public.boms b join public.product_variants v on v.id = b.variant_id, q
    where b.company_id = p_company and b.deleted_at is null and (b.code ilike q.pat or b.name ilike q.pat or v.name ilike q.pat or v.sku ilike q.pat)
    order by b.code limit 4)
  union all
  (select 'warehouse', w.id, w.name, w.code, '/inventory/warehouses'
     from public.warehouses w, q
    where w.company_id = p_company and w.deleted_at is null and (w.name ilike q.pat or w.code ilike q.pat)
    limit 3)
  union all
  (select 'vendor_bill', b.id, b.number, 'Vendor bill · ' || b.vendor_invoice_number || ' · ' || b.status, '/procurement/bills/' || b.id
     from public.vendor_bills b, q
    where b.company_id = p_company and b.deleted_at is null and (b.number ilike q.pat or b.vendor_invoice_number ilike q.pat)
    order by b.bill_date desc limit 4)
  union all
  (select d.kind, d.id, d.number, d.label, d.href from (
      select 'goods_receipt' as kind, g.id, g.number, 'Goods receipt · ' || g.status as label, '/inventory/receipts/' || g.id as href, g.company_id, g.deleted_at from public.goods_receipts g
      union all select 'stock_adjustment', a.id, a.number, 'Adjustment · ' || a.status, '/inventory/adjustments/' || a.id, a.company_id, a.deleted_at from public.stock_adjustments a
      union all select 'stock_transfer', t.id, t.number, 'Transfer · ' || t.status, '/inventory/transfers/' || t.id, t.company_id, t.deleted_at from public.stock_transfers t
      union all select 'landed_cost', l.id, l.number, 'Landed cost · ' || l.status, '/inventory/landed-costs/' || l.id, l.company_id, l.deleted_at from public.landed_costs l
      union all select 'purchase_requisition', pr.id, pr.number, 'Requisition · ' || pr.status, '/procurement/requisitions/' || pr.id, pr.company_id, pr.deleted_at from public.purchase_requisitions pr
      union all select 'purchase_order', o.id, o.number, 'Purchase order · ' || o.status, '/procurement/orders/' || o.id, o.company_id, o.deleted_at from public.purchase_orders o
      union all select 'sales_quote', sq.id, sq.number, 'Quote · ' || sq.status, '/sales/quotes/' || sq.id, sq.company_id, sq.deleted_at from public.sales_quotes sq
      union all select 'sales_order', s.id, s.number, 'Sales order · ' || s.status, '/sales/orders/' || s.id, s.company_id, s.deleted_at from public.sales_orders s
      union all select 'delivery', dl.id, dl.number, 'Delivery · ' || dl.status, '/sales/deliveries/' || dl.id, dl.company_id, dl.deleted_at from public.deliveries dl
      union all select 'sales_invoice', i.id, i.number, case when i.document_type = 'credit_note' then 'Credit note · ' else 'Invoice · ' end || i.status, '/sales/invoices/' || i.id, i.company_id, i.deleted_at from public.sales_invoices i
      union all select 'payment', pm.id, pm.number, case when pm.document_type = 'customer_payment' then 'Receipt · ' else 'Payment · ' end || pm.status, '/finance/payments/' || pm.id, pm.company_id, pm.deleted_at from public.payments pm
      union all select 'journal_entry', je.id, je.number, 'Journal entry · ' || coalesce(je.memo, je.status), '/finance/journal/' || je.id, je.company_id, je.deleted_at from public.journal_entries je
      union all select 'fixed_asset', fa.id, fa.number, 'Asset · ' || fa.name, '/finance/assets/' || fa.id, fa.company_id, fa.deleted_at from public.fixed_assets fa
      union all select 'work_order', wo.id, wo.number, 'Work order · ' || replace(wo.status, '_', ' '), '/manufacturing/orders/' || wo.id, wo.company_id, wo.deleted_at from public.work_orders wo
    ) d, q
    where d.company_id = p_company and d.deleted_at is null and d.number ilike q.pat
    order by d.number desc limit p_limit)
$$;

-- -----------------------------------------------------------------------------
-- 7. Grants
-- -----------------------------------------------------------------------------
revoke execute on function public.bom_explode, public.bom_cost, public.bom_where_used, public.create_work_order, public.material_availability,
  public.release_work_order, public.consume_materials, public.return_materials, public.record_operation, public.produce, public.complete_work_order,
  public.close_work_order, public.cancel_work_order, public.lot_genealogy_tree, public.production_plan, public.work_center_load,
  public.manufacturing_overview, public.create_wos_from_suggestions from public, anon;
grant execute on function public.bom_explode, public.bom_cost, public.bom_where_used, public.create_work_order, public.material_availability,
  public.release_work_order, public.consume_materials, public.return_materials, public.record_operation, public.produce, public.complete_work_order,
  public.close_work_order, public.cancel_work_order, public.lot_genealogy_tree, public.production_plan, public.work_center_load,
  public.manufacturing_overview, public.create_wos_from_suggestions to authenticated;
revoke execute on function app.main_location, app.wo_start, app.wo_consume_line from public, anon, authenticated;
