-- =============================================================================
-- NexusERP Pro · 1500 · Procurement engine (Phase 4)
--
--   Requisition ──submit──▶ (approval) ──▶ approved ──create_po_from_requisition──▶ PO(s), one per vendor
--   Replenishment rules ──generate_replenishment──▶ suggestions ──create_pos_from_suggestions──▶ PO(s)
--   PO ──submit_purchase_order──▶ (approval) ──▶ approved ──▶ sent
--      ──create_receipt_from_po──▶ goods receipt ──post_goods_receipt──▶ partially_received / received
--      ──create_bill_from_po──▶ vendor bill ──match_vendor_bill / post_vendor_bill──▶ posted (three-way match)
--
-- Also closes a gap for every posting document: statuses that only a posting
-- function may set (posted, done, approved, received…) are now refused when a
-- client writes them directly.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. System-only statuses
-- -----------------------------------------------------------------------------
create or replace function app.tg_system_statuses()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.is_client_context() and new.status = any (tg_argv)
     and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    raise exception 'The status "%" is set by its own action (post, approve, receive…), not by editing the document',
      replace(new.status, '_', ' ') using errcode = '42501';
  end if;
  return new;
end $$;

do $$
declare r record;
begin
  for r in select * from (values
    ('goods_receipts',        array['done']),
    ('stock_adjustments',     array['pending_approval','approved','posted']),
    ('stock_transfers',       array['in_transit','done']),
    ('landed_costs',          array['posted']),
    ('leads',                 array['converted']),
    ('sales_quotes',          array['converted']),
    ('sales_orders',          array['pending_approval','confirmed','partially_delivered','delivered']),
    ('deliveries',            array['done']),
    ('sales_invoices',        array['posted']),
    ('purchase_requisitions', array['submitted','approved','rejected','ordered']),
    ('purchase_orders',       array['pending_approval','approved','partially_received','received']),
    ('vendor_bills',          array['posted'])
  ) x(tbl, statuses) loop
    execute format('create trigger trg_02_system_status before insert or update of status on public.%I
                    for each row execute function app.tg_system_statuses(%s)',
                   r.tbl, (select string_agg(quote_literal(s), ', ') from unnest(r.statuses) s));
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 1. Columns, relationships, document children
-- -----------------------------------------------------------------------------
alter table public.purchase_requisitions
  add column decided_by       uuid references auth.users(id),
  add column decided_at       timestamptz,
  add column rejection_reason text;

alter table public.purchase_orders
  add column cancel_reason text,
  add column closed_at     timestamptz;

alter table public.vendor_bill_lines
  add column capitalized_variance numeric(18,2) not null default 0,   -- price difference added to stock value
  add column expensed_variance    numeric(18,2) not null default 0;   -- share already sold/consumed (to P&L in Phase 5)

alter table public.purchase_orders       add constraint purchase_orders_buyer_profile_fkey           foreign key (buyer_id)     references public.profiles(id);
alter table public.purchase_requisitions add constraint purchase_requisitions_requester_profile_fkey foreign key (requested_by) references public.profiles(id);
alter table public.purchase_requisitions add constraint purchase_requisitions_decider_profile_fkey   foreign key (decided_by)   references public.profiles(id);

insert into app.document_children values
  ('purchase_requisitions', 'purchase_requisition_lines', 'requisition_id'),
  ('vendor_bills',          'vendor_bill_lines',          'bill_id')
on conflict do nothing;

create index vendor_products_variant_idx on public.vendor_products (company_id, variant_id) where deleted_at is null;
create index vendor_bill_lines_po_line_idx on public.vendor_bill_lines (po_line_id);
create index purchase_order_lines_req_line_idx on public.purchase_order_lines (requisition_line_id);

-- -----------------------------------------------------------------------------
-- 2. Currency helper and purchase pricing
-- -----------------------------------------------------------------------------
create or replace function app.convert_amount(p_company uuid, p_amount numeric, p_from text, p_to text, p_date date default current_date)
returns numeric language sql stable security definer set search_path = '' as $$
  select case when p_amount is null then null
              when p_from = p_to then p_amount
              else p_amount * app.exchange_rate(p_company, p_from, p_date) / nullif(app.exchange_rate(p_company, p_to, p_date), 0) end
$$;

-- Price a purchase: vendor's price list → last price paid to this vendor → average cost.
create or replace function public.get_purchase_price(
  p_company uuid, p_vendor uuid, p_variant uuid, p_quantity numeric default 1,
  p_currency text default null, p_date date default current_date)
returns table (unit_price numeric, currency_code text, source text, vendor_sku text, min_order_qty numeric,
               lead_time_days int, tax_code_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_cur text; v_base text; vp public.vendor_products; v_last record; v_tax uuid; v_avg numeric; v_std numeric;
begin
  if not (app.has_permission(p_company, 'procurement.read') or app.has_permission(p_company, 'requisitions.read')
          or app.has_permission(p_company, 'invoicing.read')) and auth.uid() is not null then
    raise exception 'Permission denied: procurement.read required' using errcode = '42501';
  end if;
  select base_currency into v_base from public.companies where id = p_company;
  v_cur := coalesce(p_currency, (select bp.currency_code from public.business_partners bp where bp.id = p_vendor), v_base);

  select coalesce(pr.purchase_tax_code_id, s.default_purchase_tax_code_id), ic.avg_cost, v.standard_cost
    into v_tax, v_avg, v_std
    from public.product_variants v join public.products pr on pr.id = v.product_id
    left join public.company_settings s on s.company_id = v.company_id
    left join public.item_costs ic on ic.variant_id = v.id
   where v.id = p_variant and v.company_id = p_company;

  select * into vp from public.vendor_products x
   where x.company_id = p_company and x.vendor_id = p_vendor and x.variant_id = p_variant and x.deleted_at is null;
  if vp.id is not null and app.convert_amount(p_company, vp.price, vp.currency_code, v_cur, p_date) is not null then
    return query select round(app.convert_amount(p_company, vp.price, vp.currency_code, v_cur, p_date), 4), v_cur, 'vendor_price'::text,
                        vp.vendor_sku, vp.min_order_qty, vp.lead_time_days::int, v_tax;
    return;
  end if;

  select round(pl.unit_price * (1 - pl.discount_pct / 100), 4) as price, po.currency_code as cur, po.order_date
    into v_last
    from public.purchase_order_lines pl join public.purchase_orders po on po.id = pl.purchase_order_id
   where po.company_id = p_company and po.vendor_id = p_vendor and pl.variant_id = p_variant
     and po.status not in ('draft','cancelled','pending_approval') and po.deleted_at is null
   order by po.order_date desc, po.created_at desc limit 1;
  if v_last.price is not null and app.convert_amount(p_company, v_last.price, v_last.cur, v_cur, p_date) is not null then
    return query select round(app.convert_amount(p_company, v_last.price, v_last.cur, v_cur, p_date), 4), v_cur, 'last_purchase'::text,
                        vp.vendor_sku, coalesce(vp.min_order_qty, 1), coalesce(vp.lead_time_days, 0)::int, v_tax;
    return;
  end if;

  return query select round(coalesce(app.convert_amount(p_company, nullif(coalesce(nullif(v_avg, 0), v_std), 0), v_base, v_cur, p_date), 0), 4),
                      v_cur, case when coalesce(v_avg, 0) > 0 then 'average_cost' else 'standard_cost' end,
                      null::text, 1::numeric, 0, v_tax;
end $$;

-- Preferred vendor for an item: replenishment rule → preferred vendor price → cheapest vendor price
create or replace function app.preferred_vendor(p_company uuid, p_variant uuid, p_warehouse uuid default null)
returns uuid language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select r.preferred_vendor_id from public.replenishment_rules r
      where r.company_id = p_company and r.variant_id = p_variant and r.deleted_at is null and r.preferred_vendor_id is not null
      order by (r.warehouse_id = p_warehouse) desc nulls last limit 1),
    (select vp.vendor_id from public.vendor_products vp join public.business_partners bp on bp.id = vp.vendor_id
      where vp.company_id = p_company and vp.variant_id = p_variant and vp.deleted_at is null and bp.is_active and bp.deleted_at is null
      order by vp.is_preferred desc, vp.price, vp.created_at limit 1))
