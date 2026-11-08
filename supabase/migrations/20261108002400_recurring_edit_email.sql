-- =============================================================================
-- DrisPRO · recurring invoices: the lines can be changed, and the invoices can go to the customer
-- (audit, wave 2)
--   · recurring_update takes 'lines': the text, quantity, price, discount and VAT of each line, checked
--     like an invoice's (items and VAT codes of the company only).
--   · "Send to the customer by email": once a plan's invoice is posted it waits on the Recurring page
--     until it is sent (as the PDF, from the company mailbox). Only invoices made after it was switched on.
-- =============================================================================
alter table public.recurring_invoices
  add column if not exists email_customer boolean not null default false,
  add column if not exists email_from timestamptz;

create or replace function public.recurring_update(p_id uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.recurring_invoices; v_day int; v_every int; v_lines jsonb; l jsonb; v_email boolean;
begin
  select * into r from public.recurring_invoices where id = p_id for update;
  if r.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'invoicing.write');
  if coalesce((p_patch ->> 'delete')::boolean, false) then delete from public.recurring_invoices where id = p_id; return; end if;
  v_day := coalesce((p_patch ->> 'day_of_month')::int, r.day_of_month);
  v_every := coalesce((p_patch ->> 'every_months')::int, r.every_months);
  if v_day not between 1 and 28 then raise exception 'Choose a day from 1 to 28' using errcode = '22023'; end if;

  -- the lines, when sent: only the known fields, each one checked
  if p_patch ? 'lines' then
    if jsonb_typeof(p_patch -> 'lines') <> 'array' or jsonb_array_length(p_patch -> 'lines') = 0 then
      raise exception 'An invoice needs at least one line' using errcode = '22023';
    end if;
    v_lines := '[]'::jsonb;
    for l in select * from jsonb_array_elements(p_patch -> 'lines') loop
      if coalesce(btrim(l ->> 'description'), '') = '' then raise exception 'Every line needs a text' using errcode = '22023'; end if;
      if coalesce((l ->> 'quantity')::numeric, 0) <= 0 then raise exception 'The quantity must be more than 0' using errcode = '22023'; end if;
      if coalesce((l ->> 'unit_price')::numeric, -1) < 0 then raise exception 'The price cannot be below 0' using errcode = '22023'; end if;
      if coalesce((l ->> 'discount_pct')::numeric, 0) not between 0 and 100 then raise exception 'The discount is from 0 to 100%%' using errcode = '22023'; end if;
      if nullif(l ->> 'variant_id', '') is not null and not exists (select 1 from public.product_variants v where v.id = (l ->> 'variant_id')::uuid and v.company_id = r.company_id) then
        raise exception 'Item not found' using errcode = 'P0002';
      end if;
      if nullif(l ->> 'tax_code_id', '') is not null and not exists (select 1 from public.tax_codes x where x.id = (l ->> 'tax_code_id')::uuid and x.company_id = r.company_id) then
        raise exception 'VAT code not found' using errcode = 'P0002';
      end if;
      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'variant_id', nullif(l ->> 'variant_id', ''), 'description', left(btrim(l ->> 'description'), 1000),
        'account_id', nullif(l ->> 'account_id', ''), 'cost_center_id', nullif(l ->> 'cost_center_id', ''),
        'quantity', (l ->> 'quantity')::numeric, 'uom_id', nullif(l ->> 'uom_id', ''),
        'unit_price', round((l ->> 'unit_price')::numeric, 4), 'discount_pct', coalesce((l ->> 'discount_pct')::numeric, 0),
        'tax_code_id', nullif(l ->> 'tax_code_id', '')));
    end loop;
  end if;
  v_email := coalesce((p_patch ->> 'email_customer')::boolean, r.email_customer);

  update public.recurring_invoices set
    name = coalesce(nullif(btrim(p_patch ->> 'name'), ''), name),
    every_months = v_every, day_of_month = v_day,
    next_date = coalesce((p_patch ->> 'next_date')::date, case when v_day <> r.day_of_month then (date_trunc('month', r.next_date) + make_interval(days => v_day - 1))::date else next_date end),
    end_date = case when p_patch ? 'end_date' then nullif(p_patch ->> 'end_date', '')::date else end_date end,
    post = coalesce((p_patch ->> 'post')::boolean, post),
    is_active = coalesce((p_patch ->> 'is_active')::boolean, is_active),
    lines = coalesce(v_lines, lines),
    email_customer = v_email,
    email_from = case when v_email and not r.email_customer then now() when not v_email then null else email_from end,
    updated_at = now(), updated_by = auth.uid()
  where id = p_id;
