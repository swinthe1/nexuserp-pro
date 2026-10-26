-- =============================================================================
-- Part 3: open to the world
--   · Public prices: the platform owner sets each plan's price on the Platform page; the public page
--     /cmimet shows them with what each plan includes (a plan without a price says "on offer").
--   · Webhooks: a company tells another program the moment something happens in DrisPRO
--     (an invoice posted, a payment, an order, low stock, a new client, an appointment…).
--     Each message is signed (HMAC-SHA256) so the other side knows it is really from DrisPRO;
--     failures are retried, and an address that keeps failing is switched off and the admins told.
-- =============================================================================

-- ---------------------------------------------------------------------------------------------
-- public prices
-- ---------------------------------------------------------------------------------------------
create table if not exists app.public_pricing (
  plan         text primary key check (plan in ('basic', 'standard', 'pro')),
  price_month  numeric(12,2) check (price_month >= 0),   -- per company, without VAT
  price_year   numeric(12,2) check (price_year >= 0),
  per_user     numeric(12,2) check (per_user >= 0),       -- each user above the included ones
  users        int not null default 1 check (users >= 1),  -- users included
  highlight    boolean not null default false,
  note         text,
  updated_at   timestamptz not null default now()
);
insert into app.public_pricing (plan, users, highlight) values ('basic', 2, false), ('standard', 5, true), ('pro', 10, false) on conflict do nothing;
create table if not exists app.public_contact (
  id         boolean primary key default true check (id),
  email      text,
  phone      text,
  whatsapp   text,
  currency   text not null default 'EUR',
  vat_note   text
);
insert into app.public_contact (id) values (true) on conflict do nothing;
revoke all on app.public_pricing, app.public_contact from public, anon, authenticated;

create or replace function public.public_pricing()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'plans', (select jsonb_agg(jsonb_build_object('plan', p.plan, 'price_month', p.price_month, 'price_year', p.price_year, 'per_user', p.per_user, 'users', p.users,
                'highlight', p.highlight, 'note', p.note, 'features', app.plan_features(p.plan), 'stores', app.plan_max_warehouses(p.plan), 'ai_reads', app.plan_ai_reads(p.plan))
                order by array_position(array['basic', 'standard', 'pro'], p.plan)) from app.public_pricing p),
    'contact', (select jsonb_build_object('email', email, 'phone', phone, 'whatsapp', whatsapp, 'currency', currency, 'vat_note', vat_note) from app.public_contact))
$$;
grant execute on function public.public_pricing() to anon, authenticated;

