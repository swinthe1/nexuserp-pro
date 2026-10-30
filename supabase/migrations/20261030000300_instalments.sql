-- =============================================================================
-- Paying in instalments
--  * a payment term can split the total: [{"pct": 30, "days": 0}, {"pct": 70, "days": 30}]
--  * each posted invoice / supplier bill keeps its own schedule (public.document_instalments),
--    made from the term when it is posted, or set by hand (public.set_instalments)
--  * what is paid covers the instalments in order, the oldest first
--  * Debts (partner_aging), the cash forecast and the payment proposal count each instalment on its own date
-- =============================================================================

create or replace function app.instalments_valid(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select p is null or (
    jsonb_typeof(p) = 'array' and jsonb_array_length(p) between 2 and 24
    and not exists (select 1 from jsonb_array_elements(p) e
                     where jsonb_typeof(e -> 'pct') <> 'number' or jsonb_typeof(e -> 'days') <> 'number'
                        or (e ->> 'pct')::numeric <= 0 or (e ->> 'days')::numeric < 0)
    and (select sum((e ->> 'pct')::numeric) from jsonb_array_elements(p) e) = 100
    and (select bool_and(d >= coalesce(prev, -1)) from (
           select (e ->> 'days')::numeric as d, lag((e ->> 'days')::numeric) over (order by o) as prev
             from jsonb_array_elements(p) with ordinality x(e, o)) y)
  )
$$;

alter table public.payment_terms add column if not exists instalments jsonb;
alter table public.payment_terms drop constraint if exists payment_terms_instalments_ok;
alter table public.payment_terms add constraint payment_terms_instalments_ok check (app.instalments_valid(instalments));

create table if not exists public.document_instalments (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id),
  sales_invoice_id uuid references public.sales_invoices(id) on delete cascade,
  vendor_bill_id   uuid references public.vendor_bills(id) on delete cascade,
  seq              smallint not null check (seq > 0),
  due_date         date not null,
  amount           numeric(18,2) not null check (amount > 0),
  created_at       timestamptz not null default now(),
  created_by       uuid default auth.uid(),
  updated_at       timestamptz not null default now(),
  updated_by       uuid default auth.uid(),
  check (num_nonnulls(sales_invoice_id, vendor_bill_id) = 1)
);
select app.register_table('public.document_instalments', 'invoicing', p_soft_delete => false, p_client_write => false, p_audit => true);
create unique index if not exists document_instalments_inv_idx on public.document_instalments (sales_invoice_id, seq) where sales_invoice_id is not null;
create unique index if not exists document_instalments_bill_idx on public.document_instalments (vendor_bill_id, seq) where vendor_bill_id is not null;

-- the parts of a document still to be paid: one row per instalment that is not fully paid,
-- or a single row on the document's due date when it has no schedule.
-- p_open: what is still open on the document (in its currency), e.g. amount_due, or an as-of figure
create or replace function app.doc_parts(p_invoice uuid, p_bill uuid, p_total numeric, p_open numeric, p_due date)
returns table (seq int, due date, open numeric)
language sql stable security invoker set search_path = '' as $$
  with sch as (
    select di.seq, di.due_date, di.amount, sum(di.amount) over (order by di.seq) as cum
      from public.document_instalments di
     where (p_invoice is not null and di.sales_invoice_id = p_invoice) or (p_bill is not null and di.vendor_bill_id = p_bill)
  )
  select s.seq::int, s.due_date, least(s.amount, greatest(0, s.cum - (p_total - p_open)))
    from sch s
   where least(s.amount, greatest(0, s.cum - (p_total - p_open))) > 0
  union all
  select null, p_due, p_open where not exists (select 1 from sch)
$$;

