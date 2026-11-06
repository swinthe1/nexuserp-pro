-- =============================================================================
-- Detailed purchases and sales (as the accountants know them from LogMicro), with advanced filters.
--
-- purchase_detail(company, p): by_item · detailed (per document) · by_vendor · lines · lines_landed
-- sales_detail(company, p):    by_item (with margin) · detailed · by_customer · lines · by_unit · by_person ·
--                              by_category · by_day · by_hour
--
-- Every option the accountant may want is there, used or not:
--  · the price of a line before and after discounts, each of the two discounts on its own
--  · import costs on the lines as they were recorded, or spread again by value, quantity, weight, volume or
--    in equal parts (for comparison; the books keep what was recorded)
--  · till receipts line by line, or one total a day per till (as in the VAT book)
--  · amounts in euro or in the currency of the document
-- The filters (p): from, to, units[], partners[], partner_tags[], items[], categories[] (an item's category or
-- its parent group), brands[], doc_types[], vat_book (all/in/out), vat_rates[], payment[] (paid, partially_paid,
-- unpaid, overdue), people[], min_total, max_total, min_qty, max_qty, currency (base/doc), landed_basis,
-- source (all/invoices/till), till_mode (lines/daily). A person who works in some units sees only theirs.
-- =============================================================================

create or replace function app.detail_ids(p jsonb, k text) returns uuid[] language sql immutable as $$
  select coalesce(array(select jsonb_array_elements_text(coalesce(p -> k, '[]'))::uuid), '{}') $$;
create or replace function app.detail_texts(p jsonb, k text) returns text[] language sql immutable as $$
  select coalesce(array(select jsonb_array_elements_text(coalesce(p -> k, '[]'))), '{}') $$;
create or replace function app.detail_nums(p jsonb, k text) returns numeric[] language sql immutable as $$
  select coalesce(array(select (jsonb_array_elements_text(coalesce(p -> k, '[]')))::numeric), '{}') $$;

-- the units a person may report on, within those asked for
create or replace function app.detail_units(p_company uuid, p jsonb) returns uuid[] language plpgsql stable security definer set search_path = '' as $$
declare v_asked uuid[] := app.detail_ids(p, 'units'); v_mine uuid[] := public.my_warehouse_access(p_company);
begin
  if v_mine is null then return v_asked; end if;
  if cardinality(v_asked) = 0 then return v_mine; end if;
  return array(select unnest(v_asked) intersect select unnest(v_mine));
end $$;

