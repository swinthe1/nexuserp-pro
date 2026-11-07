-- =============================================================================
-- DrisPRO · help at a distance, step 1: DrisPRO's support sees the client's screen
--   In the console the Super Admin presses "Connect" on a licensed computer. The program on that
--   computer is told through its own unguessable channel, checks with the server that the request is
--   real, and asks the person at the computer; only if she accepts does it share the screen, straight
--   to the Super Admin's browser (WebRTC: encrypted from computer to computer; STUN/TURN as set here).
--   While shared, a bar on the client's screen says who sees it and stops it with one click.
--   Every session is kept: who, which computer, when it was asked, accepted or refused, how long.
-- =============================================================================

alter table app.devices add column if not exists channel text not null default encode(extensions.gen_random_bytes(16), 'hex');

create table if not exists app.support_sessions (
  id           uuid primary key default gen_random_uuid(),
  device_id    uuid not null references app.devices(id) on delete cascade,
  company_id   uuid not null references public.companies(id) on delete cascade,
  mode         text not null default 'view' check (mode in ('view', 'control')),
  status       text not null default 'requested' check (status in ('requested', 'accepted', 'declined', 'ended', 'failed', 'expired')),
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  answered_at  timestamptz,
  ended_at     timestamptz,
  ended_by     text,
  note         text
);
create index if not exists support_sessions_device_idx on app.support_sessions (device_id, requested_at desc);
create index if not exists support_sessions_company_idx on app.support_sessions (company_id, requested_at desc);
revoke all on app.support_sessions from public, anon, authenticated;

-- where the two computers find each other: STUN, and a TURN server for networks that do not let them meet
create table if not exists app.support_settings (
  id              boolean primary key default true check (id),
  stun_url        text not null default 'stun:stun.l.google.com:19302',
  turn_url        text,
  turn_username   text,
  turn_credential text,
  updated_at      timestamptz not null default now()
);
insert into app.support_settings (id) values (true) on conflict do nothing;
revoke all on app.support_settings from public, anon, authenticated;

create or replace function app.support_ice() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_array(jsonb_build_object('urls', s.stun_url))
         || case when s.turn_url is not null then jsonb_build_array(jsonb_build_object('urls', s.turn_url, 'username', s.turn_username, 'credential', s.turn_credential)) else '[]'::jsonb end
    from app.support_settings s
$$;
revoke execute on function app.support_ice() from public, anon, authenticated;

-- the program learns its channel with its licence
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
select app._patch_function('public.device_ping',
  $x$  return app.device_row(d) || jsonb_build_object('licence_ok',$x$,
  $x$  return app.device_row(d) || jsonb_build_object('channel', d.channel, 'licence_ok',$x$);
select app._patch_function('public.device_activate',
  $x$      return app.device_row(d);
    end if;
  end if;$x$,
  $x$      return app.device_row(d) || jsonb_build_object('channel', d.channel);
    end if;
  end if;$x$);
select app._patch_function('public.device_activate',
  $x$    jsonb_build_object('device', 'PC-' || lpad(d.number::text, 4, '0'), 'name', d.name, 'kind', d.kind, 'hostname', d.hostname, 'migrated', d.migrated));
  return app.device_row(d);$x$,
  $x$    jsonb_build_object('device', 'PC-' || lpad(d.number::text, 4, '0'), 'name', d.name, 'kind', d.kind, 'hostname', d.hostname, 'migrated', d.migrated));
  return app.device_row(d) || jsonb_build_object('channel', d.channel);$x$);
drop function app._patch_function(text, text, text);

-- ----------------------------------------------------------------------------- the Super Admin asks
create or replace function public.platform_support_start(p_device uuid, p_mode text default 'view')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d app.devices; v_id uuid;
begin
  perform app.require_super_admin();
  select * into d from app.devices where id = p_device;
  if d.id is null then raise exception 'Computer not found' using errcode = 'P0002'; end if;
  if d.status <> 'active' then raise exception 'This computer has no licence' using errcode = '55000'; end if;
  if p_mode not in ('view', 'control') then raise exception 'Unknown mode' using errcode = '23514'; end if;
  -- an older request to the same computer still waiting is closed
  update app.support_sessions set status = 'expired', ended_at = now(), ended_by = 'admin' where device_id = d.id and status = 'requested';
  insert into app.support_sessions (device_id, company_id, mode, requested_by) values (d.id, d.company_id, p_mode, auth.uid()) returning id into v_id;
  perform app.platform_log('support_requested', d.company_id, jsonb_build_object('device', 'PC-' || lpad(d.number::text, 4, '0'), 'name', d.name, 'mode', p_mode));
  return jsonb_build_object('session', v_id, 'channel', d.channel, 'ice', app.support_ice(), 'mode', p_mode,
    'device', app.device_row(d), 'who', coalesce((select full_name from public.profiles where id = auth.uid()), (select email from auth.users where id = auth.uid())));
end $$;
revoke execute on function public.platform_support_start(uuid, text) from public, anon;
grant execute on function public.platform_support_start(uuid, text) to authenticated;

