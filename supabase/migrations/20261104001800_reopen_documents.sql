-- =============================================================================
-- DrisPRO · "Rihape për ndryshim": a completed invoice back to a draft, to correct and complete again
-- Only a manager may do it, with a reason. Nothing is erased: the accounting entry is reversed with a
-- reversing entry, the goods that came in with a purchase invoice go back out at the cost they came
-- in at, and the invoice keeps its number. The history says who reopened it, when and why; completing
-- it again books it anew. It is refused when the invoice can no longer change without harm:
--   · it is paid (in part) — reverse the payment first
--   · it has a credit or debit note, or a compensation
--   · its month is closed, or its VAT is declared
--   · a sales invoice that was fiscalized, or that came from an order; a purchase bill of an order
--     (those are corrected with a credit note)
--   · goods of a purchase invoice already returned to the supplier or given landed costs
-- =============================================================================

-- the status flow lets a reopen through, and only a reopen (the id it names, in this transaction)
create or replace function app.tg_status_flow()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_type text := coalesce(to_jsonb(new) ->> 'document_type', tg_argv[0]);
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.status_transitions
                    where doc_type = v_type and from_status = '__init__' and to_status = new.status) then
      raise exception 'Invalid initial status "%" for %', new.status, v_type using errcode = '23514';
    end if;
  elsif new.status is distinct from old.status then
    if not exists (select 1 from public.status_transitions
                    where doc_type = v_type and from_status = old.status and to_status = new.status)
       and position(new.id::text in coalesce(current_setting('app.reopen_ids', true), '')) = 0 then
      raise exception 'Invalid status transition for %: % -> %', v_type, old.status, new.status using errcode = '23514';
    end if;
    insert into public.entity_activities (company_id, entity_type, entity_id, activity_type, title, metadata)
    values (new.company_id, tg_table_name, new.id, 'status_change',
            initcap(replace(old.status, '_', ' ')) || ' → ' || initcap(replace(new.status, '_', ' ')),
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;
  return new;
end $$;

-- the checks both kinds share: who, why, the month, the VAT
create or replace function app.reopen_guard(p_company uuid, p_date date, p_reason text)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_period text; v_decl text;
begin
  if not (app.has_permission(p_company, 'invoicing.approve') or app.has_permission(p_company, 'finance.approve')) then
    raise exception 'Only a finance manager can reopen a completed invoice' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Write why it is reopened' using errcode = '23514'; end if;
  select status into v_period from public.fiscal_periods where company_id = p_company and p_date between start_date and end_date;
  if v_period is distinct from 'open' then raise exception 'The month of this invoice is closed; correct it with a credit note' using errcode = '55000'; end if;
  select d.number into v_decl from public.vat_declarations d
   where d.company_id = p_company and d.deleted_at is null and d.status in ('submitted', 'accepted') and p_date between d.period_start and d.period_end;
  if v_decl is not null then raise exception 'The VAT of this month is declared (%); correct it with a credit note', v_decl using errcode = '55000'; end if;
end $$;
revoke execute on function app.reopen_guard(uuid, date, text) from public, anon, authenticated;

-- ----------------------------------------------------------------------------- a purchase invoice or a vendor bill
create or replace function public.reopen_vendor_bill(p_bill uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.vendor_bills; r public.goods_receipts; l record; v_sup uuid; v_rev uuid; v_mv uuid; v_diff numeric;
begin
  select * into b from public.vendor_bills where id = p_bill and deleted_at is null for update;
  if b.id is null then raise exception 'Bill not found' using errcode = 'P0002'; end if;
  perform app.require_permission(b.company_id, 'invoicing.write');
  if b.status <> 'posted' then raise exception 'Only a completed invoice is reopened; this one is %', b.status using errcode = '55000'; end if;
  if b.document_type <> 'vendor_bill' then raise exception 'A credit note is not reopened; cancel it with a new document' using errcode = '55000'; end if;
  if b.purchase_order_id is not null then raise exception 'A bill of a purchase order is corrected with a credit note' using errcode = '55000'; end if;
  if coalesce(b.is_opening, false) then raise exception 'An opening balance is changed in the opening balances' using errcode = '55000'; end if;
  perform app.reopen_guard(b.company_id, b.bill_date, p_reason);
  if b.amount_paid > 0.004 or exists (select 1 from public.payment_allocations a join public.payments y on y.id = a.payment_id
                                       where a.vendor_bill_id = b.id and y.status = 'posted' and y.deleted_at is null) then
    raise exception 'It is paid: reverse the payment first, then reopen it' using errcode = '55000';
  end if;
  if exists (select 1 from public.vendor_bills c where c.original_bill_id = b.id and c.status <> 'cancelled' and c.deleted_at is null) then
    raise exception 'It has a credit or debit note; correct it with those' using errcode = '55000';
  end if;
  if exists (select 1 from public.compensation_lines where vendor_bill_id = b.id) then
    raise exception 'It is in a compensation; correct it with a credit note' using errcode = '55000';
  end if;
  perform set_config('app.reopen_ids', concat_ws(',', b.id::text, b.receipt_id::text), true);

  -- the goods go back out of the warehouse at the cost they came in at
  if b.receipt_id is not null then
    select * into r from public.goods_receipts where id = b.receipt_id for update;
    if exists (select 1 from public.vendor_returns where receipt_id = r.id) then
      raise exception 'Some of these goods were returned to the supplier; correct the invoice with a credit note' using errcode = '55000';
    end if;
    if exists (select 1 from public.landed_cost_receipts where receipt_id = r.id) then
      raise exception 'These goods have landed costs on them; remove those first' using errcode = '55000';
    end if;
    perform app.require_permission(b.company_id, 'wms.write');
    v_sup := app.virtual_location(b.company_id, 'supplier');
    for l in select * from public.goods_receipt_lines where receipt_id = r.id and quantity > 0 loop
      -- out at the average (as every issue goes), then the difference to the cost it came in at, so the
      -- average and the stock value are what they were before the invoice
      v_mv := app.post_stock_move(b.company_id, 'purchase_return', l.variant_id, l.location_id, v_sup, l.quantity, l.unit_cost, l.lot_id,
                                  'goods_receipt', r.id, l.id, r.number, now());
      v_diff := round((l.unit_cost - (select unit_cost from public.stock_movements where id = v_mv)) * l.quantity, 2);
      if v_diff <> 0 then perform app.post_price_variance(b.company_id, l.variant_id, l.location_id, -v_diff, b.id, null, b.number, now()); end if;
    end loop;
    update public.vendor_bill_lines set receipt_line_id = null where bill_id = b.id;
    update public.goods_receipts set status = 'cancelled', notes = concat_ws(E'\n', notes, 'Anuluar: fatura ' || b.number || ' u rihap për ndryshim') where id = r.id;
  end if;

  -- the accounting entry is reversed (today, or on its own date if later), the invoice is a draft again
  if b.journal_entry_id is not null then
    v_rev := app.gl_reverse(b.journal_entry_id, current_date, 'Rihapje e faturës ' || b.number || ': ' || btrim(p_reason));
  end if;
  delete from public.document_instalments where vendor_bill_id = b.id;
  update public.vendor_bills set status = 'draft', journal_entry_id = null, posted_at = null, receipt_id = null, payment_status = 'unpaid',
         notes = concat_ws(E'\n', notes, 'Rihapur për ndryshim më ' || to_char(now(), 'DD.MM.YYYY HH24:MI') || ': ' || btrim(p_reason))
   where id = b.id;
  insert into public.entity_activities (company_id, entity_type, entity_id, activity_type, title, metadata)
  values (b.company_id, 'vendor_bills', b.id, 'system', 'Rihapur për ndryshim: ' || btrim(p_reason),
          jsonb_build_object('kind', 'reopened', 'reason', btrim(p_reason), 'by', auth.uid(), 'reversal_entry', v_rev, 'receipt_cancelled', b.receipt_id, 'total_before', b.total));
  return jsonb_build_object('id', b.id, 'href', case when b.warehouse_id is not null then '/procurement/invoice/' else '/procurement/bills/' end || b.id);
end $$;
revoke execute on function public.reopen_vendor_bill(uuid, text) from public, anon;
grant execute on function public.reopen_vendor_bill(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------- a sales invoice (not fiscalized, not of an order)
create or replace function public.reopen_sales_invoice(p_invoice uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare i public.sales_invoices; v_rev uuid;
begin
  select * into i from public.sales_invoices where id = p_invoice and deleted_at is null for update;
  if i.id is null then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  perform app.require_permission(i.company_id, 'invoicing.write');
  if i.status <> 'posted' then raise exception 'Only a completed invoice is reopened; this one is %', i.status using errcode = '55000'; end if;
  if i.document_type <> 'sales_invoice' then raise exception 'A credit note is not reopened; cancel it with a new document' using errcode = '55000'; end if;
  if i.sales_order_id is not null or exists (select 1 from public.sales_invoice_lines where invoice_id = i.id and (sales_order_line_id is not null or delivery_line_id is not null)) then
    raise exception 'An invoice of an order is corrected with a credit note' using errcode = '55000';
  end if;
  if i.fiscal_status in ('pending', 'fiscalized') or exists (select 1 from public.fiscalization_records where source_doc_id = i.id) then
    raise exception 'A fiscalized invoice cannot be changed; correct it with a credit note' using errcode = '55000';
  end if;
  if coalesce(i.is_opening, false) or coalesce(i.is_advance, false) then raise exception 'This invoice is corrected with a credit note' using errcode = '55000'; end if;
  perform app.reopen_guard(i.company_id, i.invoice_date, p_reason);
  if i.amount_paid > 0.004 or exists (select 1 from public.payment_allocations a join public.payments y on y.id = a.payment_id
                                       where a.sales_invoice_id = i.id and y.status = 'posted' and y.deleted_at is null) then
    raise exception 'It is paid: reverse the payment first, then reopen it' using errcode = '55000';
  end if;
  if exists (select 1 from public.sales_invoices c where c.original_invoice_id = i.id and c.status <> 'cancelled' and c.deleted_at is null) then
    raise exception 'It has a credit or debit note; correct it with those' using errcode = '55000';
  end if;
  if exists (select 1 from public.compensation_lines where sales_invoice_id = i.id) or exists (select 1 from public.pos_orders where sales_invoice_id = i.id) then
    raise exception 'It is tied to a compensation or a till receipt; correct it with a credit note' using errcode = '55000';
  end if;
  perform set_config('app.reopen_ids', i.id::text, true);
  if i.journal_entry_id is not null then
    v_rev := app.gl_reverse(i.journal_entry_id, current_date, 'Rihapje e faturës ' || i.number || ': ' || btrim(p_reason));
  end if;
  delete from public.document_instalments where sales_invoice_id = i.id;
  update public.sales_invoices set status = 'draft', journal_entry_id = null, posted_at = null, payment_status = 'unpaid',
         notes = concat_ws(E'\n', notes, 'Rihapur për ndryshim më ' || to_char(now(), 'DD.MM.YYYY HH24:MI') || ': ' || btrim(p_reason))
   where id = i.id;
  insert into public.entity_activities (company_id, entity_type, entity_id, activity_type, title, metadata)
  values (i.company_id, 'sales_invoices', i.id, 'system', 'Rihapur për ndryshim: ' || btrim(p_reason),
          jsonb_build_object('kind', 'reopened', 'reason', btrim(p_reason), 'by', auth.uid(), 'reversal_entry', v_rev, 'total_before', i.total));
  return jsonb_build_object('id', i.id, 'href', '/sales/invoices/' || i.id);
end $$;
revoke execute on function public.reopen_sales_invoice(uuid, text) from public, anon;
grant execute on function public.reopen_sales_invoice(uuid, text) to authenticated;
