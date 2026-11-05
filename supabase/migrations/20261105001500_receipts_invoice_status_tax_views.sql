-- =============================================================================
-- From the meeting with the administrative staff, #4 and #2 as restated on 5 November: the
-- standard split between the movement of goods and the tax books (as in SAP and Odoo).
--
-- 1. Goods in first, the tax invoice later. A goods receipt puts the stock in at once (quantity
--    and average cost; the books: Dr stock, Cr 4081 goods received not invoiced), so the goods
--    are sold at the till with their VAT. Each receipt now carries its fiscal status:
--      pending_invoice       goods in, the supplier's tax invoice not yet booked
--      tax_invoice_received  every line is on a posted purchase invoice in the VAT book
--      other_document        billed, but with a document outside the VAT book (a till receipt)
--      internal_movement     not a purchase (a customer's return, an internal receipt)
--    The VAT purchase book reads the posted purchase invoices only, never the receipts: what waits
--    for its invoice enters the book with the invoice, on the invoice's date. Nothing is hidden:
--    the stock, its cost and the debt to the supplier (4081) are in the books from the first day,
--    the list "Goods waiting for the invoice" shows each receipt and how long it waits, and the
--    buyers are reminded at 15, 30 and 60 days.
--
-- 2. Expenses: the tax view and the management view.
--      vendor_bills.in_vat_book        false for a till receipt or a paper without the buyer's
--                                      VAT: it stays out of the VAT purchase book and its VAT is
--                                      not deducted (the whole amount is the cost)
--      vendor_bill_lines.cit_deductible  null: as its account says (accounts.tax_nondeductible);
--                                      false / true: this expense is (not) recognised for the
--                                      profit tax. Every expense stays in the books; the profit tax
--                                      adds back what is not recognised.
--    management_costs (option B of #2): costs that are not paid to anyone (the "rent" of a shop
--    the company owns, a share of the office): only in the management view of the profit report.
--    The profit report shows two views of the same books: management (all real costs, less the
--    internal costs) and tax (the profit of the books, plus what is not recognised).
-- =============================================================================

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- ---------------------------------------------------------------- 1. the fiscal status of a receipt
alter table public.goods_receipts add column if not exists fiscal_status text
  check (fiscal_status in ('pending_invoice', 'tax_invoice_received', 'other_document', 'internal_movement'));
create index if not exists goods_receipts_fiscal_idx on public.goods_receipts (company_id, receipt_date) where fiscal_status = 'pending_invoice' and deleted_at is null;

alter table public.vendor_bills add column if not exists in_vat_book boolean not null default true;
alter table public.vendor_bill_lines add column if not exists cit_deductible boolean;

-- each accepted line of a receipt: how much of it is on posted purchase invoices
--   a bill made for the whole receipt covers every line; a bill line pointing at the receipt line
--   covers that line; a bill for the order covers the order's receipts first come, first billed
create or replace function app.receipt_lines_billed(p_receipt uuid)
returns table (line_id uuid, quantity numeric, unit_cost numeric, billed numeric, in_book boolean)
language sql stable security definer set search_path = '' as $$
  with r as (select * from public.goods_receipts where id = p_receipt),
  whole as (
    select bool_or(b.in_vat_book) as in_book
      from public.vendor_bills b, r
     where b.receipt_id = r.id and b.status = 'posted' and b.deleted_at is null and b.document_type = 'vendor_bill'),
  gl as (
    select gl.*, r.done_at as r_done
      from public.goods_receipt_lines gl join r on r.id = gl.receipt_id
     where gl.qc_status <> 'rejected'),
  direct as (
    select bl.receipt_line_id as id, sum(bl.quantity) as q, bool_or(b.in_vat_book) as in_book
      from public.vendor_bill_lines bl join public.vendor_bills b on b.id = bl.bill_id
     where bl.receipt_line_id in (select id from gl) and b.status = 'posted' and b.deleted_at is null and b.document_type = 'vendor_bill'
     group by 1),
  po_billed as (
    select bl.po_line_id as id, sum(bl.quantity) as q, bool_or(b.in_vat_book) as in_book
      from public.vendor_bill_lines bl join public.vendor_bills b on b.id = bl.bill_id
     where bl.po_line_id in (select po_line_id from gl where po_line_id is not null) and bl.receipt_line_id is null
       and b.status = 'posted' and b.deleted_at is null and b.document_type = 'vendor_bill'
     group by 1),
  -- what the order's earlier receipts took of that order line
  po_before as (
    select gl.id, coalesce((select sum(g2.quantity) from public.goods_receipt_lines g2 join public.goods_receipts r2 on r2.id = g2.receipt_id
                             where g2.po_line_id = gl.po_line_id and g2.qc_status <> 'rejected' and r2.status = 'done' and r2.deleted_at is null
                               and (r2.done_at, g2.id) < (gl.r_done, gl.id)), 0) as q
      from gl where gl.po_line_id is not null)
  select gl.id, gl.quantity, coalesce(gl.unit_cost, 0),
         case when (select in_book from whole) is not null then gl.quantity
              else least(gl.quantity, coalesce(d.q, 0) + case when gl.po_line_id is not null
                                                              then greatest(coalesce(pb.q, 0) - coalesce(bf.q, 0), 0) else 0 end) end,
         coalesce((select in_book from whole), d.in_book, pb.in_book, false)
    from gl
    left join direct d on d.id = gl.id
    left join po_billed pb on pb.id = gl.po_line_id
    left join po_before bf on bf.id = gl.id
$$;
revoke execute on function app.receipt_lines_billed(uuid) from public, anon, authenticated;

create or replace function app.receipt_fiscal_refresh(p_receipt uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.goods_receipts; v text; v_q numeric; v_b numeric; v_book boolean;
begin
  select * into r from public.goods_receipts where id = p_receipt;
  if r.id is null then return; end if;
  if r.status <> 'done' or r.deleted_at is not null then
    v := null;
  elsif r.receipt_type <> 'purchase' then
    v := 'internal_movement';
  else
    select coalesce(sum(quantity), 0), coalesce(sum(billed), 0), coalesce(bool_or(in_book) filter (where billed > 0), false)
      into v_q, v_b, v_book from app.receipt_lines_billed(r.id);
    v := case when v_q > 0 and v_b >= v_q - 0.0001 then case when v_book then 'tax_invoice_received' else 'other_document' end
              else 'pending_invoice' end;
  end if;
  update public.goods_receipts set fiscal_status = v where id = r.id and fiscal_status is distinct from v;
end $$;
revoke execute on function app.receipt_fiscal_refresh(uuid) from public, anon, authenticated;

-- only the server sets it
create or replace function app.tg_receipt_fiscal_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if app.is_client_context() then
    new.fiscal_status := case when tg_op = 'INSERT' then null else old.fiscal_status end;
  end if;
  return new;
end $$;
drop trigger if exists trg_04_fiscal_guard on public.goods_receipts;
create trigger trg_04_fiscal_guard before insert or update of fiscal_status on public.goods_receipts
  for each row execute function app.tg_receipt_fiscal_guard();

-- a receipt that is completed (or cancelled) gets its status
create or replace function app.tg_receipt_fiscal_status()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.receipt_fiscal_refresh(new.id);
  return null;
end $$;
drop trigger if exists trg_94_fiscal_status on public.goods_receipts;
create trigger trg_94_fiscal_status after update of status, deleted_at, receipt_type on public.goods_receipts
  for each row execute function app.tg_receipt_fiscal_status();

-- a purchase invoice that is posted, cancelled or removed: the receipts it covers
create or replace function app.tg_bill_receipts_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  for v in
    select new.receipt_id where new.receipt_id is not null
    union
    select gl.receipt_id from public.vendor_bill_lines bl join public.goods_receipt_lines gl on gl.id = bl.receipt_line_id where bl.bill_id = new.id
    union
    select gl.receipt_id from public.vendor_bill_lines bl join public.goods_receipt_lines gl on gl.po_line_id = bl.po_line_id
     where bl.bill_id = new.id and bl.po_line_id is not null
  loop
    perform app.receipt_fiscal_refresh(v);
  end loop;
  return null;
end $$;
drop trigger if exists trg_97_receipts_status on public.vendor_bills;
create trigger trg_97_receipts_status after update of status, deleted_at, in_vat_book on public.vendor_bills
  for each row execute function app.tg_bill_receipts_status();

-- the receipts there are today
do $$
declare v uuid;
begin
  for v in select id from public.goods_receipts where status = 'done' loop
    perform app.receipt_fiscal_refresh(v);
  end loop;
end $$;

-- ---------------------------------------------------------------- the list: goods waiting for the invoice
-- p: vendors[], units[], all (true: also the receipts invoiced in the last 90 days)
create or replace function public.receipts_pending_invoice(p_company uuid, p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_vendors uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'vendors', '[]'))::uuid);
  v_units uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'units', '[]'))::uuid);
  v_all boolean := coalesce((p ->> 'all')::boolean, false);
  v_today date := (now() at time zone coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane'))::date;
  v_rows jsonb; v_grni numeric;
begin
  if not (app.has_permission(p_company, 'procurement.read') or app.has_permission(p_company, 'finance.read') or app.has_permission(p_company, 'inventory.read')) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(x order by x ->> 'fiscal_status' <> 'pending_invoice', (x ->> 'receipt_date'), x ->> 'number'), '[]') into v_rows
    from (
      select jsonb_build_object(
               'id', r.id, 'number', r.number, 'receipt_date', r.receipt_date, 'days', v_today - r.receipt_date, 'fiscal_status', r.fiscal_status,
               'vendor_id', r.vendor_id, 'vendor', bp.name, 'tax_number', coalesce(bp.tax_number, bp.vat_number),
               'warehouse_id', r.warehouse_id, 'warehouse', w.name, 'delivery_note', r.vendor_delivery_note,
               'purchase_order_id', r.purchase_order_id, 'po', po.number,
               'value', r.total_value, 'pending_value', round(b.pending, 2), 'billed_pct', round(100 * b.billed_q / nullif(b.q, 0), 0),
               'bills', (select coalesce(jsonb_agg(distinct jsonb_build_object('id', vb.id, 'number', vb.number, 'ref', vb.vendor_invoice_number, 'in_vat_book', vb.in_vat_book)), '[]')
                           from public.vendor_bills vb
                          where vb.status = 'posted' and vb.deleted_at is null and vb.document_type = 'vendor_bill'
                            and (vb.receipt_id = r.id or exists (select 1 from public.vendor_bill_lines bl join public.goods_receipt_lines gl on gl.id = bl.receipt_line_id
                                                                  where bl.bill_id = vb.id and gl.receipt_id = r.id)
                                 or exists (select 1 from public.vendor_bill_lines bl join public.goods_receipt_lines gl on gl.po_line_id = bl.po_line_id
                                             where bl.bill_id = vb.id and gl.receipt_id = r.id and bl.po_line_id is not null)))) as x
        from public.goods_receipts r
        join public.business_partners bp on bp.id = r.vendor_id
        join public.warehouses w on w.id = r.warehouse_id
        left join public.purchase_orders po on po.id = r.purchase_order_id
        cross join lateral (select sum(quantity) as q, sum(billed) as billed_q, sum((quantity - billed) * unit_cost) as pending
                              from app.receipt_lines_billed(r.id)) b
       where r.company_id = p_company and r.deleted_at is null and r.status = 'done' and r.receipt_type = 'purchase'
         and (r.fiscal_status = 'pending_invoice' or (v_all and r.receipt_date >= v_today - 90))
         and (cardinality(v_vendors) = 0 or r.vendor_id = any (v_vendors))
         and (cardinality(v_units) = 0 or r.warehouse_id = any (v_units))) q(x);

  -- the account of the books, to compare: 4081 goods received, not invoiced
  select coalesce(sum(jl.credit - jl.debit), 0) into v_grni
    from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
   where jl.company_id = p_company and e.status in ('posted', 'reversed') and jl.account_id = app.acct(p_company, 'grni');

  return jsonb_build_object('rows', v_rows, 'grni_balance', round(v_grni, 2),
    'grni_code', (select code from public.accounts where id = app.acct(p_company, 'grni')),
    'grni_name', (select name from public.accounts where id = app.acct(p_company, 'grni')),
    'currency', (select base_currency from public.companies where id = p_company), 'today', v_today);
