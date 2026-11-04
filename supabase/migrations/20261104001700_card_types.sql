-- =============================================================================
-- DrisPRO · more kinds of partner cards
--   · by invoice: every invoice of the partner with what was paid on it, by which payment, the credit
--     and debit notes on it, and what is still open
--   · by item: what the partner bought from us, or we from them: quantity and value per item
--   · balances by group: every customer or supplier with their balance and how much of it is late,
--     grouped by the partner's tags (the "sub-type")
-- The reconciliation card (customer and supplier side together, for a compensation) is drawn on the
-- screen from the two account cards.
-- =============================================================================

-- ----------------------------------------------------------------------------- by invoice
create or replace function public.partner_invoices_card(p_partner uuid, p_side text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare bp public.business_partners; v_rows jsonb;
begin
  select * into bp from public.business_partners where id = p_partner;
  if bp.id is null then raise exception 'Customer or vendor not found' using errcode = 'P0002'; end if;
  perform app.require_permission(bp.company_id, 'invoicing.read');
  if p_side = 'customer' then
    select coalesce(jsonb_agg(r order by r ->> 'date', r ->> 'number'), '[]') into v_rows from (
      select jsonb_build_object('id', i.id, 'number', i.number, 'kind', case when i.document_type = 'credit_note' then 'credit_note' when i.is_debit_note then 'debit_note' else 'invoice' end,
        'reference', null, 'date', i.invoice_date, 'due', i.due_date, 'currency', i.currency_code, 'total', i.total,
        'paid', coalesce((select sum(a.amount) from public.payment_allocations a join public.payments y on y.id = a.payment_id where a.sales_invoice_id = i.id and y.status = 'posted' and y.deleted_at is null), 0),
        'credited', coalesce((select sum(c.total) from public.sales_invoices c where c.original_invoice_id = i.id and c.document_type = 'credit_note' and c.status = 'posted' and c.deleted_at is null), 0),
        'open', i.amount_due, 'late', i.document_type <> 'credit_note' and i.amount_due > 0.004 and i.due_date < current_date,
        'payments', coalesce((select jsonb_agg(jsonb_build_object('id', y.id, 'number', y.number, 'date', y.payment_date, 'amount', a.amount, 'method', y.method) order by y.payment_date)
                                from public.payment_allocations a join public.payments y on y.id = a.payment_id where a.sales_invoice_id = i.id and y.status = 'posted' and y.deleted_at is null), '[]'),
        'notes', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'number', c.number, 'date', c.invoice_date, 'total', c.total,
                                'kind', case when c.document_type = 'credit_note' then 'credit_note' else 'debit_note' end) order by c.invoice_date)
                             from public.sales_invoices c where c.original_invoice_id = i.id and c.status = 'posted' and c.deleted_at is null), '[]')) r
        from public.sales_invoices i
       where i.partner_id = p_partner and i.status = 'posted' and i.deleted_at is null and i.invoice_date between p_from and p_to) t;
  elsif p_side = 'vendor' then
    select coalesce(jsonb_agg(r order by r ->> 'date', r ->> 'number'), '[]') into v_rows from (
      select jsonb_build_object('id', b.id, 'number', b.number, 'kind', case when b.document_type = 'vendor_credit' then 'credit_note' when b.is_debit_note then 'debit_note' else 'invoice' end,
        'reference', b.vendor_invoice_number, 'date', b.bill_date, 'due', b.due_date, 'currency', b.currency_code, 'total', b.total,
        'paid', coalesce((select sum(a.amount) from public.payment_allocations a join public.payments y on y.id = a.payment_id where a.vendor_bill_id = b.id and y.status = 'posted' and y.deleted_at is null), 0),
        'credited', coalesce((select sum(c.total) from public.vendor_bills c where c.original_bill_id = b.id and c.document_type = 'vendor_credit' and c.status = 'posted' and c.deleted_at is null), 0),
        'open', b.amount_due, 'late', b.document_type <> 'vendor_credit' and b.amount_due > 0.004 and b.due_date < current_date,
        'payments', coalesce((select jsonb_agg(jsonb_build_object('id', y.id, 'number', y.number, 'date', y.payment_date, 'amount', a.amount, 'method', y.method) order by y.payment_date)
                                from public.payment_allocations a join public.payments y on y.id = a.payment_id where a.vendor_bill_id = b.id and y.status = 'posted' and y.deleted_at is null), '[]'),
        'notes', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'number', c.number, 'date', c.bill_date, 'total', c.total,
                                'kind', case when c.document_type = 'vendor_credit' then 'credit_note' else 'debit_note' end) order by c.bill_date)
                             from public.vendor_bills c where c.original_bill_id = b.id and c.status = 'posted' and c.deleted_at is null), '[]')) r
        from public.vendor_bills b
       where b.vendor_id = p_partner and b.status = 'posted' and b.deleted_at is null and b.bill_date between p_from and p_to) t;
  else
    raise exception 'Choose customer or supplier side' using errcode = '22023';
  end if;
  return jsonb_build_object('side', p_side, 'from', p_from, 'to', p_to, 'rows', v_rows);
end $$;
revoke execute on function public.partner_invoices_card(uuid, text, date, date) from public, anon;
grant execute on function public.partner_invoices_card(uuid, text, date, date) to authenticated;

