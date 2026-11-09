-- =============================================================================
-- DrisPRO · client contracts and DrisPRO's own invoices to its clients (10.11.2026)
--   A contract (usually yearly) says what the client pays for — the package, extra users or tills, services —
--   at a monthly price, how often it is invoiced (every 1, 3, 6 or 12 months) and in how many days it is paid.
--   DrisPRO's invoices are real sales invoices of DrisPRO's own company inside DrisPRO (the billing company):
--   their numbers, VAT, receivables, payments and reminders work as for any company. Activating a contract:
--     · finds or makes the client as a customer of the billing company;
--     · makes a recurring invoice plan there (in advance, on the chosen day; posted and e-mailed if so set);
--     · invoices the one-time items (installation, training, server) at once;
--     · sets the client's licence to the contract's end (plus a few days' grace) and to its limits.
--   Contracts that renew by themselves are extended at their end; the others are listed before they end.
-- =============================================================================
alter table public.platform_settings add column if not exists billing_company_id uuid references public.companies(id) deferrable initially immediate;
alter table public.platform_settings add column if not exists billing_tax_code text not null default 'VAT18';
alter table public.platform_settings add column if not exists billing_post boolean not null default false;
alter table public.platform_settings add column if not exists billing_email boolean not null default true;
alter table public.platform_settings add column if not exists billing_grace_days int not null default 15 check (billing_grace_days between 0 and 90);

create table if not exists app.client_contracts (
  id                uuid primary key default gen_random_uuid(),
  number            text not null unique,
  client_company_id uuid not null references public.companies(id) deferrable initially immediate,
  partner_id        uuid,                      -- the client as a customer of the billing company
  prev_id           uuid references app.client_contracts(id) deferrable initially immediate,
  status            text not null default 'draft' check (status in ('draft', 'active', 'ended', 'cancelled')),
  signed_on         date,
  start_date        date not null,
  end_date          date not null,
  term_months       smallint not null default 12 check (term_months between 1 and 60),
  auto_renew        boolean not null default true,
  every_months      smallint not null default 1 check (every_months in (1, 2, 3, 6, 12)),
  invoice_day       smallint not null default 1 check (invoice_day between 1 and 28),
  payment_days      smallint not null default 15 check (payment_days between 0 and 120),
  discount_pct      numeric(5,2) not null default 0 check (discount_pct between 0 and 100),
  currency          char(3) not null default 'EUR',
  -- [{description, quantity, unit_price (per month, or the amount once), once}]
  lines             jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array'),
  -- what the licence becomes: {plan, package, max_users, max_registers, max_warehouses}
  licence           jsonb not null default '{}'::jsonb,
  notes             text,
  recurring_id      uuid,
  setup_invoice_id  uuid,
  renewals          int not null default 0,
  renewed_at        timestamptz,
  ended_at          timestamptz,
  end_reason        text,
  created_at        timestamptz not null default now(),
  created_by        uuid default auth.uid(),
  updated_at        timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists client_contracts_client_idx on app.client_contracts (client_company_id, status);
revoke all on app.client_contracts from public, anon, authenticated;

-- the yearly value of a contract, without VAT
create or replace function app.contract_year_value(c app.client_contracts) returns numeric language sql immutable set search_path = '' as $$
  select round(coalesce(sum((l ->> 'quantity')::numeric * (l ->> 'unit_price')::numeric), 0) * 12 * (1 - c.discount_pct / 100), 2)
    from jsonb_array_elements(c.lines) l where not coalesce((l ->> 'once')::boolean, false)
$$;

-- the client as a customer of the billing company (found by NUI or name, or made)
create or replace function app.contract_partner(p_contract uuid) returns uuid language plpgsql security definer set search_path = '' as $$
declare c app.client_contracts; b uuid; k public.companies; v uuid; n int;
begin
  select * into c from app.client_contracts where id = p_contract;
  b := (select billing_company_id from public.platform_settings limit 1);
  if b is null then raise exception 'Choose DrisPRO''s own company for the invoices first (Contracts → Billing)' using errcode = '23514'; end if;
  if c.partner_id is not null and exists (select 1 from public.business_partners where id = c.partner_id and company_id = b and deleted_at is null) then
    return c.partner_id;
  end if;
  select * into k from public.companies where id = c.client_company_id;
  select id into v from public.business_partners
   where company_id = b and deleted_at is null and is_customer
     and ((k.tax_number is not null and tax_number = k.tax_number) or lower(name) = lower(coalesce(k.legal_name, k.name)))
   order by (tax_number = k.tax_number) desc nulls last limit 1;
  if v is null then
    select count(*) + 1 into n from public.business_partners where company_id = b;
    loop
      exit when not exists (select 1 from public.business_partners where company_id = b and code = 'KL' || lpad(n::text, 4, '0'));
      n := n + 1;
    end loop;
    insert into public.business_partners (company_id, code, name, legal_name, kind, is_customer, tax_number, vat_number, email, phone, currency_code)
    values (b, 'KL' || lpad(n::text, 4, '0'), coalesce(k.legal_name, k.name), k.legal_name, 'company', true, k.tax_number, k.vat_number, k.email, k.phone, c.currency)
    returning id into v;
  end if;
  update app.client_contracts set partner_id = v where id = c.id;
  return v;
end $$;

-- the licence follows the contract: valid to its end (plus the grace days), with its limits
create or replace function app.contract_licence(p_contract uuid) returns void language plpgsql security definer set search_path = '' as $$
declare c app.client_contracts; g int;
begin
  select * into c from app.client_contracts where id = p_contract;
  g := coalesce((select billing_grace_days from public.platform_settings limit 1), 15);
  update public.licenses
     set valid_until = c.end_date + g, status = 'active',
         plan = coalesce(nullif(c.licence ->> 'plan', ''), plan),
         package = coalesce(nullif(c.licence ->> 'package', ''), package),
         max_users = coalesce(nullif(c.licence ->> 'max_users', '')::int, max_users),
         max_registers = coalesce(nullif(c.licence ->> 'max_registers', '')::int, max_registers),
         max_warehouses = coalesce(nullif(c.licence ->> 'max_warehouses', '')::int, max_warehouses),
         notes = 'Kontrata ' || c.number || ' deri më ' || to_char(c.end_date, 'DD.MM.YYYY'),
         updated_at = now()
   where company_id = c.client_company_id;
end $$;

-- the lines of the recurring plan: the monthly price times the months of each invoice
create or replace function app.contract_plan_lines(p_contract uuid) returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'description', (l ->> 'description') || ' · {period}' || case when c.every_months > 1 then ' (' || c.every_months || ' muaj)' else '' end,
           'quantity', (l ->> 'quantity')::numeric,
           'unit_price', round((l ->> 'unit_price')::numeric * c.every_months, 2),
           'discount_pct', c.discount_pct,
           'tax_code_id', (select t.id from public.tax_codes t join public.platform_settings s on true
                            where t.company_id = s.billing_company_id and t.code = s.billing_tax_code and t.deleted_at is null limit 1))), '[]'::jsonb)
    from app.client_contracts c, jsonb_array_elements(c.lines) l
   where c.id = p_contract and not coalesce((l ->> 'once')::boolean, false)
