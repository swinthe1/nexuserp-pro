-- =============================================================================
-- DrisPRO · work the program now does by itself (from the review, approved by the owner)
--   Daily, per company (from the worker's tick, any server, with or without pg_cron):
--     * quotes past their validity become "expired"; a sent quote gets a "call the customer" task after 3 days
--     * goods waiting more than 7 days for the supplier's invoice get a "ask for the invoice" task
--     * the next financial year is opened in the last month of the current one
--     * on the 1st, the draft VAT declaration of the month before (VAT-registered companies in AL/XK)
--     * open bank statements are matched again against the payments posted since the import
--     * appointments that ended still "booked" or "confirmed" become "did not come"
--     * the client's administrator is told 30, 14 and 3 days before the licence ends
--   Hourly, per company:
--     * confirmed orders reserve stock that arrived since (oldest orders first)
--     * documents waiting for fiscalization in Albania are sent
--   Nothing is booked or submitted without a person: drafts, tasks and notices only, and every step
--   stands alone (one that fails does not stop the others).
-- =============================================================================

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;   -- already done
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;

create or replace function app.automations_daily(p_company uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.companies; tz text; v_today date; r record; v_end date; v_prev date; v_admin uuid;
  n_exp int := 0; n_fol int := 0; n_bill int := 0; n_year int := 0; n_vat int := 0; n_bank int := 0; n_appt int := 0; n_lic int := 0;
begin
  select * into c from public.companies where id = p_company and deleted_at is null;
  if c.id is null then return null; end if;
  tz := coalesce(c.timezone, 'Europe/Tirane');
  v_today := (now() at time zone tz)::date;

  -- quotes: past their validity → expired; sent 3 days ago and still open → call the customer
  begin
    update public.sales_quotes set status = 'expired', updated_at = now()
     where company_id = p_company and status = 'sent' and deleted_at is null and valid_until < v_today;
    get diagnostics n_exp = row_count;
    for r in select q.id, q.number, coalesce(q.created_by, app.first_with_role(p_company, array['sales_manager', 'company_admin'])) as who
               from public.sales_quotes q
              where q.company_id = p_company and q.status = 'sent' and q.deleted_at is null and q.quote_date <= v_today - 3
                and (q.valid_until is null or q.valid_until >= v_today) loop
      if app.auto_task(p_company, 'quote_follow:' || r.id, 'Telefono klientin për ofertën ' || r.number, r.who, v_today + 1, 2::smallint,
                       'sales_quotes', r.id, r.number) then n_fol := n_fol + 1; end if;
    end loop;
  exception when others then raise warning 'quotes (%): %', p_company, sqlerrm;
  end;

  -- goods received a week ago, still without the supplier's invoice → ask for it
  begin
    for r in select g.id, g.number, coalesce(g.created_by, app.first_with_role(p_company, array['procurement_manager', 'company_admin'])) as who
               from public.goods_receipts g
              where g.company_id = p_company and g.status = 'done' and g.receipt_type = 'purchase' and g.deleted_at is null
                and g.fiscal_status = 'pending_invoice' and g.receipt_date <= v_today - 7 loop
      if app.auto_task(p_company, 'receipt_bill:' || r.id, 'Kërko faturën e furnitorit për ' || r.number, r.who, v_today + 2, 2::smallint,
                       'goods_receipts', r.id, r.number) then n_bill := n_bill + 1; end if;
    end loop;
  exception when others then raise warning 'receipts (%): %', p_company, sqlerrm;
  end;

  -- the next financial year, opened in the last month of the current one (so posting on its first day does not stop)
  begin
    select max(end_date) into v_end from public.fiscal_years where company_id = p_company and deleted_at is null;
    if v_end is not null and v_end - v_today between 0 and 31
       and not exists (select 1 from public.fiscal_years where company_id = p_company and deleted_at is null and start_date = v_end + 1) then
      perform public.create_fiscal_year(p_company, extract(year from v_end + 1)::int);
      n_year := 1;
    end if;
  exception when others then raise warning 'fiscal year (%): %', p_company, sqlerrm;
  end;

  -- on the 1st: the draft VAT declaration of the month before (a VAT-registered company in Albania or Kosovo)
  begin
    if c.country_code in ('AL', 'XK') and coalesce(c.vat_number, '') <> '' and extract(day from v_today) <= 3 then
      v_prev := (date_trunc('month', v_today) - interval '1 month')::date;
      if not exists (select 1 from public.vat_declarations where company_id = p_company and deleted_at is null and status <> 'rejected'
                       and period_start <= v_prev and period_end >= v_prev) then
        perform public.create_vat_declaration(p_company, extract(year from v_prev)::int, extract(month from v_prev)::int);
        n_vat := 1;
      end if;
    end if;
  exception when others then raise warning 'vat declaration (%): %', p_company, sqlerrm;
  end;

  -- open bank statements: matched again against the payments posted since the import
  for r in select id from public.bank_statements where company_id = p_company and status = 'open' and deleted_at is null loop
    begin
      perform public.auto_match_statement(r.id);
      perform public.settle_statement(r.id);
      n_bank := n_bank + 1;
    exception when others then raise warning 'statement %: %', r.id, sqlerrm;
    end;
  end loop;

  -- appointments that ended still waiting → did not come
  begin
    update public.appointments set status = 'no_show', updated_at = now()
     where company_id = p_company and deleted_at is null and invoice_id is null and status in ('booked', 'confirmed')
       and ends_at < (v_today::timestamp at time zone tz);
    get diagnostics n_appt = row_count;
  exception when others then raise warning 'appointments (%): %', p_company, sqlerrm;
  end;

  -- the licence ends in 30, 14 or 3 days: the client's administrator is told
  begin
    for r in select l.valid_until, l.valid_until - v_today as days from public.licenses l
              where l.company_id = p_company and l.status = 'active' and l.valid_until - v_today in (30, 14, 3) loop
      v_admin := app.first_with_role(p_company, array['company_admin']);
      if v_admin is not null and app.once_today('licence_note_' || r.days, p_company, v_today) then
        perform app.notify(p_company, v_admin, 'licence', 'Licenca e DrisPRO mbaron pas ' || r.days || ' ditësh',
          'Licenca vlen deri më ' || to_char(r.valid_until, 'DD.MM.YYYY') || '. Për ta vazhduar, kontaktoni DrisPRO.', '/settings');
        n_lic := n_lic + 1;
      end if;
    end loop;
  exception when others then raise warning 'licence note (%): %', p_company, sqlerrm;
  end;

  return jsonb_build_object('quotes_expired', n_exp, 'quote_tasks', n_fol, 'invoice_tasks', n_bill, 'new_year', n_year, 'vat_draft', n_vat,
                            'statements', n_bank, 'no_shows', n_appt, 'licence_notes', n_lic);
end $$;
revoke all on function app.automations_daily(uuid) from public;

create or replace function app.automations_hourly(p_company uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; n_res int := 0; v_country text;
begin
  -- confirmed orders take the stock that arrived since, the oldest orders first
  for r in select id from public.sales_orders
            where company_id = p_company and deleted_at is null and status in ('confirmed', 'partially_delivered')
            order by coalesce(confirmed_at, created_at) limit 300 loop
    begin
      if coalesce(app.reserve_sales_order(r.id), 0) > 0 then n_res := n_res + 1; end if;
    exception when others then null;   -- an order that cannot reserve now waits for the next hour
    end;
  end loop;
  -- Albania: the documents waiting for fiscalization go out without anyone pressing "Send"
  select country_code into v_country from public.companies where id = p_company;
  if v_country = 'AL' then
    begin
      perform public.process_fiscal_queue(p_company);
    exception when others then raise warning 'fiscal queue (%): %', p_company, sqlerrm;
    end;
  end if;
  return jsonb_build_object('orders_reserved', n_res);
end $$;
revoke all on function app.automations_hourly(uuid) from public;

-- the worker's tick runs them for every company
select app._patch_function('public.automation_tick',
  $x$    if c.dunning_enabled and v_hour >= 9 and app.once_today('dunning', c.id, v_day) then$x$,
  $x$    if v_hour >= 5 and app.once_today('autos_daily', c.id, v_day) then perform app.automations_daily(c.id); end if;
    if app.once_today('autos_h' || v_hour, c.id, v_day) then perform app.automations_hourly(c.id); end if;
    if c.dunning_enabled and v_hour >= 9 and app.once_today('dunning', c.id, v_day) then$x$);

drop function app._patch_function(text, text, text);