end $$;
revoke execute on function public.receipts_pending_invoice(uuid, jsonb) from public, anon;
grant execute on function public.receipts_pending_invoice(uuid, jsonb) to authenticated;

-- the buyers and the accountant are reminded: 15, 30 and 60 days without the invoice
select app._patch_function('public.run_daily_reminders',
  $x$    -- what slipped through in the books$x$,
  $x$    for l in select gr.id, gr.number, gr.receipt_date, bp.name as vendor from public.goods_receipts gr join public.business_partners bp on bp.id = gr.vendor_id
              where gr.company_id = c.id and gr.fiscal_status = 'pending_invoice' and gr.deleted_at is null
                and (current_date - gr.receipt_date) in (15, 30, 60) loop
      v_n := v_n + app.remind(c.id, array['procurement_manager', 'accountant', 'company_admin'],
                              'Goods receipt ' || l.number || ' from ' || l.vendor || ' has waited ' || (current_date - l.receipt_date) || ' days for its invoice',
                              null, '/procurement/pending-invoices', 'goods_receipts', l.id);
    end loop;
    -- what slipped through in the books$x$);

-- ---------------------------------------------------------------- 2. the VAT purchase book: tax invoices only
select app._patch_function('app.vat_entries',
  $x$   where b.company_id = p_company and b.status = 'posted' and b.deleted_at is null and not b.is_opening and b.bill_date between p_from and p_to$x$,
  $x$   where b.company_id = p_company and b.status = 'posted' and b.deleted_at is null and not b.is_opening and b.in_vat_book and b.bill_date between p_from and p_to$x$);