create or replace function public.platform_support_end(p_session uuid, p_status text default 'ended', p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare s app.support_sessions;
begin
  perform app.require_super_admin();
  select * into s from app.support_sessions where id = p_session for update;
  if s.id is null then raise exception 'Session not found' using errcode = 'P0002'; end if;
  if s.status in ('ended', 'declined', 'failed', 'expired') then return; end if;
  update app.support_sessions set status = case when p_status = 'failed' then 'failed' when s.status = 'requested' then 'expired' else 'ended' end,
         ended_at = now(), ended_by = 'admin', note = coalesce(nullif(btrim(p_note), ''), note)
   where id = s.id;
  perform app.platform_log('support_ended', s.company_id, jsonb_build_object('session', s.id,
    'minutes', case when s.answered_at is not null then round(extract(epoch from now() - s.answered_at) / 60.0, 1) end));
end $$;
revoke execute on function public.platform_support_end(uuid, text, text) from public, anon;
grant execute on function public.platform_support_end(uuid, text, text) to authenticated;

create or replace function public.platform_support_sessions(p_company uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'device', 'PC-' || lpad(d.number::text, 4, '0'), 'device_name', d.name, 'kind', d.kind,
      'company', (select c.name from public.companies c where c.id = s.company_id), 'company_id', s.company_id, 'mode', s.mode, 'status', s.status,
      'by', coalesce((select full_name from public.profiles where id = s.requested_by), (select email from auth.users where id = s.requested_by)),
      'requested_at', s.requested_at, 'answered_at', s.answered_at, 'ended_at', s.ended_at, 'ended_by', s.ended_by, 'note', s.note,
      'minutes', case when s.answered_at is not null and s.ended_at is not null then round(extract(epoch from s.ended_at - s.answered_at) / 60.0, 1) end)
      order by s.requested_at desc)
    from (select * from app.support_sessions x where p_company is null or x.company_id = p_company order by x.requested_at desc limit 300) s
    join app.devices d on d.id = s.device_id), '[]'::jsonb);
end $$;
revoke execute on function public.platform_support_sessions(uuid) from public, anon;
grant execute on function public.platform_support_sessions(uuid) to authenticated;

create or replace function public.platform_support_settings(p jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s app.support_settings;
begin
  perform app.require_super_admin();
  if p is not null then
    update app.support_settings set
      stun_url = coalesce(nullif(btrim(p ->> 'stun_url'), ''), stun_url),
      turn_url = case when p ? 'turn_url' then nullif(btrim(p ->> 'turn_url'), '') else turn_url end,
      turn_username = case when p ? 'turn_username' then nullif(btrim(p ->> 'turn_username'), '') else turn_username end,
      turn_credential = case when p ? 'turn_credential' then nullif(p ->> 'turn_credential', '') else turn_credential end,
      updated_at = now();
  end if;
  select * into s from app.support_settings;
  return jsonb_build_object('stun_url', s.stun_url, 'turn_url', s.turn_url, 'turn_username', s.turn_username, 'has_turn_credential', s.turn_credential is not null);
end $$;
revoke execute on function public.platform_support_settings(jsonb) from public, anon;
grant execute on function public.platform_support_settings(jsonb) to authenticated;

-- ----------------------------------------------------------------------------- the program checks the request and answers
-- a request is real only if the server made it for this computer, a moment ago
create or replace function public.device_support_check(p_device uuid, p_secret text, p_session uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d app.devices; s app.support_sessions;
begin
  select * into d from app.devices where id = p_device;
  if d.id is null or d.status <> 'active' or d.secret_hash <> encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') then
    return jsonb_build_object('ok', false);
  end if;
  select * into s from app.support_sessions where id = p_session and device_id = d.id;
  if s.id is null or s.status <> 'requested' or s.requested_at < now() - interval '3 minutes' then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'mode', s.mode, 'ice', app.support_ice(),
    'who', coalesce((select full_name from public.profiles where id = s.requested_by), (select email from auth.users where id = s.requested_by)), 'org', 'DrisPRO');
end $$;
revoke execute on function public.device_support_check(uuid, text, uuid) from public;
grant execute on function public.device_support_check(uuid, text, uuid) to anon, authenticated;

create or replace function public.device_support_event(p_device uuid, p_secret text, p_session uuid, p_event text)
returns void language plpgsql security definer set search_path = '' as $$
declare d app.devices; s app.support_sessions;
begin
  select * into d from app.devices where id = p_device;
  if d.id is null or d.secret_hash <> encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') then return; end if;
  select * into s from app.support_sessions where id = p_session and device_id = d.id for update;
  if s.id is null then return; end if;
  if p_event = 'accepted' and s.status = 'requested' then
    update app.support_sessions set status = 'accepted', answered_at = now() where id = s.id;
    perform app.platform_log('support_accepted', s.company_id, jsonb_build_object('session', s.id, 'device', 'PC-' || lpad(d.number::text, 4, '0')));
  elsif p_event = 'declined' and s.status = 'requested' then
    update app.support_sessions set status = 'declined', answered_at = now(), ended_at = now(), ended_by = 'client' where id = s.id;
    perform app.platform_log('support_declined', s.company_id, jsonb_build_object('session', s.id, 'device', 'PC-' || lpad(d.number::text, 4, '0')));
  elsif p_event = 'ended' and s.status in ('requested', 'accepted') then
    update app.support_sessions set status = case when s.status = 'requested' then 'expired' else 'ended' end, ended_at = now(), ended_by = 'client' where id = s.id;
    perform app.platform_log('support_ended', s.company_id, jsonb_build_object('session', s.id, 'by', 'client',
      'minutes', case when s.answered_at is not null then round(extract(epoch from now() - s.answered_at) / 60.0, 1) end));
  end if;
end $$;
revoke execute on function public.device_support_event(uuid, text, uuid, text) from public;
grant execute on function public.device_support_event(uuid, text, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
