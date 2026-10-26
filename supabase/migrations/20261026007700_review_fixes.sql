-- =============================================================================
-- DrisPRO · fixes from the review before going live (sales, purchasing, finance, payroll)
--   Sales
--   · documents in another currency take the rate of their date (no more silent 1.0); posting a
--     foreign-currency invoice, bill or payment without a rate is refused
--   · prices in another currency: customer prices are converted, a missing rate is an error
--   · a credit note settles the invoice it corrects (the invoice is no longer "unpaid" forever)
--   · a price-correction credit note no longer lets the order be invoiced again
--   · goods delivered on an order that was closed can still be invoiced
--   · importing customers: an empty credit limit means no limit (was 0, blocking every order)
--   · the credit limit and the default discount of a customer change only with sales.approve
--   · running every company's recurring invoices at once is for the server only
--   Purchasing
--   · a vendor credit does not reopen the order for billing; on stock it books a price difference,
--     not a GRNI credit that never clears
--   · a bill for stock (with or without an order) clears goods received not invoiced
--   · invoices read with AI keep the invoice's currency (the receipt converts it)
--   · replenishment counts goods on the road to the warehouse
--   · customer returns come back at the item's average cost, not at a typed price
--   Finance and people
--   · Kosovo VAT settlement leaves no balance behind when there are credit notes
--   · a late (back-dated) asset no longer stops all depreciation: past months post in the first open month
--   · leave changed after it was submitted is checked again
--   · a contract that changes during the month: one payslip, each contract paying its own days
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

-- ---------------------------------------------------------------------------
-- exchange rates on documents
-- ---------------------------------------------------------------------------
create or replace function app.tg_document_rate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_date date := (to_jsonb(new) ->> tg_argv[0])::date; v_rate numeric; v_base text;
begin
  select base_currency into v_base from public.companies where id = new.company_id;
  if new.currency_code is null or new.currency_code = v_base then new.exchange_rate := 1; return new; end if;
  if coalesce(to_jsonb(new) ->> 'status', 'draft') <> 'draft' then return new; end if;
  -- a credit note keeps the rate of the invoice it corrects
  if coalesce(to_jsonb(new) ->> 'document_type', '') in ('credit_note', 'vendor_credit') then return new; end if;
  if tg_op = 'INSERT' or new.currency_code is distinct from old.currency_code
     or (to_jsonb(new) ->> tg_argv[0]) is distinct from (to_jsonb(old) ->> tg_argv[0]) then
    -- an invoice or bill takes the rate of its own date; a quote or order keeps a rate the person typed
    if tg_op = 'INSERT' and new.exchange_rate <> 1 and tg_table_name not in ('sales_invoices', 'vendor_bills') then return new; end if;
    if tg_op = 'UPDATE' and new.exchange_rate is distinct from old.exchange_rate and new.exchange_rate <> 1 then return new; end if;
    v_rate := app.exchange_rate(new.company_id, new.currency_code, coalesce(v_date, current_date));
    if v_rate is not null then new.exchange_rate := v_rate; end if;
  end if;
  return new;
end $$;

-- posting in another currency at 1.0 means the rate is missing
create or replace function app.tg_posting_needs_rate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'posted' and old.status is distinct from 'posted' and new.exchange_rate = 1
     and new.currency_code <> (select base_currency from public.companies where id = new.company_id) then
    raise exception 'No exchange rate for % on %; add it in Finance → Currencies first', new.currency_code,
      to_char(coalesce((to_jsonb(new) ->> tg_argv[0])::date, current_date), 'DD.MM.YYYY') using errcode = '23514';
  end if;
  return new;
end $$;