$$;

-- ----------------------------------------------------------------------------- what the super admin sees
create or replace function public.platform_billing_settings() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.platform_settings;
begin
  perform app.require_super_admin();
  select * into s from public.platform_settings limit 1;
  return jsonb_build_object('billing_company_id', s.billing_company_id,
    'billing_company', (select name from public.companies where id = s.billing_company_id),
    'tax_code', s.billing_tax_code, 'post', s.billing_post, 'email', s.billing_email, 'grace_days', s.billing_grace_days,
    'tax_codes', coalesce((select jsonb_agg(jsonb_build_object('code', t.code, 'rate', t.rate) order by t.rate desc)
                             from public.tax_codes t where t.company_id = s.billing_company_id and t.deleted_at is null and t.scope in ('sales', 'both')), '[]'::jsonb),
    'companies', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name)
                             from public.companies c where c.deleted_at is null and not coalesce(c.is_training, false)), '[]'::jsonb));
end $$;

create or replace function public.platform_billing_save(p jsonb) returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  update public.platform_settings set
    billing_company_id = coalesce(nullif(p ->> 'billing_company_id', '')::uuid, billing_company_id),
    billing_tax_code = coalesce(nullif(p ->> 'tax_code', ''), billing_tax_code),
    billing_post = coalesce((p ->> 'post')::boolean, billing_post),
    billing_email = coalesce((p ->> 'email')::boolean, billing_email),
    billing_grace_days = coalesce((p ->> 'grace_days')::int, billing_grace_days);
