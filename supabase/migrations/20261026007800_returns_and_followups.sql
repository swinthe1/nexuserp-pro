-- =============================================================================
-- DrisPRO · follow-ups of the review
--   · goods back to the vendor: from a posted purchase receipt, the chosen quantities leave stock
--     (Dr GRNI / Cr inventory at the cost they came in at); the order expects them again; a credit
--     note for exactly those goods is prepared and clears GRNI when posted
--   · a bill from a receipt made without an order (by hand or read with AI): its lines point at the
--     receipt, so posting it clears goods received not invoiced
--   · offline sales moved into the next shift (the shift was closed from another device) remember
--     where they were sold, and the managers are told once
-- =============================================================================

alter table public.vendor_bill_lines add column if not exists is_return boolean not null default false;

insert into public.document_types (key, name, module, table_name, default_prefix)
values ('vendor_return', 'Return to vendor', 'inventory', 'vendor_returns', 'KTH-')
on conflict (key) do nothing;
insert into public.status_transitions (doc_type, from_status, to_status) values ('vendor_return', '__init__', 'posted') on conflict do nothing;

create table public.vendor_returns (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id),
  number            text not null,
  status            text not null default 'posted',
  receipt_id        uuid not null,
  vendor_id         uuid,
  purchase_order_id uuid,
  warehouse_id      uuid not null,
  return_date       date not null,
  reason            text not null,
  total_cost        numeric(18,2) not null default 0,
  vendor_credit_id  uuid,
  foreign key (company_id, receipt_id)        references public.goods_receipts(company_id, id),
  foreign key (company_id, vendor_id)         references public.business_partners(company_id, id),
  foreign key (company_id, purchase_order_id) references public.purchase_orders(company_id, id),
  foreign key (company_id, vendor_credit_id)  references public.vendor_bills(company_id, id)
);
select app.register_table('public.vendor_returns', 'inventory', p_soft_delete => false, p_client_write => false);
select app.register_document('public.vendor_returns', 'vendor_return', 'return_date');

create table public.vendor_return_lines (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null,
  return_id       uuid not null,
  receipt_line_id uuid not null,
  po_line_id      uuid,
  variant_id      uuid not null,
  lot_id          uuid,
  location_id     uuid not null,
  quantity        numeric(18,4) not null check (quantity > 0),
  unit_cost       numeric(18,6) not null,
  foreign key (company_id, return_id) references public.vendor_returns(company_id, id) on delete cascade
);
select app.register_table('public.vendor_return_lines', 'inventory', p_soft_delete => false, p_client_write => false, p_immutable => true);

