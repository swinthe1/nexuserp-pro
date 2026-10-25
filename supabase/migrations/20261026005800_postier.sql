-- =============================================================================
-- DrisPRO · the postier: messages the program sends by itself
--   Email goes out from each company's own mailbox (its SMTP settings, kept where no screen
--   can read them back). WhatsApp goes out from the DrisPRO business number in the cloud:
--   a local server hands its WhatsApp messages to the cloud with its licence.
--   Everything waits in one outbox; a small worker (deploy/worker/postier.mjs) sends it, retries
--   what failed, and calls the tick every few minutes so the timed work runs even where the
--   database has no scheduler:
--     * the morning summary for the owner (email and WhatsApp), at the hour the company picks
--     * reminders for overdue invoices, in steps (e.g. 3, 15 and 30 days after the due date)
--     * a purchase order to the vendor by email once it is approved or sent
--   plus the work of the earlier automations (recurring invoices, payroll, open tills).
-- =============================================================================

-- ---------------------------------------------------------------- the company's mailbox
create table app.mail_accounts (
  company_id  uuid primary key references public.companies(id) on delete cascade,
  host        text not null,
  port        int not null default 587 check (port between 1 and 65535),
  security    text not null default 'starttls' check (security in ('tls', 'starttls', 'none')),
  username    text,
  password    text,
  from_name   text,
  from_email  text not null,
  reply_to    text,
  is_active   boolean not null default true,
  verified_at timestamptz,
  last_error  text,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
revoke all on app.mail_accounts from public, anon, authenticated;

create or replace function public.mail_account_get(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a app.mail_accounts;
begin
  perform app.require_permission(p_company, 'admin.read');
  select * into a from app.mail_accounts where company_id = p_company;
  if a.company_id is null then return null; end if;
  return jsonb_build_object('host', a.host, 'port', a.port, 'security', a.security, 'username', a.username, 'has_password', a.password is not null,
                            'from_name', a.from_name, 'from_email', a.from_email, 'reply_to', a.reply_to, 'is_active', a.is_active,
                            'verified_at', a.verified_at, 'last_error', a.last_error);
end $$;
grant execute on function public.mail_account_get(uuid) to authenticated;

-- an empty password keeps the one saved; {"remove": true} forgets the mailbox
create or replace function public.mail_account_save(p_company uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'admin.write');
  if coalesce((p ->> 'remove')::boolean, false) then delete from app.mail_accounts where company_id = p_company; return; end if;
  if coalesce(btrim(p ->> 'host'), '') = '' or coalesce(btrim(p ->> 'from_email'), '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Give the mail server and a valid sender address' using errcode = '22023';
  end if;
  insert into app.mail_accounts (company_id, host, port, security, username, password, from_name, from_email, reply_to, is_active, updated_by)
  values (p_company, btrim(p ->> 'host'), coalesce((p ->> 'port')::int, 587), coalesce(p ->> 'security', 'starttls'), nullif(btrim(p ->> 'username'), ''),
          nullif(p ->> 'password', ''), nullif(btrim(p ->> 'from_name'), ''), lower(btrim(p ->> 'from_email')), nullif(btrim(p ->> 'reply_to'), ''),
          coalesce((p ->> 'is_active')::boolean, true), auth.uid())
  on conflict (company_id) do update set host = excluded.host, port = excluded.port, security = excluded.security, username = excluded.username,
         password = coalesce(excluded.password, app.mail_accounts.password), from_name = excluded.from_name, from_email = excluded.from_email,
         reply_to = excluded.reply_to, is_active = excluded.is_active, verified_at = null, last_error = null, updated_at = now(), updated_by = auth.uid();
end $$;
grant execute on function public.mail_account_save(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- the outbox
create table app.message_outbox (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  channel       text not null check (channel in ('email', 'whatsapp')),
  to_address    text not null,
  subject       text,
  body_text     text,
  body_html     text,
  template      jsonb,
  purpose       text not null default 'other',
  entity_type   text,
  entity_id     uuid,
  dedupe_key    text,
  status        text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'relayed')),
  attempts      int not null default 0,
  next_try_at   timestamptz not null default now(),
  last_error    text,
  provider_id   text,
  sent_at       timestamptz,
  relay_licence text,
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid()
);
revoke all on app.message_outbox from public, anon, authenticated;
create unique index message_outbox_dedupe_idx on app.message_outbox (company_id, dedupe_key) where dedupe_key is not null;
create index message_outbox_due_idx on app.message_outbox (next_try_at) where status in ('queued', 'failed');
create index message_outbox_company_idx on app.message_outbox (company_id, created_at desc);

-- a phone number as WhatsApp wants it: digits with the country code (Kosovo 383 by default)
create or replace function app.phone_e164(p text, p_country text default 'XK')
returns text language sql immutable set search_path = '' as $$
  with d as (select regexp_replace(coalesce(p, ''), '[^0-9+]', '', 'g') as v)
  select case
    when v = '' then null
    when v like '+%' then substr(v, 2)
    when v like '00%' then substr(v, 3)
    when v like '0%' then case p_country when 'AL' then '355' else '383' end || substr(v, 2)
    when length(v) <= 9 then case p_country when 'AL' then '355' else '383' end || v
    else v end
  from d
$$;

-- put a message in the outbox (null when the same dedupe key is already there)
create or replace function app.enqueue_message(p_company uuid, p_channel text, p_to text, p_subject text, p_text text, p_html text,
  p_purpose text, p_template jsonb default null, p_dedupe text default null, p_entity_type text default null, p_entity_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_to text;
begin
  v_to := case when p_channel = 'whatsapp' then app.phone_e164(p_to, (select country_code from public.companies where id = p_company)) else lower(btrim(p_to)) end;
  if coalesce(v_to, '') = '' then return null; end if;
  insert into app.message_outbox (company_id, channel, to_address, subject, body_text, body_html, template, purpose, dedupe_key, entity_type, entity_id)
  values (p_company, p_channel, v_to, p_subject, p_text, p_html, p_template, p_purpose, p_dedupe, p_entity_type, p_entity_id)
  on conflict (company_id, dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function app.enqueue_message(uuid, text, text, text, text, text, text, jsonb, text, text, uuid) from public, anon, authenticated;

create or replace function public.mail_account_test(p_company uuid, p_to text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  perform app.require_permission(p_company, 'admin.write');
  if not exists (select 1 from app.mail_accounts where company_id = p_company) then raise exception 'Save the mailbox first' using errcode = '55000'; end if;
  select name into v_name from public.companies where id = p_company;
  return app.enqueue_message(p_company, 'email', p_to, 'DrisPRO: provë e email-it', 'Ky email erdhi nga DrisPRO për ' || v_name || '. Dërgimi punon.',
    '<p>Ky email erdhi nga <b>DrisPRO</b> për ' || app.html(v_name) || '.</p><p>Dërgimi punon.</p>', 'test');
end $$;
grant execute on function public.mail_account_test(uuid, text) to authenticated;

-- what went out (and what did not), for the people who set it up
create or replace function public.messages_list(p_company uuid, p_limit int default 200)
returns table (id uuid, channel text, to_address text, subject text, purpose text, status text, attempts int, last_error text, sent_at timestamptz, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'admin.read');
  return query select m.id, m.channel, m.to_address, coalesce(m.subject, m.template ->> 'name'), m.purpose, m.status, m.attempts, m.last_error, m.sent_at, m.created_at
    from app.message_outbox m where m.company_id = p_company order by m.created_at desc limit least(coalesce(p_limit, 200), 500);
end $$;
grant execute on function public.messages_list(uuid, int) to authenticated;

create or replace function public.message_retry(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare m app.message_outbox;
begin
  select * into m from app.message_outbox where id = p_id;
  if m.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform app.require_permission(m.company_id, 'admin.write');
  update app.message_outbox set status = 'queued', attempts = 0, next_try_at = now(), last_error = null where id = p_id and status = 'failed';
end $$;
grant execute on function public.message_retry(uuid) to authenticated;

-- small HTML helpers
create or replace function app.html(p text)
returns text language sql immutable set search_path = '' as $$
  select replace(replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
$$;
create or replace function app.money_text(p numeric, p_cur text default null)
returns text language sql immutable set search_path = '' as $$
  select replace(replace(to_char(round(coalesce(p, 0), 2), 'FM999,999,999,990.00'), ',', ' '), '.', ',') || coalesce(' ' || p_cur, '')
$$;
create or replace function app.mail_page(p_company text, p_title text, p_body text)
returns text language sql immutable set search_path = '' as $$
  select '<!doctype html><html><body style="margin:0;background:#f4f6fa;font:15px/1.5 Segoe UI,Arial,sans-serif;color:#172033">'
      || '<div style="max-width:620px;margin:0 auto;padding:24px 16px"><div style="background:#fff;border:1px solid #dfe4ee;border-radius:12px;padding:24px">'
      || '<div style="font-size:13px;color:#5a6478">' || app.html(p_company) || '</div>'
      || '<h1 style="margin:4px 0 16px;font-size:20px">' || app.html(p_title) || '</h1>' || p_body
      || '</div><div style="font-size:12px;color:#8a93a6;text-align:center;margin-top:12px">DrisPRO</div></div></body></html>'
$$;

-- ---------------------------------------------------------------- what the company turns on
alter table public.company_settings
  add column summary_hour smallint check (summary_hour between 0 and 23),
  add column summary_emails text[] not null default '{}',
  add column summary_whatsapp text[] not null default '{}',
  add column dunning_enabled boolean not null default false,
  add column dunning_email boolean not null default true,
  add column dunning_whatsapp boolean not null default false,
  add column dunning_steps int[] not null default '{3,15,30}',
  add column dunning_subject text,
  add column dunning_text text,
  add column po_email_auto boolean not null default false,
  add column po_email_text text;

create table app.dunning_log (
  invoice_id uuid not null references public.sales_invoices(id) on delete cascade,
  step       int not null,
  sent_on    date not null default current_date,
  primary key (invoice_id, step)
);
revoke all on app.dunning_log from public, anon, authenticated;

create table app.automation_runs (
  job        text not null,
  company_id uuid not null,
  run_on     date not null,
  ran_at     timestamptz not null default now(),
  primary key (job, company_id, run_on)
);
revoke all on app.automation_runs from public, anon, authenticated;

-- once a day per company (true the first time it is asked that day)
create or replace function app.once_today(p_job text, p_company uuid, p_day date)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  insert into app.automation_runs (job, company_id, run_on) values (p_job, p_company, p_day);
  return true;
exception when unique_violation then return false;
end $$;

-- ---------------------------------------------------------------- the morning summary
create or replace function public.daily_summary(p_company uuid, p_day date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.companies; v_day date; v_from timestamptz; v_to timestamptz; v jsonb;
begin
  if auth.uid() is not null then perform app.require_permission(p_company, 'reports.read'); end if;
  select * into c from public.companies where id = p_company;
  v_day := coalesce(p_day, (now() at time zone coalesce(c.timezone, 'Europe/Tirane'))::date - 1);
  v_from := (v_day::timestamp) at time zone coalesce(c.timezone, 'Europe/Tirane');
  v_to := ((v_day + 1)::timestamp) at time zone coalesce(c.timezone, 'Europe/Tirane');
  select jsonb_build_object(
    'company', c.name, 'currency', c.base_currency, 'day', v_day,
    'pos_sales', coalesce((select sum(case when o.is_refund then -abs(o.total) else o.total end) from public.pos_orders o
                            where o.company_id = p_company and o.status = 'paid' and o.order_at >= v_from and o.order_at < v_to), 0),
    'pos_count', (select count(*) from public.pos_orders o where o.company_id = p_company and o.status = 'paid' and not o.is_refund and o.order_at >= v_from and o.order_at < v_to),
    'invoiced', coalesce((select sum(case when i.document_type = 'credit_note' then -i.total_base else i.total_base end) from public.sales_invoices i
                           where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and i.invoice_date = v_day), 0),
    'old_program_sales', coalesce((select sum(case when h.kind = 'sale_return' then -abs(h.total) else h.total end) from public.history_documents h
                                    where h.company_id = p_company and h.kind in ('sale', 'pos_sale', 'sale_return') and h.doc_date = v_day), 0),
    'cash', coalesce((select sum(p.amount) from public.pos_payments p join public.pos_orders o on o.id = p.pos_order_id
                       where o.company_id = p_company and p.method = 'cash' and p.paid_at >= v_from and p.paid_at < v_to), 0)
            - coalesce((select sum(o.change_given) from public.pos_orders o where o.company_id = p_company and o.status = 'paid' and o.order_at >= v_from and o.order_at < v_to), 0),
    'cash_differences', coalesce((select sum(s.cash_difference) from public.pos_sessions s where s.company_id = p_company and s.closed_at >= v_from and s.closed_at < v_to), 0),
    'open_tills', (select count(*) from public.pos_sessions s where s.company_id = p_company and s.status = 'open' and s.deleted_at is null),
    'low_stock', (select count(*) from public.v_low_stock l where l.company_id = p_company and l.alert_status = 'open'),
    'overdue_total', coalesce((select sum(i.amount_due * i.exchange_rate) from public.sales_invoices i where i.company_id = p_company and i.status = 'posted'
                                and i.deleted_at is null and i.payment_status <> 'paid' and i.document_type = 'sales_invoice' and i.due_date < v_day + 1), 0),
    'overdue_count', (select count(distinct i.partner_id) from public.sales_invoices i where i.company_id = p_company and i.status = 'posted'
                       and i.deleted_at is null and i.payment_status <> 'paid' and i.document_type = 'sales_invoice' and i.due_date < v_day + 1),
    'bills_due', coalesce((select sum(b.amount_due) from public.vendor_bills b where b.company_id = p_company and b.status = 'posted' and b.deleted_at is null
                            and b.payment_status <> 'paid' and b.due_date <= v_day + 7), 0),
    'approvals', (select count(*) from public.approval_requests a where a.company_id = p_company and a.status = 'pending'),
    'prices', (select count(*) from public.price_suggestions s where s.company_id = p_company and s.status = 'pending'))
  into v;
  return v;
end $$;
grant execute on function public.daily_summary(uuid, date) to authenticated;

create or replace function app.summary_message(p jsonb, out subject text, out body_text text, out body_html text, out params jsonb)
language plpgsql stable set search_path = '' as $$
declare cur text := p ->> 'currency'; sales numeric; v_rows text := ''; v_lines text := '';
begin
  sales := (p ->> 'pos_sales')::numeric + (p ->> 'invoiced')::numeric + (p ->> 'old_program_sales')::numeric;
  subject := 'DrisPRO · ' || (p ->> 'company') || ' · ' || to_char((p ->> 'day')::date, 'DD.MM.YYYY');
  -- one row per figure: label, value, and whether it needs a look
  with f(label, value, warn) as (values
    ('Shitjet', app.money_text(sales, cur), false),
    ('Kupona në arkë', (p ->> 'pos_count'), false),
    ('Para në dorë', app.money_text((p ->> 'cash')::numeric, cur), false),
    ('Diferenca në arka', app.money_text((p ->> 'cash_differences')::numeric, cur), abs((p ->> 'cash_differences')::numeric) > 0),
    ('Arka ende të hapura', (p ->> 'open_tills'), (p ->> 'open_tills')::int > 0),
    ('Artikuj me stok të ulët', (p ->> 'low_stock'), (p ->> 'low_stock')::int > 0),
    ('Borxhe me vonesë', app.money_text((p ->> 'overdue_total')::numeric, cur) || ' · ' || (p ->> 'overdue_count') || ' klientë', (p ->> 'overdue_total')::numeric > 0),
    ('Fatura furnitorësh në 7 ditë', app.money_text((p ->> 'bills_due')::numeric, cur), false),
    ('Presin miratim', (p ->> 'approvals'), (p ->> 'approvals')::int > 0),
    ('Çmime të reja për t''u parë', (p ->> 'prices'), (p ->> 'prices')::int > 0))
  select string_agg('<tr><td style="padding:8px 0;border-bottom:1px solid #eef1f6;color:#5a6478">' || label || '</td><td style="padding:8px 0;border-bottom:1px solid #eef1f6;text-align:right;font-weight:600;'
                    || case when warn then 'color:#b42318' else '' end || '">' || app.html(value) || '</td></tr>', ''),
         string_agg(label || ': ' || value, E'\n')
    into v_rows, v_lines from f;
  body_html := app.mail_page(p ->> 'company', 'Dita e ' || to_char((p ->> 'day')::date, 'DD.MM.YYYY'),
                 '<table style="width:100%;border-collapse:collapse">' || v_rows || '</table>');
  body_text := subject || E'\n\n' || v_lines;
  -- the WhatsApp template "drispro_permbledhja": {{1}} company, {{2}} day, {{3}} sales, {{4}} cash, {{5}} low stock, {{6}} overdue, {{7}} waiting approval
  params := jsonb_build_array(p ->> 'company', to_char((p ->> 'day')::date, 'DD.MM.YYYY'), app.money_text(sales, cur), app.money_text((p ->> 'cash')::numeric, cur),
                              p ->> 'low_stock', app.money_text((p ->> 'overdue_total')::numeric, cur), ((p ->> 'approvals')::int + (p ->> 'prices')::int)::text);
end $$;

create or replace function public.summary_send_now(p_company uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare s public.company_settings; v jsonb; m record; n int := 0; a text;
begin
  if auth.uid() is not null then perform app.require_permission(p_company, 'admin.write'); end if;
  select * into s from public.company_settings where company_id = p_company;
  v := public.daily_summary(p_company);
  select * into m from app.summary_message(v);
  foreach a in array coalesce(s.summary_emails, '{}') loop
    if app.enqueue_message(p_company, 'email', a, m.subject, m.body_text, m.body_html, 'summary') is not null then n := n + 1; end if;
  end loop;
  foreach a in array coalesce(s.summary_whatsapp, '{}') loop
    if app.enqueue_message(p_company, 'whatsapp', a, null, m.body_text, null, 'summary',
         jsonb_build_object('name', 'drispro_permbledhja', 'language', 'sq', 'params', m.params)) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;
grant execute on function public.summary_send_now(uuid) to authenticated;

-- ---------------------------------------------------------------- reminders for overdue invoices
create or replace function app.dunning_text(p_tpl text, p_default text, p_vars jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare v text := coalesce(nullif(btrim(p_tpl), ''), p_default); k text;
begin
  for k in select jsonb_object_keys(p_vars) loop v := replace(v, '{' || k || '}', coalesce(p_vars ->> k, '')); end loop;
  return v;
end $$;

create or replace function app.run_dunning(p_company uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare s public.company_settings; c public.companies; v_today date; r record; v_step int; v_steps int[]; n int := 0; v_vars jsonb; v_list text; v_html text;
  v_subject text; v_body text;
begin
  select * into s from public.company_settings where company_id = p_company;
  if not coalesce(s.dunning_enabled, false) then return 0; end if;
  select * into c from public.companies where id = p_company;
  v_today := (now() at time zone coalesce(c.timezone, 'Europe/Tirane'))::date;
  select array_agg(x order by x) into v_steps from unnest(s.dunning_steps) x where x >= 0;
  -- per customer: the invoices that reached a step they have not had yet (the highest such step)
  for r in
    with due as (
      select i.id, i.partner_id, i.number, i.due_date, i.amount_due, i.currency_code, v_today - i.due_date as late,
             (select max(st) from unnest(v_steps) st where st <= v_today - i.due_date) as step
        from public.sales_invoices i
       where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and i.document_type = 'sales_invoice'
         and i.payment_status <> 'paid' and i.amount_due > 0 and i.due_date < v_today
    )
    select d.partner_id, bp.name, bp.email, bp.phone, max(d.step) as step, sum(d.amount_due) as total, min(d.currency_code) as cur, max(d.late) as late,
           jsonb_agg(jsonb_build_object('id', d.id, 'number', d.number, 'due', d.due_date, 'amount', d.amount_due, 'step', d.step) order by d.due_date) as invs
      from due d join public.business_partners bp on bp.id = d.partner_id
     where d.step is not null and not exists (select 1 from app.dunning_log l where l.invoice_id = d.id and l.step = d.step)
     group by d.partner_id, bp.name, bp.email, bp.phone
  loop
    select string_agg((x ->> 'number') || ' · ' || to_char((x ->> 'due')::date, 'DD.MM.YYYY') || ' · ' || app.money_text((x ->> 'amount')::numeric, r.cur), E'\n'),
           string_agg('<tr><td style="padding:6px 0;border-bottom:1px solid #eef1f6">' || app.html(x ->> 'number') || '</td><td style="padding:6px 0;border-bottom:1px solid #eef1f6">'
                      || to_char((x ->> 'due')::date, 'DD.MM.YYYY') || '</td><td style="padding:6px 0;border-bottom:1px solid #eef1f6;text-align:right">'
                      || app.money_text((x ->> 'amount')::numeric, r.cur) || '</td></tr>', '')
      into v_list, v_html from jsonb_array_elements(r.invs) x;
    v_vars := jsonb_build_object('customer', r.name, 'company', c.name, 'total', app.money_text(r.total, r.cur), 'days', r.late, 'invoices', v_list,
                                 'phone', coalesce(c.phone, ''), 'email', coalesce(c.email, ''));
    v_subject := app.dunning_text(s.dunning_subject, 'Kujtesë pagese nga {company}', v_vars);
    v_body := app.dunning_text(s.dunning_text, E'Përshëndetje {customer},\n\nJu kujtojmë se këto fatura janë ende të papaguara:\n{invoices}\n\nGjithsej: {total}\n\nNëse e keni paguar tashmë, ju lutemi mos e merrni parasysh këtë mesazh.\nFaleminderit,\n{company} {phone}', v_vars);
    if coalesce(s.dunning_email, true) and coalesce(r.email, '') <> '' then
      perform app.enqueue_message(p_company, 'email', r.email, v_subject, v_body,
        app.mail_page(c.name, v_subject, '<p style="white-space:pre-line">' || app.html(split_part(v_body, v_list, 1)) || '</p>'
          || '<table style="width:100%;border-collapse:collapse;margin:8px 0 16px">' || v_html || '</table>'
          || '<p style="white-space:pre-line">' || app.html(split_part(v_body, v_list, 2)) || '</p>'),
        'dunning', null, 'dunning:' || r.partner_id || ':' || r.step || ':' || v_today, 'business_partners', r.partner_id);
    end if;
    if coalesce(s.dunning_whatsapp, false) and coalesce(r.phone, '') <> '' then
      -- the WhatsApp template "drispro_kujtese": {{1}} customer, {{2}} company, {{3}} invoices, {{4}} total
      perform app.enqueue_message(p_company, 'whatsapp', r.phone, null, v_body, null, 'dunning',
        jsonb_build_object('name', 'drispro_kujtese', 'language', 'sq', 'params', jsonb_build_array(r.name, c.name, replace(v_list, E'\n', '; '), app.money_text(r.total, r.cur))),
        'dunning-wa:' || r.partner_id || ':' || r.step || ':' || v_today, 'business_partners', r.partner_id);
    end if;
    insert into app.dunning_log (invoice_id, step)
    select (x ->> 'id')::uuid, (x ->> 'step')::int from jsonb_array_elements(r.invs) x on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function app.run_dunning(uuid) from public, anon, authenticated;

-- which customers would get a reminder today (nothing is sent)
create or replace function public.dunning_preview(p_company uuid)
returns table (partner_id uuid, partner_name text, email text, phone text, step int, total numeric, invoices int)
language plpgsql stable security definer set search_path = '' as $$
declare s public.company_settings; v_today date;
begin
  perform app.require_permission(p_company, 'invoicing.read');
  select * into s from public.company_settings where company_id = p_company;
  v_today := (now() at time zone coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane'))::date;
  return query
    with due as (
      select i.id, i.partner_id, i.amount_due, (select max(st) from unnest(s.dunning_steps) st where st <= v_today - i.due_date) as st
        from public.sales_invoices i
       where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and i.document_type = 'sales_invoice'
         and i.payment_status <> 'paid' and i.amount_due > 0 and i.due_date < v_today)
    select d.partner_id, bp.name, bp.email, bp.phone, max(d.st), sum(d.amount_due), count(*)::int
      from due d join public.business_partners bp on bp.id = d.partner_id
     where d.st is not null and not exists (select 1 from app.dunning_log l where l.invoice_id = d.id and l.step = d.st)
     group by d.partner_id, bp.name, bp.email, bp.phone order by 6 desc;
end $$;
grant execute on function public.dunning_preview(uuid) to authenticated;

-- ---------------------------------------------------------------- purchase orders to the vendor
create or replace function app.po_email(p_po uuid, p_to text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare po public.purchase_orders; c public.companies; v public.business_partners; s public.company_settings; v_rows text; v_list text; v_to text; v_intro text;
begin
  select * into po from public.purchase_orders where id = p_po;
  select * into c from public.companies where id = po.company_id;
  select * into v from public.business_partners where id = po.vendor_id;
  select * into s from public.company_settings where company_id = po.company_id;
  v_to := coalesce(nullif(btrim(p_to), ''), v.email);
  if coalesce(v_to, '') = '' then return null; end if;
  select string_agg('<tr><td style="padding:6px 0;border-bottom:1px solid #eef1f6">' || app.html(coalesce(vp.vendor_sku || ' · ', '') || l.description) || '</td>'
                    || '<td style="padding:6px 8px;border-bottom:1px solid #eef1f6;text-align:right;white-space:nowrap">' || trim_scale(l.quantity) || '</td>'
                    || '<td style="padding:6px 0;border-bottom:1px solid #eef1f6;text-align:right;white-space:nowrap">' || app.money_text(l.unit_price) || '</td></tr>', '' order by l.line_no),
         string_agg(trim_scale(l.quantity) || ' × ' || coalesce(vp.vendor_sku || ' ', '') || l.description, E'\n' order by l.line_no)
    into v_rows, v_list
    from public.purchase_order_lines l
    left join lateral (select x.vendor_sku from public.vendor_products x where x.variant_id = l.variant_id and x.vendor_id = po.vendor_id and x.vendor_sku is not null limit 1) vp on true
   where l.purchase_order_id = po.id;
  v_intro := app.dunning_text(s.po_email_text, E'Përshëndetje,\n\nJu lutemi na dërgoni mallin e mëposhtëm sipas porosisë {number}{date}.', jsonb_build_object(
               'number', po.number, 'vendor', v.name, 'company', c.name,
               'date', case when po.expected_date is not null then ', deri më ' || to_char(po.expected_date, 'DD.MM.YYYY') else '' end));
  return app.enqueue_message(po.company_id, 'email', v_to, 'Porosi ' || po.number || ' · ' || c.name, v_intro || E'\n\n' || v_list || E'\n\nGjithsej: ' || app.money_text(po.total, po.currency_code) || E'\n\n' || c.name,
    app.mail_page(c.name, 'Porosi ' || po.number,
      '<p style="white-space:pre-line">' || app.html(v_intro) || '</p>'
      || '<table style="width:100%;border-collapse:collapse;margin:8px 0"><tr><th style="text-align:left;font-size:12px;color:#5a6478">Artikulli</th><th style="text-align:right;font-size:12px;color:#5a6478">Sasia</th><th style="text-align:right;font-size:12px;color:#5a6478">Çmimi</th></tr>'
      || coalesce(v_rows, '') || '</table><p style="text-align:right;font-weight:600">Gjithsej: ' || app.money_text(po.total, po.currency_code) || '</p>'
      || '<p>Faleminderit,<br>' || app.html(c.name) || coalesce('<br>' || app.html(c.phone), '') || '</p>'),
    'purchase_order', null, case when p_to is null then 'po:' || po.id end, 'purchase_orders', po.id);
end $$;
revoke execute on function app.po_email(uuid, text) from public, anon, authenticated;

create or replace function public.email_purchase_order(p_po uuid, p_to text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare po public.purchase_orders; v_id uuid;
begin
  select * into po from public.purchase_orders where id = p_po and deleted_at is null;
  if po.id is null then raise exception 'Purchase order not found' using errcode = 'P0002'; end if;
  perform app.require_permission(po.company_id, 'procurement.write');
  if not exists (select 1 from app.mail_accounts where company_id = po.company_id and is_active) then
    raise exception 'Set up the company mailbox in Automations first' using errcode = '55000';
  end if;
  v_id := app.po_email(p_po, coalesce(p_to, ''));
  if v_id is null then raise exception 'The vendor has no email address' using errcode = '22023'; end if;
  return v_id;
end $$;
grant execute on function public.email_purchase_order(uuid, text) to authenticated;

create or replace function app.tg_po_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('approved', 'sent') and old.status in ('draft', 'pending_approval')
     and exists (select 1 from public.company_settings s where s.company_id = new.company_id and s.po_email_auto)
     and exists (select 1 from app.mail_accounts a where a.company_id = new.company_id and a.is_active) then
    perform app.po_email(new.id, null);
  end if;
  return null;
end $$;
create trigger trg_90_po_email after update of status on public.purchase_orders
  for each row execute function app.tg_po_email();

-- ---------------------------------------------------------------- the settings, saved
create or replace function public.messaging_settings_save(p_company uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_steps int[];
begin
  perform app.require_permission(p_company, 'admin.write');
  if p ? 'dunning_steps' then
    select array_agg(distinct x::int order by x::int) into v_steps from jsonb_array_elements_text(p -> 'dunning_steps') x where x ~ '^\d+$' and x::int between 0 and 365;
  end if;
  update public.company_settings set
    summary_hour = case when p ? 'summary_hour' then nullif(p ->> 'summary_hour', '')::smallint else summary_hour end,
    summary_emails = case when p ? 'summary_emails' then coalesce((select array_agg(lower(btrim(x))) from jsonb_array_elements_text(p -> 'summary_emails') x where btrim(x) <> ''), '{}') else summary_emails end,
    summary_whatsapp = case when p ? 'summary_whatsapp' then coalesce((select array_agg(btrim(x)) from jsonb_array_elements_text(p -> 'summary_whatsapp') x where btrim(x) <> ''), '{}') else summary_whatsapp end,
    dunning_enabled = coalesce((p ->> 'dunning_enabled')::boolean, dunning_enabled),
    dunning_email = coalesce((p ->> 'dunning_email')::boolean, dunning_email),
    dunning_whatsapp = coalesce((p ->> 'dunning_whatsapp')::boolean, dunning_whatsapp),
    dunning_steps = coalesce(v_steps, dunning_steps),
    dunning_subject = case when p ? 'dunning_subject' then nullif(btrim(p ->> 'dunning_subject'), '') else dunning_subject end,
    dunning_text = case when p ? 'dunning_text' then nullif(btrim(p ->> 'dunning_text'), '') else dunning_text end,
    po_email_auto = coalesce((p ->> 'po_email_auto')::boolean, po_email_auto),
    po_email_text = case when p ? 'po_email_text' then nullif(btrim(p ->> 'po_email_text'), '') else po_email_text end
  where company_id = p_company;
end $$;
grant execute on function public.messaging_settings_save(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------- the tick (every few minutes, from the worker)
create or replace function public.automation_tick()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c record; v_now timestamp; v_day date; v_hour int; n_sum int := 0; n_dun int := 0; v_any boolean := false;
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  for c in select co.id, coalesce(co.timezone, 'Europe/Tirane') as tz, s.summary_hour, s.dunning_enabled
             from public.companies co join public.company_settings s on s.company_id = co.id where co.deleted_at is null and co.is_active loop
    v_now := now() at time zone c.tz; v_day := v_now::date; v_hour := extract(hour from v_now);
    if c.summary_hour is not null and v_hour >= c.summary_hour and app.once_today('summary', c.id, v_day) then
      n_sum := n_sum + public.summary_send_now(c.id);
    end if;
    if c.dunning_enabled and v_hour >= 9 and app.once_today('dunning', c.id, v_day) then
      n_dun := n_dun + app.run_dunning(c.id);
    end if;
  end loop;
  -- the daily jobs of the other automations, for servers without a scheduler (each one is safe to run twice)
  v_day := (now() at time zone 'Europe/Tirane')::date; v_hour := extract(hour from now() at time zone 'Europe/Tirane');
  if v_hour >= 4 and app.once_today('daily', '00000000-0000-0000-0000-000000000000', v_day) then
    perform public.run_recurring_invoices();
    perform app.remind_open_tills();
    perform public.run_monthly_payroll();
    v_any := true;
  end if;
  return jsonb_build_object('summaries', n_sum, 'reminders', n_dun, 'daily', v_any);
end $$;
revoke execute on function public.automation_tick() from public, anon, authenticated;
grant execute on function public.automation_tick() to service_role;

-- ---------------------------------------------------------------- for the worker only
-- the next messages to send, with the mailbox of their company (WhatsApp: the cloud's own number, or the relay for a local server)
create or replace function public.postier_claim(p_limit int default 20)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  with picked as (
    select m.id from app.message_outbox m
     where m.status in ('queued', 'failed') and m.next_try_at <= now() and m.attempts < 6
     order by m.next_try_at limit least(coalesce(p_limit, 20), 100) for update skip locked
  ), upd as (
    update app.message_outbox m set status = 'sending', attempts = attempts + 1,
           next_try_at = now() + make_interval(mins => (5 * power(3, attempts))::int)
      from picked where m.id = picked.id returning m.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'channel', u.channel, 'to', u.to_address, 'subject', u.subject, 'text', u.body_text, 'html', u.body_html,
           'template', u.template, 'company', u.company_id,
           'mail', case when u.channel = 'email' then (select jsonb_build_object('host', a.host, 'port', a.port, 'security', a.security, 'user', a.username, 'pass', a.password,
                     'from_name', coalesce(a.from_name, co.name), 'from', a.from_email, 'reply_to', a.reply_to)
                     from app.mail_accounts a join public.companies co on co.id = a.company_id where a.company_id = u.company_id and a.is_active) end)), '[]'::jsonb)
    into v from upd u;
  return v;
end $$;
revoke execute on function public.postier_claim(int) from public, anon, authenticated;
grant execute on function public.postier_claim(int) to service_role;

create or replace function public.postier_done(p_id uuid, p_ok boolean, p_error text default null, p_provider_id text default null, p_relayed boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare m app.message_outbox;
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  update app.message_outbox set status = case when p_ok and p_relayed then 'relayed' when p_ok then 'sent' else 'failed' end,
         sent_at = case when p_ok then now() end, last_error = case when p_ok then null else left(p_error, 500) end, provider_id = p_provider_id
   where id = p_id returning * into m;
  if m.purpose = 'test' and m.channel = 'email' then
    update app.mail_accounts set verified_at = case when p_ok then now() else verified_at end, last_error = case when p_ok then null else left(p_error, 500) end
     where company_id = m.company_id;
  end if;
  -- a reminder that could not go out is tried again on another day
  if not p_ok and m.attempts >= 6 and m.purpose = 'dunning' and m.entity_id is not null then
    delete from app.dunning_log l using public.sales_invoices i where i.id = l.invoice_id and i.partner_id = m.entity_id and l.sent_on = m.created_at::date;
  end if;
end $$;
revoke execute on function public.postier_done(uuid, boolean, text, text, boolean) from public, anon, authenticated;
grant execute on function public.postier_done(uuid, boolean, text, text, boolean) to service_role;

-- what the cloud worker needs for WhatsApp (kept in app.server_secrets: whatsapp_token, whatsapp_phone_id)
create or replace function public.postier_config()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  return jsonb_build_object(
    'whatsapp_token', (select value from app.server_secrets where key = 'whatsapp_token'),
    'whatsapp_phone_id', (select value from app.server_secrets where key = 'whatsapp_phone_id'));
end $$;
revoke execute on function public.postier_config() from public, anon, authenticated;
grant execute on function public.postier_config() to service_role;

-- a local server hands its WhatsApp messages to the cloud (with its licence; at most 300 a day)
create or replace function public.licence_whatsapp_relay(p_code text, p_server uuid, p_messages jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.licenses; m jsonb; ok int := 0; v_today int;
begin
  l := app.backup_licence(p_code, p_server);
  select count(*) into v_today from app.message_outbox where relay_licence = l.code and created_at > now() - interval '1 day';
  if v_today + jsonb_array_length(coalesce(p_messages, '[]')) > 300 then raise exception 'Too many WhatsApp messages today for this licence' using errcode = '54000'; end if;
  for m in select * from jsonb_array_elements(coalesce(p_messages, '[]')) loop
    if (m ->> 'to') !~ '^\d{8,15}$' or jsonb_typeof(m -> 'template') <> 'object' then continue; end if;
    insert into app.message_outbox (company_id, channel, to_address, body_text, template, purpose, relay_licence, dedupe_key)
    values (l.company_id, 'whatsapp', m ->> 'to', left(m ->> 'text', 2000), m -> 'template', coalesce(m ->> 'purpose', 'other'), l.code, 'relay:' || (m ->> 'id'))
    on conflict (company_id, dedupe_key) where dedupe_key is not null do nothing;
    ok := ok + 1;
  end loop;
  return jsonb_build_object('accepted', ok);
end $$;
revoke execute on function public.licence_whatsapp_relay(text, uuid, jsonb) from public;
grant execute on function public.licence_whatsapp_relay(text, uuid, jsonb) to anon, authenticated;

-- the settings page reads these
create or replace function public.messaging_settings(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.company_settings;
begin
  perform app.require_permission(p_company, 'admin.read');
  select * into s from public.company_settings where company_id = p_company;
  return jsonb_build_object('summary_hour', s.summary_hour, 'summary_emails', to_jsonb(s.summary_emails), 'summary_whatsapp', to_jsonb(s.summary_whatsapp),
    'dunning_enabled', s.dunning_enabled, 'dunning_email', s.dunning_email, 'dunning_whatsapp', s.dunning_whatsapp, 'dunning_steps', to_jsonb(s.dunning_steps),
    'dunning_subject', s.dunning_subject, 'dunning_text', s.dunning_text, 'po_email_auto', s.po_email_auto, 'po_email_text', s.po_email_text,
    'mailbox', public.mail_account_get(p_company),
    'whatsapp_ready', exists (select 1 from app.server_secrets where key = 'whatsapp_token') or exists (select 1 from public.licenses where company_id = p_company and local_server_id is not null));
end $$;
grant execute on function public.messaging_settings(uuid) to authenticated;