end $$;

create or replace function app.contract_json(c app.client_contracts) returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(c) || jsonb_build_object(
    'client', (select name from public.companies where id = c.client_company_id),
    'client_nui', (select tax_number from public.companies where id = c.client_company_id),
    'year_value', app.contract_year_value(c),
    'month_value', round(app.contract_year_value(c) / 12, 2),
    'once_value', (select coalesce(sum((l ->> 'quantity')::numeric * (l ->> 'unit_price')::numeric), 0) from jsonb_array_elements(c.lines) l where coalesce((l ->> 'once')::boolean, false)),
    'next_invoice', (select next_date from public.recurring_invoices where id = c.recurring_id and is_active),
    'days_left', c.end_date - current_date,
    'invoiced', coalesce((select sum(i.total) from public.sales_invoices i where (i.recurring_id = c.recurring_id or i.id = c.setup_invoice_id) and i.status = 'posted'), 0),
    'open', coalesce((select sum(i.amount_due) from public.sales_invoices i where (i.recurring_id = c.recurring_id or i.id = c.setup_invoice_id) and i.status = 'posted'), 0),
    'overdue', coalesce((select sum(i.amount_due) from public.sales_invoices i where (i.recurring_id = c.recurring_id or i.id = c.setup_invoice_id)
                          and i.status = 'posted' and i.amount_due > 0 and i.due_date < current_date), 0),
    'overdue_days', (select max(current_date - i.due_date) from public.sales_invoices i where (i.recurring_id = c.recurring_id or i.id = c.setup_invoice_id)
                      and i.status = 'posted' and i.amount_due > 0 and i.due_date < current_date),
    'drafts', (select count(*) from public.sales_invoices i where (i.recurring_id = c.recurring_id or i.id = c.setup_invoice_id) and i.status = 'draft'))
$$;

create or replace function public.platform_contracts(p_company uuid default null) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  return jsonb_build_object(
    'contracts', coalesce((select jsonb_agg(app.contract_json(c) order by c.status = 'active' desc, c.end_date)
                             from app.client_contracts c where p_company is null or c.client_company_id = p_company), '[]'::jsonb),
    'totals', (select jsonb_build_object(
                 'active', count(*) filter (where c.status = 'active'),
                 'year_value', coalesce(sum(app.contract_year_value(c)) filter (where c.status = 'active'), 0),
                 'ending_30', count(*) filter (where c.status = 'active' and not c.auto_renew and c.end_date <= current_date + 30),
                 'drafts', count(*) filter (where c.status = 'draft'))
                 from app.client_contracts c where p_company is null or c.client_company_id = p_company));
end $$;

create or replace function public.platform_contract_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c app.client_contracts;
begin
  perform app.require_super_admin();
  select * into c from app.client_contracts where id = p_id;
  if c.id is null then raise exception 'Contract not found' using errcode = 'P0002'; end if;
  return app.contract_json(c) || jsonb_build_object(
    'invoices', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'number', i.number, 'date', i.invoice_date, 'due_date', i.due_date, 'status', i.status,
                                                             'total', i.total, 'amount_due', i.amount_due) order by i.invoice_date desc, i.number desc)
                            from public.sales_invoices i where i.recurring_id = c.recurring_id or i.id = c.setup_invoice_id), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'number', p.number, 'start_date', p.start_date, 'end_date', p.end_date, 'status', p.status) order by p.start_date desc)
                           from app.client_contracts p where p.client_company_id = c.client_company_id and p.id <> c.id), '[]'::jsonb));
end $$;

