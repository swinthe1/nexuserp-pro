-- =============================================================================
-- DrisPRO · debit notes, for customers and from suppliers
-- A debit note adds to what was invoiced: a price agreed higher, transport or packaging billed later,
-- interest for a late payment. It is an invoice of its own (its own number series ND- / NDF-, its own
-- due date and payments), posted, taxed and shown on the partner's cards like an invoice, and it names
-- the invoice it corrects. A credit note takes away; a debit note adds.
-- =============================================================================

alter table public.sales_invoices add column if not exists is_debit_note boolean not null default false;
alter table public.vendor_bills add column if not exists is_debit_note boolean not null default false;
-- only a credit note or a debit note names an original invoice
alter table public.sales_invoices drop constraint if exists sales_invoices_check1;
alter table public.sales_invoices drop constraint if exists sales_invoices_original_check;
alter table public.sales_invoices add constraint sales_invoices_original_check check (document_type = 'credit_note' or is_debit_note or original_invoice_id is null);
comment on column public.sales_invoices.is_debit_note is 'A debit note to the customer: an invoice that adds to original_invoice_id, numbered in its own series (debit_note).';
comment on column public.vendor_bills.is_debit_note is 'A supplier''s debit note: a bill that adds to original_bill_id, numbered in its own series (vendor_debit).';

insert into public.document_types (key, name, module, table_name, default_prefix) values
  ('debit_note', 'Debit Note', 'invoicing', 'sales_invoices', 'ND-'),
  ('vendor_debit', 'Vendor Debit Note', 'invoicing', 'vendor_bills', 'NDF-')
on conflict (key) do nothing;

-- its own number series; and once made, a debit note stays one
create or replace function app.tg_debit_note()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.is_debit_note is distinct from old.is_debit_note then raise exception 'A debit note stays a debit note' using errcode = '42501'; end if;
    return new;
  end if;
  if new.is_debit_note then
    if tg_table_name = 'sales_invoices' and new.document_type <> 'sales_invoice' or tg_table_name = 'vendor_bills' and new.document_type <> 'vendor_bill' then
      raise exception 'A debit note adds to an invoice; it is not a credit note' using errcode = '22023';
    end if;
    if coalesce(new.number, '') = '' then
      new.number := app.next_document_number(new.company_id, case tg_table_name when 'sales_invoices' then 'debit_note' else 'vendor_debit' end,
        coalesce(case tg_table_name when 'sales_invoices' then (to_jsonb(new) ->> 'invoice_date') else (to_jsonb(new) ->> 'bill_date') end, current_date::text)::date);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_09_debit_note on public.sales_invoices;
create trigger trg_09_debit_note before insert or update of is_debit_note on public.sales_invoices for each row execute function app.tg_debit_note();
drop trigger if exists trg_09_debit_note on public.vendor_bills;
create trigger trg_09_debit_note before insert or update of is_debit_note on public.vendor_bills for each row execute function app.tg_debit_note();

