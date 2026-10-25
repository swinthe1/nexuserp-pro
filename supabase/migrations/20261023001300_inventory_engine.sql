-- =============================================================================
-- DrisPRO · 1300 · Phase 2 — Inventory & advanced costing engine
--
-- One function moves stock: app.post_stock_move(). Every posting document
-- (receipt, adjustment, transfer, and later delivery / POS / production)
-- calls it, so the rules live in exactly one place:
--   * stock always moves FROM one location TO another (virtual locations for
--     suppliers, customers, adjustments, scrap) — quantities are conserved
--   * the item_costs row of the variant is locked FOR UPDATE, so concurrent
--     postings of the same item are serialised and the average stays exact
--   * inbound (virtual → owned): weighted average cost is recomputed
--       new_avg = (qty_before × avg_before + qty_in × cost_in) / (qty_before + qty_in)
--     (if stock was negative, the deficit is settled at the incoming cost and
--      the difference is recorded as a 'revaluation' movement)
--   * outbound (owned → virtual): valued at the current average; the last
--     unit out takes the exact remaining value, so no rounding residue stays
--   * internal (owned → owned): no valuation change
--   * negative stock is refused unless company_settings.allow_negative_stock
--   * lot/serial-tracked products require a lot
--   * low-stock alerts open/resolve as availability crosses the reorder point
--
-- Imports: receipts carry currency + customs exchange rate and a clearance
-- status. Freight/customs/insurance arriving later are posted as a landed
-- cost: allocated by value/qty/weight/volume, capitalised into the average
-- cost for the part still in stock, and the part already sold is recorded as
-- expensed (it goes to COGS when GL posting arrives in Phase 5).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Schema additions
-- -----------------------------------------------------------------------------
alter table public.goods_receipts
  add column currency_code              char(3) references public.currencies(code),
  add column exchange_rate              numeric(18,8) check (exchange_rate > 0),
  add column is_import                  boolean not null default false,
  add column origin_country             char(2),
  add column customs_declaration_number text,      -- DUD / customs declaration
  add column customs_declaration_date   date,
  add column clearance_status           text not null default 'not_required'
                                        check (clearance_status in ('not_required','pending','cleared')),
  add column cleared_at                 timestamptz;

alter table public.goods_receipt_lines
  add column unit_price numeric(18,6) check (unit_price >= 0);   -- in receipt currency, net of discount, excl. VAT
comment on column public.goods_receipt_lines.unit_cost is 'Base-currency cost per unit used for valuation (set at posting).';

alter table public.landed_cost_allocations
  add column capitalized_amount numeric(18,4) not null default 0,
  add column expensed_amount    numeric(18,4) not null default 0;

-- 'revaluation' = value-only correction (negative-stock settlement)
alter table public.stock_movements drop constraint stock_movements_movement_type_check;
alter table public.stock_movements add constraint stock_movements_movement_type_check check (movement_type in (
  'receipt','purchase_return','delivery','sales_return','pos_sale','pos_return',
  'transfer','adjustment_in','adjustment_out','production_consume','production_output',
  'scrap','landed_cost','opening','revaluation'));

insert into public.document_types (key, name, module, table_name, default_prefix)
values ('internal_barcode', 'Internal barcode (EAN-13, prefix 200)', 'inventory', null, '200')
on conflict (key) do nothing;

-- Low-stock alerts (one live alert per variant × warehouse)
create table public.stock_alerts (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  variant_id      uuid not null,
  warehouse_id    uuid not null,
  rule_id         uuid,
  status          text not null default 'open' check (status in ('open','acknowledged','resolved')),
  available_qty   numeric(18,4) not null,
  min_qty         numeric(18,4) not null,
  triggered_at    timestamptz not null default now(),
  acknowledged_by uuid references auth.users(id),
  acknowledged_at timestamptz,
  resolved_at     timestamptz,
  foreign key (company_id, variant_id)   references public.product_variants(company_id, id),
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id),
  foreign key (company_id, rule_id)      references public.replenishment_rules(company_id, id)
);
select app.register_table('public.stock_alerts', 'inventory', p_soft_delete => false, p_client_write => false, p_audit => false);
create unique index stock_alerts_live on public.stock_alerts (variant_id, warehouse_id) where status in ('open','acknowledged');
create index stock_alerts_status_idx on public.stock_alerts (company_id, status);

-- -----------------------------------------------------------------------------
-- Receipt defaults: currency & customs rate come from the PO / rate table
-- -----------------------------------------------------------------------------
create or replace function app.tg_receipt_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
declare po public.purchase_orders;
begin
  if new.purchase_order_id is not null then
    select * into po from public.purchase_orders where id = new.purchase_order_id;
    new.vendor_id     := coalesce(new.vendor_id, po.vendor_id);
    new.currency_code := coalesce(new.currency_code, po.currency_code);
    if new.currency_code <> po.currency_code then
      raise exception 'Receipt currency (%) must match the purchase order currency (%)', new.currency_code, po.currency_code
        using errcode = '23514';
    end if;
    if new.exchange_rate is null and new.currency_code = po.currency_code then
      new.exchange_rate := coalesce(app.exchange_rate(new.company_id, new.currency_code, new.receipt_date), po.exchange_rate);
    end if;
  end if;
  new.currency_code := coalesce(new.currency_code, (select base_currency from public.companies where id = new.company_id));
  new.exchange_rate := coalesce(new.exchange_rate, app.exchange_rate(new.company_id, new.currency_code, new.receipt_date));
  if new.exchange_rate is null then
    raise exception 'No exchange rate for % on %; enter the customs rate on the receipt', new.currency_code, new.receipt_date
      using errcode = '23514';
  end if;
  if new.is_import and new.clearance_status = 'not_required' and tg_op = 'INSERT' then
    new.clearance_status := 'pending';
  end if;
  return new;
end $$;
create trigger trg_03_defaults before insert or update of purchase_order_id, currency_code, exchange_rate, is_import
  on public.goods_receipts for each row execute function app.tg_receipt_defaults();

-- -----------------------------------------------------------------------------
-- Barcodes: GTIN check digits + internal EAN-13 generator
-- -----------------------------------------------------------------------------
create or replace function app.gtin_check_digit(p_body text)
returns int language sql immutable set search_path = '' as $$
  select (10 - (sum(substr(reverse(p_body), i, 1)::int * case when i % 2 = 1 then 3 else 1 end) % 10)::int) % 10
    from generate_series(1, length(p_body)) as i
$$;

create or replace function app.tg_validate_barcode()
returns trigger language plpgsql set search_path = '' as $$
declare v_len int := case new.symbology when 'ean13' then 13 when 'ean8' then 8 when 'upca' then 12 end;
begin
  new.barcode := btrim(new.barcode);
  if v_len is not null then
    if new.barcode !~ '^[0-9]+$' or length(new.barcode) <> v_len then
      raise exception '% barcode must be exactly % digits', upper(new.symbology), v_len using errcode = '23514';
    end if;
    if right(new.barcode, 1)::int <> app.gtin_check_digit(left(new.barcode, v_len - 1)) then
      raise exception 'Invalid % check digit in %', upper(new.symbology), new.barcode using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger trg_04_validate before insert or update of barcode, symbology on public.product_barcodes
  for each row execute function app.tg_validate_barcode();

