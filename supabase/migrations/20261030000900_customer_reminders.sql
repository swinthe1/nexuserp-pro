-- =============================================================================
-- Customer payment reminders, finished
--  * before the due date too: "your invoice is due on …" a few days ahead (each invoice once)
--  * by instalment: an invoice paid in parts is reminded part by part, for what is open on that part
--  * a customer can be left out of reminders (an agreement, a dispute, a good long-time customer)
--  * a reminder can be sent by hand at any moment (from Debts or the customer's page), and
--    every reminder a customer got is listed on their page
-- =============================================================================

alter table public.company_settings add column if not exists reminder_before_enabled boolean not null default false;
alter table public.company_settings add column if not exists reminder_before_days smallint not null default 3 check (reminder_before_days between 1 and 30);
alter table public.company_settings add column if not exists reminder_before_text text;
alter table public.business_partners add column if not exists no_reminders boolean not null default false;

-- a step is kept per instalment: seq 0 is an invoice without a schedule; a negative step is a reminder before the due date
alter table app.dunning_log add column if not exists seq int not null default 0;
alter table app.dunning_log drop constraint if exists dunning_log_pkey;
alter table app.dunning_log add primary key (invoice_id, seq, step);

-- what each customer is due to be reminded of today: overdue parts that reached a new step, and parts due in N days
create or replace function app.reminder_due(p_company uuid, p_today date)
returns table (kind text, partner_id uuid, invoice_id uuid, number text, seq int, due date, amount numeric, currency text, step int, late int)
language sql stable security definer set search_path = '' as $$
  with s as (select * from public.company_settings where company_id = p_company),
  parts as (
    select i.id, i.partner_id, i.number, i.currency_code::text as cur, coalesce(pt.seq, 0) as seq, pt.due, pt.open
      from public.sales_invoices i
      join public.business_partners bp on bp.id = i.partner_id and not bp.no_reminders
      cross join lateral app.doc_parts(i.id, null, i.total, i.amount_due, i.due_date) pt
     where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and i.document_type = 'sales_invoice'
       and i.amount_due > 0 and pt.due is not null and pt.open > 0
  )
  select 'overdue', p.partner_id, p.id, p.number, p.seq, p.due, p.open, p.cur,
         (select max(st) from unnest((select dunning_steps from s)) st where st >= 0 and st <= p_today - p.due), p_today - p.due
    from parts p
   where (select dunning_enabled from s) and p.due < p_today
     and (select max(st) from unnest((select dunning_steps from s)) st where st >= 0 and st <= p_today - p.due) is not null
     and not exists (select 1 from app.dunning_log l where l.invoice_id = p.id and l.seq = p.seq
                       and l.step = (select max(st) from unnest((select dunning_steps from s)) st where st >= 0 and st <= p_today - p.due))
  union all
  select 'upcoming', p.partner_id, p.id, p.number, p.seq, p.due, p.open, p.cur, -(select reminder_before_days from s)::int, p_today - p.due
    from parts p
   where (select reminder_before_enabled from s) and p.due >= p_today and p.due - p_today <= (select reminder_before_days from s)
     and not exists (select 1 from app.dunning_log l where l.invoice_id = p.id and l.seq = p.seq and l.step < 0)
$$;

-- one message to one customer: the list of what is (over)due, by email and/or WhatsApp
create or replace function app.send_customer_reminder(p_company uuid, p_partner uuid, p_kind text, p_items jsonb, p_manual boolean default false)
returns int language plpgsql security definer set search_path = '' as $$
declare s public.company_settings; c public.companies; bp public.business_partners; v_list text; v_html text; v_vars jsonb; v_subject text; v_body text;
  v_total numeric; v_cur text; v_late int; v_sent int := 0; v_key text; v_today date;
begin
  select * into s from public.company_settings where company_id = p_company;
  select * into c from public.companies where id = p_company;
  select * into bp from public.business_partners where id = p_partner;
  v_today := (now() at time zone coalesce(c.timezone, 'Europe/Tirane'))::date;
  select sum((x ->> 'amount')::numeric), min(x ->> 'currency'), max((x ->> 'late')::int) into v_total, v_cur, v_late from jsonb_array_elements(p_items) x;
  select string_agg((x ->> 'number') || case when (x ->> 'seq')::int > 0 then ' · kësti ' || (x ->> 'seq') else '' end
                    || ' · ' || to_char((x ->> 'due')::date, 'DD.MM.YYYY') || ' · ' || app.money_text((x ->> 'amount')::numeric, v_cur), E'\n' order by x ->> 'due'),
         string_agg('<tr><td style="padding:6px 0;border-bottom:1px solid #eef1f6">' || app.html(x ->> 'number')
                    || case when (x ->> 'seq')::int > 0 then ' · kësti ' || (x ->> 'seq') else '' end || '</td><td style="padding:6px 0;border-bottom:1px solid #eef1f6">'
                    || to_char((x ->> 'due')::date, 'DD.MM.YYYY') || '</td><td style="padding:6px 0;border-bottom:1px solid #eef1f6;text-align:right">'
                    || app.money_text((x ->> 'amount')::numeric, v_cur) || '</td></tr>', '' order by x ->> 'due')
    into v_list, v_html from jsonb_array_elements(p_items) x;
  v_vars := jsonb_build_object('customer', bp.name, 'company', c.name, 'total', app.money_text(v_total, v_cur), 'days', greatest(coalesce(v_late, 0), 0),
                               'invoices', v_list, 'phone', coalesce(c.phone, ''), 'email', coalesce(c.email, ''),
                               'date', (select to_char(min((x ->> 'due')::date), 'DD.MM.YYYY') from jsonb_array_elements(p_items) x));
  if p_kind = 'upcoming' then
    v_subject := app.dunning_text(null, 'Afati i pagesës po afron · {company}', v_vars);
    v_body := app.dunning_text(s.reminder_before_text, E'Përshëndetje {customer},\n\nJu kujtojmë me mirësjellje se këto pagesa kanë afat së shpejti:\n{invoices}\n\nGjithsej: {total}\n\nNëse e keni paguar tashmë, ju lutemi mos e merrni parasysh këtë mesazh.\nFaleminderit,\n{company} {phone}', v_vars);
  else
    v_subject := app.dunning_text(s.dunning_subject, 'Kujtesë pagese nga {company}', v_vars);
    v_body := app.dunning_text(s.dunning_text, E'Përshëndetje {customer},\n\nJu kujtojmë se këto fatura janë ende të papaguara:\n{invoices}\n\nGjithsej: {total}\n\nNëse e keni paguar tashmë, ju lutemi mos e merrni parasysh këtë mesazh.\nFaleminderit,\n{company} {phone}', v_vars);
  end if;
  v_key := 'reminder:' || p_kind || ':' || p_partner || ':' || v_today || case when p_manual then ':' || extract(epoch from now())::bigint else '' end;
  if (p_manual or coalesce(s.dunning_email, true)) and coalesce(bp.email, '') <> '' then
    perform app.enqueue_message(p_company, 'email', bp.email, v_subject, v_body,
      app.mail_page(c.name, v_subject, '<p style="white-space:pre-line">' || app.html(split_part(v_body, v_list, 1)) || '</p>'
        || '<table style="width:100%;border-collapse:collapse;margin:8px 0 16px">' || v_html || '</table>'
        || '<p style="white-space:pre-line">' || app.html(split_part(v_body, v_list, 2)) || '</p>'),
      'dunning', null, v_key, 'business_partners', p_partner);
    v_sent := v_sent + 1;
  end if;
  if coalesce(s.dunning_whatsapp, false) and coalesce(bp.phone, '') <> '' then
    perform app.enqueue_message(p_company, 'whatsapp', bp.phone, null, v_body, null, 'dunning',
      jsonb_build_object('name', 'drispro_kujtese', 'language', 'sq', 'params', jsonb_build_array(bp.name, c.name, replace(v_list, E'\n', '; '), app.money_text(v_total, v_cur))),
      v_key || ':wa', 'business_partners', p_partner);
    v_sent := v_sent + 1;
  end if;
  return v_sent;
end $$;

-- the morning round
create or replace function app.run_dunning(p_company uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare c public.companies; v_today date; r record; n int := 0;
begin
  select * into c from public.companies where id = p_company;
  v_today := (now() at time zone coalesce(c.timezone, 'Europe/Tirane'))::date;
  for r in
    select d.kind, d.partner_id,
           jsonb_agg(jsonb_build_object('id', d.invoice_id, 'number', d.number, 'seq', d.seq, 'due', d.due, 'amount', d.amount, 'currency', d.currency,
                                        'step', d.step, 'late', d.late) order by d.due) as items
      from app.reminder_due(p_company, v_today) d
     group by d.kind, d.partner_id
  loop
    perform app.send_customer_reminder(p_company, r.partner_id, r.kind, r.items);
    insert into app.dunning_log (invoice_id, seq, step, sent_on)
    select (x ->> 'id')::uuid, (x ->> 'seq')::int, (x ->> 'step')::int, v_today from jsonb_array_elements(r.items) x on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

-- who the next round would remind
drop function if exists public.dunning_preview(uuid);
create or replace function public.dunning_preview(p_company uuid)
returns table (partner_id uuid, partner_name text, email text, phone text, step integer, total numeric, invoices integer, kind text)
language plpgsql stable security definer set search_path = '' as $$
declare v_today date;
begin
  perform app.require_permission(p_company, 'invoicing.read');
  v_today := (now() at time zone coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane'))::date;
  return query
  select d.partner_id, bp.name, bp.email, bp.phone, max(d.step), sum(d.amount), count(*)::int, d.kind
    from app.reminder_due(p_company, v_today) d join public.business_partners bp on bp.id = d.partner_id
   group by d.partner_id, bp.name, bp.email, bp.phone, d.kind
   order by d.kind, 6 desc;
end $$;

-- by hand: everything the customer owes that is past its due date (or, if nothing is late, what falls due next)
create or replace function public.send_reminder_now(p_partner uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare bp public.business_partners; v_items jsonb; v_kind text := 'overdue'; v_today date; v_sent int;
begin
  select * into bp from public.business_partners where id = p_partner and deleted_at is null;
  if bp.id is null then raise exception 'Customer not found' using errcode = 'P0002'; end if;
  perform app.require_permission(bp.company_id, 'invoicing.write');
  if coalesce(bp.email, '') = '' and coalesce(bp.phone, '') = '' then
    raise exception 'The customer has no email or phone; add one on their card' using errcode = '23514';
  end if;
  v_today := (now() at time zone coalesce((select timezone from public.companies where id = bp.company_id), 'Europe/Tirane'))::date;
  select jsonb_agg(jsonb_build_object('id', i.id, 'number', i.number, 'seq', coalesce(pt.seq, 0), 'due', pt.due, 'amount', pt.open, 'currency', i.currency_code,
                                      'late', v_today - pt.due) order by pt.due)
    into v_items
    from public.sales_invoices i cross join lateral app.doc_parts(i.id, null, i.total, i.amount_due, i.due_date) pt
   where i.partner_id = bp.id and i.status = 'posted' and i.deleted_at is null and i.document_type = 'sales_invoice' and i.amount_due > 0
     and pt.open > 0 and pt.due < v_today;
  if v_items is null then
    v_kind := 'upcoming';
    select jsonb_agg(jsonb_build_object('id', i.id, 'number', i.number, 'seq', coalesce(pt.seq, 0), 'due', pt.due, 'amount', pt.open, 'currency', i.currency_code,
                                        'late', v_today - pt.due) order by pt.due)
      into v_items
      from public.sales_invoices i cross join lateral app.doc_parts(i.id, null, i.total, i.amount_due, i.due_date) pt
     where i.partner_id = bp.id and i.status = 'posted' and i.deleted_at is null and i.document_type = 'sales_invoice' and i.amount_due > 0 and pt.open > 0;
  end if;
  if v_items is null then raise exception 'The customer owes nothing' using errcode = '23514'; end if;
  v_sent := app.send_customer_reminder(bp.company_id, bp.id, v_kind, v_items, true);
  return jsonb_build_object('kind', v_kind, 'messages', v_sent, 'items', jsonb_array_length(v_items));
end $$;

-- every reminder a customer got
create or replace function public.reminder_history(p_partner uuid)
returns table (id uuid, at timestamptz, channel text, to_address text, subject text, status text, sent_at timestamptz, last_error text)
language plpgsql stable security definer set search_path = '' as $$
declare v_company uuid;
begin
  select bp.company_id into v_company from public.business_partners bp where bp.id = p_partner;
  if v_company is null then return; end if;
  perform app.require_permission(v_company, 'invoicing.read');
  return query
  select o.id, o.created_at, o.channel, o.to_address, o.subject, o.status, o.sent_at, o.last_error
    from app.message_outbox o
   where o.company_id = v_company and o.entity_type = 'business_partners' and o.entity_id = p_partner and o.purpose = 'dunning'
   order by o.created_at desc limit 50;
end $$;

-- the settings page saves the new fields too
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
  perform app._patch_function('public.messaging_settings',
    $p$'dunning_subject', s.dunning_subject, 'dunning_text', s.dunning_text,$p$,
    $p$'dunning_subject', s.dunning_subject, 'dunning_text', s.dunning_text,
    'reminder_before_enabled', s.reminder_before_enabled, 'reminder_before_days', s.reminder_before_days, 'reminder_before_text', s.reminder_before_text,$p$);
  perform app._patch_function('public.messaging_settings_save',
    $p$    dunning_text = case when p ? 'dunning_text' then nullif(btrim(p ->> 'dunning_text'), '') else dunning_text end,$p$,
    $p$    dunning_text = case when p ? 'dunning_text' then nullif(btrim(p ->> 'dunning_text'), '') else dunning_text end,
    reminder_before_enabled = coalesce((p ->> 'reminder_before_enabled')::boolean, reminder_before_enabled),
    reminder_before_days = coalesce(least(greatest((p ->> 'reminder_before_days')::int, 1), 30), reminder_before_days),
    reminder_before_text = case when p ? 'reminder_before_text' then nullif(btrim(p ->> 'reminder_before_text'), '') else reminder_before_text end,$p$);
end $$;
drop function app._patch_function(text, text, text);

revoke execute on function app.reminder_due(uuid, date), app.send_customer_reminder(uuid, uuid, text, jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.dunning_preview(uuid), public.send_reminder_now(uuid), public.reminder_history(uuid) from public, anon;
grant execute on function public.dunning_preview(uuid), public.send_reminder_now(uuid), public.reminder_history(uuid) to authenticated;