-- ----------------------------------------------------------------------------- making one
-- to the customer, for a posted invoice: a draft for the same customer, terms and currency; the lines
-- are what is added (a price difference, transport, interest)
create or replace function public.create_debit_note(p_invoice uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i public.sales_invoices; v_id uuid;
begin
  select * into i from public.sales_invoices where id = p_invoice and deleted_at is null;
  if i.id is null then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  perform app.require_permission(i.company_id, 'invoicing.write');
  if i.status <> 'posted' or i.document_type <> 'sales_invoice' then
    raise exception 'Debit notes are issued for posted invoices' using errcode = '55000';
  end if;
  insert into public.sales_invoices (company_id, document_type, is_debit_note, partner_id, sales_order_id, original_invoice_id, source, invoice_date, due_date,
                                     currency_code, exchange_rate, payment_term_id, salesperson_id, billing_address_id, notes)
  values (i.company_id, 'sales_invoice', true, i.partner_id, null, i.id, 'manual', current_date,
          current_date + greatest(coalesce(i.due_date - i.invoice_date, 0), 0), i.currency_code, i.exchange_rate, i.payment_term_id, i.salesperson_id,
          i.billing_address_id, 'Notë debiti për faturën ' || i.number)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.create_debit_note(uuid) from public, anon;
grant execute on function public.create_debit_note(uuid) to authenticated;

-- from the supplier, for a posted bill: the supplier's debit note with its own number
create or replace function public.create_vendor_debit(p_bill uuid, p_number text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare b public.vendor_bills; v_id uuid;
begin
  select * into b from public.vendor_bills where id = p_bill and deleted_at is null;
  if b.id is null then raise exception 'Bill not found' using errcode = 'P0002'; end if;
  perform app.require_permission(b.company_id, 'invoicing.write');
  if b.status <> 'posted' or b.document_type <> 'vendor_bill' then
    raise exception 'Debit notes are recorded for posted bills' using errcode = '55000';
  end if;
  if coalesce(btrim(p_number), '') = '' then raise exception 'Write the number of the supplier''s debit note' using errcode = '23514'; end if;
  insert into public.vendor_bills (company_id, document_type, is_debit_note, vendor_id, purchase_order_id, original_bill_id, vendor_invoice_number,
                                   bill_date, due_date, currency_code, exchange_rate, payment_term_id, notes)
  values (b.company_id, 'vendor_bill', true, b.vendor_id, null, b.id, btrim(p_number), current_date,
          current_date + greatest(coalesce(b.due_date - b.bill_date, 0), 0), b.currency_code, b.exchange_rate, b.payment_term_id,
          'Notë debiti e furnitorit për faturën ' || b.number)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function public.create_vendor_debit(uuid, text) from public, anon;
grant execute on function public.create_vendor_debit(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------- on paper and on the cards: "Notë debiti"
create or replace function public.document_print(p_kind text, p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb; v_co uuid; v_lines jsonb; v_person text;
begin
  if p_kind = 'sales_invoice' then
    select i.company_id into v_co from public.sales_invoices i where i.id = p_id and i.deleted_at is null;
    if v_co is null then raise exception 'Document not found' using errcode = 'P0002'; end if;
    perform app.require_permission(v_co, 'invoicing.read');
    select jsonb_agg(jsonb_build_object('code', v.sku, 'description', l.description, 'uom', u.code, 'qty', l.quantity, 'pack', app.pack_text(l.variant_id, l.quantity, l.pack_id), 'price', l.unit_price, 'discount', l.discount_pct,
             'tax_rate', l.tax_rate, 'net', l.line_subtotal, 'tax', l.tax_amount, 'total', l.line_total) order by l.line_no)
      into v_lines from public.sales_invoice_lines l left join public.product_variants v on v.id = l.variant_id left join public.units_of_measure u on u.id = coalesce(l.uom_id, (select pp.uom_id from public.product_variants vv join public.products pp on pp.id = vv.product_id where vv.id = l.variant_id))
     where l.invoice_id = p_id;
    select jsonb_build_object('kind', case when i.document_type = 'credit_note' then 'credit_note' when i.is_debit_note then 'debit_note' when i.is_advance then 'advance_invoice' else 'sales_invoice' end,
             'number', i.number, 'date', i.invoice_date, 'due_date', i.due_date, 'currency', i.currency_code, 'rate', i.exchange_rate, 'status', i.status,
             'notes', i.notes, 'payment_term', (select name from public.payment_terms where id = i.payment_term_id),
             'instalments', (select jsonb_agg(jsonb_build_object('due_date', di.due_date, 'amount', di.amount) order by di.seq) from public.document_instalments di where di.sales_invoice_id = i.id),
             'salesperson', (select full_name from public.profiles where id = i.salesperson_id),
             'order', (select number from public.sales_orders where id = i.sales_order_id),
             'original', (select number from public.sales_invoices o where o.id = i.original_invoice_id),
             'subtotal', i.subtotal, 'discount_total', i.discount_total, 'tax_total', i.tax_total, 'total', i.total, 'total_base', i.total_base,
             'paid', i.amount_paid, 'due', i.amount_due, 'partner_id', i.partner_id,
             'partner', app.print_partner(i.partner_id, i.billing_address_id),
             'fiscal', (select jsonb_build_object('iic', f.iic, 'fic', f.fic, 'tcr', f.tcr_code, 'business_unit', f.business_unit_code, 'operator', f.operator_code, 'qr_url', f.qr_url)
                          from public.fiscalization_records f where f.source_doc_id = i.id and f.fic is not null order by f.created_at desc limit 1))
           || app.print_lines(v_lines)
      into v from public.sales_invoices i where i.id = p_id;

  elsif p_kind in ('sales_quote', 'proforma_quote') then
    select q.company_id into v_co from public.sales_quotes q where q.id = p_id and q.deleted_at is null;
    if v_co is null then raise exception 'Document not found' using errcode = 'P0002'; end if;
    perform app.require_permission(v_co, 'sales.read');
    select jsonb_agg(jsonb_build_object('code', v.sku, 'description', l.description, 'uom', u.code, 'qty', l.quantity, 'pack', app.pack_text(l.variant_id, l.quantity, l.pack_id), 'price', l.unit_price, 'discount', l.discount_pct,
             'tax_rate', l.tax_rate, 'net', l.line_subtotal, 'tax', l.tax_amount, 'total', l.line_total) order by l.line_no)
      into v_lines from public.sales_quote_lines l left join public.product_variants v on v.id = l.variant_id left join public.units_of_measure u on u.id = coalesce(l.uom_id, (select pp.uom_id from public.product_variants vv join public.products pp on pp.id = vv.product_id where vv.id = l.variant_id))
     where l.quote_id = p_id;
    select jsonb_build_object('kind', case when p_kind = 'proforma_quote' then 'proforma' else 'sales_quote' end,
             'number', q.number, 'date', q.quote_date, 'valid_until', q.valid_until, 'currency', q.currency_code, 'rate', q.exchange_rate, 'status', q.status,
             'notes', q.notes, 'terms', q.terms, 'payment_term', (select name from public.payment_terms where id = q.payment_term_id),
             'salesperson', (select full_name from public.profiles where id = q.salesperson_id),
             'subtotal', q.subtotal, 'discount_total', q.discount_total, 'tax_total', q.tax_total, 'total', q.total, 'total_base', q.total_base, 'partner_id', q.partner_id,
             'partner', app.print_partner(q.partner_id, q.billing_address_id)) || app.print_lines(v_lines)
      into v from public.sales_quotes q where q.id = p_id;

  elsif p_kind in ('sales_order', 'proforma') then
    select o.company_id into v_co from public.sales_orders o where o.id = p_id and o.deleted_at is null;
    if v_co is null then raise exception 'Document not found' using errcode = 'P0002'; end if;
    perform app.require_permission(v_co, 'sales.read');
    select jsonb_agg(jsonb_build_object('code', v.sku, 'description', l.description, 'uom', u.code, 'qty', l.quantity, 'pack', app.pack_text(l.variant_id, l.quantity, l.pack_id), 'price', l.unit_price, 'discount', l.discount_pct,
             'tax_rate', l.tax_rate, 'net', l.line_subtotal, 'tax', l.tax_amount, 'total', l.line_total, 'delivered', l.qty_delivered) order by l.line_no)
      into v_lines from public.sales_order_lines l left join public.product_variants v on v.id = l.variant_id left join public.units_of_measure u on u.id = coalesce(l.uom_id, (select pp.uom_id from public.product_variants vv join public.products pp on pp.id = vv.product_id where vv.id = l.variant_id))
     where l.sales_order_id = p_id;
    select jsonb_build_object('kind', p_kind, 'number', o.number, 'date', o.order_date, 'requested_date', o.requested_date, 'currency', o.currency_code, 'rate', o.exchange_rate,
             'status', o.status, 'notes', o.notes, 'reference', o.customer_reference, 'payment_term', (select name from public.payment_terms where id = o.payment_term_id),
             'salesperson', (select full_name from public.profiles where id = o.salesperson_id),
             'subtotal', o.subtotal, 'discount_total', o.discount_total, 'tax_total', o.tax_total, 'total', o.total, 'total_base', o.total_base, 'partner_id', o.partner_id,
             'partner', app.print_partner(o.partner_id, o.billing_address_id), 'ship_to', app.print_partner(o.partner_id, o.shipping_address_id) -> 'address')
           || app.print_lines(v_lines)
      into v from public.sales_orders o where o.id = p_id;

  elsif p_kind = 'delivery' then
    select d.company_id into v_co from public.deliveries d where d.id = p_id and d.deleted_at is null;
    if v_co is null then raise exception 'Document not found' using errcode = 'P0002'; end if;
    perform app.require_permission(v_co, 'sales.read');
    -- a delivery note shows the order's prices when the company wants them (print settings)
    select jsonb_agg(jsonb_build_object('code', v.sku, 'description', coalesce(ol.description, v.name), 'uom', u.code, 'qty', l.quantity, 'pack', app.pack_text(l.variant_id, l.quantity, null), 'lot', lt.lot_number,
             'price', ol.unit_price, 'discount', ol.discount_pct, 'tax_rate', coalesce(ol.tax_rate, 0),
             'net', round(l.quantity * coalesce(ol.unit_price, 0) * (1 - coalesce(ol.discount_pct, 0) / 100), 2),
             'tax', round(l.quantity * coalesce(ol.unit_price, 0) * (1 - coalesce(ol.discount_pct, 0) / 100) * coalesce(ol.tax_rate, 0) / 100, 2),
             'total', round(l.quantity * coalesce(ol.unit_price, 0) * (1 - coalesce(ol.discount_pct, 0) / 100) * (1 + coalesce(ol.tax_rate, 0) / 100), 2))
             order by coalesce(ol.line_no, 0), l.created_at)
      into v_lines from public.delivery_lines l join public.product_variants v on v.id = l.variant_id
      join public.products p on p.id = v.product_id left join public.units_of_measure u on u.id = p.uom_id
      left join public.sales_order_lines ol on ol.id = l.sales_order_line_id left join public.lots lt on lt.id = l.lot_id
     where l.delivery_id = p_id;
    select jsonb_build_object('kind', 'delivery', 'number', d.number, 'date', coalesce(d.done_at::date, d.scheduled_date), 'status', d.status,
             'currency', coalesce(o.currency_code, (select base_currency from public.companies where id = d.company_id)),
             'order', o.number, 'reference', o.customer_reference, 'notes', d.notes, 'warehouse', (select name from public.warehouses where id = d.warehouse_id),
             'carrier', coalesce(d.carrier_name, (select name from public.carriers where id = d.carrier_id)), 'tracking', d.tracking_number,
             'packages', d.package_count, 'weight', d.shipping_weight_kg, 'partner_id', d.partner_id,
             'partner', app.print_partner(d.partner_id, d.shipping_address_id))
           || app.print_lines(v_lines)
      into v from public.deliveries d left join public.sales_orders o on o.id = d.sales_order_id where d.id = p_id;
    v := v || jsonb_build_object('subtotal', (select coalesce(sum((l ->> 'net')::numeric), 0) from jsonb_array_elements(v -> 'lines') l),
                                 'tax_total', (select coalesce(sum((l ->> 'tax')::numeric), 0) from jsonb_array_elements(v -> 'lines') l),
                                 'total', (select coalesce(sum((l ->> 'total')::numeric), 0) from jsonb_array_elements(v -> 'lines') l));

  elsif p_kind = 'payment' then
    select y.company_id into v_co from public.payments y where y.id = p_id and y.deleted_at is null;
    if v_co is null then raise exception 'Document not found' using errcode = 'P0002'; end if;
    perform app.require_permission(v_co, 'invoicing.read');
    select jsonb_build_object('kind', case when y.document_type = 'customer_payment' then 'receipt_voucher' else 'payment_voucher' end,
             'number', y.number, 'date', y.payment_date, 'currency', y.currency_code, 'rate', y.exchange_rate, 'status', y.status,
             'method', y.method, 'reference', y.reference, 'notes', y.notes, 'total', y.amount, 'total_base', y.amount_base, 'unallocated', y.unallocated,
             'account', (select concat_ws(' · ', b.name, b.iban) from public.bank_accounts b where b.id = y.bank_account_id),
             'cash', (select b.account_kind = 'cash' from public.bank_accounts b where b.id = y.bank_account_id),
             'by', (select full_name from public.profiles where id = y.created_by), 'partner_id', y.partner_id,
             'partner', app.print_partner(y.partner_id),
             'allocations', coalesce((select jsonb_agg(jsonb_build_object('number', coalesce(i.number, b.number), 'reference', b.vendor_invoice_number,
                               'date', coalesce(i.invoice_date, b.bill_date), 'amount', a.amount) order by coalesce(i.invoice_date, b.bill_date))
                              from public.payment_allocations a left join public.sales_invoices i on i.id = a.sales_invoice_id
                              left join public.vendor_bills b on b.id = a.vendor_bill_id where a.payment_id = y.id), '[]'::jsonb),
             'lines', '[]'::jsonb, 'vat', '[]'::jsonb)
      into v from public.payments y where y.id = p_id;

  elsif p_kind = 'purchase_order' then
    select o.company_id into v_co from public.purchase_orders o where o.id = p_id and o.deleted_at is null;
    if v_co is null then raise exception 'Document not found' using errcode = 'P0002'; end if;
    perform app.require_permission(v_co, 'procurement.read');
    select jsonb_agg(jsonb_build_object('code', coalesce((select vp.vendor_sku from public.vendor_products vp where vp.variant_id = l.variant_id
                     and vp.vendor_id = (select vendor_id from public.purchase_orders where id = p_id) and vp.deleted_at is null limit 1), v.sku),
             'description', l.description, 'uom', u.code, 'qty', l.quantity, 'pack', app.pack_text(l.variant_id, l.quantity, l.pack_id), 'price', l.unit_price, 'discount', l.discount_pct,
             'tax_rate', l.tax_rate, 'net', l.line_subtotal, 'tax', l.tax_amount, 'total', l.line_total, 'expected', l.expected_date) order by l.line_no)
      into v_lines from public.purchase_order_lines l left join public.product_variants v on v.id = l.variant_id left join public.units_of_measure u on u.id = coalesce(l.uom_id, (select pp.uom_id from public.product_variants vv join public.products pp on pp.id = vv.product_id where vv.id = l.variant_id))
     where l.purchase_order_id = p_id;
    select jsonb_build_object('kind', 'purchase_order', 'number', o.number, 'date', o.order_date, 'expected_date', o.expected_date, 'currency', o.currency_code,
             'rate', o.exchange_rate, 'status', o.status, 'notes', o.notes, 'reference', o.vendor_reference, 'incoterm', o.incoterm,
             'payment_term', (select name from public.payment_terms where id = o.payment_term_id),
             'buyer', (select full_name from public.profiles where id = o.buyer_id),
             'deliver_to', (select concat_ws(', ', w.name, nullif(w.address_line1, ''), nullif(w.city, '')) from public.warehouses w where w.id = o.warehouse_id),
             'subtotal', o.subtotal, 'discount_total', o.discount_total, 'tax_total', o.tax_total, 'total', o.total, 'total_base', o.total_base, 'partner_id', o.vendor_id,
             'partner', app.print_partner(o.vendor_id)) || app.print_lines(v_lines)
      into v from public.purchase_orders o where o.id = p_id;

  elsif p_kind = 'goods_receipt' then
    select r.company_id into v_co from public.goods_receipts r where r.id = p_id and r.deleted_at is null;
    if v_co is null then raise exception 'Document not found' using errcode = 'P0002'; end if;
    perform app.require_permission(v_co, 'inventory.read');
    select jsonb_agg(jsonb_build_object('code', v.sku, 'description', v.name, 'uom', u.code, 'qty', l.quantity, 'pack', app.pack_text(l.variant_id, l.quantity, null), 'lot', lt.lot_number, 'location', loc.code,
             'price', coalesce(l.unit_cost, l.unit_price), 'discount', 0, 'tax_rate', 0,
             'net', round(l.quantity * coalesce(l.unit_cost, l.unit_price, 0), 2), 'tax', 0, 'total', round(l.quantity * coalesce(l.unit_cost, l.unit_price, 0), 2))
             order by l.created_at, l.id)
      into v_lines from public.goods_receipt_lines l join public.product_variants v on v.id = l.variant_id join public.products p on p.id = v.product_id
      left join public.units_of_measure u on u.id = p.uom_id left join public.lots lt on lt.id = l.lot_id left join public.warehouse_locations loc on loc.id = l.location_id
     where l.receipt_id = p_id and l.qc_status <> 'rejected';
    select jsonb_build_object('kind', 'goods_receipt', 'number', r.number, 'date', r.receipt_date, 'status', r.status,
             'currency', (select base_currency from public.companies where id = r.company_id), 'notes', r.notes, 'reference', r.vendor_delivery_note,
             'order', (select number from public.purchase_orders where id = r.purchase_order_id), 'receipt_type', r.receipt_type,
             'warehouse', (select name from public.warehouses where id = r.warehouse_id),
             'by', (select full_name from public.profiles where id = coalesce(r.received_by, r.created_by)), 'partner_id', r.vendor_id,
             'partner', case when r.vendor_id is not null then app.print_partner(r.vendor_id) end, 'subtotal', r.total_value, 'tax_total', 0, 'total', r.total_value)
           || app.print_lines(v_lines)
      into v from public.goods_receipts r where r.id = p_id;
  else
    raise exception 'Unknown document kind %', p_kind using errcode = '22023';
  end if;

  select full_name into v_person from public.profiles where id = auth.uid();
  return v || jsonb_build_object('company', app.print_company(v_co), 'printed_by', v_person, 'printed_at', now());
end $function$;

create or replace function public.partner_card(p_partner uuid, p_side text, p_from date, p_to date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare bp public.business_partners; v_acc uuid[]; v_open numeric; v_rows jsonb;
begin
  select * into bp from public.business_partners where id = p_partner;
  if bp.id is null then raise exception 'Customer or vendor not found' using errcode = 'P0002'; end if;
  perform app.require_permission(bp.company_id, 'invoicing.read');
  if p_side not in ('customer', 'vendor') then raise exception 'Choose customer or supplier side' using errcode = '22023'; end if;
  v_acc := app.partner_side_accounts(p_partner, p_side);
  -- balance as the partner owes it: customer debit-positive, supplier credit-positive
  select coalesce(sum(jl.debit - jl.credit), 0) into v_open
    from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
   where jl.company_id = bp.company_id and jl.partner_id = p_partner and jl.account_id = any (v_acc)
     and e.status in ('posted', 'reversed') and e.entry_date < p_from;
  select coalesce(jsonb_agg(r order by (r ->> 'date'), (r ->> 'seq')::bigint), '[]'::jsonb) into v_rows from (
    select jsonb_build_object('date', e.entry_date, 'entry', e.number, 'source_type', case when i.is_debit_note then 'debit_note' when b.is_debit_note then 'vendor_debit' else e.source_doc_type end, 'source_id', e.source_doc_id,
             'document', coalesce(i.number, b.number, y.number, c.number, e.reference, e.number),
             'reference', coalesce(b.vendor_invoice_number, y.reference, i.notes),
             'memo', e.memo, 'due', coalesce(i.due_date, b.due_date),
             'debit', sum(jl.debit), 'credit', sum(jl.credit),
             'balance', v_open + sum(sum(jl.debit - jl.credit)) over (order by e.entry_date, min(e.created_at), e.id),
             'seq', extract(epoch from min(e.created_at))::bigint) r
      from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
      left join public.sales_invoices i on e.source_doc_type in ('sales_invoice','credit_note') and i.id = e.source_doc_id
      left join public.vendor_bills b on e.source_doc_type in ('vendor_bill','vendor_credit') and b.id = e.source_doc_id
      left join public.payments y on e.source_doc_type in ('customer_payment','vendor_payment') and y.id = e.source_doc_id
      left join public.compensations c on e.source_doc_type = 'compensation' and c.id = e.source_doc_id
     where jl.company_id = bp.company_id and jl.partner_id = p_partner and jl.account_id = any (v_acc)
       and e.status in ('posted', 'reversed') and e.entry_date between p_from and p_to
     group by e.id, e.entry_date, e.number, e.source_doc_type, e.source_doc_id, e.reference, e.memo, i.number, b.number, y.number, c.number, i.is_debit_note, b.is_debit_note,
              b.vendor_invoice_number, y.reference, i.notes, i.due_date, b.due_date) t;
  return jsonb_build_object('side', p_side, 'from', p_from, 'to', p_to, 'opening', v_open,
    'debit', (select coalesce(sum((r ->> 'debit')::numeric), 0) from jsonb_array_elements(v_rows) r),
    'credit', (select coalesce(sum((r ->> 'credit')::numeric), 0) from jsonb_array_elements(v_rows) r),
    'closing', v_open + (select coalesce(sum((r ->> 'debit')::numeric - (r ->> 'credit')::numeric), 0) from jsonb_array_elements(v_rows) r),
    'rows', v_rows, 'partner', app.print_partner(p_partner), 'partner_id', p_partner, 'currency', (select base_currency from public.companies where id = bp.company_id),
    'company', app.print_company(bp.company_id), 'printed_by', (select full_name from public.profiles where id = auth.uid()), 'printed_at', now());
end $function$;

create or replace function public.open_items_statement(p_partner uuid, p_side text, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare bp public.business_partners; v_rows jsonb;
begin
  select * into bp from public.business_partners where id = p_partner;
  if bp.id is null then raise exception 'Customer or vendor not found' using errcode = 'P0002'; end if;
  perform app.require_permission(bp.company_id, 'invoicing.read');
  select coalesce(jsonb_agg(jsonb_build_object('kind', case when o.kind = 'invoice' and (exists (select 1 from public.sales_invoices x where x.id = o.id and x.is_debit_note) or exists (select 1 from public.vendor_bills x where x.id = o.id and x.is_debit_note)) then 'debit_note' else o.kind end, 'id', o.id, 'number', o.number, 'reference', o.reference, 'date', o.doc_date, 'due', o.due_date,
           'currency', o.currency, 'total', o.total, 'open', round(o.open, 2), 'late', o.due_date < p_date) order by o.doc_date, o.number), '[]'::jsonb)
    into v_rows from app.open_items(p_partner, p_side, p_date) o where abs(o.open) >= 0.005;
  return jsonb_build_object('side', p_side, 'date', p_date, 'rows', v_rows,
    'totals', coalesce((select jsonb_object_agg(cur, s) from (select r ->> 'currency' cur, sum((r ->> 'open')::numeric) s from jsonb_array_elements(v_rows) r group by 1) t), '{}'::jsonb),
    'partner', app.print_partner(p_partner), 'partner_id', p_partner, 'currency', (select base_currency from public.companies where id = bp.company_id),
    'company', app.print_company(bp.company_id), 'printed_by', (select full_name from public.profiles where id = auth.uid()), 'printed_at', now());
end $function$;
