-- =============================================================================
-- NexusERP Pro · 1930 · Order management: replenishment automation (Phase 8)
--
-- * Replenishment nets stock against customer demand that is not reserved yet
--   (open order lines), not only against min / max.
-- * Transfer rules pull from another warehouse's surplus (above its own
--   minimum) and become draft transfers.
-- * A replenishment run generates suggestions and, depending on the company
--   setting, creates draft purchase orders per vendor and warehouse (and
--   submits them for approval when run by a person who may). Every run is
--   logged; procurement is notified. A daily schedule runs it when pg_cron
--   is available (Supabase), as drafts only.
-- * The fulfilment queue lists open order lines with what is reserved,
--   available, short and expected, for the order desk (in_delivery when an
--   open delivery already covers the line).
-- =============================================================================

alter table public.company_settings
  add column auto_replenish_enabled boolean not null default false,
  add column auto_replenish_action  text not null default 'draft_po' check (auto_replenish_action in ('suggest','draft_po','submit_po')),
  add column auto_replenish_hour    smallint not null default 6 check (auto_replenish_hour between 0 and 23);

create table public.replenishment_runs (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  run_at          timestamptz not null default now(),
  trigger_kind    text not null default 'manual' check (trigger_kind in ('manual','schedule')),
  action          text not null,
  suggestions     int not null default 0,
  purchase_orders jsonb not null default '[]'::jsonb,
  transfers       jsonb not null default '[]'::jsonb,
  skipped         jsonb not null default '[]'::jsonb,
  run_by          uuid references auth.users(id)
);
select app.register_table('public.replenishment_runs', 'oms', 'procurement', p_soft_delete => false, p_client_write => false, p_audit => false);
create index replenishment_runs_company_idx on public.replenishment_runs (company_id, run_at desc);

alter table public.replenishment_suggestions
  add column demand numeric(18,4) not null default 0,
  add column source_warehouse_id uuid,
  add column transfer_id uuid,
  add foreign key (company_id, source_warehouse_id) references public.warehouses(company_id, id),
  add foreign key (company_id, transfer_id) references public.stock_transfers(company_id, id);