end $$;
grant execute on function public.recurring_update(uuid, jsonb) to authenticated;

-- the posted invoices of plans that send them, not yet sent (by any email of that invoice)
create or replace function public.recurring_to_send(p_company uuid)
returns table (invoice_id uuid, number text, invoice_date date, partner_name text, email text, plan_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'invoicing.read');
  return query
  select i.id, i.number, i.invoice_date, bp.name, nullif(btrim(bp.email), ''), r.name
    from public.sales_invoices i
    join public.recurring_invoices r on r.id = i.recurring_id
    join public.business_partners bp on bp.id = i.partner_id
   where i.company_id = p_company and r.email_customer and i.status = 'posted' and i.deleted_at is null
     and i.created_at >= r.email_from
     and not exists (select 1 from app.message_outbox m where m.company_id = p_company and m.entity_type = 'sales_invoice' and m.entity_id = i.id)
   order by i.invoice_date, i.number;
end $$;
revoke execute on function public.recurring_to_send(uuid) from public, anon;
grant execute on function public.recurring_to_send(uuid) to authenticated;

-- the list says which plans send theirs
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;
drop function public.recurring_list(uuid);
create function public.recurring_list(p_company uuid)
returns table (id uuid, name text, partner_id uuid, partner_name text, every_months smallint, day_of_month smallint, next_date date, end_date date,
               post boolean, is_active boolean, currency_code text, total numeric, made_count int, last_invoice_id uuid, last_invoice_number text,
               last_run_at timestamptz, last_error text, source_invoice_id uuid, email_customer boolean, partner_email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'invoicing.read');
  return query
  select r.id, r.name, r.partner_id, bp.name, r.every_months, r.day_of_month, r.next_date, r.end_date, r.post, r.is_active, r.currency_code::text,
         (select coalesce(sum(round(round((l ->> 'quantity')::numeric * (l ->> 'unit_price')::numeric * (1 - coalesce((l ->> 'discount_pct')::numeric, 0) / 100), 2)
                   * (1 + coalesce(t.rate, 0) / 100), 2)), 0)
            from jsonb_array_elements(r.lines) l left join public.tax_codes t on t.id = nullif(l ->> 'tax_code_id', '')::uuid),
         r.made_count, r.last_invoice_id, i.number, r.last_run_at, r.last_error, r.source_invoice_id, r.email_customer, nullif(btrim(bp.email), '')
    from public.recurring_invoices r
    join public.business_partners bp on bp.id = r.partner_id
    left join public.sales_invoices i on i.id = r.last_invoice_id
   where r.company_id = p_company
   order by r.is_active desc, r.next_date;
end $$;
revoke execute on function public.recurring_list(uuid) from public, anon;
grant execute on function public.recurring_list(uuid) to authenticated;

-- the morning note says when some are waiting to be sent
select app._patch_function('public.run_recurring_invoices',
  $x$'Check the drafts and send them to the customers.'$x$,
  $x$case when exists (select 1 from public.recurring_invoices x where x.company_id = k::uuid and x.email_customer)
         then 'Open Recurring invoices and send them to the customers.' else 'Check the drafts and send them to the customers.' end$x$);
drop function app._patch_function(text, text, text);