-- a document outside the VAT book carries no VAT to deduct
create or replace function app.tg_bill_outside_vat_book()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'posted' and old.status is distinct from 'posted' and not new.in_vat_book
     and exists (select 1 from public.vendor_bill_lines where bill_id = new.id and tax_amount <> 0) then
    raise exception 'A document outside the VAT book has no VAT to deduct: enter the whole amount with 0 %% VAT' using errcode = '23514';
  end if;
  return new;
end $$;
drop trigger if exists trg_09_outside_vat_book on public.vendor_bills;
create trigger trg_09_outside_vat_book before update of status on public.vendor_bills
  for each row execute function app.tg_bill_outside_vat_book();

-- the expense written from a receipt: the document (in the VAT book or not) and the profit tax
select app._patch_function('public.expense_book',
  $x$  insert into public.vendor_bills (company_id, vendor_id, vendor_invoice_number, bill_date, due_date, currency_code, notes)$x$,
  $x$  insert into public.vendor_bills (company_id, vendor_id, vendor_invoice_number, bill_date, due_date, currency_code, notes, in_vat_book)$x$);
select app._patch_function('public.expense_book',
  $x$, nullif(btrim(p ->> 'description'), ''))
  returning id into v_bill;$x$,
  $x$, nullif(btrim(p ->> 'description'), ''), coalesce((p ->> 'in_vat_book')::boolean, true))
  returning id into v_bill;$x$);
