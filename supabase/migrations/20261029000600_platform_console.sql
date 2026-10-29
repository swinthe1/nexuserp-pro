-- =============================================================================
-- The platform console: what the Super Admin needs to run DrisPRO for many clients.
--   * app.platform_events: a diary of what was done on the platform (clients created and
--     deleted, licences changed, passwords set, accounts made, links, prices, visits), kept
--     after a client is deleted
--   * platform_overview(): the numbers, what needs attention, the latest events
--   * platform_client_detail(): one client in full: data, licence, people, usage, links, diary
--   * platform_events(): the diary, for all clients or one
-- Only the Super Admin calls these. The app writes the words; the server keeps codes.
-- =============================================================================

create table if not exists app.platform_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,
  actor_email text,
  company_id uuid,          -- no link: the event stays after the client is deleted
  company_name text,
  kind text not null,
  details jsonb not null default '{}'
);
create index if not exists platform_events_at on app.platform_events (at desc);
create index if not exists platform_events_company on app.platform_events (company_id, at desc);
revoke all on app.platform_events from public, anon, authenticated;

create or replace function app.platform_log(p_kind text, p_company uuid default null, p_details jsonb default '{}')
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into app.platform_events (actor, actor_email, company_id, company_name, kind, details)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), p_company,
          (select name from public.companies where id = p_company), p_kind, coalesce(p_details, '{}'));
end $$;
revoke execute on function app.platform_log(text, uuid, jsonb) from public, anon, authenticated;

