-- =============================================================================
-- DrisPRO · for people who do not know computers
--   1. The simple view: a start screen with a few large buttons for the person's own work and no
--      menus. Automatic for those who only sell, receive goods or count (no reports, no settings);
--      the administrator can switch it on or off per person.
--   2. A shared till: the administrator marks a computer as shared; there people sign in by tapping
--      their name and typing a 4–6 digit PIN, no email or password. The server checks the PIN
--      (5 wrong tries lock that person for 10 minutes) and the postier, which holds the server key,
--      asks the sign-in service for a one-time code that the till turns into a session.
-- =============================================================================

alter table public.company_members add column view_mode text not null default 'auto' check (view_mode in ('auto', 'simple', 'full'));

create table app.member_pins (
  member_id    uuid primary key references public.company_members(id) on delete cascade,
  pin_hash     text not null,
  failed       int not null default 0,
  locked_until timestamptz,
  set_at       timestamptz not null default now()
);
create table app.shared_devices (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  name         text not null,
  token_hash   text not null unique,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create table app.pin_logins (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null references app.shared_devices(id) on delete cascade,
  user_id     uuid not null,
  email       text not null,
  secret_hash text not null,
  status      text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'used')),
  otp         text,
  error       text,
  created_at  timestamptz not null default now()
);
revoke all on app.member_pins, app.shared_devices, app.pin_logins from public, anon, authenticated;

