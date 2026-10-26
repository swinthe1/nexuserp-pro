-- =============================================================================
-- Cards and compensation
--   · partner_card: the customer's / supplier's account card from the books, with a running balance
--   · open_items: what is open at a date, for the confirmation of balances (IOS)
--   · compensations: a receivable set against a payable of the same partner (kompensim)
--   · item_card: every movement of an item with running quantity and value
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

-- the accounts of one side of a partner: customer (receivable, advances received) or supplier (payable, advances paid)
create or replace function app.partner_side_accounts(p_partner uuid, p_side text)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select array_remove(array_agg(distinct x), null) from (
    select a.id x from public.accounts a join public.business_partners bp on bp.company_id = a.company_id
     where bp.id = p_partner and a.deleted_at is null
       and a.account_subtype = case when p_side = 'vendor' then 'payable' else 'receivable' end
    union all select case when p_side = 'vendor' then bp.payable_account_id else bp.receivable_account_id end from public.business_partners bp where bp.id = p_partner
    union all select app.acct(bp.company_id, case when p_side = 'vendor' then 'vendor_advances' else 'customer_advances' end) from public.business_partners bp where bp.id = p_partner
  ) t
$$;

-- =============================================================================
-- 1. Partner card
-- =============================================================================
create or replace function public.partner_card(p_partner uuid, p_side text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
    select jsonb_build_object('date', e.entry_date, 'entry', e.number, 'source_type', e.source_doc_type, 'source_id', e.source_doc_id,
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
     group by e.id, e.entry_date, e.number, e.source_doc_type, e.source_doc_id, e.reference, e.memo, i.number, b.number, y.number, c.number,
              b.vendor_invoice_number, y.reference, i.notes, i.due_date, b.due_date) t;
  return jsonb_build_object('side', p_side, 'from', p_from, 'to', p_to, 'opening', v_open,
    'debit', (select coalesce(sum((r ->> 'debit')::numeric), 0) from jsonb_array_elements(v_rows) r),
    'credit', (select coalesce(sum((r ->> 'credit')::numeric), 0) from jsonb_array_elements(v_rows) r),
    'closing', v_open + (select coalesce(sum((r ->> 'debit')::numeric - (r ->> 'credit')::numeric), 0) from jsonb_array_elements(v_rows) r),
    'rows', v_rows, 'partner', app.print_partner(p_partner), 'partner_id', p_partner, 'currency', (select base_currency from public.companies where id = bp.company_id),
    'company', app.print_company(bp.company_id), 'printed_by', (select full_name from public.profiles where id = auth.uid()), 'printed_at', now());
end $$;

-- =============================================================================
-- 2. Compensation (needed by the open items below)
-- =============================================================================
create table public.compensations (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  number           text not null,
  status           text not null default 'posted',
  partner_id       uuid not null,
  comp_date        date not null default current_date,
  currency_code    char(3) not null,
  amount           numeric(18,2) not null check (amount > 0),
  notes            text,
  journal_entry_id uuid,
  reversal_entry_id uuid,
  cancelled_at     timestamptz,
  cancel_reason    text,
  foreign key (company_id, partner_id) references public.business_partners(company_id, id)
);
select app.register_table('public.compensations', 'invoicing', p_soft_delete => false, p_client_write => false);
insert into public.document_types (key, name, module, table_name, default_prefix)
values ('compensation', 'Compensation', 'invoicing', 'compensations', 'KOMP-') on conflict (key) do nothing;
insert into public.status_transitions (doc_type, from_status, to_status)
values ('compensation', '__init__', 'posted'), ('compensation', 'posted', 'cancelled') on conflict do nothing;
select app.register_document('public.compensations', 'compensation', 'comp_date');
create index compensations_partner_idx on public.compensations (partner_id, comp_date desc);

create table public.compensation_lines (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  compensation_id  uuid not null,
  sales_invoice_id uuid,
  vendor_bill_id   uuid,
  amount           numeric(18,2) not null check (amount > 0),
  check ((sales_invoice_id is null) <> (vendor_bill_id is null)),
  foreign key (company_id, compensation_id) references public.compensations(company_id, id) on delete cascade
);
select app.register_table('public.compensation_lines', 'invoicing', p_soft_delete => false, p_client_write => false, p_audit => false);
create index compensation_lines_inv_idx on public.compensation_lines (sales_invoice_id) where sales_invoice_id is not null;
create index compensation_lines_bill_idx on public.compensation_lines (vendor_bill_id) where vendor_bill_id is not null;

-- what is compensated counts as paid on the invoice and on the bill
select app._patch_function('app.refresh_payment_status',
  $x$                                          where a.sales_invoice_id = i.id and p.status = 'posted'), 0)$x$,
  $x$                                          where a.sales_invoice_id = i.id and p.status = 'posted'), 0)
                            + coalesce((select sum(cl.amount) from public.compensation_lines cl join public.compensations c on c.id = cl.compensation_id
                                         where cl.sales_invoice_id = i.id and c.status = 'posted'), 0)$x$);
