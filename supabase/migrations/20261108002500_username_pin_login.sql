-- =============================================================================
-- DrisPRO · signing in with a user name and a PIN, no email (the owner's decision, 8.11.2026)
--   · Every person of a company signs in with a user name (unique in the whole program) and a PIN
--     of 6 digits, from any device. Five wrong PINs lock the name for 10 minutes, ten for an hour.
--   · The company's owner (admin.write) makes the people: name, user name, PIN, roles. They need no
--     email: the account carries an address of its own that nobody writes to.
--   · Once a person has a user name and PIN, their old email password stops working (it is replaced
--     by a random one), so the PIN is the only way in. The platform's administrator keeps email.
--   · The shared till takes the same PIN: tap the name, type the PIN.
-- =============================================================================

create table if not exists app.user_logins (
  user_id      uuid primary key references auth.users(id) on delete cascade deferrable initially immediate,
  username     text not null check (username ~ '^[a-z0-9][a-z0-9._-]{2,29}$'),
  pin_hash     text not null,
  failed       int not null default 0,
  locked_until timestamptz,
  set_by       uuid,
  set_at       timestamptz not null default now()
);
create unique index if not exists user_logins_username_key on app.user_logins (username);
revoke all on app.user_logins from public, anon, authenticated;

-- a sign-in by user name comes from no particular device
alter table app.pin_logins alter column device_id drop not null;

-- a user name as it is kept: small letters, no spaces around
create or replace function app.username_of(p text)
returns text language sql immutable set search_path = '' as $$ select lower(btrim(coalesce(p, ''))) $$;

-- a PIN good enough to be the only key: six digits, not all the same, not a straight run
create or replace function app.check_login_pin(p_pin text)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if coalesce(p_pin, '') !~ '^\d{6}$' then raise exception 'The PIN is 6 digits' using errcode = '23514'; end if;
  if p_pin ~ '^(\d)\1{5}$' or position(p_pin in '0123456789') > 0 or position(p_pin in '9876543210') > 0 then
    raise exception 'This PIN is too easy to guess: choose another' using errcode = '23514';
  end if;
end $$;

-- set (or change) a person's user name and PIN; their email password then no longer opens the program
create or replace function app.set_user_login(p_user uuid, p_username text, p_pin text, p_by uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_name text := app.username_of(p_username); v_old app.user_logins;
begin
  select * into v_old from app.user_logins where user_id = p_user for update;
  if v_name = '' then v_name := v_old.username; end if;
  if v_name is null or v_name !~ '^[a-z0-9][a-z0-9._-]{2,29}$' then
    raise exception 'The user name is 3 to 30 letters or digits (a dot, a dash or _ also)' using errcode = '23514';
  end if;
  if exists (select 1 from app.user_logins where username = v_name and user_id <> p_user) then
    raise exception 'The user name % is taken: choose another', v_name using errcode = '23505';
  end if;
  if p_pin is not null then perform app.check_login_pin(p_pin); end if;
  if v_old.user_id is null and p_pin is null then raise exception 'Give a PIN too' using errcode = '23514'; end if;
  insert into app.user_logins (user_id, username, pin_hash, set_by)
  values (p_user, v_name, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), p_by)
  on conflict (user_id) do update set username = excluded.username,
    pin_hash = case when p_pin is null then app.user_logins.pin_hash else excluded.pin_hash end,
    failed = case when p_pin is null then app.user_logins.failed else 0 end,
    locked_until = case when p_pin is null then app.user_logins.locked_until end,
    set_by = excluded.set_by, set_at = now();
  -- the email password stops working (not for the platform's administrator)
  if not coalesce((select is_super_admin from public.profiles where id = p_user), false)
     and exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password') then
    execute 'update auth.users set encrypted_password = extensions.crypt(encode(extensions.gen_random_bytes(24), ''hex''), extensions.gen_salt(''bf'')) where id = $1'
      using p_user;
  end if;
end $$;
revoke execute on function app.set_user_login(uuid, text, text, uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------ signing in
create or replace function public.login_with_pin(p_username text, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare l app.user_logins; v_secret text := encode(extensions.gen_random_bytes(18), 'hex'); v_id uuid; v_email text; v_fail int;
begin
  select * into l from app.user_logins where username = app.username_of(p_username) for update;
  if l.user_id is null then
    -- as slow as a real try, so a wrong name and a wrong PIN look the same
    perform extensions.crypt(coalesce(p_pin, ''), extensions.gen_salt('bf', 8));
    return jsonb_build_object('error', 'Wrong user name or PIN');
  end if;
  if l.locked_until > now() then
    return jsonb_build_object('error', format('Too many wrong PINs; try again in %s minutes', ceil(extract(epoch from l.locked_until - now()) / 60)::int));
  end if;
  if l.pin_hash <> extensions.crypt(coalesce(p_pin, ''), l.pin_hash) then
    v_fail := l.failed + 1;
    update app.user_logins set failed = v_fail,
      locked_until = case when v_fail >= 10 then now() + interval '60 minutes' when v_fail >= 5 then now() + interval '10 minutes' end
     where user_id = l.user_id;
    return jsonb_build_object('error', case when v_fail >= 10 then 'Too many wrong PINs; try again in 60 minutes'
                                            when v_fail >= 5 then 'Too many wrong PINs; try again in 10 minutes' else 'Wrong user name or PIN' end);
  end if;
  -- the person still works somewhere
  if not exists (select 1 from public.company_members m where m.user_id = l.user_id and m.status = 'active' and m.deleted_at is null)
     and not coalesce((select is_super_admin from public.profiles where id = l.user_id), false) then
    return jsonb_build_object('error', 'This user has no access to any company any more');
  end if;
  update app.user_logins set failed = 0, locked_until = null where user_id = l.user_id;
  select email into v_email from auth.users where id = l.user_id;
  insert into app.pin_logins (device_id, user_id, email, secret_hash) values (null, l.user_id, v_email, encode(extensions.digest(v_secret, 'sha256'), 'hex'))
  returning id into v_id;
  return jsonb_build_object('request', v_id, 'secret', v_secret);
end $$;
revoke execute on function public.login_with_pin(text, text) from public;
grant execute on function public.login_with_pin(text, text) to anon, authenticated;

-- ------------------------------------------------------------------ the owner makes and keeps the people
create or replace function public.company_user_create(p_company uuid, p_name text, p_username text, p_pin text, p_role_keys text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_member uuid; v_name text := app.username_of(p_username);
begin
  perform app.require_permission(p_company, 'admin.write');
  if coalesce(btrim(p_name), '') = '' then raise exception 'Write the person''s name' using errcode = '23514'; end if;
  if cardinality(coalesce(p_role_keys, '{}')) = 0 then raise exception 'Give the person at least one role' using errcode = '23514'; end if;
  if exists (select 1 from public.roles where key = any (p_role_keys) and (company_id is null or company_id = p_company) and not is_assignable) then
    raise exception 'Role cannot be assigned within a company' using errcode = '42501';
  end if;
  if v_name !~ '^[a-z0-9][a-z0-9._-]{2,29}$' then raise exception 'The user name is 3 to 30 letters or digits (a dot, a dash or _ also)' using errcode = '23514'; end if;
  if exists (select 1 from app.user_logins where username = v_name) then raise exception 'The user name % is taken: choose another', v_name using errcode = '23505'; end if;
  perform app.check_login_pin(p_pin);
  perform app.require_seat(p_company);
  -- an address of its own that nobody writes to: the sign-in needs one
  v_user := app.create_auth_user('u-' || replace(gen_random_uuid()::text, '-', '') || '@pin.dris-ks.com',
                                 encode(extensions.gen_random_bytes(24), 'hex'), btrim(p_name));
  update public.profiles set full_name = btrim(p_name), last_company_id = p_company where id = v_user;
  perform app.set_user_login(v_user, v_name, p_pin, auth.uid());
  insert into public.company_members (company_id, user_id, invited_email, status, joined_at)
  values (p_company, v_user, null, 'active', now())
  returning id into v_member;
  insert into public.member_roles (company_id, member_id, role_id)
  select p_company, v_member, r.id from public.roles r where r.key = any (p_role_keys) and (r.company_id is null or r.company_id = p_company);
  return v_member;
end $$;
revoke execute on function public.company_user_create(uuid, text, text, text, text[]) from public, anon;
grant execute on function public.company_user_create(uuid, text, text, text, text[]) to authenticated;

-- the owner gives a person of the company a user name and/or a new PIN (and unlocks them)
create or replace function public.member_login_set(p_member uuid, p_username text default null, p_pin text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.company_members;
begin
  select * into m from public.company_members where id = p_member and deleted_at is null;
  if m.id is null or m.user_id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  perform app.require_permission(m.company_id, 'admin.write');
  -- the platform's administrator is not changed from a company
  if coalesce((select is_super_admin from public.profiles where id = m.user_id), false) and m.user_id <> auth.uid() then
    raise exception 'This person is the platform administrator' using errcode = '42501';
  end if;
  -- a person who also works for another company: only they (or the platform) change their PIN
  if m.user_id <> auth.uid() and exists (select 1 from public.company_members x where x.user_id = m.user_id and x.company_id <> m.company_id
                                           and x.status = 'active' and x.deleted_at is null) then
    raise exception 'This person also works for another company: they change their own PIN' using errcode = '42501';
  end if;
  perform app.set_user_login(m.user_id, coalesce(p_username, ''), nullif(p_pin, ''), auth.uid());
end $$;
revoke execute on function public.member_login_set(uuid, text, text) from public, anon;
grant execute on function public.member_login_set(uuid, text, text) to authenticated;

-- my own user name and PIN (the first time without the old PIN, after that with it)
create or replace function public.my_login_set(p_username text, p_pin text, p_old_pin text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare l app.user_logins;
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  select * into l from app.user_logins where user_id = auth.uid();
  if l.user_id is not null and l.pin_hash <> extensions.crypt(coalesce(p_old_pin, ''), l.pin_hash) then
    raise exception 'The present PIN is not right' using errcode = '28000';
  end if;
  perform app.set_user_login(auth.uid(), coalesce(p_username, ''), nullif(p_pin, ''), auth.uid());
end $$;
revoke execute on function public.my_login_set(text, text, text) from public, anon;
grant execute on function public.my_login_set(text, text, text) to authenticated;

create or replace function public.my_login()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when l.user_id is null then null else jsonb_build_object('username', l.username) end
    from (select auth.uid() as uid) me left join app.user_logins l on l.user_id = me.uid
$$;
revoke execute on function public.my_login() from public, anon;
grant execute on function public.my_login() to authenticated;

-- the users page: each person's user name, and whether it is locked
drop function if exists public.member_extras(uuid);
create function public.member_extras(p_company uuid)
returns table (member_id uuid, view_mode text, simple boolean, has_pin boolean, pin_locked boolean, username text, login_locked boolean)
language sql stable security definer set search_path = '' as $$
  select m.id, m.view_mode, app.member_simple(m.id), p.member_id is not null or l.user_id is not null,
         coalesce(p.locked_until > now(), false), l.username, coalesce(l.locked_until > now(), false)
    from public.company_members m
    left join app.member_pins p on p.member_id = m.id
    left join app.user_logins l on l.user_id = m.user_id
   where m.company_id = p_company and m.deleted_at is null and app.has_permission(p_company, 'admin.read')
$$;
revoke execute on function public.member_extras(uuid) from public, anon;
grant execute on function public.member_extras(uuid) to authenticated;

-- ------------------------------------------------------------------ the shared till takes the same PIN
create or replace function public.pin_login(p_token text, p_member uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d app.shared_devices; m public.company_members; pin app.member_pins; l app.user_logins; v_secret text := encode(extensions.gen_random_bytes(18), 'hex');
  v_id uuid; v_email text; v_fail int;
begin
  d := app.shared_device(p_token);
  if d.id is null then raise exception 'This computer is no longer a shared till; sign in with your user name' using errcode = '42501'; end if;
  select * into m from public.company_members where id = p_member and company_id = d.company_id and status = 'active' and deleted_at is null;
  select * into l from app.user_logins where user_id = m.user_id for update;
  if l.user_id is not null then
    -- the person's own PIN, with its own lock
    if l.locked_until > now() then
      raise exception 'Too many wrong PINs; try again in % minutes', ceil(extract(epoch from l.locked_until - now()) / 60)::int using errcode = '28000';
    end if;
    if l.pin_hash <> extensions.crypt(coalesce(p_pin, ''), l.pin_hash) then
      v_fail := l.failed + 1;
      update app.user_logins set failed = v_fail,
        locked_until = case when v_fail >= 10 then now() + interval '60 minutes' when v_fail >= 5 then now() + interval '10 minutes' end
       where user_id = l.user_id;
      return jsonb_build_object('error', case when v_fail >= 5 then 'Too many wrong PINs; try again in 10 minutes' else 'Wrong PIN' end);
    end if;
    update app.user_logins set failed = 0, locked_until = null where user_id = l.user_id;
  else
    select * into pin from app.member_pins where member_id = m.id for update;
    if m.id is null or pin.member_id is null then raise exception 'Wrong PIN' using errcode = '28000'; end if;
    if pin.locked_until > now() then
      raise exception 'Too many wrong PINs; try again in % minutes', ceil(extract(epoch from pin.locked_until - now()) / 60)::int using errcode = '28000';
    end if;
    if pin.pin_hash <> extensions.crypt(coalesce(p_pin, ''), pin.pin_hash) then
      update app.member_pins set failed = failed + 1, locked_until = case when failed + 1 >= 5 then now() + interval '10 minutes' end where member_id = m.id;
      return jsonb_build_object('error', case when pin.failed + 1 >= 5 then 'Too many wrong PINs; try again in 10 minutes' else 'Wrong PIN' end);
    end if;
    update app.member_pins set failed = 0, locked_until = null where member_id = m.id;
  end if;
  select email into v_email from auth.users where id = m.user_id;
  update app.shared_devices set last_used_at = now() where id = d.id;
  insert into app.pin_logins (device_id, user_id, email, secret_hash) values (d.id, m.user_id, v_email, encode(extensions.digest(v_secret, 'sha256'), 'hex'))
  returning id into v_id;
  update public.profiles set last_company_id = d.company_id where id = m.user_id;
  return jsonb_build_object('request', v_id, 'secret', v_secret);
end $$;
grant execute on function public.pin_login(text, uuid, text) to anon, authenticated;

-- the names on the shared till: everyone with a PIN of either kind
create or replace function public.shared_device_people(p_token text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare d app.shared_devices;
begin
  d := app.shared_device(p_token);
  if d.id is null then return null; end if;
  if not app.license_ok(d.company_id) then raise exception 'This company''s licence is not active' using errcode = '42501'; end if;
  return jsonb_build_object('device', d.name, 'company', (select name from public.companies where id = d.company_id),
    'people', coalesce((select jsonb_agg(jsonb_build_object('member_id', m.id, 'name', coalesce(nullif(p.full_name, ''), l.username, split_part(u.email, '@', 1)))
                                     order by coalesce(nullif(p.full_name, ''), l.username, u.email))
                          from public.company_members m
                          left join app.member_pins pin on pin.member_id = m.id
                          left join app.user_logins l on l.user_id = m.user_id
                          join auth.users u on u.id = m.user_id left join public.profiles p on p.id = m.user_id
                         where m.company_id = d.company_id and m.status = 'active' and m.deleted_at is null
                           and (pin.member_id is not null or l.user_id is not null)), '[]'::jsonb));
end $$;
