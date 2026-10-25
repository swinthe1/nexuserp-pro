-- =============================================================================
-- DrisPRO · 1700 · WMS basics + point of sale (Phase 6)
--
-- WMS
--   * receipts into a non-pickable location (WH/RECEIVING) create a putaway task;
--     suggest_putaway ranks bins: same item → same category → empty bin
--   * pick lists for one or more deliveries, ordered along the bins; confirm_pick records
--     what was picked (short picks shrink the delivery); confirm_shipment posts the delivery
--   * move_stock: one-scan bin-to-bin transfer (never moves reserved stock)
--   * cycle counts: snapshot → scan counting → review → 'count' adjustment against current stock
--   * lots: ensure_lot from the scanner, lot_trace (recall list), lots_expiring
-- POS
--   * pos_catalog for the offline cache; pos_submit_order is idempotent on client_uuid
--   * stock leaves at the sale (negative allowed for the till only), COGS through the stock ledger
--   * close_pos_session: Z-report, one sales entry and one cash entry per session
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Engine changes: POS may go negative; POS stock entries use the register's journal; lots in ⌘K
-- -----------------------------------------------------------------------------
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
    -- the till never stops a sale for stock levels (pos_submit_order sets this for its own transaction)
    v_allow_negative := v_allow_negative or coalesce(current_setting('app.pos_allow_negative', true), '') = 'on';
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

create or replace function app.tg_stock_movement_gl()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  m record; v_lines jsonb := '[]'::jsonb; v_counter uuid; v_inv numeric; v_je uuid; v_date date; v_ref text;
  v_reason text; v_receipt_type text; v_journal text := 'INV'; v_tz text;
begin
  select timezone into v_tz from public.companies where id = new.company_id;
  if (select journal_entry_id from public.stock_movements where id = new.id) is not null then return null; end if;
  if new.source_doc_type in ('vendor_bill','landed_cost') or new.source_doc_type is null then return null; end if;

  if new.source_doc_type = 'stock_adjustment' then
    select reason into v_reason from public.stock_adjustments where id = new.source_doc_id;
  elsif new.source_doc_type = 'goods_receipt' then
    select receipt_type into v_receipt_type from public.goods_receipts where id = new.source_doc_id;
  elsif new.source_doc_type = 'work_order' then
    v_journal := 'MFG';
  elsif new.source_doc_type = 'pos_order' then
    v_journal := coalesce((select j.code from public.pos_orders o join public.pos_registers r on r.id = o.register_id
                             join public.journals j on j.id = r.journal_id where o.id = new.source_doc_id), 'POS');
  end if;

  for m in
    select sm.* from public.stock_movements sm
     where sm.company_id = new.company_id and sm.source_doc_type = new.source_doc_type and sm.source_doc_id = new.source_doc_id
       and sm.journal_entry_id is null and sm.movement_type not in ('landed_cost')
     order by sm.movement_date, sm.id
  loop
    -- inventory value change: +in / −out (internal relocations net to zero)
    v_inv := (case when m.to_warehouse_id is not null then m.total_cost else 0 end)
           - (case when m.from_warehouse_id is not null then m.total_cost else 0 end);
    v_date := coalesce(v_date, (m.movement_date at time zone coalesce(v_tz, 'Europe/Tirane'))::date);
    v_ref := coalesce(v_ref, m.reference);
    continue when v_inv = 0;
    v_counter := case
      when m.movement_type = 'receipt' and coalesce(v_receipt_type, 'purchase') = 'purchase' then app.acct(m.company_id, 'grni')
      when m.movement_type in ('receipt') then app.acct(m.company_id, 'inventory_adjustment')
      when m.movement_type = 'purchase_return' then app.acct(m.company_id, 'grni')
      when m.movement_type in ('delivery','pos_sale','sales_return','pos_return') then app.item_acct(m.company_id, m.variant_id, 'cogs')
      when m.movement_type in ('production_consume','production_output') then app.acct(m.company_id, 'wip')
      when m.movement_type = 'opening' or v_reason = 'opening' then app.acct(m.company_id, 'opening_balance')
      else app.acct(m.company_id, 'inventory_adjustment') end;
    v_lines := v_lines
      || jsonb_build_object('account_id', app.item_acct(m.company_id, m.variant_id, 'inventory'), 'amount', v_inv, 'variant_id', m.variant_id,
                            'description', replace(m.movement_type, '_', ' '))
      || jsonb_build_object('account_id', v_counter, 'amount', -v_inv, 'variant_id', m.variant_id,
                            'description', replace(m.movement_type, '_', ' '));
  end loop;

  if jsonb_array_length(v_lines) > 0 then
    v_je := app.gl_post(new.company_id, v_journal, v_date, new.source_doc_type, new.source_doc_id, v_ref,
                        'Inventory: ' || replace(new.source_doc_type, '_', ' ') || ' ' || coalesce(v_ref, ''),
                        v_lines, 'stock:' || txid_current());
  end if;
  update public.stock_movements set journal_entry_id = v_je
   where company_id = new.company_id and source_doc_type = new.source_doc_type and source_doc_id = new.source_doc_id
     and journal_entry_id is null and v_je is not null;
  if v_je is not null then
    case new.source_doc_type
      when 'goods_receipt' then update public.goods_receipts set journal_entry_id = v_je where id = new.source_doc_id and journal_entry_id is null;
      when 'delivery' then update public.deliveries set journal_entry_id = v_je where id = new.source_doc_id and journal_entry_id is null;
      when 'stock_adjustment' then update public.stock_adjustments set journal_entry_id = v_je where id = new.source_doc_id and journal_entry_id is null;
      else null;
    end case;
  end if;
  return null;
end $$;

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
    ) d, q
    where d.company_id = p_company and d.deleted_at is null and d.number ilike q.pat
    order by d.number desc limit p_limit)
$$;

-- -----------------------------------------------------------------------------
-- 1. Columns
-- -----------------------------------------------------------------------------
alter table public.warehouse_tasks
  add column reference    text,
  add column notes        text,
  add column completed_by uuid references auth.users(id);

alter table public.warehouse_task_lines
  add column source_doc_type  text,
  add column source_doc_id    uuid,
  add column source_line_id   uuid,
  add column done_location_id uuid,
  add column done_at          timestamptz,
  add column done_by          uuid references auth.users(id),
  add foreign key (company_id, done_location_id) references public.warehouse_locations(company_id, id);
create index warehouse_task_lines_source_idx on public.warehouse_task_lines (source_doc_id);

alter table public.deliveries
  add column picked_at          timestamptz,
  add column package_count      smallint check (package_count > 0),
  add column shipping_weight_kg numeric(12,3) check (shipping_weight_kg >= 0),
  add column carrier_name       text,
  add column shipped_by         uuid references auth.users(id);

alter table public.cycle_counts
  add column posted_at timestamptz,
  add column notes     text;

alter table public.pos_orders add column device_ref text;              -- receipt number printed by the till (offline too)
alter table public.z_reports  add column items jsonb not null default '[]'::jsonb;   -- best sellers of the session
alter table public.pos_sessions  add constraint pos_sessions_opened_by_profile_fkey foreign key (opened_by)  references public.profiles(id);
alter table public.pos_orders    add constraint pos_orders_cashier_profile_fkey      foreign key (cashier_id) references public.profiles(id);
alter table public.warehouse_tasks add constraint warehouse_tasks_completed_by_profile_fkey foreign key (completed_by) references public.profiles(id);
alter table public.pos_sessions add column cash_journal_entry_id uuid,
  add foreign key (company_id, cash_journal_entry_id) references public.journal_entries(company_id, id);

-- statuses only actions may set
do $$
declare r record;
begin
  for r in select * from (values
    ('warehouse_tasks', array['in_progress','done']),
    ('cycle_counts',    array['in_progress','review','posted']),
    ('pos_sessions',    array['closing','closed']),
    ('pos_orders',      array['draft','paid','cancelled'])
  ) x(tbl, statuses) loop
    execute format('create trigger trg_02_system_status before insert or update of status on public.%I
                    for each row execute function app.tg_system_statuses(%s)',
                   r.tbl, (select string_agg(quote_literal(s), ', ') from unnest(r.statuses) s));
  end loop;
end $$;

-- task progress only changes through confirm_task_line / confirm_pick
create or replace function app.tg_task_line_progress()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.is_client_context() and (
       (tg_op = 'INSERT' and (new.quantity_done <> 0 or new.done_at is not null))
    or (tg_op = 'UPDATE' and (new.quantity_done is distinct from old.quantity_done or new.done_location_id is distinct from old.done_location_id
                              or new.done_at is distinct from old.done_at or new.done_by is distinct from old.done_by))) then
    raise exception 'Task progress is confirmed by scanning, not edited' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_03_progress before insert or update on public.warehouse_task_lines
  for each row execute function app.tg_task_line_progress();