select app._patch_function('app.refresh_payment_status',
  $x$                                          where a.vendor_bill_id = b.id and p.status = 'posted'), 0)$x$,
  $x$                                          where a.vendor_bill_id = b.id and p.status = 'posted'), 0)
                            + coalesce((select sum(cl.amount) from public.compensation_lines cl join public.compensations c on c.id = cl.compensation_id
                                         where cl.vendor_bill_id = b.id and c.status = 'posted'), 0)$x$);

-- =============================================================================
-- 3. Open items at a date (IOS)
-- =============================================================================
create or replace function app.open_items(p_partner uuid, p_side text, p_date date)
returns table (kind text, id uuid, number text, reference text, doc_date date, due_date date, currency text, total numeric, open numeric)
language sql stable security definer set search_path = '' as $$
  -- invoices and standalone credit notes of the customer
  select case when i.document_type = 'credit_note' then 'credit_note' else 'invoice' end, i.id, i.number, null::text, i.invoice_date, i.due_date, i.currency_code::text,
         case when i.document_type = 'credit_note' then -i.total else i.total end,
         case when i.document_type = 'credit_note' then -1 else 1 end * (i.total
           - coalesce((select sum(a.amount) from public.payment_allocations a join public.payments y on y.id = a.payment_id
                        where a.sales_invoice_id = i.id and y.status = 'posted' and y.payment_date <= p_date), 0)
           - coalesce((select sum(cl.amount) from public.compensation_lines cl join public.compensations c on c.id = cl.compensation_id
                        where cl.sales_invoice_id = i.id and c.status = 'posted' and c.comp_date <= p_date), 0)
           - case when i.document_type = 'sales_invoice' then coalesce((select sum(cn.total) from public.sales_invoices cn where cn.original_invoice_id = i.id
                        and cn.document_type = 'credit_note' and cn.status = 'posted' and cn.deleted_at is null and cn.invoice_date <= p_date), 0) else 0 end)
    from public.sales_invoices i
   where p_side = 'customer' and i.partner_id = p_partner and i.status = 'posted' and i.deleted_at is null and i.invoice_date <= p_date
     and not (i.document_type = 'credit_note' and i.original_invoice_id is not null)
  union all
  select case when b.document_type = 'vendor_credit' then 'credit_note' else 'invoice' end, b.id, b.number, b.vendor_invoice_number, b.bill_date, b.due_date, b.currency_code::text,
         case when b.document_type = 'vendor_credit' then -b.total else b.total end,
         case when b.document_type = 'vendor_credit' then -1 else 1 end * (b.total
           - coalesce((select sum(a.amount) from public.payment_allocations a join public.payments y on y.id = a.payment_id
                        where a.vendor_bill_id = b.id and y.status = 'posted' and y.payment_date <= p_date), 0)
           - coalesce((select sum(cl.amount) from public.compensation_lines cl join public.compensations c on c.id = cl.compensation_id
                        where cl.vendor_bill_id = b.id and c.status = 'posted' and c.comp_date <= p_date), 0)
           - case when b.document_type = 'vendor_bill' then coalesce((select sum(cn.total) from public.vendor_bills cn where cn.original_bill_id = b.id
                        and cn.document_type = 'vendor_credit' and cn.status = 'posted' and cn.deleted_at is null and cn.bill_date <= p_date), 0) else 0 end)
    from public.vendor_bills b
   where p_side = 'vendor' and b.vendor_id = p_partner and b.status = 'posted' and b.deleted_at is null and b.bill_date <= p_date
     and not (b.document_type = 'vendor_credit' and b.original_bill_id is not null)
  union all
  -- money received or paid that is not set against a document yet (advances)
  select 'advance', y.id, y.number, y.reference, y.payment_date, null::date, y.currency_code::text, -y.amount,
         -(y.amount - coalesce((select sum(a.amount) from public.payment_allocations a where a.payment_id = y.id), 0))
    from public.payments y
   where y.partner_id = p_partner and y.status = 'posted' and y.deleted_at is null and y.payment_date <= p_date
     and y.document_type = case when p_side = 'vendor' then 'vendor_payment' else 'customer_payment' end
