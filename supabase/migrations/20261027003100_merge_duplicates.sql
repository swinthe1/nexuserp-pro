-- =============================================================================
-- One way to do one job.
--
--   * Accepting new selling prices (the suggestions worked out from the cost)
--     no longer changes the prices by its own code: it writes a price
--     levelling document (NIV-) and posts it, so every price change has the
--     same document, the stock on hand, the value of the change and labels.
-- =============================================================================

create or replace function public.price_suggestions_decide(p_company uuid, p_ids uuid[], p_accept boolean, p_gross numeric default null)
returns int language plpgsql security definer set search_path = '' as $$
declare s record; n int := 0; v_net numeric; v_level uuid; v_line int := 0;
begin
  perform app.require_permission(p_company, 'inventory.write');
  if p_gross is not null and coalesce(array_length(p_ids, 1), 0) <> 1 then raise exception 'Give another price for one item at a time' using errcode = '22023'; end if;
  if p_gross is not null and p_gross < 0 then raise exception 'The price cannot be negative' using errcode = '22023'; end if;
  for s in select ps.* from public.price_suggestions ps
            where ps.company_id = p_company and ps.id = any (p_ids) and ps.status = 'pending' order by ps.created_at for update of ps loop
    if p_accept then
      v_net := case when p_gross is not null then round(p_gross / (1 + s.tax_rate / 100), 4) else s.price_new end;
      if v_level is null then
        insert into public.price_levels (company_id, notes) values (p_company, 'Çmimet e reja nga kostoja') returning id into v_level;
      end if;
      v_line := v_line + 1;
      insert into public.price_level_lines (company_id, level_id, line_no, variant_id, new_price)
      values (p_company, v_level, v_line, s.variant_id, v_net)
      on conflict (level_id, variant_id) do update set new_price = excluded.new_price;
    end if;
    update public.price_suggestions set status = case when p_accept then 'accepted' else 'rejected' end, decided_by = auth.uid(), decided_at = now(),
           price_new = case when p_accept and p_gross is not null then v_net else price_new end,
           gross_new = case when p_accept and p_gross is not null then round(p_gross, 2) else gross_new end, updated_at = now()
     where id = s.id;
    n := n + 1;
  end loop;
  -- the prices change the one way they always do: a posted levelling
  if v_level is not null then perform public.price_level_post(v_level); end if;
  return n;
end $$;

-- =============================================================================
-- The tax deadlines are written once: the calendar page and the reminders
-- (daily reminders, the accountant's page) read the same rules.
-- =============================================================================
create or replace function app.tax_deadlines(p_company uuid, p_months int)
returns table (obligation text, period_start date, period_end date, due_date date, status text, document_id uuid, document_number text, amount numeric)
language plpgsql stable security definer set search_path = '' as $$
declare v_country text; m date; v_vat int; v_pay int;
begin
  select country_code into v_country from public.companies where id = p_company;
  v_vat := case when v_country = 'XK' then 19 else 13 end;
  v_pay := case when v_country = 'XK' then 14 else 19 end;
  for m in select generate_series(date_trunc('month', current_date) - make_interval(months => greatest(p_months, 1)),
                                  date_trunc('month', current_date) - interval '1 month', interval '1 month')::date loop
    return query
    select 'vat'::text, m, (m + interval '1 month - 1 day')::date, (m + interval '1 month')::date + v_vat,
           coalesce(d.status, case when (m + interval '1 month')::date + v_vat < current_date then 'overdue' else 'open' end),
           d.id, d.number, d.payable
      from (select 1) x left join lateral (select * from public.vat_declarations v where v.company_id = p_company and v.deleted_at is null
                                             and v.status <> 'rejected' and v.period_start = m limit 1) d on true;
    return query
    select 'payroll'::text, m, (m + interval '1 month - 1 day')::date, (m + interval '1 month')::date + v_pay,
           coalesce(case when r.status in ('posted','paid') then 'declared' else r.status end,
                    case when (m + interval '1 month')::date + v_pay < current_date then 'overdue' else 'open' end),
           r.id, r.number, r.total_income_tax + r.total_employee_contrib + r.total_employer_contrib
      from (select 1) x left join lateral (select * from public.payroll_runs pr where pr.company_id = p_company and pr.deleted_at is null
                                             and pr.status <> 'cancelled' and pr.period_start = m limit 1) r on true;
  end loop;
end $$;
revoke execute on function app.tax_deadlines(uuid, int) from public, anon, authenticated;

create or replace function public.tax_calendar(p_company uuid, p_months int default 6)
returns table (obligation text, period_start date, period_end date, due_date date, status text, document_id uuid, document_number text, amount numeric)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.has_permission(p_company, 'tax.read') or app.has_permission(p_company, 'payroll.read')) then
    raise exception 'Permission denied: tax.read required' using errcode = '42501';
  end if;
  return query select * from app.tax_deadlines(p_company, p_months);
end $$;

-- last month only, for the reminders; the payroll one only when there are employees
create or replace function public.tax_calendar_internal(p_company uuid)
returns table (obligation text, period_start date, period_end date, due_date date, status text, document_id uuid, document_number text, amount numeric)
language sql stable security definer set search_path = '' as $$
  select * from app.tax_deadlines(p_company, 1) t
   where t.obligation <> 'payroll' or exists (select 1 from public.employees e where e.company_id = p_company and e.deleted_at is null)
$$;
revoke execute on function public.tax_calendar_internal(uuid) from public, anon, authenticated;

