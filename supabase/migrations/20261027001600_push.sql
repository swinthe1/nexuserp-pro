-- =============================================================================
-- Notifications on the phone (Web Push)
--   A person switches them on once per device (Notifications › Settings, or the account menu).
--   From then on every notification they get in the app also arrives on that phone or computer,
--   for the categories they keep on. The postier delivers them (deploy/worker/postier.mjs), in the
--   person's language, through the browser's own push service: no app store, no extra cost.
--   New for owners: every morning, yesterday in one line (sales, receipts, cash, overdue, low stock),
--   and cash differences get their own category.
-- =============================================================================

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;   -- already applied
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- the keys this installation signs its pushes with (made once by the postier; the private one never leaves the server side)
create table if not exists app.push_keys (
  id          boolean primary key default true check (id),
  public_key  text not null,
  private_jwk text not null,
  created_at  timestamptz not null default now()
);
revoke all on app.push_keys from public, anon, authenticated;

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  label        text,
  created_at   timestamptz not null default now(),
  last_sent_at timestamptz,
  failures     int not null default 0
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_own on public.push_subscriptions;
create policy push_subscriptions_own on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
grant select on public.push_subscriptions to authenticated;

alter table public.notification_preferences add column if not exists push boolean not null default true;

-- what waits to go out (kept apart from the company's email and WhatsApp: these are personal)
create table if not exists app.push_outbox (
  id              uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  notification_id uuid,
  title           text not null,
  body            text,
  link            text,
  company_name    text,
  locale          text not null default 'sq',
  status          text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts        int not null default 0,
  next_try_at     timestamptz not null default now(),
  last_error      text,
  created_at      timestamptz not null default now()
);
create index if not exists push_outbox_due_idx on app.push_outbox (next_try_at) where status in ('queued', 'failed');
revoke all on app.push_outbox from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- the person's devices
-- ---------------------------------------------------------------------------------------------
create or replace function public.push_public_key()
returns text language sql stable security definer set search_path = '' as $$
  select public_key from app.push_keys
$$;

create or replace function public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_label text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_endpoint !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then raise exception 'This browser gave no usable address for notifications' using errcode = '22023'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, label)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(nullif(btrim(p_label), ''), 80))
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
    label = coalesce(excluded.label, public.push_subscriptions.label), failures = 0
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.push_unsubscribe(p_id uuid default null, p_endpoint text default null)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where user_id = auth.uid() and (id = p_id or endpoint = p_endpoint)
$$;

-- a test, to see it arrive
create or replace function public.push_test(p_company uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  insert into app.push_outbox (subscription_id, title, body, link, company_name, locale)
  select s.id, 'Notifications work on this device', 'From now on DrisPRO tells you here what needs you.', '/notifications',
         (select name from public.companies where id = p_company), coalesce((select locale from public.profiles where id = auth.uid()), 'sq')
    from public.push_subscriptions s where s.user_id = auth.uid();
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.push_subscribe(text, text, text, text), public.push_unsubscribe(uuid, text), public.push_test(uuid), public.push_public_key() from public, anon;
grant execute on function public.push_subscribe(text, text, text, text), public.push_unsubscribe(uuid, text), public.push_test(uuid), public.push_public_key() to authenticated;

-- ---------------------------------------------------------------------------------------------
-- every notification also goes to the person's devices (for the categories they keep on)
-- ---------------------------------------------------------------------------------------------
create or replace function app.tg_notification_push()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.push_subscriptions where user_id = new.user_id) then return null; end if;
  if exists (select 1 from public.notification_preferences np where np.user_id = new.user_id and np.company_id = new.company_id
               and np.category = new.category and not np.push) then return null; end if;
  insert into app.push_outbox (subscription_id, notification_id, title, body, link, company_name, locale)
  select s.id, new.id, new.title, new.body, new.link, (select name from public.companies where id = new.company_id),
         coalesce((select locale from public.profiles where id = new.user_id), 'sq')
    from public.push_subscriptions s where s.user_id = new.user_id;
  return null;
end $$;
drop trigger if exists trg_90_push on public.notifications;
create trigger trg_90_push after insert on public.notifications for each row execute function app.tg_notification_push();

create or replace function app.money_txt(p numeric, p_cur text)
returns text language sql immutable set search_path = '' as $$
  select translate(to_char(round(coalesce(p, 0), 2), 'FM999,999,999,990.00'), ',.', '.,') || ' ' || case p_cur when 'EUR' then '€' when 'ALL' then 'L' else coalesce(p_cur, '') end
$$;

