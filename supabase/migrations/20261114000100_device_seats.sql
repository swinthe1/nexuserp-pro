-- =============================================================================
-- DrisPRO · every device has its own licence, approved by DrisPRO
--   A computer (till, administration), a browser or a phone works only with its own licence: an id and
--   a secret made on the device (only its hash is kept here), approved by the Super Admin and nobody
--   else. A new device shows a pairing code (6 letters, 15 minutes, used once); the Super Admin types it
--   in the Platform, chooses the client, what the device is and its name. A licence is a lease of 30
--   days, renewed by itself whenever the device reaches DrisPRO: without internet it works on for 30 days.
--   Per client the check is off (as before), warn (the device is told) or on: then a person of that client
--   signs in and works only from a licensed device of that client. The Super Admin is never held.
--   A local server gets its client's devices from the cloud and checks them itself, without internet.
-- =============================================================================

alter table app.devices drop constraint if exists devices_kind_check;
alter table app.devices add constraint devices_kind_check check (kind in ('till', 'office', 'mobile'));
alter table app.devices add column if not exists lease_until timestamptz;
alter table app.devices add column if not exists clone_suspect boolean not null default false;
alter table app.devices add column if not exists user_agent text;
update app.devices set lease_until = now() + interval '30 days' where status = 'active' and lease_until is null;

alter table public.licenses add column if not exists device_guard text not null default 'off';
alter table public.licenses drop constraint if exists licenses_device_guard_check;
alter table public.licenses add constraint licenses_device_guard_check check (device_guard in ('off', 'warn', 'on'));
comment on column public.licenses.device_guard is 'off: any device; warn: a device without licence is told; on: only licensed devices of the client';
-- every new device waits for the Super Admin
alter table public.licenses alter column device_approval set default 'request';
update public.licenses set device_approval = 'request' where device_approval <> 'request';

create or replace function app.device_lease() returns interval language sql immutable set search_path = '' as $$ select interval '30 days' $$;

-- ----------------------------------------------------------------------------- pairing a new device
create table if not exists app.device_pairings (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  secret_hash text not null,
  kind        text not null default 'office' check (kind in ('till', 'office', 'mobile')),
  info        jsonb not null default '{}',
  ip          text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '15 minutes',
  device_id   uuid references app.devices (id) on delete set null
);
create index if not exists device_pairings_code_idx on app.device_pairings (code, expires_at);
revoke all on app.device_pairings from public, anon, authenticated;

