-- =============================================================================
-- The guard ("Kujdestari"): a look at an invoice before it is posted.
--
-- It compares the document with the company's own history, not with fixed
-- rules: a quantity far above what is usually bought or sold, a price far
-- from the last one, another VAT rate than usual, a sale under cost, a date
-- in a month whose VAT is already declared, the same total twice. It only
-- warns: the person reads why and decides. What was waved through is kept
-- (app.guard_events), so the help can later go to the person who needs it.
--
-- Findings are codes with values; the app writes the sentences.
-- =============================================================================

create table app.guard_events (
  id          bigint generated always as identity primary key,
  company_id  uuid not null references public.companies(id) on delete cascade,
  user_id     uuid,
  doc_kind    text not null,
  doc_id      uuid not null,
  code        text not null,
  created_at  timestamptz not null default now()
);
create index guard_events_company_idx on app.guard_events (company_id, created_at desc);
alter table app.guard_events enable row level security;

-- a typical quantity: the median of the last 20 lines (null with fewer than 3)
create or replace function app.usual_qty(p_qtys numeric[])
returns numeric language sql immutable as $$
  select case when coalesce(array_length(p_qtys, 1), 0) >= 3
              then (select percentile_cont(0.5) within group (order by q) from unnest(p_qtys) q) end
$$;