-- cash differences, the safe and the morning summary get categories of their own
do $$ begin
  perform app._patch_function('app.tg_notification_category',
    'if new.category = ''general'' then new.category := app.notification_category(new.type, new.entity_type); end if;',
    'if new.category = ''general'' then new.category := app.notification_category(new.type, new.entity_type); end if;
  if new.category = ''general'' and new.link ~ ''^/(pos/sessions/|safe)'' then new.category := ''cash''; end if;
  if new.entity_type = ''daily_summary'' then new.category := ''summary''; end if;');
  -- amounts in a till difference the way people write them (−1,40 €)
  perform app._patch_function('app.tg_session_closed',
    'to_char(new.cash_difference, ''FMS999G999G990D00'') || '' '' || coalesce(v_cur, '''')',
    'case when new.cash_difference > 0 then ''+'' else '''' end || app.money_txt(new.cash_difference, v_cur)');
end $$;
update public.notifications set category = 'cash' where category = 'general' and link ~ '^/(pos/sessions/|safe)';

-- ---------------------------------------------------------------------------------------------
-- the morning line for the owners: yesterday at a glance
-- ---------------------------------------------------------------------------------------------

create or replace function app.summary_notify(p_company uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v jsonb; v_cur text; v_body text; v_sales numeric; n int;
begin
  v := public.daily_summary(p_company);
  v_cur := v ->> 'currency';
  v_sales := coalesce((v ->> 'pos_sales')::numeric, 0) + coalesce((v ->> 'invoiced')::numeric, 0);
  if v_sales = 0 and coalesce((v ->> 'overdue_total')::numeric, 0) = 0 and coalesce((v ->> 'low_stock')::int, 0) = 0 then return 0; end if;
  v_body := concat_ws(' · ',
    case when coalesce((v ->> 'pos_count')::int, 0) > 0 then format('Receipts: %s', v ->> 'pos_count') end,
    case when coalesce((v ->> 'invoiced')::numeric, 0) <> 0 then format('Invoiced: %s', app.money_txt((v ->> 'invoiced')::numeric, v_cur)) end,
    case when coalesce((v ->> 'cash')::numeric, 0) <> 0 then format('Cash: %s', app.money_txt((v ->> 'cash')::numeric, v_cur)) end,
    case when coalesce((v ->> 'cash_differences')::numeric, 0) <> 0 then format('Till differences: %s', app.money_txt((v ->> 'cash_differences')::numeric, v_cur)) end,
    case when coalesce((v ->> 'overdue_total')::numeric, 0) > 0 then format('Overdue: %s', app.money_txt((v ->> 'overdue_total')::numeric, v_cur)) end,
    case when coalesce((v ->> 'low_stock')::int, 0) > 0 then format('Running low: %s', v ->> 'low_stock') end,
    case when coalesce((v ->> 'approvals')::int, 0) > 0 then format('Waiting for approval: %s', v ->> 'approvals') end);
  insert into public.notifications (company_id, user_id, type, title, body, link, entity_type)
  select distinct p_company, m.user_id, 'info',
         format('Sales on %s: %s', to_char((v ->> 'day')::date, 'DD.MM.YYYY'), app.money_txt(v_sales, v_cur)), nullif(v_body, ''), '/', 'daily_summary'
    from public.company_members m
    join public.member_roles mr on mr.member_id = m.id and mr.company_id = m.company_id
    join public.role_permissions rp on rp.role_id = mr.role_id
   where m.company_id = p_company and m.status = 'active' and m.user_id is not null and rp.permission in ('admin.write', 'admin.*', '*');
  get diagnostics n = row_count;
  return n;
end $$;

-- every morning (at the summary hour, 8:00 if none is set), also on servers without email or WhatsApp
do $$ begin
  perform app._patch_function('public.automation_tick',
    '    if c.dunning_enabled and v_hour >= 9',
    '    if v_hour >= coalesce(c.summary_hour, 8) and app.once_today(''summary_note'', c.id, v_day) then
      perform app.summary_notify(c.id);
    end if;
    if c.dunning_enabled and v_hour >= 9');
end $$;

-- ---------------------------------------------------------------------------------------------
-- for the postier only
-- ---------------------------------------------------------------------------------------------
create or replace function public.postier_push_keys(p_public text default null, p_private text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  if p_public is not null and p_private is not null then
    insert into app.push_keys (public_key, private_jwk) values (p_public, p_private) on conflict (id) do nothing;
  end if;
  return (select jsonb_build_object('public', public_key, 'private', private_jwk) from app.push_keys);
end $$;

create or replace function public.postier_push_claim(p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  -- a notification that could not go out within a day is no news any more
  delete from app.push_outbox where created_at < now() - interval '1 day' and status <> 'sending'
                                 or created_at < now() - interval '7 days';
  with picked as (
    select o.id from app.push_outbox o
     where o.status in ('queued', 'failed') and o.next_try_at <= now() and o.attempts < 5
     order by o.created_at limit least(coalesce(p_limit, 50), 200) for update skip locked
  ), upd as (
    update app.push_outbox o set status = 'sending', attempts = attempts + 1, next_try_at = now() + make_interval(mins => (2 * power(3, attempts))::int)
      from picked where o.id = picked.id returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth, 'title', u.title, 'body', u.body,
           'link', u.link, 'company', u.company_name, 'locale', u.locale, 'tag', coalesce(u.notification_id, u.id))), '[]'::jsonb)
    into v from upd u join public.push_subscriptions s on s.id = u.subscription_id;
  return v;
end $$;

create or replace function public.postier_push_done(p_id uuid, p_ok boolean, p_error text default null, p_gone boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_sub uuid;
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  if p_ok then
    delete from app.push_outbox where id = p_id returning subscription_id into v_sub;
    update public.push_subscriptions set last_sent_at = now(), failures = 0 where id = v_sub;
    return;
  end if;
  update app.push_outbox set status = 'failed', last_error = left(p_error, 500) where id = p_id returning subscription_id into v_sub;
  -- the device said goodbye (app removed, permission taken back): forget it
  if p_gone then delete from public.push_subscriptions where id = v_sub;
  else update public.push_subscriptions set failures = failures + 1 where id = v_sub; end if;
  delete from public.push_subscriptions where id = v_sub and failures >= 20;
end $$;

revoke execute on function public.postier_push_keys(text, text), public.postier_push_claim(int), public.postier_push_done(uuid, boolean, text, boolean) from public, anon, authenticated;
grant execute on function public.postier_push_keys(text, text), public.postier_push_claim(int), public.postier_push_done(uuid, boolean, text, boolean) to service_role;

drop function app._patch_function(text, text, text);