-- In-store EAN-13 (GS1 prefix 20–29 is reserved for internal use): 200 + 9-digit counter + check digit
create or replace function public.generate_internal_barcode(p_company uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare v_body text;
begin
  perform app.require_permission(p_company, 'inventory.write');
  insert into public.document_sequences (company_id, doc_type, prefix, include_year, padding, reset_policy)
  values (p_company, 'internal_barcode', '200', false, 9, 'never')
  on conflict (company_id, doc_type) do nothing;
  loop
    v_body := app.next_document_number(p_company, 'internal_barcode');
    exit when not exists (select 1 from public.product_barcodes
                           where company_id = p_company and barcode = v_body || app.gtin_check_digit(v_body)::text);
  end loop;
  return v_body || app.gtin_check_digit(v_body)::text;
end $$;

-- -----------------------------------------------------------------------------
-- Internal helpers (invoker functions; only ever run inside definer RPCs)
-- -----------------------------------------------------------------------------
create or replace function app.virtual_location(p_company uuid, p_type text)
returns uuid language plpgsql stable set search_path = '' as $$
declare v uuid;
begin
  select id into v from public.warehouse_locations
   where company_id = p_company and location_type = p_type and warehouse_id is null and deleted_at is null
   order by created_at limit 1;
  if v is null then raise exception 'Virtual % location is missing for this company', p_type; end if;
  return v;
end $$;

create or replace function app.bump_stock_level(
  p_company uuid, p_variant uuid, p_warehouse uuid, p_location uuid, p_lot uuid,
  p_on_hand_delta numeric, p_reserved_delta numeric, p_at timestamptz)
returns void language sql set search_path = '' as $$
  insert into public.stock_levels as sl (company_id, variant_id, warehouse_id, location_id, lot_id, on_hand, reserved, last_movement_at)
  values (p_company, p_variant, p_warehouse, p_location, p_lot, p_on_hand_delta, p_reserved_delta,
          case when p_on_hand_delta <> 0 then p_at end)
  on conflict (company_id, variant_id, location_id, lot_id) do update
     set on_hand  = sl.on_hand + excluded.on_hand,
         reserved = sl.reserved + excluded.reserved,
         last_movement_at = coalesce(excluded.last_movement_at, sl.last_movement_at);
$$;

-- Opens / refreshes / resolves the low-stock alert for one variant × warehouse
create or replace function app.check_low_stock(p_company uuid, p_variant uuid, p_warehouse uuid)
returns void language plpgsql set search_path = '' as $$
declare r public.replenishment_rules; a public.stock_alerts; v_avail numeric; v_sku text; v_wh text;
begin
  if p_warehouse is null then return; end if;
  select * into r from public.replenishment_rules
   where company_id = p_company and variant_id = p_variant and warehouse_id = p_warehouse
     and is_active and deleted_at is null;
  select * into a from public.stock_alerts
   where variant_id = p_variant and warehouse_id = p_warehouse and status in ('open','acknowledged');

  if r.id is null then
    if a.id is not null then
      update public.stock_alerts set status = 'resolved', resolved_at = now() where id = a.id;
    end if;
    return;
  end if;

  select coalesce(sum(available), 0) into v_avail from public.stock_levels
   where company_id = p_company and variant_id = p_variant and warehouse_id = p_warehouse;

  if v_avail <= r.min_qty then
    if a.id is null then
      insert into public.stock_alerts (company_id, variant_id, warehouse_id, rule_id, available_qty, min_qty)
      values (p_company, p_variant, p_warehouse, r.id, v_avail, r.min_qty);
      select sku into v_sku from public.product_variants where id = p_variant;
      select name into v_wh from public.warehouses where id = p_warehouse;
      perform app.notify_role(p_company, ro.id, 'alert',
                              'Low stock: ' || v_sku,
                              format('%s available in %s (reorder point %s)', trim_scale(v_avail), v_wh, trim_scale(r.min_qty)),
                              '/inventory/alerts', 'product_variants', p_variant)
         from public.roles ro where ro.key in ('inventory_manager', 'procurement_manager');
    else
      update public.stock_alerts set available_qty = v_avail, min_qty = r.min_qty where id = a.id;
    end if;
  elsif a.id is not null then
    update public.stock_alerts set status = 'resolved', resolved_at = now(), available_qty = v_avail where id = a.id;
  end if;
end $$;

create or replace function app.tg_rule_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.check_low_stock(new.company_id, new.variant_id, new.warehouse_id);
  return null;
end $$;
create trigger trg_80_check_alert after insert or update on public.replenishment_rules
  for each row execute function app.tg_rule_changed();

-- =============================================================================
-- THE stock posting primitive
-- =============================================================================
create or replace function app.post_stock_move(
  p_company     uuid,
  p_type        text,
  p_variant     uuid,
  p_from        uuid,
  p_to          uuid,
  p_qty         numeric,
  p_unit_cost   numeric     default null,   -- inbound cost (base currency); null = current average
  p_lot         uuid        default null,
  p_source_type text        default null,
  p_source_id   uuid        default null,
  p_source_line uuid        default null,
  p_reference   text        default null,
  p_date        timestamptz default now())
returns uuid language plpgsql set search_path = '' as $$
declare
  v_from public.warehouse_locations; v_to public.warehouse_locations;
  v_prod record; ic public.item_costs; v_allow_negative boolean;
  v_out boolean; v_in boolean; v_onhand numeric;
  v_cost numeric; v_total numeric; v_q1 numeric; v_v1 numeric; v_avg numeric; v_mv uuid; v_variance numeric := 0;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'Quantity must be greater than zero' using errcode = '23514';
  end if;

  select * into v_from from public.warehouse_locations where id = p_from and company_id = p_company;
  select * into v_to   from public.warehouse_locations where id = p_to   and company_id = p_company;
  if v_from.id is null or v_to.id is null then raise exception 'Unknown location' using errcode = '23503'; end if;
  if p_from = p_to then raise exception 'Source and destination are the same location' using errcode = '23514'; end if;
  if 'view' in (v_from.location_type, v_to.location_type) then
    raise exception 'Stock cannot be stored in view location %', case when v_from.location_type = 'view' then v_from.code else v_to.code end
      using errcode = '23514';
  end if;
  v_out := v_from.warehouse_id is not null;   -- leaving owned stock
  v_in  := v_to.warehouse_id is not null;     -- entering owned stock
  if not v_out and not v_in then
    raise exception 'A movement needs at least one real (warehouse) location' using errcode = '23514';
  end if;

  select v.sku, p.product_type, p.tracking into v_prod
    from public.product_variants v join public.products p on p.id = v.product_id
   where v.id = p_variant and v.company_id = p_company;
  if v_prod.sku is null then raise exception 'Unknown product variant' using errcode = '23503'; end if;
  if v_prod.product_type <> 'stockable' then
    raise exception '% is a % product; only stockable products carry stock', v_prod.sku, v_prod.product_type using errcode = '23514';
  end if;
  if v_prod.tracking <> 'none' and p_lot is null then
    raise exception '% is tracked by %: a lot/serial number is required', v_prod.sku, v_prod.tracking using errcode = '23514';
  end if;
  if p_lot is not null and not exists (select 1 from public.lots where id = p_lot and variant_id = p_variant) then
    raise exception 'Lot does not belong to %', v_prod.sku using errcode = '23514';
  end if;
  if v_prod.tracking = 'serial' and p_qty <> 1 and v_in and not v_out then
    raise exception 'Serial-tracked items are received one unit per serial number' using errcode = '23514';
  end if;

  -- Lock the valuation row: serialises concurrent postings of this item
  insert into public.item_costs (company_id, variant_id) values (p_company, p_variant)
  on conflict (company_id, variant_id) do nothing;
  select * into ic from public.item_costs where company_id = p_company and variant_id = p_variant for update;

  if v_out then
    select coalesce(allow_negative_stock, false) into v_allow_negative from public.company_settings where company_id = p_company;
    select on_hand into v_onhand from public.stock_levels
     where company_id = p_company and variant_id = p_variant and location_id = p_from and lot_id is not distinct from p_lot
     for update;
    if coalesce(v_onhand, 0) < p_qty and not v_allow_negative then
      raise exception 'Insufficient stock of % at %: % on hand, % requested', v_prod.sku, v_from.code,
                      trim_scale(coalesce(v_onhand, 0)), trim_scale(p_qty) using errcode = 'P0001';
    end if;
  end if;

  if v_in and not v_out then
    -- INBOUND: recompute weighted average cost
    v_cost := coalesce(p_unit_cost, ic.avg_cost);
    if v_cost < 0 then raise exception 'Unit cost cannot be negative' using errcode = '23514'; end if;
    v_total := round(p_qty * v_cost, 4);
    v_q1 := ic.qty_on_hand + p_qty;
    if ic.qty_on_hand < 0 then
      -- Stock was negative: the incoming units first settle the deficit, which
      -- had been issued at the old average. The difference is booked as an
      -- explicit revaluation movement so the ledger still sums to the value.
      v_v1  := case when v_q1 > 0 then round(v_q1 * v_cost, 4) else round(v_q1 * ic.avg_cost, 4) end;
      v_avg := case when v_q1 > 0 then v_cost else ic.avg_cost end;
      v_variance := v_v1 - (ic.total_value + v_total);
    else
      v_v1  := ic.total_value + v_total;
      v_avg := round(v_v1 / v_q1, 6);
    end if;
  elsif v_out and not v_in then
    -- OUTBOUND: valued at average; last unit takes the exact remaining value
    v_cost  := ic.avg_cost;
    v_total := case when p_qty = ic.qty_on_hand then ic.total_value else round(p_qty * v_cost, 4) end;
    v_q1    := ic.qty_on_hand - p_qty;
    v_v1    := case when v_q1 = 0 then 0 else ic.total_value - v_total end;
    v_avg   := ic.avg_cost;
  else
    -- INTERNAL: relocation, no valuation effect
    v_cost := ic.avg_cost; v_total := round(p_qty * v_cost, 4);
    v_q1 := ic.qty_on_hand; v_v1 := ic.total_value; v_avg := ic.avg_cost;
  end if;

  insert into public.stock_movements (
    company_id, movement_date, movement_type, variant_id, lot_id, from_location_id, to_location_id,
    from_warehouse_id, to_warehouse_id, quantity, unit_cost, total_cost,
    source_doc_type, source_doc_id, source_line_id, reference)
  values (
    p_company, p_date, p_type, p_variant, p_lot, p_from, p_to,
    v_from.warehouse_id, v_to.warehouse_id, p_qty, v_cost, v_total,
    p_source_type, p_source_id, p_source_line, p_reference)
  returning id into v_mv;

  if v_variance <> 0 then
    insert into public.stock_movements (company_id, movement_date, movement_type, variant_id, lot_id, from_location_id, to_location_id,
                                        to_warehouse_id, quantity, unit_cost, total_cost, source_doc_type, source_doc_id, source_line_id,
                                        reference, notes)
    values (p_company, p_date, 'revaluation', p_variant, p_lot, app.virtual_location(p_company, 'adjustment'), p_to,
            v_to.warehouse_id, 0, 0, v_variance, p_source_type, p_source_id, p_source_line, p_reference,
            'Negative stock settled at incoming cost');
  end if;

  if v_out then perform app.bump_stock_level(p_company, p_variant, v_from.warehouse_id, p_from, p_lot, -p_qty, 0, p_date); end if;
  if v_in  then perform app.bump_stock_level(p_company, p_variant, v_to.warehouse_id,   p_to,   p_lot,  p_qty, 0, p_date); end if;

  update public.item_costs
     set avg_cost = greatest(v_avg, 0), qty_on_hand = v_q1, total_value = v_v1,
         last_receipt_at = case when v_in and not v_out then p_date else last_receipt_at end
   where id = ic.id;

  if v_in and not v_out then
    insert into public.item_cost_history (company_id, variant_id, movement_id, qty_before, avg_cost_before, qty_in, unit_cost_in, avg_cost_after, reason)
    values (p_company, p_variant, v_mv, ic.qty_on_hand, ic.avg_cost, p_qty, v_cost, greatest(v_avg, 0), p_type);
  end if;

  if v_out then perform app.check_low_stock(p_company, p_variant, v_from.warehouse_id); end if;
  if v_in and v_to.warehouse_id is distinct from v_from.warehouse_id then
    perform app.check_low_stock(p_company, p_variant, v_to.warehouse_id);
  end if;
  return v_mv;
end $$;

-- Value-only movement (landed cost, revaluation): changes value, not quantity
create or replace function app.post_value_adjustment(
  p_company uuid, p_variant uuid, p_location uuid, p_amount numeric,
  p_source_type text, p_source_id uuid, p_source_line uuid, p_reference text, p_date timestamptz default now())
returns uuid language plpgsql set search_path = '' as $$
declare ic public.item_costs; v_mv uuid; v_avg numeric; v_wh uuid;
begin
  if p_amount = 0 then return null; end if;
  insert into public.item_costs (company_id, variant_id) values (p_company, p_variant)
  on conflict (company_id, variant_id) do nothing;
  select * into ic from public.item_costs where company_id = p_company and variant_id = p_variant for update;
  if ic.qty_on_hand <= 0 then
    raise exception 'Cannot capitalise cost onto an item with no stock' using errcode = '23514';
  end if;
  select warehouse_id into v_wh from public.warehouse_locations where id = p_location;

  insert into public.stock_movements (company_id, movement_date, movement_type, variant_id, from_location_id, to_location_id,
                                      to_warehouse_id, quantity, unit_cost, total_cost, source_doc_type, source_doc_id,
                                      source_line_id, reference)
  values (p_company, p_date, 'landed_cost', p_variant, app.virtual_location(p_company, 'supplier'), p_location,
          v_wh, 0, 0, p_amount, p_source_type, p_source_id, p_source_line, p_reference)
  returning id into v_mv;

  v_avg := round((ic.total_value + p_amount) / ic.qty_on_hand, 6);
  update public.item_costs set total_value = total_value + p_amount, avg_cost = v_avg where id = ic.id;
  insert into public.item_cost_history (company_id, variant_id, movement_id, qty_before, avg_cost_before, qty_in, unit_cost_in, avg_cost_after, reason)
  values (p_company, p_variant, v_mv, ic.qty_on_hand, ic.avg_cost, 0, p_amount, v_avg, 'landed_cost');
  return v_mv;
end $$;

-- -----------------------------------------------------------------------------
-- Reservations (used by sales orders / work orders from Phase 3 on)
-- Allocates FEFO: earliest expiry first, then location code.
-- -----------------------------------------------------------------------------
create or replace function app.reserve_stock(
  p_company uuid, p_variant uuid, p_warehouse uuid, p_qty numeric,
  p_source_type text, p_source_id uuid, p_source_line uuid default null, p_allow_partial boolean default false)
returns numeric language plpgsql set search_path = '' as $$
declare r record; v_left numeric := p_qty; v_take numeric;
begin
  if p_qty <= 0 then raise exception 'Quantity must be greater than zero'; end if;
  perform 1 from public.item_costs where company_id = p_company and variant_id = p_variant for update;
  for r in
    select sl.* from public.stock_levels sl
      join public.warehouse_locations l on l.id = sl.location_id
      left join public.lots lt on lt.id = sl.lot_id
     where sl.company_id = p_company and sl.variant_id = p_variant and sl.warehouse_id = p_warehouse
       and sl.available > 0 and l.is_pickable
       and (lt.expiry_date is null or lt.expiry_date >= current_date)
     order by lt.expiry_date nulls last, l.code
     for update of sl
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.available);
    update public.stock_levels set reserved = reserved + v_take where id = r.id;
    insert into public.stock_reservations (company_id, variant_id, warehouse_id, location_id, lot_id, quantity,
                                           source_doc_type, source_doc_id, source_line_id)
    values (p_company, p_variant, p_warehouse, r.location_id, r.lot_id, v_take, p_source_type, p_source_id, p_source_line);
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 and not p_allow_partial then
    raise exception 'Only % of % can be reserved', trim_scale(p_qty - v_left), trim_scale(p_qty) using errcode = 'P0001';
  end if;
  perform app.check_low_stock(p_company, p_variant, p_warehouse);
  return p_qty - v_left;