-- ---------------------------------------------------------------- the simple view
-- automatic: on for people whose roles neither read reports nor change settings
create or replace function app.member_simple(p_member uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select case m.view_mode when 'simple' then true when 'full' then false else
           not exists (select 1 from public.member_roles mr join public.role_permissions rp on rp.role_id = mr.role_id
                        where mr.member_id = m.id and (rp.permission in ('*', 'reports.read', 'admin.read', 'admin.write', 'admin.*')
                              or rp.permission like 'finance.%' or rp.permission like 'procurement.%'))
         end
    from public.company_members m where m.id = p_member
$$;

create or replace function public.member_extras(p_company uuid)
returns table (member_id uuid, view_mode text, simple boolean, has_pin boolean, pin_locked boolean)
language sql stable security definer set search_path = '' as $$
  select m.id, m.view_mode, app.member_simple(m.id), p.member_id is not null, coalesce(p.locked_until > now(), false)
    from public.company_members m left join app.member_pins p on p.member_id = m.id
   where m.company_id = p_company and m.deleted_at is null and app.has_permission(p_company, 'admin.read')
$$;
grant execute on function public.member_extras(uuid) to authenticated;

create or replace function public.member_set_view(p_member uuid, p_mode text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_company uuid;
begin
  select company_id into v_company from public.company_members where id = p_member and deleted_at is null;
  if v_company is null then raise exception 'Person not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_company, 'admin.write');
  if p_mode not in ('auto', 'simple', 'full') then raise exception 'Unknown view' using errcode = '22023'; end if;
  update public.company_members set view_mode = p_mode where id = p_member;
end $$;
grant execute on function public.member_set_view(uuid, text) to authenticated;

-- the context of the app says, per company, whether this person starts in the simple view
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;
select app._patch_function('public.get_my_context',
  $x$'is_training', c.is_training, 'business_type', c.business_type,$x$,
  $x$'is_training', c.is_training, 'business_type', c.business_type, 'simple_view', coalesce(app.member_simple(m.id), false),$x$);
drop function app._patch_function(text, text, text);

-- ---------------------------------------------------------------- PINs
-- the administrator for anyone in the company, or a person for themselves
create or replace function public.member_set_pin(p_member uuid, p_pin text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.company_members;
begin
  select * into m from public.company_members where id = p_member and deleted_at is null;
  if m.id is null then raise exception 'Person not found' using errcode = 'P0002'; end if;
  if m.user_id is distinct from auth.uid() then perform app.require_permission(m.company_id, 'admin.write'); end if;
  if m.user_id is null then raise exception 'This person has not joined yet: they need to accept the invitation first' using errcode = '55000'; end if;
  if p_pin is null then delete from app.member_pins where member_id = p_member; return; end if;
  if p_pin !~ '^\d{4,6}$' then raise exception 'The PIN has 4 to 6 digits' using errcode = '22023'; end if;
  if p_pin ~ '^(\d)\1+$' or p_pin in ('1234', '12345', '123456', '4321', '0123') then raise exception 'Choose a PIN that is harder to guess' using errcode = '22023'; end if;
  insert into app.member_pins (member_id, pin_hash) values (p_member, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)))
  on conflict (member_id) do update set pin_hash = excluded.pin_hash, failed = 0, locked_until = null, set_at = now();
end $$;
grant execute on function public.member_set_pin(uuid, text) to authenticated;

-- ---------------------------------------------------------------- shared tills
create or replace function public.shared_device_register(p_company uuid, p_name text)
returns text language plpgsql security definer set search_path = '' as $$
declare v_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  perform app.require_permission(p_company, 'admin.write');
  if coalesce(btrim(p_name), '') = '' then raise exception 'Give the computer a name, e.g. Arka 1' using errcode = '22023'; end if;
  insert into app.shared_devices (company_id, name, token_hash, created_by)
  values (p_company, left(btrim(p_name), 60), encode(extensions.digest(v_token, 'sha256'), 'hex'), auth.uid());
  return v_token;
end $$;
grant execute on function public.shared_device_register(uuid, text) to authenticated;

create or replace function public.shared_devices(p_company uuid)
returns table (id uuid, name text, created_at timestamptz, last_used_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'admin.read');
  return query select d.id, d.name, d.created_at, d.last_used_at from app.shared_devices d
    where d.company_id = p_company and d.revoked_at is null order by d.created_at;
end $$;
grant execute on function public.shared_devices(uuid) to authenticated;

create or replace function public.shared_device_revoke(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_company uuid;
begin
  select company_id into v_company from app.shared_devices where id = p_id;
  if v_company is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_company, 'admin.write');
  update app.shared_devices set revoked_at = now() where id = p_id;
end $$;
grant execute on function public.shared_device_revoke(uuid) to authenticated;

create or replace function app.shared_device(p_token text)
returns app.shared_devices language sql stable security definer set search_path = '' as $$
  select * from app.shared_devices
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and revoked_at is null
$$;

-- before anyone is signed in: who can sign in on this till (names only)
create or replace function public.shared_device_people(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d app.shared_devices;
begin
  d := app.shared_device(p_token);
  if d.id is null then return null; end if;
  if not app.license_ok(d.company_id) then raise exception 'This company''s licence is not active' using errcode = '42501'; end if;
  return jsonb_build_object('device', d.name, 'company', (select name from public.companies where id = d.company_id),
    'people', coalesce((select jsonb_agg(jsonb_build_object('member_id', m.id, 'name', coalesce(nullif(p.full_name, ''), split_part(u.email, '@', 1)))
                                     order by coalesce(nullif(p.full_name, ''), u.email))
                          from public.company_members m join app.member_pins pin on pin.member_id = m.id
                          join auth.users u on u.id = m.user_id left join public.profiles p on p.id = m.user_id
                         where m.company_id = d.company_id and m.status = 'active' and m.deleted_at is null), '[]'::jsonb));
end $$;
grant execute on function public.shared_device_people(text) to anon, authenticated;

-- the PIN is checked here; only then the postier is asked for a sign-in code
create or replace function public.pin_login(p_token text, p_member uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d app.shared_devices; m public.company_members; pin app.member_pins; v_secret text := encode(extensions.gen_random_bytes(18), 'hex');
  v_id uuid; v_email text;
begin
  d := app.shared_device(p_token);
  if d.id is null then raise exception 'This computer is no longer a shared till; sign in with email' using errcode = '42501'; end if;
  select * into m from public.company_members where id = p_member and company_id = d.company_id and status = 'active' and deleted_at is null;
  select * into pin from app.member_pins where member_id = m.id for update;
  if m.id is null or pin.member_id is null then raise exception 'Wrong PIN' using errcode = '28000'; end if;
  if pin.locked_until > now() then
    raise exception 'Too many wrong PINs; try again in % minutes', ceil(extract(epoch from pin.locked_until - now()) / 60)::int using errcode = '28000';
  end if;
  if pin.pin_hash <> extensions.crypt(coalesce(p_pin, ''), pin.pin_hash) then
    update app.member_pins set failed = failed + 1, locked_until = case when failed + 1 >= 5 then now() + interval '10 minutes' end where member_id = m.id;
    -- the lock must survive the error, so the wrong try is not rolled back with it
    return jsonb_build_object('error', case when pin.failed + 1 >= 5 then 'Too many wrong PINs; try again in 10 minutes' else 'Wrong PIN' end);
  end if;
  update app.member_pins set failed = 0, locked_until = null where member_id = m.id;
  select email into v_email from auth.users where id = m.user_id;
  update app.shared_devices set last_used_at = now() where id = d.id;
  insert into app.pin_logins (device_id, user_id, email, secret_hash) values (d.id, m.user_id, v_email, encode(extensions.digest(v_secret, 'sha256'), 'hex'))
  returning id into v_id;
  update public.profiles set last_company_id = d.company_id where id = m.user_id;
  return jsonb_build_object('request', v_id, 'secret', v_secret);
end $$;
grant execute on function public.pin_login(text, uuid, text) to anon, authenticated;

-- the till waits for the code (a few hundred ms); it is handed out once
create or replace function public.pin_login_result(p_request uuid, p_secret text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r app.pin_logins;
begin
  select * into r from app.pin_logins where id = p_request and secret_hash = encode(extensions.digest(coalesce(p_secret, ''), 'sha256'), 'hex') for update;
  if r.id is null or r.created_at < now() - interval '2 minutes' then return jsonb_build_object('status', 'failed', 'error', 'Sign in again'); end if;
  if r.status = 'done' then
    update app.pin_logins set status = 'used', otp = null where id = r.id;
    return jsonb_build_object('status', 'done', 'email', r.email, 'otp', r.otp);
  end if;
  return jsonb_build_object('status', r.status, 'error', r.error);
end $$;
grant execute on function public.pin_login_result(uuid, text) to anon, authenticated;

-- for the postier
create or replace function public.pin_wait(p_wait_ms int default 6000)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r app.pin_logins; v_until timestamptz := clock_timestamp() + make_interval(secs => least(coalesce(p_wait_ms, 6000), 20000) / 1000.0);
begin
  if auth.uid() is not null then raise exception 'Only the server runs this' using errcode = '42501'; end if;
  loop
    select * into r from app.pin_logins where status = 'queued' and created_at > now() - interval '1 minute' order by created_at limit 1 for update skip locked;
    exit when r.id is not null or clock_timestamp() > v_until;
    perform pg_sleep(0.1);
  end loop;
  if r.id is null then return null; end if;
  update app.pin_logins set status = 'running' where id = r.id;
  return jsonb_build_object('id', r.id, 'email', r.email);
end $$;
revoke execute on function public.pin_wait(int) from public, anon, authenticated;
grant execute on function public.pin_wait(int) to service_role;

create or replace function public.pin_done(p_id uuid, p_ok boolean, p_otp text default null, p_error text default null)
returns void language sql security definer set search_path = '' as $$
  update app.pin_logins set status = case when p_ok then 'done' else 'failed' end, otp = p_otp, error = left(p_error, 300)
   where id = p_id and status = 'running' and auth.uid() is null
$$;
revoke execute on function public.pin_done(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.pin_done(uuid, boolean, text, text) to service_role;

-- old requests do not stay
create or replace function app.pin_logins_cleanup()
returns void language sql security definer set search_path = '' as $$
  delete from app.pin_logins where created_at < now() - interval '1 day'
$$;
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;
select app._patch_function('public.automation_tick',
  $x$  perform app.assistant_cleanup();$x$,
  $x$  perform app.assistant_cleanup();
  perform app.pin_logins_cleanup();$x$);
drop function app._patch_function(text, text, text);
