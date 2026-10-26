-- =============================================================================
-- The purchase invoice that brings the goods in (the "kalkulim" of the old programs)
--
-- One document: the supplier's invoice, line by line with two discounts, received into a
-- warehouse at its cost, with the new selling price set on the same screen, and paid at once
-- when it was paid in cash. Completing it makes and posts the goods receipt, posts the bill
-- (goods against GRNI), changes the selling prices and, when asked, records the payment.
-- =============================================================================

alter table public.vendor_bills
  add column if not exists warehouse_id uuid,
  add column if not exists receipt_id uuid,
  add column if not exists vendor_fiscal_number text,
  add column if not exists receive_date date,
  add column if not exists pay_bank_account_id uuid;
alter table public.vendor_bills drop constraint if exists vendor_bills_warehouse_fk;
alter table public.vendor_bills add constraint vendor_bills_warehouse_fk foreign key (company_id, warehouse_id) references public.warehouses(company_id, id);
alter table public.vendor_bills drop constraint if exists vendor_bills_receipt_fk;
alter table public.vendor_bills add constraint vendor_bills_receipt_fk foreign key (company_id, receipt_id) references public.goods_receipts(company_id, id);

alter table public.vendor_bill_lines
  add column if not exists discount1_pct numeric(7,4),
  add column if not exists discount2_pct numeric(7,4),
  add column if not exists sales_price_new numeric(18,4) check (sales_price_new is null or sales_price_new >= 0),
  add column if not exists lot_number text,
  add column if not exists expiry_date date;

-- two discounts one after the other: 10 % and then 5 % is 14.5 %
create or replace function app.tg_bill_line_discounts()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.discount1_pct is not null or new.discount2_pct is not null then
    if coalesce(new.discount1_pct, 0) not between 0 and 100 or coalesce(new.discount2_pct, 0) not between 0 and 100 then
      raise exception 'A discount is between 0 and 100' using errcode = '23514';
    end if;
    new.discount_pct := round(100 - (100 - coalesce(new.discount1_pct, 0)) * (100 - coalesce(new.discount2_pct, 0)) / 100, 4);
  end if;
  return new;
end $$;
drop trigger if exists trg_04_discounts on public.vendor_bill_lines;
create trigger trg_04_discounts before insert or update on public.vendor_bill_lines for each row execute function app.tg_bill_line_discounts();

-- what the screen shows next to each item: cost now, the selling price, the last price from this supplier
create or replace function public.purchase_item_info(p_company uuid, p_vendor uuid, p_variants uuid[], p_warehouse uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'invoicing.read');
  if coalesce(array_length(p_variants, 1), 0) > 500 then raise exception 'At most 500 items at once' using errcode = '54000'; end if;
  return coalesce((select jsonb_object_agg(v.id, jsonb_build_object(
      'avg_cost', coalesce(ic.avg_cost, v.standard_cost, 0),
      'sales_net', coalesce(v.sales_price_override, p.sales_price, 0),
      'sales_tax', coalesce(st.rate, 0),
      'purchase_tax_code_id', p.purchase_tax_code_id,
      'tracking', p.tracking, 'track_expiry', p.track_expiry, 'stockable', p.product_type = 'stockable',
      'uom', (select u.code from public.units_of_measure u where u.id = p.uom_id),
      'stock', (select coalesce(sum(sl.on_hand), 0) from public.stock_levels sl where sl.variant_id = v.id and (p_warehouse is null or sl.warehouse_id = p_warehouse)),
      'last', (select jsonb_build_object('price', bl.unit_price, 'discount', bl.discount_pct, 'date', b.bill_date, 'currency', b.currency_code)
                 from public.vendor_bill_lines bl join public.vendor_bills b on b.id = bl.bill_id
                where bl.variant_id = v.id and b.vendor_id = p_vendor and b.status = 'posted' and b.document_type = 'vendor_bill' and b.deleted_at is null
                order by b.bill_date desc, b.created_at desc limit 1)))
    from public.product_variants v join public.products p on p.id = v.product_id
    left join public.item_costs ic on ic.variant_id = v.id
    left join public.tax_codes st on st.id = p.sales_tax_code_id
   where v.company_id = p_company and v.id = any (p_variants)), '{}'::jsonb);