-- a new contract (draft) or changes to one; an active one carries its new prices to the coming invoices
create or replace function public.platform_contract_save(p jsonb) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := nullif(p ->> 'id', '')::uuid; c app.client_contracts; v_start date; v_term int; v_no text; n int;
begin
  perform app.require_super_admin();
  if jsonb_typeof(coalesce(p -> 'lines', '[]')) <> 'array' or jsonb_array_length(coalesce(p -> 'lines', '[]')) = 0 then
    raise exception 'Add at least one line to the contract' using errcode = '23514';
  end if;
  if exists (select 1 from jsonb_array_elements(p -> 'lines') l
              where length(btrim(coalesce(l ->> 'description', ''))) = 0 or coalesce((l ->> 'quantity')::numeric, 0) <= 0 or coalesce((l ->> 'unit_price')::numeric, -1) < 0) then
    raise exception 'Each line needs a description, a quantity and a price' using errcode = '23514';
  end if;
  v_start := coalesce(nullif(p ->> 'start_date', '')::date, current_date);
  v_term := coalesce(nullif(p ->> 'term_months', '')::int, 12);
  if v_id is null then
    select count(*) + 1 into n from app.client_contracts where number like 'KON-' || to_char(v_start, 'YYYY') || '-%';
    loop
      v_no := 'KON-' || to_char(v_start, 'YYYY') || '-' || lpad(n::text, 3, '0');
      exit when not exists (select 1 from app.client_contracts where number = v_no);
      n := n + 1;
    end loop;
    insert into app.client_contracts (number, client_company_id, start_date, end_date, term_months)
    values (v_no, (p ->> 'client_company_id')::uuid, v_start, coalesce(nullif(p ->> 'end_date', '')::date, (v_start + make_interval(months => v_term))::date - 1), v_term)
    returning id into v_id;
  end if;
  select * into c from app.client_contracts where id = v_id for update;
  if c.status in ('ended', 'cancelled') then raise exception 'This contract is closed: make a new one' using errcode = '55000'; end if;
  update app.client_contracts set
    signed_on = nullif(p ->> 'signed_on', '')::date,
    start_date = case when c.status = 'draft' then v_start else start_date end,
    end_date = coalesce(nullif(p ->> 'end_date', '')::date, case when c.status = 'draft' then (v_start + make_interval(months => v_term))::date - 1 else end_date end),
    term_months = v_term,
    auto_renew = coalesce((p ->> 'auto_renew')::boolean, auto_renew),
    every_months = coalesce(nullif(p ->> 'every_months', '')::int, every_months),
    invoice_day = coalesce(nullif(p ->> 'invoice_day', '')::int, invoice_day),
    payment_days = coalesce(nullif(p ->> 'payment_days', '')::int, payment_days),
    discount_pct = coalesce(nullif(p ->> 'discount_pct', '')::numeric, 0),
    lines = (select jsonb_agg(jsonb_build_object('description', btrim(l ->> 'description'), 'quantity', (l ->> 'quantity')::numeric,
                                                 'unit_price', round((l ->> 'unit_price')::numeric, 2), 'once', coalesce((l ->> 'once')::boolean, false)))
               from jsonb_array_elements(p -> 'lines') l),
    licence = coalesce(p -> 'licence', licence),
    notes = nullif(btrim(coalesce(p ->> 'notes', '')), ''),
    updated_at = now()
   where id = v_id;
  -- an active contract: the coming invoices follow the new prices and dates; the licence too
  if c.status = 'active' and c.recurring_id is not null then
    update public.recurring_invoices r set lines = app.contract_plan_lines(v_id), every_months = x.every_months, day_of_month = x.invoice_day,
           end_date = x.end_date, updated_at = now()
      from app.client_contracts x where x.id = v_id and r.id = c.recurring_id;
    perform app.contract_licence(v_id);
  end if;
  return v_id;
end $$;

