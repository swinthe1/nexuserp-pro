-- =============================================================================
-- DrisPRO · transfers between units on the floor: packed by scanner, received blind (9.11.2026)
--   · the sending unit packs on the scanner: each scan adds to a draft transfer to another unit, then ships it;
--   · the receiving unit counts what arrived without seeing what was sent. When every line agrees the transfer
--     is received at once. When not, the program names the items (never the quantities) and they are counted
--     again; if they still do not agree, the transfer goes to the manager with both figures, and the manager
--     decides what is missing: a loss or sent back (as before);
--   · items weighed or measured (kg, litres) agree within a small tolerance, so the scale does not make
--     differences that are not there.
-- =============================================================================
alter table public.stock_transfer_lines add column if not exists quantity_counted numeric(18,4) check (quantity_counted >= 0);
alter table public.stock_transfer_lines add column if not exists counted_by uuid references public.profiles(id) deferrable initially immediate;
alter table public.stock_transfer_lines add column if not exists counted_at timestamptz;
alter table public.stock_transfer_lines add column if not exists recount boolean not null default false;
alter table public.stock_transfers add column if not exists receive_rounds int not null default 0;
alter table public.stock_transfers add column if not exists receive_state text check (receive_state in ('counting', 'differences'));
comment on column public.stock_transfer_lines.quantity_counted is 'What the receiving unit counted, blind (before the transfer is received)';
comment on column public.stock_transfers.receive_state is 'counting: the receiving unit is counting blind; differences: counted twice and still different, waiting for the manager';

