-- =============================================================================
-- DrisPRO · a licence for every computer
--   Every installation of the DrisPRO program (Windows, Mac) gets its own licence: a number (PC-0003),
--   a name, and what it is in the client's business: a till or administration (the office).
--   Within the client's limits a computer is licensed at once; beyond them, or when the Super Admin
--   asked to approve every computer of that client, it waits as a request until he approves it.
--   The program checks its licence when it opens and every few hours; a blocked computer does not
--   open. Programs installed before this register themselves on their next start, approved.
--   The Super Admin sees every computer of every client: its kind, the till it works at, its version,
--   when it was last seen.
-- =============================================================================

alter table public.licenses add column if not exists max_till_devices int;
alter table public.licenses add column if not exists max_office_devices int;
alter table public.licenses add column if not exists device_approval text not null default 'auto';
alter table public.licenses drop constraint if exists licenses_device_limits_check;
alter table public.licenses add constraint licenses_device_limits_check
  check ((max_till_devices is null or max_till_devices >= 0) and (max_office_devices is null or max_office_devices >= 0) and device_approval in ('auto', 'request'));
comment on column public.licenses.max_till_devices is 'computers licensed as tills (null = as many as its tills)';
comment on column public.licenses.max_office_devices is 'computers licensed for administration (null = no limit)';
comment on column public.licenses.device_approval is 'auto: a computer within the limits is licensed at once; request: every computer waits for the Super Admin';

create table if not exists app.devices (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  number           int not null,
  name             text not null,
  kind             text not null check (kind in ('till', 'office')),
  status           text not null default 'pending' check (status in ('active', 'pending', 'blocked')),
  secret_hash      text not null,
  hostname         text,
  os               text,
  os_user          text,
  platform         text,
  app_version      text,
  mode             text,
  server           text,
  fingerprint      text,
  first_ip         text,
  last_ip          text,
  migrated         boolean not null default false,
  note             text,
  register_id      uuid references public.pos_registers(id) on delete set null,
  register_seen_at timestamptz,
  created_at       timestamptz not null default now(),
  approved_at      timestamptz,
  approved_by      uuid,
  blocked_at       timestamptz,
  last_seen_at     timestamptz,
  unique (company_id, number)
);
create index if not exists devices_company_idx on app.devices (company_id, status);
revoke all on app.devices from public, anon, authenticated;
comment on table app.devices is 'a licence for every computer where the DrisPRO program is installed';

-- ----------------------------------------------------------------------------- the limits
create or replace function app.device_limits(p_company uuid)
returns table (till int, office int, approval text)
language sql stable security definer set search_path = '' as $$
  select coalesce(l.max_till_devices, l.max_registers), l.max_office_devices, l.device_approval
    from public.licenses l where l.company_id = p_company
$$;
revoke execute on function app.device_limits(uuid) from public, anon, authenticated;

create or replace function app.device_row(d app.devices)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', d.id, 'company_id', d.company_id, 'company', (select c.name from public.companies c where c.id = d.company_id),
    'number', d.number, 'label', 'PC-' || lpad(d.number::text, 4, '0'), 'name', d.name, 'kind', d.kind, 'status', d.status,
    'hostname', d.hostname, 'os', d.os, 'os_user', d.os_user, 'platform', d.platform, 'app_version', d.app_version, 'mode', d.mode, 'server', d.server,
    'last_ip', d.last_ip, 'migrated', d.migrated, 'note', d.note,
    'register', (select r.name from public.pos_registers r where r.id = d.register_id), 'register_seen_at', d.register_seen_at,
    'created_at', d.created_at, 'approved_at', d.approved_at, 'approved_by', (select email from auth.users where id = d.approved_by),
    'blocked_at', d.blocked_at, 'last_seen_at', d.last_seen_at)
$$;
revoke execute on function app.device_row(app.devices) from public, anon, authenticated;