$$;

create or replace function public.open_items_statement(p_partner uuid, p_side text, p_date date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare bp public.business_partners; v_rows jsonb;
begin
  select * into bp from public.business_partners where id = p_partner;
  if bp.id is null then raise exception 'Customer or vendor not found' using errcode = 'P0002'; end if;
  perform app.require_permission(bp.company_id, 'invoicing.read');
  select coalesce(jsonb_agg(jsonb_build_object('kind', o.kind, 'id', o.id, 'number', o.number, 'reference', o.reference, 'date', o.doc_date, 'due', o.due_date,
           'currency', o.currency, 'total', o.total, 'open', round(o.open, 2), 'late', o.due_date < p_date) order by o.doc_date, o.number), '[]'::jsonb)
    into v_rows from app.open_items(p_partner, p_side, p_date) o where abs(o.open) >= 0.005;
  return jsonb_build_object('side', p_side, 'date', p_date, 'rows', v_rows,
    'totals', coalesce((select jsonb_object_agg(cur, s) from (select r ->> 'currency' cur, sum((r ->> 'open')::numeric) s from jsonb_array_elements(v_rows) r group by 1) t), '{}'::jsonb),
    'partner', app.print_partner(p_partner), 'partner_id', p_partner, 'currency', (select base_currency from public.companies where id = bp.company_id),
    'company', app.print_company(bp.company_id), 'printed_by', (select full_name from public.profiles where id = auth.uid()), 'printed_at', now());
end $$;

-- =============================================================================
-- 4. Compensation: make, print, cancel
-- =============================================================================
-- p: {company_id, partner_id, date, notes, lines: [{sales_invoice_id | vendor_bill_id, amount}]}
create or replace function public.compensation_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_co uuid := (p ->> 'company_id')::uuid; bp public.business_partners; v_date date := coalesce(nullif(p ->> 'date', '')::date, current_date);
  l jsonb; v_ar numeric := 0; v_ap numeric := 0; v_ar_base numeric := 0; v_ap_base numeric := 0; v_cur text; v_id uuid := gen_random_uuid();
  v_open numeric; d record; v_lines jsonb; v_fx numeric; v_je uuid; v_period text; c public.compensations;
begin
  perform app.require_permission(v_co, 'invoicing.write');
  select * into bp from public.business_partners where id = (p ->> 'partner_id')::uuid and company_id = v_co and deleted_at is null;
  if bp.id is null then raise exception 'Customer or vendor not found' using errcode = 'P0002'; end if;
  select status into v_period from public.fiscal_periods where company_id = v_co and v_date between start_date and end_date;
  if coalesce(v_period, 'missing') <> 'open' then raise exception 'The fiscal period for % is %', v_date, coalesce(v_period, 'missing') using errcode = '23514'; end if;
  if jsonb_array_length(coalesce(p -> 'lines', '[]'::jsonb)) = 0 then raise exception 'Choose the invoices to set against each other' using errcode = '23514'; end if;

  insert into public.compensations (id, company_id, partner_id, comp_date, currency_code, amount, notes)
  values (v_id, v_co, bp.id, v_date, 'XXX', 1, nullif(btrim(p ->> 'notes'), ''));   -- amount and currency are set below

  for l in select * from jsonb_array_elements(p -> 'lines') loop
    if coalesce((l ->> 'amount')::numeric, 0) <= 0 then raise exception 'The amount must be more than zero' using errcode = '23514'; end if;
    if nullif(l ->> 'sales_invoice_id', '') is not null then
      select i.id, i.number, i.currency_code, i.exchange_rate, i.partner_id, i.status, i.document_type into d from public.sales_invoices i where i.id = (l ->> 'sales_invoice_id')::uuid for update;
      if d.id is null or d.partner_id <> bp.id or d.status <> 'posted' or d.document_type <> 'sales_invoice' then
        raise exception 'Invoice % is not an open invoice of this partner', coalesce(d.number, '?') using errcode = '23514';
      end if;
      select o.open into v_open from app.open_items(bp.id, 'customer', v_date) o where o.id = d.id;
      if (l ->> 'amount')::numeric > coalesce(v_open, 0) + 0.004 then raise exception 'Only % is open on %', round(coalesce(v_open, 0), 2), d.number using errcode = '23514'; end if;
      insert into public.compensation_lines (company_id, compensation_id, sales_invoice_id, amount) values (v_co, v_id, d.id, (l ->> 'amount')::numeric);
      v_ar := v_ar + (l ->> 'amount')::numeric; v_ar_base := v_ar_base + round((l ->> 'amount')::numeric * d.exchange_rate, 2);
    else
      select b.id, b.number, b.currency_code, b.exchange_rate, b.vendor_id as partner_id, b.status, b.document_type into d from public.vendor_bills b where b.id = (l ->> 'vendor_bill_id')::uuid for update;
      if d.id is null or d.partner_id <> bp.id or d.status <> 'posted' or d.document_type <> 'vendor_bill' then
        raise exception 'Bill % is not an open bill of this partner', coalesce(d.number, '?') using errcode = '23514';
      end if;
      select o.open into v_open from app.open_items(bp.id, 'vendor', v_date) o where o.id = d.id;
      if (l ->> 'amount')::numeric > coalesce(v_open, 0) + 0.004 then raise exception 'Only % is open on %', round(coalesce(v_open, 0), 2), d.number using errcode = '23514'; end if;
      insert into public.compensation_lines (company_id, compensation_id, vendor_bill_id, amount) values (v_co, v_id, d.id, (l ->> 'amount')::numeric);
      v_ap := v_ap + (l ->> 'amount')::numeric; v_ap_base := v_ap_base + round((l ->> 'amount')::numeric * d.exchange_rate, 2);
    end if;
    if v_cur is not null and v_cur <> d.currency_code then raise exception 'All documents of a compensation are in one currency' using errcode = '23514'; end if;
    v_cur := d.currency_code;
  end loop;
  if v_ar = 0 or v_ap = 0 then raise exception 'A compensation needs at least one invoice of the customer and one bill of the supplier' using errcode = '23514'; end if;
  if round(v_ar, 2) <> round(v_ap, 2) then
    raise exception 'Both sides must be equal: % from invoices, % from bills', round(v_ar, 2), round(v_ap, 2) using errcode = '23514';
  end if;
  update public.compensations set amount = round(v_ar, 2), currency_code = v_cur where id = v_id;

  -- the books: the supplier debt goes down, the customer debt goes down; documents booked at other rates leave an exchange difference
  v_fx := v_ap_base - v_ar_base;
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', coalesce(bp.payable_account_id, app.acct(v_co, 'payable')), 'amount', v_ap_base, 'partner_id', bp.id),
    jsonb_build_object('account_id', coalesce(bp.receivable_account_id, app.acct(v_co, 'receivable')), 'amount', -v_ar_base, 'partner_id', bp.id));
  if v_fx <> 0 then
    v_lines := v_lines || jsonb_build_object('account_id', app.acct(v_co, case when v_fx < 0 then 'exchange_gain' else 'exchange_loss' end), 'amount', -v_fx,
                                             'description', 'Exchange difference');
  end if;
  select * into c from public.compensations where id = v_id;
  v_je := app.gl_post(v_co, 'GEN', v_date, 'compensation', v_id, c.number, 'Compensation ' || c.number || ' · ' || bp.name, v_lines, 'main', v_cur, null);
  update public.compensations set journal_entry_id = v_je where id = v_id;
  for d in select sales_invoice_id, vendor_bill_id from public.compensation_lines where compensation_id = v_id loop
    if d.sales_invoice_id is not null then perform app.refresh_payment_status('sales_invoices', d.sales_invoice_id);
    else perform app.refresh_payment_status('vendor_bills', d.vendor_bill_id); end if;
  end loop;
  return jsonb_build_object('id', v_id, 'number', c.number, 'amount', round(v_ar, 2), 'currency', v_cur);
