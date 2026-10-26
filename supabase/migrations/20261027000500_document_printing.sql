-- =============================================================================
-- Printing, PDF and email of documents
--   · the company's logo and how its documents look (colour, what to show, texts per document)
--   · document_print(kind, id): everything a printed document needs, in one call
--   · document_email(...): the document as a PDF attachment through the company mailbox
-- =============================================================================

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

alter table public.company_settings
  add column if not exists print_logo text check (print_logo is null or (print_logo like 'data:image/%' and length(print_logo) < 700000)),
  add column if not exists print_settings jsonb not null default '{}'::jsonb;

create or replace function public.print_settings_save(p_company uuid, p_settings jsonb, p_logo text default null, p_clear_logo boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'admin.write');
  if p_logo is not null and (p_logo not like 'data:image/%' or length(p_logo) >= 700000) then
    raise exception 'The logo must be a picture smaller than 500 KB' using errcode = '23514';
  end if;
  update public.company_settings
     set print_settings = coalesce(p_settings, print_settings),
         invoice_footer = coalesce(nullif(p_settings ->> 'footer', ''), case when p_settings ? 'footer' then null else invoice_footer end),
         print_logo = case when p_clear_logo then null else coalesce(p_logo, print_logo) end
   where company_id = p_company;
end $$;

-- the company block every document starts with
create or replace function app.print_company(p_company uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'name', c.name, 'legal_name', c.legal_name, 'tax_number', c.tax_number, 'vat_number', c.vat_number, 'business_number', c.business_number,
    'address', concat_ws(', ', nullif(c.address_line1, ''), nullif(c.address_line2, ''), nullif(concat_ws(' ', c.postal_code, c.city), '')),
    'phone', c.phone, 'email', c.email, 'website', c.website, 'country', c.country_code, 'base_currency', c.base_currency,
    'logo', s.print_logo, 'footer', s.invoice_footer, 'settings', coalesce(s.print_settings, '{}'::jsonb),
    'decimals', coalesce(s.amount_decimals, 2),
    'banks', coalesce((select jsonb_agg(jsonb_build_object('bank', coalesce(b.bank_name, b.name), 'iban', b.iban, 'swift', b.swift, 'currency', b.currency_code) order by b.name)
                         from public.bank_accounts b where b.company_id = c.id and b.account_kind = 'bank' and b.is_active and b.deleted_at is null and b.iban is not null), '[]'::jsonb))
    from public.companies c left join public.company_settings s on s.company_id = c.id where c.id = p_company
$$;

create or replace function app.print_partner(p_partner uuid, p_address uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', bp.name, 'legal_name', bp.legal_name, 'code', bp.code, 'tax_number', bp.tax_number, 'vat_number', bp.vat_number,
    'phone', bp.phone, 'email', bp.email,
    'address', (select concat_ws(', ', nullif(a.line1, ''), nullif(a.line2, ''), nullif(concat_ws(' ', a.postal_code, a.city), ''))
                  from public.partner_addresses a where a.partner_id = bp.id and a.deleted_at is null
                 order by (a.id = p_address) desc, a.is_default desc, a.created_at limit 1))
    from public.business_partners bp where bp.id = p_partner
$$;

-- lines of a priced document, with the VAT summary
create or replace function app.print_lines(p_rows jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('lines', coalesce(p_rows, '[]'::jsonb),
    'vat', coalesce((select jsonb_agg(jsonb_build_object('rate', r, 'base', b, 'tax', x) order by r desc) from (
        select (l ->> 'tax_rate')::numeric r, sum((l ->> 'net')::numeric) b, sum((l ->> 'tax')::numeric) x
          from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) l group by 1) v), '[]'::jsonb))
$$;

