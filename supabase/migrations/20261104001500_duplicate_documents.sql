-- =============================================================================
-- DrisPRO · "Dupliko": a new draft with the same lines, from any document
-- The copy keeps the partner, the warehouse, the currency, the terms, the notes and every line (items,
-- quantities, prices, discounts, VAT). It does not keep what belongs to the original alone: its number,
-- status, dates, links to orders, receipts and payments, postings, fiscal codes, what was delivered or
-- received. It is saved through save_document, as the person: what they may not write, they cannot copy.
-- =============================================================================

create or replace function public.duplicate_document(p_table text, p_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_src jsonb; v_children jsonb := '{}'::jsonb; c record; v_rows jsonb; v_id uuid; v_number text;
  -- what belongs to the original alone
  v_drop text[] := array['id', 'number', 'status', 'created_at', 'created_by', 'updated_at', 'updated_by', 'deleted_at', 'deleted_by',
    'posted_at', 'journal_entry_id', 'approved_at', 'sent_at', 'confirmed_at', 'confirmed_by', 'closed_at', 'cancel_reason', 'done_at',
    'shipped_at', 'received_at', 'shipped_by', 'received_by', 'has_difference', 'receive_note', 'cleared_at', 'clearance_status',
    'fiscal_status', 'payment_status', 'invoice_status', 'billing_status', 'amount_paid', 'amount_due', 'match_status', 'match_override_by',
    'match_override_reason', 'price_ok_by', 'price_ok_at', 'price_ok_reason', 'price_ok_prices', 'recurring_id', 'original_invoice_id',
    'original_bill_id', 'sales_order_id', 'purchase_order_id', 'receipt_id', 'quote_id', 'requisition_id', 'follows_id', 'is_opening',
    'due_date', 'valid_until', 'expected_date', 'requested_date', 'receive_date', 'promised_date', 'vendor_fiscal_number',
    'customs_declaration_number', 'customs_declaration_date', 'opportunity_id'];
  v_drop_line text[] := array['id', 'created_at', 'created_by', 'updated_at', 'updated_by', 'qty_reserved', 'qty_delivered', 'qty_invoiced',
    'qty_received', 'qty_billed', 'quantity_done', 'quantity_received', 'difference_action', 'sales_order_line_id', 'delivery_line_id',
    'po_line_id', 'receipt_line_id', 'requisition_line_id', 'advance_invoice_id', 'match_status', 'qty_variance', 'price_variance',
    'capitalized_variance', 'expensed_variance', 'landed_cost_amount', 'qc_status', 'qc_reason'];
  v_date text := case p_table when 'sales_quotes' then 'quote_date' when 'sales_orders' then 'order_date' when 'sales_invoices' then 'invoice_date'
    when 'purchase_orders' then 'order_date' when 'vendor_bills' then 'bill_date' when 'goods_receipts' then 'receipt_date'
    when 'stock_transfers' then 'transfer_date' when 'stock_adjustments' then 'adjustment_date' end;
  k text;
begin
  if v_date is null then raise exception 'This document cannot be duplicated' using errcode = '22023'; end if;
  -- read as the person: a document they cannot see is not found
  execute format('select to_jsonb(d) from public.%I d where d.id = $1 and d.deleted_at is null', p_table) into v_src using p_id;
  if v_src is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  foreach k in array v_drop loop v_src := v_src - k; end loop;
  v_src := v_src || jsonb_build_object(v_date, current_date);
  -- the supplier's number must be new on a bill: the copy says so until it is written
  if p_table = 'vendor_bills' then
    v_src := v_src || jsonb_build_object('vendor_invoice_number', left(coalesce(v_src ->> 'vendor_invoice_number', ''), 40) || ' (kopje ' || to_char(clock_timestamp(), 'HH24MISS') || ')');
  end if;
  for c in select * from app.document_children where parent_table = p_table loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)%s), ''[]'') from public.%I x where x.%I = $1',
                   case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = c.child_table and column_name = 'line_no') then ' order by x.line_no' else '' end,
                   c.child_table, c.fk_column) into v_rows using p_id;
    v_rows := (select coalesce(jsonb_agg((select coalesce(jsonb_object_agg(e.key, e.value), '{}') from jsonb_each(r) e where not (e.key = any (v_drop_line || array[c.fk_column, 'company_id'])))), '[]')
                 from jsonb_array_elements(v_rows) r);
    v_children := v_children || jsonb_build_object(c.child_table, v_rows);
  end loop;
  v_id := public.save_document(p_table, v_src, v_children);
  execute format('select number from public.%I where id = $1', p_table) into v_number using v_id;
  return jsonb_build_object('id', v_id, 'number', v_number, 'href',
    case p_table when 'sales_quotes' then '/sales/quotes/' when 'sales_orders' then '/sales/orders/' when 'sales_invoices' then '/sales/invoices/'
      when 'purchase_orders' then '/procurement/orders/'
      when 'vendor_bills' then case when v_src ->> 'warehouse_id' is not null then '/procurement/invoice/' else '/procurement/bills/' end
      when 'goods_receipts' then '/inventory/receipts/' when 'stock_transfers' then '/inventory/transfers/' when 'stock_adjustments' then '/inventory/adjustments/' end || v_id);
end $$;
revoke execute on function public.duplicate_document(text, uuid) from public, anon;
grant execute on function public.duplicate_document(text, uuid) to authenticated;