-- the device asks for a pairing code (anonymous): it keeps the id and its secret, shows the code
create or replace function public.device_pair_start(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_secret text := p ->> 'secret'; v_code text; v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int; r app.device_pairings;
  v_kind text := coalesce(nullif(p ->> 'kind', ''), 'office');
begin
  if coalesce(length(v_secret), 0) < 32 then raise exception 'The device sent no key' using errcode = '23514'; end if;
  if v_kind not in ('till', 'office', 'mobile') then v_kind := 'office'; end if;
  delete from app.device_pairings where expires_at < now() - interval '1 day' and device_id is null;
  if (select count(*) from app.device_pairings where ip = app.request_ip() and created_at > now() - interval '1 hour') >= 20
     or (select count(*) from app.device_pairings where expires_at > now() and device_id is null) >= 500 then
    raise exception 'Too many pairing codes asked; wait a little and try again' using errcode = '42501';
  end if;
  loop
    v_code := '';
    for i in 1..6 loop v_code := v_code || substr(v_alpha, 1 + (get_byte(extensions.gen_random_bytes(1), 0) % 32), 1); end loop;
    exit when not exists (select 1 from app.device_pairings where code = v_code and expires_at > now() - interval '1 day');
  end loop;
  insert into app.device_pairings (code, secret_hash, kind, info, ip)
  values (v_code, encode(extensions.digest(v_secret, 'sha256'), 'hex'), v_kind,
          jsonb_strip_nulls(jsonb_build_object('name', left(p ->> 'name', 60), 'hostname', left(p ->> 'hostname', 120), 'os', left(p ->> 'os', 120),
            'platform', left(p ->> 'platform', 30), 'version', left(p ->> 'version', 30), 'user_agent', left(p ->> 'user_agent', 300),
            'fingerprint', left(p ->> 'fingerprint', 128), 'server', left(p ->> 'server', 200))), app.request_ip())
  returning * into r;
  return jsonb_build_object('id', r.id, 'code', r.code, 'expires_at', r.expires_at);
end $$;
revoke execute on function public.device_pair_start(jsonb) from public;
grant execute on function public.device_pair_start(jsonb) to anon, authenticated;

-- the device waits: approved (its licence), still waiting, or the code ran out
create or replace function public.device_pair_status(p_id uuid, p_secret text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r app.device_pairings; d app.devices;
begin
  select * into r from app.device_pairings where id = p_id;
  if r.id is null or r.secret_hash <> encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') then
    return jsonb_build_object('status', 'unknown');
  end if;
  if r.device_id is not null then
    select * into d from app.devices where id = r.device_id;
    return app.device_row(d);
  end if;
  if r.expires_at < now() then return jsonb_build_object('status', 'expired'); end if;
  return jsonb_build_object('status', 'waiting', 'code', r.code, 'expires_at', r.expires_at);
end $$;
revoke execute on function public.device_pair_status(uuid, text) from public;
grant execute on function public.device_pair_status(uuid, text) to anon, authenticated;

-- the Super Admin looks a code up, then approves it for a client
create or replace function public.platform_device_pair_find(p_code text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r app.device_pairings;
begin
  perform app.require_super_admin();
  select * into r from app.device_pairings where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
     and expires_at > now() and device_id is null order by created_at desc limit 1;
  if r.id is null then raise exception 'This pairing code is not known or has run out' using errcode = 'P0002'; end if;
  return jsonb_build_object('id', r.id, 'code', r.code, 'kind', r.kind, 'info', r.info, 'ip', r.ip, 'created_at', r.created_at, 'expires_at', r.expires_at);
end $$;
revoke execute on function public.platform_device_pair_find(text) from public, anon;
grant execute on function public.platform_device_pair_find(text) to authenticated;

create or replace function public.platform_device_pair_approve(p_code text, p_company uuid, p jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r app.device_pairings; d app.devices; v_kind text; v_name text;
begin
  perform app.require_super_admin();
  select * into r from app.device_pairings where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
     and expires_at > now() and device_id is null order by created_at desc limit 1 for update;
  if r.id is null then raise exception 'This pairing code is not known or has run out' using errcode = 'P0002'; end if;
  if not exists (select 1 from public.licenses where company_id = p_company) then raise exception 'Client not found' using errcode = 'P0002'; end if;
  v_kind := coalesce(nullif(p ->> 'kind', ''), r.kind);
  if v_kind not in ('till', 'office', 'mobile') then raise exception 'A device is a till, administration or a phone' using errcode = '23514'; end if;
  v_name := coalesce(nullif(left(btrim(p ->> 'name'), 60), ''), nullif(r.info ->> 'name', ''), nullif(r.info ->> 'hostname', ''),
                     case v_kind when 'till' then 'Arka' when 'mobile' then 'Telefoni' else 'Administrata' end);
  insert into app.devices (id, company_id, number, name, kind, status, secret_hash, hostname, os, platform, app_version, server, fingerprint, user_agent,
                           first_ip, last_ip, approved_at, approved_by, last_seen_at, lease_until)
  values (r.id, p_company, coalesce((select max(number) from app.devices where company_id = p_company), 0) + 1, v_name, v_kind, 'active', r.secret_hash,
          r.info ->> 'hostname', r.info ->> 'os', r.info ->> 'platform', r.info ->> 'version', r.info ->> 'server', r.info ->> 'fingerprint', r.info ->> 'user_agent',
          r.ip, r.ip, now(), auth.uid(), now(), now() + app.device_lease())
  returning * into d;
  update app.device_pairings set device_id = d.id where id = r.id;
  perform app.platform_log('device_approved', p_company, jsonb_build_object('device', 'PC-' || lpad(d.number::text, 4, '0'), 'name', d.name, 'kind', d.kind, 'paired', true));
  return app.device_row(d);
end $$;
revoke execute on function public.platform_device_pair_approve(text, uuid, jsonb) from public, anon;
grant execute on function public.platform_device_pair_approve(text, uuid, jsonb) to authenticated;

-- the check per client: off, warn or on
create or replace function public.platform_device_guard_set(p_company uuid, p_guard text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  if p_guard not in ('off', 'warn', 'on') then raise exception 'Unknown state' using errcode = '23514'; end if;
  update public.licenses set device_guard = p_guard, updated_by = auth.uid(), updated_at = now() where company_id = p_company;
  if not found then raise exception 'Client not found' using errcode = 'P0002'; end if;
  perform app.platform_log('device_guard', p_company, jsonb_build_object('guard', p_guard));
end $$;
revoke execute on function public.platform_device_guard_set(uuid, text) from public, anon;
grant execute on function public.platform_device_guard_set(uuid, text) to authenticated;

-- ----------------------------------------------------------------------------- the check
-- the device of this request, from its headers: only an approved one with a running lease
create or replace function app.request_device()
returns app.devices language plpgsql stable security definer set search_path = '' as $$
declare h jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'); d app.devices; v_id uuid;
begin
  begin v_id := nullif(h ->> 'x-drispro-device', '')::uuid; exception when others then return null; end;
  if v_id is null then return null; end if;
  select * into d from app.devices where id = v_id and status = 'active' and coalesce(lease_until, '-infinity') > now()
     and secret_hash = encode(extensions.digest(coalesce(h ->> 'x-drispro-device-key', ''), 'sha256'), 'hex');
  return d;
end $$;
revoke execute on function app.request_device() from public, anon, authenticated;

-- the clients of this person that ask for a licensed device
create or replace function app.device_guard_of(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case when coalesce((select is_super_admin from public.profiles where id = p_user), false) then 'off'
    else coalesce((select max(l.device_guard) filter (where l.device_guard = 'on') from public.company_members m join public.licenses l on l.company_id = m.company_id
                    where m.user_id = p_user and m.status = 'active' and m.deleted_at is null), 'off') end
$$;
revoke execute on function app.device_guard_of(uuid) from public, anon, authenticated;

create or replace function app.device_allows(p_user uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare d app.devices;
begin
  if p_user is null or app.device_guard_of(p_user) <> 'on' then return true; end if;
  d := app.request_device();
  return d.id is not null and exists (select 1 from public.company_members m where m.user_id = p_user and m.company_id = d.company_id
                                        and m.status = 'active' and m.deleted_at is null);
end $$;
revoke execute on function app.device_allows(uuid) from public, anon, authenticated;

-- run by the API before every request of a signed-in person
create or replace function public.check_device()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.device_allows(auth.uid()) then
    raise exception 'This device has no DrisPRO licence' using errcode = '42501', hint = 'device_licence';
  end if;
end $$;
revoke execute on function public.check_device() from public;
grant execute on function public.check_device() to anon, authenticated, service_role;

-- what this device and this person are told (the app asks it after signing in and now and then)
create or replace function public.device_state()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d app.devices; v_guard text := 'off';
begin
  if auth.uid() is not null then
    v_guard := coalesce((select case when bool_or(l.device_guard = 'on') then 'on' when bool_or(l.device_guard = 'warn') then 'warn' else 'off' end
                           from public.company_members m join public.licenses l on l.company_id = m.company_id
                          where m.user_id = auth.uid() and m.status = 'active' and m.deleted_at is null), 'off');
    if coalesce((select is_super_admin from public.profiles where id = auth.uid()), false) then v_guard := 'off'; end if;
  end if;
  d := app.request_device();
  return jsonb_build_object('guard', v_guard, 'licensed', d.id is not null, 'device', case when d.id is not null then app.device_row(d) end);
end $$;
revoke execute on function public.device_state() from public;
grant execute on function public.device_state() to anon, authenticated;

-- the API runs the check before every request (where its settings can be changed from here)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticator') then
    begin
      execute 'alter role authenticator set pgrst.db_pre_request to ''public.check_device''';
    exception when others then raise notice 'the API check could not be set: %', sqlerrm;
    end;
  end if;
end $$;

-- ----------------------------------------------------------------------------- the existing functions learn the lease
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

select app._patch_function('app.device_row',
  $x$'blocked_at', d.blocked_at, 'last_seen_at', d.last_seen_at)$x$,
  $x$'blocked_at', d.blocked_at, 'last_seen_at', d.last_seen_at, 'lease_until', d.lease_until, 'clone_suspect', d.clone_suspect, 'user_agent', d.user_agent)$x$);

-- a new computer from the licence code always waits for the Super Admin
select app._patch_function('public.device_activate',
  $x$  insert into app.devices (company_id, number, name, kind, status, secret_hash, hostname,$x$,
  $x$  v_status := 'pending';   -- every new computer waits for the Super Admin
  insert into app.devices (company_id, number, name, kind, status, secret_hash, hostname,$x$);

-- every check of an approved device renews its lease; another machine with its key is noted
select app._patch_function('public.device_ping',
  $x$  select * into l from public.licenses where company_id = d.company_id;
  return$x$,
  $x$  select * into l from public.licenses where company_id = d.company_id;
  if d.status = 'active' and l.status = 'active' and current_date between l.valid_from and l.valid_until then
    update app.devices set lease_until = now() + app.device_lease() where id = d.id returning * into d;
  end if;
  if d.fingerprint is not null and nullif(p ->> 'fingerprint', '') is not null and p ->> 'fingerprint' <> d.fingerprint and not d.clone_suspect then
    update app.devices set clone_suspect = true where id = d.id returning * into d;
    perform app.platform_log('device_clone_suspect', d.company_id, jsonb_build_object('device', 'PC-' || lpad(d.number::text, 4, '0'), 'name', d.name, 'ip', app.request_ip()));
  end if;
  return$x$);

select app._patch_function('public.platform_device_set',
  $x$if v_kind is not null and v_kind not in ('till', 'office') then$x$,
  $x$if v_kind is not null and v_kind not in ('till', 'office', 'mobile') then$x$);
select app._patch_function('public.platform_device_set',
  $x$blocked_at = case when v_status = 'blocked' then now() when v_status = 'active' then null else blocked_at end$x$,
  $x$blocked_at = case when v_status = 'blocked' then now() when v_status = 'active' then null else blocked_at end,
    lease_until = case when v_status = 'active' then now() + app.device_lease() when v_status = 'blocked' then null else lease_until end,
    clone_suspect = case when v_status = 'active' then false else clone_suspect end$x$);

-- signing in with user name and PIN: from a licensed device when the client asks for one
select app._patch_function('public.login_with_pin',
  $x$  update app.user_logins set failed = 0, locked_until = null where user_id = l.user_id;$x$,
  $x$  update app.user_logins set failed = 0, locked_until = null where user_id = l.user_id;
  if not app.device_allows(l.user_id) then return jsonb_build_object('error', 'This device has no DrisPRO licence', 'device', true); end if;$x$);

-- the console's client list shows the check
select app._patch_function('public.platform_clients',
  $x$               'modules', to_jsonb(app.company_features(c.id)),$x$,
  $x$               'modules', to_jsonb(app.company_features(c.id)), 'device_guard', (select l2.device_guard from public.licenses l2 where l2.company_id = c.id),$x$);

-- ----------------------------------------------------------------------------- the errors say on which device, and a local server sends them to DrisPRO
alter table public.client_errors add column if not exists device text;
alter table public.client_errors add column if not exists sent_count int not null default 0;

select app._patch_function('public.report_client_error',
  $x$  insert into public.client_errors (fingerprint, kind, message, stack, url, version, user_agent, seen_in, users)
  values (v_fp, v_kind, v_msg, v_stack, left(app.scrub(p ->> 'url'), 300), left(p ->> 'version', 40), left(p ->> 'user_agent', 300),
          nullif(p ->> 'company_id', '')::uuid, array[v_uid])$x$,
  $x$  insert into public.client_errors (fingerprint, kind, message, stack, url, version, user_agent, seen_in, users, device)
  values (v_fp, v_kind, v_msg, v_stack, left(app.scrub(p ->> 'url'), 300), left(p ->> 'version', 40), left(p ->> 'user_agent', 300),
          nullif(p ->> 'company_id', '')::uuid, array[v_uid],
          (select 'PC-' || lpad(d.number::text, 4, '0') || ' · ' || d.name from app.request_device() d where d.id is not null))$x$);

-- the local server's worker: what is new since the last send (count only what was not sent), then marks it sent
create or replace function public.local_errors_take()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'fingerprint', e.fingerprint, 'day', e.day, 'kind', e.kind, 'message', e.message,
                     'stack', e.stack, 'url', e.url, 'version', e.version, 'user_agent', e.user_agent, 'device', e.device,
                     'count', e.count - e.sent_count, 'people', cardinality(e.users), 'first_at', e.first_at, 'last_at', e.last_at, 'sent_count', e.count))
                   from (select * from public.client_errors where count > sent_count order by last_at limit 200) e), '[]'::jsonb);
end $$;
revoke execute on function public.local_errors_take() from public, anon, authenticated;
grant execute on function public.local_errors_take() to service_role;

create or replace function public.local_errors_sent(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  update public.client_errors e set sent_count = greatest(e.sent_count, (x ->> 'sent_count')::int)
    from jsonb_array_elements(coalesce(p, '[]')) x where e.id = (x ->> 'id')::bigint;
end $$;
revoke execute on function public.local_errors_sent(jsonb) from public, anon, authenticated;
grant execute on function public.local_errors_sent(jsonb) to service_role;

-- the cloud takes a local server's errors, as its client's (people are not known here: only how many)
create or replace function public.licence_errors_submit(p_code text, p_server uuid, p jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare l public.licenses; x jsonb; n int := 0; v_fp text;
begin
  l := app.backup_licence(p_code, p_server);
  for x in select * from jsonb_array_elements(coalesce(p, '[]')) limit 200 loop
    if coalesce((x ->> 'count')::int, 0) <= 0 then continue; end if;
    -- the same error of the same server is one row a day, apart from the cloud's own
    v_fp := md5('local|' || l.company_id || '|' || coalesce(x ->> 'fingerprint', ''));
    insert into public.client_errors (fingerprint, day, kind, message, stack, url, version, user_agent, seen_in, device, count, sent_count, first_at, last_at)
    values (v_fp, coalesce((x ->> 'day')::date, current_date),
            case when x ->> 'kind' in ('error', 'promise', 'page', 'chunk') then x ->> 'kind' else 'error' end,
            left(app.scrub(coalesce(nullif(x ->> 'message', ''), '?')), 500), left(app.scrub(x ->> 'stack'), 4000), left(app.scrub(x ->> 'url'), 300),
            left(x ->> 'version', 40), left(x ->> 'user_agent', 300), l.company_id,
            left(coalesce(x ->> 'device', '') || ' · server lokal', 120), least((x ->> 'count')::int, 100000), least((x ->> 'count')::int, 100000),
            coalesce((x ->> 'first_at')::timestamptz, now()), coalesce((x ->> 'last_at')::timestamptz, now()))
    on conflict (fingerprint, day) do update set count = public.client_errors.count + excluded.count,
      sent_count = public.client_errors.sent_count + excluded.count, last_at = greatest(public.client_errors.last_at, excluded.last_at),
      device = excluded.device, version = excluded.version;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function public.licence_errors_submit(text, uuid, jsonb) from public;
grant execute on function public.licence_errors_submit(text, uuid, jsonb) to anon, authenticated;

select app._patch_function('public.platform_client_errors',
  $x$min(e.first_at) as first_at$x$,
  $x$(select string_agg(distinct e4.device, ', ') from public.client_errors e4 where e4.fingerprint = e.fingerprint and e4.day >= current_date - p_days and e4.device is not null) as devices,
           min(e.first_at) as first_at$x$);

drop function app._patch_function(text, text, text);

-- the Platform's device list carries the check of the client
create or replace function public.platform_device_guard(p_company uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  return (select device_guard from public.licenses where company_id = p_company);
end $$;
revoke execute on function public.platform_device_guard(uuid) from public, anon;
grant execute on function public.platform_device_guard(uuid) to authenticated;

-- ----------------------------------------------------------------------------- a local server checks the devices itself
-- the cloud gives a local server its client's devices (only the hashes of their keys) and the check
create or replace function public.licence_devices(p_code text, p_server uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.licenses;
begin
  l := app.backup_licence(p_code, p_server);
  return jsonb_build_object('guard', l.device_guard,
    'devices', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'number', d.number, 'name', d.name, 'kind', d.kind, 'status', d.status,
                 'secret_hash', d.secret_hash, 'lease_until', d.lease_until, 'fingerprint', d.fingerprint))
               from app.devices d where d.company_id = l.company_id), '[]'::jsonb));
end $$;
revoke execute on function public.licence_devices(text, uuid) from public;
grant execute on function public.licence_devices(text, uuid) to anon, authenticated;

-- the local server's worker keeps them (its own client, the one of its licence)
create or replace function public.local_devices_apply(p_code text, p jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare v_company uuid; n int;
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  -- a local server keeps its licence's code on its company (the cloud on the licence)
  v_company := coalesce((select company_id from public.licenses where code = upper(btrim(p_code))),
                        (select id from public.companies where licence_code = upper(btrim(p_code)) and deleted_at is null limit 1));
  if v_company is null then raise exception 'This licence code is not known' using errcode = 'P0002'; end if;
  update public.licenses set device_guard = coalesce(p ->> 'guard', device_guard) where company_id = v_company;
  insert into app.devices (id, company_id, number, name, kind, status, secret_hash, lease_until, fingerprint)
  select (x ->> 'id')::uuid, v_company, (x ->> 'number')::int, x ->> 'name', x ->> 'kind', x ->> 'status', x ->> 'secret_hash',
         (x ->> 'lease_until')::timestamptz, x ->> 'fingerprint'
    from jsonb_array_elements(coalesce(p -> 'devices', '[]')) x
  on conflict (id) do update set name = excluded.name, kind = excluded.kind, status = excluded.status, secret_hash = excluded.secret_hash,
    lease_until = excluded.lease_until, fingerprint = excluded.fingerprint, number = excluded.number;
  get diagnostics n = row_count;
  delete from app.devices where company_id = v_company
     and id not in (select (x ->> 'id')::uuid from jsonb_array_elements(coalesce(p -> 'devices', '[]')) x);
  return n;
end $$;
revoke execute on function public.local_devices_apply(text, jsonb) from public, anon, authenticated;
grant execute on function public.local_devices_apply(text, jsonb) to service_role;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';