select app._patch_function('public.expense_book',
  $x$    insert into public.vendor_bill_lines (company_id, bill_id, line_no, description, account_id, cost_center_id, quantity, unit_price, tax_code_id)$x$,
  $x$    insert into public.vendor_bill_lines (company_id, bill_id, line_no, description, account_id, cost_center_id, quantity, unit_price, tax_code_id, cit_deductible)$x$);
select app._patch_function('public.expense_book',
  $x$            coalesce(nullif(l ->> 'tax_code_id', '')::uuid, app.purchase_tax(v_co, 0)));$x$,
  $x$            case when coalesce((p ->> 'in_vat_book')::boolean, true) then coalesce(nullif(l ->> 'tax_code_id', '')::uuid, app.purchase_tax(v_co, 0))
                 else app.purchase_tax(v_co, 0) end,
            nullif(p ->> 'cit_deductible', '')::boolean);$x$);

-- ---------------------------------------------------------------- 3. the profit tax: what each document says
-- the lines of the year whose document says otherwise than their account
create or replace function app.cit_line_overrides(p_company uuid, p_from date, p_to date)
returns table (account_id uuid, code text, name text, ref text, amount numeric, bill_date date, cost_center_id uuid)
language sql stable security definer set search_path = '' as $$
  select a.id, a.code, a.name, b.number || coalesce(' · ' || p.name, ''),
         -- positive: added back (not recognised); negative: recognised after all
         round(l.line_subtotal * b.exchange_rate * case when b.document_type = 'vendor_credit' then -1 else 1 end
               * case when l.cit_deductible then -1 else 1 end, 2),
         b.bill_date, l.cost_center_id
    from public.vendor_bill_lines l
    join public.vendor_bills b on b.id = l.bill_id
    join public.accounts a on a.id = l.account_id
    left join public.business_partners p on p.id = b.vendor_id
   where b.company_id = p_company and b.status = 'posted' and b.deleted_at is null and b.bill_date between p_from and p_to
     and a.account_type = 'expense' and l.cit_deductible is not null and l.cit_deductible = a.tax_nondeductible
