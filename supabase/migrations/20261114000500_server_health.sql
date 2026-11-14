-- =============================================================================
-- The local servers, watched from the Platform. Every 5 minutes a local server says how its parts are (the
-- database, the sign-in, the files, the page, the tunnel) and how big its database is. The cloud keeps the
-- state of each server and every change of it: a part down, the server silent for more than 10 minutes, back
-- again. Each change is told to the Super Admins (a notification, also on the phone), once.
-- =============================================================================

create table if not exists app.server_health (
  company_id   uuid primary key references public.companies (id) on delete cascade,
  server_id    uuid not null,
  seen_at      timestamptz not null default now(),
  state        text not null default 'ok' check (state in ('ok', 'warn', 'silent')),
  state_since  timestamptz not null default now(),
  down         text[] not null default '{}',
  services     jsonb not null default '{}',
  version      text,
  db_mb        int,
  details      jsonb not null default '{}'
);
revoke all on app.server_health from public, anon, authenticated;

create table if not exists app.server_health_events (
  id         bigserial primary key,
  company_id uuid not null references public.companies (id) on delete cascade,
  at         timestamptz not null default now(),
  state      text not null check (state in ('ok', 'warn', 'silent')),
  detail     text
);
create index if not exists server_health_events_idx on app.server_health_events (company_id, at desc);
revoke all on app.server_health_events from public, anon, authenticated;

-- a change of state: kept, and told to every Super Admin
create or replace function app.server_state_change(p_company uuid, p_state text, p_detail text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_name text := (select name from public.companies where id = p_company); a uuid;
begin
  insert into app.server_health_events (company_id, state, detail) values (p_company, p_state, p_detail);
  for a in select id from public.profiles where is_super_admin loop
    perform app.notify(p_company, a, case p_state when 'ok' then 'info' else 'warning' end,
      case p_state when 'ok' then 'Server works again: ' || v_name
                   when 'silent' then 'Server silent: ' || v_name
                   else 'Server has a problem: ' || v_name end,
      p_detail, '/platform/servers');
  end loop;
end $$;
revoke execute on function app.server_state_change(uuid, text, text) from public, anon, authenticated;

-- the local server reports (anonymous, with its licence and its server id)
create or replace function public.licence_health(p_code text, p_server uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare l public.licenses; h app.server_health; v_down text[]; v_state text;
begin
  l := app.backup_licence(p_code, p_server);
  select coalesce(array_agg(k order by k), '{}') into v_down from jsonb_each(coalesce(p -> 'services', '{}')) s(k, v) where v = 'false'::jsonb;
  v_state := case when cardinality(v_down) = 0 then 'ok' else 'warn' end;
  select * into h from app.server_health where company_id = l.company_id for update;
  if h.company_id is null then
    insert into app.server_health (company_id, server_id, state, down, services, version, db_mb, details)
    values (l.company_id, p_server, v_state, v_down, coalesce(p -> 'services', '{}'), left(p ->> 'version', 40), (p ->> 'db_mb')::int, coalesce(p -> 'details', '{}'));
    if v_state <> 'ok' then perform app.server_state_change(l.company_id, v_state, array_to_string(v_down, ', ')); end if;
  else
    update app.server_health set server_id = p_server, seen_at = now(), down = v_down, services = coalesce(p -> 'services', '{}'),
           version = coalesce(left(p ->> 'version', 40), version), db_mb = coalesce((p ->> 'db_mb')::int, db_mb), details = coalesce(p -> 'details', details),
           state = v_state, state_since = case when state <> v_state or down <> v_down then now() else state_since end
     where company_id = l.company_id;
    if h.state <> v_state or (v_state = 'warn' and h.down <> v_down) then
      perform app.server_state_change(l.company_id, v_state, case when v_state = 'ok' then null else array_to_string(v_down, ', ') end);
    end if;
  end if;
  update public.licenses set local_seen_at = now() where company_id = l.company_id;
end $$;
revoke execute on function public.licence_health(text, uuid, jsonb) from public;
grant execute on function public.licence_health(text, uuid, jsonb) to anon, authenticated;

-- the cloud's worker, every minute: a server silent for more than 10 minutes
create or replace function public.postier_health_watch()
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  for r in select company_id, seen_at from app.server_health where state <> 'silent' and seen_at < now() - interval '10 minutes' for update skip locked loop
    update app.server_health set state = 'silent', state_since = r.seen_at where company_id = r.company_id;
    perform app.server_state_change(r.company_id, 'silent', null);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.postier_health_watch() from public, anon, authenticated;
grant execute on function public.postier_health_watch() to service_role;

-- the Platform: every server's state, and for one its last 30 days
create or replace function public.platform_server_health(p_company uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  return jsonb_build_object(
    'servers', coalesce((select jsonb_agg(jsonb_build_object('company_id', h.company_id, 'company', c.name, 'state', h.state, 'state_since', h.state_since,
        'seen_at', h.seen_at, 'down', to_jsonb(h.down), 'services', h.services, 'version', h.version, 'db_mb', h.db_mb, 'details', h.details) order by c.name)
      from app.server_health h join public.companies c on c.id = h.company_id where p_company is null or h.company_id = p_company), '[]'::jsonb),
    'events', case when p_company is null then null else coalesce((select jsonb_agg(jsonb_build_object('at', e.at, 'state', e.state, 'detail', e.detail) order by e.at desc)
      from (select * from app.server_health_events where company_id = p_company and at > now() - interval '30 days' order by at desc limit 200) e), '[]'::jsonb) end,
    -- minutes not ok in the last 30 days, from the changes
    'down_minutes', case when p_company is null then null else coalesce((select round(sum(extract(epoch from (coalesce(x.next_at, now()) - greatest(x.at, now() - interval '30 days'))) / 60))::int
      from (select e.at, e.state, lead(e.at) over (order by e.at) as next_at from app.server_health_events e where e.company_id = p_company) x
      where x.state <> 'ok' and coalesce(x.next_at, now()) > now() - interval '30 days'), 0) end);
end $$;
revoke execute on function public.platform_server_health(uuid) from public, anon;
grant execute on function public.platform_server_health(uuid) to authenticated;

notify pgrst, 'reload schema';

-- on the local server: how big its database is (for its report)
create or replace function public.local_db_size()
returns int language sql stable security definer set search_path = '' as $$
  select (pg_database_size(current_database()) / 1048576)::int
$$;
revoke execute on function public.local_db_size() from public, anon, authenticated;
grant execute on function public.local_db_size() to service_role;