end $$;

-- Complete: receive, post, set prices, pay
create or replace function public.purchase_invoice_complete(p_bill uuid, p_override_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  b public.vendor_bills; l record; v_gr uuid; v_gl uuid; v_loc uuid; v_lot uuid; v_prices int := 0; v_single boolean; v_post jsonb;
  v_pay uuid; v_pay_status text; v_cur_net numeric; v_lines int := 0;
begin
  select * into b from public.vendor_bills where id = p_bill for update;
  if b.id is null then raise exception 'Bill not found' using errcode = 'P0002'; end if;
  perform app.require_permission(b.company_id, 'invoicing.write');
  if b.status <> 'draft' then raise exception 'Only a draft can be completed (this one is %)', b.status using errcode = '55000'; end if;
  if b.document_type <> 'vendor_bill' then raise exception 'Credit notes are completed from the bill page' using errcode = '55000'; end if;
  if b.purchase_order_id is not null then raise exception 'This bill belongs to an order: the goods come in with the order''s receipt' using errcode = '55000'; end if;
  if b.warehouse_id is null then raise exception 'Choose the warehouse the goods go into' using errcode = '23514'; end if;
  if not exists (select 1 from public.vendor_bill_lines where bill_id = b.id) then raise exception 'Add at least one line' using errcode = '23514'; end if;
  if exists (select 1 from public.vendor_bill_lines where bill_id = b.id and quantity <= 0) then raise exception 'Quantity must be more than zero' using errcode = '23514'; end if;

  -- the goods (stockable items) go into the warehouse at the price after discounts
  if exists (select 1 from public.vendor_bill_lines bl join public.product_variants v on v.id = bl.variant_id join public.products p on p.id = v.product_id
              where bl.bill_id = b.id and p.product_type = 'stockable') then
    perform app.require_permission(b.company_id, 'wms.write');
    v_loc := app.main_location(b.warehouse_id);
    if v_loc is null then raise exception 'The warehouse has no stock location' using errcode = '23514'; end if;
    insert into public.goods_receipts (company_id, receipt_type, vendor_id, warehouse_id, receipt_date, vendor_delivery_note, currency_code, exchange_rate, notes)
    values (b.company_id, 'purchase', b.vendor_id, b.warehouse_id, coalesce(b.receive_date, b.bill_date), b.vendor_invoice_number, b.currency_code, b.exchange_rate,
            'Purchase invoice ' || coalesce(b.vendor_invoice_number, b.number))
    returning id into v_gr;
    for l in select bl.*, p.tracking, p.track_expiry, p.name as pname from public.vendor_bill_lines bl
               join public.product_variants v on v.id = bl.variant_id join public.products p on p.id = v.product_id
              where bl.bill_id = b.id and p.product_type = 'stockable' order by bl.line_no loop
      v_lot := null;
      if l.tracking in ('lot','serial') then
        if nullif(btrim(l.lot_number), '') is null then raise exception 'Line %: % needs a lot number', l.line_no, l.pname using errcode = '23514'; end if;
        if l.track_expiry and l.expiry_date is null then raise exception 'Line %: % needs an expiry date', l.line_no, l.pname using errcode = '23514'; end if;
        select id into v_lot from public.lots where company_id = b.company_id and variant_id = l.variant_id and lot_number = btrim(l.lot_number) and deleted_at is null;
        if v_lot is null then
          insert into public.lots (company_id, variant_id, lot_number, lot_type, expiry_date, vendor_id)
          values (b.company_id, l.variant_id, btrim(l.lot_number), case when l.tracking = 'serial' then 'serial' else 'lot' end, l.expiry_date, b.vendor_id)
          returning id into v_lot;
        end if;
      end if;
      insert into public.goods_receipt_lines (company_id, receipt_id, variant_id, lot_id, location_id, quantity, unit_price)
      values (b.company_id, v_gr, l.variant_id, v_lot, v_loc, l.quantity, round(l.unit_price * (1 - l.discount_pct / 100), 6))
      returning id into v_gl;
      update public.vendor_bill_lines set receipt_line_id = v_gl where id = l.id;
      v_lines := v_lines + 1;
    end loop;
    perform public.post_goods_receipt(v_gr);
    update public.vendor_bills set receipt_id = v_gr where id = b.id;
  end if;

  v_post := public.post_vendor_bill(b.id, p_override_reason);

  -- the new selling prices (net of VAT), as on the price page: the variant's own price or the product's
  for l in select bl.variant_id, bl.sales_price_new, v.product_id, v.sales_price_override, p.sales_price
             from public.vendor_bill_lines bl join public.product_variants v on v.id = bl.variant_id join public.products p on p.id = v.product_id
            where bl.bill_id = b.id and bl.sales_price_new is not null loop
    v_cur_net := coalesce(l.sales_price_override, l.sales_price);
    continue when round(v_cur_net, 4) = round(l.sales_price_new, 4);
    perform app.require_permission(b.company_id, 'inventory.write');
    select count(*) = 1 into v_single from public.product_variants where product_id = l.product_id and deleted_at is null;
    if l.sales_price_override is not null and not v_single then
      update public.product_variants set sales_price_override = l.sales_price_new where id = l.variant_id;
    else
      update public.products set sales_price = l.sales_price_new where id = l.product_id;
      if l.sales_price_override is not null then update public.product_variants set sales_price_override = null where id = l.variant_id; end if;
    end if;
    -- a pending suggestion for the same item is settled by this
    update public.price_suggestions set status = 'accepted', decided_by = auth.uid(), decided_at = now(), price_new = l.sales_price_new, updated_at = now()
     where variant_id = l.variant_id and status = 'pending';
    v_prices := v_prices + 1;
  end loop;

  -- paid at once (cash from a till/safe, or the bank)
  select * into b from public.vendor_bills where id = b.id;
  if b.pay_bank_account_id is not null and b.status = 'posted' and b.amount_due > 0 then
    insert into public.payments (company_id, document_type, partner_id, payment_date, method, amount, currency_code, exchange_rate, bank_account_id, reference)
    values (b.company_id, 'vendor_payment', b.vendor_id, b.bill_date,
            case when exists (select 1 from public.bank_accounts where id = b.pay_bank_account_id and account_kind = 'cash') then 'cash' else 'bank_transfer' end,
            b.amount_due, b.currency_code, b.exchange_rate, b.pay_bank_account_id, coalesce(b.vendor_invoice_number, b.number))
    returning id into v_pay;
    insert into public.payment_allocations (company_id, payment_id, vendor_bill_id, amount) values (b.company_id, v_pay, b.id, b.amount_due);
    v_pay_status := public.post_payment(v_pay);
  end if;

  select * into b from public.vendor_bills where id = b.id;
  return jsonb_build_object('status', b.status, 'number', b.number, 'receipt_id', v_gr, 'receipt', (select number from public.goods_receipts where id = v_gr),
                            'lines_received', v_lines, 'prices_changed', v_prices, 'payment_id', v_pay, 'payment_status', v_pay_status);
end $$;

revoke execute on function public.purchase_item_info(uuid, uuid, uuid[], uuid), public.purchase_invoice_complete(uuid, text) from public, anon;
grant execute on function public.purchase_item_info(uuid, uuid, uuid[], uuid), public.purchase_invoice_complete(uuid, text) to authenticated;
