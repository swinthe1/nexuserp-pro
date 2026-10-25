-- =============================================================================
-- DrisPRO · invoices that repeat (rent, subscriptions, maintenance)
--   Any invoice can be made to repeat: its customer, lines and payment terms become a plan that
--   makes the same invoice every 1, 2, 3, 6 or 12 months on the chosen day, as a draft to check
--   or posted straight away. "{period}" in a line's text becomes the month it is for (10/2026).
--   The plans run every morning; a server that was off makes the missed months when it is back.
-- =============================================================================

create table public.recurring_invoices (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  name            text not null,
  partner_id      uuid not null,
  source_invoice_id uuid,
  every_months    smallint not null default 1 check (every_months in (1, 2, 3, 6, 12)),
  day_of_month    smallint not null default 1 check (day_of_month between 1 and 28),
  next_date       date not null,
  end_date        date,
  post            boolean not null default false,
  is_active       boolean not null default true,
  currency_code   character(3) not null,
  payment_term_id uuid,
  salesperson_id  uuid,
  billing_address_id uuid,
  notes           text,
  lines           jsonb not null default '[]'::jsonb,
  last_invoice_id uuid,
  last_run_at     timestamptz,
  last_error      text,
  made_count      int not null default 0,
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid default auth.uid(),
  foreign key (company_id, partner_id) references public.business_partners(company_id, id)
);
select app.register_table('public.recurring_invoices', 'invoicing', p_soft_delete => false, p_client_write => false, p_audit => true);
create index recurring_invoices_due_idx on public.recurring_invoices (next_date) where is_active;

alter table public.sales_invoices add column recurring_id uuid references public.recurring_invoices(id) on delete set null;

-- the same day N months later (the day is at most 28, so every month has it)
create or replace function app.recurring_next(p_from date, p_months int, p_day int)
returns date language sql immutable set search_path = '' as $$
  select (date_trunc('month', p_from) + make_interval(months => p_months) + make_interval(days => p_day - 1))::date
$$;