-- where the program called from (the proxy's header), kept to tell computers apart
create or replace function app.request_ip() returns text language sql stable set search_path = '' as $$
  select nullif(btrim(split_part(coalesce((nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-forwarded-for'),
                                          (nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-real-ip'), ''), ',', 1)), '')
$$;

-- ----------------------------------------------------------------------------- the program activates this computer
-- with the client's licence code; the program keeps the device's id and secret (only its hash is here)
create or replace function public.device_activate(p_code text, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l public.licenses; d app.devices; v_kind text := coalesce(nullif(p ->> 'kind', ''), 'office'); v_secret text := p ->> 'secret';
  v_lim record; v_used int; v_status text; v_migrated boolean := coalesce((p ->> 'migrated')::boolean, false); v_id uuid := nullif(p ->> 'device_id', '')::uuid;
begin
  select * into l from public.licenses where code = upper(btrim(p_code));
  if l.company_id is null then raise exception 'This licence code is not known' using errcode = 'P0002'; end if;
  if l.status <> 'active' or current_date not between l.valid_from and l.valid_until then
    raise exception 'This licence is not active; ask your DrisPRO supplier' using errcode = '42501';
  end if;
  if v_kind not in ('till', 'office') then raise exception 'A computer is a till or administration' using errcode = '23514'; end if;
  if coalesce(length(v_secret), 0) < 32 then raise exception 'The program sent no key for this computer' using errcode = '23514'; end if;
  -- the same computer activating again (a new licence code of the same client, a reinstall that kept its settings)
  if v_id is not null then
    select * into d from app.devices where id = v_id and company_id = l.company_id;
    if d.id is not null then
      if d.secret_hash <> encode(extensions.digest(v_secret, 'sha256'), 'hex') then raise exception 'This computer is registered with another key' using errcode = '42501'; end if;
      update app.devices set kind = v_kind, name = coalesce(nullif(btrim(p ->> 'name'), ''), name), hostname = p ->> 'hostname', os = p ->> 'os', os_user = p ->> 'os_user',
             platform = p ->> 'platform', app_version = p ->> 'version', mode = p ->> 'mode', server = p ->> 'server', last_seen_at = now(), last_ip = app.request_ip()
       where id = d.id returning * into d;
      return app.device_row(d);
    end if;
  end if;
  -- too many requests waiting: someone is trying codes
  if (select count(*) from app.devices where company_id = l.company_id and status = 'pending') >= 20 then
    raise exception 'Too many computers are waiting for approval; ask your DrisPRO supplier' using errcode = '42501';
  end if;
  select * into v_lim from app.device_limits(l.company_id);
  select count(*) into v_used from app.devices where company_id = l.company_id and kind = v_kind and status = 'active';
  v_status := case
    when v_migrated then 'active'   -- installed before computers had licences: it keeps working
    when v_lim.approval = 'request' then 'pending'
    when (case v_kind when 'till' then v_lim.till else v_lim.office end) is null then 'active'
    when v_used < (case v_kind when 'till' then v_lim.till else v_lim.office end) then 'active'
    else 'pending' end;
  insert into app.devices (company_id, number, name, kind, status, secret_hash, hostname, os, os_user, platform, app_version, mode, server, fingerprint,
                           first_ip, last_ip, migrated, approved_at, last_seen_at)
  values (l.company_id, coalesce((select max(number) from app.devices where company_id = l.company_id), 0) + 1,
          coalesce(nullif(left(btrim(p ->> 'name'), 60), ''), nullif(p ->> 'hostname', ''), case v_kind when 'till' then 'Arka' else 'Administrata' end),
          v_kind, v_status, encode(extensions.digest(v_secret, 'sha256'), 'hex'), left(p ->> 'hostname', 120), left(p ->> 'os', 120), left(p ->> 'os_user', 120),
          left(p ->> 'platform', 30), left(p ->> 'version', 30), left(p ->> 'mode', 10), left(p ->> 'server', 200), left(p ->> 'fingerprint', 128),
          app.request_ip(), app.request_ip(), v_migrated, case when v_status = 'active' then now() end, now())
  returning * into d;
  perform app.platform_log(case when d.status = 'pending' then 'device_requested' else 'device_activated' end, d.company_id,
    jsonb_build_object('device', 'PC-' || lpad(d.number::text, 4, '0'), 'name', d.name, 'kind', d.kind, 'hostname', d.hostname, 'migrated', d.migrated));
  return app.device_row(d);
end $$;
revoke execute on function public.device_activate(text, jsonb) from public;
grant execute on function public.device_activate(text, jsonb) to anon, authenticated;

-- ----------------------------------------------------------------------------- the program checks its licence
create or replace function public.device_ping(p_device uuid, p_secret text, p jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d app.devices; l public.licenses;
begin
  select * into d from app.devices where id = p_device;
  if d.id is null or d.secret_hash <> encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') then
    return jsonb_build_object('status', 'unknown');
  end if;
  update app.devices set last_seen_at = now(), last_ip = coalesce(app.request_ip(), last_ip),
         app_version = coalesce(nullif(p ->> 'version', ''), app_version), hostname = coalesce(nullif(p ->> 'hostname', ''), hostname),
         os_user = coalesce(nullif(p ->> 'os_user', ''), os_user), mode = coalesce(nullif(p ->> 'mode', ''), mode), server = coalesce(nullif(p ->> 'server', ''), server)
   where id = d.id returning * into d;
  select * into l from public.licenses where company_id = d.company_id;
  return app.device_row(d) || jsonb_build_object('licence_ok', l.status = 'active' and current_date between l.valid_from and l.valid_until, 'valid_until', l.valid_until);
end $$;
revoke execute on function public.device_ping(uuid, text, jsonb) from public;
grant execute on function public.device_ping(uuid, text, jsonb) to anon, authenticated;

-- the till page tells which till this computer works at (seen in the console)
create or replace function public.device_at_register(p_device uuid, p_register uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.pos_registers;
begin
  select * into r from public.pos_registers where id = p_register;
  if r.id is null then return; end if;
  perform app.require_permission(r.company_id, 'pos.read');
  update app.devices set register_id = r.id, register_seen_at = now() where id = p_device and company_id = r.company_id;
end $$;
revoke execute on function public.device_at_register(uuid, uuid) from public, anon;
grant execute on function public.device_at_register(uuid, uuid) to authenticated;

-- ----------------------------------------------------------------------------- the Super Admin
create or replace function public.platform_devices(p_company uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  return jsonb_build_object(
    'devices', coalesce((select jsonb_agg(app.device_row(d) order by (d.status = 'pending') desc, d.company_id, d.number)
                           from app.devices d where p_company is null or d.company_id = p_company), '[]'::jsonb),
    'limits', case when p_company is not null then (select jsonb_build_object('till', x.till, 'office', x.office, 'approval', x.approval,
                     'max_till_devices', l.max_till_devices, 'max_office_devices', l.max_office_devices, 'max_registers', l.max_registers)
                     from app.device_limits(p_company) x, public.licenses l where l.company_id = p_company) end,
    'pending', (select count(*) from app.devices where status = 'pending'));
end $$;
revoke execute on function public.platform_devices(uuid) from public, anon;
grant execute on function public.platform_devices(uuid) to authenticated;

create or replace function public.platform_device_set(p_device uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare d app.devices; v_status text := nullif(p ->> 'status', ''); v_kind text := nullif(p ->> 'kind', '');
begin
  perform app.require_super_admin();
  select * into d from app.devices where id = p_device for update;
  if d.id is null then raise exception 'Computer not found' using errcode = 'P0002'; end if;
  if v_status is not null and v_status not in ('active', 'blocked', 'pending') then raise exception 'Unknown state' using errcode = '23514'; end if;
  if v_kind is not null and v_kind not in ('till', 'office') then raise exception 'A computer is a till or administration' using errcode = '23514'; end if;
  update app.devices set
    status = coalesce(v_status, status),
    kind = coalesce(v_kind, kind),
    name = coalesce(nullif(left(btrim(p ->> 'name'), 60), ''), name),
    note = case when p ? 'note' then nullif(btrim(p ->> 'note'), '') else note end,
    approved_at = case when v_status = 'active' and d.status <> 'active' then now() else approved_at end,
    approved_by = case when v_status = 'active' and d.status <> 'active' then auth.uid() else approved_by end,
    blocked_at = case when v_status = 'blocked' then now() when v_status = 'active' then null else blocked_at end
   where id = d.id;
  if v_status is not null and v_status <> d.status then
    perform app.platform_log(case v_status when 'active' then 'device_approved' when 'blocked' then 'device_blocked' else 'device_changed' end, d.company_id,
      jsonb_build_object('device', 'PC-' || lpad(d.number::text, 4, '0'), 'name', d.name, 'kind', coalesce(v_kind, d.kind)));
  end if;
end $$;
revoke execute on function public.platform_device_set(uuid, jsonb) from public, anon;
grant execute on function public.platform_device_set(uuid, jsonb) to authenticated;

create or replace function public.platform_device_delete(p_device uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare d app.devices;
begin
  perform app.require_super_admin();
  delete from app.devices where id = p_device returning * into d;
  if d.id is null then raise exception 'Computer not found' using errcode = 'P0002'; end if;
  perform app.platform_log('device_removed', d.company_id, jsonb_build_object('device', 'PC-' || lpad(d.number::text, 4, '0'), 'name', d.name));
end $$;
revoke execute on function public.platform_device_delete(uuid) from public, anon;
grant execute on function public.platform_device_delete(uuid) to authenticated;

create or replace function public.platform_device_limits(p_company uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  update public.licenses set
    max_till_devices = case when p ? 'max_till_devices' then nullif(p ->> 'max_till_devices', '')::int else max_till_devices end,
    max_office_devices = case when p ? 'max_office_devices' then nullif(p ->> 'max_office_devices', '')::int else max_office_devices end,
    device_approval = coalesce(nullif(p ->> 'approval', ''), device_approval),
    updated_by = auth.uid(), updated_at = now()
   where company_id = p_company;
  if not found then raise exception 'Client not found' using errcode = 'P0002'; end if;
end $$;
revoke execute on function public.platform_device_limits(uuid, jsonb) from public, anon;
grant execute on function public.platform_device_limits(uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------------------- the packages give the office computers their limit
create or replace function app.package_office_devices(p_package text) returns int language sql immutable set search_path = '' as $$
  select case p_package when 'retail_mini' then 2 when 'retail_market' then 5 when 'retail_chain' then null when 'cafe' then 2 when 'restaurant' then 3
    when 'wholesale' then 5 when 'manufacturing' then 5 when 'services' then 5 when 'hotel' then 3 when 'beauty' then 2 when 'clinic' then 3
    when 'auto_service' then 2 when 'fitness' then 2 else null end
$$;
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
select app._patch_function('public.platform_set_package',
  $x$         max_warehouses = v_stores, max_registers = v_tills, max_users = v_users, updated_by = auth.uid(), updated_at = now()$x$,
  $x$         max_warehouses = v_stores, max_registers = v_tills, max_users = v_users, updated_by = auth.uid(), updated_at = now(),
         max_office_devices = case when p ? 'max_office_devices' then nullif(p ->> 'max_office_devices', '')::int
                                   when package is distinct from v_pkg then app.package_office_devices(v_pkg) else max_office_devices end$x$);
-- the licence's log keeps these too
select app._patch_function('app.tg_licence_log',
  $x$'ai_reads_limit', 'ai_chat_limit', 'notes'];$x$,
  $x$'ai_reads_limit', 'ai_chat_limit', 'notes', 'package', 'max_registers', 'max_till_devices', 'max_office_devices', 'device_approval'];$x$);
-- the console's client list: the computers each client has
select app._patch_function('public.platform_clients',
  $x$               'modules', to_jsonb(app.company_features(c.id)), 'valid_from'$x$,
  $x$               'modules', to_jsonb(app.company_features(c.id)),
               'devices', (select jsonb_build_object('till', count(*) filter (where d.kind = 'till' and d.status = 'active'),
                                   'office', count(*) filter (where d.kind = 'office' and d.status = 'active'), 'pending', count(*) filter (where d.status = 'pending'))
                             from app.devices d where d.company_id = c.id), 'valid_from'$x$);
drop function app._patch_function(text, text, text);

notify pgrst, 'reload schema';