$$;
revoke execute on function app.cit_line_overrides(uuid, date, date) from public, anon, authenticated;

select app._patch_function('app.cit_compute',
  $x$v_from date; v_to date;$x$,
  $x$v_from date; v_to date; v_ov numeric; v_ov_list jsonb;$x$);
select app._patch_function('app.cit_compute',
  $x$    into v_rev, v_exp, v_cit, v_nd, v_nd_sum from mv;$x$,
  $x$    into v_rev, v_exp, v_cit, v_nd, v_nd_sum from mv;
  -- an expense the document marks otherwise than its account
  select coalesce(sum(amount), 0), coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name || ' · ' || ref, 'amount', amount, 'document', true) order by code, bill_date), '[]')
    into v_ov, v_ov_list from app.cit_line_overrides(p_company, v_from, v_to);
  v_nd_sum := v_nd_sum + v_ov; v_nd := v_nd || v_ov_list;$x$);

-- ---------------------------------------------------------------- 4. internal costs, for management only
create table if not exists public.management_costs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  warehouse_id  uuid,                                  -- the unit; empty: the whole company
  month         date not null check (month = date_trunc('month', month)::date),
  kind          text not null default 'internal_rent' check (kind in ('internal_rent', 'allocation', 'other')),
  description   text not null check (btrim(description) <> ''),
  amount        numeric(18,2) not null check (amount > 0),
  notes         text,
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id)
);
select app.register_table('public.management_costs', 'finance');
create index if not exists management_costs_company_idx on public.management_costs (company_id, month) where deleted_at is null;

-- the same cost for several months at once (e.g. the rent of a shop the company owns, every month of the year)
create or replace function public.management_costs_repeat(p_id uuid, p_until date)
returns int language plpgsql security definer set search_path = '' as $$
declare m public.management_costs; v_n int := 0; v_month date;
begin
  select * into m from public.management_costs where id = p_id and deleted_at is null;
  if m.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform app.require_permission(m.company_id, 'finance.write');
  if p_until is null or p_until <= m.month or p_until > m.month + interval '3 years' then raise exception 'Check the dates' using errcode = '22023'; end if;
  for v_month in select generate_series(m.month + interval '1 month', date_trunc('month', p_until), interval '1 month')::date loop
    if not exists (select 1 from public.management_costs where company_id = m.company_id and deleted_at is null and month = v_month
                    and warehouse_id is not distinct from m.warehouse_id and kind = m.kind and lower(description) = lower(m.description)) then
      insert into public.management_costs (company_id, warehouse_id, month, kind, description, amount, notes)
      values (m.company_id, m.warehouse_id, v_month, m.kind, m.description, m.amount, m.notes);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end $$;
revoke execute on function public.management_costs_repeat(uuid, date) from public, anon;
grant execute on function public.management_costs_repeat(uuid, date) to authenticated;