create or replace function public.document_print(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; v_co uuid; v_lines jsonb; v_person text;
begin
  if p_kind = 'sales_invoice' then
    select i.company_id into v_co from public.sales_invoices i where i.id = p_id and i.deleted_at is null;
    if v_co is null then raise exception 'Document not found' using errcode = 'P0002'; end if;
    perform app.require_permission(v_co, 'invoicing.read');
    select jsonb_agg(jsonb_build_object('code', v.sku, 'description', l.description, 'uom', u.code, 'qty', l.quantity, 'price', l.unit_price, 'discount', l.discount_pct,
             'tax_rate', l.tax_rate, 'net', l.line_subtotal, 'tax', l.tax_amount, 'total', l.line_total) order by l.line_no)
      into v_lines from public.sales_invoice_lines l left join public.product_variants v on v.id = l.variant_id left join public.units_of_measure u on u.id = l.uom_id
     where l.invoice_id = p_id;
    select jsonb_build_object('kind', case when i.document_type = 'credit_note' then 'credit_note' else 'sales_invoice' end,
             'number', i.number, 'date', i.invoice_date, 'due_date', i.due_date, 'currency', i.currency_code, 'rate', i.exchange_rate, 'status', i.status,
             'notes', i.notes, 'payment_term', (select name from public.payment_terms where id = i.payment_term_id),
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
    select jsonb_agg(jsonb_build_object('code', v.sku, 'description', l.description, 'uom', u.code, 'qty', l.quantity, 'price', l.unit_price, 'discount', l.discount_pct,
             'tax_rate', l.tax_rate, 'net', l.line_subtotal, 'tax', l.tax_amount, 'total', l.line_total) order by l.line_no)
      into v_lines from public.sales_quote_lines l left join public.product_variants v on v.id = l.variant_id left join public.units_of_measure u on u.id = l.uom_id
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
    select jsonb_agg(jsonb_build_object('code', v.sku, 'description', l.description, 'uom', u.code, 'qty', l.quantity, 'price', l.unit_price, 'discount', l.discount_pct,
             'tax_rate', l.tax_rate, 'net', l.line_subtotal, 'tax', l.tax_amount, 'total', l.line_total, 'delivered', l.qty_delivered) order by l.line_no)
      into v_lines from public.sales_order_lines l left join public.product_variants v on v.id = l.variant_id left join public.units_of_measure u on u.id = l.uom_id
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
    select jsonb_agg(jsonb_build_object('code', v.sku, 'description', coalesce(ol.description, v.name), 'uom', u.code, 'qty', l.quantity, 'lot', lt.lot_number,
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
             'description', l.description, 'uom', u.code, 'qty', l.quantity, 'price', l.unit_price, 'discount', l.discount_pct,
             'tax_rate', l.tax_rate, 'net', l.line_subtotal, 'tax', l.tax_amount, 'total', l.line_total, 'expected', l.expected_date) order by l.line_no)
      into v_lines from public.purchase_order_lines l left join public.product_variants v on v.id = l.variant_id left join public.units_of_measure u on u.id = l.uom_id
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
    select jsonb_agg(jsonb_build_object('code', v.sku, 'description', v.name, 'uom', u.code, 'qty', l.quantity, 'lot', lt.lot_number, 'location', loc.code,
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
end $$;

-- =============================================================================
-- Email with the PDF
-- =============================================================================
alter table app.message_outbox add column if not exists attachments jsonb;

select app._patch_function('public.postier_claim',
  $x$'template', u.template, 'company', u.company_id,$x$,
  $x$'template', u.template, 'company', u.company_id, 'attachments', u.attachments,$x$);

create or replace function public.document_email(p_kind text, p_id uuid, p_to text, p_subject text, p_message text, p_pdf text, p_filename text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_co uuid; v_id uuid; v_perm text;
begin
  v := public.document_print(p_kind, p_id);          -- also checks the right to see it
  v_co := case p_kind
    when 'sales_invoice' then (select company_id from public.sales_invoices where id = p_id)
    when 'sales_quote' then (select company_id from public.sales_quotes where id = p_id)
    when 'proforma_quote' then (select company_id from public.sales_quotes where id = p_id)
    when 'sales_order' then (select company_id from public.sales_orders where id = p_id)
    when 'proforma' then (select company_id from public.sales_orders where id = p_id)
    when 'delivery' then (select company_id from public.deliveries where id = p_id)
    when 'payment' then (select company_id from public.payments where id = p_id)
    when 'purchase_order' then (select company_id from public.purchase_orders where id = p_id)
    when 'goods_receipt' then (select company_id from public.goods_receipts where id = p_id) end;
  v_perm := case when p_kind in ('sales_invoice', 'payment') then 'invoicing.write' when p_kind = 'purchase_order' then 'procurement.write'
                 when p_kind = 'goods_receipt' then 'inventory.write' else 'sales.write' end;
  perform app.require_permission(v_co, v_perm);
  if coalesce(btrim(p_to), '') !~ '^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$' then raise exception 'Write a valid email address' using errcode = '22023'; end if;
  if not exists (select 1 from app.mail_accounts where company_id = v_co and is_active) then
    raise exception 'Set up the company mailbox first (Automations › Email)' using errcode = '55000';
  end if;
  if p_pdf is null or length(p_pdf) > 8000000 then raise exception 'The PDF is missing or too large' using errcode = '22023'; end if;
  v_id := app.enqueue_message(v_co, 'email', btrim(p_to), left(coalesce(nullif(btrim(p_subject), ''), v ->> 'number'), 300),
            coalesce(p_message, ''), null, 'document', null, null, p_kind, p_id);
  update app.message_outbox set attachments = jsonb_build_array(jsonb_build_object('name', coalesce(nullif(p_filename, ''), 'document.pdf'),
           'mime', 'application/pdf', 'data', p_pdf)) where id = v_id;
  return v_id;
end $$;

revoke execute on function public.print_settings_save(uuid, jsonb, text, boolean), public.document_print(text, uuid),
  public.document_email(text, uuid, text, text, text, text, text) from public, anon;
grant execute on function public.print_settings_save(uuid, jsonb, text, boolean), public.document_print(text, uuid),
  public.document_email(text, uuid, text, text, text, text, text) to authenticated;

-- the receipt a purchase invoice makes carries its note in Albanian (it is printed on the goods received note)
select app._patch_function('public.purchase_invoice_complete',
  $x$'Purchase invoice ' || coalesce(b.vendor_invoice_number, b.number)$x$,
  $x$'Fatura e blerjes ' || coalesce(b.vendor_invoice_number, b.number)$x$);

drop function app._patch_function(text, text, text);

-- the company block alone, for the preview on the settings page
create or replace function public.print_company_preview(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'admin.read');
  return app.print_company(p_company);
end $$;
revoke execute on function public.print_company_preview(uuid) from public, anon;
grant execute on function public.print_company_preview(uuid) to authenticated;
