-- =============================================================================
-- Analyses of sales and purchases, and the profit report (from the staff's requests 23 and 24)
--   · analysis: one period, or two side by side (1–5 January 2025 against 1–5 January 2026), grouped
--     by unit, group, sub-group, supplier, item, customer, month or day; filtered by units, suppliers,
--     groups and items; quantity, value without and with VAT, cost, margin and margin %
--   · profit report, by month or by unit: gross sales − discounts − returns = net sales − cost of goods
--     sold = gross profit − operating expenses − other expenses + other income − loan interest = net
--     profit. Sales and cost come from the documents; expenses from the books. An expense booked to a
--     cost centre with a unit's code belongs to that unit; the rest is shared, shown apart or split by
--     each unit's share of net sales.
-- Base currency, without VAT unless the column says otherwise; returns and credit notes are negative.
-- =============================================================================

-- the item's supplier: the preferred one, else the one it was bought from last
create or replace function app.item_suppliers(p_company uuid)
returns table (variant_id uuid, supplier_id uuid)
language sql stable security definer set search_path = '' as $$
  select distinct on (x.variant_id) x.variant_id, x.vendor_id from (
    select vp.variant_id, vp.vendor_id, 0 as pri, vp.updated_at as at from public.vendor_products vp
     where vp.company_id = p_company and vp.deleted_at is null and vp.is_preferred
    union all
    select coalesce(l.variant_id, pl.variant_id), b.vendor_id, 1, b.bill_date::timestamptz from public.vendor_bills b
      join public.vendor_bill_lines l on l.bill_id = b.id left join public.purchase_order_lines pl on pl.id = l.po_line_id
     where b.company_id = p_company and b.status = 'posted' and b.deleted_at is null and coalesce(l.variant_id, pl.variant_id) is not null) x
  order by x.variant_id, x.pri, x.at desc
$$;

create or replace function app.analysis_sales(p_company uuid, p_from date, p_to date)
returns table (d date, warehouse_id uuid, variant_id uuid, customer_id uuid, qty numeric, net numeric, vat numeric, cost numeric, discount numeric, is_return boolean)
language sql stable security definer set search_path = '' as $$
  select i.invoice_date, coalesce(so.warehouse_id, (select dd.warehouse_id from public.deliveries dd join public.delivery_lines x on x.delivery_id = dd.id where x.id = l.delivery_line_id)),
         l.variant_id, i.partner_id, s.s * l.quantity, s.s * round(l.line_subtotal * i.exchange_rate, 2), s.s * round(l.tax_amount * i.exchange_rate, 2),
         s.s * round(l.quantity * coalesce(dl.unit_cost, ic.avg_cost, v.standard_cost, 0), 2),
         s.s * case when coalesce(l.discount_pct, 0) between 0.001 and 99.99 then round(l.line_subtotal * i.exchange_rate * l.discount_pct / (100 - l.discount_pct), 2) else 0 end,
         i.document_type = 'credit_note'
    from public.sales_invoices i
    join public.sales_invoice_lines l on l.invoice_id = i.id
    left join public.sales_orders so on so.id = i.sales_order_id
    left join public.delivery_lines dl on dl.id = l.delivery_line_id
    left join public.product_variants v on v.id = l.variant_id
    left join public.item_costs ic on ic.variant_id = l.variant_id
    cross join lateral (select case when i.document_type = 'credit_note' then -1 else 1 end as s) s
   where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and i.source <> 'pos' and i.invoice_date between p_from and p_to
  union all
  select (o.order_at at time zone co.timezone)::date, r.warehouse_id, l.variant_id, o.partner_id,
         l.quantity, l.line_subtotal, l.tax_amount, round(l.quantity * coalesce(l.unit_cost, 0), 2),
         case when coalesce(l.discount_pct, 0) between 0.001 and 99.99 then round(l.line_subtotal * l.discount_pct / (100 - l.discount_pct), 2) * sign(l.quantity) else 0 end,
         o.is_refund
    from public.pos_orders o
    join public.companies co on co.id = o.company_id
    join public.pos_order_lines l on l.pos_order_id = o.id
    join public.pos_registers r on r.id = o.register_id
   where o.company_id = p_company and o.status = 'paid' and o.deleted_at is null and (o.order_at at time zone co.timezone)::date between p_from and p_to
$$;

create or replace function app.analysis_purchases(p_company uuid, p_from date, p_to date)
returns table (d date, warehouse_id uuid, variant_id uuid, supplier_id uuid, qty numeric, net numeric, vat numeric)
language sql stable security definer set search_path = '' as $$
  select b.bill_date, b.warehouse_id, coalesce(l.variant_id, pl.variant_id), b.vendor_id,
         s.s * l.quantity, s.s * round(l.line_subtotal * b.exchange_rate, 2), s.s * round(l.tax_amount * b.exchange_rate, 2)
    from public.vendor_bills b
    join public.vendor_bill_lines l on l.bill_id = b.id
    left join public.purchase_order_lines pl on pl.id = l.po_line_id
    cross join lateral (select case when b.document_type = 'vendor_credit' then -1 else 1 end as s) s
   where b.company_id = p_company and b.status = 'posted' and b.deleted_at is null and b.bill_date between p_from and p_to
$$;

-- -----------------------------------------------------------------------------------------------
-- the analysis
-- p: kind (sales | purchases), from, to, cmp_from, cmp_to, group_by, units[], suppliers[], groups[], items[]
-- -----------------------------------------------------------------------------------------------
create or replace function public.trade_analysis(p_company uuid, p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_kind text := coalesce(p ->> 'kind', 'sales');
  v_from date := coalesce((p ->> 'from')::date, date_trunc('month', current_date)::date);
  v_to date := coalesce((p ->> 'to')::date, current_date);
  v_cfrom date := nullif(p ->> 'cmp_from', '')::date;
  v_cto date := nullif(p ->> 'cmp_to', '')::date;
  v_by text := coalesce(nullif(p ->> 'group_by', ''), 'group');
  v_units uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'units', '[]'))::uuid);
  v_sups uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'suppliers', '[]'))::uuid);
  v_groups uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'groups', '[]'))::uuid);
  v_items uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'items', '[]'))::uuid);
  v_rows jsonb;