$$;

-- -----------------------------------------------------------------------------
-- 3. Purchase orders: defaults, status rules, creation helper
-- -----------------------------------------------------------------------------
create or replace function app.tg_po_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
declare bp public.business_partners; v_rate numeric;
begin
  select * into bp from public.business_partners where id = new.vendor_id;
  if tg_op = 'INSERT' then
    new.currency_code   := coalesce(new.currency_code, bp.currency_code, (select base_currency from public.companies where id = new.company_id));
    new.payment_term_id := coalesce(new.payment_term_id, bp.payment_term_id);
    new.buyer_id        := coalesce(new.buyer_id, auth.uid());
  end if;
  if (tg_op = 'INSERT' or new.currency_code is distinct from old.currency_code) and new.exchange_rate = 1 then
    v_rate := app.exchange_rate(new.company_id, new.currency_code, new.order_date);
    if v_rate is not null then new.exchange_rate := v_rate; end if;
  end if;
  return new;
end $$;
-- NOT NULL is checked after BEFORE triggers, so the currency can be filled in here
create trigger trg_03_defaults before insert or update of vendor_id, currency_code on public.purchase_orders
  for each row execute function app.tg_po_defaults();

create or replace function app.tg_po_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  case new.status
    when 'approved' then new.approved_at := now();
    when 'sent' then new.sent_at := coalesce(new.sent_at, now());
    when 'closed' then new.closed_at := now();
    when 'draft' then
      -- pulled back for changes: the pending approval no longer applies
      update public.approval_requests set status = 'cancelled' where document_id = new.id and status = 'pending';
    when 'cancelled' then
      if exists (select 1 from public.purchase_order_lines where purchase_order_id = new.id and (qty_received > 0 or qty_billed > 0)) then
        raise exception 'Goods were already received or billed on %; close the order instead of cancelling it', new.number
          using errcode = '55000';
      end if;
      if exists (select 1 from public.goods_receipts where purchase_order_id = new.id and status = 'draft' and deleted_at is null) then
        raise exception 'Delete or cancel the draft receipts on % first', new.number using errcode = '55000';
      end if;
    else null;
  end case;
  return new;
end $$;
create trigger trg_12_status before update of status on public.purchase_orders
  for each row execute function app.tg_po_status();

-- Cancelled / closed orders free their requisitions and replenishment suggestions for re-ordering
create or replace function app.tg_po_after_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    update public.replenishment_suggestions set status = 'dismissed' where purchase_order_id = new.id and status = 'converted';
  end if;
  return null;
end $$;
create trigger trg_91_after_status after update of status on public.purchase_orders
  for each row execute function app.tg_po_after_status();

