-- =============================================================================
-- DrisPRO · Buying controls (from the company's own buyer handbook)
--   1. Following an order: the vendor's confirmation with the date they promise; a task for the
--      buyer when an order is not confirmed or is late; what did not come is ordered again
--      (from the same vendor or another one) and the old order stops waiting for it
--   2. A price rise from a vendor: a bill line above the last price paid to that vendor (or their
--      price list) by more than the company's tolerance waits for a manager to accept it, with a
--      reason; the buyer can ask for it
--   3. The vendors' scorecard: on time, complete, goods refused at the door, price rises, answer
--      to orders; and the main (A) items that have only one vendor
--   4. Offers from several vendors: a request for offers, the offers side by side, the order
--      (or orders) from the chosen offer
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Following an order
-- -----------------------------------------------------------------------------
alter table public.purchase_orders
  add column if not exists confirmed_at  timestamptz,
  add column if not exists confirmed_by  uuid references auth.users(id),
  add column if not exists promised_date date,
  add column if not exists follows_id    uuid;
alter table public.purchase_orders drop constraint if exists purchase_orders_follows_fk;
alter table public.purchase_orders add constraint purchase_orders_follows_fk foreign key (company_id, follows_id) references public.purchase_orders(company_id, id);

-- when the goods are due: the date the vendor promised, else the date we asked for
create or replace function app.po_due(p public.purchase_orders)
returns date language sql immutable set search_path = '' as $$ select coalesce(p.promised_date, p.expected_date) $$;

-- the vendor confirmed the order (by phone, email, their order number): the date they promise
create or replace function public.po_confirm(p_id uuid, p_promised date default null, p_reference text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare po public.purchase_orders;
begin
  select * into po from public.purchase_orders where id = p_id for update;
  if po.id is null then raise exception 'Purchase order not found' using errcode = 'P0002'; end if;
  perform app.require_permission(po.company_id, 'procurement.write');
  if po.status not in ('approved', 'sent', 'partially_received') then
    raise exception 'Only an approved order can be confirmed by the vendor (this one is %)', replace(po.status, '_', ' ') using errcode = '55000';
  end if;
  if p_promised is not null and p_promised < po.order_date then raise exception 'The promised date is before the order date' using errcode = '22023'; end if;
  update public.purchase_orders
     set confirmed_at = now(), confirmed_by = auth.uid(), promised_date = coalesce(p_promised, promised_date, expected_date),
         vendor_reference = coalesce(nullif(btrim(p_reference), ''), vendor_reference),
         status = case when status = 'approved' then 'sent' else status end
   where id = po.id;
  -- the tasks to chase the confirmation are done
  update public.tasks set status = 'done', completed_at = now()
   where company_id = po.company_id and auto_key = 'po_confirm:' || po.id and status not in ('done', 'cancelled') and deleted_at is null;
  return (select jsonb_build_object('promised_date', promised_date, 'status', status) from public.purchase_orders where id = po.id);
end $$;

-- what has not come is ordered again: from the same vendor at the same prices, or from another
-- vendor at their prices. The old order stops waiting for it (closed, or cancelled when nothing came).
create or replace function public.po_order_rest(p_po uuid, p_vendor uuid default null, p_expected date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare po public.purchase_orders; v_vendor uuid; v_new uuid; v_lines jsonb; v_n int := 0; l record;
begin
  select * into po from public.purchase_orders where id = p_po for update;
  if po.id is null then raise exception 'Purchase order not found' using errcode = 'P0002'; end if;
  perform app.require_permission(po.company_id, 'procurement.write');
  if po.status not in ('approved', 'sent', 'partially_received') then
    raise exception 'Order % is %; only an order still waiting for goods can be ordered again', po.number, replace(po.status, '_', ' ') using errcode = '55000';
  end if;
  if exists (select 1 from public.goods_receipts where purchase_order_id = po.id and status = 'draft' and deleted_at is null) then
    raise exception 'Finish or delete the draft receipts on % first', po.number using errcode = '55000';
  end if;
  v_vendor := coalesce(p_vendor, po.vendor_id);
  if not exists (select 1 from public.purchase_order_lines where purchase_order_id = po.id and variant_id is not null and quantity > qty_received) then
    raise exception 'Everything on % has come; nothing is left to order', po.number using errcode = '55000';
  end if;

  if v_vendor = po.vendor_id then
    insert into public.purchase_orders (company_id, vendor_id, warehouse_id, currency_code, exchange_rate, payment_term_id, expected_date, notes, follows_id, incoterm)
    values (po.company_id, po.vendor_id, po.warehouse_id, po.currency_code, po.exchange_rate, po.payment_term_id, p_expected,
            'Plotëson porosinë ' || po.number, po.id, po.incoterm)
    returning id into v_new;
    for l in select * from public.purchase_order_lines where purchase_order_id = po.id and variant_id is not null and quantity > qty_received order by line_no loop
      v_n := v_n + 1;
      insert into public.purchase_order_lines (company_id, purchase_order_id, line_no, variant_id, description, quantity, uom_id, unit_price, discount_pct, tax_code_id)
      values (po.company_id, v_new, v_n, l.variant_id, l.description, l.quantity - l.qty_received, l.uom_id, l.unit_price, l.discount_pct, l.tax_code_id);
    end loop;
  else
    select jsonb_agg(jsonb_build_object('variant_id', variant_id, 'quantity', quantity - qty_received, 'description', description) order by line_no) into v_lines
      from public.purchase_order_lines where purchase_order_id = po.id and variant_id is not null and quantity > qty_received;
    v_new := app.create_purchase_order(po.company_id, v_vendor, po.warehouse_id, v_lines, null, p_expected, 'Në vend të porosisë ' || po.number);
    update public.purchase_orders set follows_id = po.id where id = v_new;
  end if;

  if exists (select 1 from public.purchase_order_lines where purchase_order_id = po.id and (qty_received > 0 or qty_billed > 0)) then
    update public.purchase_orders set status = 'closed' where id = po.id;
  else
    update public.purchase_orders set status = 'cancelled', cancel_reason = 'Ordered again in ' || (select number from public.purchase_orders where id = v_new) where id = po.id;
  end if;
  update public.tasks set status = 'done', completed_at = now()
   where company_id = po.company_id and auto_key in ('late_po:' || po.id, 'po_confirm:' || po.id) and status not in ('done', 'cancelled') and deleted_at is null;
  return v_new;
end $$;

-- the automatic tasks: an order not confirmed after N days, an order late by N days
do $$
declare v_oid oid; v_def text; v_new text; v_anchor text := '  -- new contacts nobody has picked up within a day';
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'tasks_run';
  v_def := pg_get_functiondef(v_oid);
  if position('late_po' in v_def) > 0 then return; end if;
  if position(v_anchor in v_def) = 0 then raise exception 'tasks_run: the place for the buying tasks was not found'; end if;
  v_new := replace(v_def, v_anchor, $x$  -- orders the vendor has not confirmed after N days: the buyer asks for the confirmation
  if app.auto_on(s, 'po_confirm') then
    d := app.auto_days(s, 'po_confirm', 2);
    for r in select o.id, o.number, o.buyer_id, bp.name from public.purchase_orders o join public.business_partners bp on bp.id = o.vendor_id
              where o.company_id = p_company and o.deleted_at is null and o.status in ('approved', 'sent') and o.confirmed_at is null
                and coalesce(o.sent_at, o.approved_at) <= now() - make_interval(days => d) loop
      v_who := case when r.buyer_id is not null and app.is_active_member(p_company, r.buyer_id) then r.buyer_id
                    else app.first_with_role(p_company, array['procurement_manager','inventory_manager','company_admin']) end;
      if app.auto_task(p_company, 'po_confirm:' || r.id, 'Kërko konfirmimin nga ' || r.name || ' për porosinë ' || r.number, v_who, v_today, 1::smallint,
                       'purchase_orders', r.id, r.number) then n := n + 1; end if;
    end loop;
  end if;

  -- orders late by N days: the buyer calls the vendor (or orders elsewhere)
  if app.auto_on(s, 'late_po') then
    d := app.auto_days(s, 'late_po', 1);
    for r in select o.id, o.number, o.buyer_id, bp.name, coalesce(o.promised_date, o.expected_date) as due
               from public.purchase_orders o join public.business_partners bp on bp.id = o.vendor_id
              where o.company_id = p_company and o.deleted_at is null and o.status in ('approved', 'sent', 'partially_received')
                and coalesce(o.promised_date, o.expected_date) <= v_today - d loop
      v_who := case when r.buyer_id is not null and app.is_active_member(p_company, r.buyer_id) then r.buyer_id
                    else app.first_with_role(p_company, array['procurement_manager','inventory_manager','company_admin']) end;
      if app.auto_task(p_company, 'late_po:' || r.id, 'Telefono ' || r.name || ': porosia ' || r.number || ' vonon që nga ' || to_char(r.due, 'DD.MM.YYYY'),
                       v_who, v_today, 2::smallint, 'purchase_orders', r.id, r.number) then n := n + 1; end if;
    end loop;
  end if;

$x$ || v_anchor);
  execute v_new;
end $$;

-- the receipt that brings everything closes the chase
create or replace function app.tg_po_done_tasks()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('received', 'closed', 'cancelled') and old.status is distinct from new.status then
    update public.tasks set status = 'done', completed_at = now()
     where company_id = new.company_id and auto_key in ('late_po:' || new.id, 'po_confirm:' || new.id) and status not in ('done', 'cancelled') and deleted_at is null;
  end if;
  return null;
end $$;
drop trigger if exists trg_92_done_tasks on public.purchase_orders;
create trigger trg_92_done_tasks after update of status on public.purchase_orders for each row execute function app.tg_po_done_tasks();

-- -----------------------------------------------------------------------------
-- 2. A price rise from a vendor waits for a manager
-- -----------------------------------------------------------------------------
alter table public.company_settings add column if not exists purchase_price_tolerance numeric(5,2) not null default 1
  check (purchase_price_tolerance between 0 and 50);
alter table public.vendor_bills
  add column if not exists price_ok_by     uuid references auth.users(id),
  add column if not exists price_ok_at     timestamptz,
  add column if not exists price_ok_reason text,
  add column if not exists price_ok_prices jsonb;                -- {variant_id: the net unit price accepted, in the base currency}

-- what we paid this vendor for this item before (net, in the base currency), else their price list
create or replace function app.bill_reference_price(p_company uuid, p_vendor uuid, p_variant uuid, p_uom uuid, p_date date, p_bill uuid)
returns table (price numeric, source text, ref_date date, ref_number text)
language sql stable security definer set search_path = '' as $$
  (select round(l.unit_price * (1 - l.discount_pct / 100) * b.exchange_rate, 4), 'last_bill', b.bill_date, b.number
     from public.vendor_bill_lines l join public.vendor_bills b on b.id = l.bill_id
    where b.company_id = p_company and b.vendor_id = p_vendor and b.document_type = 'vendor_bill' and b.status = 'posted' and b.deleted_at is null
      and b.id <> p_bill and l.variant_id = p_variant and not l.is_return and l.quantity > 0 and l.uom_id is not distinct from p_uom
      and b.bill_date <= p_date
    order by b.bill_date desc, b.posted_at desc nulls last limit 1)
  union all
  (select round(vp.price * coalesce(case when vp.currency_code = c.base_currency then 1 else app.exchange_rate(p_company, vp.currency_code, p_date) end, 1), 4),
          'price_list', null::date, null::text
     from public.vendor_products vp join public.companies c on c.id = p_company
    where vp.company_id = p_company and vp.vendor_id = p_vendor and vp.variant_id = p_variant and vp.deleted_at is null and vp.price > 0)
  limit 1
$$;

-- the lines of a bill priced above what was paid before (lines from an order are checked against the order instead)
create or replace function app.bill_price_rises(p_bill uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b public.vendor_bills; v_tol numeric; r jsonb := '[]'::jsonb; l record; ref record; v_price numeric; v_pct numeric; v_ok numeric;
begin
  select * into b from public.vendor_bills where id = p_bill;
  if b.id is null or b.document_type <> 'vendor_bill' then return r; end if;
  select coalesce(purchase_price_tolerance, 1) into v_tol from public.company_settings where company_id = b.company_id;
  v_tol := coalesce(v_tol, 1);
  for l in select bl.*, v.sku, v.name as vname from public.vendor_bill_lines bl join public.product_variants v on v.id = bl.variant_id
            where bl.bill_id = b.id and bl.po_line_id is null and not bl.is_return and bl.quantity > 0 order by bl.line_no loop
    select * into ref from app.bill_reference_price(b.company_id, b.vendor_id, l.variant_id, l.uom_id, b.bill_date, b.id);
    continue when ref.price is null or ref.price <= 0;
    v_price := round(l.unit_price * (1 - l.discount_pct / 100) * b.exchange_rate, 4);
    v_pct := round(100 * (v_price - ref.price) / ref.price, 2);
    continue when v_pct <= v_tol;
    v_ok := nullif(b.price_ok_prices ->> l.variant_id::text, '')::numeric;
    r := r || jsonb_build_array(jsonb_build_object('line_no', l.line_no, 'variant_id', l.variant_id, 'sku', l.sku, 'name', l.vname,
           'price', v_price, 'before', ref.price, 'pct', v_pct, 'source', ref.source, 'ref_date', ref.ref_date, 'ref_number', ref.ref_number,
           'accepted', v_ok is not null and v_price <= v_ok + 0.00005));
  end loop;
  return r;
end $$;

create or replace function app.bill_price_guard(p_bill uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  select string_agg(format('%s +%s%%', x ->> 'sku', x ->> 'pct'), ', ') into v
    from jsonb_array_elements(app.bill_price_rises(p_bill)) x where not (x ->> 'accepted')::boolean;
  if v is not null then
    raise exception 'Prices went up from this vendor (%). A manager accepts the new prices first', v using errcode = '23514';
  end if;
end $$;

do $$
declare v_oid oid; v_def text; v_anchor text := '  for l in
    select bl.*, pl.purchase_order_id, pl.quantity as po_qty';
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'post_vendor_bill';
  v_def := pg_get_functiondef(v_oid);
  if position('bill_price_guard' in v_def) > 0 then return; end if;
  if position(v_anchor in v_def) = 0 then raise exception 'post_vendor_bill: the place for the price check was not found'; end if;
  execute replace(v_def, v_anchor, '  -- a price rise from the vendor waits for a manager
  if b.document_type = ''vendor_bill'' then perform app.bill_price_guard(b.id); end if;

' || v_anchor);
end $$;

-- the tolerance is a company choice, in Settings → Automations (the procurement manager's)
do $$
declare v_oid oid; v_def text; v_new text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'automation_settings_save';
  v_def := pg_get_functiondef(v_oid);
  if position('purchase_price_tolerance' in v_def) > 0 then return; end if;
  v_new := replace(v_def, '  update public.company_settings set
', '  if p_patch ? ''purchase_price_tolerance'' then perform app.require_permission(p_company, ''procurement.approve''); end if;
  update public.company_settings set
    purchase_price_tolerance = coalesce((p_patch ->> ''purchase_price_tolerance'')::numeric, purchase_price_tolerance),
');
  if v_new = v_def then raise exception 'automation_settings_save: the place for the purchase tolerance was not found'; end if;
  execute v_new;
end $$;

-- what the bill page shows
create or replace function public.bill_price_check(p_bill uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b public.vendor_bills;
begin
  select * into b from public.vendor_bills where id = p_bill;
  if b.id is null then raise exception 'Bill not found' using errcode = 'P0002'; end if;
  perform app.require_permission(b.company_id, 'invoicing.read');
  return jsonb_build_object(
    'tolerance', coalesce((select purchase_price_tolerance from public.company_settings where company_id = b.company_id), 1),
    'rises', app.bill_price_rises(b.id),
    'can_accept', app.has_permission(b.company_id, 'procurement.approve') or app.has_permission(b.company_id, 'invoicing.approve'),
    'accepted_by', app.person_name(b.price_ok_by), 'accepted_at', b.price_ok_at, 'reason', b.price_ok_reason);
end $$;

-- a manager accepts the new prices (with a reason); optionally they become the vendor's price list
create or replace function public.bill_accept_prices(p_bill uuid, p_reason text, p_update_list boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.vendor_bills; v_rises jsonb; v_map jsonb; x jsonb; v_base char(3);
begin
  select * into b from public.vendor_bills where id = p_bill for update;
  if b.id is null then raise exception 'Bill not found' using errcode = 'P0002'; end if;
  if not (app.has_permission(b.company_id, 'procurement.approve') or app.has_permission(b.company_id, 'invoicing.approve')) then
    raise exception 'Only a procurement or finance manager accepts a price rise' using errcode = '42501';
  end if;
  if b.status <> 'draft' then raise exception 'Bill is already %', b.status using errcode = '55000'; end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Write why the new prices are accepted' using errcode = '22023'; end if;
  v_rises := app.bill_price_rises(b.id);
  if jsonb_array_length(v_rises) = 0 then raise exception 'No price on this bill went up' using errcode = '55000'; end if;
  v_map := coalesce(b.price_ok_prices, '{}'::jsonb);
  for x in select * from jsonb_array_elements(v_rises) loop
    v_map := v_map || jsonb_build_object(x ->> 'variant_id', greatest((x ->> 'price')::numeric, coalesce((v_map ->> (x ->> 'variant_id'))::numeric, 0)));
  end loop;
  update public.vendor_bills set price_ok_by = auth.uid(), price_ok_at = now(), price_ok_reason = btrim(p_reason), price_ok_prices = v_map where id = b.id;
  if p_update_list then
    select base_currency into v_base from public.companies where id = b.company_id;
    for x in select * from jsonb_array_elements(v_rises) loop
      update public.vendor_products vp
         set price = round(l.unit_price * (1 - l.discount_pct / 100), 4)
        from public.vendor_bill_lines l
       where l.bill_id = b.id and l.line_no = (x ->> 'line_no')::int and vp.company_id = b.company_id and vp.vendor_id = b.vendor_id
         and vp.variant_id = (x ->> 'variant_id')::uuid and vp.deleted_at is null and vp.currency_code = b.currency_code;
    end loop;
  end if;
  return public.bill_price_check(b.id);
end $$;

-- the buyer asks the managers to look at the new prices
create or replace function public.bill_ask_price_ok(p_bill uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare b public.vendor_bills; v_list text; v_vendor text; n int;
begin
  select * into b from public.vendor_bills where id = p_bill;
  if b.id is null then raise exception 'Bill not found' using errcode = 'P0002'; end if;
  perform app.require_permission(b.company_id, 'invoicing.write');
  select string_agg(format('%s: %s → %s (+%s%%)', x ->> 'name', x ->> 'before', x ->> 'price', x ->> 'pct'), '; ') into v_list
    from jsonb_array_elements(app.bill_price_rises(b.id)) x where not (x ->> 'accepted')::boolean;
  if v_list is null then raise exception 'No price on this bill waits for a manager' using errcode = '55000'; end if;
  select name into v_vendor from public.business_partners where id = b.vendor_id;
  perform app.notify_permission(b.company_id, 'procurement.approve', 'approval', 'Prices went up: ' || v_vendor || ' · ' || coalesce(b.vendor_invoice_number, b.number),
                                v_list, '/procurement/bills/' || b.id);
  get diagnostics n = row_count;
  return n;
end $$;

-- -----------------------------------------------------------------------------
-- 3. The vendors' scorecard, and the main items with one vendor only
-- -----------------------------------------------------------------------------
create or replace function public.vendor_scorecard(p_company uuid, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date;
begin
  perform app.require_permission(p_company, 'procurement.read');
  v_today := (now() at time zone coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane'))::date;
  return (
  with o as (   -- the orders of the period that were really placed
    select po.*, coalesce(po.promised_date, po.expected_date) as due,
           (select max(g.done_at)::date from public.goods_receipts g where g.purchase_order_id = po.id and g.status = 'done') as last_in,
           (select coalesce(sum(quantity), 0) from public.purchase_order_lines where purchase_order_id = po.id and variant_id is not null) as q_ordered,
           (select coalesce(sum(least(qty_received, quantity)), 0) from public.purchase_order_lines where purchase_order_id = po.id and variant_id is not null) as q_received
      from public.purchase_orders po
     where po.company_id = p_company and po.deleted_at is null and po.order_date between p_from and p_to
       and po.status not in ('draft', 'pending_approval', 'cancelled')
  ), per as (
    select o.vendor_id, count(*) as orders,
           count(*) filter (where o.confirmed_at is not null) as confirmed,
           -- on time: everything in by the due date; an order past its date still waiting counts as late
           count(*) filter (where o.due is not null and (o.status in ('received', 'closed') or o.due < v_today)) as judged,
           count(*) filter (where o.due is not null and o.status in ('received', 'closed') and o.last_in <= o.due) as on_time,
           avg(greatest(coalesce(o.last_in, v_today) - o.due, 0)) filter (where o.due is not null and (o.status in ('received', 'closed') or o.due < v_today)) as delay,
           sum(o.q_ordered) filter (where o.status in ('received', 'closed', 'partially_received')) as q_ordered,
           sum(o.q_received) filter (where o.status in ('received', 'closed', 'partially_received')) as q_received,
           count(*) filter (where o.status in ('approved', 'sent', 'partially_received') and o.due < v_today) as late_now,
           max(o.order_date) as last_order
      from o group by o.vendor_id
  ), rej as (
    select g.vendor_id, sum(gl.quantity) as q_in, sum(gl.quantity) filter (where gl.qc_status = 'rejected') as q_rejected
      from public.goods_receipts g join public.goods_receipt_lines gl on gl.receipt_id = g.id
     where g.company_id = p_company and g.status = 'done' and g.done_at::date between p_from and p_to and g.vendor_id is not null
     group by g.vendor_id
  ), bills as (
    select b.vendor_id, sum(round(b.subtotal * b.exchange_rate, 2) * case when b.document_type = 'vendor_credit' then -1 else 1 end) as spend,
           count(*) filter (where b.price_ok_at is not null) as rises
      from public.vendor_bills b
     where b.company_id = p_company and b.status = 'posted' and b.deleted_at is null and b.bill_date between p_from and p_to
     group by b.vendor_id
  ), v as (
    select bp.id, bp.name, per.orders, per.confirmed, per.judged, per.on_time, per.delay, per.q_ordered, per.q_received, per.late_now, per.last_order,
           rej.q_in, rej.q_rejected, bills.spend, bills.rises,
           round(100.0 * per.on_time / nullif(per.judged, 0), 1) as on_time_pct,
           round(100.0 * per.q_received / nullif(per.q_ordered, 0), 1) as fill_pct,
           round(100.0 * coalesce(rej.q_rejected, 0) / nullif(rej.q_in, 0), 2) as rejected_pct,
           round(100.0 * per.confirmed / nullif(per.orders, 0), 1) as confirmed_pct
      from public.business_partners bp
      left join per on per.vendor_id = bp.id left join rej on rej.vendor_id = bp.id left join bills on bills.vendor_id = bp.id
     where bp.company_id = p_company and bp.is_vendor and bp.deleted_at is null
       and (per.vendor_id is not null or rej.vendor_id is not null or bills.vendor_id is not null)
  )
  select jsonb_build_object('from', p_from, 'to', p_to, 'vendors', coalesce(jsonb_agg(jsonb_build_object(
           'vendor_id', v.id, 'name', v.name, 'orders', coalesce(v.orders, 0), 'spend', coalesce(v.spend, 0),
           'on_time_pct', v.on_time_pct, 'judged', coalesce(v.judged, 0), 'avg_delay_days', round(v.delay, 1),
           'fill_pct', v.fill_pct, 'rejected_pct', v.rejected_pct, 'confirmed_pct', v.confirmed_pct,
           'price_rises', coalesce(v.rises, 0), 'late_now', coalesce(v.late_now, 0), 'last_order', v.last_order,
           -- A: on time and complete; C: often late, short or refused at the door; B: in between; no grade without enough to judge
           'grade', case when coalesce(v.judged, 0) < 2 then null
                         when coalesce(v.on_time_pct, 0) >= 95 and coalesce(v.fill_pct, 100) >= 98 and coalesce(v.rejected_pct, 0) <= 1 then 'A'
                         when coalesce(v.on_time_pct, 0) >= 80 and coalesce(v.fill_pct, 100) >= 90 and coalesce(v.rejected_pct, 0) <= 3 then 'B'
                         else 'C' end)
           order by coalesce(v.spend, 0) desc, v.name), '[]'::jsonb),
         'single_source', (
           -- the main items (A in the company's ABC) that only one vendor sells us
           select coalesce(jsonb_agg(jsonb_build_object('variant_id', ic.variant_id, 'sku', pv.sku, 'name', pv.name, 'value', ic.value,
                    'vendor', (select bp.name from public.vendor_products vp join public.business_partners bp on bp.id = vp.vendor_id
                                where vp.variant_id = ic.variant_id and vp.deleted_at is null limit 1)) order by ic.rank), '[]'::jsonb)
             from public.item_classes ic join public.product_variants pv on pv.id = ic.variant_id
            where ic.company_id = p_company and ic.warehouse_id is null and ic.abc = 'A' and pv.deleted_at is null
              and (select count(distinct vp.vendor_id) from public.vendor_products vp join public.business_partners bp on bp.id = vp.vendor_id
                    where vp.variant_id = ic.variant_id and vp.deleted_at is null and bp.is_active and bp.deleted_at is null)
                + (select count(distinct b.vendor_id) from public.vendor_bill_lines l join public.vendor_bills b on b.id = l.bill_id
                    where l.variant_id = ic.variant_id and b.status = 'posted' and b.bill_date >= v_today - 365
                      and not exists (select 1 from public.vendor_products vp where vp.variant_id = ic.variant_id and vp.vendor_id = b.vendor_id and vp.deleted_at is null)) < 2),
         'abc_ready', exists (select 1 from public.item_classes where company_id = p_company and warehouse_id is null))
  from v);
end $$;

-- -----------------------------------------------------------------------------
-- 4. Offers from several vendors
-- -----------------------------------------------------------------------------
insert into public.document_types (key, name, module, table_name, default_prefix)
values ('purchase_rfq', 'Request for offers', 'procurement', 'purchase_rfqs', 'KO-')
on conflict (key) do nothing;
select app.define_flow('purchase_rfq', '{draft}', '{draft>sent,draft>cancelled,sent>decided,sent>cancelled,sent>draft}');

create table if not exists public.purchase_rfqs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  number        text not null,
  status        text not null default 'draft',
  title         text not null,
  warehouse_id  uuid not null,
  needed_by     date,
  reply_by      date,
  notes         text,
  sent_at       timestamptz,
  decided_at    timestamptz,
  decided_by    uuid references auth.users(id),
  decision_note text,
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id)
);
select app.register_table('public.purchase_rfqs', 'procurement', p_soft_delete => true, p_client_write => false);
select app.register_document('public.purchase_rfqs', 'purchase_rfq', 'created_at');

create table if not exists public.purchase_rfq_lines (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null,
  rfq_id      uuid not null,
  line_no     smallint not null,
  variant_id  uuid,
  description text not null,
  quantity    numeric(18,4) not null check (quantity > 0),
  foreign key (company_id, rfq_id) references public.purchase_rfqs(company_id, id) on delete cascade,
  foreign key (company_id, variant_id) references public.product_variants(company_id, id),
  unique (rfq_id, line_no)
);
select app.register_table('public.purchase_rfq_lines', 'procurement', p_soft_delete => false, p_client_write => false, p_audit => false);

create table if not exists public.purchase_rfq_vendors (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null,
  rfq_id            uuid not null,
  vendor_id         uuid not null,
  status            text not null default 'waiting' check (status in ('waiting', 'answered', 'declined', 'won', 'lost')),
  currency_code     char(3) not null references public.currencies(code),
  payment_days      int check (payment_days between 0 and 365),
  delivery_days     int check (delivery_days between 0 and 365),
  valid_until       date,
  notes             text,
  answered_at       timestamptz,
  purchase_order_id uuid,
  foreign key (company_id, rfq_id) references public.purchase_rfqs(company_id, id) on delete cascade,
  foreign key (company_id, vendor_id) references public.business_partners(company_id, id),
  foreign key (company_id, purchase_order_id) references public.purchase_orders(company_id, id),
  unique (rfq_id, vendor_id)
);
select app.register_table('public.purchase_rfq_vendors', 'procurement', p_soft_delete => false, p_client_write => false, p_audit => false);

create table if not exists public.purchase_rfq_quotes (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null,
  rfq_vendor_id uuid not null references public.purchase_rfq_vendors(id) on delete cascade,
  rfq_line_id   uuid not null references public.purchase_rfq_lines(id) on delete cascade,
  unit_price    numeric(18,4) not null check (unit_price >= 0),
  discount_pct  numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  note          text,
  unique (rfq_vendor_id, rfq_line_id)
);
select app.register_table('public.purchase_rfq_quotes', 'procurement', p_soft_delete => false, p_client_write => false, p_audit => false);

-- one request: its lines and the vendors asked (while it is a draft; vendors can be added later too)
create or replace function public.rfq_save(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_co uuid := (p ->> 'company_id')::uuid; v_id uuid := nullif(p ->> 'id', '')::uuid; q public.purchase_rfqs; x jsonb; v_n int := 0; v_vendor uuid;
begin
  if v_id is not null then
    select * into q from public.purchase_rfqs where id = v_id for update;
    if q.id is null then raise exception 'Request not found' using errcode = 'P0002'; end if;
    v_co := q.company_id;
  end if;
  perform app.require_permission(v_co, 'procurement.write');
  if (q.id is null or p ? 'title') and length(btrim(coalesce(p ->> 'title', ''))) < 2 then raise exception 'Give the request a name' using errcode = '22023'; end if;
  if q.id is not null and q.status not in ('draft', 'sent') then raise exception 'The request is already %', q.status using errcode = '55000'; end if;

  if q.id is null then
    insert into public.purchase_rfqs (company_id, title, warehouse_id, needed_by, reply_by, notes)
    values (v_co, btrim(p ->> 'title'), coalesce(nullif(p ->> 'warehouse_id', '')::uuid, (select default_warehouse_id from public.company_settings where company_id = v_co)),
            nullif(p ->> 'needed_by', '')::date, nullif(p ->> 'reply_by', '')::date, nullif(btrim(p ->> 'notes'), ''))
    returning * into q;
  else
    -- only what was sent changes
    update public.purchase_rfqs set title = case when p ? 'title' then btrim(p ->> 'title') else title end,
           warehouse_id = coalesce(nullif(p ->> 'warehouse_id', '')::uuid, warehouse_id),
           needed_by = case when p ? 'needed_by' then nullif(p ->> 'needed_by', '')::date else needed_by end,
           reply_by = case when p ? 'reply_by' then nullif(p ->> 'reply_by', '')::date else reply_by end,
           notes = case when p ? 'notes' then nullif(btrim(p ->> 'notes'), '') else notes end
     where id = q.id;
  end if;

  -- the lines change only on a draft (offers are made against them)
  if p ? 'lines' and q.status = 'draft' then
    delete from public.purchase_rfq_lines where rfq_id = q.id;
    for x in select * from jsonb_array_elements(p -> 'lines') loop
      continue when coalesce(nullif(x ->> 'quantity', '')::numeric, 0) <= 0;
      v_n := v_n + 1;
      insert into public.purchase_rfq_lines (company_id, rfq_id, line_no, variant_id, description, quantity)
      select v_co, q.id, v_n, v.id, coalesce(nullif(btrim(x ->> 'description'), ''), v.name, 'Artikull'), (x ->> 'quantity')::numeric
        from (select 1) one left join public.product_variants v on v.id = nullif(x ->> 'variant_id', '')::uuid and v.company_id = v_co;
    end loop;
  end if;
  if p ? 'vendors' then
    for x in select * from jsonb_array_elements(p -> 'vendors') loop
      v_vendor := (x #>> '{}')::uuid;
      if not exists (select 1 from public.business_partners where id = v_vendor and company_id = v_co and is_vendor and deleted_at is null) then
        raise exception 'Not a vendor of this company' using errcode = '23514';
      end if;
      insert into public.purchase_rfq_vendors (company_id, rfq_id, vendor_id, currency_code)
      select v_co, q.id, v_vendor, coalesce(bp.currency_code, c.base_currency)
        from public.business_partners bp join public.companies c on c.id = v_co where bp.id = v_vendor
      on conflict (rfq_id, vendor_id) do nothing;
    end loop;
    -- a vendor taken off the list (only if they have not answered)
    if q.status = 'draft' then
      delete from public.purchase_rfq_vendors where rfq_id = q.id and status = 'waiting'
         and not (vendor_id::text in (select jsonb_array_elements_text(p -> 'vendors')));
    end if;
  end if;
  return q.id;
end $$;

create or replace function public.rfq_send(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare q public.purchase_rfqs;
begin
  select * into q from public.purchase_rfqs where id = p_id for update;
  if q.id is null then raise exception 'Request not found' using errcode = 'P0002'; end if;
  perform app.require_permission(q.company_id, 'procurement.write');
  if q.status <> 'draft' then raise exception 'The request is already %', q.status using errcode = '55000'; end if;
  if not exists (select 1 from public.purchase_rfq_lines where rfq_id = q.id) then raise exception 'Add at least one item' using errcode = '23514'; end if;
  if (select count(*) from public.purchase_rfq_vendors where rfq_id = q.id) < 2 then
    raise exception 'Ask at least two vendors, so the offers can be compared' using errcode = '23514';
  end if;
  update public.purchase_rfqs set status = 'sent', sent_at = now() where id = q.id;
end $$;

-- a vendor's offer: their terms and a price per item (an item they do not offer is left out)
create or replace function public.rfq_offer_save(p_rfq_vendor uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare rv public.purchase_rfq_vendors; q public.purchase_rfqs; x jsonb;
begin
  select * into rv from public.purchase_rfq_vendors where id = p_rfq_vendor for update;
  if rv.id is null then raise exception 'Offer not found' using errcode = 'P0002'; end if;
  select * into q from public.purchase_rfqs where id = rv.rfq_id;
  perform app.require_permission(q.company_id, 'procurement.write');
  if q.status <> 'sent' then raise exception 'Offers are written once the request is sent (it is %)', q.status using errcode = '55000'; end if;
  if coalesce((p ->> 'declined')::boolean, false) then
    update public.purchase_rfq_vendors set status = 'declined', answered_at = now(), notes = nullif(btrim(p ->> 'notes'), '') where id = rv.id;
    delete from public.purchase_rfq_quotes where rfq_vendor_id = rv.id;
    return;
  end if;
  delete from public.purchase_rfq_quotes where rfq_vendor_id = rv.id;
  for x in select * from jsonb_array_elements(coalesce(p -> 'prices', '[]'::jsonb)) loop
    continue when nullif(x ->> 'unit_price', '') is null;
    insert into public.purchase_rfq_quotes (company_id, rfq_vendor_id, rfq_line_id, unit_price, discount_pct, note)
    select q.company_id, rv.id, l.id, (x ->> 'unit_price')::numeric, coalesce(nullif(x ->> 'discount_pct', '')::numeric, 0), nullif(btrim(x ->> 'note'), '')
      from public.purchase_rfq_lines l where l.id = (x ->> 'line_id')::uuid and l.rfq_id = q.id;
  end loop;
  if not exists (select 1 from public.purchase_rfq_quotes where rfq_vendor_id = rv.id) then
    raise exception 'Write a price for at least one item, or mark the offer as declined' using errcode = '23514';
  end if;
  update public.purchase_rfq_vendors
     set status = 'answered', answered_at = now(),
         currency_code = coalesce(nullif(p ->> 'currency_code', ''), currency_code),
         payment_days = nullif(p ->> 'payment_days', '')::int, delivery_days = nullif(p ->> 'delivery_days', '')::int,
         valid_until = nullif(p ->> 'valid_until', '')::date, notes = nullif(btrim(p ->> 'notes'), '')
   where id = rv.id;
end $$;

-- the request with its offers side by side (net prices, in the base currency, to compare)
create or replace function public.rfq_get(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare q public.purchase_rfqs; v_base char(3);
begin
  select * into q from public.purchase_rfqs where id = p_id and deleted_at is null;
  if q.id is null then raise exception 'Request not found' using errcode = 'P0002'; end if;
  perform app.require_permission(q.company_id, 'procurement.read');
  select base_currency into v_base from public.companies where id = q.company_id;
  return (
  with vend as (
    select rv.*, bp.name, bp.email, bp.phone,
           coalesce(case when rv.currency_code = v_base then 1 else app.exchange_rate(q.company_id, rv.currency_code, current_date) end, 1) as rate,
           (select number from public.purchase_orders where id = rv.purchase_order_id) as po_number
      from public.purchase_rfq_vendors rv join public.business_partners bp on bp.id = rv.vendor_id where rv.rfq_id = q.id
  ), qq as (
    select x.*, round(x.unit_price * (1 - x.discount_pct / 100) * vend.rate, 4) as net_base, vend.vendor_id
      from public.purchase_rfq_quotes x join vend on vend.id = x.rfq_vendor_id
  ), lines as (
    select l.*, v.sku, (select min(net_base) from qq where qq.rfq_line_id = l.id) as best,
           (select price from app.bill_reference_price(q.company_id, (select vendor_id from public.vendor_products vp where vp.variant_id = l.variant_id and vp.deleted_at is null
                                                                       order by vp.is_preferred desc limit 1), l.variant_id, null, current_date, '00000000-0000-0000-0000-000000000000')) as paid_before
      from public.purchase_rfq_lines l left join public.product_variants v on v.id = l.variant_id where l.rfq_id = q.id
  )
  select jsonb_build_object(
    'id', q.id, 'number', q.number, 'status', q.status, 'title', q.title, 'warehouse_id', q.warehouse_id, 'needed_by', q.needed_by, 'reply_by', q.reply_by,
    'notes', q.notes, 'sent_at', q.sent_at, 'decided_at', q.decided_at, 'decided_by', app.person_name(q.decided_by), 'decision_note', q.decision_note,
    'created_at', q.created_at, 'base_currency', v_base,
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'line_no', l.line_no, 'variant_id', l.variant_id, 'sku', l.sku, 'description', l.description,
               'quantity', l.quantity, 'best', l.best, 'paid_before', l.paid_before) order by l.line_no) from lines l), '[]'::jsonb),
    'vendors', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'vendor_id', v.vendor_id, 'name', v.name, 'email', v.email, 'phone', v.phone,
               'status', v.status, 'currency_code', v.currency_code, 'rate', v.rate, 'payment_days', v.payment_days, 'delivery_days', v.delivery_days,
               'valid_until', v.valid_until, 'notes', v.notes, 'answered_at', v.answered_at, 'purchase_order_id', v.purchase_order_id, 'po_number', v.po_number,
               'quotes', coalesce((select jsonb_agg(jsonb_build_object('line_id', qq.rfq_line_id, 'unit_price', qq.unit_price, 'discount_pct', qq.discount_pct,
                          'net_base', qq.net_base, 'note', qq.note)) from qq where qq.rfq_vendor_id = v.id), '[]'::jsonb),
               'items', (select count(*) from qq where qq.rfq_vendor_id = v.id),
               'total_base', (select round(sum(qq.net_base * l.quantity), 2) from qq join public.purchase_rfq_lines l on l.id = qq.rfq_line_id where qq.rfq_vendor_id = v.id),
               'best_lines', (select count(*) from qq join lines l on l.id = qq.rfq_line_id where qq.rfq_vendor_id = v.id and qq.net_base <= l.best + 0.00005))
             order by v.name) from vend v), '[]'::jsonb),
    'best_total', (select round(sum(l.best * l.quantity), 2) from lines l where l.best is not null),
    'unpriced_lines', (select count(*) from lines l where l.best is null)));
end $$;

-- the decision: everything from one vendor, or each item from the vendor with the best price.
-- The orders are made as drafts at the offered prices; the offered prices can become the vendors' price lists.
create or replace function public.rfq_decide(p_id uuid, p_vendor uuid default null, p_note text default null, p_save_prices boolean default true)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare q public.purchase_rfqs; rv record; x record; v_po uuid; v_n int; v_pos jsonb := '[]'::jsonb; v_pick jsonb;
begin
  select * into q from public.purchase_rfqs where id = p_id for update;
  if q.id is null then raise exception 'Request not found' using errcode = 'P0002'; end if;
  perform app.require_permission(q.company_id, 'procurement.write');
  if q.status <> 'sent' then raise exception 'Only a sent request can be decided (this one is %)', q.status using errcode = '55000'; end if;
  if not exists (select 1 from public.purchase_rfq_vendors where rfq_id = q.id and status = 'answered') then
    raise exception 'No vendor has made an offer yet' using errcode = '55000';
  end if;
  if p_vendor is not null and not exists (select 1 from public.purchase_rfq_vendors where rfq_id = q.id and vendor_id = p_vendor and status = 'answered') then
    raise exception 'That vendor has not made an offer' using errcode = '23514';
  end if;

  -- which offer each item goes to: the chosen vendor, or the lowest net price (then the quicker delivery)
  with rate as (
    select o.id, o.vendor_id, o.delivery_days,
           coalesce(case when o.currency_code = c.base_currency then 1 else app.exchange_rate(q.company_id, o.currency_code, current_date) end, 1) as r
      from public.purchase_rfq_vendors o join public.companies c on c.id = q.company_id where o.rfq_id = q.id and o.status = 'answered'
  ), ranked as (
    select qq.rfq_line_id, qq.rfq_vendor_id, rate.vendor_id,
           row_number() over (partition by qq.rfq_line_id order by (qq.unit_price * (1 - qq.discount_pct / 100) * rate.r), rate.delivery_days nulls last) as rk
      from public.purchase_rfq_quotes qq join rate on rate.id = qq.rfq_vendor_id
     where p_vendor is null or rate.vendor_id = p_vendor
  )
  select coalesce(jsonb_agg(jsonb_build_object('line_id', rfq_line_id, 'rfq_vendor_id', rfq_vendor_id)), '[]'::jsonb) into v_pick from ranked where rk = 1;
  if jsonb_array_length(v_pick) = 0 then raise exception 'No offered price to order from' using errcode = '55000'; end if;

  for rv in select o.*, bp.payment_term_id from public.purchase_rfq_vendors o join public.business_partners bp on bp.id = o.vendor_id
             where o.id in (select (e ->> 'rfq_vendor_id')::uuid from jsonb_array_elements(v_pick) e) order by o.vendor_id loop
    insert into public.purchase_orders (company_id, vendor_id, warehouse_id, currency_code, payment_term_id, expected_date, notes)
    values (q.company_id, rv.vendor_id, q.warehouse_id, rv.currency_code, rv.payment_term_id,
            coalesce(q.needed_by, case when rv.delivery_days is not null then current_date + rv.delivery_days end),
            'Nga oferta për ' || q.number || ' · ' || q.title)
    returning id into v_po;
    v_n := 0;
    for x in select l.*, qq.unit_price, qq.discount_pct from public.purchase_rfq_quotes qq join public.purchase_rfq_lines l on l.id = qq.rfq_line_id
              where qq.rfq_vendor_id = rv.id and l.id in (select (e ->> 'line_id')::uuid from jsonb_array_elements(v_pick) e where (e ->> 'rfq_vendor_id')::uuid = rv.id)
              order by l.line_no loop
      v_n := v_n + 1;
      insert into public.purchase_order_lines (company_id, purchase_order_id, line_no, variant_id, description, quantity, unit_price, discount_pct, tax_code_id)
      values (q.company_id, v_po, v_n, x.variant_id, x.description, x.quantity, x.unit_price, x.discount_pct,
              (select default_purchase_tax_code_id from public.company_settings where company_id = q.company_id));
      if p_save_prices and x.variant_id is not null then
        update public.vendor_products set price = round(x.unit_price * (1 - x.discount_pct / 100), 4), currency_code = rv.currency_code,
                                          lead_time_days = coalesce(rv.delivery_days, lead_time_days)
         where vendor_id = rv.vendor_id and variant_id = x.variant_id and deleted_at is null;
        if not found then
          insert into public.vendor_products (company_id, vendor_id, variant_id, price, currency_code, lead_time_days)
          values (q.company_id, rv.vendor_id, x.variant_id, round(x.unit_price * (1 - x.discount_pct / 100), 4), rv.currency_code, coalesce(rv.delivery_days, 0));
        end if;
      end if;
    end loop;
    update public.purchase_rfq_vendors set status = 'won', purchase_order_id = v_po where id = rv.id;
    v_pos := v_pos || jsonb_build_array(jsonb_build_object('id', v_po, 'number', (select number from public.purchase_orders where id = v_po), 'vendor_id', rv.vendor_id));
  end loop;
  update public.purchase_rfq_vendors set status = 'lost' where rfq_id = q.id and status = 'answered';
  update public.purchase_rfqs set status = 'decided', decided_at = now(), decided_by = auth.uid(), decision_note = nullif(btrim(p_note), '') where id = q.id;
  return v_pos;
end $$;

create or replace function public.rfq_cancel(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare q public.purchase_rfqs;
begin
  select * into q from public.purchase_rfqs where id = p_id for update;
  if q.id is null then raise exception 'Request not found' using errcode = 'P0002'; end if;
  perform app.require_permission(q.company_id, 'procurement.write');
  if q.status not in ('draft', 'sent') then raise exception 'The request is already %', q.status using errcode = '55000'; end if;
  update public.purchase_rfqs set status = 'cancelled' where id = q.id;
end $$;

create or replace function public.rfq_list(p_company uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when app.has_permission(p_company, 'procurement.read') then coalesce(jsonb_agg(jsonb_build_object(
           'id', q.id, 'number', q.number, 'status', q.status, 'title', q.title, 'needed_by', q.needed_by, 'reply_by', q.reply_by, 'created_at', q.created_at,
           'items', (select count(*) from public.purchase_rfq_lines l where l.rfq_id = q.id),
           'vendors', (select count(*) from public.purchase_rfq_vendors v where v.rfq_id = q.id),
           'answered', (select count(*) from public.purchase_rfq_vendors v where v.rfq_id = q.id and v.status in ('answered', 'declined', 'won', 'lost')),
           'winners', (select string_agg(bp.name, ', ') from public.purchase_rfq_vendors v join public.business_partners bp on bp.id = v.vendor_id
                        where v.rfq_id = q.id and v.status = 'won')) order by q.created_at desc), '[]'::jsonb)
         else '[]'::jsonb end
    from public.purchase_rfqs q where q.company_id = p_company and q.deleted_at is null
$$;

revoke execute on function app.po_due(public.purchase_orders), app.bill_reference_price(uuid, uuid, uuid, uuid, date, uuid), app.bill_price_rises(uuid),
  app.bill_price_guard(uuid), app.tg_po_done_tasks() from public, anon, authenticated;
revoke execute on function public.po_confirm(uuid, date, text), public.po_order_rest(uuid, uuid, date), public.bill_price_check(uuid),
  public.bill_accept_prices(uuid, text, boolean), public.bill_ask_price_ok(uuid), public.vendor_scorecard(uuid, date, date),
  public.rfq_save(jsonb), public.rfq_send(uuid), public.rfq_offer_save(uuid, jsonb), public.rfq_get(uuid), public.rfq_decide(uuid, uuid, text, boolean),
  public.rfq_cancel(uuid), public.rfq_list(uuid) from public, anon;
grant execute on function public.po_confirm(uuid, date, text), public.po_order_rest(uuid, uuid, date), public.bill_price_check(uuid),
  public.bill_accept_prices(uuid, text, boolean), public.bill_ask_price_ok(uuid), public.vendor_scorecard(uuid, date, date),
  public.rfq_save(jsonb), public.rfq_send(uuid), public.rfq_offer_save(uuid, jsonb), public.rfq_get(uuid), public.rfq_decide(uuid, uuid, text, boolean),
  public.rfq_cancel(uuid), public.rfq_list(uuid) to authenticated;