create or replace function public.platform_pricing_save(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
  perform app.require_super_admin();
  for r in select * from jsonb_array_elements(coalesce(p -> 'plans', '[]')) loop
    update app.public_pricing set price_month = nullif(r ->> 'price_month', '')::numeric, price_year = nullif(r ->> 'price_year', '')::numeric,
           per_user = nullif(r ->> 'per_user', '')::numeric, users = coalesce(nullif(r ->> 'users', '')::int, users), highlight = coalesce((r ->> 'highlight')::boolean, false),
           note = nullif(btrim(r ->> 'note'), ''), updated_at = now()
     where plan = r ->> 'plan';
  end loop;
  if p ? 'contact' then
    update app.public_contact set email = nullif(btrim(p -> 'contact' ->> 'email'), ''), phone = nullif(btrim(p -> 'contact' ->> 'phone'), ''),
           whatsapp = nullif(btrim(p -> 'contact' ->> 'whatsapp'), ''), currency = coalesce(nullif(p -> 'contact' ->> 'currency', ''), 'EUR'),
           vat_note = nullif(btrim(p -> 'contact' ->> 'vat_note'), '');
  end if;
end $$;
revoke execute on function public.platform_pricing_save(jsonb) from public, anon;
grant execute on function public.platform_pricing_save(jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- webhooks
-- ---------------------------------------------------------------------------------------------
create table if not exists app.webhooks (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  url         text not null,
  events      text[] not null,
  secret      text not null,
  description text,
  is_active   boolean not null default true,
  failures    int not null default 0,           -- in a row
  last_status int,
  last_error  text,
  last_at     timestamptz,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
create index if not exists webhooks_company_idx on app.webhooks (company_id) where is_active;
create table if not exists app.webhook_deliveries (
  id          uuid primary key default gen_random_uuid(),
  webhook_id  uuid not null references app.webhooks(id) on delete cascade,
  event       text not null,
  payload     jsonb not null,
  status      text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts    int not null default 0,
  next_try_at timestamptz not null default now(),
  response    int,
  error       text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index if not exists webhook_deliveries_due_idx on app.webhook_deliveries (next_try_at) where status in ('queued', 'failed');
create index if not exists webhook_deliveries_hook_idx on app.webhook_deliveries (webhook_id, created_at desc);
revoke all on app.webhooks, app.webhook_deliveries from public, anon, authenticated;

create or replace function app.webhook_events()
returns text[] language sql immutable set search_path = '' as $$
  select array['invoice.posted', 'credit_note.posted', 'payment.received', 'payment.sent', 'order.created', 'order.confirmed', 'bill.posted',
               'stock.low', 'partner.created', 'appointment.created', 'appointment.cancelled', 'membership.sold', 'webhook.test']
$$;

-- something happened: one message per address that listens for it
create or replace function app.webhook_emit(p_company uuid, p_event text, p_data jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from app.webhooks where company_id = p_company and is_active and p_event = any (events)) then return; end if;
  insert into app.webhook_deliveries (webhook_id, event, payload)
  select w.id, p_event, jsonb_build_object('id', gen_random_uuid(), 'event', p_event, 'created_at', now(), 'company_id', p_company, 'data', p_data)
    from app.webhooks w where w.company_id = p_company and w.is_active and p_event = any (w.events);
end $$;

create or replace function app.webhook_partner(p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', id, 'code', code, 'name', name, 'tax_number', tax_number) from public.business_partners where id = p_id
$$;

create or replace function app.tg_webhook_docs()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_event text; v jsonb;
begin
  if tg_table_name = 'sales_invoices' then
    if new.status = 'posted' and (tg_op = 'INSERT' or old.status is distinct from 'posted') then
      v_event := case when new.document_type = 'credit_note' then 'credit_note.posted' else 'invoice.posted' end;
      v := jsonb_build_object('id', new.id, 'number', new.number, 'date', new.invoice_date, 'due_date', new.due_date, 'partner', app.webhook_partner(new.partner_id),
             'currency', new.currency_code, 'net', new.subtotal, 'vat', new.tax_total, 'total', new.total, 'amount_due', new.amount_due);
    end if;
  elsif tg_table_name = 'vendor_bills' then
    if new.status = 'posted' and (tg_op = 'INSERT' or old.status is distinct from 'posted') then
      v_event := 'bill.posted';
      v := jsonb_build_object('id', new.id, 'number', new.number, 'vendor_invoice_number', new.vendor_invoice_number, 'date', new.bill_date, 'due_date', new.due_date,
             'partner', app.webhook_partner(new.vendor_id), 'currency', new.currency_code, 'total', new.total, 'amount_due', new.amount_due);
    end if;
  elsif tg_table_name = 'payments' then
    if new.status = 'posted' and (tg_op = 'INSERT' or old.status is distinct from 'posted') then
      v_event := case when new.document_type = 'customer_payment' then 'payment.received' else 'payment.sent' end;
      v := jsonb_build_object('id', new.id, 'number', new.number, 'date', new.payment_date, 'method', new.method, 'partner', app.webhook_partner(new.partner_id),
             'currency', new.currency_code, 'amount', new.amount, 'reference', new.reference);
    end if;
  elsif tg_table_name = 'sales_orders' then
    if tg_op = 'INSERT' then v_event := 'order.created';
    elsif new.status = 'confirmed' and old.status is distinct from 'confirmed' then v_event := 'order.confirmed'; end if;
    if v_event is not null then
      v := jsonb_build_object('id', new.id, 'number', new.number, 'status', new.status, 'date', new.order_date, 'partner', app.webhook_partner(new.partner_id),
             'currency', new.currency_code, 'total', new.total);
    end if;
  elsif tg_table_name = 'stock_alerts' then
    if tg_op = 'INSERT' then
      v_event := 'stock.low';
      v := jsonb_build_object('id', new.id, 'sku', (select sku from public.product_variants where id = new.variant_id), 'name', (select name from public.product_variants where id = new.variant_id),
             'warehouse', (select name from public.warehouses where id = new.warehouse_id), 'available', new.available_qty, 'min', new.min_qty);
    end if;
  elsif tg_table_name = 'business_partners' then
    if tg_op = 'INSERT' then
      v_event := 'partner.created';
      v := app.webhook_partner(new.id) || jsonb_build_object('is_customer', new.is_customer, 'is_vendor', new.is_vendor, 'email', new.email, 'phone', new.phone);
    end if;
  elsif tg_table_name = 'appointments' then
    if tg_op = 'INSERT' then v_event := 'appointment.created';
    elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then v_event := 'appointment.cancelled'; end if;
    if v_event is not null then
      v := jsonb_build_object('id', new.id, 'number', new.number, 'status', new.status, 'starts_at', new.starts_at, 'ends_at', new.ends_at,
             'service', (select name from public.appt_services where id = new.service_id), 'with', (select name from public.appt_resources where id = new.resource_id),
             'client', jsonb_build_object('name', new.client_name, 'phone', new.client_phone, 'email', new.client_email), 'price', new.price);
    end if;
  elsif tg_table_name = 'memberships' then
    if tg_op = 'INSERT' then
      v_event := 'membership.sold';
      v := jsonb_build_object('id', new.id, 'number', new.number, 'code', new.code, 'plan', (select name from public.membership_plans where id = new.plan_id),
             'starts_on', new.starts_on, 'ends_on', new.ends_on, 'visits', new.visits, 'price', new.price, 'partner', app.webhook_partner(new.partner_id));
    end if;
  end if;
  if v_event is not null then perform app.webhook_emit(new.company_id, v_event, v); end if;
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['sales_invoices', 'vendor_bills', 'payments', 'sales_orders', 'stock_alerts', 'business_partners', 'appointments', 'memberships'] loop
    execute format('drop trigger if exists trg_95_webhook on public.%I', t);
    execute format('create trigger trg_95_webhook after insert or update on public.%I for each row execute function app.tg_webhook_docs()', t);
  end loop;
end $$;

-- for the company's administrators
create or replace function public.webhook_create(p_company uuid, p_url text, p_events text[], p_description text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_secret text := 'whsec_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  perform app.require_permission(p_company, 'admin.write');
  if p_url !~ '^https?://[^\s/]+' or length(p_url) > 500 then raise exception 'Enter the full address, starting with https://' using errcode = '22023'; end if;
  if coalesce(cardinality(p_events), 0) = 0 or not (p_events <@ app.webhook_events()) then raise exception 'Choose what to send' using errcode = '22023'; end if;
  if (select count(*) from app.webhooks where company_id = p_company) >= 20 then raise exception 'A company can have up to 20 webhooks' using errcode = '54000'; end if;
  insert into app.webhooks (company_id, url, events, secret, description) values (p_company, btrim(p_url), p_events, v_secret, nullif(btrim(p_description), '')) returning id into v_id;
  return jsonb_build_object('id', v_id, 'secret', v_secret);
end $$;

create or replace function public.webhooks_list(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'admin.read');
  return coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'url', w.url, 'events', w.events, 'description', w.description, 'is_active', w.is_active,
      'failures', w.failures, 'last_status', w.last_status, 'last_error', w.last_error, 'last_at', w.last_at, 'created_at', w.created_at,
      'secret_hint', left(w.secret, 10) || '…',
      'recent', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'event', d.event, 'status', d.status, 'attempts', d.attempts, 'response', d.response,
                   'error', d.error, 'created_at', d.created_at) order by d.created_at desc), '[]')
                   from (select * from app.webhook_deliveries where webhook_id = w.id order by created_at desc limit 10) d))
      order by w.created_at) from app.webhooks w where w.company_id = p_company), '[]');