-- =============================================================================
-- A desktop release is saved one way, whether the platform owner uploads it
-- or the builder publishes it with its key.
-- =============================================================================
create or replace function app.desktop_release_save(p_platform text, p_version text, p_file_name text, p_size bigint, p_parts int, p_sha256 text, p_notes text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.desktop_file_ok(p_platform, p_file_name) then raise exception 'This is not the installer for that system' using errcode = '22023'; end if;
  insert into app.desktop_releases (platform, version, file_name, size_bytes, parts, sha256, notes, published_by)
  values (p_platform, p_version, p_file_name, p_size, p_parts, lower(p_sha256), nullif(btrim(p_notes), ''), auth.uid())
  on conflict (platform, version) do update set file_name = excluded.file_name, size_bytes = excluded.size_bytes, parts = excluded.parts,
    sha256 = excluded.sha256, notes = excluded.notes, published_at = now(), published_by = excluded.published_by;
end $$;
revoke execute on function app.desktop_release_save(text, text, text, bigint, int, text, text) from public, anon, authenticated;

create or replace function public.platform_desktop_publish(p_version text, p_file_name text, p_size bigint, p_parts int, p_sha256 text,
                                                           p_notes text default null, p_platform text default 'windows')
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  perform app.desktop_release_save(p_platform, p_version, p_file_name, p_size, p_parts, p_sha256, p_notes);
end $$;

create or replace function public.desktop_publish_with_key(p_key text, p_version text, p_file_name text, p_size bigint, p_parts int, p_sha256 text,
                                                           p_notes text default null, p_platform text default 'windows')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not app.publish_key_ok(p_key) then raise exception 'Unknown publishing key' using errcode = '28000'; end if;
  perform app.desktop_release_save(p_platform, p_version, p_file_name, p_size, p_parts, p_sha256, p_notes);
end $$;

-- =============================================================================
-- Sending a PDF by email: one function puts it in the outbox, for documents
-- (invoice, order, receipt…) and for statements (partner card, open items).
-- The purchase order's own "email to the vendor" goes the same way now; the
-- automatic email on approval stays.
-- =============================================================================
create or replace function app.email_pdf(p_company uuid, p_to text, p_subject text, p_message text, p_pdf text, p_filename text, p_entity_type text, p_entity_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if coalesce(btrim(p_to), '') !~ '^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$' then raise exception 'Write a valid email address' using errcode = '22023'; end if;
  if not exists (select 1 from app.mail_accounts where company_id = p_company and is_active) then
    raise exception 'Set up the company mailbox first (Automations › Email)' using errcode = '55000';
  end if;
  if p_pdf is null or length(p_pdf) > 8000000 then raise exception 'The PDF is missing or too large' using errcode = '22023'; end if;
  v_id := app.enqueue_message(p_company, 'email', btrim(p_to), left(coalesce(nullif(btrim(p_subject), ''), p_filename, 'Dokument'), 300),
            coalesce(p_message, ''), null, 'document', null, null, p_entity_type, p_entity_id);
  update app.message_outbox set attachments = jsonb_build_array(jsonb_build_object('name', coalesce(nullif(p_filename, ''), 'document.pdf'),
           'mime', 'application/pdf', 'data', p_pdf)) where id = v_id;
  return v_id;
end $$;
revoke execute on function app.email_pdf(uuid, text, text, text, text, text, text, uuid) from public, anon, authenticated;

create or replace function public.pdf_email(p_company uuid, p_to text, p_subject text, p_message text, p_pdf text, p_filename text, p_entity_type text, p_entity_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'invoicing.write');
  return app.email_pdf(p_company, p_to, p_subject, p_message, p_pdf, p_filename, p_entity_type, p_entity_id);
end $$;

create or replace function public.document_email(p_kind text, p_id uuid, p_to text, p_subject text, p_message text, p_pdf text, p_filename text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_co uuid; v_perm text;
begin
  v := public.document_print(p_kind, p_id);          -- also checks the right to see it
  v_co := case p_kind
    when 'sales_invoice' then (select company_id from public.sales_invoices where id = p_id)
    when 'sales_quote' then (select company_id from public.sales_quotes where id = p_id)
    when 'proforma_quote' then (select company_id from public.sales_quotes where id = p_id)
    when 'sales_order' then (select company_id from public.sales_orders where id = p_id)
    when 'proforma' then (select company_id from public.sales_orders where id = p_id)
    when 'delivery' then (select company_id from public.deliveries where id = p_id)
    when 'payment' then (select company_id from public.payments where id = p_id)
    when 'purchase_order' then (select company_id from public.purchase_orders where id = p_id)
    when 'goods_receipt' then (select company_id from public.goods_receipts where id = p_id) end;
  v_perm := case when p_kind in ('sales_invoice', 'payment') then 'invoicing.write' when p_kind = 'purchase_order' then 'procurement.write'
                 when p_kind = 'goods_receipt' then 'inventory.write' else 'sales.write' end;
  perform app.require_permission(v_co, v_perm);
  return app.email_pdf(v_co, p_to, coalesce(nullif(btrim(p_subject), ''), v ->> 'number'), p_message, p_pdf, p_filename, p_kind, p_id);
end $$;

drop function if exists public.email_purchase_order(uuid, text);

-- =============================================================================
-- The register: one lookup. A full NUI in registry_search gives the same
-- business as registry_get did.
-- =============================================================================
drop function if exists public.registry_get(text);
