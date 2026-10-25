-- =============================================================================
-- NexusERP Pro · transfers between stores in two steps
--   request (optional) → the sending store ships: stock goes "on the road" (still ours, same value)
--   → the receiving store counts what arrived: missing units are either a loss or go back to the
--   sender, extra units are added; the difference stays on the document for the manager.
-- The one-step transfer (both sides at once) stays for moves inside one store.
-- =============================================================================

alter table public.stock_transfers
  add column is_request     boolean not null default false,   -- asked for by the receiving store
  add column shipped_by     uuid,
  add column received_by    uuid,
  add column has_difference boolean not null default false,
  add column receive_note   text;

alter table public.stock_transfer_lines
  add column quantity_received numeric(18,4) check (quantity_received >= 0),
  add column difference_action text check (difference_action in ('loss', 'return', 'extra'));

-- losses and extras found on receiving post to the books under their own document type
insert into public.document_types (key, name, module, table_name, default_prefix)
values ('transfer_difference', 'Transfer difference', 'inventory', null, 'TRD')
on conflict (key) do nothing;

create index stock_transfers_transit_idx on public.stock_transfers (company_id, shipped_at) where status = 'in_transit';

-- Goods on the road sit in a warehouse of their own, so they stay in stock at their value
-- (no ledger entry on shipping or receiving) and show up as "Goods in transit".
create or replace function app.transit_location(p_company uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_wh uuid; v_loc uuid;
begin
  select id into v_wh from public.warehouses
   where company_id = p_company and warehouse_type = 'transit' and deleted_at is null order by created_at limit 1;
  if v_wh is null then
    insert into public.warehouses (company_id, code, name, warehouse_type)
    values (p_company, 'TRANSIT', 'Goods in transit', 'transit') returning id into v_wh;
  end if;
  select id into v_loc from public.warehouse_locations
   where warehouse_id = v_wh and location_type = 'internal' and deleted_at is null order by created_at limit 1;
  if v_loc is null then
    insert into public.warehouse_locations (company_id, warehouse_id, code, name, location_type, is_pickable)
    values (p_company, v_wh, 'TRANSIT/ROAD', 'On the road', 'internal', false) returning id into v_loc;
  end if;
  return v_loc;
end $$;
revoke execute on function app.transit_location(uuid) from public, anon, authenticated;

-- A posting whose lines cancel out (e.g. one unit lost and one extra unit of the same item on
-- one transfer) makes no journal entry at all, rather than creating one and deleting it again
-- (which needs finance.delete, a right a store clerk does not have).
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;
select app._patch_function('app.gl_post',
  $x$  if not exists (select 1 from _gl) then return null; end if;$x$,
  $x$  if not exists (select 1 from _gl group by account_id, partner_id, cost_center_id, tax_code_id, variant_id having sum(amount) <> 0) then
    return null;
  end if;$x$);
drop function app._patch_function(text, text, text);

-- the sending store ships: everything leaves its shelves and goes on the road
create or replace function public.ship_stock_transfer(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare t public.stock_transfers; l record; v_lines int := 0; v_road uuid;
begin
  select * into t from public.stock_transfers where id = p_id for update;
  if t.id is null then raise exception 'Transfer not found' using errcode = 'P0002'; end if;
  perform app.require_permission(t.company_id, 'wms.write');
  if t.status <> 'draft' then raise exception 'Only draft transfers can be shipped (this one is %)', t.status using errcode = '55000'; end if;
  if t.from_warehouse_id = t.to_warehouse_id then
    raise exception 'Shipping is between two stores; to move stock between shelves use Move stock' using errcode = '23514';
  end if;
  v_road := app.transit_location(t.company_id);

  for l in
    select tl.*, f.warehouse_id as f_wh, f.code as f_code, d.warehouse_id as d_wh, d.code as d_code
      from public.stock_transfer_lines tl
      join public.warehouse_locations f on f.id = tl.from_location_id
      join public.warehouse_locations d on d.id = tl.to_location_id
     where tl.transfer_id = t.id order by tl.created_at, tl.id
  loop
    v_lines := v_lines + 1;
    if l.f_wh is distinct from t.from_warehouse_id then
      raise exception 'Location % is not in the source warehouse', l.f_code using errcode = '23514';
    end if;
    if l.d_wh is distinct from t.to_warehouse_id then
      raise exception 'Location % is not in the destination warehouse', l.d_code using errcode = '23514';
    end if;
    perform app.post_stock_move(t.company_id, 'transfer', l.variant_id, l.from_location_id, v_road,
                                l.quantity, null, l.lot_id, 'stock_transfer', t.id, l.id, t.number, now());
    update public.stock_transfer_lines set quantity_done = quantity where id = l.id;
  end loop;
  if v_lines = 0 then raise exception 'Add at least one line' using errcode = '23514'; end if;

  update public.stock_transfers set status = 'in_transit', shipped_at = now(), shipped_by = auth.uid() where id = t.id;
  return 'in_transit';
end $$;

-- the receiving store confirms what arrived.
-- p_lines: [{line_id, received, action?: 'loss' | 'return'}] — a line not listed arrived complete;
-- missing units are a loss unless they are sent back ('return'); extra units are added.
create or replace function public.receive_stock_transfer(p_id uuid, p_lines jsonb default '[]', p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.stock_transfers; l record; v_road uuid; v_adj uuid; e jsonb;
  v_rec numeric; v_short numeric; v_extra numeric; v_action text; v_diff boolean := false;
  v_lost numeric := 0; v_back numeric := 0; v_more numeric := 0;
begin
  select * into t from public.stock_transfers where id = p_id for update;
  if t.id is null then raise exception 'Transfer not found' using errcode = 'P0002'; end if;
  perform app.require_permission(t.company_id, 'wms.write');
  if t.status <> 'in_transit' then raise exception 'Only transfers on the road can be received (this one is %)', t.status using errcode = '55000'; end if;
  v_road := app.transit_location(t.company_id);
  v_adj := app.virtual_location(t.company_id, 'adjustment');
  -- losses and extras post to the books as their own document ('transfer_difference'): the
  -- shipping movements of the same transfer were committed earlier and stay as they are
  perform set_config('app.pos_allow_negative', 'on', true);   -- the road holds exactly what was shipped

  for l in select * from public.stock_transfer_lines where transfer_id = t.id order by created_at, id loop
    e := null;
    select x.value into e from jsonb_array_elements(coalesce(p_lines, '[]')) as x where x.value ->> 'line_id' = l.id::text limit 1;
    v_rec := coalesce(nullif(e ->> 'received', '')::numeric, l.quantity_done);
    if v_rec < 0 then raise exception 'A received quantity cannot be negative' using errcode = '23514'; end if;
    v_short := greatest(l.quantity_done - v_rec, 0);
    v_extra := greatest(v_rec - l.quantity_done, 0);
    v_action := null;

    if least(v_rec, l.quantity_done) > 0 then
      perform app.post_stock_move(t.company_id, 'transfer', l.variant_id, v_road, l.to_location_id,
                                  least(v_rec, l.quantity_done), null, l.lot_id, 'stock_transfer', t.id, l.id, t.number, now());
    end if;
    if v_short > 0 then
      v_action := case when e ->> 'action' = 'return' then 'return' else 'loss' end;
      if v_action = 'return' then
        perform app.post_stock_move(t.company_id, 'transfer', l.variant_id, v_road, l.from_location_id,
                                    v_short, null, l.lot_id, 'stock_transfer', t.id, l.id, t.number, now());
        v_back := v_back + v_short;
      else
        perform app.post_stock_move(t.company_id, 'adjustment_out', l.variant_id, v_road, v_adj,
                                    v_short, null, l.lot_id, 'transfer_difference', t.id, l.id, t.number, now());
        v_lost := v_lost + v_short;
      end if;
    elsif v_extra > 0 then
      v_action := 'extra';
      perform app.post_stock_move(t.company_id, 'adjustment_in', l.variant_id, v_adj, l.to_location_id,
                                  v_extra, null, l.lot_id, 'transfer_difference', t.id, l.id, t.number, now());
      v_more := v_more + v_extra;
    end if;
    v_diff := v_diff or v_action is not null;
    update public.stock_transfer_lines set quantity_received = v_rec, difference_action = v_action where id = l.id;
  end loop;
  perform set_config('app.pos_allow_negative', 'off', true);

  update public.stock_transfers
     set status = 'done', received_at = now(), received_by = auth.uid(), has_difference = v_diff,
         receive_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = t.id;
  return jsonb_build_object('status', 'done', 'difference', v_diff, 'lost', v_lost, 'returned', v_back, 'extra', v_more);
end $$;

-- goods on the road, for the dashboard: how many transfers, how many over a day, and their value
create or replace function public.transfers_on_the_road(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'inventory.read');
  return (
    select jsonb_build_object(
      'count', count(*),
      'late', count(*) filter (where t.shipped_at < now() - interval '24 hours'),
      'requests', (select count(*) from public.stock_transfers r where r.company_id = p_company and r.status = 'draft' and r.is_request and r.deleted_at is null),
      'value', coalesce((select sum(l.quantity_done * coalesce(ic.avg_cost, 0))
                           from public.stock_transfer_lines l join public.stock_transfers x on x.id = l.transfer_id
                           left join public.item_costs ic on ic.company_id = l.company_id and ic.variant_id = l.variant_id
                          where x.company_id = p_company and x.status = 'in_transit' and x.deleted_at is null), 0))
      from public.stock_transfers t
     where t.company_id = p_company and t.status = 'in_transit' and t.deleted_at is null);
end $$;

revoke execute on function public.ship_stock_transfer(uuid), public.receive_stock_transfer(uuid, jsonb, text), public.transfers_on_the_road(uuid) from public, anon;
grant execute on function public.ship_stock_transfer(uuid), public.receive_stock_transfer(uuid, jsonb, text), public.transfers_on_the_road(uuid) to authenticated;