end $$;

create or replace function public.webhook_update(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare w app.webhooks;
begin
  select * into w from app.webhooks where id = p_id;
  if w.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform app.require_permission(w.company_id, 'admin.write');
  if p ? 'delete' and (p ->> 'delete')::boolean then delete from app.webhooks where id = p_id; return; end if;
  if p ? 'events' and not (array(select jsonb_array_elements_text(p -> 'events')) <@ app.webhook_events()) then raise exception 'Choose what to send' using errcode = '22023'; end if;
  update app.webhooks set is_active = coalesce((p ->> 'is_active')::boolean, is_active),
         failures = case when (p ->> 'is_active')::boolean then 0 else failures end,
         events = coalesce(array(select jsonb_array_elements_text(p -> 'events')), events) where id = p_id;
end $$;

create or replace function public.webhook_test(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare w app.webhooks;
begin
  select * into w from app.webhooks where id = p_id;
  if w.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform app.require_permission(w.company_id, 'admin.write');
  insert into app.webhook_deliveries (webhook_id, event, payload)
  values (w.id, 'webhook.test', jsonb_build_object('id', gen_random_uuid(), 'event', 'webhook.test', 'created_at', now(), 'company_id', w.company_id,
          'data', jsonb_build_object('message', 'Hello from DrisPRO', 'company', (select name from public.companies where id = w.company_id))));
end $$;

revoke execute on function public.webhook_create(uuid, text, text[], text), public.webhooks_list(uuid), public.webhook_update(uuid, jsonb), public.webhook_test(uuid) from public, anon;
grant execute on function public.webhook_create(uuid, text, text[], text), public.webhooks_list(uuid), public.webhook_update(uuid, jsonb), public.webhook_test(uuid) to authenticated;

-- the postier sends them
create or replace function public.postier_webhook_claim(p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  delete from app.webhook_deliveries where created_at < now() - interval '30 days';
  with picked as (
    select d.id from app.webhook_deliveries d join app.webhooks w on w.id = d.webhook_id
     where d.status in ('queued', 'failed') and d.next_try_at <= now() and d.attempts < 6 and w.is_active
     order by d.created_at limit least(coalesce(p_limit, 50), 200) for update of d skip locked
  ), upd as (
    update app.webhook_deliveries d set status = 'sending', attempts = attempts + 1,
           next_try_at = now() + (array[interval '1 minute', interval '5 minutes', interval '30 minutes', interval '2 hours', interval '8 hours', interval '1 day'])[least(d.attempts + 1, 6)]
      from picked where d.id = picked.id returning d.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'event', u.event, 'payload', u.payload, 'url', w.url, 'secret', w.secret, 'attempt', u.attempts)), '[]')
    into v from upd u join app.webhooks w on w.id = u.webhook_id;
  return v;
end $$;

create or replace function public.postier_webhook_done(p_id uuid, p_ok boolean, p_status int default null, p_error text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare d app.webhook_deliveries; w app.webhooks;
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  update app.webhook_deliveries set status = case when p_ok then 'sent' else 'failed' end, response = p_status, error = case when p_ok then null else left(p_error, 300) end,
         sent_at = case when p_ok then now() end
   where id = p_id returning * into d;
  update app.webhooks set last_status = p_status, last_error = case when p_ok then null else left(p_error, 300) end, last_at = now(),
         failures = case when p_ok then 0 else failures + 1 end
   where id = d.webhook_id returning * into w;
  -- an address that keeps failing is switched off, and the admins are told
  if not p_ok and w.failures >= 50 and w.is_active then
    update app.webhooks set is_active = false where id = w.id;
    perform app.notify_permission(w.company_id, 'admin.write', 'warning', 'A webhook was switched off after 50 failures: ' || left(w.url, 80), w.last_error, '/settings/integrations');
  end if;
end $$;
revoke execute on function public.postier_webhook_claim(int), public.postier_webhook_done(uuid, boolean, int, text) from public, anon, authenticated;
grant execute on function public.postier_webhook_claim(int), public.postier_webhook_done(uuid, boolean, int, text) to service_role;

-- too many calls answer 429, as the documentation says (PostgREST turns PTxxx into that HTTP code)
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('app.api_open'::regproc);
  if position('''54000''' in v_def) > 0 then execute replace(v_def, 'errcode = ''54000''', 'errcode = ''PT429'''); end if;
end $$;