end $$;

create or replace function app.release_reservations(p_source_type text, p_source_id uuid, p_source_line uuid default null)
returns numeric language plpgsql set search_path = '' as $$
declare r record; v_total numeric := 0;
begin
  for r in select * from public.stock_reservations
            where source_doc_type = p_source_type and source_doc_id = p_source_id and status = 'active'
              and (p_source_line is null or source_line_id = p_source_line)
            for update
  loop
    update public.stock_levels set reserved = greatest(reserved - r.quantity, 0)
     where company_id = r.company_id and variant_id = r.variant_id
       and location_id = r.location_id and lot_id is not distinct from r.lot_id;
    update public.stock_reservations set status = 'released' where id = r.id;
    v_total := v_total + r.quantity;
    perform app.check_low_stock(r.company_id, r.variant_id, r.warehouse_id);
  end loop;
  return v_total;
end $$;

revoke execute on function app.post_stock_move, app.post_value_adjustment(uuid, uuid, uuid, numeric, text, uuid, uuid, text, timestamptz), app.bump_stock_level,
                           app.reserve_stock, app.release_reservations, app.check_low_stock from authenticated;

-- Approval amount for documents that carry total_value (adjustments)
create or replace function public.submit_for_approval(p_doc_type text, p_document_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare dt public.document_types; v_doc jsonb; v_company uuid; v_amount numeric; w public.approval_workflows; v_req uuid; v_step smallint;
begin
  select * into dt from public.document_types where key = p_doc_type;
  if dt.table_name is null or dt.approved_status is null then raise exception 'Document type % has no approval flow', p_doc_type; end if;

  execute format('select to_jsonb(t) from public.%I t where t.id = $1', dt.table_name) into v_doc using p_document_id;
  if v_doc is null then raise exception 'Document not found'; end if;
  v_company := (v_doc ->> 'company_id')::uuid;
  perform app.require_permission(v_company, dt.module || '.write');
  v_amount := abs(coalesce((v_doc ->> 'total_base')::numeric, (v_doc ->> 'total')::numeric,
                           (v_doc ->> 'total_value')::numeric, (v_doc ->> 'estimated_total')::numeric, 0));

  select * into w from public.approval_workflows
   where company_id = v_company and doc_type = p_doc_type and is_active and deleted_at is null
     and (min_amount is null or v_amount >= min_amount)
   order by priority desc, min_amount desc nulls last limit 1;

  if w.id is null then
    perform app.set_document_status(dt.table_name, p_document_id, dt.approved_status);
    return null;
  end if;

  select min(step_order) into v_step from public.approval_workflow_steps where workflow_id = w.id;
  if v_step is null then raise exception 'Workflow "%" has no steps', w.name; end if;

  insert into public.approval_requests (company_id, workflow_id, doc_type, document_id, document_number, amount, current_step, requested_by)
  values (v_company, w.id, p_doc_type, p_document_id, v_doc ->> 'number', v_amount, v_step, auth.uid())
  returning id into v_req;

  perform app.set_document_status(dt.table_name, p_document_id, dt.pending_status);
  perform app.notify_step_approvers(v_req);
  return v_req;
end $$;

-- =============================================================================
-- Posting RPCs
-- =============================================================================

-- Goods receipt → stock in at cost; updates WAC, PO received quantities & status
create or replace function public.post_goods_receipt(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.goods_receipts; po public.purchase_orders; l record; s public.company_settings;
  v_from uuid; v_cost numeric; v_total numeric := 0; v_lines int := 0; v_received numeric;
  v_at timestamptz;
begin
  select * into r from public.goods_receipts where id = p_id for update;
  if r.id is null then raise exception 'Goods receipt not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'wms.write');
  if r.status <> 'draft' then raise exception 'Only draft receipts can be posted (this one is %)', r.status using errcode = '55000'; end if;

  if r.purchase_order_id is not null then
    select * into po from public.purchase_orders where id = r.purchase_order_id for update;
    if po.status not in ('approved','sent','partially_received') then
      raise exception 'Purchase order % is %; it must be approved before goods are received', po.number, po.status using errcode = '55000';
    end if;
  end if;
  select * into s from public.company_settings where company_id = r.company_id;
  v_from := app.virtual_location(r.company_id, case when r.receipt_type = 'customer_return' then 'customer' else 'supplier' end);
  v_at := (r.receipt_date + localtime)::timestamptz;

  for l in
    select gl.*, loc.warehouse_id as loc_wh, loc.code as loc_code,
           pol.purchase_order_id as pol_po, pol.variant_id as pol_variant, pol.quantity as pol_qty,
           pol.unit_price as pol_price, pol.discount_pct as pol_disc
      from public.goods_receipt_lines gl
      join public.warehouse_locations loc on loc.id = gl.location_id
      left join public.purchase_order_lines pol on pol.id = gl.po_line_id
     where gl.receipt_id = r.id and gl.qc_status <> 'rejected'
     order by gl.created_at, gl.id
  loop
    v_lines := v_lines + 1;
    if l.loc_wh is distinct from r.warehouse_id then
      raise exception 'Location % is not in the receiving warehouse', l.loc_code using errcode = '23514';
    end if;

    if l.po_line_id is not null then
      if l.pol_po is distinct from r.purchase_order_id then
        raise exception 'A receipt line refers to a different purchase order' using errcode = '23514';
      end if;
      if l.pol_variant is distinct from l.variant_id then
        raise exception 'Received product differs from the purchase order line' using errcode = '23514';
      end if;
      select qty_received into v_received from public.purchase_order_lines where id = l.po_line_id for update;
      if v_received + l.quantity > l.pol_qty * (1 + s.match_qty_tolerance_pct / 100) then
        raise exception 'Over-receipt: % ordered, % already received, % now', trim_scale(l.pol_qty), trim_scale(v_received), trim_scale(l.quantity)
          using errcode = '23514';
      end if;
    end if;

    v_cost := round(coalesce(
                l.unit_cost,
                l.unit_price * r.exchange_rate,
                case when l.po_line_id is not null then l.pol_price * (1 - l.pol_disc / 100) * r.exchange_rate end), 6);
    if v_cost is null then
      raise exception 'Unit cost is missing on a line without a purchase order' using errcode = '23514';
    end if;

    perform app.post_stock_move(r.company_id,
                                case when r.receipt_type = 'customer_return' then 'sales_return' else 'receipt' end,
                                l.variant_id, v_from, l.location_id, l.quantity, v_cost, l.lot_id,
                                'goods_receipt', r.id, l.id, r.number, v_at);
    update public.goods_receipt_lines set unit_cost = v_cost where id = l.id;
    if l.po_line_id is not null then
      update public.purchase_order_lines set qty_received = qty_received + l.quantity where id = l.po_line_id;
    end if;
    v_total := v_total + round(l.quantity * v_cost, 2);
  end loop;

  if v_lines = 0 then raise exception 'Nothing to receive: add at least one accepted line' using errcode = '23514'; end if;

  update public.goods_receipts
     set status = 'done', done_at = now(), total_value = v_total, received_by = coalesce(received_by, auth.uid())
   where id = r.id;

  if po.id is not null then
    update public.purchase_orders
       set status = case when exists (select 1 from public.purchase_order_lines
                                       where purchase_order_id = po.id and qty_received < quantity)
                         then 'partially_received' else 'received' end
     where id = po.id
       and status is distinct from case when exists (select 1 from public.purchase_order_lines
                                                      where purchase_order_id = po.id and qty_received < quantity)
                                        then 'partially_received' else 'received' end;
  end if;

  return jsonb_build_object('status', 'done', 'lines', v_lines, 'total_value', v_total,
                            'clearance_status', (select clearance_status from public.goods_receipts where id = r.id));
end $$;

-- Stock adjustment → approval (if a workflow applies) → posting
create or replace function public.post_stock_adjustment(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  a public.stock_adjustments; l record; v_status text; v_adj uuid; v_scrap uuid; v_mv uuid;
  v_total numeric := 0; v_lines int := 0; v_at timestamptz; v_scrapping boolean;
begin
  select * into a from public.stock_adjustments where id = p_id for update;
  if a.id is null then raise exception 'Adjustment not found' using errcode = 'P0002'; end if;
  perform app.require_permission(a.company_id, 'inventory.write');

  if a.status = 'draft' then
    if not exists (select 1 from public.stock_adjustment_lines where adjustment_id = a.id) then
      raise exception 'Add at least one line' using errcode = '23514';
    end if;
    -- value estimate drives approval thresholds
    update public.stock_adjustments set total_value = (
      select coalesce(sum(round(abs(l2.quantity_change) * coalesce(l2.unit_cost, ic.avg_cost, 0), 2)), 0)
        from public.stock_adjustment_lines l2
        left join public.item_costs ic on ic.company_id = l2.company_id and ic.variant_id = l2.variant_id
       where l2.adjustment_id = a.id)
     where id = a.id;
    perform public.submit_for_approval('stock_adjustment', a.id);
    select status into v_status from public.stock_adjustments where id = a.id;
    if v_status <> 'approved' then return v_status; end if;
  elsif a.status = 'pending_approval' then
    return a.status;
  elsif a.status <> 'approved' then
    raise exception 'Adjustment is already %', a.status using errcode = '55000';
  end if;

  v_adj   := app.virtual_location(a.company_id, 'adjustment');
  v_scrap := app.virtual_location(a.company_id, 'scrap');
  v_scrapping := a.reason in ('damage','expiry');
  v_at := (a.adjustment_date + localtime)::timestamptz;

  for l in
    select al.*, loc.warehouse_id as loc_wh, loc.code as loc_code
      from public.stock_adjustment_lines al join public.warehouse_locations loc on loc.id = al.location_id
     where al.adjustment_id = a.id order by al.created_at, al.id
  loop
    v_lines := v_lines + 1;
    if l.loc_wh is distinct from a.warehouse_id then
      raise exception 'Location % is not in the adjusted warehouse', l.loc_code using errcode = '23514';
    end if;
    if l.quantity_change > 0 then
      if a.reason = 'opening' and l.unit_cost is null then
        raise exception 'Opening stock needs a unit cost on every line' using errcode = '23514';
      end if;
      v_mv := app.post_stock_move(a.company_id, case when a.reason = 'opening' then 'opening' else 'adjustment_in' end,
                                  l.variant_id, v_adj, l.location_id, l.quantity_change, l.unit_cost, l.lot_id,
                                  'stock_adjustment', a.id, l.id, a.number, v_at);
      v_total := v_total + (select total_cost from public.stock_movements where id = v_mv);
    else
      v_mv := app.post_stock_move(a.company_id, case when v_scrapping then 'scrap' else 'adjustment_out' end,
                                  l.variant_id, l.location_id, case when v_scrapping then v_scrap else v_adj end,
                                  -l.quantity_change, null, l.lot_id, 'stock_adjustment', a.id, l.id, a.number, v_at);
      v_total := v_total - (select total_cost from public.stock_movements where id = v_mv);
    end if;
  end loop;

  update public.stock_adjustments set status = 'posted', posted_at = now(), total_value = round(v_total, 2) where id = a.id;
  return 'posted';
end $$;

-- Transfer between warehouses (or bins) — immediate, no transit leg
create or replace function public.post_stock_transfer(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare t public.stock_transfers; l record; v_lines int := 0; v_at timestamptz;
begin
  select * into t from public.stock_transfers where id = p_id for update;
  if t.id is null then raise exception 'Transfer not found' using errcode = 'P0002'; end if;
  perform app.require_permission(t.company_id, 'wms.write');
  if t.status <> 'draft' then raise exception 'Only draft transfers can be posted (this one is %)', t.status using errcode = '55000'; end if;
  v_at := (t.transfer_date + localtime)::timestamptz;

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
    perform app.post_stock_move(t.company_id, 'transfer', l.variant_id, l.from_location_id, l.to_location_id,
                                l.quantity, null, l.lot_id, 'stock_transfer', t.id, l.id, t.number, v_at);
    update public.stock_transfer_lines set quantity_done = quantity where id = l.id;
  end loop;
  if v_lines = 0 then raise exception 'Add at least one line' using errcode = '23514'; end if;

  update public.stock_transfers set status = 'done', shipped_at = now(), received_at = now() where id = t.id;
  return 'done';
end $$;

-- Landed cost → allocate to receipt lines, capitalise the in-stock share
create or replace function public.post_landed_cost(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  lc public.landed_costs; l record; v_sum numeric; v_left numeric; v_alloc numeric; v_cap numeric; v_n int; v_i int := 0;
  v_onhand jsonb := '{}'::jsonb; v_rem numeric; v_cap_qty numeric; v_cap_total numeric := 0; v_exp_total numeric := 0;
begin
  select * into lc from public.landed_costs where id = p_id for update;
  if lc.id is null then raise exception 'Landed cost not found' using errcode = 'P0002'; end if;
  perform app.require_permission(lc.company_id, 'procurement.write');
  if lc.status <> 'draft' then raise exception 'Only draft landed costs can be posted (this one is %)', lc.status using errcode = '55000'; end if;
  if lc.total_amount <= 0 then raise exception 'Add at least one charge' using errcode = '23514'; end if;
  if not exists (select 1 from public.landed_cost_receipts where landed_cost_id = lc.id) then
    raise exception 'Select the receipts this cost applies to' using errcode = '23514';
  end if;
  if exists (select 1 from public.landed_cost_receipts x join public.goods_receipts g on g.id = x.receipt_id
              where x.landed_cost_id = lc.id and g.status <> 'done') then
    raise exception 'All selected receipts must be posted first' using errcode = '55000';
  end if;

  for l in
    with basis as (
      select gl.id as line_id, gl.variant_id, gl.location_id, gl.quantity,
             case lc.allocation_method
               when 'value'    then gl.quantity * gl.unit_cost
               when 'quantity' then gl.quantity
               when 'weight'   then gl.quantity * coalesce(v.weight_kg, p.weight_kg, 0)
               when 'volume'   then gl.quantity * coalesce(p.volume_m3, 0)
               else 1 end as basis
        from public.landed_cost_receipts x
        join public.goods_receipt_lines gl on gl.receipt_id = x.receipt_id and gl.qc_status <> 'rejected'
        join public.product_variants v on v.id = gl.variant_id
        join public.products p on p.id = v.product_id
       where x.landed_cost_id = lc.id)
    select b.*, sum(b.basis) over () as total_basis, count(*) over () as n
      from basis b order by b.basis desc, b.line_id
  loop
    if v_sum is null then
      v_sum := l.total_basis; v_n := l.n; v_left := lc.total_amount;
      if coalesce(v_sum, 0) <= 0 then
        raise exception 'Nothing to allocate by %: the receipt lines have no %', lc.allocation_method,
          case lc.allocation_method when 'weight' then 'weights' when 'volume' then 'volumes' else 'value' end
          using errcode = '23514';
      end if;
    end if;
    v_i := v_i + 1;
    v_alloc := case when v_i = v_n then v_left else round(lc.total_amount * l.basis / v_sum, 2) end;
    v_left := v_left - v_alloc;

    -- share of this line still in stock (company-wide), consumed across lines of the same item
    if not v_onhand ? l.variant_id::text then
      v_onhand := v_onhand || jsonb_build_object(l.variant_id::text,
                  greatest(coalesce((select qty_on_hand from public.item_costs where variant_id = l.variant_id), 0), 0));
    end if;
    v_rem := (v_onhand ->> l.variant_id::text)::numeric;
    v_cap_qty := least(l.quantity, v_rem);
    v_onhand := jsonb_set(v_onhand, array[l.variant_id::text], to_jsonb(v_rem - v_cap_qty));
    v_cap := round(v_alloc * v_cap_qty / l.quantity, 2);

    if v_cap > 0 then
      perform app.post_value_adjustment(lc.company_id, l.variant_id, l.location_id, v_cap,
                                        'landed_cost', lc.id, l.line_id, lc.number, (lc.landed_cost_date + localtime)::timestamptz);
    end if;
    insert into public.landed_cost_allocations (company_id, landed_cost_id, receipt_line_id, basis_value,
                                                allocated_amount, capitalized_amount, expensed_amount)
    values (lc.company_id, lc.id, l.line_id, l.basis, v_alloc, v_cap, v_alloc - v_cap);
    update public.goods_receipt_lines set landed_cost_amount = landed_cost_amount + v_alloc where id = l.line_id;
    v_cap_total := v_cap_total + v_cap;
    v_exp_total := v_exp_total + (v_alloc - v_cap);
  end loop;
  if v_n is null then raise exception 'The selected receipts have no lines to allocate to' using errcode = '23514'; end if;

  update public.goods_receipts g set clearance_status = 'cleared', cleared_at = now()
    from public.landed_cost_receipts x
   where x.landed_cost_id = lc.id and g.id = x.receipt_id and g.is_import and g.clearance_status = 'pending';
  update public.landed_costs set status = 'posted', posted_at = now() where id = lc.id;

  return jsonb_build_object('allocated', lc.total_amount, 'capitalized', v_cap_total, 'expensed', v_exp_total, 'lines', v_n);
end $$;

create or replace function public.acknowledge_stock_alert(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.stock_alerts;
begin
  select * into a from public.stock_alerts where id = p_id for update;
  if a.id is null then raise exception 'Alert not found' using errcode = 'P0002'; end if;
  if not (app.has_permission(a.company_id, 'inventory.write') or app.has_permission(a.company_id, 'oms.write')) then
    raise exception 'Permission denied: inventory.write or oms.write required' using errcode = '42501';
  end if;
  update public.stock_alerts set status = 'acknowledged', acknowledged_by = auth.uid(), acknowledged_at = now()
   where id = p_id and status = 'open';
end $$;

-- =============================================================================
-- Product creation (atomic: product + variants + attributes + barcodes + reorder points)
-- SECURITY INVOKER: every insert is checked by the caller's RLS policies.
-- =============================================================================
create or replace function public.create_product(p jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_company uuid := (p ->> 'company_id')::uuid; v_product uuid; v jsonb; v_variant uuid; v_idx int := 0; v_variants jsonb;
  v_name text;
begin
  insert into public.products (company_id, code, name, description, product_type, category_id, uom_id, purchase_uom_id,
                               tracking, track_expiry, is_sellable, is_purchasable, is_manufactured, sales_price,
                               sales_tax_code_id, purchase_tax_code_id, brand, weight_kg, volume_m3, hs_code, tags, image_path)
  values (v_company, p ->> 'code', p ->> 'name', nullif(p ->> 'description', ''),
          coalesce(p ->> 'product_type', 'stockable'), nullif(p ->> 'category_id', '')::uuid, (p ->> 'uom_id')::uuid,
          nullif(p ->> 'purchase_uom_id', '')::uuid, coalesce(p ->> 'tracking', 'none'),
          coalesce((p ->> 'track_expiry')::boolean, false), coalesce((p ->> 'is_sellable')::boolean, true),
          coalesce((p ->> 'is_purchasable')::boolean, true), coalesce((p ->> 'is_manufactured')::boolean, false),
          coalesce((p ->> 'sales_price')::numeric, 0), nullif(p ->> 'sales_tax_code_id', '')::uuid,
          nullif(p ->> 'purchase_tax_code_id', '')::uuid, nullif(p ->> 'brand', ''),
          nullif(p ->> 'weight_kg', '')::numeric, nullif(p ->> 'volume_m3', '')::numeric, nullif(p ->> 'hs_code', ''),
          coalesce(array(select jsonb_array_elements_text(coalesce(p -> 'tags', '[]'::jsonb))), '{}'),
          nullif(p ->> 'image_path', ''))
  returning id into v_product;

  v_variants := coalesce(p -> 'variants', '[]'::jsonb);
  if jsonb_array_length(v_variants) = 0 then
    v_variants := jsonb_build_array(jsonb_build_object(
      'sku', p ->> 'code', 'barcodes', coalesce(p -> 'barcodes', '[]'::jsonb),
      'generate_barcode', coalesce(p -> 'generate_barcode', 'false'::jsonb),
      'standard_cost', p -> 'standard_cost'));
  end if;

  for v in select * from jsonb_array_elements(v_variants) loop
    v_idx := v_idx + 1;
    v_name := coalesce(nullif(v ->> 'name', ''),
                       (p ->> 'name') || coalesce(' / ' || (
                          select string_agg(av.value, ' / ' order by pa.sort_order, pa.name)
                            from jsonb_array_elements_text(coalesce(v -> 'attribute_value_ids', '[]'::jsonb)) x
                            join public.product_attribute_values av on av.id = x::uuid
                            join public.product_attributes pa on pa.id = av.attribute_id), ''));
    insert into public.product_variants (company_id, product_id, sku, name, sales_price_override, standard_cost, weight_kg, is_default)
    values (v_company, v_product, v ->> 'sku', v_name, nullif(v ->> 'sales_price_override', '')::numeric,
            coalesce(nullif(v ->> 'standard_cost', '')::numeric, 0), nullif(v ->> 'weight_kg', '')::numeric, v_idx = 1)
    returning id into v_variant;

    insert into public.variant_attribute_values (company_id, variant_id, attribute_value_id)
    select v_company, v_variant, x::uuid from jsonb_array_elements_text(coalesce(v -> 'attribute_value_ids', '[]'::jsonb)) x;

    insert into public.product_barcodes (company_id, variant_id, barcode, symbology, is_primary)
    select v_company, v_variant, b ->> 'barcode', coalesce(b ->> 'symbology', 'ean13'), n = 1
      from jsonb_array_elements(coalesce(v -> 'barcodes', '[]'::jsonb)) with ordinality as t(b, n)
     where coalesce(b ->> 'barcode', '') <> '';

    if coalesce((v ->> 'generate_barcode')::boolean, false)
       and not exists (select 1 from public.product_barcodes where variant_id = v_variant) then
      insert into public.product_barcodes (company_id, variant_id, barcode, symbology, is_primary)
      values (v_company, v_variant, public.generate_internal_barcode(v_company), 'ean13', true);
    end if;

    insert into public.replenishment_rules (company_id, variant_id, warehouse_id, min_qty, max_qty, multiple_qty, preferred_vendor_id)
    select v_company, v_variant, (r ->> 'warehouse_id')::uuid, (r ->> 'min_qty')::numeric, (r ->> 'max_qty')::numeric,
           coalesce(nullif(r ->> 'multiple_qty', '')::numeric, 1), nullif(r ->> 'preferred_vendor_id', '')::uuid
      from jsonb_array_elements(coalesce(v -> 'reorder_rules', p -> 'reorder_rules', '[]'::jsonb)) r;
  end loop;

  return v_product;
end $$;

-- =============================================================================
-- Lookups (SECURITY INVOKER — RLS decides what the caller can see)
-- =============================================================================
create or replace function public.find_variant_by_code(p_company uuid, p_code text)
returns table (variant_id uuid, product_id uuid, sku text, name text, units_per_scan numeric,
               sales_price numeric, sales_tax_code_id uuid, tracking text, matched_by text)
language sql stable security invoker set search_path = '' as $$
  select v.id, v.product_id, v.sku, v.name, b.quantity, coalesce(v.sales_price_override, p.sales_price),
         p.sales_tax_code_id, p.tracking, 'barcode'
    from public.product_barcodes b
    join public.product_variants v on v.id = b.variant_id and v.deleted_at is null and v.is_active
    join public.products p on p.id = v.product_id and p.deleted_at is null
   where b.company_id = p_company and b.barcode = btrim(p_code) and b.deleted_at is null
  union all
  select v.id, v.product_id, v.sku, v.name, 1, coalesce(v.sales_price_override, p.sales_price),
         p.sales_tax_code_id, p.tracking, 'sku'
    from public.product_variants v
    join public.products p on p.id = v.product_id and p.deleted_at is null
   where v.company_id = p_company and upper(v.sku) = upper(btrim(p_code)) and v.deleted_at is null and v.is_active
  limit 5
$$;

-- ⌘K search across master data and documents
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
      and (bp.name ilike q.pat or bp.code ilike q.pat or bp.tax_number ilike q.pat)
    order by bp.name limit p_limit)
  union all
  (select 'warehouse', w.id, w.name, w.code, '/inventory/warehouses'
     from public.warehouses w, q
    where w.company_id = p_company and w.deleted_at is null and (w.name ilike q.pat or w.code ilike q.pat)
    limit 3)
  union all
  (select d.kind, d.id, d.number, d.label, d.href from (
      select 'goods_receipt' as kind, g.id, g.number, 'Goods receipt · ' || g.status as label, '/inventory/receipts/' || g.id as href, g.company_id, g.deleted_at from public.goods_receipts g
      union all select 'stock_adjustment', a.id, a.number, 'Adjustment · ' || a.status, '/inventory/adjustments/' || a.id, a.company_id, a.deleted_at from public.stock_adjustments a
      union all select 'stock_transfer', t.id, t.number, 'Transfer · ' || t.status, '/inventory/transfers/' || t.id, t.company_id, t.deleted_at from public.stock_transfers t
      union all select 'landed_cost', l.id, l.number, 'Landed cost · ' || l.status, '/inventory/landed-costs/' || l.id, l.company_id, l.deleted_at from public.landed_costs l
      union all select 'purchase_order', o.id, o.number, 'Purchase order · ' || o.status, '/procurement/orders/' || o.id, o.company_id, o.deleted_at from public.purchase_orders o
      union all select 'sales_order', s.id, s.number, 'Sales order · ' || s.status, '/sales/orders/' || s.id, s.company_id, s.deleted_at from public.sales_orders s
      union all select 'sales_invoice', i.id, i.number, 'Invoice · ' || i.status, '/finance/invoices/' || i.id, i.company_id, i.deleted_at from public.sales_invoices i
    ) d, q
    where d.company_id = p_company and d.deleted_at is null and d.number ilike q.pat
    order by d.number desc limit p_limit)
$$;

-- Timeline for a record: audit trail + activities (comments, status changes, approvals)
create or replace function public.get_record_history(p_table text, p_id uuid, p_limit int default 100)
returns table (occurred_at timestamptz, kind text, action text, title text, body text,
               changed_fields text[], old_data jsonb, new_data jsonb, actor_id uuid, actor_name text)
language plpgsql stable security definer set search_path = '' as $$
declare r app.table_registry; v_company uuid; v_full_audit boolean;
begin
  select * into r from app.table_registry where table_name = p_table;
  if r.table_name is null then raise exception 'Unknown table %', p_table; end if;
  execute format('select company_id from public.%I where id = $1', p_table) into v_company using p_id;
  if v_company is null or not app.has_permission(v_company, r.read_module || '.read') then
    raise exception 'Record not found' using errcode = 'P0002';
  end if;
  v_full_audit := app.has_permission(v_company, 'audit.read');

  return query
  select * from (
    select al.occurred_at, 'audit'::text, al.action, null::text, null::text, al.changed_fields,
           case when v_full_audit then al.old_data end, case when v_full_audit then al.new_data end,
           al.actor_id, pr.full_name
      from public.audit_log al left join public.profiles pr on pr.id = al.actor_id
     where al.table_name = p_table and al.record_id = p_id
    union all
    select ea.occurred_at, ea.activity_type, null, ea.title, ea.body, null, null, ea.metadata,
           ea.created_by, pr.full_name
      from public.entity_activities ea left join public.profiles pr on pr.id = ea.created_by
     where ea.company_id = v_company and ea.entity_type = p_table and ea.entity_id = p_id
  ) h
  order by 1 desc
  limit p_limit;
end $$;

-- =============================================================================
-- Reporting views (security_invoker: the caller's RLS applies to every table)
-- =============================================================================
create or replace view public.v_stock_levels with (security_invoker = true) as
select sl.id, sl.company_id, sl.variant_id, v.product_id, v.sku, v.name as variant_name,
       p.code as product_code, p.name as product_name, p.category_id, pc.name as category_name,
       u.code as uom_code, sl.warehouse_id, w.code as warehouse_code, w.name as warehouse_name,
       sl.location_id, l.code as location_code, l.location_type,
       sl.lot_id, lt.lot_number, lt.expiry_date,
       sl.on_hand, sl.reserved, sl.available,
       coalesce(ic.avg_cost, 0) as avg_cost,
       round(sl.on_hand * coalesce(ic.avg_cost, 0), 2) as stock_value,
       sl.last_movement_at
  from public.stock_levels sl
  join public.product_variants v on v.id = sl.variant_id
  join public.products p on p.id = v.product_id
  left join public.product_categories pc on pc.id = p.category_id
  join public.units_of_measure u on u.id = p.uom_id
  join public.warehouses w on w.id = sl.warehouse_id
  join public.warehouse_locations l on l.id = sl.location_id
  left join public.lots lt on lt.id = sl.lot_id
  left join public.item_costs ic on ic.company_id = sl.company_id and ic.variant_id = sl.variant_id
 where sl.on_hand <> 0 or sl.reserved <> 0;

create or replace view public.v_incoming_stock with (security_invoker = true) as
select pol.company_id, pol.variant_id, po.warehouse_id,
       sum(greatest(pol.quantity - pol.qty_received, 0)) as incoming_qty,
       min(coalesce(pol.expected_date, po.expected_date)) as next_expected_date
  from public.purchase_order_lines pol
  join public.purchase_orders po on po.id = pol.purchase_order_id
 where po.status in ('approved','sent','partially_received') and po.deleted_at is null and pol.variant_id is not null
 group by pol.company_id, pol.variant_id, po.warehouse_id;

create or replace view public.v_product_stock with (security_invoker = true) as
select v.company_id, v.id as variant_id, v.product_id, v.sku, v.name as variant_name, v.is_active,
       p.code as product_code, p.name as product_name, p.product_type, p.tracking, p.category_id,
       pc.name as category_name, u.code as uom_code,
       coalesce(v.sales_price_override, p.sales_price) as sales_price,
       (select b.barcode from public.product_barcodes b
         where b.variant_id = v.id and b.deleted_at is null order by b.is_primary desc, b.created_at limit 1) as barcode,
       coalesce(s.on_hand, 0) as on_hand, coalesce(s.reserved, 0) as reserved, coalesce(s.available, 0) as available,
       coalesce((select sum(i.incoming_qty) from public.v_incoming_stock i where i.variant_id = v.id), 0) as incoming,
       coalesce(ic.avg_cost, 0) as avg_cost, coalesce(ic.total_value, 0) as stock_value,
       exists (select 1 from public.stock_alerts a where a.variant_id = v.id and a.status in ('open','acknowledged')) as is_low_stock,
       (select sum(r.min_qty) from public.replenishment_rules r where r.variant_id = v.id and r.is_active and r.deleted_at is null) as reorder_min,
       (select sum(r.max_qty) from public.replenishment_rules r where r.variant_id = v.id and r.is_active and r.deleted_at is null) as reorder_max
  from public.product_variants v
  join public.products p on p.id = v.product_id
  left join public.product_categories pc on pc.id = p.category_id
  join public.units_of_measure u on u.id = p.uom_id
  left join public.item_costs ic on ic.company_id = v.company_id and ic.variant_id = v.id
  left join lateral (select sum(on_hand) as on_hand, sum(reserved) as reserved, sum(available) as available
                       from public.stock_levels sl where sl.variant_id = v.id) s on true
 where v.deleted_at is null and p.deleted_at is null;

create or replace view public.v_low_stock with (security_invoker = true) as
select r.company_id, r.id as rule_id, r.variant_id, v.sku, v.name as variant_name, v.product_id,
       r.warehouse_id, w.name as warehouse_name, r.min_qty, r.max_qty, r.multiple_qty,
       coalesce(s.available, 0) as available, coalesce(i.incoming_qty, 0) as incoming, i.next_expected_date,
       greatest(ceil(greatest(r.max_qty - coalesce(s.available, 0) - coalesce(i.incoming_qty, 0), 0) / r.multiple_qty) * r.multiple_qty, 0)
         as suggested_qty,
       r.preferred_vendor_id, bp.name as preferred_vendor_name,
       a.id as alert_id, a.status as alert_status, a.triggered_at
  from public.replenishment_rules r
  join public.product_variants v on v.id = r.variant_id and v.deleted_at is null
  join public.warehouses w on w.id = r.warehouse_id
  left join public.business_partners bp on bp.id = r.preferred_vendor_id
  left join lateral (select sum(sl.available) as available from public.stock_levels sl
                      where sl.variant_id = r.variant_id and sl.warehouse_id = r.warehouse_id) s on true
  left join public.v_incoming_stock i on i.variant_id = r.variant_id and i.warehouse_id = r.warehouse_id
  left join public.stock_alerts a on a.variant_id = r.variant_id and a.warehouse_id = r.warehouse_id and a.status in ('open','acknowledged')
 where r.is_active and r.deleted_at is null and coalesce(s.available, 0) <= r.min_qty;

create or replace view public.v_stock_movements with (security_invoker = true) as
select m.id, m.company_id, m.movement_date, m.movement_type, m.variant_id, v.sku, v.name as variant_name, v.product_id,
       m.lot_id, lt.lot_number, m.quantity, u.code as uom_code, m.unit_cost, m.total_cost,
       m.from_location_id, fl.code as from_location, fl.location_type as from_type, m.from_warehouse_id,
       m.to_location_id, tl.code as to_location, tl.location_type as to_type, m.to_warehouse_id,
       case when m.from_warehouse_id is null and m.to_warehouse_id is not null then 'in'
            when m.from_warehouse_id is not null and m.to_warehouse_id is null then 'out'
            else 'internal' end as direction,
       m.source_doc_type, m.source_doc_id, m.reference, m.journal_entry_id, m.created_by, pr.full_name as created_by_name
  from public.stock_movements m
  join public.product_variants v on v.id = m.variant_id
  join public.products p on p.id = v.product_id
  join public.units_of_measure u on u.id = p.uom_id
  join public.warehouse_locations fl on fl.id = m.from_location_id
  join public.warehouse_locations tl on tl.id = m.to_location_id
  left join public.lots lt on lt.id = m.lot_id
  left join public.profiles pr on pr.id = m.created_by;

create or replace view public.v_inventory_valuation with (security_invoker = true) as
select ic.company_id, ic.variant_id, v.sku, v.name as variant_name, v.product_id, p.category_id,
       coalesce(pc.name, 'Uncategorised') as category_name, ic.qty_on_hand, ic.avg_cost, ic.total_value, ic.last_receipt_at
  from public.item_costs ic
  join public.product_variants v on v.id = ic.variant_id
  join public.products p on p.id = v.product_id
  left join public.product_categories pc on pc.id = p.category_id
 where ic.qty_on_hand <> 0 or ic.total_value <> 0;

revoke all on public.v_stock_levels, public.v_incoming_stock, public.v_product_stock, public.v_low_stock,
              public.v_stock_movements, public.v_inventory_valuation from anon;
grant select on public.v_stock_levels, public.v_incoming_stock, public.v_product_stock, public.v_low_stock,
                public.v_stock_movements, public.v_inventory_valuation to authenticated;

-- Dashboard numbers for inventory
create or replace function public.inventory_overview(p_company uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'stock_value',      coalesce((select sum(total_value) from public.item_costs where company_id = p_company), 0),
    'active_skus',      (select count(*) from public.product_variants where company_id = p_company and is_active and deleted_at is null),
    'low_stock',        (select count(*) from public.stock_alerts where company_id = p_company and status in ('open','acknowledged')),
    'negative_lines',   (select count(*) from public.stock_levels where company_id = p_company and on_hand < 0),
    'pending_clearance',(select count(*) from public.goods_receipts where company_id = p_company and clearance_status = 'pending' and deleted_at is null),
    'movements_today',  (select count(*) from public.stock_movements where company_id = p_company and movement_date >= current_date),
    'value_by_category', coalesce((select jsonb_agg(x order by x.value desc) from (
        select category_name as name, round(sum(total_value), 2) as value
          from public.v_inventory_valuation where company_id = p_company group by category_name order by 2 desc limit 8) x), '[]'::jsonb),
    'movements_by_day', coalesce((select jsonb_agg(x order by x.day) from (
        select d::date as day,
               coalesce(sum(m.total_cost) filter (where m.from_warehouse_id is null and m.to_warehouse_id is not null), 0) as value_in,
               coalesce(sum(m.total_cost) filter (where m.from_warehouse_id is not null and m.to_warehouse_id is null), 0) as value_out
          from generate_series(current_date - 29, current_date, interval '1 day') d
          left join public.stock_movements m on m.company_id = p_company and m.movement_date::date = d::date
         group by d) x), '[]'::jsonb))
$$;

revoke execute on function public.post_goods_receipt, public.post_stock_adjustment, public.post_stock_transfer,
                           public.post_landed_cost, public.acknowledge_stock_alert, public.create_product,
                           public.find_variant_by_code, public.global_search, public.get_record_history,
                           public.inventory_overview, public.generate_internal_barcode from public, anon;
grant execute on function public.post_goods_receipt, public.post_stock_adjustment, public.post_stock_transfer,
                          public.post_landed_cost, public.acknowledge_stock_alert, public.create_product,
                          public.find_variant_by_code, public.global_search, public.get_record_history,
                          public.inventory_overview, public.generate_internal_barcode to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.stock_alerts;
  end if;
end $$;