-- Creates a draft PO with priced lines. p_lines: [{variant_id, quantity, description?, unit_price?, requisition_line_id?, expected_date?}]
create or replace function app.create_purchase_order(
  p_company uuid, p_vendor uuid, p_warehouse uuid, p_lines jsonb,
  p_requisition uuid default null, p_expected date default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_po uuid; po public.purchase_orders; l jsonb; v_n int := 0; v_variant uuid; v_qty numeric; v_lead int := 0;
  v_price numeric; v_source text; v_tax uuid; v_lt int;
begin
  if not exists (select 1 from public.business_partners where id = p_vendor and company_id = p_company and is_vendor and is_active and deleted_at is null) then
    raise exception 'The vendor is not an active vendor' using errcode = '23514';
  end if;
  insert into public.purchase_orders (company_id, vendor_id, warehouse_id, requisition_id, expected_date, notes)
  values (p_company, p_vendor, coalesce(p_warehouse, (select default_warehouse_id from public.company_settings where company_id = p_company)),
          p_requisition, p_expected, p_notes)
  returning * into po;
  v_po := po.id;

  for l in select * from jsonb_array_elements(p_lines) loop
    v_n := v_n + 1;
    v_variant := nullif(l ->> 'variant_id', '')::uuid;
    v_qty := (l ->> 'quantity')::numeric;
    v_price := null; v_source := null; v_tax := null; v_lt := 0;
    if v_variant is not null then
      select g.unit_price, g.source, g.tax_code_id, g.lead_time_days into v_price, v_source, v_tax, v_lt
        from public.get_purchase_price(p_company, p_vendor, v_variant, v_qty, po.currency_code, po.order_date) g;
      v_lead := greatest(v_lead, coalesce(v_lt, 0));
    end if;
    insert into public.purchase_order_lines (company_id, purchase_order_id, line_no, requisition_line_id, variant_id, description,
                                             quantity, uom_id, unit_price, tax_code_id, expected_date)
    select p_company, v_po, v_n, nullif(l ->> 'requisition_line_id', '')::uuid, v_variant,
           coalesce(nullif(l ->> 'description', ''), (select v.name from public.product_variants v where v.id = v_variant), 'Item'),
           v_qty, null::uuid,
           coalesce(case when v_source in ('vendor_price','last_purchase') then v_price end,
                    nullif((l ->> 'unit_price')::numeric, 0), v_price, 0),
           coalesce(v_tax, (select default_purchase_tax_code_id from public.company_settings where company_id = p_company)),
           nullif(l ->> 'expected_date', '')::date
      from (select 1) one
      left join public.product_variants v on v.id = v_variant;
  end loop;
  if v_n = 0 then raise exception 'A purchase order needs at least one line' using errcode = '23514'; end if;
  if p_expected is null and v_lead > 0 then
    update public.purchase_orders set expected_date = order_date + v_lead where id = v_po;
  end if;
  return v_po;
end $$;

-- Submit: validations, then the approval engine (approves directly when no workflow applies)
create or replace function public.submit_purchase_order(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare po public.purchase_orders; v_bad text;
begin
  select * into po from public.purchase_orders where id = p_id for update;
  if po.id is null then raise exception 'Purchase order not found' using errcode = 'P0002'; end if;
  perform app.require_permission(po.company_id, 'procurement.write');
  if po.status <> 'draft' then raise exception 'Only draft orders can be submitted (this one is %)', po.status using errcode = '55000'; end if;
  if not exists (select 1 from public.purchase_order_lines where purchase_order_id = po.id) then
    raise exception 'Add at least one line' using errcode = '23514';
  end if;
  if not exists (select 1 from public.business_partners where id = po.vendor_id and is_vendor and is_active and deleted_at is null) then
    raise exception 'The vendor is inactive or not marked as a vendor' using errcode = '23514';
  end if;
  if not exists (select 1 from public.warehouses where id = po.warehouse_id and is_active and deleted_at is null) then
    raise exception 'The receiving warehouse is inactive' using errcode = '23514';
  end if;
  select string_agg(v.sku, ', ') into v_bad
    from public.purchase_order_lines l join public.product_variants v on v.id = l.variant_id join public.products p on p.id = v.product_id
   where l.purchase_order_id = po.id and (not p.is_purchasable or not v.is_active or p.deleted_at is not null);
  if v_bad is not null then raise exception 'These items cannot be purchased: %', v_bad using errcode = '23514'; end if;
  if po.total <= 0 then raise exception 'The order total must be greater than zero' using errcode = '23514'; end if;

  perform public.submit_for_approval('purchase_order', po.id);
  return (select status from public.purchase_orders where id = po.id);
end $$;

-- Draft goods receipt for everything still to come on a PO
create or replace function public.create_receipt_from_po(p_po uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare po public.purchase_orders; v_gr uuid; v_loc uuid; v_n int;
begin
  select * into po from public.purchase_orders where id = p_po for update;
  if po.id is null then raise exception 'Purchase order not found' using errcode = 'P0002'; end if;
  if not (app.has_permission(po.company_id, 'wms.write') or app.has_permission(po.company_id, 'procurement.write')) then
    raise exception 'Permission denied: wms.write required' using errcode = '42501';
  end if;
  if po.status not in ('approved','sent','partially_received') then
    raise exception 'Order % is %; only approved orders can be received', po.number, replace(po.status, '_', ' ') using errcode = '55000';
  end if;
  select id into v_loc from public.warehouse_locations
   where warehouse_id = po.warehouse_id and is_active and deleted_at is null and location_type in ('receiving','internal')
   order by (location_type = 'receiving') desc, is_pickable desc, code limit 1;
  if v_loc is null then raise exception 'The warehouse has no location to receive into' using errcode = '23514'; end if;

  insert into public.goods_receipts (company_id, receipt_type, purchase_order_id, vendor_id, warehouse_id, receipt_date, currency_code)
  values (po.company_id, 'purchase', po.id, po.vendor_id, po.warehouse_id, current_date, po.currency_code)
  returning id into v_gr;

  insert into public.goods_receipt_lines (company_id, receipt_id, po_line_id, variant_id, location_id, quantity)
  select x.company_id, v_gr, x.id, x.variant_id, v_loc, x.to_receive
    from (select pl.*, pl.quantity - pl.qty_received
                 - coalesce((select sum(gl.quantity) from public.goods_receipt_lines gl join public.goods_receipts g on g.id = gl.receipt_id
                              where gl.po_line_id = pl.id and g.status = 'draft' and g.deleted_at is null and g.id <> v_gr), 0) as to_receive
            from public.purchase_order_lines pl
            join public.product_variants v on v.id = pl.variant_id join public.products p on p.id = v.product_id
           where pl.purchase_order_id = po.id and p.product_type <> 'service') x
   where x.to_receive > 0
   order by x.line_no;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Nothing left to receive on % (check for draft receipts already holding the quantities)', po.number using errcode = '23514';
  end if;
  return v_gr;
end $$;

-- -----------------------------------------------------------------------------
-- 4. Requisitions
-- -----------------------------------------------------------------------------
create or replace function app.tg_requisition_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and new.status in ('approved','rejected') then
    new.decided_at := coalesce(new.decided_at, now());
    if new.status = 'approved' then new.approved_at := now(); end if;
  end if;
  return new;
end $$;
create trigger trg_12_status before update of status on public.purchase_requisitions
  for each row execute function app.tg_requisition_status();

create or replace function public.submit_requisition(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare r public.purchase_requisitions; v_has_wf boolean;
begin
  select * into r from public.purchase_requisitions where id = p_id for update;
  if r.id is null then raise exception 'Requisition not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'requisitions.write');
  if r.status <> 'draft' then raise exception 'Only draft requisitions can be submitted (this one is %)', r.status using errcode = '55000'; end if;
  if not exists (select 1 from public.purchase_requisition_lines where requisition_id = r.id) then
    raise exception 'Add at least one item' using errcode = '23514';
  end if;
  select exists (select 1 from public.approval_workflows w
                  where w.company_id = r.company_id and w.doc_type = 'purchase_requisition' and w.is_active and w.deleted_at is null
                    and (w.min_amount is null or r.estimated_total >= w.min_amount)) into v_has_wf;
  if v_has_wf then
    perform public.submit_for_approval('purchase_requisition', r.id);
  else
    -- no workflow: anyone with requisitions.approve decides it from the requisition itself
    update public.purchase_requisitions set status = 'submitted', rejection_reason = null, decided_by = null, decided_at = null where id = r.id;
    perform app.notify_role(r.company_id, ro.id, 'approval', 'Requisition ' || r.number || ' needs a decision',
                            format('%s ALL estimated', to_char(r.estimated_total, 'FM999G999G990D00')),
                            '/procurement/requisitions/' || r.id, 'purchase_requisitions', r.id)
       from public.roles ro where ro.key = 'procurement_manager';
  end if;
  return (select status from public.purchase_requisitions where id = r.id);
end $$;

create or replace function public.decide_requisition(p_id uuid, p_decision text, p_reason text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare r public.purchase_requisitions;
begin
  if p_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected'; end if;
  select * into r from public.purchase_requisitions where id = p_id for update;
  if r.id is null then raise exception 'Requisition not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'requisitions.approve');
  if r.status <> 'submitted' then raise exception 'Requisition is %, not waiting for a decision', r.status using errcode = '55000'; end if;
  if exists (select 1 from public.approval_requests where document_id = r.id and status = 'pending') then
    raise exception 'This requisition is in an approval workflow; decide it from Approvals' using errcode = '55000';
  end if;
  if r.requested_by = auth.uid() and not app.has_role(r.company_id, 'company_admin') then
    raise exception 'You cannot approve your own requisition (segregation of duties)' using errcode = '42501';
  end if;
  if p_decision = 'rejected' and nullif(btrim(p_reason), '') is null then
    raise exception 'Give a reason for the rejection' using errcode = '23514';
  end if;
  update public.purchase_requisitions
     set status = p_decision, decided_by = auth.uid(), decided_at = now(), rejection_reason = nullif(btrim(p_reason), '')
   where id = r.id;
  perform app.notify(r.company_id, r.requested_by, 'approval',
                     'Requisition ' || r.number || ' ' || p_decision, nullif(btrim(p_reason), ''),
                     '/procurement/requisitions/' || r.id, 'purchase_requisitions', r.id);
  return p_decision;
end $$;

-- Approved requisition → one draft PO per vendor
create or replace function public.create_po_from_requisition(p_id uuid, p_vendor uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.purchase_requisitions; v_missing text; g record; v_orders jsonb := '[]'::jsonb; v_po uuid;
begin
  select * into r from public.purchase_requisitions where id = p_id for update;
  if r.id is null then raise exception 'Requisition not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'procurement.write');
  if r.status <> 'approved' then raise exception 'Only approved requisitions can be ordered (this one is %)', r.status using errcode = '55000'; end if;

  create temp table if not exists _req_lines (id uuid, vendor_id uuid, variant_id uuid, description text, quantity numeric,
                                              cost numeric, required date, seq bigint) on commit drop;
  delete from _req_lines;
  insert into _req_lines
  select l.id, coalesce(l.suggested_vendor_id, p_vendor, app.preferred_vendor(r.company_id, l.variant_id, r.warehouse_id)),
         l.variant_id, l.description, l.quantity, l.estimated_unit_cost, coalesce(l.required_date, r.required_date),
         row_number() over (order by l.created_at, l.id)
    from public.purchase_requisition_lines l
   where l.requisition_id = r.id
     and not exists (select 1 from public.purchase_order_lines pl join public.purchase_orders po on po.id = pl.purchase_order_id
                      where pl.requisition_line_id = l.id and po.status <> 'cancelled' and po.deleted_at is null);

  select string_agg(description, ', ') into v_missing from _req_lines where vendor_id is null;
  if v_missing is not null then
    raise exception 'Choose a vendor for: %', v_missing using errcode = '23514';
  end if;
  if not exists (select 1 from _req_lines) then raise exception 'Every line is already on a purchase order' using errcode = '23514'; end if;

  for g in select vendor_id, min(required) as required,
                  jsonb_agg(jsonb_build_object('variant_id', variant_id, 'quantity', quantity, 'description', description,
                                               'unit_price', cost, 'requisition_line_id', id, 'expected_date', required) order by seq) as lines
             from _req_lines group by vendor_id order by vendor_id loop
    v_po := app.create_purchase_order(r.company_id, g.vendor_id, r.warehouse_id, g.lines, r.id, g.required,
                                      'From requisition ' || r.number || coalesce(': ' || r.justification, ''));
    v_orders := v_orders || to_jsonb(v_po);
  end loop;
  update public.purchase_requisitions set status = 'ordered' where id = r.id;
  return jsonb_build_object('orders', v_orders);
end $$;

-- -----------------------------------------------------------------------------
-- 5. Replenishment
-- -----------------------------------------------------------------------------
create or replace function public.generate_replenishment(p_company uuid, p_warehouse uuid default null)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; v_need numeric; v_vendor uuid; v_moq numeric; v_n int := 0;
begin
  if not (app.has_permission(p_company, 'oms.write') or app.has_permission(p_company, 'procurement.write')) then
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
                        and po.status in ('draft','pending_approval','approved','sent','partially_received')), 0) as incoming
      from public.replenishment_rules ru
      join public.product_variants v on v.id = ru.variant_id join public.products p on p.id = v.product_id
     where ru.company_id = p_company and ru.is_active and ru.deleted_at is null and v.is_active and p.is_purchasable
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

create or replace function public.create_pos_from_suggestions(p_ids uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_missing text; g record; v_po uuid; v_orders jsonb := '[]'::jsonb;
begin
  select company_id into v_company from public.replenishment_suggestions where id = any (p_ids) limit 1;
  if v_company is null then raise exception 'Select at least one suggestion' using errcode = '23514'; end if;
  perform app.require_permission(v_company, 'procurement.write');
  if exists (select 1 from public.replenishment_suggestions where id = any (p_ids) and (company_id <> v_company or status <> 'open')) then
    raise exception 'Some suggestions were already ordered or dismissed; refresh the list' using errcode = '55000';
  end if;
  if exists (select 1 from public.replenishment_suggestions where id = any (p_ids) and replenish_method <> 'buy') then
    raise exception 'Only "buy" suggestions become purchase orders' using errcode = '23514';
  end if;
  select string_agg(v.sku, ', ') into v_missing from public.replenishment_suggestions s join public.product_variants v on v.id = s.variant_id
   where s.id = any (p_ids) and s.vendor_id is null;
  if v_missing is not null then raise exception 'Choose a vendor for: %', v_missing using errcode = '23514'; end if;

  for g in select s.vendor_id, s.warehouse_id, array_agg(s.id) as ids,
                  jsonb_agg(jsonb_build_object('variant_id', s.variant_id, 'quantity', s.suggested_qty) order by v.sku) as lines
             from public.replenishment_suggestions s join public.product_variants v on v.id = s.variant_id
            where s.id = any (p_ids) group by s.vendor_id, s.warehouse_id loop
    v_po := app.create_purchase_order(v_company, g.vendor_id, g.warehouse_id, g.lines, null, null, 'Replenishment');
    update public.replenishment_suggestions set status = 'converted', purchase_order_id = v_po where id = any (g.ids);
    v_orders := v_orders || to_jsonb(v_po);
  end loop;
  return jsonb_build_object('orders', v_orders);
end $$;

-- -----------------------------------------------------------------------------
-- 6. Vendor bills
-- -----------------------------------------------------------------------------
create or replace function app.tg_bill_defaults()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_dup text; v_rate numeric;
begin
  if tg_op = 'INSERT' then
    new.currency_code   := coalesce(new.currency_code, (select currency_code from public.business_partners where id = new.vendor_id),
                                    (select base_currency from public.companies where id = new.company_id));
    new.payment_term_id := coalesce(new.payment_term_id, (select payment_term_id from public.business_partners where id = new.vendor_id));
  end if;
  if (tg_op = 'INSERT' or new.currency_code is distinct from old.currency_code or new.bill_date is distinct from old.bill_date)
     and new.status = 'draft' then
    v_rate := app.exchange_rate(new.company_id, new.currency_code, new.bill_date);
    if v_rate is not null and (tg_op = 'INSERT' and new.exchange_rate = 1 or tg_op = 'UPDATE' and new.exchange_rate = old.exchange_rate) then
      new.exchange_rate := v_rate;
    end if;
  end if;
  if new.payment_term_id is not null and (tg_op = 'INSERT' and new.due_date <= new.bill_date
       or tg_op = 'UPDATE' and (new.payment_term_id is distinct from old.payment_term_id or new.bill_date is distinct from old.bill_date)) then
    new.due_date := new.bill_date + coalesce((select due_days from public.payment_terms where id = new.payment_term_id), 0);
  end if;
  if new.due_date < new.bill_date then new.due_date := new.bill_date; end if;
  new.vendor_invoice_number := btrim(new.vendor_invoice_number);
  if new.vendor_invoice_number = '' then
    raise exception 'Enter the vendor''s invoice number' using errcode = '23514';
  end if;
  if new.status <> 'cancelled' then
    select number into v_dup from public.vendor_bills b
     where b.company_id = new.company_id and b.vendor_id = new.vendor_id and b.document_type = new.document_type
       and lower(b.vendor_invoice_number) = lower(new.vendor_invoice_number) and b.id <> new.id
       and b.deleted_at is null and b.status <> 'cancelled' limit 1;
    if v_dup is not null then
      raise exception 'Vendor invoice % is already entered as %', new.vendor_invoice_number, v_dup using errcode = '23505';
    end if;
  end if;
  return new;
end $$;
create trigger trg_03_defaults before insert or update of vendor_id, currency_code, bill_date, payment_term_id, vendor_invoice_number, status
  on public.vendor_bills for each row execute function app.tg_bill_defaults();

create or replace function public.create_bill_from_po(p_po uuid, p_vendor_invoice_number text, p_bill_date date default current_date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare po public.purchase_orders; v_bill uuid; v_n int;
begin
  select * into po from public.purchase_orders where id = p_po for update;
  if po.id is null then raise exception 'Purchase order not found' using errcode = 'P0002'; end if;
  perform app.require_permission(po.company_id, 'invoicing.write');
  if po.status not in ('approved','sent','partially_received','received','closed') then
    raise exception 'Order % is %; only approved orders can be billed', po.number, replace(po.status, '_', ' ') using errcode = '55000';
  end if;
  insert into public.vendor_bills (company_id, vendor_id, purchase_order_id, vendor_invoice_number, bill_date, due_date, currency_code,
                                   payment_term_id, notes)
  values (po.company_id, po.vendor_id, po.id, p_vendor_invoice_number, coalesce(p_bill_date, current_date), coalesce(p_bill_date, current_date),
          po.currency_code, po.payment_term_id, 'Bill for ' || po.number)
  returning id into v_bill;

  -- goods: bill what was received; services and free-text lines: what was ordered. Minus earlier and draft bills.
  insert into public.vendor_bill_lines (company_id, bill_id, line_no, po_line_id, receipt_line_id, variant_id, description, quantity,
                                        uom_id, unit_price, discount_pct, tax_code_id)
  select x.company_id, v_bill, x.line_no, x.id,
         (select gl.id from public.goods_receipt_lines gl join public.goods_receipts g on g.id = gl.receipt_id
           where gl.po_line_id = x.id and g.status = 'done' order by g.done_at desc limit 1),
         x.variant_id, x.description, x.to_bill, x.uom_id, x.unit_price, x.discount_pct, x.tax_code_id
    from (select pl.*,
                 (case when coalesce(p.product_type, 'service') = 'service' then pl.quantity else pl.qty_received end) - pl.qty_billed
                 - coalesce((select sum(bl.quantity) from public.vendor_bill_lines bl join public.vendor_bills b on b.id = bl.bill_id
                              where bl.po_line_id = pl.id and b.status = 'draft' and b.document_type = 'vendor_bill'
                                and b.deleted_at is null and b.id <> v_bill), 0) as to_bill
            from public.purchase_order_lines pl
            left join public.product_variants v on v.id = pl.variant_id left join public.products p on p.id = v.product_id
           where pl.purchase_order_id = po.id) x
   where x.to_bill > 0
   order by x.line_no;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'Nothing to bill on % yet: receive the goods first', po.number using errcode = '23514';
  end if;
  return v_bill;
end $$;

-- Three-way match: bill line ↔ PO line (price) ↔ received quantity. Stores the result on the lines and header.
create or replace function app.compute_bill_match(p_bill uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.vendor_bills; s public.company_settings; l record; v_status text; v_expected numeric; v_qvar numeric; v_pvar numeric;
  v_po_net numeric; v_bill_net numeric; v_any_po boolean := false; v_exception boolean := false; v_out jsonb := '[]'::jsonb;
begin
  select * into b from public.vendor_bills where id = p_bill;
  select * into s from public.company_settings where company_id = b.company_id;

  for l in
    select bl.*, pl.quantity as po_qty, pl.qty_received, pl.qty_billed, pl.unit_price as po_price, pl.discount_pct as po_disc,
           po.currency_code as po_cur, coalesce(p.product_type, 'service') as product_type
      from public.vendor_bill_lines bl
      left join public.purchase_order_lines pl on pl.id = bl.po_line_id
      left join public.purchase_orders po on po.id = pl.purchase_order_id
      left join public.product_variants v on v.id = coalesce(bl.variant_id, pl.variant_id)
      left join public.products p on p.id = v.product_id
     where bl.bill_id = b.id order by bl.line_no
  loop
    v_qvar := null; v_pvar := null;
    if l.po_line_id is null or b.document_type = 'vendor_credit' then
      v_status := 'not_applicable';
    else
      v_any_po := true;
      v_expected := (case when l.product_type = 'service' then l.po_qty else l.qty_received end) - l.qty_billed;
      v_qvar := l.quantity - v_expected;
      v_po_net := app.convert_amount(b.company_id, l.po_price * (1 - l.po_disc / 100), l.po_cur, b.currency_code, b.bill_date);
      v_bill_net := l.unit_price * (1 - l.discount_pct / 100);
      v_pvar := round(v_bill_net - coalesce(v_po_net, v_bill_net), 4);
      v_status := case
        when l.product_type <> 'service' and v_expected <= 0 then 'no_receipt'
        when v_qvar > greatest(v_expected, 0) * s.match_qty_tolerance_pct / 100 + 0.00005 then 'qty_variance'
        when coalesce(v_po_net, 0) > 0 and v_pvar / v_po_net * 100 > s.match_price_tolerance_pct + 0.00005 then 'price_variance'
        else 'matched' end;
      v_exception := v_exception or v_status <> 'matched';
    end if;
    update public.vendor_bill_lines set match_status = v_status, qty_variance = v_qvar, price_variance = v_pvar where id = l.id;
    v_out := v_out || jsonb_build_object('line_no', l.line_no, 'status', v_status, 'qty_variance', v_qvar, 'price_variance', v_pvar,
                                         'expected_qty', case when l.po_line_id is not null then v_expected end,
                                         'po_net_price', case when l.po_line_id is not null then round(v_po_net, 4) end);
  end loop;

  v_status := case when not v_any_po then 'not_applicable' when v_exception then 'exception' else 'matched' end;
  update public.vendor_bills set match_status = v_status, match_override_by = null, match_override_reason = null where id = b.id;
  return jsonb_build_object('status', v_status, 'qty_tolerance_pct', s.match_qty_tolerance_pct,
                            'price_tolerance_pct', s.match_price_tolerance_pct, 'lines', v_out);
end $$;

create or replace function public.match_vendor_bill(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.vendor_bills;
begin
  select * into b from public.vendor_bills where id = p_id for update;
  if b.id is null then raise exception 'Bill not found' using errcode = 'P0002'; end if;
  perform app.require_permission(b.company_id, 'invoicing.read');
  if b.status <> 'draft' then
    return jsonb_build_object('status', b.match_status, 'lines',
      (select coalesce(jsonb_agg(jsonb_build_object('line_no', line_no, 'status', match_status, 'qty_variance', qty_variance,
                                                     'price_variance', price_variance) order by line_no), '[]'::jsonb)
         from public.vendor_bill_lines where bill_id = b.id));
  end if;
  return app.compute_bill_match(b.id);
end $$;

create or replace function public.create_vendor_credit(p_bill uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare b public.vendor_bills; v_cn uuid; v_n int;
begin
  select * into b from public.vendor_bills where id = p_bill;
  if b.id is null then raise exception 'Bill not found' using errcode = 'P0002'; end if;
  perform app.require_permission(b.company_id, 'invoicing.write');
  if b.status <> 'posted' or b.document_type <> 'vendor_bill' then
    raise exception 'Credit notes can only be recorded against posted bills' using errcode = '55000';
  end if;
  select count(*) into v_n from public.vendor_bills where original_bill_id = b.id and status <> 'cancelled' and deleted_at is null;
  insert into public.vendor_bills (company_id, document_type, vendor_id, purchase_order_id, original_bill_id, vendor_invoice_number,
                                   bill_date, due_date, currency_code, exchange_rate, payment_term_id, notes)
  values (b.company_id, 'vendor_credit', b.vendor_id, b.purchase_order_id, b.id,
          'CR-' || b.vendor_invoice_number || case when v_n > 0 then '-' || (v_n + 1) else '' end,
          current_date, current_date, b.currency_code, b.exchange_rate, b.payment_term_id, 'Credit note against ' || b.number)
  returning id into v_cn;
  insert into public.vendor_bill_lines (company_id, bill_id, line_no, po_line_id, receipt_line_id, variant_id, description, account_id,
                                        cost_center_id, quantity, uom_id, unit_price, discount_pct, tax_code_id)
  select company_id, v_cn, line_no, po_line_id, receipt_line_id, variant_id, description, account_id, cost_center_id, quantity, uom_id,
         unit_price, discount_pct, tax_code_id
    from public.vendor_bill_lines where bill_id = b.id order by line_no;
  return v_cn;
end $$;

-- Value-only stock adjustment for a billed price difference (shown as a revaluation in the stock ledger)
create or replace function app.post_price_variance(
  p_company uuid, p_variant uuid, p_location uuid, p_amount numeric, p_bill uuid, p_line uuid, p_reference text, p_date timestamptz)
returns uuid language plpgsql set search_path = '' as $$
declare ic public.item_costs; v_mv uuid; v_avg numeric;
begin
  if p_amount = 0 then return null; end if;
  select * into ic from public.item_costs where company_id = p_company and variant_id = p_variant for update;
  if ic.id is null or ic.qty_on_hand <= 0 then return null; end if;
  insert into public.stock_movements (company_id, movement_date, movement_type, variant_id, from_location_id, to_location_id,
                                      to_warehouse_id, quantity, unit_cost, total_cost, source_doc_type, source_doc_id,
                                      source_line_id, reference)
  values (p_company, p_date, 'revaluation', p_variant, app.virtual_location(p_company, 'supplier'), p_location,
          (select warehouse_id from public.warehouse_locations where id = p_location), 0, 0, p_amount, 'vendor_bill', p_bill, p_line, p_reference)
  returning id into v_mv;
  v_avg := greatest(round((ic.total_value + p_amount) / ic.qty_on_hand, 6), 0);
  update public.item_costs set total_value = greatest(total_value + p_amount, 0), avg_cost = v_avg where id = ic.id;
  insert into public.item_cost_history (company_id, variant_id, movement_id, qty_before, avg_cost_before, qty_in, unit_cost_in, avg_cost_after, reason)
  values (p_company, p_variant, v_mv, ic.qty_on_hand, ic.avg_cost, 0, p_amount, v_avg, 'price_variance');
  return v_mv;
end $$;

create or replace function public.post_vendor_bill(p_id uuid, p_override_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.vendor_bills; v_period text; v_match jsonb; v_sign int; l record; v_po uuid; v_credited numeric;
  v_recv_cost numeric; v_bill_cost numeric; v_diff numeric; v_onhand numeric; v_cap_qty numeric; v_cap numeric; v_total_value numeric;
  v_cap_total numeric := 0; v_exp_total numeric := 0; v_summary text;
begin
  select * into b from public.vendor_bills where id = p_id for update;
  if b.id is null then raise exception 'Bill not found' using errcode = 'P0002'; end if;
  perform app.require_permission(b.company_id, 'invoicing.write');
  if b.status <> 'draft' then raise exception 'Bill is already %', b.status using errcode = '55000'; end if;
  if not exists (select 1 from public.vendor_bill_lines where bill_id = b.id) then
    raise exception 'Add at least one line' using errcode = '23514';
  end if;
  if b.total <= 0 then raise exception 'The total must be greater than zero' using errcode = '23514'; end if;

  select status into v_period from public.fiscal_periods where company_id = b.company_id and b.bill_date between start_date and end_date;
  if v_period is null then raise exception 'No fiscal period covers %', b.bill_date using errcode = '23514'; end if;
  if v_period <> 'open' then raise exception 'The fiscal period for % is %', b.bill_date, v_period using errcode = '23514'; end if;

  v_sign := case when b.document_type = 'vendor_credit' then -1 else 1 end;
  if b.document_type = 'vendor_credit' and b.original_bill_id is not null then
    select coalesce(sum(total), 0) into v_credited from public.vendor_bills
     where original_bill_id = b.original_bill_id and document_type = 'vendor_credit' and status = 'posted';
    if v_credited + b.total > (select total from public.vendor_bills where id = b.original_bill_id) then
      raise exception 'Credit notes would exceed the original bill total' using errcode = '23514';
    end if;
  end if;

  -- three-way match (bills only)
  v_match := app.compute_bill_match(b.id);
  if v_match ->> 'status' = 'exception' then
    if nullif(btrim(p_override_reason), '') is null then
      select string_agg(format('line %s: %s', line_no, replace(match_status, '_', ' ')), '; ' order by line_no) into v_summary
        from public.vendor_bill_lines where bill_id = b.id and match_status not in ('matched','not_applicable');
      raise exception 'The bill does not match the purchase order (%). Correct it, or post it with an override reason', v_summary
        using errcode = '23514';
    end if;
    if not (app.has_permission(b.company_id, 'procurement.approve') or app.has_permission(b.company_id, 'invoicing.approve')) then
      raise exception 'Only a procurement or finance manager can post a bill that does not match' using errcode = '42501';
    end if;
    update public.vendor_bills set match_status = 'overridden', match_override_by = auth.uid(),
                                   match_override_reason = btrim(p_override_reason) where id = b.id;
  end if;

  for l in
    select bl.*, pl.purchase_order_id, pl.quantity as po_qty, pl.qty_billed, coalesce(p.product_type, 'service') as product_type,
           coalesce(bl.variant_id, pl.variant_id) as item_id
      from public.vendor_bill_lines bl
      left join public.purchase_order_lines pl on pl.id = bl.po_line_id
      left join public.product_variants v on v.id = coalesce(bl.variant_id, pl.variant_id)
      left join public.products p on p.id = v.product_id
     where bl.bill_id = b.id order by bl.line_no
  loop
    if l.po_line_id is null then continue; end if;
    v_po := l.purchase_order_id;
    update public.purchase_order_lines set qty_billed = greatest(qty_billed + v_sign * l.quantity, 0) where id = l.po_line_id;

    -- price difference vs. the receipt cost: capitalise the share still in stock, the rest is recorded as expensed
    if v_sign = 1 and l.product_type = 'stockable' then
      select sum(gl.quantity * gl.unit_cost) / nullif(sum(gl.quantity), 0) into v_recv_cost
        from public.goods_receipt_lines gl join public.goods_receipts g on g.id = gl.receipt_id
       where gl.po_line_id = l.po_line_id and g.status = 'done' and gl.qc_status <> 'rejected';
      v_bill_cost := l.unit_price * (1 - l.discount_pct / 100) * b.exchange_rate;
      if v_recv_cost is not null then
        v_diff := round((v_bill_cost - v_recv_cost) * l.quantity, 2);
        if abs(v_diff) >= 0.01 then
          select greatest(qty_on_hand, 0), total_value into v_onhand, v_total_value from public.item_costs where variant_id = l.item_id;
          v_cap_qty := least(l.quantity, coalesce(v_onhand, 0));
          v_cap := round(v_diff * v_cap_qty / l.quantity, 2);
          v_cap := greatest(v_cap, -coalesce(v_total_value, 0));     -- never below zero stock value
          if v_cap <> 0 then
            perform app.post_price_variance(b.company_id, l.item_id,
                      (select gl.location_id from public.goods_receipt_lines gl join public.goods_receipts g on g.id = gl.receipt_id
                        where gl.po_line_id = l.po_line_id and g.status = 'done' order by g.done_at desc limit 1),
                      v_cap, b.id, l.id, b.number, (b.bill_date + localtime)::timestamptz);
          end if;
          update public.vendor_bill_lines set capitalized_variance = v_cap, expensed_variance = v_diff - v_cap where id = l.id;
          v_cap_total := v_cap_total + v_cap;
          v_exp_total := v_exp_total + (v_diff - v_cap);
        end if;
      end if;
    end if;
  end loop;

  update public.vendor_bills set status = 'posted', posted_at = now() where id = b.id;

  v_po := coalesce(v_po, b.purchase_order_id);
  if v_po is not null then
    update public.purchase_orders o
       set billing_status = case
             when not exists (select 1 from public.purchase_order_lines where purchase_order_id = o.id and qty_billed > 0) then 'not_billed'
             when exists (select 1 from public.purchase_order_lines where purchase_order_id = o.id and qty_billed < quantity) then 'partially_billed'
             else 'billed' end
     where o.id = v_po;
    update public.purchase_orders set status = 'closed' where id = v_po and status = 'received' and billing_status = 'billed';
  end if;

  return jsonb_build_object('status', 'posted', 'total', b.total,
                            'match_status', (select match_status from public.vendor_bills where id = b.id),
                            'capitalized_variance', v_cap_total, 'expensed_variance', v_exp_total);
end $$;

-- -----------------------------------------------------------------------------
-- 7. Purchasing performance
-- -----------------------------------------------------------------------------
create or replace function public.procurement_overview(p_company uuid, p_from date default date_trunc('month', current_date)::date,
                                                       p_to date default current_date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with bills as (
    select b.*, case when b.document_type = 'vendor_credit' then -1 else 1 end as sgn
      from public.vendor_bills b where b.company_id = p_company and b.status = 'posted' and b.deleted_at is null
  ),
  bills_range as (select * from bills where bill_date between p_from and p_to),
  bill_lines as (
    select bl.*, br.sgn, br.exchange_rate, br.vendor_id from public.vendor_bill_lines bl join bills_range br on br.id = bl.bill_id
  ),
  open_lines as (
    select pl.*, po.exchange_rate, po.expected_date as po_expected, po.vendor_id from public.purchase_order_lines pl
      join public.purchase_orders po on po.id = pl.purchase_order_id
     where po.company_id = p_company and po.deleted_at is null and po.status in ('approved','sent','partially_received')
  ),
  receipts as (
    select g.*, po.expected_date, po.order_date, po.vendor_id as po_vendor from public.goods_receipts g
      join public.purchase_orders po on po.id = g.purchase_order_id
     where g.company_id = p_company and g.status = 'done' and g.deleted_at is null and g.receipt_date between p_from and p_to
  )
  select jsonb_build_object(
    'spend', coalesce((select sum(sgn * round(subtotal * exchange_rate, 2)) from bills_range), 0),
    'bill_count', (select count(*) from bills_range where sgn = 1),
    'received_value', coalesce((select sum(total_value) from public.goods_receipts g where g.company_id = p_company and g.status = 'done'
                                  and g.receipt_type = 'purchase' and g.deleted_at is null and g.receipt_date between p_from and p_to), 0),
    'orders_count', (select count(*) from public.purchase_orders o where o.company_id = p_company and o.deleted_at is null
                       and o.order_date between p_from and p_to and o.status not in ('draft','pending_approval','cancelled')),
    'orders_value', coalesce((select sum(round(o.subtotal * o.exchange_rate, 2)) from public.purchase_orders o where o.company_id = p_company
                                and o.deleted_at is null and o.order_date between p_from and p_to
                                and o.status not in ('draft','pending_approval','cancelled')), 0),
    'open_po_value', coalesce((select sum(round(line_subtotal * (quantity - qty_received) / quantity * exchange_rate, 2))
                                 from open_lines where qty_received < quantity), 0),
    'late_count', (select count(distinct purchase_order_id) from open_lines where qty_received < quantity and po_expected < current_date),
    'to_bill_value', coalesce((select sum(round(line_subtotal * (qty_received - qty_billed) / quantity * exchange_rate, 2))
                                 from public.purchase_order_lines pl join public.purchase_orders po on po.id = pl.purchase_order_id
                                where po.company_id = p_company and po.deleted_at is null and po.status <> 'cancelled'
                                  and pl.qty_received > pl.qty_billed), 0),
    'pending_po_approvals', (select count(*) from public.purchase_orders where company_id = p_company and status = 'pending_approval' and deleted_at is null),
    'pending_requisitions', (select count(*) from public.purchase_requisitions where company_id = p_company and status = 'submitted' and deleted_at is null),
    'approved_requisitions', (select count(*) from public.purchase_requisitions where company_id = p_company and status = 'approved' and deleted_at is null),
    'match_exceptions', (select count(*) from public.vendor_bills where company_id = p_company and status = 'draft'
                           and match_status = 'exception' and deleted_at is null),
    'ap_open', coalesce((select sum(sgn * round(amount_due * exchange_rate, 2)) from bills where payment_status <> 'paid'), 0),
    'ap_due_7', coalesce((select sum(round(amount_due * exchange_rate, 2)) from bills where sgn = 1 and payment_status <> 'paid'
                            and due_date between current_date and current_date + 7), 0),
    'ap_overdue', coalesce((select sum(round(amount_due * exchange_rate, 2)) from bills where sgn = 1 and payment_status <> 'paid'
                              and due_date < current_date), 0),
    'ap_overdue_count', (select count(*) from bills where sgn = 1 and payment_status <> 'paid' and due_date < current_date),
    'on_time_pct', (select round(100.0 * count(*) filter (where receipt_date <= expected_date) / nullif(count(*) filter (where expected_date is not null), 0), 1)
                      from receipts),
    'avg_lead_days', (select round(avg(receipt_date - order_date), 1) from receipts),
    'spend_by_month', coalesce((select jsonb_agg(x order by x.month) from (
        select to_char(m, 'YYYY-MM') as month,
               coalesce((select sum(sgn * round(subtotal * exchange_rate, 2)) from bills where date_trunc('month', bill_date) = m), 0) as spend
          from generate_series(date_trunc('month', p_to) - interval '11 months', date_trunc('month', p_to), interval '1 month') m) x), '[]'::jsonb),
    'top_vendors', coalesce((select jsonb_agg(x order by x.spend desc) from (
        select bp.id, bp.name, sum(bl.sgn * round(bl.line_subtotal * bl.exchange_rate, 2)) as spend,
               (select round(100.0 * count(*) filter (where r.receipt_date <= r.expected_date) / nullif(count(*) filter (where r.expected_date is not null), 0), 0)
                  from receipts r where r.po_vendor = bp.id) as on_time_pct,
               (select round(avg(r.receipt_date - r.order_date), 1) from receipts r where r.po_vendor = bp.id) as lead_days
          from bill_lines bl join public.business_partners bp on bp.id = bl.vendor_id
         group by bp.id order by 3 desc limit 6) x), '[]'::jsonb),
    'top_products', coalesce((select jsonb_agg(x order by x.spend desc) from (
        select v.sku, v.name, sum(bl.sgn * bl.quantity) as quantity, sum(bl.sgn * round(bl.line_subtotal * bl.exchange_rate, 2)) as spend
          from bill_lines bl join public.product_variants v on v.id = bl.variant_id
         group by v.id order by 4 desc limit 6) x), '[]'::jsonb)
  )
$$;

-- -----------------------------------------------------------------------------
-- 8. ⌘K search: requisitions and vendor bills
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
    ) d, q
    where d.company_id = p_company and d.deleted_at is null and d.number ilike q.pat
    order by d.number desc limit p_limit)
$$;

-- -----------------------------------------------------------------------------
-- 9. Privileges & realtime
-- -----------------------------------------------------------------------------
revoke execute on function public.get_purchase_price, public.submit_purchase_order, public.create_receipt_from_po,
                           public.submit_requisition, public.decide_requisition, public.create_po_from_requisition,
                           public.generate_replenishment, public.create_pos_from_suggestions, public.create_bill_from_po,
                           public.match_vendor_bill, public.create_vendor_credit, public.post_vendor_bill,
                           public.procurement_overview from public, anon;
grant execute on function public.get_purchase_price, public.submit_purchase_order, public.create_receipt_from_po,
                          public.submit_requisition, public.decide_requisition, public.create_po_from_requisition,
                          public.generate_replenishment, public.create_pos_from_suggestions, public.create_bill_from_po,
                          public.match_vendor_bill, public.create_vendor_credit, public.post_vendor_bill,
                          public.procurement_overview to authenticated;
revoke execute on function app.create_purchase_order, app.compute_bill_match, app.preferred_vendor, app.convert_amount, app.post_price_variance from public, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'vendor_bills') then
      alter publication supabase_realtime add table public.vendor_bills;
    end if;
  end if;
end $$;