-- -----------------------------------------------------------------------------
-- 1. Suggestions: min / max against stock, open demand and incoming
-- -----------------------------------------------------------------------------
create or replace function app.replenish_core(p_company uuid, p_warehouse uuid default null)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; v_need numeric; v_vendor uuid; v_moq numeric; v_n int := 0; v_free numeric; v_qty numeric;
begin
  delete from public.replenishment_suggestions
   where company_id = p_company and status = 'open' and (p_warehouse is null or warehouse_id = p_warehouse);
  for r in
    select ru.*,
           coalesce((select sum(sl.on_hand) from public.stock_levels sl where sl.variant_id = ru.variant_id and sl.warehouse_id = ru.warehouse_id), 0) as on_hand,
           coalesce((select sum(sl.reserved) from public.stock_levels sl where sl.variant_id = ru.variant_id and sl.warehouse_id = ru.warehouse_id), 0) as reserved,
           -- ordered by customers, not delivered and not yet reserved
           coalesce((select sum(greatest(sl.quantity - sl.qty_delivered - sl.qty_reserved, 0)) from public.sales_order_lines sl
                       join public.sales_orders so on so.id = sl.sales_order_id
                      where sl.variant_id = ru.variant_id and so.warehouse_id = ru.warehouse_id and so.deleted_at is null
                        and so.status in ('confirmed','partially_delivered')), 0) as demand,
           coalesce((select sum(greatest(pl.quantity - pl.qty_received, 0)) from public.purchase_order_lines pl
                       join public.purchase_orders po on po.id = pl.purchase_order_id
                      where pl.variant_id = ru.variant_id and po.warehouse_id = ru.warehouse_id and po.deleted_at is null
                        and po.status in ('draft','pending_approval','approved','sent','partially_received')), 0)
           + coalesce((select sum(greatest(w.quantity_planned - w.quantity_produced, 0)) from public.work_orders w
                        where w.variant_id = ru.variant_id and w.warehouse_id = ru.warehouse_id and w.deleted_at is null
                          and w.status in ('draft','released','in_progress')), 0)
           + coalesce((select sum(tl.quantity - tl.quantity_done) from public.stock_transfer_lines tl join public.stock_transfers t on t.id = tl.transfer_id
                        where tl.variant_id = ru.variant_id and t.to_warehouse_id = ru.warehouse_id and t.deleted_at is null
                          and t.status in ('draft','in_transit')), 0) as incoming
      from public.replenishment_rules ru
      join public.product_variants v on v.id = ru.variant_id join public.products p on p.id = v.product_id
     where ru.company_id = p_company and ru.is_active and ru.deleted_at is null and v.is_active
       and (p.is_purchasable or ru.replenish_method <> 'buy')
       and (ru.replenish_method <> 'manufacture' or app.default_bom(ru.variant_id) is not null)
       and (ru.replenish_method <> 'transfer' or ru.source_warehouse_id is not null)
       and (p_warehouse is null or ru.warehouse_id = p_warehouse)
  loop
    continue when r.on_hand - r.reserved - r.demand + r.incoming > r.min_qty;
    v_need := r.max_qty - (r.on_hand - r.reserved - r.demand + r.incoming);
    continue when v_need <= 0;
    v_need := ceil(v_need / r.multiple_qty) * r.multiple_qty;
    v_vendor := null;
    if r.replenish_method = 'buy' then
      v_vendor := app.preferred_vendor(p_company, r.variant_id, r.warehouse_id);
      select min_order_qty into v_moq from public.vendor_products where vendor_id = v_vendor and variant_id = r.variant_id and deleted_at is null;
      v_need := greatest(v_need, coalesce(v_moq, 0));
    elsif r.replenish_method = 'transfer' then
      -- only the source's surplus above its own minimum
      select coalesce(sum(sl.on_hand - sl.reserved), 0)
             - coalesce((select min_qty from public.replenishment_rules x where x.variant_id = r.variant_id and x.warehouse_id = r.source_warehouse_id
                           and x.is_active and x.deleted_at is null limit 1), 0)
        into v_free from public.stock_levels sl where sl.variant_id = r.variant_id and sl.warehouse_id = r.source_warehouse_id;
      v_qty := least(v_need, floor(greatest(v_free, 0) / r.multiple_qty) * r.multiple_qty);
      continue when v_qty <= 0;
      v_need := v_qty;
    end if;
    insert into public.replenishment_suggestions (company_id, rule_id, variant_id, warehouse_id, replenish_method, vendor_id, source_warehouse_id,
                                                  on_hand, reserved, demand, incoming, projected, suggested_qty)
    values (p_company, r.id, r.variant_id, r.warehouse_id, r.replenish_method, v_vendor,
            case when r.replenish_method = 'transfer' then r.source_warehouse_id end,
            r.on_hand, r.reserved, r.demand, r.incoming, r.on_hand - r.reserved - r.demand + r.incoming, v_need);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.generate_replenishment(p_company uuid, p_warehouse uuid default null)
returns int language plpgsql security definer set search_path = '' as $$
begin
  if not (app.has_permission(p_company, 'oms.write') or app.has_permission(p_company, 'procurement.write') or app.has_permission(p_company, 'manufacturing.write')) then
    raise exception 'Permission denied: procurement.write required' using errcode = '42501';
  end if;
  return app.replenish_core(p_company, p_warehouse);
end $$;