-- ----------------------------------------------------------------------------- by item
create or replace function public.partner_items_card(p_partner uuid, p_side text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare bp public.business_partners; v_rows jsonb;
begin
  select * into bp from public.business_partners where id = p_partner;
  if bp.id is null then raise exception 'Customer or vendor not found' using errcode = 'P0002'; end if;
  perform app.require_permission(bp.company_id, 'invoicing.read');
  if p_side not in ('customer', 'vendor') then raise exception 'Choose customer or supplier side' using errcode = '22023'; end if;
  with l as (
    -- a credit note takes back what it credits
    select l.variant_id, l.description, case when i.document_type = 'credit_note' then -1 else 1 end * l.quantity as qty,
           case when i.document_type = 'credit_note' then -1 else 1 end * l.line_subtotal * coalesce(i.exchange_rate, 1) as net, i.invoice_date as d, i.id as doc
      from public.sales_invoice_lines l join public.sales_invoices i on i.id = l.invoice_id
     where p_side = 'customer' and i.partner_id = p_partner and i.status = 'posted' and i.deleted_at is null and i.invoice_date between p_from and p_to
    union all
    select l.variant_id, l.description, case when b.document_type = 'vendor_credit' then -1 else 1 end * l.quantity,
           case when b.document_type = 'vendor_credit' then -1 else 1 end * l.line_subtotal * coalesce(b.exchange_rate, 1), b.bill_date, b.id
      from public.vendor_bill_lines l join public.vendor_bills b on b.id = l.bill_id
     where p_side = 'vendor' and b.vendor_id = p_partner and b.status = 'posted' and b.deleted_at is null and b.bill_date between p_from and p_to)
  select coalesce(jsonb_agg(r order by (r ->> 'net')::numeric desc), '[]') into v_rows from (
    select jsonb_build_object('variant_id', l.variant_id, 'sku', v.sku, 'name', coalesce(v.name, min(l.description)), 'uom', u.code,
             'qty', sum(l.qty), 'net', round(sum(l.net), 2), 'avg_price', case when sum(l.qty) <> 0 then round(sum(l.net) / sum(l.qty), 4) end,
             'documents', count(distinct l.doc), 'last', max(l.d)) r
      from l left join public.product_variants v on v.id = l.variant_id
      left join public.products p on p.id = v.product_id left join public.units_of_measure u on u.id = p.uom_id
     group by l.variant_id, v.sku, v.name, u.code, case when l.variant_id is null then l.description end) t;
  return jsonb_build_object('side', p_side, 'from', p_from, 'to', p_to, 'rows', v_rows,
    'currency', (select base_currency from public.companies where id = bp.company_id));
end $$;
revoke execute on function public.partner_items_card(uuid, text, date, date) from public, anon;
grant execute on function public.partner_items_card(uuid, text, date, date) to authenticated;

-- ----------------------------------------------------------------------------- balances of everyone, by group
create or replace function public.partner_balances(p_company uuid, p_side text, p_date date default current_date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_rows jsonb;
begin
  perform app.require_permission(p_company, 'invoicing.read');
  if p_side not in ('customer', 'vendor') then raise exception 'Choose customer or supplier side' using errcode = '22023'; end if;
  with acc as (
    select a.id from public.accounts a where a.company_id = p_company and a.deleted_at is null
       and a.account_subtype = case when p_side = 'vendor' then 'payable' else 'receivable' end
    union select app.acct(p_company, case when p_side = 'vendor' then 'vendor_advances' else 'customer_advances' end)
    union select case when p_side = 'vendor' then bp.payable_account_id else bp.receivable_account_id end from public.business_partners bp where bp.company_id = p_company),
  bal as (
    select jl.partner_id, sum(jl.debit - jl.credit) as b
      from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
     where jl.company_id = p_company and jl.partner_id is not null and jl.account_id in (select id from acc where id is not null)
       and e.status in ('posted', 'reversed') and e.entry_date <= p_date
     group by jl.partner_id),
  late as (
    select partner_id, sum(amount_due) as late from public.sales_invoices
     where p_side = 'customer' and company_id = p_company and status = 'posted' and deleted_at is null and document_type <> 'credit_note' and due_date < p_date and amount_due > 0
     group by partner_id
    union all
    select vendor_id, sum(amount_due) from public.vendor_bills
     where p_side = 'vendor' and company_id = p_company and status = 'posted' and deleted_at is null and document_type <> 'vendor_credit' and due_date < p_date and amount_due > 0
     group by vendor_id)
  select coalesce(jsonb_agg(jsonb_build_object('id', bp.id, 'name', bp.name, 'code', bp.code, 'tax_number', bp.tax_number, 'groups', coalesce(to_jsonb(bp.tags), '[]'),
           'balance', round(case when p_side = 'vendor' then -coalesce(bal.b, 0) else coalesce(bal.b, 0) end, 2),
           'late', round(coalesce(late.late, 0), 2), 'credit_limit', bp.credit_limit) order by bp.name), '[]') into v_rows
    from public.business_partners bp left join bal on bal.partner_id = bp.id left join late on late.partner_id = bp.id
   where bp.company_id = p_company and bp.deleted_at is null and (case when p_side = 'vendor' then bp.is_vendor else bp.is_customer end)
     and (abs(coalesce(bal.b, 0)) >= 0.005 or bp.is_active);
  return jsonb_build_object('side', p_side, 'date', p_date, 'rows', v_rows, 'currency', (select base_currency from public.companies where id = p_company));
end $$;
revoke execute on function public.partner_balances(uuid, text, date) from public, anon;
grant execute on function public.partner_balances(uuid, text, date) to authenticated;