-- how far a counted quantity may be from the shipped one and still agree: 20 g / 20 ml for what is weighed or measured
create or replace function app.transfer_tolerance(p_variant uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce((select case when u.category in ('weight', 'volume') then round(0.02 / nullif(u.ratio, 0), 6) else 0 end
                     from public.product_variants v join public.products p on p.id = v.product_id
                     join public.units_of_measure u on u.id = p.uom_id where v.id = p_variant), 0)
$$;
revoke execute on function app.transfer_tolerance(uuid) from public, anon, authenticated;

-- packing on the scanner: a draft transfer from my unit to another one
create or replace function public.transfer_pack_start(p_from uuid, p_to uuid, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare f public.warehouses; d public.warehouses; v_id uuid;
begin
  select * into f from public.warehouses where id = p_from and deleted_at is null;
  select * into d from public.warehouses where id = p_to and deleted_at is null;
  if f.id is null or d.id is null or d.company_id <> f.company_id then raise exception 'Warehouse not found' using errcode = 'P0002'; end if;
  perform app.require_permission(f.company_id, 'wms.write');
  perform app.check_warehouse(f.company_id, f.id);
  if f.id = d.id then raise exception 'Choose another unit to send to' using errcode = '23514'; end if;
  if app.main_location(f.id) is null or app.main_location(d.id) is null then
    raise exception 'Both units need a shelf where goods are kept' using errcode = '23514';
  end if;
  insert into public.stock_transfers (company_id, from_warehouse_id, to_warehouse_id, notes)
  values (f.company_id, f.id, d.id, nullif(btrim(coalesce(p_note, '')), '')) returning id into v_id;
  return v_id;
end $$;

-- a scan while packing: the item onto the draft, from the shelf of the sending unit that holds most of it
create or replace function public.transfer_pack_add(p_transfer uuid, p_variant uuid, p_qty numeric, p_lot uuid default null, p_set boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.stock_transfers; ln public.stock_transfer_lines; v_track text; v_from uuid; v_name text;
begin
  select * into t from public.stock_transfers where id = p_transfer and deleted_at is null for update;
  if t.id is null then raise exception 'Transfer not found' using errcode = 'P0002'; end if;
  perform app.require_permission(t.company_id, 'wms.write');
  perform app.check_warehouse(t.company_id, t.from_warehouse_id);
  if t.status <> 'draft' then raise exception 'Only draft transfers can be shipped (this one is %)', t.status using errcode = '55000'; end if;
  select p.tracking, v.name into v_track, v_name from public.product_variants v join public.products p on p.id = v.product_id
   where v.id = p_variant and v.company_id = t.company_id;
  if v_track is null then raise exception 'Unknown product' using errcode = '23503'; end if;
  if v_track <> 'none' and p_lot is null then raise exception 'Scan or choose the lot for this item' using errcode = '23514'; end if;
  if p_qty is null or (p_set and p_qty < 0) then raise exception 'Enter a quantity' using errcode = '23514'; end if;

  select * into ln from public.stock_transfer_lines where transfer_id = t.id and variant_id = p_variant and lot_id is not distinct from p_lot
   order by created_at limit 1;
  if ln.id is null then
    if p_qty <= 0 then return jsonb_build_object('line_id', null, 'quantity', 0, 'name', v_name); end if;
    v_from := coalesce((select sl.location_id from public.stock_levels sl join public.warehouse_locations wl on wl.id = sl.location_id
                         where sl.warehouse_id = t.from_warehouse_id and sl.variant_id = p_variant and sl.lot_id is not distinct from p_lot
                           and wl.location_type = 'internal' and sl.on_hand > 0 order by sl.on_hand desc limit 1),
                       app.main_location(t.from_warehouse_id));
    insert into public.stock_transfer_lines (company_id, transfer_id, variant_id, lot_id, from_location_id, to_location_id, quantity)
    values (t.company_id, t.id, p_variant, p_lot, v_from, app.main_location(t.to_warehouse_id), p_qty)
    returning * into ln;
  else
    if (case when p_set then p_qty else ln.quantity + p_qty end) <= 0 then
      delete from public.stock_transfer_lines where id = ln.id; ln.quantity := 0;
    else
      update public.stock_transfer_lines set quantity = case when p_set then p_qty else quantity + p_qty end where id = ln.id returning * into ln;
    end if;
  end if;
  return jsonb_build_object('line_id', case when ln.quantity > 0 then ln.id end, 'quantity', ln.quantity, 'name', v_name);
end $$;

-- a scan while receiving: counted blind against the transfer's lines of that item; the answer never says what was sent
create or replace function public.transfer_count_add(p_transfer uuid, p_variant uuid, p_qty numeric, p_lot uuid default null, p_set boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.stock_transfers; v_name text; v_left numeric; r record; v_total numeric; v_n int;
begin
  select * into t from public.stock_transfers where id = p_transfer and deleted_at is null for update;
  if t.id is null then raise exception 'Transfer not found' using errcode = 'P0002'; end if;
  perform app.require_permission(t.company_id, 'wms.write');
  perform app.check_warehouse(t.company_id, t.to_warehouse_id);
  if t.status <> 'in_transit' then raise exception 'Only transfers on the road can be received (this one is %)', t.status using errcode = '55000'; end if;
  if t.receive_state = 'differences' then raise exception 'This transfer waits for the manager: it was counted twice with differences' using errcode = '55000'; end if;
  if p_qty is null or (p_set and p_qty < 0) then raise exception 'Enter a quantity' using errcode = '23514'; end if;
  select v.name into v_name from public.product_variants v where v.id = p_variant and v.company_id = t.company_id;
  select count(*) into v_n from public.stock_transfer_lines where transfer_id = t.id and variant_id = p_variant and (p_lot is null or lot_id = p_lot);
  if v_n = 0 then
    raise exception 'This item is not on the transfer: put it aside and tell the manager' using errcode = '23514';
  end if;
  -- the item's lines take the count in order, each up to what it carries, the rest on the last one
  v_total := case when p_set then p_qty
                  else coalesce((select sum(quantity_counted) from public.stock_transfer_lines
                                  where transfer_id = t.id and variant_id = p_variant and (p_lot is null or lot_id = p_lot)), 0) + p_qty end;
  v_total := greatest(v_total, 0);
  v_left := v_total;
  for r in select id, quantity_done, row_number() over (order by created_at, id) as i, count(*) over () as n
             from public.stock_transfer_lines where transfer_id = t.id and variant_id = p_variant and (p_lot is null or lot_id = p_lot)
            order by created_at, id loop
    update public.stock_transfer_lines
       set quantity_counted = case when r.i = r.n then v_left else least(v_left, r.quantity_done) end,
           counted_by = auth.uid(), counted_at = now()
     where id = r.id;
    v_left := v_left - case when r.i = r.n then v_left else least(v_left, r.quantity_done) end;
  end loop;
  if t.receive_state is null then update public.stock_transfers set receive_state = 'counting' where id = t.id; end if;
  return jsonb_build_object('name', v_name, 'counted', v_total);
end $$;

-- the receiver is done counting
create or replace function public.transfer_receive_blind(p_transfer uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.stock_transfers; v_bad jsonb; v_lines jsonb; v_who uuid;
begin
  select * into t from public.stock_transfers where id = p_transfer and deleted_at is null for update;
  if t.id is null then raise exception 'Transfer not found' using errcode = 'P0002'; end if;
  perform app.require_permission(t.company_id, 'wms.write');
  perform app.check_warehouse(t.company_id, t.to_warehouse_id);
  if t.status <> 'in_transit' then raise exception 'Only transfers on the road can be received (this one is %)', t.status using errcode = '55000'; end if;
  if t.receive_state = 'differences' then raise exception 'This transfer waits for the manager: it was counted twice with differences' using errcode = '55000'; end if;

  select coalesce(jsonb_agg(distinct v.name), '[]'::jsonb) into v_bad
    from public.stock_transfer_lines l join public.product_variants v on v.id = l.variant_id
   where l.transfer_id = t.id and abs(coalesce(l.quantity_counted, 0) - l.quantity_done) > app.transfer_tolerance(l.variant_id);

  if jsonb_array_length(v_bad) = 0 then
    select jsonb_agg(jsonb_build_object('line_id', l.id, 'received', coalesce(l.quantity_counted, 0))) into v_lines
      from public.stock_transfer_lines l where l.transfer_id = t.id;
    update public.stock_transfers set receive_state = null, receive_rounds = receive_rounds + 1 where id = t.id;
    perform public.receive_stock_transfer(t.id, v_lines, null);
    return jsonb_build_object('ok', true);
  end if;

  if t.receive_rounds = 0 then
    -- first time: the items that do not agree are counted again, from nothing
    update public.stock_transfer_lines l set quantity_counted = null, recount = true
     where l.transfer_id = t.id and abs(coalesce(l.quantity_counted, 0) - l.quantity_done) > app.transfer_tolerance(l.variant_id);
    update public.stock_transfers set receive_rounds = 1 where id = t.id;
    return jsonb_build_object('ok', false, 'recount', true, 'items', v_bad);
  end if;

  -- counted twice and still different: the manager decides
  update public.stock_transfers set receive_state = 'differences', receive_rounds = receive_rounds + 1 where id = t.id;
  v_who := app.first_with_role(t.company_id, array['store_manager', 'inventory_manager', 'company_admin']);
  perform app.auto_task(t.company_id, 'transfer_diff:' || t.id, 'Transferi ' || t.number || ' ka dallime te pranimi: ' || jsonb_array_length(v_bad) || ' artikuj',
    v_who, current_date, 3::smallint, 'stock_transfers', t.id, t.number,
    'Pranuesi e numëroi dy herë dhe nuk përputhet me atë që u nis. Hapni transferin, shikoni të dy numrat dhe vendosni: humbje apo kthim te dërguesi.');
  return jsonb_build_object('ok', false, 'recount', false, 'to_manager', true, 'items', v_bad);
end $$;

-- the difference task closes when the transfer is received or cancelled
create or replace function app.tg_transfer_done_tasks() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('done', 'cancelled') and old.status is distinct from new.status then
    update public.tasks set status = 'done', completed_at = now()
     where company_id = new.company_id and auto_key = 'transfer_diff:' || new.id and status not in ('done', 'cancelled') and deleted_at is null;
    if new.receive_state is not null then new.receive_state := null; end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_92_done_tasks on public.stock_transfers;
create trigger trg_92_done_tasks before update of status on public.stock_transfers for each row execute function app.tg_transfer_done_tasks();

revoke execute on function public.transfer_pack_start(uuid, uuid, text), public.transfer_pack_add(uuid, uuid, numeric, uuid, boolean),
  public.transfer_count_add(uuid, uuid, numeric, uuid, boolean), public.transfer_receive_blind(uuid) from public, anon;
grant execute on function public.transfer_pack_start(uuid, uuid, text), public.transfer_pack_add(uuid, uuid, numeric, uuid, boolean),
  public.transfer_count_add(uuid, uuid, numeric, uuid, boolean), public.transfer_receive_blind(uuid) to authenticated;