do $$
declare r record;
begin
  for r in select * from (values ('sales_quotes', 'quote_date'), ('sales_orders', 'order_date'), ('sales_invoices', 'invoice_date'),
                                 ('purchase_orders', 'order_date'), ('vendor_bills', 'bill_date'), ('goods_receipts', 'receipt_date')) t(tbl, col) loop
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = r.tbl and column_name = 'exchange_rate') then continue; end if;
    execute format('create trigger trg_07_rate before insert or update of currency_code, %I, exchange_rate on public.%I for each row execute function app.tg_document_rate(%L)',
                   r.col, r.tbl, r.col);
  end loop;
  for r in select * from (values ('sales_invoices', 'invoice_date'), ('vendor_bills', 'bill_date'), ('payments', 'payment_date')) t(tbl, col) loop
    execute format('create trigger trg_08_posting_rate before update of status on public.%I for each row execute function app.tg_posting_needs_rate(%L)', r.tbl, r.col);
  end loop;
end $$;

-- prices in another currency: convert the customer price too; no rate is an error, not 1.0
create or replace function app.rate_or_fail(p_company uuid, p_currency text, p_date date)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare v numeric := app.exchange_rate(p_company, p_currency, p_date);
begin
  if v is null then raise exception 'No exchange rate for % on %; add it in Finance → Currencies first', p_currency, to_char(p_date, 'DD.MM.YYYY') using errcode = '23514'; end if;
  return v;
end $$;
select app._patch_function('public.get_price',
  $x$      v_price := coalesce(v_cp.price, v_base);$x$,
  $x$      v_price := coalesce(v_cp.price, v_base);
      if v_cur <> v_base_cur then v_price := round(v_price / app.rate_or_fail(p_company, v_cur, p_date), 4); end if;$x$);
select app._patch_function('public.get_price',
  $x$          v_price := round(v_price * coalesce(app.exchange_rate(p_company, v_list.currency_code, p_date), 1)
                           / coalesce(app.exchange_rate(p_company, v_cur, p_date), 1), 4);$x$,
  $x$          v_price := round(v_price * app.rate_or_fail(p_company, v_list.currency_code, p_date)
                           / app.rate_or_fail(p_company, v_cur, p_date), 4);$x$);
select app._patch_function('public.get_price',
  $x$      v_price := round(v_price / coalesce(app.exchange_rate(p_company, v_cur, p_date), 1), 4);$x$,
  $x$      v_price := round(v_price / app.rate_or_fail(p_company, v_cur, p_date), 4);$x$);

