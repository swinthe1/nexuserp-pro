-- =============================================================================
-- NexusERP Pro · 1100 · Tax & fiscal compliance (Albania / Kosovo)
--
-- * Sales Book / Purchase Book (Libri i Shitjeve / Blerjeve) are views over
--   posted documents, split per VAT rate, in base currency. Credit notes are
--   negative. Views use security_invoker so the caller's RLS applies.
-- * VAT declarations snapshot the books for a period.
-- * Fiscalization records hold the request/response of every fiscalization
--   call. AL: IIC (NSLF) + FIC (NIVF) from the CIS service, TCR & business-
--   unit codes. XK: fiscal device / verification code. The Edge Function that
--   talks to the tax authority writes these rows with the service role.
-- =============================================================================

create table public.vat_declarations (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies(id),
  number                 text not null,
  status                 text not null default 'draft',
  country_code           char(2) not null check (country_code in ('AL','XK')),
  period_start           date not null,
  period_end             date not null,
  sales_taxable_base     numeric(18,2) not null default 0,
  sales_exempt_base      numeric(18,2) not null default 0,
  output_vat             numeric(18,2) not null default 0,
  purchase_taxable_base  numeric(18,2) not null default 0,
  input_vat              numeric(18,2) not null default 0,
  credit_brought_forward numeric(18,2) not null default 0,
  net_vat                numeric(18,2) generated always as (output_vat - input_vat - credit_brought_forward) stored,
  details                jsonb not null default '{}'::jsonb,   -- box-by-box breakdown
  submitted_at           timestamptz,
  submission_reference   text,
  journal_entry_id       uuid,
  foreign key (company_id, journal_entry_id) references public.journal_entries(company_id, id),
  check (period_end >= period_start)
);
select app.register_table('public.vat_declarations', 'tax');
select app.register_document('public.vat_declarations', 'vat_declaration', 'period_end');
alter table public.vat_declarations add constraint vat_declarations_no_overlap
  exclude using gist (company_id extensions.gist_uuid_ops with =, daterange(period_start, period_end, '[]') with &&)
  where (deleted_at is null and status <> 'rejected');

-- AL: Tax Cash Registers / business units registered with the tax authority
create table public.fiscal_tcrs (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id),
  tcr_code           text not null,
  business_unit_code text not null,
  name               text not null,
  register_id        uuid,
  tcr_type           text not null default 'regular' check (tcr_type in ('regular','self_service')),
  valid_from         date,
  valid_to           date,
  status             text not null default 'active' check (status in ('active','inactive')),
  foreign key (company_id, register_id) references public.pos_registers(company_id, id)
);
select app.register_table('public.fiscal_tcrs', 'tax', 'pos');
create unique index fiscal_tcrs_code_key on public.fiscal_tcrs (company_id, tcr_code) where deleted_at is null;

create table public.fiscalization_records (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null,
  country_code       char(2) not null check (country_code in ('AL','XK')),
  source_doc_type    text not null references public.document_types(key),
  source_doc_id      uuid not null,
  status             text not null default 'pending' check (status in ('pending','sent','fiscalized','failed','cancelled')),
  attempt_count      smallint not null default 0,
  iic                text,                    -- AL: Issuer Invoice Code (NSLF)
  iic_signature      text,
  fic                text,                    -- AL: Fiscal Invoice Code (NIVF)
  tcr_code           text,
  business_unit_code text,
  operator_code      text,
  software_code      text,
  verification_code  text,                    -- XK: fiscal verification code
  qr_url             text,                    -- verification URL encoded in the receipt QR
  is_subsequent      boolean not null default false,  -- issued offline, fiscalized later
  request_payload    jsonb,
  response_payload   jsonb,
  error_code         text,
  error_message      text,
  last_attempt_at    timestamptz,
  fiscalized_at      timestamptz
);
select app.register_table('public.fiscalization_records', 'tax', 'core', p_soft_delete => false, p_client_write => false);
create unique index fiscalization_records_live on public.fiscalization_records (source_doc_type, source_doc_id)
  where status in ('pending','sent','fiscalized');
