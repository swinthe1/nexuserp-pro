-- =============================================================================
-- DrisPRO · a report filter can hold several values (10.11.2026)
--   · "Në kolona: Furnitori" can be narrowed to one supplier or a few: the filter takes a list,
--     and an empty list means all of them.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.run_report(p_company uuid, p_report text, p jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_from date := coalesce(nullif(p ->> 'from', '')::date, date_trunc('year', current_date)::date);
  v_to date := coalesce(nullif(p ->> 'to', '')::date, current_date);
  v_dim text := coalesce(nullif(p ->> 'group_by', ''), 'month');
  v_filters jsonb := coalesce(p -> 'filters', '{}'::jsonb);
  v_dims jsonb; v_measures text; v_cols jsonb; v_src text; v_where text := 'true'; k text; v_sql text; v_rows jsonb; v_totals jsonb;
  v_perm text; v_key text; v_label text; v_sort text; v_href text := 'null::text'; f record; v_pv text := nullif(p ->> 'pivot_by', ''); v_pivot jsonb;
begin
  v_perm := case p_report when 'sales' then 'sales.read' when 'margin' then 'sales.read' when 'purchases' then 'procurement.read'
                          when 'inventory' then 'inventory.read' when 'stock_aging' then 'inventory.read' when 'payroll' then 'payroll.read'
                          when 'vat' then 'tax.read' when 'production' then 'manufacturing.read' when 'receivables' then 'invoicing.read' end;
  if v_perm is null then raise exception 'Unknown report %', p_report using errcode = '22023'; end if;
  if not (app.has_permission(p_company, v_perm) and (app.has_permission(p_company, 'reports.read') or app.has_permission(p_company, split_part(v_perm, '.', 1) || '.write'))) then
    raise exception 'Permission denied: % and reports.read required', v_perm using errcode = '42501';
  end if;

  -- dimension catalog per report: {dim: [key sql, label sql, sort sql]}
  if p_report in ('sales','margin') then
    v_src := format('app.sales_facts(%L, %L, %L)', p_company, v_from, v_to);
    v_dims := jsonb_build_object(
      'month', jsonb_build_array('to_char(doc_date, ''YYYY-MM'')', 'to_char(doc_date, ''YYYY-MM'')', 'min(doc_date)'),
      'customer', jsonb_build_array('coalesce(partner_id::text, case when doc_type = ''cost_correction'' then ''correction'' else ''retail'' end)', 'min(partner)', 'sum(net) desc'),
      'warehouse', jsonb_build_array('coalesce(warehouse_id::text, ''none'')', 'coalesce(min(warehouse), ''No warehouse'')', 'sum(net) desc'),
      'vendor', jsonb_build_array('coalesce(vendor_id::text, ''none'')', 'coalesce(min(vendor), ''No supplier'')', 'sum(net) desc'),
      'product', jsonb_build_array('coalesce(variant_id::text, product)', 'min(product)', 'sum(net) desc'),
      'category', jsonb_build_array('coalesce(category_id::text, category)', 'min(category)', 'sum(net) desc'),
      'salesperson', jsonb_build_array('coalesce(salesperson_id::text, ''none'')', 'coalesce((select coalesce(pr.full_name, pr.email) from public.profiles pr where pr.id = min(salesperson_id::text)::uuid), ''Unassigned'')', 'sum(net) desc'),
      'channel', jsonb_build_array('channel', 'initcap(min(channel))', 'sum(net) desc'),
      'city', jsonb_build_array('coalesce(city, ''—'')', 'coalesce(min(city), ''—'')', 'sum(net) desc'),
      'document', jsonb_build_array('doc_id::text', 'min(doc_number)', 'min(doc_date) desc'));
    v_measures := 'count(distinct doc_id) as documents, round(sum(qty), 2) as quantity, round(sum(net), 2) as revenue, round(sum(cost), 2) as cost, '
               || 'round(sum(net) - sum(cost), 2) as margin, round(100 * (sum(net) - sum(cost)) / nullif(sum(net), 0), 1) as margin_pct';
    v_cols := jsonb_build_array(jsonb_build_object('key','documents','label','Documents','type','int'), jsonb_build_object('key','quantity','label','Quantity','type','qty'),
      jsonb_build_object('key','revenue','label','Revenue, without VAT','type','money'), jsonb_build_object('key','cost','label','Cost, without VAT','type','money'),
      jsonb_build_object('key','margin','label','Margin, without VAT','type','money'), jsonb_build_object('key','margin_pct','label','Margin %','type','pct'));
    if p_report = 'margin' then
      v_measures := v_measures || ', round(sum(gross) - sum(net), 2) as discount, round(100 * (sum(net) - sum(cost)) / nullif(sum(cost), 0), 1) as markup_pct, '
                 || 'count(*) filter (where qty > 0 and net < cost) as below_cost';
      v_cols := v_cols || jsonb_build_array(jsonb_build_object('key','discount','label','Discounts given, without VAT','type','money'),
        jsonb_build_object('key','markup_pct','label','Markup on cost %','type','pct'), jsonb_build_object('key','below_cost','label','Lines below cost','type','int'));
    end if;
    if v_dim = 'document' then v_href := 'min(href)'; end if;
  elsif p_report = 'purchases' then
    v_src := format('app.purchase_facts(%L, %L, %L)', p_company, v_from, v_to);
    v_dims := jsonb_build_object(
      'month', jsonb_build_array('to_char(doc_date, ''YYYY-MM'')', 'to_char(doc_date, ''YYYY-MM'')', 'min(doc_date)'),
      'vendor', jsonb_build_array('partner_id::text', 'min(partner)', 'sum(net) desc'),
      'product', jsonb_build_array('coalesce(variant_id::text, product)', 'min(product)', 'sum(net) desc'),
      'category', jsonb_build_array('coalesce(category_id::text, category)', 'min(category)', 'sum(net) desc'),
      'account', jsonb_build_array('coalesce(account, ''—'')', 'coalesce(min(account), ''Stock purchases'')', 'sum(net) desc'),
      'document', jsonb_build_array('doc_id::text', 'min(doc_number)', 'min(doc_date) desc'));
    v_measures := 'count(distinct doc_id) as documents, round(sum(qty), 2) as quantity, round(sum(net), 2) as amount, round(sum(vat), 2) as vat, round(sum(net) + sum(vat), 2) as total';
    v_cols := jsonb_build_array(jsonb_build_object('key','documents','label','Bills','type','int'), jsonb_build_object('key','quantity','label','Quantity','type','qty'),
      jsonb_build_object('key','amount','label','Amount without VAT','type','money'), jsonb_build_object('key','vat','label','VAT','type','money'),
      jsonb_build_object('key','total','label','Total with VAT','type','money'));
    if v_dim = 'document' then v_href := 'min(href)'; end if;
  elsif p_report in ('inventory','stock_aging') then
    v_src := format($s$(select s.*, v.sku || ' · ' || v.name as product, pr.category_id, coalesce(c.name, 'No category') as category, w.name as warehouse,
                               (%L::date - coalesce(s.last_out, s.last_in)) as idle_days, coalesce(v.sales_price_override, pr.sales_price, 0) as sales_price,
                               case when %L::date - coalesce(s.last_out, s.last_in) <= 30 then '0–30 days' when %L::date - coalesce(s.last_out, s.last_in) <= 90 then '31–90 days'
                                    when %L::date - coalesce(s.last_out, s.last_in) <= 180 then '91–180 days' else 'Over 180 days' end as age
                          from app.stock_as_of(%L, %L) s join public.product_variants v on v.id = s.variant_id join public.products pr on pr.id = v.product_id
                          left join public.product_categories c on c.id = pr.category_id join public.warehouses w on w.id = s.warehouse_id
                         where s.qty <> 0) x$s$, v_to, v_to, v_to, v_to, p_company, v_to);
    v_dims := jsonb_build_object(
      'warehouse', jsonb_build_array('warehouse_id::text', 'min(warehouse)', 'sum(value) desc'),
      'category', jsonb_build_array('coalesce(category_id::text, ''none'')', 'min(category)', 'sum(value) desc'),
      'age', jsonb_build_array('age', 'min(age)', 'min(idle_days)'),
      'product', jsonb_build_array('variant_id::text', 'min(product)', 'sum(value) desc'));
    v_measures := 'count(distinct variant_id) as items, round(sum(qty), 2) as quantity, round(sum(value), 2) as value, '
               || 'round(sum(value) / nullif(sum(qty), 0), 4) as unit_cost, max(idle_days) as idle_days';
    v_cols := jsonb_build_array(jsonb_build_object('key','items','label','Items','type','int'), jsonb_build_object('key','quantity','label','Quantity','type','qty'),
      jsonb_build_object('key','value','label','Value at cost, without VAT','type','money'), jsonb_build_object('key','unit_cost','label','Avg unit cost, without VAT','type','money'),
      jsonb_build_object('key','idle_days','label','Days since last movement','type','int'));
    if p_report = 'inventory' then
      v_measures := v_measures || ', round(sum(qty * sales_price), 2) as sales_value, round(sum(qty * sales_price) - sum(value), 2) as expected_margin';
      v_cols := v_cols || jsonb_build_array(jsonb_build_object('key','sales_value','label','Value at selling prices, without VAT','type','money'),
        jsonb_build_object('key','expected_margin','label','Margin when sold, without VAT','type','money'));
    end if;
    if p_report = 'stock_aging' and p ->> 'group_by' is null then v_dim := 'age'; end if;
    if p_report = 'inventory' and p ->> 'group_by' is null then v_dim := 'warehouse'; end if;
  elsif p_report = 'payroll' then
    v_src := format($s$(select r.period_start as doc_date, r.id as run_id, r.number, e.id as employee_id, e.full_name as employee, d.id as department_id,
                               coalesce(d.name, 'No department') as department, ps.gross_salary, ps.employee_contributions, ps.income_tax, ps.net_salary,
                               ps.employer_contributions
                          from public.payslips ps join public.payroll_runs r on r.id = ps.payroll_run_id join public.employees e on e.id = ps.employee_id
                          left join public.departments d on d.id = e.department_id
                         where r.company_id = %L and r.status in ('posted','paid') and r.deleted_at is null and r.period_start between %L and %L) x$s$,
                    p_company, date_trunc('month', v_from)::date, v_to);
    v_dims := jsonb_build_object(
      'month', jsonb_build_array('to_char(doc_date, ''YYYY-MM'')', 'to_char(doc_date, ''YYYY-MM'')', 'min(doc_date)'),
      'department', jsonb_build_array('coalesce(department_id::text, ''none'')', 'min(department)', 'sum(gross_salary) desc'),
      'employee', jsonb_build_array('employee_id::text', 'min(employee)', 'min(employee)'));
    v_measures := 'count(distinct employee_id) as employees, round(sum(gross_salary), 2) as gross, round(sum(employee_contributions), 2) as employee_contributions, '
               || 'round(sum(income_tax), 2) as income_tax, round(sum(net_salary), 2) as net, round(sum(employer_contributions), 2) as employer_contributions, '
               || 'round(sum(gross_salary + employer_contributions), 2) as employer_cost';
    v_cols := jsonb_build_array(jsonb_build_object('key','employees','label','Employees','type','int'), jsonb_build_object('key','gross','label','Gross','type','money'),
      jsonb_build_object('key','employee_contributions','label','Employee contributions','type','money'), jsonb_build_object('key','income_tax','label','Income tax','type','money'),
      jsonb_build_object('key','net','label','Net','type','money'), jsonb_build_object('key','employer_contributions','label','Employer contributions','type','money'),
      jsonb_build_object('key','employer_cost','label','Employer cost','type','money'));
  elsif p_report = 'vat' then
    v_src := format($s$(select e.*, case when e.side = 'sale' then e.vat * case when e.is_credit then -1 else 1 end else 0 end as output_vat,
                               case when e.side = 'purchase' and e.kind not in ('no_vat','no_vat_investment','non_deductible','non_deductible_investment')
                                    then e.vat * case when e.is_credit then -1 else 1 end else 0 end as input_vat,
                               case when e.kind = 'reverse_charge' then e.vat * case when e.is_credit then -1 else 1 end else 0 end as rc_vat,
                               e.base * case when e.is_credit then -1 else 1 end as signed_base
                          from app.vat_entries(%L, %L, %L) e) x$s$, p_company, v_from, v_to);
    v_dims := jsonb_build_object(
      'month', jsonb_build_array('to_char(doc_date, ''YYYY-MM'')', 'to_char(doc_date, ''YYYY-MM'')', 'min(doc_date)'),
      'treatment', jsonb_build_array('side || '':'' || kind || '':'' || rate', 'initcap(min(side)) || '' · '' || replace(min(kind), ''_'', '' '') || '' · '' || trim_scale(min(rate)) || ''%''', 'min(side), min(kind)'),
      'partner', jsonb_build_array('coalesce(partner, ''—'')', 'min(partner)', 'sum(abs(vat)) desc'),
      'document', jsonb_build_array('coalesce(doc_id::text, number)', 'min(number)', 'min(doc_date) desc'));
    v_measures := 'count(*) as entries, round(sum(signed_base), 2) as base, round(sum(output_vat) + sum(rc_vat), 2) as output_vat, '
               || 'round(sum(input_vat), 2) as input_vat, round(sum(output_vat) + sum(rc_vat) - sum(input_vat), 2) as net_vat';
    v_cols := jsonb_build_array(jsonb_build_object('key','entries','label','Entries','type','int'), jsonb_build_object('key','base','label','Taxable base','type','money'),
      jsonb_build_object('key','output_vat','label','Output VAT','type','money'), jsonb_build_object('key','input_vat','label','Input VAT','type','money'),
      jsonb_build_object('key','net_vat','label','Net VAT','type','money'));
    if v_dim = 'document' then v_href := 'min(href)'; end if;
  elsif p_report = 'production' then
    v_src := format($s$(select w.id as doc_id, w.number, '/manufacturing/orders/' || w.id as href, coalesce(w.closed_at, w.updated_at)::date as doc_date,
                               w.variant_id, v.sku || ' · ' || v.name as product, w.quantity_produced as qty,
                               w.planned_material_cost + w.planned_labor_cost + w.planned_overhead_cost as planned,
                               w.material_cost + w.labor_cost + w.overhead_cost as actual, w.output_value, w.variance_value, w.quantity_planned
                          from public.work_orders w join public.product_variants v on v.id = w.variant_id
                         where w.company_id = %L and w.status = 'closed' and w.deleted_at is null and coalesce(w.closed_at, w.updated_at)::date between %L and %L) x$s$,
                    p_company, v_from, v_to);
    v_dims := jsonb_build_object(
      'month', jsonb_build_array('to_char(doc_date, ''YYYY-MM'')', 'to_char(doc_date, ''YYYY-MM'')', 'min(doc_date)'),
      'product', jsonb_build_array('variant_id::text', 'min(product)', 'sum(actual) desc'),
      'document', jsonb_build_array('doc_id::text', 'min(number)', 'min(doc_date) desc'));
    v_measures := 'count(*) as work_orders, round(sum(qty), 2) as quantity, round(sum(planned * qty / nullif(quantity_planned, 0)), 2) as planned_cost, '
               || 'round(sum(actual), 2) as actual_cost, round(sum(variance_value), 2) as variance, round(sum(actual) / nullif(sum(qty), 0), 2) as unit_cost';
    v_cols := jsonb_build_array(jsonb_build_object('key','work_orders','label','Work orders','type','int'), jsonb_build_object('key','quantity','label','Made','type','qty'),
      jsonb_build_object('key','planned_cost','label','Planned for output, without VAT','type','money'), jsonb_build_object('key','actual_cost','label','Actual cost, without VAT','type','money'),
      jsonb_build_object('key','variance','label','Variance, without VAT','type','money'), jsonb_build_object('key','unit_cost','label','Unit cost, without VAT','type','money'));
    if v_dim = 'document' then v_href := 'min(href)'; end if;
  else -- receivables: open invoices as of the end date, by customer and age
    v_src := format($s$(select i.id as doc_id, i.number, '/sales/invoices/' || i.id as href, i.invoice_date as doc_date, i.due_date, i.partner_id, p.name as partner,
                               round(i.amount_due * i.exchange_rate, 2) as due, %L::date - i.due_date as overdue_days,
                               case when %L::date <= i.due_date then 'Not due' when %L::date - i.due_date <= 30 then '1–30 days'
                                    when %L::date - i.due_date <= 60 then '31–60 days' when %L::date - i.due_date <= 90 then '61–90 days' else 'Over 90 days' end as bucket
                          from public.sales_invoices i join public.business_partners p on p.id = i.partner_id
                         where i.company_id = %L and i.status = 'posted' and i.document_type = 'sales_invoice' and i.deleted_at is null and i.amount_due > 0) x$s$,
                    v_to, v_to, v_to, v_to, v_to, p_company);
    v_dims := jsonb_build_object(
      'bucket', jsonb_build_array('bucket', 'min(bucket)', 'min(overdue_days)'),
      'customer', jsonb_build_array('partner_id::text', 'min(partner)', 'sum(due) desc'),
      'document', jsonb_build_array('doc_id::text', 'min(number)', 'min(due_date)'));
    v_measures := 'count(*) as invoices, round(sum(due), 2) as due, max(overdue_days) as max_overdue';
    v_cols := jsonb_build_array(jsonb_build_object('key','invoices','label','Invoices','type','int'), jsonb_build_object('key','due','label','Open amount, with VAT','type','money'),
      jsonb_build_object('key','max_overdue','label','Most days overdue','type','int'));
    if p ->> 'group_by' is null then v_dim := 'bucket'; end if;
    if v_dim = 'document' then v_href := 'min(href)'; end if;
  end if;

  if not v_dims ? v_dim then raise exception 'Cannot group % by %', p_report, v_dim using errcode = '22023'; end if;
  -- filters: only known dims, values bound as literals
  -- a filter is one value, or a list of values (e.g. some suppliers chosen in the columns)
  for f in select * from jsonb_each(v_filters) loop
    if not v_dims ? f.key then raise exception 'Unknown filter %', f.key using errcode = '22023'; end if;
    if jsonb_typeof(f.value) = 'array' then
      if jsonb_array_length(f.value) > 0 then
        v_where := v_where || format(' and (%s) = any(%L::text[])', v_dims -> f.key ->> 0, array(select jsonb_array_elements_text(f.value)));
      end if;
    else
      v_where := v_where || format(' and (%s) = %L', v_dims -> f.key ->> 0, f.value #>> '{}');
    end if;
  end loop;
  v_key := v_dims -> v_dim ->> 0; v_label := v_dims -> v_dim ->> 1; v_sort := v_dims -> v_dim ->> 2;

  v_sql := format('select coalesce(jsonb_agg(to_jsonb(t) order by t._n), ''[]'') from (select row_number() over (order by %s) as _n, %s as key, %s as label, %s as href, %s from %s where %s group by %s) t',
                  v_sort, v_key, v_label, v_href, v_measures, v_src, v_where, v_key);
  execute v_sql into v_rows;
  execute format('select to_jsonb(t) from (select %s from %s where %s) t', v_measures, v_src, v_where) into v_totals;
  -- a second grouping across: one cell per row key and column key
  if v_pv is not null and v_pv <> v_dim then
    if not v_dims ? v_pv then raise exception 'Cannot group % by %', p_report, v_pv using errcode = '22023'; end if;
    execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]'') from (select %s as key, %s as col, %s as col_label, %s from %s where %s group by %s, %s) t',
                   v_key, v_dims -> v_pv ->> 0, v_dims -> v_pv ->> 1, v_measures, v_src, v_where, v_key, v_dims -> v_pv ->> 0) into v_pivot;
  end if;
  return jsonb_build_object('report', p_report, 'from', v_from, 'to', v_to, 'group_by', v_dim, 'filters', v_filters,
                            'dims', (select jsonb_agg(k2) from jsonb_object_keys(v_dims) k2), 'columns', v_cols, 'rows', v_rows, 'totals', v_totals, 'pivot_by', case when v_pivot is not null then v_pv end, 'pivot', v_pivot);
end $function$;