begin
  perform app.require_permission(p_company, case when v_kind = 'purchases' then 'procurement.read' else 'sales.read' end);
  if v_kind not in ('sales', 'purchases') then raise exception 'Choose sales or purchases' using errcode = '22023'; end if;
  if v_by not in ('unit', 'group', 'category', 'supplier', 'item', 'customer', 'month', 'day') or (v_kind = 'purchases' and v_by = 'customer') then
    raise exception 'Cannot group by %', v_by using errcode = '22023';
  end if;
  if v_to < v_from or (v_cfrom is not null and (v_cto is null or v_cto < v_cfrom)) then raise exception 'Check the dates' using errcode = '22023'; end if;
  if v_to - v_from > 1100 then raise exception 'At most three years at once' using errcode = '22023'; end if;

  with sup as (select * from app.item_suppliers(p_company)),
  facts as (
    select 'a' as per, f.d, f.warehouse_id, f.variant_id, f.customer_id, null::uuid as vendor_id, f.qty, f.net, f.vat, f.cost, f.discount
      from app.analysis_sales(p_company, v_from, v_to) f where v_kind = 'sales'
    union all
    select 'b', f.d, f.warehouse_id, f.variant_id, f.customer_id, null, f.qty, f.net, f.vat, f.cost, f.discount
      from app.analysis_sales(p_company, v_cfrom, v_cto) f where v_kind = 'sales' and v_cfrom is not null
    union all
    select 'a', f.d, f.warehouse_id, f.variant_id, null, f.supplier_id, f.qty, f.net, f.vat, 0, 0
      from app.analysis_purchases(p_company, v_from, v_to) f where v_kind = 'purchases'
    union all
    select 'b', f.d, f.warehouse_id, f.variant_id, null, f.supplier_id, f.qty, f.net, f.vat, 0, 0
      from app.analysis_purchases(p_company, v_cfrom, v_cto) f where v_kind = 'purchases' and v_cfrom is not null),
  enriched as (
    select f.*, coalesce(f.vendor_id, sup.supplier_id) as supplier_id, pr.category_id, coalesce(c.parent_id, c.id) as group_id
      from facts f
      left join public.product_variants v on v.id = f.variant_id
      left join public.products pr on pr.id = v.product_id
      left join public.product_categories c on c.id = pr.category_id
      left join sup on sup.variant_id = f.variant_id),
  filtered as (
    select e.*, case v_by
        when 'unit' then e.warehouse_id::text when 'group' then e.group_id::text when 'category' then e.category_id::text
        when 'supplier' then e.supplier_id::text when 'item' then e.variant_id::text when 'customer' then e.customer_id::text
        when 'month' then to_char(e.d, 'YYYY-MM') when 'day' then to_char(e.d, 'YYYY-MM-DD') end as k
      from enriched e
     where (cardinality(v_units) = 0 or e.warehouse_id = any (v_units))
       and (cardinality(v_sups) = 0 or e.supplier_id = any (v_sups))
       and (cardinality(v_groups) = 0 or e.category_id = any (v_groups) or e.group_id = any (v_groups))
       and (cardinality(v_items) = 0 or e.variant_id = any (v_items))),
  agg as (
    select k, per, sum(qty) q, sum(net) n, sum(vat) t, sum(cost) c, sum(discount) dsc from filtered group by k, per)
  select coalesce(jsonb_agg(jsonb_build_object(
      'key', x.k,
      'label', case v_by
         when 'unit' then (select name from public.warehouses where id::text = x.k)
         when 'group' then (select name from public.product_categories where id::text = x.k)
         when 'category' then (select name from public.product_categories where id::text = x.k)
         when 'supplier' then (select name from public.business_partners where id::text = x.k)
         when 'customer' then (select name from public.business_partners where id::text = x.k)
         when 'item' then (select v.name from public.product_variants v where v.id::text = x.k)
         else x.k end,
      'code', case when v_by = 'item' then (select v.sku from public.product_variants v where v.id::text = x.k) end,
      'a', (select jsonb_build_object('qty', round(q, 3), 'net', round(n, 2), 'vat', round(t, 2), 'gross', round(n + t, 2), 'cost', round(c, 2),
                                      'margin', round(n - c, 2), 'margin_pct', round(100 * (n - c) / nullif(n, 0), 1), 'discount', round(dsc, 2))
              from agg where agg.k is not distinct from x.k and per = 'a'),
      'b', (select jsonb_build_object('qty', round(q, 3), 'net', round(n, 2), 'vat', round(t, 2), 'gross', round(n + t, 2), 'cost', round(c, 2),
                                      'margin', round(n - c, 2), 'margin_pct', round(100 * (n - c) / nullif(n, 0), 1), 'discount', round(dsc, 2))
              from agg where agg.k is not distinct from x.k and per = 'b'))), '[]')
    into v_rows
    from (select distinct k from agg) x;

  return jsonb_build_object('kind', v_kind, 'from', v_from, 'to', v_to, 'cmp_from', v_cfrom, 'cmp_to', v_cto, 'group_by', v_by, 'rows', v_rows,
    'currency', (select base_currency from public.companies where id = p_company));