create or replace function public.document_checks(p_kind text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_out jsonb := '[]'; v_company uuid; v_partner uuid; v_date date; v_total numeric; v_status text; v_doc_type text;
  l record; v_usual numeric; v_last numeric; v_rate numeric; v_cost numeric; v_name text; v_dup text; v_p record;
begin
  if p_kind = 'vendor_bill' then
    select company_id, vendor_id, bill_date, total, status, document_type into v_company, v_partner, v_date, v_total, v_status, v_doc_type
      from public.vendor_bills where id = p_id and deleted_at is null;
  elsif p_kind = 'sales_invoice' then
    select company_id, partner_id, invoice_date, total, status, document_type into v_company, v_partner, v_date, v_total, v_status, v_doc_type
      from public.sales_invoices where id = p_id and deleted_at is null;
  else
    raise exception 'Unknown document kind' using errcode = '22023';
  end if;
  if v_company is null then raise exception 'Document not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_company, 'invoicing.read');
  if v_status <> 'draft' then return v_out; end if;

  -- ---------------------------------------------------------------- the lines
  for l in
    select x.line_no, x.variant_id, x.quantity, x.unit_price, x.discount_pct, x.tax_rate, coalesce(v.sku || ' · ' || v.name, x.description) as item,
           p.sales_price, coalesce(v.sales_price_override, p.sales_price) as list_price
      from (select line_no, variant_id, quantity, unit_price, coalesce(discount_pct, 0) discount_pct, tax_rate, description
              from public.vendor_bill_lines where p_kind = 'vendor_bill' and bill_id = p_id and not coalesce(is_return, false)
            union all
            select line_no, variant_id, quantity, unit_price, coalesce(discount_pct, 0), tax_rate, description
              from public.sales_invoice_lines where p_kind = 'sales_invoice' and invoice_id = p_id) x
      left join public.product_variants v on v.id = x.variant_id
      left join public.products p on p.id = v.product_id
     order by x.line_no
  loop
    continue when l.variant_id is null;

    -- the usual quantity of this item on this kind of document
    if p_kind = 'vendor_bill' then
      select app.usual_qty(array_agg(q)) into v_usual from (
        select bl.quantity q from public.vendor_bill_lines bl join public.vendor_bills b on b.id = bl.bill_id
         where bl.company_id = v_company and bl.variant_id = l.variant_id and b.status = 'posted' and b.deleted_at is null and b.id <> p_id
         order by b.bill_date desc limit 20) h;
    else
      select app.usual_qty(array_agg(q)) into v_usual from (
        select il.quantity q from public.sales_invoice_lines il join public.sales_invoices i on i.id = il.invoice_id
         where il.company_id = v_company and il.variant_id = l.variant_id and i.status = 'posted' and i.deleted_at is null and i.id <> p_id
         order by i.invoice_date desc limit 20) h;
    end if;
    if v_usual is not null and l.quantity >= v_usual * 5 and l.quantity - v_usual >= 10 then
      v_out := v_out || jsonb_build_object('code', 'qty_unusual', 'line', l.line_no,
                 'params', jsonb_build_object('item', l.item, 'qty', trim_scale(l.quantity), 'usual', trim_scale(round(v_usual, 2))));
    end if;

    if l.unit_price = 0 then
      v_out := v_out || jsonb_build_object('code', 'price_zero', 'line', l.line_no, 'params', jsonb_build_object('item', l.item));
      continue;
    end if;

    if p_kind = 'vendor_bill' then
      -- the price of the last purchase of this item
      select bl.unit_price * (1 - coalesce(bl.discount_pct, 0) / 100), bl.tax_rate into v_last, v_rate
        from public.vendor_bill_lines bl join public.vendor_bills b on b.id = bl.bill_id
       where bl.company_id = v_company and bl.variant_id = l.variant_id and b.status = 'posted' and b.deleted_at is null and b.id <> p_id and bl.unit_price > 0
       order by b.bill_date desc, b.posted_at desc limit 1;
      if v_last > 0 and abs(l.unit_price * (1 - l.discount_pct / 100) - v_last) / v_last >= 0.4 then
        v_out := v_out || jsonb_build_object('code', 'price_jump', 'line', l.line_no,
                   'params', jsonb_build_object('item', l.item, 'price', round(l.unit_price * (1 - l.discount_pct / 100), 2), 'last', round(v_last, 2),
                                                'pct', round((l.unit_price * (1 - l.discount_pct / 100) - v_last) / v_last * 100)));
      end if;
    else
      -- under cost, or far from the item's price
      select avg_cost into v_cost from public.item_costs where company_id = v_company and variant_id = l.variant_id;
      if v_cost > 0 and l.unit_price * (1 - l.discount_pct / 100) < v_cost then
        v_out := v_out || jsonb_build_object('code', 'below_cost', 'line', l.line_no,
                   'params', jsonb_build_object('item', l.item, 'price', round(l.unit_price * (1 - l.discount_pct / 100), 2), 'cost', round(v_cost, 2)));
      elsif l.list_price > 0 and abs(l.unit_price - l.list_price) / l.list_price >= 0.4 then
        v_out := v_out || jsonb_build_object('code', 'price_differs', 'line', l.line_no,
                   'params', jsonb_build_object('item', l.item, 'price', round(l.unit_price, 2), 'list', round(l.list_price, 2),
                                                'pct', round((l.unit_price - l.list_price) / l.list_price * 100)));
      end if;
      select il.tax_rate into v_rate from public.sales_invoice_lines il join public.sales_invoices i on i.id = il.invoice_id
       where il.company_id = v_company and il.variant_id = l.variant_id and i.status = 'posted' and i.deleted_at is null and i.id <> p_id
       order by i.invoice_date desc limit 1;
    end if;

    -- another VAT rate than the last time
    if v_rate is not null and l.tax_rate is not null and round(v_rate, 2) <> round(l.tax_rate, 2) then
      v_out := v_out || jsonb_build_object('code', 'vat_differs', 'line', l.line_no,
                 'params', jsonb_build_object('item', l.item, 'rate', trim_scale(l.tax_rate), 'usual', trim_scale(v_rate)));
    end if;
    v_rate := null; v_last := null; v_cost := null; v_usual := null;
  end loop;

  -- ---------------------------------------------------------------- the date
  if v_date > current_date then
    v_out := v_out || jsonb_build_object('code', 'date_future', 'params', jsonb_build_object('date', v_date));
  end if;
  if exists (select 1 from public.vat_declarations d where d.company_id = v_company and d.deleted_at is null
                and d.status not in ('draft', 'rejected') and v_date between d.period_start and d.period_end) then
    v_out := v_out || jsonb_build_object('code', 'vat_declared', 'params', jsonb_build_object('date', v_date));
  end if;

  -- ---------------------------------------------------------------- the partner
  select name, kind, tax_number into v_p from public.business_partners where id = v_partner;
  if v_p.name is not null and v_p.kind = 'company' and coalesce(btrim(v_p.tax_number), '') = '' then
    v_out := v_out || jsonb_build_object('code', case when p_kind = 'vendor_bill' then 'vendor_no_nui' else 'customer_no_nui' end,
                                         'params', jsonb_build_object('partner', v_p.name));
  end if;

  -- the same total for the same partner a few days apart: entered twice?
  if p_kind = 'vendor_bill' then
    select b.number into v_dup from public.vendor_bills b
     where b.company_id = v_company and b.vendor_id = v_partner and b.id <> p_id and b.deleted_at is null and b.status <> 'cancelled'
       and b.document_type = v_doc_type and b.total = v_total and v_total > 0 and abs(b.bill_date - v_date) <= 7 limit 1;
  else
    select i.number into v_dup from public.sales_invoices i
     where i.company_id = v_company and i.partner_id = v_partner and i.id <> p_id and i.deleted_at is null and i.status <> 'cancelled'
       and i.document_type = v_doc_type and i.total = v_total and v_total > 0 and abs(i.invoice_date - v_date) <= 3 limit 1;
  end if;
  if v_dup is not null then
    v_out := v_out || jsonb_build_object('code', 'same_total', 'params', jsonb_build_object('number', v_dup, 'total', round(v_total, 2)));
  end if;

  return (select coalesce(jsonb_agg(f || jsonb_build_object('level', 'warn')), '[]') from jsonb_array_elements(v_out) f);
end $$;
revoke execute on function public.document_checks(text, uuid) from public, anon;
grant execute on function public.document_checks(text, uuid) to authenticated;

-- the person read the warnings and went on: kept, to see later who needs help with what
create or replace function public.guard_ack(p_kind text, p_id uuid, p_codes text[])
returns void language plpgsql security definer set search_path = '' as $$
declare v_company uuid;
begin
  v_company := case p_kind when 'vendor_bill' then (select company_id from public.vendor_bills where id = p_id)
                           when 'sales_invoice' then (select company_id from public.sales_invoices where id = p_id) end;
  if v_company is null then raise exception 'Document not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_company, 'invoicing.write');
  insert into app.guard_events (company_id, user_id, doc_kind, doc_id, code)
  select v_company, auth.uid(), p_kind, p_id, c from unnest(coalesce(p_codes, '{}')) c;
end $$;
revoke execute on function public.guard_ack(text, uuid, text[]) from public, anon;
grant execute on function public.guard_ack(text, uuid, text[]) to authenticated;