-- ---------------------------------------------------------------------------
-- credit notes settle what they correct
-- ---------------------------------------------------------------------------
create or replace function app.refresh_payment_status(p_table text, p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_table = 'sales_invoices' then
    update public.sales_invoices i
       set amount_paid = case when i.document_type = 'credit_note' then case when i.status = 'posted' then i.total else 0 end
                         else coalesce((select sum(a.amount) from public.payment_allocations a join public.payments p on p.id = a.payment_id
                                          where a.sales_invoice_id = i.id and p.status = 'posted'), 0)
                            + coalesce((select sum(c.total) from public.sales_invoices c
                                         where c.original_invoice_id = i.id and c.document_type = 'credit_note' and c.status = 'posted' and c.deleted_at is null), 0) end
     where i.id = p_id;
    update public.sales_invoices set payment_status = case when amount_paid <= 0 then 'unpaid' when amount_paid < total then 'partially_paid' else 'paid' end
     where id = p_id;
  else
    update public.vendor_bills b
       set amount_paid = case when b.document_type = 'vendor_credit' then case when b.status = 'posted' then b.total else 0 end
                         else coalesce((select sum(a.amount) from public.payment_allocations a join public.payments p on p.id = a.payment_id
                                          where a.vendor_bill_id = b.id and p.status = 'posted'), 0)
                            + coalesce((select sum(c.total) from public.vendor_bills c
                                         where c.original_bill_id = b.id and c.document_type = 'vendor_credit' and c.status = 'posted' and c.deleted_at is null), 0) end
     where b.id = p_id;
    update public.vendor_bills set payment_status = case when amount_paid <= 0 then 'unpaid' when amount_paid < total then 'partially_paid' else 'paid' end
     where id = p_id;
  end if;
end $$;

select app._patch_function('public.post_sales_invoice',
  $x$  for l in select il.*, sl.quantity as so_qty, sl.qty_invoiced as so_inv, sl.qty_delivered as so_del, sl.sales_order_id$x$,
  $x$  for l in select il.*, sl.quantity as so_qty, sl.qty_invoiced as so_inv, sl.qty_delivered as so_del, sl.sales_order_id,
                  sl.unit_price as so_price, sl.discount_pct as so_disc$x$);
select app._patch_function('public.post_sales_invoice',
  $x$      update public.sales_order_lines set qty_invoiced = greatest(qty_invoiced + v_sign * l.quantity, 0) where id = l.sales_order_line_id;$x$,
  $x$      -- a credit note gives the units back only when it credits them at their price (a return);
      -- a price correction leaves what was invoiced as it is
      if v_sign = 1 or (l.unit_price = l.so_price and l.discount_pct = l.so_disc) then
        update public.sales_order_lines set qty_invoiced = greatest(qty_invoiced + v_sign * l.quantity, 0) where id = l.sales_order_line_id;
      end if;$x$);
select app._patch_function('public.post_sales_invoice',
  $x$  v_order := coalesce(v_order, i.sales_order_id);$x$,
  $x$  if i.document_type = 'credit_note' then
    perform app.refresh_payment_status('sales_invoices', i.id);
    if i.original_invoice_id is not null then perform app.refresh_payment_status('sales_invoices', i.original_invoice_id); end if;
  end if;
  v_order := coalesce(v_order, i.sales_order_id);$x$);

-- delivered goods on a closed order can still be invoiced
select app._patch_function('public.create_invoice_from_order',
  $x$  if o.status not in ('confirmed','partially_delivered','delivered') then$x$,
  $x$  if o.status not in ('confirmed','partially_delivered','delivered','closed') then$x$);

-- importing: an empty credit limit is "no limit"
select app._patch_function('public.import_rows',
  $x$coalesce(nullif(r ->> 'credit_limit', '')::numeric, 0),$x$,
  $x$nullif(r ->> 'credit_limit', '')::numeric,$x$);

-- the credit limit and the default discount are the managers'
create or replace function app.tg_partner_credit_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.is_client_context() and (new.credit_limit is distinct from old.credit_limit or new.default_discount_pct is distinct from old.default_discount_pct)
     and not app.has_permission(new.company_id, 'sales.approve') then
    raise exception 'Only a sales manager changes the credit limit and the discount of a customer' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_05_credit_guard before update on public.business_partners
  for each row execute function app.tg_partner_credit_guard();

select app._patch_function('public.run_recurring_invoices',
  $x$  if p_company is not null then perform app.require_permission(p_company, 'invoicing.write'); end if;$x$,
  $x$  if p_company is not null then perform app.require_permission(p_company, 'invoicing.write');
  elsif coalesce(current_setting('role', true), '') in ('authenticated', 'anon') then
    raise exception 'Only the server runs this for every company' using errcode = '42501'; end if;$x$);

-- ---------------------------------------------------------------------------
-- purchasing
-- ---------------------------------------------------------------------------
select app._patch_function('public.post_vendor_bill',
  $x$    update public.purchase_order_lines set qty_billed = greatest(qty_billed + v_sign * l.quantity, 0) where id = l.po_line_id;$x$,
  $x$    -- a vendor credit is money back, not goods back: what was billed on the order stays billed
    if v_sign = 1 then
      update public.purchase_order_lines set qty_billed = qty_billed + l.quantity where id = l.po_line_id;
    end if;$x$);
select app._patch_function('public.post_vendor_bill',
  $x$  update public.vendor_bills set status = 'posted', posted_at = now() where id = b.id;
$x$,
  $x$  update public.vendor_bills set status = 'posted', posted_at = now() where id = b.id;
  if b.document_type = 'vendor_credit' then
    perform app.refresh_payment_status('vendor_bills', b.id);
    if b.original_bill_id is not null then perform app.refresh_payment_status('vendor_bills', b.original_bill_id); end if;
  end if;
$x$);

-- the vendor bill in the books: stock lines clear GRNI (with or without an order); a credit on stock is a price difference
select app._patch_function('app.gl_vendor_bill',
  $x$    if l.po_line_id is not null and l.product_type = 'stockable' and l.account_id is null then$x$,
  $x$    if s = -1 and l.product_type = 'stockable' and l.account_id is null then
      -- money back on goods already received: a price difference, not goods going back
      v_exp := app.item_acct(b.company_id, l.item_id, 'purchase_price_variance');
      v_lines := v_lines || jsonb_build_object('account_id', v_exp, 'amount', s * v_base, 'variant_id', l.item_id,
                                               'partner_id', b.vendor_id, 'description', l.description);
    elsif l.po_line_id is null and l.receipt_line_id is not null and l.product_type = 'stockable' and l.account_id is null then
      -- goods came in on a receipt (which credited GRNI): the bill clears it
      v_lines := v_lines || jsonb_build_object('account_id', app.acct(b.company_id, 'grni'), 'amount', s * v_base, 'variant_id', l.item_id,
                                               'partner_id', b.vendor_id, 'description', l.description);
      v_exp := app.item_acct(b.company_id, l.item_id, 'inventory');
    elsif l.po_line_id is not null and l.product_type = 'stockable' and l.account_id is null then$x$);

-- an invoice read with AI: the price is in the invoice's currency; the receipt converts it
select app._patch_function('public.doc_read_to_receipt',
  $x$coalesce((l ->> 'unit_cost')::numeric, 0), coalesce((l ->> 'unit_cost')::numeric, 0));$x$,
  $x$null, (l ->> 'unit_cost')::numeric);$x$);