-- -----------------------------------------------------------------------------
-- 2. Transfers from suggestions
-- -----------------------------------------------------------------------------
create or replace function app.create_transfers(p_company uuid, p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g record; v_tr uuid; v_out jsonb := '[]'::jsonb;
begin
  for g in select s.source_warehouse_id, s.warehouse_id, array_agg(s.id) as ids,
                  jsonb_agg(jsonb_build_object('variant_id', s.variant_id, 'quantity', s.suggested_qty)) as lines
             from public.replenishment_suggestions s
            where s.id = any (p_ids) and s.company_id = p_company and s.status = 'open' and s.replenish_method = 'transfer'
            group by s.source_warehouse_id, s.warehouse_id loop
    insert into public.stock_transfers (company_id, from_warehouse_id, to_warehouse_id, notes)
    values (p_company, g.source_warehouse_id, g.warehouse_id, 'Replenishment') returning id into v_tr;
    insert into public.stock_transfer_lines (company_id, transfer_id, variant_id, from_location_id, to_location_id, quantity)
    select p_company, v_tr, (x ->> 'variant_id')::uuid, app.main_location(g.source_warehouse_id), app.main_location(g.warehouse_id), (x ->> 'quantity')::numeric
      from jsonb_array_elements(g.lines) x;
    update public.replenishment_suggestions set status = 'converted', transfer_id = v_tr where id = any (g.ids);
    v_out := v_out || jsonb_build_object('id', v_tr, 'number', (select number from public.stock_transfers where id = v_tr));
  end loop;
  return v_out;
end $$;

create or replace function public.create_transfers_from_suggestions(p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_company uuid;
begin
  select company_id into v_company from public.replenishment_suggestions where id = any (p_ids) limit 1;
  if v_company is null then raise exception 'Select at least one suggestion' using errcode = '23514'; end if;
  perform app.require_permission(v_company, 'inventory.write');
  if exists (select 1 from public.replenishment_suggestions where id = any (p_ids) and (company_id <> v_company or status <> 'open' or replenish_method <> 'transfer')) then
    raise exception 'Only open "transfer" suggestions become transfers' using errcode = '23514';
  end if;
  return app.create_transfers(v_company, p_ids);
end $$;

-- -----------------------------------------------------------------------------
-- 3. Replenishment run (manual or scheduled)
-- -----------------------------------------------------------------------------
create or replace function app.replenishment_run(p_company uuid, p_trigger text, p_action text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_n int; g record; v_po uuid; v_pos jsonb := '[]'::jsonb; v_tr jsonb := '[]'::jsonb; v_skip jsonb := '[]'::jsonb; v_status text; v_id uuid;
  v_role uuid;
begin
  v_n := app.replenish_core(p_company, null);
  if p_action in ('draft_po','submit_po') then
    for g in select s.vendor_id, s.warehouse_id, array_agg(s.id) as ids,
                    jsonb_agg(jsonb_build_object('variant_id', s.variant_id, 'quantity', s.suggested_qty) order by v.sku) as lines
               from public.replenishment_suggestions s join public.product_variants v on v.id = s.variant_id
              where s.company_id = p_company and s.status = 'open' and s.replenish_method = 'buy' and s.vendor_id is not null
              group by s.vendor_id, s.warehouse_id loop
      v_po := app.create_purchase_order(p_company, g.vendor_id, g.warehouse_id, g.lines, null, null,
                                        case when p_trigger = 'schedule' then 'Automatic replenishment' else 'Replenishment run' end);
      update public.replenishment_suggestions set status = 'converted', purchase_order_id = v_po where id = any (g.ids);
      v_status := 'draft';
      if p_action = 'submit_po' and p_trigger = 'manual' then
        begin
          v_status := public.submit_purchase_order(v_po);
        exception when others then v_status := 'draft';
        end;
      end if;
      v_pos := v_pos || jsonb_build_object('id', v_po, 'number', (select number from public.purchase_orders where id = v_po), 'status', v_status,
                                           'vendor', (select name from public.business_partners where id = g.vendor_id),
                                           'total', (select total from public.purchase_orders where id = v_po));
    end loop;
    select coalesce(jsonb_agg(jsonb_build_object('sku', v.sku, 'reason', 'No vendor')), '[]') into v_skip
      from public.replenishment_suggestions s join public.product_variants v on v.id = s.variant_id
     where s.company_id = p_company and s.status = 'open' and s.replenish_method = 'buy' and s.vendor_id is null;
    v_tr := app.create_transfers(p_company, array(select id from public.replenishment_suggestions where company_id = p_company and status = 'open'
                                                    and replenish_method = 'transfer'));
  end if;
  insert into public.replenishment_runs (company_id, trigger_kind, action, suggestions, purchase_orders, transfers, skipped, run_by)
  values (p_company, p_trigger, p_action, v_n, v_pos, v_tr, v_skip, auth.uid()) returning id into v_id;
  update public.company_settings set extra = extra || jsonb_build_object('last_replenishment_run', now()) where company_id = p_company;
  if jsonb_array_length(v_pos) > 0 or jsonb_array_length(v_tr) > 0 then
    select id into v_role from public.roles where key = 'procurement_manager';
    perform app.notify_role(p_company, v_role, 'info',
                            'Replenishment: ' || jsonb_array_length(v_pos) || ' purchase order' || case when jsonb_array_length(v_pos) = 1 then '' else 's' end
                              || case when jsonb_array_length(v_tr) > 0 then ', ' || jsonb_array_length(v_tr) || ' transfer(s)' else '' end,
                            case when p_trigger = 'schedule' then 'Created as drafts by the daily run' end,
                            '/procurement/replenishment?run=' || v_id, 'replenishment_runs', v_id);
  end if;
  return jsonb_build_object('id', v_id, 'suggestions', v_n, 'purchase_orders', v_pos, 'transfers', v_tr, 'skipped', v_skip);
end $$;

create or replace function public.run_replenishment(p_company uuid, p_action text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_action text;
begin
  perform app.require_permission(p_company, 'procurement.write');
  v_action := coalesce(p_action, (select auto_replenish_action from public.company_settings where company_id = p_company), 'suggest');
  if v_action not in ('suggest','draft_po','submit_po') then raise exception 'Unknown action %', v_action using errcode = '22023'; end if;
  return app.replenishment_run(p_company, 'manual', v_action);
end $$;

-- The job runs every hour; each company is handled at its chosen local hour (drafts only; people submit).
-- p_any_hour runs every company that turned automation on, whatever the time (manual runs, tests).
create or replace function public.run_scheduled_replenishment(p_any_hour boolean default false)
returns int language plpgsql security definer set search_path = '' as $$
declare c record; v_n int := 0;
begin
  for c in select s.company_id, s.auto_replenish_action from public.company_settings s join public.companies co on co.id = s.company_id
            where s.auto_replenish_enabled and co.is_active and co.deleted_at is null
              and (p_any_hour or extract(hour from now() at time zone co.timezone) = s.auto_replenish_hour)
              -- not twice in the same hour
              and not exists (select 1 from public.replenishment_runs r where r.company_id = s.company_id and r.trigger_kind = 'schedule'
                                and r.run_at > now() - interval '50 minutes') loop
    begin
      perform app.replenishment_run(c.company_id, 'schedule', case when c.auto_replenish_action = 'suggest' then 'suggest' else 'draft_po' end);
      v_n := v_n + 1;
    exception when others then
      raise warning 'Replenishment for company % failed: %', c.company_id, sqlerrm;
    end;
  end loop;
  return v_n;
end $$;
revoke execute on function public.run_scheduled_replenishment(boolean) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('nexuserp-replenishment', '5 * * * *', 'select public.run_scheduled_replenishment()');
  end if;
exception when others then
  raise notice 'pg_cron not available (%); schedule public.run_scheduled_replenishment() hourly elsewhere', sqlerrm;
end $$;

-- Procurement owns the automation switches (company settings are otherwise admin-only)
create or replace function public.set_replenishment_automation(p_company uuid, p_enabled boolean default null, p_action text default null, p_hour int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.company_settings;
begin
  perform app.require_permission(p_company, 'procurement.write');
  if p_action is not null and p_action not in ('suggest','draft_po','submit_po') then raise exception 'Unknown action %', p_action using errcode = '22023'; end if;
  if p_hour is not null and p_hour not between 0 and 23 then raise exception 'Choose an hour from 0 to 23' using errcode = '22023'; end if;
  update public.company_settings set auto_replenish_enabled = coalesce(p_enabled, auto_replenish_enabled),
         auto_replenish_action = coalesce(p_action, auto_replenish_action), auto_replenish_hour = coalesce(p_hour, auto_replenish_hour)
   where company_id = p_company returning * into s;
  return jsonb_build_object('enabled', s.auto_replenish_enabled, 'action', s.auto_replenish_action, 'hour', s.auto_replenish_hour);
end $$;
grant execute on function public.set_replenishment_automation(uuid, boolean, text, int) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Fulfilment queue (open order lines)
-- -----------------------------------------------------------------------------
create or replace function public.fulfillment_queue(p_company uuid, p_warehouse uuid default null)
returns table (sales_order_id uuid, order_number text, order_date date, requested_date date, partner text, line_id uuid, variant_id uuid,
               sku text, name text, ordered numeric, delivered numeric, reserved numeric, outstanding numeric, available numeric,
               incoming numeric, next_receipt date, state text)
language sql stable security definer set search_path = '' as $$
  select so.id, so.number, so.order_date, coalesce(l.requested_date, so.requested_date), p.name, l.id, l.variant_id, v.sku, v.name,
         l.quantity, l.qty_delivered, l.qty_reserved, l.quantity - l.qty_delivered,
         coalesce(st.available, 0), coalesce(inc.qty, 0), inc.next_date,
         case when coalesce(od.qty, 0) >= l.quantity - l.qty_delivered then 'in_delivery'
              when l.qty_reserved >= l.quantity - l.qty_delivered then 'ready'
              when l.qty_reserved + coalesce(st.available, 0) >= l.quantity - l.qty_delivered then 'can_reserve'
              when l.qty_reserved + coalesce(st.available, 0) + coalesce(inc.qty, 0) >= l.quantity - l.qty_delivered then 'awaiting_stock'
              else 'short' end
    from public.sales_order_lines l
    join public.sales_orders so on so.id = l.sales_order_id
    join public.business_partners p on p.id = so.partner_id
    join public.product_variants v on v.id = l.variant_id
    join public.products pr on pr.id = v.product_id and pr.product_type = 'stockable'
    left join lateral (select sum(sl.available) as available from public.stock_levels sl where sl.variant_id = l.variant_id and sl.warehouse_id = so.warehouse_id) st on true
    -- already on a delivery that has not left yet (draft or picked)
    left join lateral (select sum(dl.quantity) as qty from public.delivery_lines dl join public.deliveries d on d.id = dl.delivery_id
                        where dl.sales_order_line_id = l.id and d.status in ('draft','ready') and d.deleted_at is null) od on true
    left join lateral (select sum(greatest(pl.quantity - pl.qty_received, 0)) as qty, min(po.expected_date) as next_date
                         from public.purchase_order_lines pl join public.purchase_orders po on po.id = pl.purchase_order_id
                        where pl.variant_id = l.variant_id and po.warehouse_id = so.warehouse_id and po.deleted_at is null
                          and po.status in ('approved','sent','partially_received')) inc on true
   where so.company_id = p_company and so.deleted_at is null and so.status in ('confirmed','partially_delivered')
     and l.quantity > l.qty_delivered and (p_warehouse is null or so.warehouse_id = p_warehouse)
     and app.has_permission(p_company, 'sales.read')
   order by coalesce(l.requested_date, so.requested_date, so.order_date), so.number, l.line_no
$$;

revoke execute on function app.replenish_core(uuid, uuid), app.create_transfers(uuid, uuid[]), app.replenishment_run(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.create_transfers_from_suggestions(uuid[]), public.run_replenishment(uuid, text),
  public.fulfillment_queue(uuid, uuid) to authenticated;