-- a plan from an invoice
create or replace function public.recurring_from_invoice(p_invoice uuid, p_name text, p_every int, p_day int, p_start date,
  p_end date default null, p_post boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i public.sales_invoices; v_id uuid; v_first date;
begin
  select * into i from public.sales_invoices where id = p_invoice and deleted_at is null;
  if i.id is null then raise exception 'Invoice not found' using errcode = 'P0002'; end if;
  perform app.require_permission(i.company_id, 'invoicing.write');
  if i.document_type <> 'sales_invoice' then raise exception 'Only invoices can repeat, not credit notes' using errcode = '22023'; end if;
  if p_day not between 1 and 28 then raise exception 'Choose a day from 1 to 28' using errcode = '22023'; end if;
  if p_end is not null and p_end < p_start then raise exception 'The end comes before the start' using errcode = '22023'; end if;
  -- the first run: the chosen day in the start month, or the next month when that day has passed
  v_first := (date_trunc('month', p_start) + make_interval(days => p_day - 1))::date;
  if v_first < p_start then v_first := app.recurring_next(v_first, 1, p_day); end if;
  insert into public.recurring_invoices (company_id, name, partner_id, source_invoice_id, every_months, day_of_month, next_date, end_date, post,
                                         currency_code, payment_term_id, salesperson_id, billing_address_id, notes, lines)
  values (i.company_id, coalesce(nullif(btrim(p_name), ''), i.number), i.partner_id, i.id, p_every, p_day, v_first, p_end, coalesce(p_post, false),
          i.currency_code, i.payment_term_id, i.salesperson_id, i.billing_address_id, i.notes,
          coalesce((select jsonb_agg(jsonb_build_object('variant_id', l.variant_id, 'description', l.description, 'account_id', l.account_id,
                      'cost_center_id', l.cost_center_id, 'quantity', l.quantity, 'uom_id', l.uom_id, 'unit_price', l.unit_price,
                      'discount_pct', l.discount_pct, 'tax_code_id', l.tax_code_id) order by l.line_no)
                      from public.sales_invoice_lines l where l.invoice_id = i.id), '[]'::jsonb))
  returning id into v_id;
  return v_id;
end $$;
grant execute on function public.recurring_from_invoice(uuid, text, int, int, date, date, boolean) to authenticated;

-- one invoice of a plan, for the date it is due
create or replace function app.recurring_make(p_plan uuid, p_date date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.recurring_invoices; v_inv uuid; v_days int; v_period text;
begin
  select * into r from public.recurring_invoices where id = p_plan;
  select coalesce(due_days, 0) into v_days from public.payment_terms where id = r.payment_term_id;
  v_period := to_char(p_date, 'MM/YYYY');
  insert into public.sales_invoices (company_id, partner_id, source, invoice_date, due_date, currency_code, exchange_rate,
                                     payment_term_id, salesperson_id, billing_address_id, notes, recurring_id)
  values (r.company_id, r.partner_id, 'manual', p_date, p_date + coalesce(v_days, 0), r.currency_code,
          case when r.currency_code = (select c.base_currency from public.companies c where c.id = r.company_id) then 1
               else coalesce((select x.rate from public.exchange_rates x where x.company_id = r.company_id and x.currency_code = r.currency_code and x.rate_date <= p_date
                               order by x.rate_date desc limit 1), 1) end,
          r.payment_term_id, r.salesperson_id, r.billing_address_id, replace(coalesce(r.notes, ''), '{period}', v_period), r.id)
  returning id into v_inv;
  update public.sales_invoices set notes = nullif(notes, '') where id = v_inv;
  insert into public.sales_invoice_lines (company_id, invoice_id, line_no, variant_id, description, account_id, cost_center_id, quantity,
                                          uom_id, unit_price, discount_pct, tax_code_id)
  select r.company_id, v_inv, (row_number() over ())::smallint, nullif(l ->> 'variant_id', '')::uuid, replace(l ->> 'description', '{period}', v_period),
         nullif(l ->> 'account_id', '')::uuid, nullif(l ->> 'cost_center_id', '')::uuid, (l ->> 'quantity')::numeric, nullif(l ->> 'uom_id', '')::uuid,
         (l ->> 'unit_price')::numeric, coalesce((l ->> 'discount_pct')::numeric, 0), nullif(l ->> 'tax_code_id', '')::uuid
    from jsonb_array_elements(r.lines) l;
  if r.post then perform public.post_sales_invoice(v_inv); end if;
  return v_inv;
end $$;
revoke execute on function app.recurring_make(uuid, date) from public, anon, authenticated;

-- every morning: what is due (a few missed months at most, one plan's error does not stop the others)
create or replace function public.run_recurring_invoices(p_company uuid default null)
returns int language plpgsql security definer set search_path = '' as $$
declare r record; v_today date; v_inv uuid; n int := 0; v_made jsonb := '{}'::jsonb; k text; v_loops int;
begin
  if p_company is not null then perform app.require_permission(p_company, 'invoicing.write'); end if;
  for r in select p.id, p.company_id, coalesce(c.timezone, 'Europe/Tirane') as tz from public.recurring_invoices p join public.companies c on c.id = p.company_id
            where p.is_active and c.deleted_at is null and (p_company is null or p.company_id = p_company) loop
    v_today := (now() at time zone r.tz)::date;
    v_loops := 0;
    loop
      exit when v_loops >= 12;
      declare p public.recurring_invoices;
      begin
        select * into p from public.recurring_invoices where id = r.id for update;
        exit when p.next_date > v_today or not p.is_active;
        if p.end_date is not null and p.next_date > p.end_date then
          update public.recurring_invoices set is_active = false, updated_at = now() where id = p.id;
          exit;
        end if;
        begin
          v_inv := app.recurring_make(p.id, p.next_date);
          update public.recurring_invoices set next_date = app.recurring_next(p.next_date, p.every_months, p.day_of_month), last_invoice_id = v_inv,
                 last_run_at = now(), last_error = null, made_count = made_count + 1, updated_at = now() where id = p.id;
          n := n + 1;
          v_made := jsonb_set(v_made, array[p.company_id::text], to_jsonb(coalesce((v_made ->> p.company_id::text)::int, 0) + 1));
        exception when others then
          update public.recurring_invoices set last_error = sqlerrm, last_run_at = now(), updated_at = now() where id = p.id;
          exit;
        end;
      end;
      v_loops := v_loops + 1;
    end loop;
  end loop;
  for k in select jsonb_object_keys(v_made) loop
    perform app.notify_permission(k::uuid, 'invoicing.write', 'info', 'Recurring invoices made: ' || (v_made ->> k),
      'Check the drafts and send them to the customers.', '/sales/recurring');
  end loop;
  return n;
end $$;
revoke execute on function public.run_recurring_invoices(uuid) from public, anon;
grant execute on function public.run_recurring_invoices(uuid) to authenticated;

-- the plans with their customer and amount
create or replace function public.recurring_list(p_company uuid)
returns table (id uuid, name text, partner_id uuid, partner_name text, every_months smallint, day_of_month smallint, next_date date, end_date date,
               post boolean, is_active boolean, currency_code text, total numeric, made_count int, last_invoice_id uuid, last_invoice_number text,
               last_run_at timestamptz, last_error text, source_invoice_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'invoicing.read');
  return query
  select r.id, r.name, r.partner_id, bp.name, r.every_months, r.day_of_month, r.next_date, r.end_date, r.post, r.is_active, r.currency_code::text,
         (select coalesce(sum(round(round((l ->> 'quantity')::numeric * (l ->> 'unit_price')::numeric * (1 - coalesce((l ->> 'discount_pct')::numeric, 0) / 100), 2)
                   * (1 + coalesce(t.rate, 0) / 100), 2)), 0)
            from jsonb_array_elements(r.lines) l left join public.tax_codes t on t.id = nullif(l ->> 'tax_code_id', '')::uuid),
         r.made_count, r.last_invoice_id, i.number, r.last_run_at, r.last_error, r.source_invoice_id
    from public.recurring_invoices r
    join public.business_partners bp on bp.id = r.partner_id
    left join public.sales_invoices i on i.id = r.last_invoice_id
   where r.company_id = p_company
   order by r.is_active desc, r.next_date;
end $$;
grant execute on function public.recurring_list(uuid) to authenticated;

create or replace function public.recurring_update(p_id uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.recurring_invoices; v_day int; v_every int;
begin
  select * into r from public.recurring_invoices where id = p_id for update;
  if r.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'invoicing.write');
  if coalesce((p_patch ->> 'delete')::boolean, false) then delete from public.recurring_invoices where id = p_id; return; end if;
  v_day := coalesce((p_patch ->> 'day_of_month')::int, r.day_of_month);
  v_every := coalesce((p_patch ->> 'every_months')::int, r.every_months);
  if v_day not between 1 and 28 then raise exception 'Choose a day from 1 to 28' using errcode = '22023'; end if;
  update public.recurring_invoices set
    name = coalesce(nullif(btrim(p_patch ->> 'name'), ''), name),
    every_months = v_every, day_of_month = v_day,
    next_date = coalesce((p_patch ->> 'next_date')::date, case when v_day <> r.day_of_month then (date_trunc('month', r.next_date) + make_interval(days => v_day - 1))::date else next_date end),
    end_date = case when p_patch ? 'end_date' then nullif(p_patch ->> 'end_date', '')::date else end_date end,
    post = coalesce((p_patch ->> 'post')::boolean, post),
    is_active = coalesce((p_patch ->> 'is_active')::boolean, is_active),
    updated_at = now(), updated_by = auth.uid()
  where id = p_id;
end $$;
grant execute on function public.recurring_update(uuid, jsonb) to authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('nexuserp-recurring', '30 4 * * *', 'select public.run_recurring_invoices()');
  end if;
exception when others then
  raise notice 'pg_cron not available (%); schedule public.run_recurring_invoices() daily elsewhere', sqlerrm;
end $$;
