-- =============================================================================
-- DrisPRO · Phase 10: clients and licences (platform owner controls access)
--
-- * Nobody creates their own company: the platform owner (profiles.is_super_admin)
--   creates each client company together with its first admin account and licence.
--   public.platform_settings.self_service = true reopens self-service sign-up.
-- * Sign-up through the API is accepted only for emails that hold an invitation.
-- * Every company has one licence: plan, user limit, valid from/until, active or
--   suspended. Outside it the company's members lose access (the data is kept);
--   the platform owner always keeps access. Invitations respect the user limit.
-- =============================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- 1. Settings and licences
-- -----------------------------------------------------------------------------
create table public.platform_settings (
  id           boolean primary key default true check (id),
  self_service boolean not null default false,   -- anyone may sign up and create a company
  updated_at   timestamptz not null default now()
);
insert into public.platform_settings (id) values (true) on conflict do nothing;
alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from anon, authenticated;
-- read and changed only through app.self_service() and platform_set_self_service()
create policy platform_settings_none on public.platform_settings for select to authenticated using (false);

create table public.licenses (
  company_id  uuid primary key references public.companies(id) on delete cascade,
  plan        text not null default 'standard',
  max_users   int  not null default 10 check (max_users between 1 and 10000),
  valid_from  date not null default current_date,
  valid_until date not null,
  status      text not null default 'active' check (status in ('active','suspended')),
  notes       text,                                 -- for the platform owner only
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  check (valid_until >= valid_from)
);
alter table public.licenses enable row level security;
revoke all on public.licenses from anon, authenticated;
-- company members read their own licence (without the internal notes); changes go through platform_* functions
grant select (company_id, plan, max_users, valid_from, valid_until, status) on public.licenses to authenticated;

-- existing companies get a one-year licence large enough for their current team
insert into public.licenses (company_id, plan, max_users, valid_until)
select c.id, 'standard',
       greatest(10, (select count(*) from public.company_members m where m.company_id = c.id and m.deleted_at is null and m.status in ('active','invited'))),
       current_date + 365
  from public.companies c
 where not exists (select 1 from public.licenses l where l.company_id = c.id);

create or replace function app.license_ok(p_company uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.licenses l
                  where l.company_id = p_company and l.status = 'active'
                    and current_date between l.valid_from and l.valid_until)
$$;

create or replace function app.self_service()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select self_service from public.platform_settings where id), false)
$$;

-- -----------------------------------------------------------------------------
-- 2. Access follows the licence (central helpers used by every RLS policy)
-- -----------------------------------------------------------------------------
create or replace function app.my_company_ids()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select case when app.is_super_admin()
    then (select coalesce(array_agg(c.id), '{}') from public.companies c where c.deleted_at is null)
    else (select coalesce(array_agg(m.company_id), '{}')
            from public.company_members m
            join public.companies c on c.id = m.company_id and c.deleted_at is null
            join public.licenses l  on l.company_id = c.id and l.status = 'active'
                                   and current_date between l.valid_from and l.valid_until
           where m.user_id = auth.uid() and m.status = 'active')
  end
$$;

create or replace function app.company_ids_with(p_perm text)
returns uuid[] language sql stable security definer set search_path = '' as $$
  select case when app.is_super_admin()
    then (select coalesce(array_agg(c.id), '{}') from public.companies c where c.deleted_at is null)
    else (
      select coalesce(array_agg(distinct m.company_id), '{}')
        from public.company_members m
        join public.companies c        on c.id = m.company_id and c.deleted_at is null
        join public.licenses l         on l.company_id = c.id and l.status = 'active'
                                      and current_date between l.valid_from and l.valid_until
        join public.member_roles mr    on mr.member_id = m.id and mr.company_id = m.company_id
        join public.role_permissions rp on rp.role_id = mr.role_id
       where m.user_id = auth.uid()
         and m.status = 'active'
         and rp.permission in (p_perm,
                               split_part(p_perm, '.', 1) || '.*',
                               '*.' || split_part(p_perm, '.', 2),
                               '*'))
  end
$$;