-- -----------------------------------------------------------------------------
-- 2. Lots: create from the scanner, trace, expiry
-- -----------------------------------------------------------------------------
create or replace function public.ensure_lot(p_variant uuid, p_lot_number text, p_expiry date default null,
                                             p_manufactured date default null, p_vendor uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_id uuid; v_track text;
begin
  select v.company_id, p.tracking into v_company, v_track
    from public.product_variants v join public.products p on p.id = v.product_id where v.id = p_variant;
  if v_company is null then raise exception 'Unknown product' using errcode = 'P0002'; end if;
  if not (app.has_permission(v_company, 'wms.write') or app.has_permission(v_company, 'inventory.write')) then
    raise exception 'Permission denied: wms.write required' using errcode = '42501';
  end if;
  if nullif(btrim(p_lot_number), '') is null then raise exception 'Enter the lot or serial number' using errcode = '23514'; end if;
  select id into v_id from public.lots
   where company_id = v_company and variant_id = p_variant and lot_number = btrim(p_lot_number) and deleted_at is null;
  if v_id is null then
    insert into public.lots (company_id, variant_id, lot_number, lot_type, expiry_date, manufacture_date, vendor_id)
    values (v_company, p_variant, btrim(p_lot_number), case when v_track = 'serial' then 'serial' else 'lot' end,
            p_expiry, p_manufactured, p_vendor)
    returning id into v_id;
  else
    update public.lots set expiry_date = coalesce(expiry_date, p_expiry), manufacture_date = coalesce(manufacture_date, p_manufactured),
                           vendor_id = coalesce(vendor_id, p_vendor)
     where id = v_id and (expiry_date is null or manufacture_date is null or vendor_id is null);
  end if;
  return v_id;
end $$;

-- Everything known about one lot: where it is now, every movement, and who received it (recall list)
create or replace function public.lot_trace(p_lot uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with lt as (
    select l.*, v.sku, v.name as variant_name, p.tracking, p.track_expiry, bp.name as vendor_name
      from public.lots l join public.product_variants v on v.id = l.variant_id join public.products p on p.id = v.product_id
      left join public.business_partners bp on bp.id = l.vendor_id
     where l.id = p_lot),
  mv as (
    select m.id, m.movement_date, m.movement_type, m.quantity, m.unit_cost, m.total_cost, m.reference,
           m.source_doc_type, m.source_doc_id,
           fl.code as from_code, fl.location_type as from_type, tl.code as to_code, tl.location_type as to_type,
           coalesce(gbp.name, dbp.name, pbp.name, reg.name) as partner_name,
           coalesce(gr.vendor_id, d.partner_id, po.partner_id) as partner_id
      from public.stock_movements m
      join public.warehouse_locations fl on fl.id = m.from_location_id
      join public.warehouse_locations tl on tl.id = m.to_location_id
      left join public.goods_receipts gr on m.source_doc_type = 'goods_receipt' and gr.id = m.source_doc_id
      left join public.business_partners gbp on gbp.id = gr.vendor_id
      left join public.deliveries d on m.source_doc_type = 'delivery' and d.id = m.source_doc_id
      left join public.business_partners dbp on dbp.id = d.partner_id
      left join public.pos_orders po on m.source_doc_type = 'pos_order' and po.id = m.source_doc_id
      left join public.business_partners pbp on pbp.id = po.partner_id
      left join public.pos_registers reg on reg.id = po.register_id and po.partner_id is null
     where m.lot_id = p_lot and m.movement_type <> 'revaluation')
  select jsonb_build_object(
    'lot', (select to_jsonb(lt) from lt),
    'stock', coalesce((select jsonb_agg(jsonb_build_object('location_id', sl.location_id, 'location', loc.code, 'warehouse', w.name,
                                                           'on_hand', sl.on_hand, 'reserved', sl.reserved) order by loc.code)
                         from public.stock_levels sl join public.warehouse_locations loc on loc.id = sl.location_id
                         join public.warehouses w on w.id = sl.warehouse_id
                        where sl.lot_id = p_lot and sl.on_hand <> 0), '[]'::jsonb),
    'movements', coalesce((select jsonb_agg(to_jsonb(mv) order by mv.movement_date, mv.id) from mv), '[]'::jsonb),
    'received', coalesce((select sum(quantity) from mv where movement_type in ('receipt','production_output','opening','adjustment_in','sales_return','pos_return')), 0),
    'shipped',  coalesce((select sum(quantity) from mv where movement_type in ('delivery','pos_sale')), 0),
    'customers', coalesce((select jsonb_agg(c order by c->>'name') from (
        select jsonb_build_object('partner_id', partner_id, 'name', partner_name,
                                  'quantity', sum(case when movement_type in ('delivery','pos_sale') then quantity else -quantity end),
                                  'last_date', max(movement_date)) as c
          from mv where movement_type in ('delivery','pos_sale','sales_return','pos_return') and partner_name is not null
         group by partner_id, partner_name) x), '[]'::jsonb))
$$;

create or replace function public.lots_expiring(p_company uuid, p_days int default 30)
returns table (lot_id uuid, lot_number text, variant_id uuid, sku text, name text, expiry_date date, days_left int,
               on_hand numeric, value numeric, locations text)
language sql stable security invoker set search_path = '' as $$
  select l.id, l.lot_number, l.variant_id, v.sku, v.name, l.expiry_date, (l.expiry_date - current_date)::int,
         sum(sl.on_hand), round(sum(sl.on_hand) * coalesce(max(ic.avg_cost), 0), 2),
         string_agg(distinct loc.code, ', ')
    from public.lots l
    join public.stock_levels sl on sl.lot_id = l.id and sl.on_hand > 0
    join public.warehouse_locations loc on loc.id = sl.location_id
    join public.product_variants v on v.id = l.variant_id
    left join public.item_costs ic on ic.variant_id = l.variant_id
   where l.company_id = p_company and l.deleted_at is null and l.expiry_date is not null
     and l.expiry_date <= current_date + p_days
   group by l.id, l.lot_number, l.variant_id, v.sku, v.name, l.expiry_date
   order by l.expiry_date, v.sku
$$;

-- -----------------------------------------------------------------------------
-- 3. Putaway: suggestions and tasks
-- -----------------------------------------------------------------------------
-- Ranked bins for an item: consolidate with the same item, then near the same category, then an empty bin
create or replace function public.suggest_putaway(p_variant uuid, p_warehouse uuid, p_limit int default 3)
returns table (location_id uuid, code text, reason text, on_hand numeric)
language sql stable security invoker set search_path = '' as $$
  with bins as (
    select l.* from public.warehouse_locations l
     where l.warehouse_id = p_warehouse and l.is_pickable and l.is_active and l.deleted_at is null
       and l.location_type in ('internal','picking','putaway')),
  cand as (
    select b.id, b.code, 'Already holds this item' as reason, sum(sl.on_hand) as on_hand, 1 as pri
      from bins b join public.stock_levels sl on sl.location_id = b.id and sl.variant_id = p_variant and sl.on_hand > 0
     group by b.id, b.code
    union all
    select b.id, b.code, 'Same category is stored here', null, 2
      from bins b join public.stock_levels sl on sl.location_id = b.id and sl.on_hand > 0
      join public.product_variants v on v.id = sl.variant_id join public.products p on p.id = v.product_id
     where p.category_id = (select p2.category_id from public.product_variants v2 join public.products p2 on p2.id = v2.product_id where v2.id = p_variant)
     group by b.id, b.code
    union all
    select b.id, b.code, 'Empty bin', 0, 3 from bins b
     where not exists (select 1 from public.stock_levels sl where sl.location_id = b.id and sl.on_hand > 0)
    union all
    select b.id, b.code, 'Stock location', null, 4 from bins b)
  select id, code, reason, on_hand from (select distinct on (id) * from cand order by id, pri) x
   order by pri, on_hand desc nulls last, code
   limit p_limit
$$;

create or replace function app.new_task(p_company uuid, p_type text, p_warehouse uuid, p_reference text, p_source_type text default null, p_source_id uuid default null)
returns uuid language sql set search_path = '' as $$
  insert into public.warehouse_tasks (company_id, task_type, warehouse_id, reference, source_doc_type, source_doc_id, due_at, assigned_to)
  values (p_company, p_type, p_warehouse, p_reference, p_source_type, p_source_id, now(), null)
  returning id
$$;

-- Putaway for what a receipt left in a non-pickable location (receiving, quality)
create or replace function app.putaway_for_receipt(p_receipt uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.goods_receipts; v_task uuid; l record; n int := 0;
begin
  select * into r from public.goods_receipts where id = p_receipt;
  for l in select gl.variant_id, gl.lot_id, gl.location_id, sum(gl.quantity) as qty, min(v.sku) as sku
             from public.goods_receipt_lines gl
             join public.warehouse_locations loc on loc.id = gl.location_id
             join public.product_variants v on v.id = gl.variant_id
            where gl.receipt_id = r.id and gl.qc_status <> 'rejected' and not loc.is_pickable
            group by gl.variant_id, gl.lot_id, gl.location_id
            order by min(v.sku) loop
    if v_task is null then v_task := app.new_task(r.company_id, 'putaway', r.warehouse_id, r.number, 'goods_receipt', r.id); end if;
    n := n + 1;
    insert into public.warehouse_task_lines (company_id, task_id, sequence, variant_id, lot_id, from_location_id, to_location_id, quantity,
                                             source_doc_type, source_doc_id)
    values (r.company_id, v_task, n, l.variant_id, l.lot_id, l.location_id,
            (select s.location_id from public.suggest_putaway(l.variant_id, r.warehouse_id, 1) s), l.qty, 'goods_receipt', r.id);
  end loop;
  return v_task;
end $$;

create or replace function app.tg_receipt_putaway()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'done' and old.status is distinct from 'done' then perform app.putaway_for_receipt(new.id); end if;
  return null;
end $$;
create trigger trg_93_putaway after update of status on public.goods_receipts
  for each row execute function app.tg_receipt_putaway();

-- Sweep a location (e.g. WH/RECEIVING) into a putaway task: whatever is there and not already on an open task
create or replace function public.create_putaway_task(p_location uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare loc public.warehouse_locations; v_task uuid; l record; n int := 0;
begin
  select * into loc from public.warehouse_locations where id = p_location;
  if loc.id is null or loc.warehouse_id is null then raise exception 'Choose a warehouse location' using errcode = 'P0002'; end if;
  perform app.require_permission(loc.company_id, 'wms.write');
  for l in
    select sl.variant_id, sl.lot_id, sl.on_hand - sl.reserved - coalesce((
             select sum(tl.quantity - tl.quantity_done) from public.warehouse_task_lines tl join public.warehouse_tasks t on t.id = tl.task_id
              where tl.from_location_id = sl.location_id and tl.variant_id = sl.variant_id and tl.lot_id is not distinct from sl.lot_id
                and t.task_type in ('putaway','move') and t.status in ('open','in_progress') and t.deleted_at is null), 0) as qty
      from public.stock_levels sl join public.product_variants v on v.id = sl.variant_id
     where sl.location_id = loc.id and sl.on_hand > 0
     order by v.sku
  loop
    continue when l.qty <= 0;
    if v_task is null then v_task := app.new_task(loc.company_id, 'putaway', loc.warehouse_id, loc.code); end if;
    n := n + 1;
    insert into public.warehouse_task_lines (company_id, task_id, sequence, variant_id, lot_id, from_location_id, to_location_id, quantity)
    values (loc.company_id, v_task, n, l.variant_id, l.lot_id, loc.id,
            (select s.location_id from public.suggest_putaway(l.variant_id, loc.warehouse_id, 1) s where s.location_id <> loc.id), l.qty);
  end loop;
  if v_task is null then raise exception 'Nothing to put away at %', loc.code using errcode = '23514'; end if;
  return v_task;
end $$;

create or replace function app.task_progress(p_task uuid)
returns text language plpgsql set search_path = '' as $$
declare t public.warehouse_tasks;
begin
  select * into t from public.warehouse_tasks where id = p_task;
  if t.status = 'open' then update public.warehouse_tasks set status = 'in_progress', started_at = now() where id = t.id; end if;
  if t.task_type <> 'pick' and not exists (select 1 from public.warehouse_task_lines where task_id = t.id and quantity_done < quantity) then
    update public.warehouse_tasks set status = 'done', completed_at = now(), completed_by = auth.uid() where id = t.id;
    return 'done';
  end if;
  return 'in_progress';
end $$;

-- Confirm a putaway / move line: moves the stock to the scanned (or suggested) bin
create or replace function public.confirm_task_line(p_line uuid, p_qty numeric, p_to uuid default null, p_lot uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare tl public.warehouse_task_lines; t public.warehouse_tasks; v_to public.warehouse_locations; v_free numeric; v_status text;
begin
  select * into tl from public.warehouse_task_lines where id = p_line for update;
  if tl.id is null then raise exception 'Task line not found' using errcode = 'P0002'; end if;
  select * into t from public.warehouse_tasks where id = tl.task_id for update;
  perform app.require_permission(t.company_id, 'wms.write');
  if t.status not in ('open','in_progress') then raise exception 'Task % is %', t.number, t.status using errcode = '55000'; end if;
  if t.task_type = 'pick' then raise exception 'Use the picking screen for pick lists' using errcode = '23514'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'Quantity must be greater than zero' using errcode = '23514'; end if;
  if p_qty > tl.quantity - tl.quantity_done then
    raise exception 'Only % left on this line', trim_scale(tl.quantity - tl.quantity_done) using errcode = '23514';
  end if;
  select * into v_to from public.warehouse_locations where id = coalesce(p_to, tl.to_location_id);
  if v_to.id is null then raise exception 'Scan the bin you put the goods in' using errcode = '23514'; end if;
  if v_to.warehouse_id is distinct from t.warehouse_id then raise exception 'Bin % is in another warehouse', v_to.code using errcode = '23514'; end if;
  if v_to.location_type = 'view' or not v_to.is_active then raise exception 'Bin % cannot hold stock', v_to.code using errcode = '23514'; end if;
  select coalesce(sum(on_hand - reserved), 0) into v_free from public.stock_levels
   where location_id = tl.from_location_id and variant_id = tl.variant_id and lot_id is not distinct from coalesce(p_lot, tl.lot_id);
  if v_free < p_qty then raise exception 'Only % free at the source bin', trim_scale(v_free) using errcode = 'P0001'; end if;

  perform app.post_stock_move(t.company_id, 'transfer', tl.variant_id, tl.from_location_id, v_to.id, p_qty, null, coalesce(p_lot, tl.lot_id),
                              'warehouse_task', t.id, tl.id, t.number);
  update public.warehouse_task_lines
     set quantity_done = quantity_done + p_qty, done_location_id = v_to.id, done_at = now(), done_by = auth.uid(),
         lot_id = coalesce(p_lot, lot_id)
   where id = tl.id;
  v_status := app.task_progress(t.id);
  return jsonb_build_object('task_status', v_status, 'line_done', tl.quantity_done + p_qty >= tl.quantity, 'location', v_to.code);
end $$;

create or replace function public.cancel_task(p_task uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare t public.warehouse_tasks;
begin
  select * into t from public.warehouse_tasks where id = p_task for update;
  perform app.require_permission(t.company_id, 'wms.write');
  if t.status <> 'open' then raise exception 'Only tasks nobody has started can be cancelled (this one is %)', replace(t.status, '_', ' ') using errcode = '55000'; end if;
  update public.warehouse_tasks set status = 'cancelled' where id = t.id;
  return 'cancelled';
end $$;

-- -----------------------------------------------------------------------------
-- 4. Picking and shipping
-- -----------------------------------------------------------------------------
-- One pick list for one or more deliveries, ordered along the bins
create or replace function public.create_pick_list(p_deliveries uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare d record; v_wh uuid; v_company uuid; v_task uuid; v_ref text;
begin
  if coalesce(array_length(p_deliveries, 1), 0) = 0 then raise exception 'Choose at least one delivery' using errcode = '23514'; end if;
  select company_id into v_company from public.deliveries where id = p_deliveries[1];
  if v_company is null then raise exception 'Deliveries not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_company, 'wms.write');
  for d in select * from public.deliveries where id = any (p_deliveries) order by number for update loop
    v_wh := coalesce(v_wh, d.warehouse_id);
    if d.company_id <> v_company or d.warehouse_id <> v_wh then
      raise exception 'A pick list covers one warehouse; % ships from another', d.number using errcode = '23514';
    end if;
    if d.status <> 'draft' then raise exception 'Delivery % is %; only open deliveries are picked', d.number, d.status using errcode = '55000'; end if;
    if d.delivery_type <> 'outbound' then raise exception '% is a return, nothing to pick', d.number using errcode = '23514'; end if;
    if exists (select 1 from public.warehouse_task_lines tl join public.warehouse_tasks t on t.id = tl.task_id
                where tl.source_doc_id = d.id and t.task_type = 'pick' and t.status in ('open','in_progress') and t.deleted_at is null) then
      raise exception 'Delivery % is already on an open pick list', d.number using errcode = '23514';
    end if;
  end loop;
  select string_agg(number, ', ' order by number) into v_ref from public.deliveries where id = any (p_deliveries);
  v_task := app.new_task(v_company, 'pick', v_wh, v_ref);
  insert into public.warehouse_task_lines (company_id, task_id, sequence, variant_id, lot_id, from_location_id, quantity,
                                           source_doc_type, source_doc_id, source_line_id)
  select v_company, v_task, row_number() over (order by loc.code, v.sku, dl.created_at), dl.variant_id, dl.lot_id, dl.location_id, dl.quantity,
         'delivery', dl.delivery_id, dl.id
    from public.delivery_lines dl
    join public.warehouse_locations loc on loc.id = dl.location_id
    join public.product_variants v on v.id = dl.variant_id
   where dl.delivery_id = any (p_deliveries);
  if not found then raise exception 'The deliveries have no lines to pick' using errcode = '23514'; end if;
  return v_task;
end $$;

-- What was actually picked for a line (absolute quantity; the scanner adds up client-side)
create or replace function public.confirm_pick(p_line uuid, p_qty numeric, p_location uuid default null, p_lot uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare tl public.warehouse_task_lines; t public.warehouse_tasks; loc public.warehouse_locations; v_lot uuid;
begin
  select * into tl from public.warehouse_task_lines where id = p_line for update;
  if tl.id is null then raise exception 'Pick line not found' using errcode = 'P0002'; end if;
  select * into t from public.warehouse_tasks where id = tl.task_id for update;
  perform app.require_permission(t.company_id, 'wms.write');
  if t.task_type <> 'pick' then raise exception 'Not a pick list' using errcode = '23514'; end if;
  if t.status not in ('open','in_progress') then raise exception 'Pick list % is %', t.number, t.status using errcode = '55000'; end if;
  if p_qty is null or p_qty < 0 then raise exception 'Quantity cannot be negative' using errcode = '23514'; end if;
  if p_qty > tl.quantity then raise exception 'Over-pick: % requested, % picked', trim_scale(tl.quantity), trim_scale(p_qty) using errcode = '23514'; end if;
  select * into loc from public.warehouse_locations where id = coalesce(p_location, tl.from_location_id);
  if loc.warehouse_id is distinct from t.warehouse_id then raise exception 'Bin % is in another warehouse', loc.code using errcode = '23514'; end if;
  v_lot := coalesce(p_lot, tl.lot_id);
  if p_lot is not null and not exists (select 1 from public.lots where id = p_lot and variant_id = tl.variant_id) then
    raise exception 'That lot belongs to another product' using errcode = '23514';
  end if;
  update public.warehouse_task_lines
     set quantity_done = p_qty, from_location_id = loc.id, lot_id = v_lot, done_location_id = loc.id, done_at = now(), done_by = auth.uid()
   where id = tl.id;
  update public.delivery_lines set location_id = loc.id, lot_id = v_lot where id = tl.source_line_id
     and (location_id is distinct from loc.id or lot_id is distinct from v_lot);
  perform app.task_progress(t.id);
  return jsonb_build_object('picked', p_qty, 'short', tl.quantity - p_qty);
end $$;

-- Close the pick list: short picks shrink the delivery lines; picked deliveries are ready to ship
create or replace function public.complete_pick_list(p_task uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.warehouse_tasks; l record; d record; v_ready int := 0; v_short int := 0; v_empty int := 0;
begin
  select * into t from public.warehouse_tasks where id = p_task for update;
  if t.id is null then raise exception 'Pick list not found' using errcode = 'P0002'; end if;
  perform app.require_permission(t.company_id, 'wms.write');
  if t.task_type <> 'pick' or t.status not in ('open','in_progress') then raise exception 'Pick list % is %', t.number, t.status using errcode = '55000'; end if;
  for l in select * from public.warehouse_task_lines where task_id = t.id loop
    if l.quantity_done < l.quantity then
      v_short := v_short + 1;
      if l.quantity_done = 0 then delete from public.delivery_lines where id = l.source_line_id;
      else update public.delivery_lines set quantity = l.quantity_done where id = l.source_line_id; end if;
    end if;
  end loop;
  for d in select distinct tl.source_doc_id as id from public.warehouse_task_lines tl where tl.task_id = t.id loop
    if exists (select 1 from public.delivery_lines where delivery_id = d.id) then
      update public.deliveries set status = 'ready', picked_at = now() where id = d.id and status = 'draft';
      v_ready := v_ready + 1;
    else
      update public.deliveries set status = 'cancelled', notes = coalesce(notes || E'\n', '') || 'Nothing could be picked (' || t.number || ')'
       where id = d.id and status = 'draft';
      v_empty := v_empty + 1;
    end if;
  end loop;
  if t.status = 'open' then update public.warehouse_tasks set status = 'in_progress', started_at = now() where id = t.id; end if;
  update public.warehouse_tasks set status = 'done', completed_at = now(), completed_by = auth.uid() where id = t.id;
  return jsonb_build_object('ready', v_ready, 'short_lines', v_short, 'nothing_picked', v_empty);
end $$;

-- Shipping confirmation: carrier, tracking, parcels — and the goods leave the warehouse
create or replace function public.confirm_shipment(p_delivery uuid, p_carrier text default null, p_tracking text default null,
                                                   p_packages int default null, p_weight numeric default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.deliveries; v jsonb;
begin
  select * into d from public.deliveries where id = p_delivery for update;
  if d.id is null then raise exception 'Delivery not found' using errcode = 'P0002'; end if;
  perform app.require_permission(d.company_id, 'wms.write');
  if d.status not in ('draft','ready') then raise exception 'Delivery % is already %', d.number, d.status using errcode = '55000'; end if;
  update public.deliveries
     set carrier_name = coalesce(nullif(btrim(p_carrier), ''), carrier_name),
         tracking_number = coalesce(nullif(btrim(p_tracking), ''), tracking_number),
         package_count = coalesce(p_packages, package_count), shipping_weight_kg = coalesce(p_weight, shipping_weight_kg),
         shipped_by = auth.uid()
   where id = d.id;
  v := public.post_delivery(d.id);
  return v || jsonb_build_object('number', d.number);
end $$;

-- -----------------------------------------------------------------------------
-- 5. Quick move (bin to bin, or to another warehouse) — one posted transfer
-- -----------------------------------------------------------------------------
create or replace function public.move_stock(p_from uuid, p_to uuid, p_items jsonb, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare f public.warehouse_locations; t public.warehouse_locations; i jsonb; v_tr uuid; v_free numeric; v_sku text; v_qty numeric; v_lot uuid;
begin
  select * into f from public.warehouse_locations where id = p_from;
  select * into t from public.warehouse_locations where id = p_to;
  if f.id is null or t.id is null or f.warehouse_id is null or t.warehouse_id is null then
    raise exception 'Scan a source and a destination bin' using errcode = '23514';
  end if;
  if f.company_id <> t.company_id then raise exception 'Unknown location' using errcode = '23503'; end if;
  perform app.require_permission(f.company_id, 'wms.write');
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) = 0 then raise exception 'Scan at least one item' using errcode = '23514'; end if;
  insert into public.stock_transfers (company_id, from_warehouse_id, to_warehouse_id, notes)
  values (f.company_id, f.warehouse_id, t.warehouse_id, coalesce(p_notes, 'Quick move ' || f.code || ' → ' || t.code))
  returning id into v_tr;
  for i in select * from jsonb_array_elements(p_items) loop
    v_qty := (i->>'quantity')::numeric; v_lot := nullif(i->>'lot_id', '')::uuid;
    select coalesce(sum(sl.on_hand - sl.reserved), 0), min(v.sku) into v_free, v_sku
      from public.product_variants v left join public.stock_levels sl on sl.variant_id = v.id and sl.location_id = f.id and sl.lot_id is not distinct from v_lot
     where v.id = (i->>'variant_id')::uuid and v.company_id = f.company_id;
    if v_sku is null then raise exception 'Unknown product' using errcode = '23503'; end if;
    if v_free < v_qty then
      raise exception 'Only % of % is free at % (the rest is reserved or not there)', trim_scale(v_free), v_sku, f.code using errcode = 'P0001';
    end if;
    insert into public.stock_transfer_lines (company_id, transfer_id, variant_id, lot_id, from_location_id, to_location_id, quantity)
    values (f.company_id, v_tr, (i->>'variant_id')::uuid, v_lot, f.id, t.id, v_qty);
  end loop;
  perform public.post_stock_transfer(v_tr);
  return v_tr;
end $$;

-- -----------------------------------------------------------------------------
-- 6. Cycle counts
-- -----------------------------------------------------------------------------
create or replace function public.create_cycle_count(p_warehouse uuid, p_locations uuid[] default null, p_category uuid default null,
                                                     p_blind boolean default true)
returns uuid language plpgsql security definer set search_path = '' as $$
declare w public.warehouses; v_id uuid;
begin
  select * into w from public.warehouses where id = p_warehouse;
  if w.id is null then raise exception 'Warehouse not found' using errcode = 'P0002'; end if;
  perform app.require_permission(w.company_id, 'wms.write');
  insert into public.cycle_counts (company_id, warehouse_id, scope, scope_filter, blind_count, assigned_to)
  values (w.company_id, w.id,
          case when p_locations is not null then 'location' when p_category is not null then 'category' else 'full' end,
          jsonb_strip_nulls(jsonb_build_object('locations', p_locations, 'category_id', p_category)), p_blind, auth.uid())
  returning id into v_id;
  insert into public.cycle_count_lines (company_id, cycle_count_id, variant_id, location_id, lot_id, system_qty)
  select w.company_id, v_id, sl.variant_id, sl.location_id, sl.lot_id, sl.on_hand
    from public.stock_levels sl
    join public.warehouse_locations loc on loc.id = sl.location_id
    join public.product_variants v on v.id = sl.variant_id join public.products p on p.id = v.product_id
   where sl.warehouse_id = w.id and sl.on_hand <> 0
     and (p_locations is null or sl.location_id = any (p_locations))
     and (p_category is null or p.category_id = p_category)
   order by loc.code, v.sku;
  if not found and p_locations is null then raise exception 'Nothing in stock matches this count' using errcode = '23514'; end if;
  update public.cycle_counts set status = 'in_progress' where id = v_id;
  return v_id;
end $$;

-- One scan (or typed quantity) in a count; adds a line for items found where the system had none
create or replace function public.count_item(p_count uuid, p_variant uuid, p_location uuid, p_qty numeric,
                                             p_lot uuid default null, p_set boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.cycle_counts; loc public.warehouse_locations; ln public.cycle_count_lines; v_track text;
begin
  select * into c from public.cycle_counts where id = p_count for update;
  if c.id is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
  perform app.require_permission(c.company_id, 'wms.write');
  if c.status <> 'in_progress' then raise exception 'Count % is %', c.number, replace(c.status, '_', ' ') using errcode = '55000'; end if;
  select * into loc from public.warehouse_locations where id = p_location;
  if loc.warehouse_id is distinct from c.warehouse_id then raise exception 'Bin % is not in the counted warehouse', loc.code using errcode = '23514'; end if;
  select p.tracking into v_track from public.product_variants v join public.products p on p.id = v.product_id
   where v.id = p_variant and v.company_id = c.company_id;
  if v_track is null then raise exception 'Unknown product' using errcode = '23503'; end if;
  if v_track <> 'none' and p_lot is null then raise exception 'Scan or choose the lot for this item' using errcode = '23514'; end if;
  if p_qty is null or (p_set and p_qty < 0) then raise exception 'Enter a quantity' using errcode = '23514'; end if;

  select * into ln from public.cycle_count_lines
   where cycle_count_id = c.id and variant_id = p_variant and location_id = p_location and lot_id is not distinct from p_lot;
  if ln.id is null then
    insert into public.cycle_count_lines (company_id, cycle_count_id, variant_id, location_id, lot_id, system_qty, counted_qty, counted_by, counted_at)
    values (c.company_id, c.id, p_variant, p_location, p_lot,
            coalesce((select on_hand from public.stock_levels where variant_id = p_variant and location_id = p_location and lot_id is not distinct from p_lot), 0),
            greatest(p_qty, 0), auth.uid(), now())
    returning * into ln;
  else
    update public.cycle_count_lines
       set counted_qty = greatest(case when p_set then p_qty else coalesce(counted_qty, 0) + p_qty end, 0), counted_by = auth.uid(), counted_at = now()
     where id = ln.id returning * into ln;
  end if;
  return jsonb_build_object('line_id', ln.id, 'counted_qty', ln.counted_qty,
                            'system_qty', case when c.blind_count then null else ln.system_qty end);
end $$;

-- Counter is done: uncounted lines become 0 when asked, then the count waits for review
create or replace function public.submit_cycle_count(p_id uuid, p_zero_uncounted boolean default false)
returns text language plpgsql security definer set search_path = '' as $$
declare c public.cycle_counts; v_open int;
begin
  select * into c from public.cycle_counts where id = p_id for update;
  perform app.require_permission(c.company_id, 'wms.write');
  if c.status <> 'in_progress' then raise exception 'Count % is %', c.number, c.status using errcode = '55000'; end if;
  if p_zero_uncounted then
    update public.cycle_count_lines set counted_qty = 0, counted_by = auth.uid(), counted_at = now() where cycle_count_id = c.id and counted_qty is null;
  end if;
  select count(*) into v_open from public.cycle_count_lines where cycle_count_id = c.id and counted_qty is null;
  if v_open > 0 then raise exception '% line(s) are not counted yet; count them or submit with "count missing as zero"', v_open using errcode = '23514'; end if;
  update public.cycle_counts set status = 'review' where id = c.id;
  return 'review';
end $$;

-- Reviewer posts: each counted quantity is compared with what the bin held WHEN IT WAS COUNTED
-- (current stock minus whatever moved in or out since), so picks and moves during the count are not undone
create or replace function public.post_cycle_count(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.cycle_counts; v_adj uuid; v_lines int; v_status text;
begin
  select * into c from public.cycle_counts where id = p_id for update;
  if c.id is null then raise exception 'Count not found' using errcode = 'P0002'; end if;
  perform app.require_permission(c.company_id, 'inventory.write');
  if c.status <> 'review' then raise exception 'Submit the count for review first (it is %)', replace(c.status, '_', ' ') using errcode = '55000'; end if;
  insert into public.stock_adjustments (company_id, warehouse_id, reason, notes)
  values (c.company_id, c.warehouse_id, 'count', 'From cycle count ' || c.number) returning id into v_adj;
  insert into public.stock_adjustment_lines (company_id, adjustment_id, variant_id, location_id, lot_id, quantity_change)
  select c.company_id, v_adj, x.variant_id, x.location_id, x.lot_id, x.delta
    from (select cl.variant_id, cl.location_id, cl.lot_id,
                 cl.counted_qty - (coalesce((select sl.on_hand from public.stock_levels sl where sl.variant_id = cl.variant_id
                                               and sl.location_id = cl.location_id and sl.lot_id is not distinct from cl.lot_id), 0)
                                   - coalesce((select sum(case when m.to_location_id = cl.location_id then m.quantity else -m.quantity end)
                                                 from public.stock_movements m
                                                where m.company_id = cl.company_id and m.variant_id = cl.variant_id and m.lot_id is not distinct from cl.lot_id
                                                  and cl.location_id in (m.from_location_id, m.to_location_id)
                                                  and m.created_at > coalesce(cl.counted_at, c.created_at)), 0)) as delta
            from public.cycle_count_lines cl where cl.cycle_count_id = c.id and cl.counted_qty is not null) x
   where x.delta <> 0;
  get diagnostics v_lines = row_count;
  if v_lines = 0 then
    delete from public.stock_adjustments where id = v_adj;
    v_adj := null; v_status := 'nothing_to_adjust';
  else
    v_status := public.post_stock_adjustment(v_adj);
  end if;
  update public.cycle_counts set status = 'posted', posted_at = now(), adjustment_id = v_adj where id = c.id;
  return jsonb_build_object('adjustment_id', v_adj, 'adjustment_status', v_status, 'lines', v_lines,
                            'value', (select total_value from public.stock_adjustments where id = v_adj));
end $$;

-- -----------------------------------------------------------------------------
-- 7. WMS overview
-- -----------------------------------------------------------------------------
create or replace function public.wms_overview(p_company uuid, p_warehouse uuid default null)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'receipts_open', (select count(*) from public.goods_receipts where company_id = p_company and status = 'draft' and deleted_at is null
                        and (p_warehouse is null or warehouse_id = p_warehouse)),
    'putaway_lines', (select count(*) from public.warehouse_task_lines tl join public.warehouse_tasks t on t.id = tl.task_id
                        where t.company_id = p_company and t.task_type = 'putaway' and t.status in ('open','in_progress') and t.deleted_at is null
                          and tl.quantity_done < tl.quantity and (p_warehouse is null or t.warehouse_id = p_warehouse)),
    'to_pick', (select count(*) from public.deliveries d where d.company_id = p_company and d.status = 'draft' and d.deleted_at is null
                  and d.delivery_type = 'outbound' and (p_warehouse is null or d.warehouse_id = p_warehouse)
                  and not exists (select 1 from public.warehouse_task_lines tl join public.warehouse_tasks t on t.id = tl.task_id
                                   where tl.source_doc_id = d.id and t.status in ('open','in_progress'))),
    'picking', (select count(*) from public.warehouse_tasks where company_id = p_company and task_type = 'pick' and status in ('open','in_progress')
                  and deleted_at is null and (p_warehouse is null or warehouse_id = p_warehouse)),
    'to_ship', (select count(*) from public.deliveries where company_id = p_company and status = 'ready' and deleted_at is null
                  and (p_warehouse is null or warehouse_id = p_warehouse)),
    'shipped_today', (select count(*) from public.deliveries where company_id = p_company and status = 'done' and done_at::date = current_date
                        and (p_warehouse is null or warehouse_id = p_warehouse)),
    'counts_open', (select count(*) from public.cycle_counts where company_id = p_company and status in ('in_progress','review') and deleted_at is null
                      and (p_warehouse is null or warehouse_id = p_warehouse)),
    'in_receiving', (select coalesce(sum(sl.on_hand), 0) from public.stock_levels sl join public.warehouse_locations l on l.id = sl.location_id
                      where sl.company_id = p_company and l.location_type in ('receiving','quality') and (p_warehouse is null or sl.warehouse_id = p_warehouse)),
    'expiring_30', (select count(*) from public.lots_expiring(p_company, 30) e where e.days_left >= 0),
    'expired', (select count(*) from public.lots_expiring(p_company, 0) e where e.days_left < 0))
$$;

-- -----------------------------------------------------------------------------
-- 8. Point of sale
-- -----------------------------------------------------------------------------
-- Catalog for the till (cached on the device for offline use): tax-inclusive prices, barcodes, stock at the register
create or replace function public.pos_catalog(p_register uuid)
returns table (variant_id uuid, sku text, name text, category text, barcodes jsonb, price numeric, tax_code_id uuid, tax_rate numeric,
               tracking text, on_hand numeric, image_path text, product_type text)
language sql stable security invoker set search_path = '' as $$
  select v.id, v.sku, v.name, c.name,
         coalesce((select jsonb_agg(jsonb_build_object('code', b.barcode, 'qty', b.quantity)) from public.product_barcodes b
                    where b.variant_id = v.id and b.deleted_at is null), '[]'::jsonb),
         round(coalesce(gp.unit_price * (1 - coalesce(gp.discount_pct, 0) / 100), coalesce(v.sales_price_override, p.sales_price))
               * (1 + coalesce(t.rate, 0) / 100), 2),
         p.sales_tax_code_id, coalesce(t.rate, 0), p.tracking,
         coalesce((select sum(sl.on_hand) from public.stock_levels sl where sl.variant_id = v.id and sl.location_id = r.location_id), 0),
         p.image_path, p.product_type
    from public.pos_registers r
    join public.product_variants v on v.company_id = r.company_id and v.is_active and v.deleted_at is null
    join public.products p on p.id = v.product_id and p.is_active and p.is_sellable and p.deleted_at is null
    left join public.product_categories c on c.id = p.category_id
    left join public.tax_codes t on t.id = p.sales_tax_code_id
    left join lateral public.get_price(r.company_id, r.default_customer_id, v.id, 1, current_date, r.price_list_id) gp on true
   where r.id = p_register
   order by v.name
$$;

create or replace function app.pos_accounts(p_register uuid, out drawer uuid, out cashbox uuid, out journal text)
language sql stable security definer set search_path = '' as $$
  select ba.account_id, app.acct(r.company_id, 'cash'), coalesce(j.code, 'POS')
    from public.pos_registers r join public.bank_accounts ba on ba.id = r.cash_account_id
    left join public.journals j on j.id = r.journal_id
   where r.id = p_register
$$;

create or replace function public.open_pos_session(p_register uuid, p_opening_cash numeric default 0)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.pos_registers; v_id uuid; a record; v_tz text;
begin
  select * into r from public.pos_registers where id = p_register;
  if r.id is null or r.deleted_at is not null then raise exception 'Register not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'pos.write');
  if not r.is_active then raise exception 'Register % is switched off', r.name using errcode = '55000'; end if;
  if exists (select 1 from public.pos_sessions where register_id = r.id and status <> 'closed' and deleted_at is null) then
    raise exception 'Register % already has an open session', r.name using errcode = '23505';
  end if;
  if coalesce(p_opening_cash, 0) < 0 then raise exception 'Opening cash cannot be negative' using errcode = '23514'; end if;
  insert into public.pos_sessions (company_id, register_id, opening_cash) values (r.company_id, r.id, coalesce(p_opening_cash, 0))
  returning id into v_id;
  select * into a from app.pos_accounts(r.id);
  select timezone into v_tz from public.companies where id = r.company_id;
  if coalesce(p_opening_cash, 0) > 0 and a.drawer <> a.cashbox then
    perform app.gl_post(r.company_id, a.journal, (now() at time zone v_tz)::date, 'pos_session', v_id,
                        (select number from public.pos_sessions where id = v_id), 'Opening float ' || r.name,
                        jsonb_build_array(jsonb_build_object('account_id', a.drawer, 'amount', p_opening_cash, 'description', 'Float into the drawer'),
                                          jsonb_build_object('account_id', a.cashbox, 'amount', -p_opening_cash, 'description', 'Float into the drawer')),
                        'open');
  end if;
  return v_id;
end $$;

create or replace function public.pos_cash_move(p_session uuid, p_type text, p_amount numeric, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.pos_sessions; v_id uuid; a record; v_tz text; v_sign int;
begin
  select * into s from public.pos_sessions where id = p_session for update;
  if s.id is null then raise exception 'Session not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'pos.write');
  if s.status <> 'open' then raise exception 'Session % is closed', s.number using errcode = '55000'; end if;
  if p_type not in ('cash_in','cash_out') then raise exception 'Choose cash in or cash out' using errcode = '23514'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount' using errcode = '23514'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Say why the cash moves' using errcode = '23514'; end if;
  insert into public.pos_cash_movements (company_id, session_id, movement_type, amount, reason)
  values (s.company_id, s.id, p_type, p_amount, btrim(p_reason)) returning id into v_id;
  select * into a from app.pos_accounts(s.register_id);
  select timezone into v_tz from public.companies where id = s.company_id;
  v_sign := case when p_type = 'cash_in' then 1 else -1 end;
  if a.drawer <> a.cashbox then
    perform app.gl_post(s.company_id, a.journal, (now() at time zone v_tz)::date, 'pos_session', s.id, s.number,
                        initcap(replace(p_type, '_', ' ')) || ': ' || btrim(p_reason),
                        jsonb_build_array(jsonb_build_object('account_id', a.drawer, 'amount', v_sign * p_amount, 'description', btrim(p_reason)),
                                          jsonb_build_object('account_id', a.cashbox, 'amount', -v_sign * p_amount, 'description', btrim(p_reason))),
                        'cash:' || v_id);
  end if;
  return v_id;
end $$;

-- One sale or refund from the till. Idempotent on client_uuid, so the offline queue can replay safely.
-- p: {client_uuid, session_id, order_at, device_ref, offline, partner_id, is_refund, refund_of_id,
--     lines: [{variant_id, quantity, unit_price (tax-inclusive), discount_pct, lot_id, barcode, description}],
--     payments: [{method, amount, reference}]}
create or replace function public.pos_submit_order(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  s public.pos_sessions; r public.pos_registers; ex record; v_id uuid; v_client uuid; v_refund boolean; v_orig public.pos_orders;
  l jsonb; ln record; n int := 0; v_customer uuid; v_left numeric; v_take numeric; lt record; v_mv uuid; v_cost numeric; v_first_lot uuid;
  v_total numeric; v_paid numeric := 0; v_cash numeric := 0; v_change numeric; pay jsonb; v_amt numeric; v_order_at timestamptz;
  v_max_disc numeric := 10; v_number text;
begin
  v_client := nullif(p->>'client_uuid', '')::uuid;
  if v_client is null then raise exception 'client_uuid is required' using errcode = '23514'; end if;
  select * into s from public.pos_sessions where id = (p->>'session_id')::uuid for share;
  if s.id is null then raise exception 'Session not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'pos.write');

  select id, number, total, status into ex from public.pos_orders where company_id = s.company_id and client_uuid = v_client;
  if ex.id is not null then
    return jsonb_build_object('id', ex.id, 'number', ex.number, 'total', ex.total, 'duplicate', true);
  end if;
  if s.status <> 'open' then
    raise exception 'SESSION_CLOSED: session % is already closed', s.number using errcode = '55000';
  end if;
  select * into r from public.pos_registers where id = s.register_id;
  v_refund := coalesce((p->>'is_refund')::boolean, false);
  v_order_at := least(coalesce((p->>'order_at')::timestamptz, now()), now());
  if v_refund then
    select * into v_orig from public.pos_orders where id = (p->>'refund_of_id')::uuid and company_id = s.company_id;
    if v_orig.id is null then raise exception 'Choose the receipt being refunded' using errcode = '23514'; end if;
    if v_orig.is_refund then raise exception 'A refund cannot be refunded' using errcode = '23514'; end if;
  end if;

  insert into public.pos_orders (company_id, client_uuid, session_id, register_id, partner_id, is_refund, refund_of_id, order_at,
                                 offline_created, device_ref, status)
  values (s.company_id, v_client, s.id, r.id, coalesce(nullif(p->>'partner_id', '')::uuid, r.default_customer_id), v_refund, v_orig.id,
          v_order_at, coalesce((p->>'offline')::boolean, false), p->>'device_ref', 'draft')
  returning id, number into v_id, v_number;

  for l in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    n := n + 1;
    if (l->>'quantity')::numeric = 0 or ((l->>'quantity')::numeric < 0) <> v_refund then
      raise exception 'Line %: sales have positive and refunds negative quantities', n using errcode = '23514';
    end if;
    if coalesce((l->>'discount_pct')::numeric, 0) > v_max_disc and not app.has_permission(s.company_id, 'pos.approve') then
      raise exception 'Discounts above % %% need a manager', v_max_disc using errcode = '42501';
    end if;
    insert into public.pos_order_lines (company_id, pos_order_id, line_no, variant_id, lot_id, barcode_scanned, description, quantity,
                                        unit_price, discount_pct, tax_code_id)
    select s.company_id, v_id, n, v.id, nullif(l->>'lot_id', '')::uuid, l->>'barcode', coalesce(nullif(l->>'description', ''), v.name),
           (l->>'quantity')::numeric, (l->>'unit_price')::numeric, coalesce((l->>'discount_pct')::numeric, 0), p.sales_tax_code_id
      from public.product_variants v join public.products p on p.id = v.product_id
     where v.id = (l->>'variant_id')::uuid and v.company_id = s.company_id;
    if not found then raise exception 'Line %: unknown product', n using errcode = '23503'; end if;
  end loop;
  if n = 0 then raise exception 'The receipt has no lines' using errcode = '23514'; end if;

  if v_refund then
    for ln in select ol.variant_id, -sum(ol.quantity) as qty from public.pos_order_lines ol where ol.pos_order_id = v_id group by ol.variant_id loop
      if ln.qty > coalesce((select sum(quantity) from public.pos_order_lines where pos_order_id = v_orig.id and variant_id = ln.variant_id), 0)
                  - coalesce((select -sum(ol2.quantity) from public.pos_order_lines ol2 join public.pos_orders o2 on o2.id = ol2.pos_order_id
                               where o2.refund_of_id = v_orig.id and o2.id <> v_id and o2.status = 'paid' and ol2.variant_id = ln.variant_id), 0) then
        raise exception 'Refund is more than what is left to refund on %', v_orig.number using errcode = '23514';
      end if;
    end loop;
  end if;

  -- stock leaves (or comes back to) the register's location; a busy till never stops for stock levels
  perform set_config('app.pos_allow_negative', 'on', true);
  v_customer := app.virtual_location(s.company_id, 'customer');
  for ln in select ol.*, p.product_type, p.tracking from public.pos_order_lines ol
              join public.product_variants v on v.id = ol.variant_id join public.products p on p.id = v.product_id
             where ol.pos_order_id = v_id order by ol.line_no loop
    continue when ln.product_type <> 'stockable';
    v_cost := 0; v_first_lot := ln.lot_id;
    if ln.quantity > 0 then
      v_left := ln.quantity;
      if ln.tracking <> 'none' and ln.lot_id is null then
        for lt in select sl.lot_id, sl.on_hand from public.stock_levels sl join public.lots x on x.id = sl.lot_id
                   where sl.variant_id = ln.variant_id and sl.location_id = r.location_id and sl.on_hand > 0
                   order by (x.expiry_date < current_date), x.expiry_date nulls last, x.lot_number loop
          exit when v_left <= 0;
          v_take := least(v_left, lt.on_hand);
          v_mv := app.post_stock_move(s.company_id, 'pos_sale', ln.variant_id, r.location_id, v_customer, v_take, null, lt.lot_id,
                                      'pos_order', v_id, ln.id, v_number, v_order_at);
          v_cost := v_cost + (select total_cost from public.stock_movements where id = v_mv);
          v_first_lot := coalesce(v_first_lot, lt.lot_id); v_left := v_left - v_take;
        end loop;
        if v_left > 0 then
          v_first_lot := coalesce(v_first_lot, (select id from public.lots where variant_id = ln.variant_id and deleted_at is null
                                                  order by expiry_date desc nulls first, created_at desc limit 1));
          if v_first_lot is null then
            raise exception '% is lot-tracked and has no lot at all; receive it with a lot first', ln.description using errcode = '23514';
          end if;
        end if;
      else
        v_first_lot := ln.lot_id;
      end if;
      if v_left > 0 then
        v_mv := app.post_stock_move(s.company_id, 'pos_sale', ln.variant_id, r.location_id, v_customer, v_left, null, v_first_lot,
                                    'pos_order', v_id, ln.id, v_number, v_order_at);
        v_cost := v_cost + (select total_cost from public.stock_movements where id = v_mv);
      end if;
    else
      select ol.lot_id, ol.unit_cost into lt from public.pos_order_lines ol
       where ol.pos_order_id = v_orig.id and ol.variant_id = ln.variant_id order by ol.line_no limit 1;
      v_first_lot := coalesce(ln.lot_id, lt.lot_id);
      if ln.tracking <> 'none' and v_first_lot is null then raise exception 'Choose the lot being returned' using errcode = '23514'; end if;
      v_mv := app.post_stock_move(s.company_id, 'pos_return', ln.variant_id, v_customer, r.location_id, -ln.quantity, lt.unit_cost, v_first_lot,
                                  'pos_order', v_id, ln.id, v_number, v_order_at);
      v_cost := (select total_cost from public.stock_movements where id = v_mv);
    end if;
    update public.pos_order_lines set unit_cost = round(v_cost / abs(ln.quantity), 6), lot_id = v_first_lot where id = ln.id;
  end loop;
  perform set_config('app.pos_allow_negative', 'off', true);

  -- payments
  select total into v_total from public.pos_orders where id = v_id;
  for pay in select * from jsonb_array_elements(coalesce(p->'payments', '[]'::jsonb)) loop
    v_amt := round((pay->>'amount')::numeric, 2);
    continue when coalesce(v_amt, 0) = 0;
    if (v_amt < 0) <> v_refund then raise exception 'Payments are positive on sales and negative on refunds' using errcode = '23514'; end if;
    insert into public.pos_payments (company_id, pos_order_id, method, amount, reference, paid_at)
    values (s.company_id, v_id, pay->>'method', v_amt, nullif(pay->>'reference', ''), v_order_at);
    v_paid := v_paid + v_amt;
    if pay->>'method' = 'cash' then v_cash := v_cash + v_amt; end if;
  end loop;
  v_change := round(v_paid - v_total, 2);
  if v_refund then
    if v_change <> 0 then raise exception 'Refund payments (%) must equal the refund (%)', v_paid, v_total using errcode = '23514'; end if;
  else
    if v_change < 0 then raise exception 'Payment is % short', -v_change using errcode = '23514'; end if;
    if v_change > v_cash then raise exception 'Change can only be given from cash' using errcode = '23514'; end if;
  end if;
  update public.pos_orders set amount_paid = v_paid, change_given = greatest(v_change, 0), status = 'paid' where id = v_id;
  return jsonb_build_object('id', v_id, 'number', (select number from public.pos_orders where id = v_id), 'total', v_total,
                            'change', greatest(v_change, 0), 'duplicate', false);
end $$;

-- Close: Z-report, one sales entry (revenue, VAT, money by method), one cash entry (drawer → cash box, difference)
create or replace function public.close_pos_session(p_session uuid, p_counted_cash numeric, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  s public.pos_sessions; r public.pos_registers; a record; v_tz text; v_date date; agg record; v_cash_net numeric; v_in numeric; v_out numeric;
  v_expected numeric; v_lines jsonb := '[]'::jsonb; x record; v_je uuid; v_cje uuid; v_z uuid; v_diff numeric; v_pay jsonb;
begin
  select * into s from public.pos_sessions where id = p_session for update;
  if s.id is null then raise exception 'Session not found' using errcode = 'P0002'; end if;
  perform app.require_permission(s.company_id, 'pos.write');
  if s.status <> 'open' then raise exception 'Session % is already %', s.number, s.status using errcode = '55000'; end if;
  if p_counted_cash is null or p_counted_cash < 0 then raise exception 'Count the cash in the drawer' using errcode = '23514'; end if;
  select * into r from public.pos_registers where id = s.register_id;
  select * into a from app.pos_accounts(r.id);
  select timezone into v_tz from public.companies where id = s.company_id;
  v_date := (now() at time zone v_tz)::date;
  update public.pos_sessions set status = 'closing' where id = s.id;

  select count(*) filter (where not is_refund) as orders, count(*) filter (where is_refund) as refunds,
         coalesce(sum(total) filter (where not is_refund), 0) as gross, coalesce(-sum(total) filter (where is_refund), 0) as refunded,
         coalesce(sum(discount_total), 0) as disc, coalesce(sum(subtotal), 0) as net, coalesce(sum(tax_total), 0) as tax,
         coalesce(sum(change_given), 0) as change
    into agg from public.pos_orders where session_id = s.id and status = 'paid';
  select coalesce(jsonb_object_agg(method, amt), '{}'::jsonb) into v_pay
    from (select pp.method, sum(pp.amount) as amt from public.pos_payments pp join public.pos_orders o on o.id = pp.pos_order_id
           where o.session_id = s.id and o.status = 'paid' group by pp.method) m;
  v_cash_net := coalesce((v_pay->>'cash')::numeric, 0) - agg.change;
  select coalesce(sum(amount) filter (where movement_type = 'cash_in'), 0), coalesce(sum(amount) filter (where movement_type = 'cash_out'), 0)
    into v_in, v_out from public.pos_cash_movements where session_id = s.id;
  v_expected := s.opening_cash + v_cash_net + v_in - v_out;
  v_diff := round(p_counted_cash - v_expected, 2);

  -- sales entry
  if agg.orders + agg.refunds > 0 then
    for x in select app.item_acct(s.company_id, ol.variant_id, 'revenue') as acc, sum(ol.line_subtotal) as amt
               from public.pos_order_lines ol join public.pos_orders o on o.id = ol.pos_order_id
              where o.session_id = s.id and o.status = 'paid' group by 1 loop
      if x.amt <> 0 then v_lines := v_lines || jsonb_build_object('account_id', x.acc, 'amount', -x.amt, 'description', 'POS sales'); end if;
    end loop;
    for x in select coalesce(t.output_account_id, app.acct(s.company_id, 'vat_output')) as acc, ol.tax_code_id, sum(ol.tax_amount) as amt
               from public.pos_order_lines ol join public.pos_orders o on o.id = ol.pos_order_id
               left join public.tax_codes t on t.id = ol.tax_code_id
              where o.session_id = s.id and o.status = 'paid' group by 1, 2 loop
      if x.amt <> 0 then v_lines := v_lines || jsonb_build_object('account_id', x.acc, 'amount', -x.amt, 'tax_code_id', x.tax_code_id, 'description', 'VAT'); end if;
    end loop;
    if v_cash_net <> 0 then v_lines := v_lines || jsonb_build_object('account_id', a.drawer, 'amount', v_cash_net, 'description', 'Cash sales'); end if;
    for x in select key as method, value::numeric as amt from jsonb_each_text(v_pay) where key <> 'cash' loop
      if x.amt <> 0 then
        v_lines := v_lines || jsonb_build_object('account_id', app.acct(s.company_id, case x.method when 'bank_transfer' then 'bank'
                                                                                               when 'voucher' then 'customer_advances' else 'card_clearing' end),
                                                 'amount', x.amt, 'description', initcap(replace(x.method, '_', ' ')) || ' payments');
      end if;
    end loop;
    if jsonb_array_length(v_lines) > 0 then
      v_je := app.gl_post(s.company_id, a.journal, v_date, 'pos_session', s.id, s.number, 'POS sales ' || r.name || ' · ' || s.number, v_lines, 'sales');
    end if;
  end if;

  -- cash entry: the drawer is emptied into the cash box; the difference is booked
  v_lines := '[]'::jsonb;
  if a.drawer <> a.cashbox then
    if p_counted_cash <> 0 then v_lines := v_lines || jsonb_build_object('account_id', a.cashbox, 'amount', p_counted_cash, 'description', 'Cash from the drawer'); end if;
    if v_expected <> 0 then v_lines := v_lines || jsonb_build_object('account_id', a.drawer, 'amount', -v_expected, 'description', 'Drawer emptied'); end if;
  elsif v_diff <> 0 then
    v_lines := v_lines || jsonb_build_object('account_id', a.drawer, 'amount', v_diff, 'description', 'Cash count difference');
  end if;
  if v_diff <> 0 then
    v_lines := v_lines || jsonb_build_object('account_id', app.acct(s.company_id, 'cash_difference'), 'amount', -v_diff,
                                             'description', case when v_diff < 0 then 'Cash short' else 'Cash over' end);
  end if;
  if jsonb_array_length(v_lines) > 0 then
    v_cje := app.gl_post(s.company_id, a.journal, v_date, 'pos_session', s.id, s.number, 'Cash count ' || r.name || ' · ' || s.number, v_lines, 'cash');
  end if;

  insert into public.z_reports (company_id, session_id, register_id, report_date, order_count, refund_count, gross_sales, refunds_total,
                                discounts_total, net_sales, tax_total, payments_by_method, tax_breakdown, opening_cash, cash_in, cash_out,
                                expected_cash, counted_cash, cash_difference, items)
  values (s.company_id, s.id, r.id, v_date, agg.orders, agg.refunds, agg.gross, agg.refunded, agg.disc, agg.net, agg.tax,
          v_pay || jsonb_build_object('change_given', agg.change),
          coalesce((select jsonb_agg(jsonb_build_object('rate', rate, 'base', base, 'tax', tax, 'gross', base + tax) order by rate desc)
                      from (select ol.tax_rate as rate, sum(ol.line_subtotal) as base, sum(ol.tax_amount) as tax
                              from public.pos_order_lines ol join public.pos_orders o on o.id = ol.pos_order_id
                             where o.session_id = s.id and o.status = 'paid' group by ol.tax_rate) t), '[]'::jsonb),
          s.opening_cash, v_in, v_out, v_expected, p_counted_cash, v_diff,
          coalesce((select jsonb_agg(i) from (
             select jsonb_build_object('variant_id', ol.variant_id, 'name', min(ol.description), 'quantity', sum(ol.quantity), 'total', sum(ol.line_total)) as i
               from public.pos_order_lines ol join public.pos_orders o on o.id = ol.pos_order_id
              where o.session_id = s.id and o.status = 'paid' group by ol.variant_id having sum(ol.quantity) <> 0
              order by sum(ol.line_total) desc limit 10) top), '[]'::jsonb))
  returning id into v_z;

  update public.pos_sessions
     set status = 'closed', closed_at = now(), expected_cash = v_expected, closing_cash_counted = p_counted_cash,
         journal_entry_id = v_je, cash_journal_entry_id = v_cje, notes = coalesce(nullif(btrim(p_notes), ''), notes)
   where id = s.id;
  return v_z;
end $$;

-- Live figures for the open session (X-report)
create or replace function public.pos_session_summary(p_session uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with o as (select * from public.pos_orders where session_id = p_session and status = 'paid'),
       pay as (select pp.method, sum(pp.amount) as amt from public.pos_payments pp join o on o.id = pp.pos_order_id group by pp.method),
       cm as (select coalesce(sum(amount) filter (where movement_type = 'cash_in'), 0) as cin,
                     coalesce(sum(amount) filter (where movement_type = 'cash_out'), 0) as cout
                from public.pos_cash_movements where session_id = p_session)
  select jsonb_build_object(
    'orders', (select count(*) from o where not is_refund), 'refunds', (select count(*) from o where is_refund),
    'gross', (select coalesce(sum(total), 0) from o where not is_refund), 'refunded', (select coalesce(-sum(total), 0) from o where is_refund),
    'net', (select coalesce(sum(subtotal), 0) from o), 'tax', (select coalesce(sum(tax_total), 0) from o),
    'payments', coalesce((select jsonb_object_agg(method, amt) from pay), '{}'::jsonb),
    'change', (select coalesce(sum(change_given), 0) from o),
    'cash_in', (select cin from cm), 'cash_out', (select cout from cm),
    'expected_cash', (select s.opening_cash from public.pos_sessions s where s.id = p_session)
                     + coalesce((select amt from pay where method = 'cash'), 0) - (select coalesce(sum(change_given), 0) from o)
                     + (select cin - cout from cm))
$$;

-- -----------------------------------------------------------------------------
-- 8b. Store manager: runs a shop — tills, cashiers, larger discounts, store stock
-- -----------------------------------------------------------------------------
insert into public.roles (key, name, description, is_assignable, sort_order)
values ('store_manager', 'Store Manager', 'Runs a shop: tills, cashiers, discounts and store stock', true, 11)
on conflict (key) do nothing;
insert into public.role_permissions (role_id, permission)
select r.id, p from public.roles r
 cross join unnest(array['core.read','collab.*','pos.*','partners.read','partners.write','inventory.read','wms.read','wms.write',
                         'sales.read','reports.read']) p
 where r.key = 'store_manager'
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 9. Grants
-- -----------------------------------------------------------------------------
revoke execute on function public.ensure_lot, public.lot_trace, public.lots_expiring, public.suggest_putaway, public.create_putaway_task,
  public.confirm_task_line, public.cancel_task, public.create_pick_list, public.confirm_pick, public.complete_pick_list, public.confirm_shipment,
  public.move_stock, public.create_cycle_count, public.count_item, public.submit_cycle_count, public.post_cycle_count, public.wms_overview,
  public.pos_catalog, public.open_pos_session, public.pos_cash_move, public.pos_submit_order, public.close_pos_session, public.pos_session_summary
  from public, anon;
grant execute on function public.ensure_lot, public.lot_trace, public.lots_expiring, public.suggest_putaway, public.create_putaway_task,
  public.confirm_task_line, public.cancel_task, public.create_pick_list, public.confirm_pick, public.complete_pick_list, public.confirm_shipment,
  public.move_stock, public.create_cycle_count, public.count_item, public.submit_cycle_count, public.post_cycle_count, public.wms_overview,
  public.pos_catalog, public.open_pos_session, public.pos_cash_move, public.pos_submit_order, public.close_pos_session, public.pos_session_summary
  to authenticated;
revoke execute on function app.new_task, app.putaway_for_receipt, app.task_progress, app.pos_accounts from public, authenticated, anon;