end $$;

create or replace function public.compensation_cancel(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.compensations; v_lines jsonb; v_je uuid; d record;
begin
  select * into c from public.compensations where id = p_id for update;
  if c.id is null then raise exception 'Compensation not found' using errcode = 'P0002'; end if;
  perform app.require_permission(c.company_id, 'invoicing.write');
  if c.status <> 'posted' then raise exception 'The compensation is already cancelled' using errcode = '55000'; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'Write why it is cancelled' using errcode = '23514'; end if;
  select jsonb_agg(jsonb_build_object('account_id', jl.account_id, 'amount', jl.credit - jl.debit, 'partner_id', jl.partner_id, 'description', jl.description))
    into v_lines from public.journal_lines jl where jl.entry_id = c.journal_entry_id;
  v_je := app.gl_post(c.company_id, 'GEN', current_date, 'compensation', c.id, c.number, 'Cancelled compensation ' || c.number, v_lines, 'reversal', c.currency_code, c.journal_entry_id);
  update public.compensations set status = 'cancelled', cancelled_at = now(), cancel_reason = btrim(p_reason), reversal_entry_id = v_je where id = c.id;
  for d in select sales_invoice_id, vendor_bill_id from public.compensation_lines where compensation_id = c.id loop
    if d.sales_invoice_id is not null then perform app.refresh_payment_status('sales_invoices', d.sales_invoice_id);
    else perform app.refresh_payment_status('vendor_bills', d.vendor_bill_id); end if;
  end loop;
end $$;

create or replace function public.compensation_print(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.compensations;
begin
  select * into c from public.compensations where id = p_id;
  if c.id is null then raise exception 'Compensation not found' using errcode = 'P0002'; end if;
  perform app.require_permission(c.company_id, 'invoicing.read');
  return jsonb_build_object('number', c.number, 'date', c.comp_date, 'status', c.status, 'amount', c.amount, 'currency', c.currency_code, 'notes', c.notes,
    'cancel_reason', c.cancel_reason,
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('number', i.number, 'date', i.invoice_date, 'total', i.total, 'amount', cl.amount) order by i.invoice_date, i.number)
                            from public.compensation_lines cl join public.sales_invoices i on i.id = cl.sales_invoice_id where cl.compensation_id = c.id), '[]'::jsonb),
    'bills', coalesce((select jsonb_agg(jsonb_build_object('number', b.number, 'reference', b.vendor_invoice_number, 'date', b.bill_date, 'total', b.total, 'amount', cl.amount)
                            order by b.bill_date, b.number)
                         from public.compensation_lines cl join public.vendor_bills b on b.id = cl.vendor_bill_id where cl.compensation_id = c.id), '[]'::jsonb),
    'partner', app.print_partner(c.partner_id), 'partner_id', c.partner_id,
    'company', app.print_company(c.company_id), 'printed_by', (select full_name from public.profiles where id = auth.uid()), 'printed_at', now());