-- ---------------------------------------------------------------- 5. the profit report: two views
--   internal         the internal costs of the column (management view only)
--   managerial_profit  the profit less the internal costs
--   nondeductible    the expenses of the column not recognised for the profit tax (accounts and documents)
--   tax_base         the profit of the books plus what is not recognised (before losses and the year's adjustments)
select app._patch_function('public.profit_report',
  $x$  glu as (
    select e.entry_date, jl.debit - jl.credit as amt, a.name, a.account_type, a.account_subtype,$x$,
  $x$  glu as (
    select e.entry_date, jl.debit - jl.credit as amt, a.name, a.account_type, a.account_subtype, a.tax_nondeductible,$x$);
select app._patch_function('public.profit_report',
  $x$           sum(amt) as amt
      from glu$x$,
  $x$           sum(amt) as amt, sum(amt) filter (where tax_nondeductible and account_type = 'expense') as nd
      from glu$x$);
select app._patch_function('public.profit_report',
  $x$  cols as (
    -- by month, every month of the period, also one with nothing in it
    select distinct col from (select col from sales union select col from gl where line is not null$x$,
  $x$  -- the documents that say otherwise than their account (the profit tax)
  ov as (
    select case when v_by = 'month' then to_char(o.bill_date, 'YYYY-MM') else coalesce(o.unit_id::text, 'shared') end as col, sum(o.amount) as amt
      from (select x.*, (select w.id from public.warehouses w join public.cost_centers cc on cc.id = x.cost_center_id
                          where w.company_id = p_company and w.deleted_at is null and lower(w.code) = lower(cc.code) limit 1) as unit_id
              from app.cit_line_overrides(p_company, v_from, v_to) x) o
     where v_by = 'unit' or cardinality(v_units) = 0 or o.unit_id = any (v_units)
     group by 1),
  -- the internal costs (management only): a whole month counts when the month is in the period
  mc as (
    select case when v_by = 'month' then to_char(m.month, 'YYYY-MM') else coalesce(m.warehouse_id::text, 'shared') end as col, sum(m.amount) as amt
      from public.management_costs m
     where m.company_id = p_company and m.deleted_at is null and m.month between date_trunc('month', v_from)::date and v_to
       and (v_by = 'unit' or cardinality(v_units) = 0 or m.warehouse_id = any (v_units))
     group by 1),
  cols as (
    -- by month, every month of the period, also one with nothing in it
    select distinct col from (select col from sales union select col from gl where line is not null union select col from mc$x$);
select app._patch_function('public.profit_report',
  $x$ as interest
      from cols c left join sales sa on sa.col = c.col$x$,
  $x$ as interest,
           coalesce((select sum(amt) from mc where mc.col = c.col), 0)
             + case when v_split and v_by = 'unit' and c.col <> 'shared' then coalesce((select k from share where share.col = c.col), 0) * coalesce((select sum(amt) from mc where mc.col = 'shared'), 0) else 0 end as internal,
           coalesce((select sum(nd) from gl where gl.col = c.col), 0) + coalesce((select sum(amt) from ov where ov.col = c.col), 0)
             + case when v_split and v_by = 'unit' and c.col <> 'shared' then coalesce((select k from share where share.col = c.col), 0)
                    * (coalesce((select sum(nd) from gl where gl.col = 'shared'), 0) + coalesce((select sum(amt) from ov where ov.col = 'shared'), 0)) else 0 end as nondeductible
      from cols c left join sales sa on sa.col = c.col$x$);
select app._patch_function('public.profit_report',
  $x$           'net_margin_pct', round(100 * (net_sales - cogs - opex - other_expense + other_income - interest) / nullif(net_sales, 0), 1)))$x$,
  $x$           'net_margin_pct', round(100 * (net_sales - cogs - opex - other_expense + other_income - interest) / nullif(net_sales, 0), 1),
           'internal', round(internal, 2),
           'managerial_profit', round(net_sales - cogs - opex - other_expense + other_income - interest - internal, 2),
           'nondeductible', round(nondeductible, 2),
           'tax_base', round(net_sales - cogs - opex - other_expense + other_income - interest + nondeductible, 2)))$x$);

drop function app._patch_function(text, text, text);