-- replenishment: goods on the road count as coming
select app._patch_function('app.replenish_core',
  $x$           + coalesce((select sum(tl.quantity - tl.quantity_done) from public.stock_transfer_lines tl join public.stock_transfers t on t.id = tl.transfer_id$x$,
  $x$           + coalesce((select sum(case when t.status = 'in_transit' then tl.quantity_done - coalesce(tl.quantity_received, 0)
                                        else tl.quantity - tl.quantity_done end)
                         from public.stock_transfer_lines tl join public.stock_transfers t on t.id = tl.transfer_id$x$);

-- customer returns come back at the average cost
select app._patch_function('public.post_goods_receipt',
  $x$    v_cost := round(coalesce(
                l.unit_cost,$x$,
  $x$    v_cost := round(coalesce(
                case when r.receipt_type = 'customer_return' then (select ic.avg_cost from public.item_costs ic where ic.variant_id = l.variant_id and ic.avg_cost > 0) end,
                l.unit_cost,$x$);

-- ---------------------------------------------------------------------------
-- finance and people
-- ---------------------------------------------------------------------------
-- Kosovo: credit notes sit on the opposite side of the form; the ledger has them on their own side
select app._patch_function('public.submit_vat_declaration',
  $x$declare d public.vat_declarations; v_je uuid; v_lines jsonb; v_net numeric;$x$,
  $x$declare d public.vat_declarations; v_je uuid; v_lines jsonb; v_net numeric; v_notes numeric := 0;$x$);
select app._patch_function('public.submit_vat_declaration',
  $x$  v_net := d.output_vat - d.input_vat;$x$,
  $x$  v_net := d.output_vat - d.input_vat;
  v_notes := coalesce((public.vat_return_preview(d.company_id, d.period_start, d.period_end) -> 'ledger' ->> 'credit_notes_moved')::numeric, 0);$x$);
select app._patch_function('public.submit_vat_declaration',
  $x$'amount', d.output_vat, 'description', 'Output VAT '$x$,
  $x$'amount', d.output_vat - v_notes, 'description', 'Output VAT '$x$);
select app._patch_function('public.submit_vat_declaration',
  $x$'amount', -d.input_vat, 'description', 'Input VAT '$x$,
  $x$'amount', -(d.input_vat - v_notes), 'description', 'Input VAT '$x$);

-- depreciation of a month that is already closed goes into the first open month
create or replace function app.first_open_date(p_company uuid, p_date date)
returns date language sql stable security definer set search_path = '' as $$
  select coalesce((select p_date from public.fiscal_periods where company_id = p_company and p_date between start_date and end_date and status = 'open'),
                  (select min(start_date) from public.fiscal_periods where company_id = p_company and status = 'open' and end_date >= p_date),
                  p_date)
$$;
select app._patch_function('public.run_depreciation',
  $x$    v_je := app.gl_post(p_company, 'DEP', m.period_date, null, null,$x$,
  $x$    v_je := app.gl_post(p_company, 'DEP', app.first_open_date(p_company, m.period_date), null, null,$x$);

-- leave: a submitted request changed afterwards is checked again
select app._patch_function('app.tg_leave_validate',
  $x$  if new.status <> 'submitted' or (tg_op = 'UPDATE' and old.status = 'submitted') then return new; end if;$x$,
  $x$  if new.status <> 'submitted' or (tg_op = 'UPDATE' and old.status = 'submitted' and new.start_date = old.start_date
                                     and new.end_date = old.end_date and new.leave_type_id = old.leave_type_id) then return new; end if;$x$);
drop trigger trg_06_validate on public.leave_requests;
create trigger trg_06_validate before insert or update of status, start_date, end_date, leave_type_id on public.leave_requests
  for each row execute function app.tg_leave_validate();

-- payroll: one payslip per person, each contract of the month paying its own days
CREATE OR REPLACE FUNCTION public.calculate_payroll(p_run uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.payroll_runs; pr jsonb; k record; v_slip uuid; v_wd numeric; v_paid numeric; v_unpaid numeric; v_ratio numeric;
  v_basic numeric; v_ot_h numeric; v_ot numeric; v_extra numeric; v_gross numeric; v_base numeric; v_ss_ee numeric; v_hi_ee numeric;
  v_ss_er numeric; v_hi_er numeric; v_ee numeric; v_er numeric; v_taxable numeric; v_tax numeric; v_hourly numeric; v_n int := 0; it record; v_absent numeric; v_deduct boolean; v_pay numeric;
begin
  select * into r from public.payroll_runs where id = p_run for update;
  if r.id is null then raise exception 'Payroll run not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'payroll.write');
  if r.status not in ('draft','calculated') then raise exception 'Payroll % is %', r.number, r.status using errcode = '55000'; end if;
  pr := public.payroll_params(r.country_rules, r.period_end);
  if pr is null then raise exception 'No payroll rules for % on %', r.country_rules, r.period_end using errcode = 'P0002'; end if;

  delete from public.payslips where payroll_run_id = r.id;
  -- one payslip per person: when a contract changes during the month (a raise), each contract pays its own days
  -- and the tax is worked out once on the whole month; the latest contract gives the other terms
  for k in
    select * from (
      select distinct on (e.id) c.*, e.full_name, e.hire_date, e.termination_date, e.cost_center_id as emp_cc, d.cost_center_id as dept_cc
        from public.employment_contracts c join public.employees e on e.id = c.employee_id
        left join public.departments d on d.id = e.department_id
       where c.company_id = r.company_id and c.deleted_at is null and e.deleted_at is null and c.status in ('active','ended')
         and c.start_date <= r.period_end and (c.end_date is null or c.end_date >= r.period_start)
         and e.hire_date <= r.period_end and (e.termination_date is null or e.termination_date >= r.period_start)
       order by e.id, c.start_date desc) x
     order by x.full_name
  loop
    -- days: working days of the month; paid = working days employed under this contract, less unpaid leave
    v_wd := app.working_days(r.company_id, r.period_start, r.period_end);
    select coalesce(sum(x.d), 0), coalesce(sum(x.g * x.d), 0) into v_paid, v_pay
      from (select c2.gross_salary as g,
                   app.working_days(r.company_id, greatest(r.period_start, c2.start_date, k.hire_date),
                                    least(r.period_end, coalesce(c2.end_date, r.period_end), coalesce(k.termination_date, r.period_end))) as d
              from public.employment_contracts c2
             where c2.employee_id = k.employee_id and c2.company_id = r.company_id and c2.deleted_at is null and c2.status in ('active','ended')
               and c2.start_date <= r.period_end and (c2.end_date is null or c2.end_date >= r.period_start)) x;
    select coalesce(sum(app.working_days(r.company_id, greatest(lr.start_date, r.period_start), least(lr.end_date, r.period_end))), 0) into v_unpaid
      from public.leave_requests lr join public.leave_types t on t.id = lr.leave_type_id
     where lr.employee_id = k.employee_id and lr.status = 'approved' and lr.deleted_at is null and not t.is_paid
       and lr.start_date <= r.period_end and lr.end_date >= r.period_start;
    select coalesce(payroll_deduct_absence, false) into v_deduct from public.company_settings where company_id = r.company_id;
    v_absent := 0;
    if v_deduct and exists (select 1 from public.attendance_records a where a.employee_id = k.employee_id and a.work_date between r.period_start and r.period_end) then
      select count(*) into v_absent
        from generate_series(greatest(r.period_start, k.start_date, k.hire_date),
                             least(r.period_end, coalesce(k.end_date, r.period_end), coalesce(k.termination_date, r.period_end), current_date - 1), interval '1 day') g(d)
       where app.working_days(r.company_id, g.d::date, g.d::date) > 0
         and not exists (select 1 from public.attendance_records a where a.employee_id = k.employee_id and a.work_date = g.d::date)
         and not exists (select 1 from public.leave_requests lr where lr.employee_id = k.employee_id and lr.status = 'approved' and lr.deleted_at is null
                          and g.d::date between lr.start_date and lr.end_date);
      v_unpaid := v_unpaid + v_absent;
    end if;
    v_paid := greatest(v_paid - v_unpaid, 0);
    v_ratio := case when v_wd > 0 then v_paid / v_wd else 0 end;
    v_basic := case when v_wd > 0 then greatest(round((v_pay - k.gross_salary * v_unpaid) / v_wd, 2), 0) else 0 end;
    -- overtime from attendance, at the statutory premium
    select coalesce(sum(a.overtime_hours), 0) into v_ot_h from public.attendance_records a
     where a.employee_id = k.employee_id and a.work_date between r.period_start and r.period_end;
    v_hourly := k.gross_salary / nullif(k.working_hours_per_week * 52 / 12, 0);
    v_ot := round(v_ot_h * coalesce(v_hourly, 0) * (1 + (pr ->> 'overtime_pct')::numeric / 100), 2);
    select coalesce(sum(amount), 0) into v_extra from public.payroll_run_items where payroll_run_id = r.id and employee_id = k.employee_id;
    v_gross := v_basic + v_ot + v_extra;

    if r.country_rules = 'AL' then
      v_base := least(greatest(v_gross, round((pr ->> 'ss_min')::numeric * v_ratio, 2)), (pr ->> 'ss_max')::numeric);
      v_ss_ee := round(v_base * (pr ->> 'ss_ee')::numeric / 100, 0);
      v_hi_ee := round(v_gross * (pr ->> 'hi_ee')::numeric / 100, 0);
      v_ss_er := round(v_base * (pr ->> 'ss_er')::numeric / 100, 0);
      v_hi_er := round(v_gross * (pr ->> 'hi_er')::numeric / 100, 0);
      v_ee := v_ss_ee + v_hi_ee; v_er := v_ss_er + v_hi_er;
      v_taxable := v_gross;
      v_tax := public.payroll_income_tax('AL', v_gross, pr);
    else
      v_base := v_gross;
      v_ss_ee := round(v_gross * (pr ->> 'pension_ee')::numeric / 100, 2); v_hi_ee := 0;
      v_ss_er := round(v_gross * (pr ->> 'pension_er')::numeric / 100, 2); v_hi_er := 0;
      v_ee := v_ss_ee; v_er := v_ss_er;
      v_taxable := v_gross - v_ss_ee;
      v_tax := public.payroll_income_tax('XK', v_taxable, pr, not k.is_primary_employer);
    end if;

    insert into public.payslips (company_id, payroll_run_id, employee_id, contract_id, worked_days, working_days, paid_days, unpaid_leave_days,
                                 overtime_hours, gross_salary, contribution_base, employee_contributions, taxable_income, income_tax,
                                 net_salary, employer_contributions, cost_center_id)
    values (r.company_id, r.id, k.employee_id, k.id, v_paid, v_wd, v_paid, v_unpaid, v_ot_h, v_gross, v_base, v_ee, v_taxable, v_tax,
            v_gross - v_ee - v_tax, v_er, coalesce(k.emp_cc, k.dept_cc))
    returning id into v_slip;

    insert into public.payslip_lines (company_id, payslip_id, line_type, code, name, base, rate_pct, amount)
    select r.company_id, v_slip, x.t, x.c, x.n, x.b, x.p, x.a from (values
      ('earning', 'BASIC', 'Basic salary · ' || trim_scale(v_paid) || ' of ' || trim_scale(v_wd) || ' days', k.gross_salary, null::numeric, v_basic),
      ('earning', 'OVERTIME', 'Overtime · ' || trim_scale(v_ot_h) || ' h at +' || (pr ->> 'overtime_pct') || '%', round(coalesce(v_hourly, 0), 2), null, v_ot),
      ('employee_contribution', case when r.country_rules = 'AL' then 'SOC_EE' else 'PENSION_EE' end,
         case when r.country_rules = 'AL' then 'Social insurance' else 'Pension (Trust)' end, v_base,
         case when r.country_rules = 'AL' then (pr ->> 'ss_ee')::numeric else (pr ->> 'pension_ee')::numeric end, v_ss_ee),
      ('employee_contribution', 'HEALTH_EE', 'Health insurance', v_gross, (pr ->> 'hi_ee')::numeric, v_hi_ee),
      ('tax', case when r.country_rules = 'AL' then 'TAP' else 'TAX' end,
         case when r.country_rules = 'AL' then 'Income tax (TAP)' when not k.is_primary_employer then 'Income tax (secondary employer)' else 'Income tax' end,
         v_taxable, null, v_tax),
      ('employer_contribution', case when r.country_rules = 'AL' then 'SOC_ER' else 'PENSION_ER' end,
         case when r.country_rules = 'AL' then 'Social insurance (employer)' else 'Pension (employer)' end, v_base,
         case when r.country_rules = 'AL' then (pr ->> 'ss_er')::numeric else (pr ->> 'pension_er')::numeric end, v_ss_er),
      ('employer_contribution', 'HEALTH_ER', 'Health insurance (employer)', v_gross, (pr ->> 'hi_er')::numeric, v_hi_er)
    ) x(t, c, n, b, p, a)
    where x.a <> 0 or x.c in ('BASIC');
    for it in select * from public.payroll_run_items where payroll_run_id = r.id and employee_id = k.employee_id loop
      insert into public.payslip_lines (company_id, payslip_id, line_type, code, name, amount)
      values (r.company_id, v_slip, 'earning', it.code, it.name, it.amount);
    end loop;
    v_n := v_n + 1;
  end loop;

  update public.payroll_runs set status = 'calculated', calculated_by = auth.uid(), calculated_at = now(), employee_count = v_n,
         total_gross = coalesce((select sum(gross_salary) from public.payslips where payroll_run_id = r.id), 0),
         total_employee_contrib = coalesce((select sum(employee_contributions) from public.payslips where payroll_run_id = r.id), 0),
         total_income_tax = coalesce((select sum(income_tax) from public.payslips where payroll_run_id = r.id), 0),
         total_net = coalesce((select sum(net_salary) from public.payslips where payroll_run_id = r.id), 0),
         total_employer_contrib = coalesce((select sum(employer_contributions) from public.payslips where payroll_run_id = r.id), 0)
   where id = r.id;
  return jsonb_build_object('employees', v_n);
end $function$

;

drop function app._patch_function(text, text, text);