end $$;

-- =============================================================================
-- 5. Item card
-- =============================================================================
create or replace function public.item_card(p_variant uuid, p_warehouse uuid, p_from date, p_to date)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.product_variants; v_q0 numeric; v_v0 numeric; v_rows jsonb; v_tz text;
begin
  select * into v from public.product_variants where id = p_variant;
  if v.id is null then raise exception 'Product not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v.company_id, 'inventory.read');
  select coalesce(timezone, 'Europe/Tirane') into v_tz from public.companies where id = v.company_id;
  -- a movement counts in when it arrives in the warehouse (or the company), out when it leaves; moves inside are left out
  create temporary table if not exists _card (at timestamptz, id uuid, qin numeric, qout numeric, vin numeric, vout numeric, m public.stock_movements) on commit drop;
  truncate _card;
  insert into _card
  select m.movement_date, m.id,
         case when (p_warehouse is null and m.to_warehouse_id is not null and m.from_warehouse_id is null) or (p_warehouse is not null and m.to_warehouse_id = p_warehouse and m.from_warehouse_id is distinct from p_warehouse) then m.quantity else 0 end,
         case when (p_warehouse is null and m.from_warehouse_id is not null and m.to_warehouse_id is null) or (p_warehouse is not null and m.from_warehouse_id = p_warehouse and m.to_warehouse_id is distinct from p_warehouse) then m.quantity else 0 end,
         case when (p_warehouse is null and m.to_warehouse_id is not null and m.from_warehouse_id is null) or (p_warehouse is not null and m.to_warehouse_id = p_warehouse and m.from_warehouse_id is distinct from p_warehouse) then m.total_cost else 0 end,
         case when (p_warehouse is null and m.from_warehouse_id is not null and m.to_warehouse_id is null) or (p_warehouse is not null and m.from_warehouse_id = p_warehouse and m.to_warehouse_id is distinct from p_warehouse) then m.total_cost else 0 end,
         m
    from public.stock_movements m
   where m.variant_id = p_variant and m.company_id = v.company_id
     and (m.movement_type <> 'landed_cost' or p_warehouse is null or m.to_warehouse_id = p_warehouse)
     and (m.movement_date at time zone v_tz)::date <= p_to;
  -- value-only movements (landed costs, revaluations) change the value, not the quantity
  update _card set vin = (m).total_cost, qin = 0 where (m).movement_type = 'landed_cost';
  select coalesce(sum(qin - qout), 0), coalesce(sum(vin - vout), 0) into v_q0, v_v0 from _card where (at at time zone v_tz)::date < p_from;
  select coalesce(jsonb_agg(r order by (r ->> 'at'), r ->> 'id'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object('id', c.id, 'at', c.at, 'date', (c.at at time zone v_tz)::date, 'type', (c.m).movement_type, 'reference', (c.m).reference,
             'source_type', (c.m).source_doc_type, 'source_id', (c.m).source_doc_id,
             'partner', coalesce((select bp.name from public.goods_receipts g join public.business_partners bp on bp.id = g.vendor_id where g.id = (c.m).source_doc_id),
                                 (select bp.name from public.deliveries d join public.business_partners bp on bp.id = d.partner_id where d.id = (c.m).source_doc_id),
                                 (select bp.name from public.vendor_returns r join public.business_partners bp on bp.id = r.vendor_id where r.id = (c.m).source_doc_id)),
             'warehouse', (select name from public.warehouses where id = coalesce(case when c.qin > 0 or c.vin <> 0 then (c.m).to_warehouse_id end, (c.m).from_warehouse_id, (c.m).to_warehouse_id)),
             'lot', (select lot_number from public.lots where id = (c.m).lot_id),
             'qty_in', c.qin, 'qty_out', c.qout, 'unit_cost', (c.m).unit_cost, 'value_in', c.vin, 'value_out', c.vout,
             'qty', v_q0 + sum(c.qin - c.qout) over w, 'value', v_v0 + sum(c.vin - c.vout) over w) r
      from _card c
     where (c.at at time zone v_tz)::date between p_from and p_to and (c.qin <> 0 or c.qout <> 0 or c.vin <> 0 or c.vout <> 0)
    window w as (order by c.at, c.id rows unbounded preceding)) t;
  return jsonb_build_object('variant_id', v.id, 'sku', v.sku, 'name', v.name, 'warehouse', (select name from public.warehouses where id = p_warehouse),
    'from', p_from, 'to', p_to, 'opening_qty', v_q0, 'opening_value', v_v0, 'rows', v_rows,
    'closing_qty', v_q0 + (select coalesce(sum((r ->> 'qty_in')::numeric - (r ->> 'qty_out')::numeric), 0) from jsonb_array_elements(v_rows) r),
    'closing_value', v_v0 + (select coalesce(sum((r ->> 'value_in')::numeric - (r ->> 'value_out')::numeric), 0) from jsonb_array_elements(v_rows) r),
    'uom', (select u.code from public.products p join public.units_of_measure u on u.id = p.uom_id where p.id = v.product_id),
    'currency', (select base_currency from public.companies where id = v.company_id),
    'company', app.print_company(v.company_id), 'printed_by', (select full_name from public.profiles where id = auth.uid()), 'printed_at', now());
end $$;

revoke execute on function public.partner_card(uuid, text, date, date), public.open_items_statement(uuid, text, date), public.compensation_create(jsonb),
  public.compensation_cancel(uuid, text), public.compensation_print(uuid), public.item_card(uuid, uuid, date, date) from public, anon;
grant execute on function public.partner_card(uuid, text, date, date), public.open_items_statement(uuid, text, date), public.compensation_create(jsonb),
  public.compensation_cancel(uuid, text), public.compensation_print(uuid), public.item_card(uuid, uuid, date, date) to authenticated;

drop function app._patch_function(text, text, text);

-- a statement (card, open items, compensation) as a PDF to the partner
create or replace function public.pdf_email(p_company uuid, p_to text, p_subject text, p_message text, p_pdf text, p_filename text, p_entity_type text, p_entity_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform app.require_permission(p_company, 'invoicing.write');
  if coalesce(btrim(p_to), '') !~ '^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$' then raise exception 'Write a valid email address' using errcode = '22023'; end if;
  if not exists (select 1 from app.mail_accounts where company_id = p_company and is_active) then
    raise exception 'Set up the company mailbox first (Automations › Email)' using errcode = '55000';
  end if;
  if p_pdf is null or length(p_pdf) > 8000000 then raise exception 'The PDF is missing or too large' using errcode = '22023'; end if;
  v_id := app.enqueue_message(p_company, 'email', btrim(p_to), left(coalesce(nullif(btrim(p_subject), ''), p_filename), 300),
            coalesce(p_message, ''), null, 'document', null, null, p_entity_type, p_entity_id);
  update app.message_outbox set attachments = jsonb_build_array(jsonb_build_object('name', coalesce(nullif(p_filename, ''), 'document.pdf'),
           'mime', 'application/pdf', 'data', p_pdf)) where id = v_id;
  return v_id;
end $$;
revoke execute on function public.pdf_email(uuid, text, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.pdf_email(uuid, text, text, text, text, text, text, uuid) to authenticated;