-- activation: the customer, the recurring invoices, the one-time invoice and the licence
create or replace function public.platform_contract_activate(p_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c app.client_contracts; s public.platform_settings; v_partner uuid; v_plan uuid; v_inv uuid; v_tax uuid; v_term uuid; v_date date;
begin
  perform app.require_super_admin();
  select * into c from app.client_contracts where id = p_id for update;
  if c.id is null then raise exception 'Contract not found' using errcode = 'P0002'; end if;
  if c.status <> 'draft' then raise exception 'Only a draft contract is activated' using errcode = '55000'; end if;
  select * into s from public.platform_settings limit 1;
  v_partner := app.contract_partner(c.id);
  select id into v_tax from public.tax_codes where company_id = s.billing_company_id and code = s.billing_tax_code and deleted_at is null limit 1;
  if v_tax is null then raise exception 'The billing company has no tax code %', s.billing_tax_code using errcode = '23514'; end if;
  -- the payment term of the contract's days, found or made in the billing company
  select id into v_term from public.payment_terms where company_id = s.billing_company_id and due_days = c.payment_days and deleted_at is null limit 1;
  if v_term is null then
    insert into public.payment_terms (company_id, code, name, due_days) values (s.billing_company_id, 'D' || c.payment_days, c.payment_days || ' ditë', c.payment_days)
    on conflict do nothing returning id into v_term;
    if v_term is null then select id into v_term from public.payment_terms where company_id = s.billing_company_id and code = 'D' || c.payment_days limit 1; end if;
  end if;
  -- the recurring part
  if exists (select 1 from jsonb_array_elements(c.lines) l where not coalesce((l ->> 'once')::boolean, false)) then
    -- invoiced in advance: the first one on the day the contract starts, then on the chosen day of the month
    v_date := c.start_date;
    insert into public.recurring_invoices (company_id, name, partner_id, every_months, day_of_month, next_date, end_date, post, is_active, currency_code,
                                           payment_term_id, notes, lines, email_customer)
    values (s.billing_company_id, 'Kontrata ' || c.number || ' · ' || (select name from public.companies where id = c.client_company_id),
            v_partner, c.every_months, c.invoice_day, v_date, c.end_date, s.billing_post, true, c.currency, v_term,
            'Sipas kontratës ' || c.number || ' · periudha {period}', app.contract_plan_lines(c.id), s.billing_email)
    returning id into v_plan;
  end if;
  -- the one-time part, invoiced now
  if exists (select 1 from jsonb_array_elements(c.lines) l where coalesce((l ->> 'once')::boolean, false)) then
    insert into public.sales_invoices (company_id, partner_id, source, invoice_date, due_date, currency_code, exchange_rate, payment_term_id, notes)
    values (s.billing_company_id, v_partner, 'manual', greatest(c.start_date, current_date), greatest(c.start_date, current_date) + c.payment_days, c.currency, 1, v_term,
            'Sipas kontratës ' || c.number)
    returning id into v_inv;
    insert into public.sales_invoice_lines (company_id, invoice_id, line_no, description, quantity, unit_price, discount_pct, tax_code_id)
    select s.billing_company_id, v_inv, (row_number() over ())::smallint, l ->> 'description', (l ->> 'quantity')::numeric, (l ->> 'unit_price')::numeric, c.discount_pct, v_tax
      from jsonb_array_elements(c.lines) l where coalesce((l ->> 'once')::boolean, false);
    if s.billing_post then perform public.post_sales_invoice(v_inv); end if;
  end if;
  update app.client_contracts set status = 'active', recurring_id = v_plan, setup_invoice_id = v_inv, updated_at = now() where id = c.id;
  -- an earlier active contract of the same client ends when this one starts
  update app.client_contracts set status = 'ended', ended_at = now(), end_reason = 'Zëvendësuar nga ' || c.number
   where client_company_id = c.client_company_id and id <> c.id and status = 'active';
  update public.recurring_invoices set is_active = false, updated_at = now()
   where id in (select recurring_id from app.client_contracts where client_company_id = c.client_company_id and id <> c.id and status = 'ended' and recurring_id is not null);
  perform app.contract_licence(c.id);
  return jsonb_build_object('recurring_id', v_plan, 'setup_invoice_id', v_inv, 'partner_id', v_partner);
end $$;

-- ending: no more invoices; cancelled from the start, or ended on a date (the licence runs to it)
create or replace function public.platform_contract_end(p_id uuid, p_reason text, p_on date default null) returns void language plpgsql security definer set search_path = '' as $$
declare c app.client_contracts;
begin
  perform app.require_super_admin();
  select * into c from app.client_contracts where id = p_id for update;
  if c.id is null then raise exception 'Contract not found' using errcode = 'P0002'; end if;
  if c.status not in ('draft', 'active') then raise exception 'This contract is closed: make a new one' using errcode = '55000'; end if;
  if length(btrim(coalesce(p_reason, ''))) = 0 then raise exception 'Write the reason' using errcode = '23514'; end if;
  update app.client_contracts set status = case when c.status = 'draft' then 'cancelled' else 'ended' end, ended_at = now(), end_reason = btrim(p_reason),
         end_date = case when c.status = 'active' and p_on is not null then greatest(p_on, start_date) else end_date end, auto_renew = false, updated_at = now()
   where id = c.id;
  if c.recurring_id is not null then
    update public.recurring_invoices set is_active = false, end_date = coalesce(p_on, current_date), updated_at = now() where id = c.recurring_id;
  end if;
  if c.status = 'active' then perform app.contract_licence(c.id); end if;
end $$;

-- renewing: the same contract runs one more term (prices may change by a percent)
create or replace function public.platform_contract_renew(p_id uuid, p_price_pct numeric default 0) returns void language plpgsql security definer set search_path = '' as $$
declare c app.client_contracts;
begin
  perform app.require_super_admin();
  select * into c from app.client_contracts where id = p_id for update;
  if c.status <> 'active' then raise exception 'Only an active contract is renewed' using errcode = '55000'; end if;
  perform app.contract_extend(c.id, p_price_pct);
end $$;

create or replace function app.contract_extend(p_id uuid, p_price_pct numeric) returns void language plpgsql security definer set search_path = '' as $$
declare c app.client_contracts;
begin
  update app.client_contracts x set
    end_date = (x.end_date + make_interval(months => x.term_months))::date,
    lines = case when coalesce(p_price_pct, 0) = 0 then x.lines else
              (select jsonb_agg(case when coalesce((l ->> 'once')::boolean, false) then l
                                     else jsonb_set(l, '{unit_price}', to_jsonb(round((l ->> 'unit_price')::numeric * (1 + p_price_pct / 100), 2))) end)
                 from jsonb_array_elements(x.lines) l) end,
    renewals = renewals + 1, renewed_at = now(), updated_at = now()
   where x.id = p_id returning * into c;
  if c.recurring_id is not null then
    update public.recurring_invoices set end_date = c.end_date, lines = app.contract_plan_lines(c.id), is_active = true, updated_at = now() where id = c.recurring_id;
  end if;
  perform app.contract_licence(c.id);
end $$;

-- every morning: contracts that renew by themselves go on; the others end at their date
create or replace function app.client_contracts_daily() returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  for r in select id, auto_renew from app.client_contracts where status = 'active' and end_date < current_date loop
    if r.auto_renew then perform app.contract_extend(r.id, 0);
    else
      update app.client_contracts set status = 'ended', ended_at = now(), end_reason = coalesce(end_reason, 'Mbaroi afati'), updated_at = now() where id = r.id;
      update public.recurring_invoices set is_active = false, updated_at = now() where id = (select recurring_id from app.client_contracts where id = r.id);
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('drispro-client-contracts', '20 4 * * *', 'select app.client_contracts_daily()');
  end if;
exception when others then
  raise notice 'pg_cron not available (%); run app.client_contracts_daily() every morning elsewhere', sqlerrm;
end $$;

revoke execute on function app.contract_partner(uuid), app.contract_licence(uuid), app.contract_plan_lines(uuid), app.contract_json(app.client_contracts),
  app.contract_extend(uuid, numeric), app.client_contracts_daily(), app.contract_year_value(app.client_contracts) from public, anon, authenticated;
revoke execute on function public.platform_billing_settings(), public.platform_billing_save(jsonb), public.platform_contracts(uuid), public.platform_contract_get(uuid),
  public.platform_contract_save(jsonb), public.platform_contract_activate(uuid), public.platform_contract_end(uuid, text, date),
  public.platform_contract_renew(uuid, numeric) from public, anon;
grant execute on function public.platform_billing_settings(), public.platform_billing_save(jsonb), public.platform_contracts(uuid), public.platform_contract_get(uuid),
  public.platform_contract_save(jsonb), public.platform_contract_activate(uuid), public.platform_contract_end(uuid, text, date),
  public.platform_contract_renew(uuid, numeric) to authenticated;