-- a schedule from a term: amounts rounded, the last instalment takes the cents
create or replace function app.make_instalments(p_invoice uuid, p_bill uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_date date; v_total numeric; v_term jsonb; v_n int := 0; v_left numeric; e record; v_cnt int;
begin
  if p_invoice is not null then
    select i.company_id, i.invoice_date, i.total, pt.instalments into v_company, v_date, v_total, v_term
      from public.sales_invoices i left join public.payment_terms pt on pt.id = i.payment_term_id
     where i.id = p_invoice and i.document_type = 'sales_invoice';
  else
    select b.company_id, b.bill_date, b.total, pt.instalments into v_company, v_date, v_total, v_term
      from public.vendor_bills b left join public.payment_terms pt on pt.id = b.payment_term_id
     where b.id = p_bill and b.document_type = 'vendor_bill';
  end if;
  if v_company is null or v_term is null or coalesce(v_total, 0) <= 0 then return 0; end if;
  v_cnt := jsonb_array_length(v_term);
  v_left := v_total;
  for e in select (x ->> 'pct')::numeric as pct, (x ->> 'days')::int as days, o from jsonb_array_elements(v_term) with ordinality t(x, o) order by o loop
    v_n := v_n + 1;
    insert into public.document_instalments (company_id, sales_invoice_id, vendor_bill_id, seq, due_date, amount)
    values (v_company, p_invoice, p_bill, v_n, v_date + e.days,
            case when v_n = v_cnt then v_left else round(v_total * e.pct / 100, 2) end);
    v_left := v_left - round(v_total * e.pct / 100, 2);
  end loop;
  return v_n;
end $$;

-- when a document is posted: keep a schedule that still adds up, otherwise make one from the term
create or replace function app.tg_instalments_on_post()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_sum numeric;
begin
  if new.status = 'posted' and old.status is distinct from 'posted' and new.document_type in ('sales_invoice', 'vendor_bill') then
    if tg_table_name = 'sales_invoices' then
      select sum(amount) into v_sum from public.document_instalments where sales_invoice_id = new.id;
      if v_sum is not null and abs(v_sum - new.total) > 0.005 then delete from public.document_instalments where sales_invoice_id = new.id; v_sum := null; end if;
      if v_sum is null then perform app.make_instalments(new.id, null); end if;
    else
      select sum(amount) into v_sum from public.document_instalments where vendor_bill_id = new.id;
      if v_sum is not null and abs(v_sum - new.total) > 0.005 then delete from public.document_instalments where vendor_bill_id = new.id; v_sum := null; end if;
      if v_sum is null then perform app.make_instalments(null, new.id); end if;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_93_instalments on public.sales_invoices;
create trigger trg_93_instalments after update of status on public.sales_invoices for each row execute function app.tg_instalments_on_post();
drop trigger if exists trg_93_instalments on public.vendor_bills;
create trigger trg_93_instalments after update of status on public.vendor_bills for each row execute function app.tg_instalments_on_post();

-- a schedule by hand. p_rows: [{"due_date": "2026-11-30", "amount": 300}, …]; an empty array removes it
create or replace function public.set_instalments(p_doc_type text, p_id uuid, p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_status text; v_total numeric; v_type text; v_sum numeric; v_n int; v_date date;
begin
  if p_doc_type = 'sales_invoice' then
    select company_id, status, total, document_type, invoice_date into v_company, v_status, v_total, v_type, v_date from public.sales_invoices where id = p_id and deleted_at is null;
  elsif p_doc_type = 'vendor_bill' then
    select company_id, status, total, document_type, bill_date into v_company, v_status, v_total, v_type, v_date from public.vendor_bills where id = p_id and deleted_at is null;
  else
    raise exception 'Unknown document type %', p_doc_type using errcode = '22023';
  end if;
  if v_company is null then raise exception 'Document not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_company, 'invoicing.write');
  if v_type <> p_doc_type then raise exception 'Only invoices and supplier bills are paid in instalments' using errcode = '23514'; end if;
  if v_status not in ('draft', 'posted') then raise exception 'This document can no longer get instalments' using errcode = '23514'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Instalments must be a list' using errcode = '22023'; end if;
  v_n := jsonb_array_length(p_rows);

  if v_n > 0 then
    if v_n < 2 or v_n > 24 then raise exception 'Between 2 and 24 instalments' using errcode = '23514'; end if;
    if exists (select 1 from jsonb_array_elements(p_rows) r where coalesce(nullif(r ->> 'amount', '')::numeric, 0) <= 0 or nullif(r ->> 'due_date', '') is null) then
      raise exception 'Every instalment needs a date and an amount above zero' using errcode = '23514';
    end if;
    if exists (select 1 from jsonb_array_elements(p_rows) r where (r ->> 'due_date')::date < v_date) then
      raise exception 'An instalment cannot be due before the document date' using errcode = '23514';
    end if;
    select sum(round((r ->> 'amount')::numeric, 2)) into v_sum from jsonb_array_elements(p_rows) r;
    if v_status = 'posted' and abs(v_sum - v_total) > 0.005 then
      raise exception 'The instalments add up to %, the document is %', v_sum, v_total using errcode = '23514';
    end if;
  end if;

  delete from public.document_instalments where (p_doc_type = 'sales_invoice' and sales_invoice_id = p_id) or (p_doc_type = 'vendor_bill' and vendor_bill_id = p_id);
  insert into public.document_instalments (company_id, sales_invoice_id, vendor_bill_id, seq, due_date, amount)
  select v_company, case when p_doc_type = 'sales_invoice' then p_id end, case when p_doc_type = 'vendor_bill' then p_id end,
         row_number() over (order by (r ->> 'due_date')::date, o), (r ->> 'due_date')::date, round((r ->> 'amount')::numeric, 2)
    from jsonb_array_elements(p_rows) with ordinality x(r, o);
  return v_n;
end $$;

-- the schedule with what is paid and open on each line
create or replace function public.document_instalment_list(p_doc_type text, p_id uuid)
returns table (seq int, due_date date, amount numeric, paid numeric, open numeric, overdue boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_company uuid; v_paid numeric;
begin
  if p_doc_type = 'sales_invoice' then select company_id, total - amount_due into v_company, v_paid from public.sales_invoices where id = p_id;
  else select company_id, total - amount_due into v_company, v_paid from public.vendor_bills where id = p_id; end if;
  if v_company is null then return; end if;
  perform app.require_permission(v_company, 'invoicing.read');
  return query
  select s.seq::int, s.due_date, s.amount,
         s.amount - least(s.amount, greatest(0, s.cum - v_paid)),
         least(s.amount, greatest(0, s.cum - v_paid)),
         least(s.amount, greatest(0, s.cum - v_paid)) > 0 and s.due_date < current_date
    from (select di.seq, di.due_date, di.amount, sum(di.amount) over (order by di.seq) as cum
            from public.document_instalments di
           where (p_doc_type = 'sales_invoice' and di.sales_invoice_id = p_id) or (p_doc_type = 'vendor_bill' and di.vendor_bill_id = p_id)) s
   order by s.seq;
end $$;

-- Debts: each open instalment in its own age bucket
create or replace function public.partner_aging(p_company uuid, p_kind text, p_as_of date default current_date)
returns table (partner_id uuid, partner_name text, not_due numeric, d1_30 numeric, d31_60 numeric, d61_90 numeric, d90_plus numeric,
               unapplied numeric, total numeric, oldest_due date, documents int)
language sql stable security invoker set search_path = '' as $$
  with raw as (
    select i.id as inv, null::uuid as bill, i.partner_id, i.due_date, i.document_type, i.total, i.exchange_rate,
           i.total - coalesce((select sum(a.amount) from public.payment_allocations a join public.payments p on p.id = a.payment_id
                                where a.sales_invoice_id = i.id and p.status = 'posted' and p.payment_date <= p_as_of), 0) as open_doc,
           case when i.document_type = 'credit_note' then -1 else 1 end as sgn
      from public.sales_invoices i
     where p_kind = 'ar' and i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and i.invoice_date <= p_as_of
    union all
    select null, b.id, b.vendor_id, b.due_date, b.document_type, b.total, b.exchange_rate,
           b.total - coalesce((select sum(a.amount) from public.payment_allocations a join public.payments p on p.id = a.payment_id
                                where a.vendor_bill_id = b.id and p.status = 'posted' and p.payment_date <= p_as_of), 0),
           case when b.document_type = 'vendor_credit' then -1 else 1 end
      from public.vendor_bills b
     where p_kind = 'ap' and b.company_id = p_company and b.status = 'posted' and b.deleted_at is null and b.bill_date <= p_as_of
  ),
  docs as (
    select r.partner_id, pt.due as due_date, r.document_type, round(pt.open * r.exchange_rate, 2) * r.sgn as open_base
      from raw r cross join lateral app.doc_parts(r.inv, r.bill, r.total, r.open_doc, r.due_date) pt
  ),
  unapplied as (
    select p.partner_id, -sum(round(p.unallocated * p.exchange_rate, 2)) as amount
      from public.payments p
     where p.company_id = p_company and p.status = 'posted' and p.payment_date <= p_as_of and p.unallocated > 0
       and p.document_type = case when p_kind = 'ar' then 'customer_payment' else 'vendor_payment' end
     group by p.partner_id
  ),
  agg as (
    select d.partner_id,
           sum(case when d.document_type in ('credit_note','vendor_credit') or d.due_date >= p_as_of then d.open_base else 0 end) as not_due,
           sum(case when d.document_type not in ('credit_note','vendor_credit') and p_as_of - d.due_date between 1 and 30 then d.open_base else 0 end) as d1_30,
           sum(case when d.document_type not in ('credit_note','vendor_credit') and p_as_of - d.due_date between 31 and 60 then d.open_base else 0 end) as d31_60,
           sum(case when d.document_type not in ('credit_note','vendor_credit') and p_as_of - d.due_date between 61 and 90 then d.open_base else 0 end) as d61_90,
           sum(case when d.document_type not in ('credit_note','vendor_credit') and p_as_of - d.due_date > 90 then d.open_base else 0 end) as d90_plus,
           min(d.due_date) filter (where d.open_base > 0) as oldest_due,
           count(*) filter (where d.open_base <> 0) as documents
      from docs d where d.open_base <> 0 group by d.partner_id
  )
  select bp.id, bp.name, coalesce(a.not_due, 0), coalesce(a.d1_30, 0), coalesce(a.d31_60, 0), coalesce(a.d61_90, 0), coalesce(a.d90_plus, 0),
         coalesce(u.amount, 0),
         coalesce(a.not_due, 0) + coalesce(a.d1_30, 0) + coalesce(a.d31_60, 0) + coalesce(a.d61_90, 0) + coalesce(a.d90_plus, 0) + coalesce(u.amount, 0),
         a.oldest_due, coalesce(a.documents, 0)::int
    from public.business_partners bp
    left join agg a on a.partner_id = bp.id
    left join unapplied u on u.partner_id = bp.id
   where bp.company_id = p_company and (a.partner_id is not null or u.partner_id is not null)
   order by 9 desc
$$;

-- the forecast: customers and suppliers by instalment
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;
do $$ begin
  perform app._patch_function('public.cash_forecast',
    $p$  select greatest(i.due_date + round(coalesce(l.late_days, v_avg_late))::int, p_as_of), 'receipt', i.number, i.partner_id, bp.name,
         round(i.amount_due * i.exchange_rate, 2), i.id, i.due_date < p_as_of, coalesce(l.late_days, v_avg_late)
    from public.sales_invoices i
    join public.business_partners bp on bp.id = i.partner_id$p$,
    $p$  select greatest(pt.due + round(coalesce(l.late_days, v_avg_late))::int, p_as_of), 'receipt', i.number || coalesce(' · ' || pt.seq, ''), i.partner_id, bp.name,
         round(pt.open * i.exchange_rate, 2), i.id, pt.due < p_as_of, coalesce(l.late_days, v_avg_late)
    from public.sales_invoices i
    cross join lateral app.doc_parts(i.id, null, i.total, i.amount_due, i.due_date) pt
    join public.business_partners bp on bp.id = i.partner_id$p$);
  perform app._patch_function('public.cash_forecast',
    $p$  select greatest(coalesce(b.due_date, b.bill_date), p_as_of), 'bill', coalesce(b.vendor_invoice_number, b.number), b.vendor_id, bp.name,
         -round(b.amount_due * b.exchange_rate, 2), b.id, coalesce(b.due_date, b.bill_date) < p_as_of, null
    from public.vendor_bills b
    join public.business_partners bp on bp.id = b.vendor_id$p$,
    $p$  select greatest(pt.due, p_as_of), 'bill', coalesce(b.vendor_invoice_number, b.number) || coalesce(' · ' || pt.seq, ''), b.vendor_id, bp.name,
         -round(pt.open * b.exchange_rate, 2), b.id, pt.due < p_as_of, null
    from public.vendor_bills b
    cross join lateral app.doc_parts(null::uuid, b.id, b.total, b.amount_due, coalesce(b.due_date, b.bill_date)) pt
    join public.business_partners bp on bp.id = b.vendor_id$p$);
end $$;
drop function app._patch_function(text, text, text);

-- the proposal: the next instalment decides how urgent a bill is, and what is due this week is proposed
drop function if exists public.payment_proposal(uuid, date);
create or replace function public.payment_proposal(p_company uuid, p_as_of date default current_date)
returns table (bill_id uuid, number text, vendor_invoice_number text, vendor_id uuid, vendor_name text, vendor_iban text,
               bill_date date, due_date date, days_overdue int, currency_code text, total numeric, open_amount numeric, open_base numeric,
               due_now numeric, instalments int, discount_amount numeric, discount_until date, reason text, priority int)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'invoicing.read');
  return query
  select b.id, b.number, b.vendor_invoice_number, b.vendor_id, bp.name, bp.bank_iban, b.bill_date, nx.next_due,
         greatest(p_as_of - nx.next_due, 0)::int,
         b.currency_code::text, b.total, b.amount_due, round(b.amount_due * b.exchange_rate, 2),
         nx.due_now, nx.parts,
         case when pt.discount_pct > 0 and b.bill_date + pt.discount_days >= p_as_of then round(b.amount_due * pt.discount_pct / 100, 2) else 0 end,
         case when pt.discount_pct > 0 and b.bill_date + pt.discount_days >= p_as_of then b.bill_date + pt.discount_days end,
         x.reason,
         case x.reason when 'overdue' then 1 when 'discount' then 2 when 'due_soon' then 3 else 4 end
    from public.vendor_bills b
    join public.business_partners bp on bp.id = b.vendor_id
    left join public.payment_terms pt on pt.id = coalesce(b.payment_term_id, bp.payment_term_id)
    cross join lateral (
      select min(p.due) as next_due, coalesce(sum(p.open) filter (where p.due <= p_as_of + 7), 0) as due_now,
             count(*) filter (where p.seq is not null)::int as parts
        from app.doc_parts(null, b.id, b.total, b.amount_due, coalesce(b.due_date, b.bill_date)) p) nx
    cross join lateral (select case
        when nx.next_due < p_as_of then 'overdue'
        when pt.discount_pct > 0 and b.bill_date + pt.discount_days >= p_as_of then 'discount'
        when nx.next_due <= p_as_of + 7 then 'due_soon'
        else 'later' end as reason) x
   where b.company_id = p_company and b.status = 'posted' and b.deleted_at is null and b.document_type = 'vendor_bill' and b.amount_due > 0
   order by 19, nx.next_due, b.amount_due desc;
end $$;

revoke execute on function app.make_instalments(uuid, uuid) from public, anon, authenticated;
revoke execute on function app.doc_parts(uuid, uuid, numeric, numeric, date) from public, anon;
grant execute on function app.doc_parts(uuid, uuid, numeric, numeric, date) to authenticated;
revoke execute on function public.set_instalments(text, uuid, jsonb), public.document_instalment_list(text, uuid), public.payment_proposal(uuid, date) from public, anon;
grant execute on function public.set_instalments(text, uuid, jsonb), public.document_instalment_list(text, uuid), public.payment_proposal(uuid, date) to authenticated;
grant execute on function public.partner_aging(uuid, text, date) to authenticated;

-- the printed invoice shows its instalments
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;
do $$ begin
  perform app._patch_function('public.document_print',
    $p$'notes', i.notes, 'payment_term', (select name from public.payment_terms where id = i.payment_term_id),$p$,
    $p$'notes', i.notes, 'payment_term', (select name from public.payment_terms where id = i.payment_term_id),
             'instalments', (select jsonb_agg(jsonb_build_object('due_date', di.due_date, 'amount', di.amount) order by di.seq) from public.document_instalments di where di.sales_invoice_id = i.id),$p$);
end $$;
drop function app._patch_function(text, text, text);