-- licences: every change a person makes (the local server's own check-ins are not changes)
create or replace function app.tg_licence_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_old jsonb; v_new jsonb; v_diff jsonb := '{}'; k text;
  v_keys text[] := array['plan', 'max_users', 'valid_from', 'valid_until', 'status', 'extra_features', 'max_warehouses', 'deployment', 'ai_reads_limit', 'ai_chat_limit', 'notes'];
begin
  v_new := to_jsonb(new);
  if tg_op = 'INSERT' then
    perform app.platform_log('licence_created', new.company_id, jsonb_build_object('plan', new.plan, 'max_users', new.max_users, 'valid_until', new.valid_until));
    return new;
  end if;
  v_old := to_jsonb(old);
  foreach k in array v_keys loop
    if v_old -> k is distinct from v_new -> k then v_diff := v_diff || jsonb_build_object(k, jsonb_build_object('from', v_old -> k, 'to', v_new -> k)); end if;
  end loop;
  if v_diff <> '{}' then perform app.platform_log('licence_changed', new.company_id, v_diff); end if;
  return new;
end $$;
drop trigger if exists trg_licence_log on public.licenses;
create trigger trg_licence_log after insert or update on public.licenses for each row execute function app.tg_licence_log();

create or replace function app.tg_company_created_log()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform app.platform_log('client_created', new.id, jsonb_build_object('country', new.country_code, 'training', new.is_training));
  return new;
end $$;
drop trigger if exists trg_company_created_log on public.companies;
create trigger trg_company_created_log after insert on public.companies for each row execute function app.tg_company_created_log();

-- the actions themselves write their line (if the action fails, the line goes with it)
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
  perform app._patch_function('public.platform_set_password', 'perform app.require_super_admin();',
    $p$perform app.require_super_admin();
  perform app.platform_log('password_set', (select m.company_id from public.company_members m join auth.users u on u.id = m.user_id
                                             where lower(u.email) = lower(btrim(p_email)) and m.deleted_at is null order by m.created_at limit 1),
                           jsonb_build_object('email', lower(btrim(p_email))));$p$);
  perform app._patch_function('public.platform_create_account', 'perform app.require_super_admin();',
    $p$perform app.require_super_admin();
  perform app.platform_log('account_created', (select company_id from public.company_members where id = p_member),
                           jsonb_build_object('email', (select invited_email from public.company_members where id = p_member)));$p$);
  perform app._patch_function('public.platform_set_business_type', 'perform app.require_super_admin();',
    $p$perform app.require_super_admin();
  perform app.platform_log('business_type_set', p_company, jsonb_build_object('type', p_type));$p$);
  perform app._patch_function('public.platform_set_self_service', 'perform app.require_super_admin();',
    $p$perform app.require_super_admin();
  perform app.platform_log('self_service_set', null, jsonb_build_object('on', p_on));$p$);
  perform app._patch_function('public.platform_pricing_save', 'perform app.require_super_admin();',
    $p$perform app.require_super_admin();
  perform app.platform_log('prices_saved', null, '{}');$p$);
  perform app._patch_function('public.platform_set_ai_limit', 'perform app.require_super_admin();',
    $p$perform app.require_super_admin();
  perform app.platform_log('ai_limit_set', p_company, jsonb_build_object('reads', p_limit));$p$);
  perform app._patch_function('public.platform_set_ai_chat_limit', 'perform app.require_super_admin();',
    $p$perform app.require_super_admin();
  perform app.platform_log('ai_limit_set', p_company, jsonb_build_object('chat', p_limit));$p$);
  perform app._patch_function('public.platform_delete_client',
    $p$  raise log 'platform_delete_client:$p$,
    $p$  insert into app.platform_events (actor, actor_email, company_id, company_name, kind, details)
  values (auth.uid(), (select email from auth.users where id = auth.uid()), c.id, c.name, 'client_deleted',
          jsonb_build_object('rows', v_rows, 'users_deleted', v_users_deleted));
  raise log 'platform_delete_client:$p$);
end $$;
drop function app._patch_function(text, text, text);

-- sync links: made, switched on or off (the functions check the Super Admin themselves)
create or replace function app.tg_sync_log()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then perform app.platform_log('link_created', new.company_id, jsonb_build_object('name', new.name));
  elsif new.is_active is distinct from old.is_active then perform app.platform_log(case when new.is_active then 'link_on' else 'link_off' end, new.company_id, jsonb_build_object('name', new.name));
  end if;
  return new;
end $$;
drop trigger if exists trg_sync_log on public.sync_connections;
create trigger trg_sync_log after insert or update of is_active on public.sync_connections for each row execute function app.tg_sync_log();

-- opening a client's company to help them: written down too
create or replace function public.platform_log_visit(p_company uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  -- one line per client per hour is enough
  if exists (select 1 from app.platform_events where kind = 'support_visit' and company_id = p_company and actor = auth.uid() and at > now() - interval '1 hour') then return; end if;
  perform app.platform_log('support_visit', p_company, '{}');
end $$;
revoke execute on function public.platform_log_visit(uuid) from public, anon;
grant execute on function public.platform_log_visit(uuid) to authenticated;

-- the diary
create or replace function public.platform_events(p_company uuid default null, p_limit integer default 200, p_before timestamptz default null, p_kind text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  return coalesce((select jsonb_agg(to_jsonb(e) order by e.at desc) from (
    select id, at, actor_email, company_id, company_name, kind, details,
           exists (select 1 from public.companies c where c.id = x.company_id) as company_exists
      from app.platform_events x
     where (p_company is null or company_id = p_company) and (p_before is null or at < p_before) and (p_kind is null or kind = p_kind)
     order by at desc limit least(greatest(coalesce(p_limit, 200), 1), 1000)) e), '[]'::jsonb);
end $$;
revoke execute on function public.platform_events(uuid, integer, timestamptz, text) from public, anon;
grant execute on function public.platform_events(uuid, integer, timestamptz, text) to authenticated;

-- the overview: numbers, what needs attention, the latest events, new clients by month
create or replace function public.platform_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_out jsonb; v_att jsonb;
begin
  perform app.require_super_admin();
  with cl as (
    select c.id, c.name, c.is_training, c.created_at, l.plan, l.max_users, l.valid_until, l.status, l.deployment, l.local_seen_at, l.local_version,
           l.local_server_id, app.seats_used(c.id) as users, p.price_month, p.per_user, p.users as plan_users
      from public.companies c left join public.licenses l on l.company_id = c.id left join app.public_pricing p on p.plan = l.plan
     where c.deleted_at is null)
  select jsonb_build_object(
    'clients', count(*),
    'active', count(*) filter (where status = 'active' and valid_until >= current_date),
    'ending', count(*) filter (where status = 'active' and valid_until >= current_date and valid_until < current_date + 30),
    'expired', count(*) filter (where status = 'active' and valid_until < current_date),
    'suspended', count(*) filter (where status = 'suspended'),
    'training', count(*) filter (where is_training),
    'users', coalesce(sum(users), 0),
    'seats', coalesce(sum(max_users), 0),
    'local_servers', count(*) filter (where local_server_id is not null),
    'local_online', count(*) filter (where local_seen_at > now() - interval '2 hours'),
    'local_versions', coalesce((select jsonb_object_agg(x.ver, x.n) from (select coalesce(local_version, '?') ver, count(*) n from cl where local_server_id is not null group by 1) x), '{}'::jsonb),
    -- a month's income from the licences, by the public prices (null when the prices are not set yet)
    'income_month', case when bool_or(price_month is not null) then
        sum(coalesce(price_month, 0) + coalesce(per_user, 0) * greatest(coalesce(max_users, 0) - coalesce(plan_users, 0), 0))
          filter (where status = 'active' and valid_until >= current_date and not is_training) end,
    'priced', bool_or(price_month is not null),
    'by_plan', coalesce((select jsonb_object_agg(coalesce(plan, '-'), n) from (select plan, count(*) n from cl where not is_training group by 1) x), '{}'::jsonb),
    'new_by_month', coalesce((select jsonb_agg(jsonb_build_object('month', m, 'n', n) order by m) from (
        select to_char(g, 'YYYY-MM') m, (select count(*) from cl where date_trunc('month', cl.created_at) = g and not cl.is_training) n
          from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') g) x), '[]'::jsonb)
  ) into v_out from cl;

  v_out := v_out || jsonb_build_object(
    'links', (select jsonb_build_object('active', count(*) filter (where is_active), 'errors', count(*) filter (where is_active and last_error is not null),
                                        'quiet', count(*) filter (where is_active and (last_seen_at is null or last_seen_at < now() - interval '1 day')))
                from public.sync_connections),
    'reads_month', (select jsonb_build_object('total', count(*), 'failed', count(*) filter (where status = 'failed'))
                      from app.document_reads where created_at >= date_trunc('month', now())),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.at desc) from (
        select id, at, actor_email, company_id, company_name, kind, details from app.platform_events order by at desc limit 12) e), '[]'::jsonb));

  -- what needs the Super Admin, most urgent first
  select coalesce(jsonb_agg(a order by (a ->> 'rank')::int, a ->> 'at'), '[]'::jsonb) into v_att from (
    select jsonb_build_object('kind', 'licence_expired', 'rank', 1, 'company_id', c.id, 'company_name', c.name, 'at', l.valid_until) a
      from public.companies c join public.licenses l on l.company_id = c.id
     where c.deleted_at is null and l.status = 'active' and l.valid_until < current_date and not c.is_training
    union all
    select jsonb_build_object('kind', 'licence_ending', 'rank', 2, 'company_id', c.id, 'company_name', c.name, 'at', l.valid_until, 'days', l.valid_until - current_date)
      from public.companies c join public.licenses l on l.company_id = c.id
     where c.deleted_at is null and l.status = 'active' and l.valid_until >= current_date and l.valid_until < current_date + 30 and not c.is_training
    union all
    select jsonb_build_object('kind', 'link_error', 'rank', 3, 'company_id', s.company_id, 'company_name', c.name, 'at', s.last_seen_at, 'detail', left(s.last_error, 160), 'name', s.name)
      from public.sync_connections s join public.companies c on c.id = s.company_id where s.is_active and s.last_error is not null
    union all
    select jsonb_build_object('kind', 'link_quiet', 'rank', 4, 'company_id', s.company_id, 'company_name', c.name, 'at', s.last_seen_at, 'name', s.name)
      from public.sync_connections s join public.companies c on c.id = s.company_id
     where s.is_active and s.last_error is null and s.last_seen_at < now() - interval '1 day'
    union all
    select jsonb_build_object('kind', 'local_quiet', 'rank', 4, 'company_id', c.id, 'company_name', c.name, 'at', l.local_seen_at, 'version', l.local_version)
      from public.companies c join public.licenses l on l.company_id = c.id
     where c.deleted_at is null and l.local_server_id is not null and l.local_seen_at < now() - interval '24 hours'
    union all
    select jsonb_build_object('kind', 'pending_account', 'rank', 5, 'company_id', m.company_id, 'company_name', c.name, 'at', m.created_at, 'detail', m.invited_email, 'member_id', m.id)
      from public.company_members m join public.companies c on c.id = m.company_id
     where m.status = 'invited' and m.user_id is null and m.deleted_at is null and c.deleted_at is null
    union all
    select jsonb_build_object('kind', 'seats_full', 'rank', 6, 'company_id', c.id, 'company_name', c.name, 'detail', app.seats_used(c.id) || ' / ' || l.max_users)
      from public.companies c join public.licenses l on l.company_id = c.id
     where c.deleted_at is null and l.status = 'active' and app.seats_used(c.id) >= l.max_users and not c.is_training
  ) x;
  return v_out || jsonb_build_object('attention', v_att);
end $$;
revoke execute on function public.platform_overview() from public, anon;
grant execute on function public.platform_overview() to authenticated;

-- one client in full
create or replace function public.platform_client_detail(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.companies; v_month date := date_trunc('month', current_date);
begin
  perform app.require_super_admin();
  select * into c from public.companies where id = p_company and deleted_at is null;
  if c.id is null then raise exception 'Client not found' using errcode = 'P0002'; end if;
  return jsonb_build_object(
    'company', jsonb_build_object('id', c.id, 'name', c.name, 'legal_name', c.legal_name, 'tax_number', c.tax_number, 'vat_number', c.vat_number,
       'business_number', c.business_number, 'country_code', c.country_code, 'base_currency', c.base_currency, 'address', concat_ws(', ', c.address_line1, c.address_line2, c.city),
       'address_line1', c.address_line1, 'city', c.city,
       'phone', c.phone, 'email', c.email, 'website', c.website, 'created_at', c.created_at, 'is_training', c.is_training, 'business_type', c.business_type),
    'licence', (select to_jsonb(l) - 'backup_key' - 'local_server_id' || jsonb_build_object('has_server', l.local_server_id is not null) from public.licenses l where l.company_id = c.id),
    'users', app.seats_used(c.id),
    'members', coalesce((select jsonb_agg(jsonb_build_object(
          'member_id', m.id, 'user_id', m.user_id, 'email', coalesce(u.email, m.invited_email), 'name', p.full_name, 'status', m.status,
          'last_sign_in_at', u.last_sign_in_at, 'joined_at', m.joined_at, 'external_accountant', m.external_accountant,
          'roles', (select coalesce(jsonb_agg(r.name order by r.name), '[]'::jsonb) from public.member_roles mr join public.roles r on r.id = mr.role_id where mr.member_id = m.id),
          'role_keys', (select coalesce(jsonb_agg(r.key order by r.name), '[]'::jsonb) from public.member_roles mr join public.roles r on r.id = mr.role_id where mr.member_id = m.id),
          'is_admin', exists (select 1 from public.member_roles mr join public.roles r on r.id = mr.role_id where mr.member_id = m.id and r.key = 'company_admin'))
        order by m.created_at)
        from public.company_members m left join auth.users u on u.id = m.user_id left join public.profiles p on p.id = m.user_id
       where m.company_id = c.id and m.deleted_at is null and m.status <> 'removed'
         and not coalesce(p.is_super_admin, false)), '[]'::jsonb),
    'usage', jsonb_build_object(
       'invoices', (select count(*) from public.sales_invoices where company_id = c.id and deleted_at is null),
       'invoices_month', (select count(*) from public.sales_invoices where company_id = c.id and deleted_at is null and invoice_date >= v_month),
       'bills', (select count(*) from public.vendor_bills where company_id = c.id and deleted_at is null),
       'pos_month', (select count(*) from public.pos_orders where company_id = c.id and created_at >= v_month),
       'products', (select count(*) from public.products where company_id = c.id and deleted_at is null),
       'partners', (select count(*) from public.business_partners where company_id = c.id and deleted_at is null),
       'warehouses', (select count(*) from public.warehouses where company_id = c.id and coalesce(is_active, true)),
       'reads_month', (select count(*) from app.document_reads where company_id = c.id and created_at >= v_month),
       'last_activity', (select max(occurred_at) from public.audit_log where company_id = c.id),
       'activity_by_day', coalesce((select jsonb_agg(jsonb_build_object('day', g::date, 'n', coalesce(a.n, 0)) order by g)
          from generate_series(current_date - 29, current_date, interval '1 day') g
          left join (select occurred_at::date d, count(*) n from public.audit_log where company_id = c.id and occurred_at >= current_date - 29 group by 1) a on a.d = g::date), '[]'::jsonb)),
    'sync', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'key_prefix', s.key_prefix, 'is_active', s.is_active,
          'last_seen_at', s.last_seen_at, 'last_error', s.last_error, 'pushes', s.pushes, 'last_counts', s.last_counts) order by s.created_at)
        from public.sync_connections s where s.company_id = c.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.at desc) from (
        select id, at, actor_email, kind, details from app.platform_events where company_id = c.id order by at desc limit 100) e), '[]'::jsonb));
end $$;
revoke execute on function public.platform_client_detail(uuid) from public, anon;
grant execute on function public.platform_client_detail(uuid) to authenticated;

-- the client list also carries the local server's version and address (for "Local servers")
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
  perform app._patch_function('public.platform_clients', $p$'local_seen_at', l.local_seen_at,$p$,
    $p$'local_seen_at', l.local_seen_at, 'local_version', l.local_version, 'local_url', l.local_url, 'has_server', l.local_server_id is not null,$p$);
end $$;
drop function app._patch_function(text, text, text);