-- p_lines: [{receipt_line_id, quantity}]
create or replace function public.return_to_vendor(p_receipt uuid, p_lines jsonb, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.goods_receipts; x jsonb; l record; v_id uuid; v_qty numeric; v_left numeric; v_sup uuid; v_total numeric := 0; v_number text; n int := 0;
begin
  select * into r from public.goods_receipts where id = p_receipt for update;
  if r.id is null then raise exception 'Receipt not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'inventory.write');
  if r.status <> 'done' or r.receipt_type <> 'purchase' then raise exception 'Only posted purchase receipts can be returned' using errcode = '55000'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Say why the goods go back' using errcode = '23514'; end if;
  insert into public.vendor_returns (company_id, receipt_id, vendor_id, purchase_order_id, warehouse_id, return_date, reason)
  values (r.company_id, r.id, coalesce(r.vendor_id, (select vendor_id from public.purchase_orders where id = r.purchase_order_id)),
          r.purchase_order_id, r.warehouse_id, (now() at time zone coalesce((select timezone from public.companies where id = r.company_id), 'Europe/Belgrade'))::date,
          btrim(p_reason))
  returning id, number into v_id, v_number;
  v_sup := app.virtual_location(r.company_id, 'supplier');
  for x in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_qty := round(coalesce((x ->> 'quantity')::numeric, 0), 4);
    continue when v_qty <= 0;
    select gl.* into l from public.goods_receipt_lines gl where gl.id = (x ->> 'receipt_line_id')::uuid and gl.receipt_id = r.id;
    if l.id is null then raise exception 'A line is not on this receipt' using errcode = '23514'; end if;
    v_left := l.quantity - coalesce((select sum(rl.quantity) from public.vendor_return_lines rl where rl.receipt_line_id = l.id), 0);
    if v_qty > v_left then raise exception 'Only % of this item can still go back', trim_scale(v_left) using errcode = '23514'; end if;
    -- out at the cost it came in at, so the vendor's credit clears exactly what the receipt booked
    perform app.post_stock_move(r.company_id, 'purchase_return', l.variant_id, l.location_id, v_sup, v_qty, l.unit_cost, l.lot_id,
                                'vendor_return', v_id, l.id, v_number, now());
    insert into public.vendor_return_lines (company_id, return_id, receipt_line_id, po_line_id, variant_id, lot_id, location_id, quantity, unit_cost)
    values (r.company_id, v_id, l.id, l.po_line_id, l.variant_id, l.lot_id, l.location_id, v_qty, l.unit_cost);
    if l.po_line_id is not null then
      update public.purchase_order_lines set qty_received = greatest(qty_received - v_qty, 0) where id = l.po_line_id;
    end if;
    v_total := v_total + round(v_qty * l.unit_cost, 2);
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Choose what goes back' using errcode = '23514'; end if;
  update public.vendor_returns set total_cost = v_total where id = v_id;
  if r.purchase_order_id is not null then
    update public.purchase_orders set status = 'partially_received'
     where id = r.purchase_order_id and status in ('received','closed')
       and exists (select 1 from public.purchase_order_lines where purchase_order_id = r.purchase_order_id and qty_received < quantity);
  end if;
  return v_id;
end $$;
revoke execute on function public.return_to_vendor(uuid, jsonb, text) from public, anon;
grant execute on function public.return_to_vendor(uuid, jsonb, text) to authenticated;

-- the vendor's credit for exactly the goods that went back (a draft to check against the vendor's own credit note)
create or replace function public.vendor_credit_from_return(p_return uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v public.vendor_returns; v_bill public.vendor_bills; v_cn uuid; v_cur text; v_rate numeric := 1;
begin
  select * into v from public.vendor_returns where id = p_return for update;
  if v.id is null then raise exception 'Return not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v.company_id, 'invoicing.write');
  if v.vendor_credit_id is not null then return v.vendor_credit_id; end if;
  if v.vendor_id is null then raise exception 'The receipt has no vendor' using errcode = '23514'; end if;
  -- the bill these goods were on, when there is one
  select b.* into v_bill from public.vendor_bills b
   where b.company_id = v.company_id and b.document_type = 'vendor_bill' and b.status = 'posted' and b.deleted_at is null
     and exists (select 1 from public.vendor_bill_lines bl join public.vendor_return_lines rl on (rl.po_line_id is not null and rl.po_line_id = bl.po_line_id)
                                                                                           or rl.receipt_line_id = bl.receipt_line_id
                  where bl.bill_id = b.id and rl.return_id = v.id)
   order by b.bill_date desc limit 1;
  select coalesce(v_bill.currency_code, gr.currency_code), coalesce(v_bill.exchange_rate, gr.exchange_rate, 1) into v_cur, v_rate
    from public.goods_receipts gr where gr.id = v.receipt_id;
  insert into public.vendor_bills (company_id, document_type, vendor_id, purchase_order_id, original_bill_id, vendor_invoice_number,
                                   bill_date, due_date, currency_code, exchange_rate, notes)
  values (v.company_id, 'vendor_credit', v.vendor_id, v.purchase_order_id, v_bill.id, v.number,
          current_date, current_date, v_cur, v_rate, 'Goods returned: ' || v.number || ' · ' || v.reason)
  returning id into v_cn;
  insert into public.vendor_bill_lines (company_id, bill_id, line_no, po_line_id, receipt_line_id, variant_id, description, quantity,
                                        unit_price, discount_pct, tax_code_id, is_return)
  select v.company_id, v_cn, row_number() over (order by rl.id), rl.po_line_id, rl.receipt_line_id, rl.variant_id, pv.name, rl.quantity,
         coalesce(pl.unit_price, gl.unit_price, round(rl.unit_cost / nullif(v_rate, 0), 4)), coalesce(pl.discount_pct, 0),
         coalesce(pl.tax_code_id, p.purchase_tax_code_id), true
    from public.vendor_return_lines rl
    join public.product_variants pv on pv.id = rl.variant_id join public.products p on p.id = pv.product_id
    join public.goods_receipt_lines gl on gl.id = rl.receipt_line_id
    left join public.purchase_order_lines pl on pl.id = rl.po_line_id
   where rl.return_id = v.id;
  update public.vendor_returns set vendor_credit_id = v_cn where id = v.id;
  return v_cn;
end $$;
revoke execute on function public.vendor_credit_from_return(uuid) from public, anon;
grant execute on function public.vendor_credit_from_return(uuid) to authenticated;

-- a bill for a receipt made without an order
create or replace function public.create_bill_from_receipt(p_receipt uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.goods_receipts; v_bill uuid; v_days int;
begin
  select * into r from public.goods_receipts where id = p_receipt;
  if r.id is null then raise exception 'Receipt not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'invoicing.write');
  if r.status <> 'done' or r.receipt_type <> 'purchase' then raise exception 'Only posted purchase receipts are billed' using errcode = '55000'; end if;
  if r.purchase_order_id is not null then raise exception 'This receipt belongs to an order: bill the order' using errcode = '55000'; end if;
  if r.vendor_id is null then raise exception 'The receipt has no vendor' using errcode = '23514'; end if;
  if exists (select 1 from public.vendor_bill_lines bl join public.goods_receipt_lines gl on gl.id = bl.receipt_line_id
              join public.vendor_bills b on b.id = bl.bill_id
              where gl.receipt_id = r.id and b.deleted_at is null and b.status <> 'cancelled' and b.document_type = 'vendor_bill') then
    raise exception 'This receipt already has a bill' using errcode = '23505';
  end if;
  select coalesce(t.due_days, 0) into v_days from public.business_partners bp left join public.payment_terms t on t.id = bp.payment_term_id where bp.id = r.vendor_id;
  insert into public.vendor_bills (company_id, vendor_id, vendor_invoice_number, bill_date, due_date, currency_code, exchange_rate, payment_term_id, notes)
  values (r.company_id, r.vendor_id, coalesce(nullif(r.vendor_delivery_note, ''), r.number), r.receipt_date, r.receipt_date + coalesce(v_days, 0),
          r.currency_code, r.exchange_rate, (select payment_term_id from public.business_partners where id = r.vendor_id), 'Bill for ' || r.number)
  returning id into v_bill;
  insert into public.vendor_bill_lines (company_id, bill_id, line_no, receipt_line_id, variant_id, description, quantity, unit_price, tax_code_id)
  select r.company_id, v_bill, row_number() over (order by gl.created_at, gl.id), gl.id, gl.variant_id, pv.name, gl.quantity,
         coalesce(gl.unit_price, round(gl.unit_cost / nullif(r.exchange_rate, 0), 4)), p.purchase_tax_code_id
    from public.goods_receipt_lines gl join public.product_variants pv on pv.id = gl.variant_id join public.products p on p.id = pv.product_id
   where gl.receipt_id = r.id;
  return v_bill;
end $$;
revoke execute on function public.create_bill_from_receipt(uuid) from public, anon;
grant execute on function public.create_bill_from_receipt(uuid) to authenticated;

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- a credit for goods that went back: they leave the bill (the order may be billed for them again
-- once they come back) and clear GRNI, which the return debited
select app._patch_function('public.post_vendor_bill',
  $x$    if v_sign = 1 then
      update public.purchase_order_lines set qty_billed = qty_billed + l.quantity where id = l.po_line_id;
    end if;$x$,
  $x$    if v_sign = 1 then
      update public.purchase_order_lines set qty_billed = qty_billed + l.quantity where id = l.po_line_id;
    elsif l.is_return then
      update public.purchase_order_lines set qty_billed = greatest(qty_billed - l.quantity, 0) where id = l.po_line_id;
    end if;$x$);
select app._patch_function('app.gl_vendor_bill',
  $x$    if s = -1 and l.product_type = 'stockable' and l.account_id is null then$x$,
  $x$    if s = -1 and l.product_type = 'stockable' and l.account_id is null and not l.is_return then$x$);

-- offline sales that land in the next shift
alter table public.pos_orders add column if not exists moved_from_session_id uuid;
select app._patch_function('public.pos_submit_order',
  $x$  perform app.pos_cash_limit_notice(v_id, v_cash - greatest(v_change, 0));$x$,
  $x$  perform app.pos_cash_limit_notice(v_id, v_cash - greatest(v_change, 0));
  if nullif(p ->> 'moved_from_session_id', '') is not null and (p ->> 'moved_from_session_id')::uuid <> s.id then
    update public.pos_orders set moved_from_session_id = (p ->> 'moved_from_session_id')::uuid where id = v_id;
    if not exists (select 1 from public.pos_orders where session_id = s.id and moved_from_session_id = (p ->> 'moved_from_session_id')::uuid and id <> v_id) then
      perform app.notify_permission(s.company_id, 'pos.approve', 'info',
        'Offline sales of shift ' || coalesce((select number from public.pos_sessions where id = (p ->> 'moved_from_session_id')::uuid), '') || ' went into shift ' || s.number,
        'That shift was closed before they were sent: its count is short by them and this shift is over by them.', '/pos/sessions/' || s.id);
    end if;
  end if;$x$);

drop function app._patch_function(text, text, text);