create or replace function app.has_role(p_company uuid, p_role_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.license_ok(p_company) and exists (
    select 1 from public.company_members m
      join public.member_roles mr on mr.member_id = m.id
      join public.roles r on r.id = mr.role_id
     where m.company_id = p_company and m.user_id = auth.uid()
       and m.status = 'active' and r.key = p_role_key)
$$;

create policy licenses_select on public.licenses for select to authenticated
  using (company_id = any ((select app.my_company_ids())::uuid[]));

-- -----------------------------------------------------------------------------
-- 3. Sign-up only by invitation
-- -----------------------------------------------------------------------------
-- Sign-ups arrive from the auth service, which connects as supabase_auth_admin.
-- Accounts made by the platform functions, migrations or the demo loader connect
-- as another role and are not affected.
create or replace function app.signup_allowed(p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.self_service()
      or exists (select 1 from public.company_members m
                  where m.user_id is null and m.status = 'invited' and m.deleted_at is null
                    and lower(m.invited_email) = lower(btrim(p_email)))
$$;

create or replace function app.tg_signup_gate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if session_user = 'supabase_auth_admin' and not app.signup_allowed(new.email) then
    raise exception 'Sign-up is by invitation only' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists on_auth_user_signup_gate on auth.users;
create trigger on_auth_user_signup_gate before insert on auth.users
  for each row execute function app.tg_signup_gate();

-- -----------------------------------------------------------------------------
-- 4. Companies: created by the platform owner (or by anyone when self-service is on)
-- -----------------------------------------------------------------------------
create or replace function app.create_company_core(
  p_owner uuid, p_name text, p_country_code text, p_base_currency text, p_tax_number text, p_legal_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_company uuid; v_member uuid; v_country text := upper(coalesce(p_country_code, 'XK'));
begin
  if coalesce(trim(p_name), '') = '' then raise exception 'Company name is required' using errcode = '23514'; end if;
  if v_country not in ('AL','XK') then raise exception 'Country must be Albania or Kosovo' using errcode = '22023'; end if;
  if p_tax_number is not null and btrim(p_tax_number) <> ''
     and exists (select 1 from public.companies where upper(tax_number) = upper(btrim(p_tax_number)) and deleted_at is null) then
    raise exception 'A company with tax number % already exists', upper(btrim(p_tax_number)) using errcode = '23505';
  end if;

  insert into public.companies (name, legal_name, country_code, base_currency, tax_number, timezone)
  values (trim(p_name), coalesce(nullif(trim(p_legal_name), ''), trim(p_name)), v_country,
          coalesce(p_base_currency, case v_country when 'AL' then 'ALL' else 'EUR' end),
          nullif(upper(btrim(p_tax_number)), ''),
          case v_country when 'XK' then 'Europe/Belgrade' else 'Europe/Tirane' end)
  returning id into v_company;

  insert into public.company_settings (company_id) values (v_company);
  insert into public.company_members (company_id, user_id, status, joined_at)
  values (v_company, p_owner, 'active', now()) returning id into v_member;
  insert into public.member_roles (company_id, member_id, role_id)
  select v_company, v_member, r.id from public.roles r where r.key = 'company_admin';
  update public.profiles set last_company_id = coalesce(last_company_id, v_company) where id = p_owner;

  perform app.seed_company_defaults(v_company);
  return v_company;
end $$;

-- true for calls from the app (PostgREST sets the role), also inside SECURITY DEFINER functions
create or replace function app.called_from_api()
returns boolean language sql stable as $$
  select coalesce(current_setting('role', true), 'none') in ('authenticated', 'anon')
$$;

create or replace function public.create_company(
  p_name text, p_country_code text default 'XK', p_base_currency text default null,
  p_tax_number text default null, p_legal_name text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_company uuid; v_platform boolean := app.is_super_admin() or not app.called_from_api();
begin
  if v_uid is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if not v_platform and not app.self_service() then
    raise exception 'Only the platform administrator can create companies' using errcode = '42501';
  end if;
  v_company := app.create_company_core(v_uid, p_name, p_country_code, p_base_currency, p_tax_number, p_legal_name);
  update public.profiles set last_company_id = v_company where id = v_uid;
  -- self-service companies start on a 30-day trial
  insert into public.licenses (company_id, plan, max_users, valid_until, updated_by)
  values (v_company, case when v_platform then 'standard' else 'trial' end, case when v_platform then 25 else 10 end,
          current_date + case when v_platform then 365 else 30 end, v_uid);
  return v_company;
end $$;

-- invitations count towards the licence's user limit
create or replace function app.seats_used(p_company uuid)
returns int language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.company_members m
   where m.company_id = p_company and m.deleted_at is null and m.status in ('active','invited')
     and not coalesce((select p.is_super_admin from public.profiles p where p.id = m.user_id), false)
$$;

create or replace function app.require_seat(p_company uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
declare v_max int;
begin
  select max_users into v_max from public.licenses where company_id = p_company;
  if v_max is not null and app.seats_used(p_company) >= v_max then
    raise exception 'The licence allows % users. Ask your provider for more.', v_max using errcode = '54000';
  end if;
end $$;

create or replace function public.invite_member(p_company uuid, p_email text, p_role_keys text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_member uuid; v_user uuid;
begin
  perform app.require_permission(p_company, 'admin.write');
  if nullif(btrim(p_email), '') is null or p_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address' using errcode = '23514'; end if;
  if exists (select 1 from public.roles where key = any (p_role_keys) and (company_id is null or company_id = p_company) and not is_assignable) then
    raise exception 'Role cannot be assigned within a company' using errcode = '42501';
  end if;
  if cardinality(coalesce(p_role_keys, '{}')) = 0 then raise exception 'Give the person at least one role' using errcode = '23514'; end if;
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if exists (select 1 from public.company_members m where m.company_id = p_company and m.deleted_at is null
               and (m.user_id = v_user or lower(m.invited_email) = lower(btrim(p_email)))) then
    raise exception '% is already a member', lower(btrim(p_email)) using errcode = '23505';
  end if;
  perform app.require_seat(p_company);
  insert into public.company_members (company_id, user_id, invited_email, status, joined_at)
  values (p_company, v_user, lower(btrim(p_email)), case when v_user is null then 'invited' else 'active' end, case when v_user is null then null else now() end)
  returning id into v_member;
  insert into public.member_roles (company_id, member_id, role_id)
  select p_company, v_member, r.id from public.roles r where r.key = any (p_role_keys) and (r.company_id is null or r.company_id = p_company);
  if v_user is not null then
    perform app.notify(p_company, v_user, 'info', 'You were added to ' || (select name from public.companies where id = p_company), null, '/', null, null);
  end if;
  return v_member;
end $$;

create or replace function public.set_member_status(p_member uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.company_members;
begin
  select * into m from public.company_members where id = p_member and deleted_at is null;
  if m.id is null then raise exception 'Member not found' using errcode = 'P0002'; end if;
  perform app.require_permission(m.company_id, 'admin.write');
  if p_status not in ('active','suspended','removed') then raise exception 'Unknown status %', p_status using errcode = '22023'; end if;
  if m.user_id = auth.uid() then raise exception 'You cannot suspend or remove yourself' using errcode = '42501'; end if;
  if p_status <> 'active' and app.admins_left(m.company_id, m.id) = 0 then
    raise exception 'This is the last company admin' using errcode = '55000';
  end if;
  if p_status = 'active' and m.user_id is null then raise exception 'The invitation has not been accepted yet' using errcode = '55000'; end if;
  if p_status = 'active' and m.status = 'suspended' then perform app.require_seat(m.company_id); end if;
  if p_status = 'removed' then
    update public.company_members set deleted_at = now(), deleted_by = auth.uid() where id = m.id;
  else
    update public.company_members set status = p_status where id = m.id;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Accounts created by the platform owner (password set directly, no email needed)
-- -----------------------------------------------------------------------------
create or replace function app.create_auth_user(p_email text, p_password text, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v uuid; v_email text := lower(btrim(p_email));
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address' using errcode = '23514'; end if;
  select id into v from auth.users where lower(email) = v_email;
  if v is not null then return v; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'The password needs at least 8 characters' using errcode = '23514'; end if;
  v := gen_random_uuid();
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password') then
    execute $q$insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
                                       created_at, updated_at, confirmation_token, recovery_token, email_change_token_new, email_change)
               values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, extensions.crypt($3, extensions.gen_salt('bf')), now(),
                       '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', $4), now(), now(), '', '', '', '')$q$
      using v, v_email, p_password, coalesce(nullif(btrim(p_name), ''), split_part(v_email, '@', 1));
    if to_regclass('auth.identities') is not null then
      if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'identities' and column_name = 'provider_id') then
        execute $q$insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
                   values (gen_random_uuid(), $1, $1::text, jsonb_build_object('sub', $1::text, 'email', $2, 'email_verified', true), 'email', now(), now(), now())$q$
          using v, v_email;
      else
        execute $q$insert into auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
                   values ($1::text, $1, jsonb_build_object('sub', $1::text, 'email', $2), 'email', now(), now(), now())$q$
          using v, v_email;
      end if;
    end if;
  else  -- plain-Postgres test stub
    execute 'insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, jsonb_build_object(''full_name'', $3))'
      using v, v_email, coalesce(nullif(btrim(p_name), ''), split_part(v_email, '@', 1));
  end if;
  return v;
end $$;

create or replace function app.require_super_admin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_super_admin() then raise exception 'Only the platform administrator can do this' using errcode = '42501'; end if;
end $$;

-- p: {name, legal_name?, country (AL|XK), tax_number?, owner_email, owner_name?, owner_password? (new accounts),
--     plan?, max_users?, valid_from?, valid_until?, notes?}
create or replace function public.platform_create_client(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_company uuid; v_existing boolean;
begin
  perform app.require_super_admin();
  if nullif(btrim(p ->> 'owner_email'), '') is null then raise exception 'Enter the email of the client''s administrator' using errcode = '23514'; end if;
  v_existing := exists (select 1 from auth.users where lower(email) = lower(btrim(p ->> 'owner_email')));
  v_owner := app.create_auth_user(p ->> 'owner_email', p ->> 'owner_password', p ->> 'owner_name');
  if not v_existing and nullif(btrim(p ->> 'owner_name'), '') is not null then
    update public.profiles set full_name = btrim(p ->> 'owner_name') where id = v_owner;
  end if;
  v_company := app.create_company_core(v_owner, p ->> 'name', coalesce(p ->> 'country', 'XK'), null, p ->> 'tax_number', p ->> 'legal_name');
  insert into public.licenses (company_id, plan, max_users, valid_from, valid_until, notes, updated_by)
  values (v_company, coalesce(nullif(btrim(p ->> 'plan'), ''), 'standard'), coalesce((p ->> 'max_users')::int, 5),
          coalesce((p ->> 'valid_from')::date, current_date), coalesce((p ->> 'valid_until')::date, current_date + 365),
          nullif(btrim(p ->> 'notes'), ''), auth.uid());
  return v_company;
end $$;

create or replace function public.platform_save_license(p_company uuid, p_plan text, p_max_users int, p_valid_from date,
                                                        p_valid_until date, p_status text, p_notes text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  if p_status not in ('active','suspended') then raise exception 'Unknown status %', p_status using errcode = '22023'; end if;
  if p_valid_until < p_valid_from then raise exception 'The end date is before the start date' using errcode = '23514'; end if;
  insert into public.licenses as l (company_id, plan, max_users, valid_from, valid_until, status, notes, updated_by)
  values (p_company, coalesce(nullif(btrim(p_plan), ''), 'standard'), p_max_users, p_valid_from, p_valid_until, p_status, nullif(btrim(p_notes), ''), auth.uid())
  on conflict (company_id) do update set plan = excluded.plan, max_users = excluded.max_users, valid_from = excluded.valid_from,
    valid_until = excluded.valid_until, status = excluded.status, notes = excluded.notes, updated_at = now(), updated_by = auth.uid();
end $$;

-- the client's admin forgot the password: the platform owner sets a new one
create or replace function public.platform_set_password(p_email text, p_password text)
returns void language plpgsql security definer set search_path = '' as $$
declare v uuid;
begin
  perform app.require_super_admin();
  if length(coalesce(p_password, '')) < 8 then raise exception 'The password needs at least 8 characters' using errcode = '23514'; end if;
  select id into v from auth.users where lower(email) = lower(btrim(p_email));
  if v is null then raise exception 'No account with the email %', lower(btrim(p_email)) using errcode = 'P0002'; end if;
  if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = 'encrypted_password') then
    execute 'update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt(''bf'')), updated_at = now() where id = $1'
      using v, p_password;
  end if;
end $$;

create or replace function public.platform_set_self_service(p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  update public.platform_settings set self_service = p_on, updated_at = now() where id;
end $$;

create or replace function public.platform_clients()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  return jsonb_build_object(
    'self_service', app.self_service(),
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'name', c.name, 'legal_name', c.legal_name, 'country_code', c.country_code, 'tax_number', c.tax_number,
               'created_at', c.created_at,
               'plan', l.plan, 'max_users', l.max_users, 'valid_from', l.valid_from, 'valid_until', l.valid_until,
               'status', l.status, 'notes', l.notes,
               'users', app.seats_used(c.id),
               'admins', (select coalesce(jsonb_agg(coalesce(u.email, m.invited_email) order by m.created_at), '[]'::jsonb)
                            from public.company_members m
                            join public.member_roles mr on mr.member_id = m.id
                            join public.roles r on r.id = mr.role_id and r.key = 'company_admin'
                            left join auth.users u on u.id = m.user_id
                           where m.company_id = c.id and m.deleted_at is null and m.status in ('active','invited')
                             and not coalesce((select p.is_super_admin from public.profiles p where p.id = m.user_id), false)),
               'last_activity', (select max(a.occurred_at) from public.audit_log a where a.company_id = c.id))
             order by c.name)
        from public.companies c left join public.licenses l on l.company_id = c.id
       where c.deleted_at is null), '[]'::jsonb));
end $$;

-- -----------------------------------------------------------------------------
-- 6. Context for the app: licence per company, companies on hold, sign-up mode
-- -----------------------------------------------------------------------------
create or replace function public.get_my_context()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', auth.uid(),
    'is_super_admin', app.is_super_admin(),
    'self_service', app.self_service(),
    'last_company_id', (select last_company_id from public.profiles where id = auth.uid()),
    'companies', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'name', c.name, 'country_code', c.country_code,
               'base_currency', c.base_currency, 'logo_path', c.logo_path,
               'roles', (select coalesce(jsonb_agg(r.key order by r.sort_order), '[]')
                           from public.member_roles mr join public.roles r on r.id = mr.role_id
                          where mr.member_id = m.id),
               'permissions', (select coalesce(jsonb_agg(distinct rp.permission), '[]')
                                 from public.member_roles mr join public.role_permissions rp on rp.role_id = mr.role_id
                                where mr.member_id = m.id),
               'license', (select jsonb_build_object('plan', l.plan, 'max_users', l.max_users, 'valid_until', l.valid_until)
                             from public.licenses l where l.company_id = c.id))
             order by c.name)
        from public.companies c
        left join public.company_members m on m.company_id = c.id and m.user_id = auth.uid() and m.status = 'active' and m.deleted_at is null
       where c.deleted_at is null
         and c.id = any (app.my_company_ids())
         and (m.id is not null or app.is_super_admin())), '[]'::jsonb),
    -- memberships that exist but are on hold because of the licence
    'blocked', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id, 'name', c.name,
               'reason', case when l.company_id is null then 'missing' when l.status = 'suspended' then 'suspended'
                              when current_date < l.valid_from then 'not_started' else 'expired' end,
               'valid_until', l.valid_until) order by c.name)
        from public.company_members m
        join public.companies c on c.id = m.company_id and c.deleted_at is null
        left join public.licenses l on l.company_id = c.id
       where m.user_id = auth.uid() and m.status = 'active' and m.deleted_at is null
         and not app.is_super_admin() and not app.license_ok(c.id)), '[]'::jsonb));
$$;

-- -----------------------------------------------------------------------------
-- 7. Privileges
-- -----------------------------------------------------------------------------
revoke execute on function app.create_auth_user(text, text, text), app.create_company_core(uuid, text, text, text, text, text),
  app.tg_signup_gate() from public, anon, authenticated;
revoke execute on function public.platform_create_client(jsonb), public.platform_save_license(uuid, text, int, date, date, text, text),
  public.platform_set_password(text, text), public.platform_set_self_service(boolean), public.platform_clients(),
  public.create_company(text, text, text, text, text) from public, anon;
grant execute on function public.platform_create_client(jsonb), public.platform_save_license(uuid, text, int, date, date, text, text),
  public.platform_set_password(text, text), public.platform_set_self_service(boolean), public.platform_clients(),
  public.create_company(text, text, text, text, text) to authenticated;
grant execute on function app.called_from_api(), app.license_ok(uuid), app.self_service(), app.seats_used(uuid), app.require_seat(uuid),
  app.signup_allowed(text), app.require_super_admin() to authenticated, service_role;