create index fiscalization_records_retry_idx on public.fiscalization_records (company_id, status)
  where status in ('pending','failed');

-- -----------------------------------------------------------------------------
-- Sales & purchase books
-- -----------------------------------------------------------------------------
create or replace view public.v_sales_book with (security_invoker = true) as
select
  i.company_id,
  i.id                                   as document_id,
  i.document_type,
  i.number                               as document_number,
  i.invoice_date                         as document_date,
  p.name                                 as customer_name,
  p.tax_number                           as customer_tax_number,
  l.tax_rate,
  max(tc.code)                           as tax_code,
  bool_or(coalesce(tc.is_exempt, false)) as is_exempt,
  sign_.s * round(sum(l.line_subtotal) * i.exchange_rate, 2) as taxable_base,
  sign_.s * round(sum(l.tax_amount)    * i.exchange_rate, 2) as vat_amount,
  sign_.s * round(sum(l.line_total)    * i.exchange_rate, 2) as total_amount,
  'invoice'::text                        as source
from public.sales_invoices i
join public.sales_invoice_lines l on l.invoice_id = i.id
join public.business_partners p   on p.id = i.partner_id
left join public.tax_codes tc     on tc.id = l.tax_code_id
cross join lateral (select case when i.document_type = 'credit_note' then -1 else 1 end as s) sign_
where i.status = 'posted' and i.deleted_at is null and i.source <> 'pos'
group by i.company_id, i.id, i.document_type, i.number, i.invoice_date, p.name, p.tax_number, l.tax_rate, i.exchange_rate, sign_.s
union all
select
  o.company_id, o.id, case when o.is_refund then 'credit_note' else 'sales_invoice' end,
  o.number, (o.order_at at time zone c.timezone)::date, coalesce(p.name, 'Retail customer'), p.tax_number,
  l.tax_rate, max(tc.code), bool_or(coalesce(tc.is_exempt, false)),
  sum(l.line_subtotal), sum(l.tax_amount), sum(l.line_total), 'pos'
from public.pos_orders o
join public.companies c           on c.id = o.company_id
join public.pos_order_lines l     on l.pos_order_id = o.id
left join public.business_partners p on p.id = o.partner_id
left join public.tax_codes tc     on tc.id = l.tax_code_id
where o.status = 'paid' and o.deleted_at is null
group by o.company_id, o.id, o.is_refund, o.number, o.order_at, c.timezone, p.name, p.tax_number, l.tax_rate;

create or replace view public.v_purchase_book with (security_invoker = true) as
select
  b.company_id,
  b.id                                   as document_id,
  b.document_type,
  b.number                               as document_number,
  b.vendor_invoice_number,
  b.bill_date                            as document_date,
  p.name                                 as vendor_name,
  p.tax_number                           as vendor_tax_number,
  l.tax_rate,
  max(tc.code)                           as tax_code,
  bool_or(coalesce(tc.is_reverse_charge, false)) as is_reverse_charge,
  sign_.s * round(sum(l.line_subtotal) * b.exchange_rate, 2) as taxable_base,
  sign_.s * round(sum(l.tax_amount)    * b.exchange_rate, 2) as vat_amount,
  sign_.s * round(sum(l.line_total)    * b.exchange_rate, 2) as total_amount
from public.vendor_bills b
join public.vendor_bill_lines l  on l.bill_id = b.id
join public.business_partners p  on p.id = b.vendor_id
left join public.tax_codes tc    on tc.id = l.tax_code_id
cross join lateral (select case when b.document_type = 'vendor_credit' then -1 else 1 end as s) sign_
where b.status = 'posted' and b.deleted_at is null
group by b.company_id, b.id, b.document_type, b.number, b.vendor_invoice_number, b.bill_date, p.name, p.tax_number, l.tax_rate, b.exchange_rate, sign_.s;

revoke all on public.v_sales_book, public.v_purchase_book from anon;
grant select on public.v_sales_book, public.v_purchase_book to authenticated;