-- ---------------------------------------------------------------------------------------------------- purchases
create or replace function public.purchase_detail(p_company uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_report text := coalesce(nullif(p ->> 'report', ''), 'by_item');
  v_from date := coalesce(nullif(p ->> 'from', '')::date, date_trunc('month', current_date)::date);
  v_to date := coalesce(nullif(p ->> 'to', '')::date, current_date);
  v_units uuid[] := app.detail_units(p_company, p);
  v_restricted boolean := public.my_warehouse_access(p_company) is not null;
  v_partners uuid[] := app.detail_ids(p, 'partners'); v_ptags text[] := app.detail_texts(p, 'partner_tags');
  v_items uuid[] := app.detail_ids(p, 'items'); v_cats uuid[] := app.detail_ids(p, 'categories'); v_brands text[] := app.detail_texts(p, 'brands');
  v_types text[] := app.detail_texts(p, 'doc_types'); v_book text := coalesce(nullif(p ->> 'vat_book', ''), 'all');
  v_rates numeric[] := app.detail_nums(p, 'vat_rates'); v_pay text[] := app.detail_texts(p, 'payment'); v_people uuid[] := app.detail_ids(p, 'people');
  v_min numeric := nullif(p ->> 'min_total', '')::numeric; v_max numeric := nullif(p ->> 'max_total', '')::numeric;
  v_minq numeric := nullif(p ->> 'min_qty', '')::numeric; v_maxq numeric := nullif(p ->> 'max_qty', '')::numeric;
  v_doc_cur boolean := coalesce(p ->> 'currency', 'base') = 'doc';
  v_basis text := coalesce(nullif(p ->> 'landed_basis', ''), 'recorded');
  v_limit int := least(coalesce((p ->> 'limit')::int, 20000), 50000);
  v_rows jsonb; v_count int;
begin
  if not (app.has_permission(p_company, 'procurement.read') or app.has_permission(p_company, 'invoicing.read')) then
    raise exception 'You do not have permission to see the purchases' using errcode = '42501';
  end if;
  if v_report not in ('by_item', 'detailed', 'by_vendor', 'lines', 'lines_landed') then raise exception 'Unknown report: %', v_report using errcode = '22023'; end if;
  if v_basis not in ('recorded', 'value', 'quantity', 'weight', 'volume', 'equal') then raise exception 'Unknown way to spread the import costs: %', v_basis using errcode = '22023'; end if;
  if v_to < v_from then raise exception 'Check the dates' using errcode = '22023'; end if;
  if v_to - v_from > 1100 then raise exception 'At most three years at once' using errcode = '22023'; end if;
  if v_restricted and cardinality(v_units) = 0 then return jsonb_build_object('rows', '[]'::jsonb, 'count', 0, 'truncated', false); end if;

  create temp table if not exists pg_temp.pd_docs (id uuid primary key, sign int, kind text, rate numeric) on commit drop;
  truncate pg_temp.pd_docs;
  -- the documents in play
  insert into pg_temp.pd_docs
  select b.id, case when b.document_type = 'vendor_credit' then -1 else 1 end,
         case when b.document_type = 'vendor_credit' then 'credit' when b.is_debit_note then 'debit'
              when exists (select 1 from public.goods_receipts gr where gr.id = b.receipt_id and gr.is_import) then 'import' else 'bill' end,
         case when v_doc_cur then 1 else coalesce(b.exchange_rate, 1) end
    from public.vendor_bills b
    left join public.business_partners bp on bp.id = b.vendor_id
   where b.company_id = p_company and b.status = 'posted' and b.deleted_at is null and not coalesce(b.is_opening, false)
     and b.bill_date between v_from and v_to
     and (cardinality(v_units) = 0 or b.warehouse_id = any (v_units))
     and (cardinality(v_partners) = 0 or b.vendor_id = any (v_partners))
     and (cardinality(v_ptags) = 0 or coalesce(bp.tags, '{}') && v_ptags)
     and (v_book = 'all' or (v_book = 'in') = b.in_vat_book)
     and (cardinality(v_people) = 0 or b.created_by = any (v_people))
     and (cardinality(v_pay) = 0 or b.payment_status = any (v_pay) or ('overdue' = any (v_pay) and b.amount_due > 0 and b.due_date < current_date))
     and (v_min is null or b.total_base >= v_min) and (v_max is null or b.total_base <= v_max);
  if cardinality(v_types) > 0 then delete from pg_temp.pd_docs where not (kind = any (v_types)); end if;

  if v_report in ('detailed', 'by_vendor') then
    with d as (
      select b.*, x.sign, x.kind, x.rate, bp.name as vendor, bp.tax_number, w.name as unit,
             (select count(*) from public.vendor_bill_lines l where l.bill_id = b.id) as lines
        from pg_temp.pd_docs x join public.vendor_bills b on b.id = x.id
        left join public.business_partners bp on bp.id = b.vendor_id
        left join public.warehouses w on w.id = b.warehouse_id
       -- the line filters narrow the documents too: a document with such a line
       where (cardinality(v_items) + cardinality(v_cats) + cardinality(v_brands) + cardinality(v_rates) = 0 or exists (
               select 1 from public.vendor_bill_lines l
                 left join public.product_variants v on v.id = l.variant_id left join public.products pr on pr.id = v.product_id
                 left join public.product_categories c on c.id = pr.category_id
                where l.bill_id = b.id
                  and (cardinality(v_items) = 0 or l.variant_id = any (v_items))
                  and (cardinality(v_cats) = 0 or pr.category_id = any (v_cats) or c.parent_id = any (v_cats))
                  and (cardinality(v_brands) = 0 or pr.brand = any (v_brands))
                  and (cardinality(v_rates) = 0 or coalesce(l.tax_rate, 0) = any (v_rates)))))
    select count(*)::int,
           case when v_report = 'detailed' then
             coalesce((select jsonb_agg(r order by r ->> 'date', r ->> 'number') from (
               select jsonb_build_object('id', d.id, 'date', d.bill_date, 'number', d.number, 'vendor_invoice', d.vendor_invoice_number, 'vendor', d.vendor,
                        'tax_number', d.tax_number, 'unit', d.unit, 'type', d.kind, 'in_vat_book', d.in_vat_book, 'due_date', d.due_date,
                        'currency', case when v_doc_cur then d.currency_code else (select base_currency from public.companies where id = p_company) end,
                        'net', round(d.sign * d.subtotal * d.rate, 2), 'vat', round(d.sign * d.tax_total * d.rate, 2), 'gross', round(d.sign * d.total * d.rate, 2),
                        'discount', round(d.sign * coalesce(d.discount_total, 0) * d.rate, 2),
                        'paid', round(d.sign * d.amount_paid * d.rate, 2), 'due', round(d.sign * d.amount_due * d.rate, 2),
                        'payment_status', case when d.amount_due > 0 and d.due_date < current_date then 'overdue' else d.payment_status end, 'lines', d.lines) r
                 from d order by d.bill_date, d.number limit v_limit + 1) q), '[]')
           else
             coalesce((select jsonb_agg(r order by (r ->> 'gross')::numeric desc) from (
               select jsonb_build_object('id', vendor_id, 'vendor', max(vendor), 'tax_number', max(tax_number), 'documents', count(*),
                        'net', round(sum(sign * subtotal * rate), 2), 'vat', round(sum(sign * tax_total * rate), 2), 'gross', round(sum(sign * total * rate), 2),
                        'paid', round(sum(sign * amount_paid * rate), 2), 'due', round(sum(sign * amount_due * rate), 2),
                        'share', round(100 * sum(sign * total * rate) / nullif(sum(sum(sign * total * rate)) over (), 0), 1),
                        'last_date', max(bill_date)) r
                 from d group by vendor_id order by sum(sign * total * rate) desc limit v_limit + 1) q), '[]') end
      into v_count, v_rows
      from d;
  else
    -- the lines, with the import costs on them
    with l as (
      select x.sign, x.kind, x.rate, b.id as bill_id, b.number, b.bill_date, b.vendor_invoice_number, b.vendor_id, b.warehouse_id, b.currency_code,
             bp.name as vendor, bp.tax_number, w.name as unit, ln.id as line_id, ln.line_no, ln.variant_id, ln.description, ln.receipt_line_id,
             v.sku, coalesce(v.name, ln.description) as item, pr.brand, pr.weight_kg as p_weight, v.weight_kg as v_weight, pr.volume_m3,
             c.name as category, u.code as uom,
             ln.quantity, ln.unit_price, coalesce(ln.discount1_pct, 0) as d1, coalesce(ln.discount2_pct, 0) as d2, coalesce(ln.discount_pct, 0) as dsc,
             ln.line_subtotal, ln.tax_rate, ln.tax_amount, ln.line_total
        from pg_temp.pd_docs x join public.vendor_bills b on b.id = x.id
        join public.vendor_bill_lines ln on ln.bill_id = b.id
        left join public.business_partners bp on bp.id = b.vendor_id
        left join public.warehouses w on w.id = b.warehouse_id
        left join public.product_variants v on v.id = ln.variant_id
        left join public.products pr on pr.id = v.product_id
        left join public.product_categories c on c.id = pr.category_id
        left join public.units_of_measure u on u.id = coalesce(ln.uom_id, pr.uom_id)
       where (cardinality(v_items) = 0 or ln.variant_id = any (v_items))
         and (cardinality(v_cats) = 0 or pr.category_id = any (v_cats) or c.parent_id = any (v_cats))
         and (cardinality(v_brands) = 0 or pr.brand = any (v_brands))
         and (cardinality(v_rates) = 0 or coalesce(ln.tax_rate, 0) = any (v_rates))
         and (v_minq is null or ln.quantity >= v_minq) and (v_maxq is null or ln.quantity <= v_maxq)),
    -- each import cost, spread over its receipt lines: as recorded, or again by the basis asked for
    lc_lines as (
      select lc.id as lc_id, lc.total_amount, rl.id as receipt_line_id, rl.quantity,
             case v_basis when 'value' then rl.quantity * rl.unit_cost when 'quantity' then rl.quantity
                          when 'weight' then rl.quantity * coalesce(v.weight_kg, pr.weight_kg, 0) when 'volume' then rl.quantity * coalesce(pr.volume_m3, 0)
                          else 1 end as w
        from public.landed_costs lc
        join public.landed_cost_receipts lr on lr.landed_cost_id = lc.id
        join public.goods_receipt_lines rl on rl.receipt_id = lr.receipt_id
        left join public.product_variants v on v.id = rl.variant_id left join public.products pr on pr.id = v.product_id
       where lc.company_id = p_company and lc.status = 'posted' and lc.deleted_at is null and v_report = 'lines_landed' and v_basis <> 'recorded'
         and rl.receipt_id in (select gr.id from public.goods_receipts gr join public.vendor_bills b on b.receipt_id = gr.id where b.id in (select id from pg_temp.pd_docs)
                               union select rl2.receipt_id from public.goods_receipt_lines rl2 join l on l.receipt_line_id = rl2.id)),
    landed as (
      select receipt_line_id, sum(amount) as amount, max(qty) as qty from (
        select a.receipt_line_id, a.allocated_amount as amount, rl.quantity as qty
          from public.landed_cost_allocations a join public.landed_costs lc on lc.id = a.landed_cost_id and lc.status = 'posted' and lc.deleted_at is null
          join public.goods_receipt_lines rl on rl.id = a.receipt_line_id
         where a.company_id = p_company and v_report = 'lines_landed' and v_basis = 'recorded' and a.receipt_line_id in (select receipt_line_id from l)
        union all
        select receipt_line_id, total_amount * w / nullif(sum(w) over (partition by lc_id), 0), quantity from lc_lines) s
       group by receipt_line_id),
    r as (
      select l.*, round(l.sign * l.line_subtotal * l.rate, 2) as net, round(l.sign * l.tax_amount * l.rate, 2) as vat,
             round(l.sign * l.line_total * l.rate, 2) as gross,
             round(l.unit_price * l.rate, 4) as price_list, round(l.line_subtotal * l.rate / nullif(l.quantity, 0), 4) as price_net,
             -- the import cost of this bill line: its share of what was put on the receipt line it came from
             round(coalesce(ld.amount * least(l.quantity / nullif(ld.qty, 0), 1), 0) * l.sign, 2) as landed
        from l left join landed ld on ld.receipt_line_id = l.receipt_line_id)
    select count(*)::int,
           case when v_report = 'by_item' then
             coalesce((select jsonb_agg(q order by (q ->> 'net')::numeric desc) from (
               select jsonb_build_object('id', variant_id, 'code', max(sku), 'item', max(item), 'category', max(category), 'brand', max(brand), 'uom', max(uom),
                        'qty', round(sum(sign * quantity), 3), 'net', sum(net), 'vat', sum(vat), 'gross', sum(gross),
                        'avg_price', round(sum(net) / nullif(sum(sign * quantity), 0), 4),
                        'min_price', min(price_net) filter (where sign > 0), 'max_price', max(price_net) filter (where sign > 0),
                        'documents', count(distinct bill_id), 'vendors', count(distinct vendor_id), 'last_date', max(bill_date),
                        'last_vendor', (array_agg(vendor order by bill_date desc))[1]) q
                 from r group by variant_id, case when variant_id is null then item end order by sum(net) desc limit v_limit + 1) z), '[]')
           else
             coalesce((select jsonb_agg(q order by q ->> 'date', q ->> 'number', (q ->> 'line_no')::int) from (
               select jsonb_build_object('id', line_id, 'bill_id', bill_id, 'date', bill_date, 'number', number, 'vendor_invoice', vendor_invoice_number,
                        'vendor', vendor, 'tax_number', tax_number, 'unit', unit, 'type', kind, 'line_no', line_no,
                        'code', sku, 'item', item, 'category', category, 'brand', brand, 'uom', uom,
                        'qty', round(sign * quantity, 3), 'price_list', price_list, 'discount1', d1, 'discount2', d2,
                        'discount', case when d1 = 0 and d2 = 0 then dsc else round(100 - (100 - d1) * (100 - d2) / 100, 2) end,
                        'price_net', price_net, 'net', net, 'vat_rate', tax_rate, 'vat', vat, 'gross', gross,
                        'landed', case when v_report = 'lines_landed' then landed end,
                        'landed_unit', case when v_report = 'lines_landed' then round(landed / nullif(sign * quantity, 0), 4) end,
                        'cost_unit', case when v_report = 'lines_landed' then round((net + landed) / nullif(sign * quantity, 0), 4) end,
                        'cost_total', case when v_report = 'lines_landed' then net + landed end) q
                 from r order by bill_date, number, line_no limit v_limit + 1) z), '[]') end
      into v_count, v_rows
      from r;
  end if;
  v_count := jsonb_array_length(v_rows);
  if v_count > v_limit then
    v_rows := (select jsonb_agg(e order by i) from jsonb_array_elements(v_rows) with ordinality t (e, i) where i <= v_limit);
  end if;
  return jsonb_build_object('report', v_report, 'from', v_from, 'to', v_to, 'rows', v_rows, 'count', least(v_count, v_limit), 'truncated', v_count > v_limit,
    'currency', (select base_currency from public.companies where id = p_company), 'doc_currency', v_doc_cur, 'landed_basis', v_basis);
end $$;
revoke execute on function public.purchase_detail(uuid, jsonb) from public, anon;
grant execute on function public.purchase_detail(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------- sales
create or replace function public.sales_detail(p_company uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_report text := coalesce(nullif(p ->> 'report', ''), 'by_item');
  v_from date := coalesce(nullif(p ->> 'from', '')::date, date_trunc('month', current_date)::date);
  v_to date := coalesce(nullif(p ->> 'to', '')::date, current_date);
  v_units uuid[] := app.detail_units(p_company, p);
  v_restricted boolean := public.my_warehouse_access(p_company) is not null;
  v_partners uuid[] := app.detail_ids(p, 'partners'); v_ptags text[] := app.detail_texts(p, 'partner_tags');
  v_items uuid[] := app.detail_ids(p, 'items'); v_cats uuid[] := app.detail_ids(p, 'categories'); v_brands text[] := app.detail_texts(p, 'brands');
  v_types text[] := app.detail_texts(p, 'doc_types'); v_rates numeric[] := app.detail_nums(p, 'vat_rates');
  v_pay text[] := app.detail_texts(p, 'payment'); v_people uuid[] := app.detail_ids(p, 'people');
  v_min numeric := nullif(p ->> 'min_total', '')::numeric; v_max numeric := nullif(p ->> 'max_total', '')::numeric;
  v_minq numeric := nullif(p ->> 'min_qty', '')::numeric; v_maxq numeric := nullif(p ->> 'max_qty', '')::numeric;
  v_doc_cur boolean := coalesce(p ->> 'currency', 'base') = 'doc';
  v_source text := coalesce(nullif(p ->> 'source', ''), 'all');
  v_daily boolean := coalesce(p ->> 'till_mode', 'lines') = 'daily';
  v_limit int := least(coalesce((p ->> 'limit')::int, 20000), 50000);
  v_tz text := coalesce((select timezone from public.companies where id = p_company), 'Europe/Belgrade');
  v_rows jsonb; v_count int;
begin
  perform app.require_permission(p_company, 'sales.read');
  if v_report not in ('by_item', 'detailed', 'by_customer', 'lines', 'by_unit', 'by_person', 'by_category', 'by_day', 'by_hour') then
    raise exception 'Unknown report: %', v_report using errcode = '22023';
  end if;
  -- a total a day per till is a way of listing; the groupings count the receipts themselves
  v_daily := v_daily and v_report in ('lines', 'detailed');
  if v_to < v_from then raise exception 'Check the dates' using errcode = '22023'; end if;
  if v_to - v_from > 1100 then raise exception 'At most three years at once' using errcode = '22023'; end if;
  if v_restricted and cardinality(v_units) = 0 then return jsonb_build_object('rows', '[]'::jsonb, 'count', 0, 'truncated', false); end if;

  create temp table if not exists pg_temp.sd_lines (
    doc_key text, doc_id uuid, src text, kind text, d date, at timestamptz, number text, partner_id uuid, unit_id uuid, person_id uuid, register text,
    variant_id uuid, description text, qty numeric, price_list numeric, discount numeric, net numeric, vat_rate numeric, vat numeric, gross numeric, cost numeric,
    doc_total numeric, paid numeric, due numeric, payment_status text, due_date date, fiscal text, currency text) on commit drop;
  truncate pg_temp.sd_lines;

  -- the invoices (not those made by the tills: those are the receipts below)
  if v_source in ('all', 'invoices') then
    insert into pg_temp.sd_lines
    select i.id::text, i.id, 'invoice', case when i.document_type = 'credit_note' then 'credit' when i.is_debit_note then 'debit' else 'invoice' end,
           i.invoice_date, coalesce(i.posted_at, i.created_at), i.number, i.partner_id,
           coalesce(so.warehouse_id, (select dd.warehouse_id from public.deliveries dd join public.delivery_lines x on x.delivery_id = dd.id where x.id = l.delivery_line_id)),
           i.salesperson_id, null, l.variant_id, l.description, s.s * l.quantity, round(l.unit_price * rt.r, 4), coalesce(l.discount_pct, 0),
           round(s.s * l.line_subtotal * rt.r, 2), l.tax_rate, round(s.s * l.tax_amount * rt.r, 2), round(s.s * l.line_total * rt.r, 2),
           round(s.s * l.quantity * coalesce(dl.unit_cost, ic.avg_cost, v.standard_cost, 0) * case when v_doc_cur then 1 / nullif(i.exchange_rate, 0) else 1 end, 2),
           round(s.s * i.total * rt.r, 2), round(s.s * i.amount_paid * rt.r, 2), round(s.s * i.amount_due * rt.r, 2),
           case when i.amount_due > 0 and i.due_date < current_date then 'overdue' else i.payment_status end, i.due_date, i.fiscal_status,
           case when v_doc_cur then i.currency_code end
      from public.sales_invoices i
      join public.sales_invoice_lines l on l.invoice_id = i.id
      left join public.sales_orders so on so.id = i.sales_order_id
      left join public.delivery_lines dl on dl.id = l.delivery_line_id
      left join public.product_variants v on v.id = l.variant_id
      left join public.item_costs ic on ic.variant_id = l.variant_id
      cross join lateral (select case when i.document_type = 'credit_note' then -1 else 1 end as s, case when v_doc_cur then 1 else coalesce(i.exchange_rate, 1) end as r) s
      cross join lateral (select s.r) rt
     where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and i.source <> 'pos' and not coalesce(i.is_opening, false)
       and i.invoice_date between v_from and v_to;
  end if;
  -- the till receipts, line by line or one total a day per till
  if v_source in ('all', 'till') then
    insert into pg_temp.sd_lines
    select case when v_daily then r.id::text || ':' || (o.order_at at time zone v_tz)::date else o.id::text end,
           case when v_daily then null else o.id end, 'till', case when v_daily then 'till_day' when o.is_refund then 'till_refund' else 'till' end,
           (o.order_at at time zone v_tz)::date, o.order_at,
           case when v_daily then r.name || ' · ' || to_char((o.order_at at time zone v_tz)::date, 'DD.MM.YYYY') else o.number end,
           case when v_daily then null else o.partner_id end, r.warehouse_id, case when v_daily then null else o.cashier_id end, r.name,
           l.variant_id, l.description, l.quantity, l.unit_price, coalesce(l.discount_pct, 0),
           l.line_subtotal, l.tax_rate, l.tax_amount, coalesce(l.line_total, l.line_subtotal + l.tax_amount), round(l.quantity * coalesce(l.unit_cost, 0), 2),
           o.total, o.total, 0, 'paid', null, o.fiscal_status, null
      from public.pos_orders o
      join public.pos_order_lines l on l.pos_order_id = o.id
      join public.pos_registers r on r.id = o.register_id
     where o.company_id = p_company and o.status = 'paid' and o.deleted_at is null
       and (o.order_at at time zone v_tz)::date between v_from and v_to;
  end if;

  -- the document filters, then the line filters
  delete from pg_temp.sd_lines x where not (
        (cardinality(v_units) = 0 or x.unit_id = any (v_units))
    and (cardinality(v_partners) = 0 or x.partner_id = any (v_partners))
    and (cardinality(v_ptags) = 0 or exists (select 1 from public.business_partners bp where bp.id = x.partner_id and coalesce(bp.tags, '{}') && v_ptags))
    and (cardinality(v_types) = 0 or x.kind = any (v_types) or (x.kind = 'till_day' and 'till' = any (v_types)))
    and (cardinality(v_pay) = 0 or x.payment_status = any (v_pay))
    and (cardinality(v_people) = 0 or x.person_id = any (v_people))
    and (v_min is null or x.doc_total >= v_min) and (v_max is null or x.doc_total <= v_max));
  delete from pg_temp.sd_lines x where not (
        (cardinality(v_items) = 0 or x.variant_id = any (v_items))
    and (cardinality(v_rates) = 0 or coalesce(x.vat_rate, 0) = any (v_rates))
    and (v_minq is null or x.qty >= v_minq) and (v_maxq is null or x.qty <= v_maxq)
    and (cardinality(v_cats) + cardinality(v_brands) = 0 or exists (
          select 1 from public.product_variants v join public.products pr on pr.id = v.product_id left join public.product_categories c on c.id = pr.category_id
           where v.id = x.variant_id and (cardinality(v_cats) = 0 or pr.category_id = any (v_cats) or c.parent_id = any (v_cats))
             and (cardinality(v_brands) = 0 or pr.brand = any (v_brands)))));

  with r as (
    select x.*, bp.name as customer, bp.tax_number, w.name as unit, coalesce(pf.full_name, pf.email) as person,
           v.sku, coalesce(v.name, x.description) as item, pr.brand, c.name as category, u.code as uom
      from pg_temp.sd_lines x
      left join public.business_partners bp on bp.id = x.partner_id
      left join public.warehouses w on w.id = x.unit_id
      left join public.profiles pf on pf.id = x.person_id
      left join public.product_variants v on v.id = x.variant_id
      left join public.products pr on pr.id = v.product_id
      left join public.product_categories c on c.id = pr.category_id
      left join public.units_of_measure u on u.id = pr.uom_id),
  -- the figures every grouping shows
  g as (
    select case v_report when 'by_item' then coalesce(variant_id::text, item) when 'by_customer' then coalesce(partner_id::text, '-')
                         when 'by_unit' then coalesce(unit_id::text, '-') when 'by_person' then coalesce(person_id::text, coalesce(register, '-'))
                         when 'by_category' then coalesce(category, '-') when 'by_day' then d::text
                         when 'by_hour' then to_char(at at time zone v_tz, 'HH24') else doc_key end as k, r.*
      from r)
  select count(*)::int,
         case
           when v_report = 'lines' then
             coalesce((select jsonb_agg(q order by q ->> 'date', q ->> 'number') from (
               select jsonb_build_object('doc_id', doc_id, 'source', src, 'type', kind, 'date', d, 'number', number, 'customer', customer, 'tax_number', tax_number,
                        'unit', unit, 'person', coalesce(person, register), 'code', sku, 'item', item, 'category', category, 'brand', brand, 'uom', uom,
                        'qty', round(qty, 3), 'price_list', price_list, 'discount', discount, 'price_net', round(net / nullif(qty, 0), 4),
                        'net', net, 'vat_rate', vat_rate, 'vat', vat, 'gross', gross, 'cost', cost, 'margin', net - cost,
                        'margin_pct', round(100 * (net - cost) / nullif(net, 0), 1), 'currency', currency) q
                 from r where not v_daily or src <> 'till' order by d, number limit v_limit + 1) z), '[]')
             || case when v_daily then coalesce((select jsonb_agg(q) from (
               select jsonb_build_object('source', 'till', 'type', 'till_day', 'date', min(d), 'number', min(number), 'unit', min(unit), 'person', min(register),
                        'code', min(sku), 'item', min(item), 'category', min(category), 'brand', min(brand), 'uom', min(uom),
                        'qty', round(sum(qty), 3), 'price_net', round(sum(net) / nullif(sum(qty), 0), 4), 'net', sum(net), 'vat_rate', min(vat_rate),
                        'vat', sum(vat), 'gross', sum(gross), 'cost', sum(cost), 'margin', sum(net - cost),
                        'margin_pct', round(100 * sum(net - cost) / nullif(sum(net), 0), 1)) q
                 from r where src = 'till' group by doc_key, variant_id, vat_rate order by min(d), min(register) limit v_limit + 1) z), '[]') else '[]'::jsonb end
           when v_report = 'detailed' then
             coalesce((select jsonb_agg(q order by q ->> 'date', q ->> 'number') from (
               select jsonb_build_object('doc_id', min(doc_id::text), 'source', min(src), 'type', min(kind), 'date', min(d), 'number', min(number),
                        'customer', min(customer), 'tax_number', min(tax_number), 'unit', min(unit), 'person', coalesce(min(person), min(register)),
                        'lines', count(*), 'net', sum(net), 'vat', sum(vat), 'gross', sum(gross), 'cost', sum(cost), 'margin', sum(net - cost),
                        'margin_pct', round(100 * sum(net - cost) / nullif(sum(net), 0), 1),
                        'paid', case when min(src) = 'invoice' then min(paid) else sum(gross) end, 'due', case when min(src) = 'invoice' then min(due) else 0 end,
                        'payment_status', min(payment_status), 'due_date', min(due_date), 'fiscal', min(fiscal), 'currency', min(currency)) q
                 from g group by k order by min(d), min(number) limit v_limit + 1) z), '[]')
           else
             coalesce((select jsonb_agg(q order by case when v_report in ('by_day', 'by_hour') then q ->> 'key' end, (q ->> 'net')::numeric desc) from (
               select jsonb_build_object('key', k,
                        'label', case v_report when 'by_item' then min(item) when 'by_customer' then coalesce(min(customer), '—')
                                               when 'by_unit' then coalesce(min(unit), '—') when 'by_person' then coalesce(min(person), min(register), '—')
                                               when 'by_category' then coalesce(min(category), '—') when 'by_day' then k when 'by_hour' then k || ':00' end,
                        'code', case when v_report = 'by_item' then min(sku) end, 'category', case when v_report = 'by_item' then min(category) end,
                        'uom', case when v_report = 'by_item' then min(uom) end, 'tax_number', case when v_report = 'by_customer' then min(tax_number) end,
                        'qty', case when v_report = 'by_item' then round(sum(qty), 3) end, 'documents', count(distinct doc_key),
                        'net', sum(net), 'vat', sum(vat), 'gross', sum(gross), 'cost', sum(cost), 'margin', sum(net - cost),
                        'margin_pct', round(100 * sum(net - cost) / nullif(sum(net), 0), 1),
                        'discount', round(sum(case when discount between 0.001 and 99.99 then net * discount / (100 - discount) else 0 end), 2),
                        'avg_price', case when v_report = 'by_item' then round(sum(net) / nullif(sum(qty), 0), 4) end,
                        'avg_document', round(sum(gross) / nullif(count(distinct doc_key), 0), 2),
                        'share', round(100 * sum(net) / nullif(sum(sum(net)) over (), 0), 1)) q
                 from g group by k order by sum(net) desc limit v_limit + 1) z), '[]')
         end
    into v_count, v_rows
    from r;
  v_count := jsonb_array_length(v_rows);
  if v_count > v_limit then
    v_rows := (select jsonb_agg(e order by i) from jsonb_array_elements(v_rows) with ordinality t (e, i) where i <= v_limit);
  end if;
  return jsonb_build_object('report', v_report, 'from', v_from, 'to', v_to, 'rows', v_rows, 'count', least(v_count, v_limit), 'truncated', v_count > v_limit,
    'currency', (select base_currency from public.companies where id = p_company), 'doc_currency', v_doc_cur, 'till_mode', case when v_daily then 'daily' else 'lines' end);
end $$;
revoke execute on function public.sales_detail(uuid, jsonb) from public, anon;
grant execute on function public.sales_detail(uuid, jsonb) to authenticated;