end $$;
revoke all on function public.trade_analysis(uuid, jsonb) from public, anon;
grant execute on function public.trade_analysis(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------------------------
-- the profit report
-- p: from, to, by (month | unit), units[], shared (apart | split)
-- -----------------------------------------------------------------------------------------------
create or replace function public.profit_report(p_company uuid, p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_from date := coalesce((p ->> 'from')::date, date_trunc('year', current_date)::date);
  v_to date := coalesce((p ->> 'to')::date, current_date);
  v_by text := coalesce(nullif(p ->> 'by', ''), 'month');
  v_units uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'units', '[]'))::uuid);
  v_split boolean := coalesce(p ->> 'shared', 'apart') = 'split';
  v_cols jsonb; v_cells jsonb;
begin
  if not (app.has_permission(p_company, 'finance.read') or app.has_permission(p_company, 'reports.read')) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  if v_by not in ('month', 'unit') then raise exception 'Show it by month or by unit' using errcode = '22023'; end if;
  if v_to < v_from or v_to - v_from > 1100 then raise exception 'Check the dates' using errcode = '22023'; end if;

  with
  s as (select f.*, case when v_by = 'month' then to_char(f.d, 'YYYY-MM') else coalesce(f.warehouse_id::text, 'none') end as col
          from app.analysis_sales(p_company, v_from, v_to) f
         where cardinality(v_units) = 0 or f.warehouse_id = any (v_units)),
  sales as (
    select col,
           coalesce(sum(net) filter (where not is_return), 0) + coalesce(sum(discount) filter (where not is_return), 0) as gross_sales,
           coalesce(sum(discount) filter (where not is_return), 0) as discounts,
           -coalesce(sum(net) filter (where is_return), 0) as returns,
           sum(net) as net_sales, sum(cost) as cogs
      from s group by col),
  -- the books: expense, depreciation, other expense / income; interest by the account's name
  glu as (
    select e.entry_date, jl.debit - jl.credit as amt, a.name, a.account_type, a.account_subtype,
           (select w.id from public.warehouses w join public.cost_centers cc on cc.id = jl.cost_center_id
             where w.company_id = p_company and w.deleted_at is null and lower(w.code) = lower(cc.code) limit 1) as unit_id
      from public.journal_lines jl
      join public.journal_entries e on e.id = jl.entry_id
      join public.accounts a on a.id = jl.account_id
     where jl.company_id = p_company and e.status in ('posted', 'reversed') and e.entry_date between v_from and v_to
       and ((a.account_type = 'expense' and a.account_subtype in ('expense', 'depreciation', 'other_expense')) or (a.account_type = 'revenue' and a.account_subtype = 'other_income'))),
  gl as (
    select case when v_by = 'month' then to_char(entry_date, 'YYYY-MM') else coalesce(unit_id::text, 'shared') end as col,
           case when name ilike '%interes%' or name ilike '%interest%' then 'interest'
                when account_type = 'expense' and account_subtype in ('expense', 'depreciation') then 'opex'
                when account_type = 'expense' and account_subtype = 'other_expense' then 'other_expense'
                when account_type = 'revenue' and account_subtype = 'other_income' then 'other_income' end as line,
           sum(amt) as amt
      from glu
     -- by month for some units: only what is booked to those units
     where v_by = 'unit' or cardinality(v_units) = 0 or unit_id = any (v_units)
     group by 1, 2),
  cols as (
    -- by month, every month of the period, also one with nothing in it
    select distinct col from (select col from sales union select col from gl where line is not null
                              union select to_char(m, 'YYYY-MM') from generate_series(date_trunc('month', v_from), v_to, interval '1 month') m where v_by = 'month') x
     where v_by = 'month' or cardinality(v_units) = 0 or (case when col in ('shared', 'none') then col = 'shared' else col::uuid = any (v_units) end)),
  -- each unit's share of net sales, to split what is shared
  share as (select col, net_sales / nullif((select sum(net_sales) from sales where col <> 'none'), 0) as k from sales where col <> 'none'),
  cell as (
    select c.col,
           coalesce(sa.gross_sales, 0) as gross_sales, coalesce(sa.discounts, 0) as discounts, coalesce(sa.returns, 0) as returns,
           coalesce(sa.net_sales, 0) as net_sales, coalesce(sa.cogs, 0) as cogs,
           coalesce((select sum(amt) from gl where gl.col = c.col and line = 'opex'), 0)
             + case when v_split and v_by = 'unit' and c.col <> 'shared' then coalesce((select k from share where share.col = c.col), 0) * coalesce((select sum(amt) from gl where gl.col = 'shared' and line = 'opex'), 0) else 0 end as opex,
           coalesce((select sum(amt) from gl where gl.col = c.col and line = 'other_expense'), 0)
             + case when v_split and v_by = 'unit' and c.col <> 'shared' then coalesce((select k from share where share.col = c.col), 0) * coalesce((select sum(amt) from gl where gl.col = 'shared' and line = 'other_expense'), 0) else 0 end as other_expense,
           -coalesce((select sum(amt) from gl where gl.col = c.col and line = 'other_income'), 0)
             - case when v_split and v_by = 'unit' and c.col <> 'shared' then coalesce((select k from share where share.col = c.col), 0) * coalesce((select sum(amt) from gl where gl.col = 'shared' and line = 'other_income'), 0) else 0 end as other_income,
           coalesce((select sum(amt) from gl where gl.col = c.col and line = 'interest'), 0)
             + case when v_split and v_by = 'unit' and c.col <> 'shared' then coalesce((select k from share where share.col = c.col), 0) * coalesce((select sum(amt) from gl where gl.col = 'shared' and line = 'interest'), 0) else 0 end as interest
      from cols c left join sales sa on sa.col = c.col
     where not (v_split and v_by = 'unit' and c.col = 'shared'))
  select jsonb_agg(jsonb_build_object('key', col,
           'label', case when v_by = 'month' then col when col = 'shared' then 'Shared' when col = 'none' then 'No unit' else (select name from public.warehouses where id::text = col) end)
           order by case when col in ('shared', 'none') then 1 else 0 end, case when v_by = 'month' then col else (select name from public.warehouses where id::text = col) end),
         jsonb_object_agg(col, jsonb_build_object(
           'gross_sales', round(gross_sales, 2), 'discounts', round(discounts, 2), 'returns', round(returns, 2), 'net_sales', round(net_sales, 2),
           'cogs', round(cogs, 2), 'gross_profit', round(net_sales - cogs, 2), 'gross_margin_pct', round(100 * (net_sales - cogs) / nullif(net_sales, 0), 1),
           'opex', round(opex, 2), 'other_expense', round(other_expense, 2), 'other_income', round(other_income, 2), 'interest', round(interest, 2),
           'net_profit', round(net_sales - cogs - opex - other_expense + other_income - interest, 2),
           'net_margin_pct', round(100 * (net_sales - cogs - opex - other_expense + other_income - interest) / nullif(net_sales, 0), 1)))
    into v_cols, v_cells
    from cell;

  return jsonb_build_object('from', v_from, 'to', v_to, 'by', v_by, 'shared', case when v_split then 'split' else 'apart' end,
    'columns', coalesce(v_cols, '[]'), 'cells', coalesce(v_cells, '{}'), 'currency', (select base_currency from public.companies where id = p_company));
end $$;
revoke all on function public.profit_report(uuid, jsonb) from public, anon;
grant execute on function public.profit_report(uuid, jsonb) to authenticated;
