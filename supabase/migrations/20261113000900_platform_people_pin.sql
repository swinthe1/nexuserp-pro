-- =============================================================================
-- The platform's People tab speaks of user names and PINs, as the companies do: everyone in a company
-- signs in with them (the email and password are the platform administrator's only). The platform adds a
-- person with a user name and a PIN, sees each person's user name, and gives a new one or a new PIN.
-- =============================================================================

-- each person's user name in the client's details
do $$
declare d text := pg_get_functiondef('public.platform_client_detail(uuid)'::regprocedure);
begin
  if position('''username''' in d) = 0 then
    d := replace(d, '''external_accountant'', m.external_accountant,',
      '''external_accountant'', m.external_accountant, ''username'', (select l.username from app.user_logins l where l.user_id = m.user_id), ''platform_admin'', coalesce(p.is_super_admin, false),');
    if position('''username''' in d) = 0 then raise exception 'platform_client_detail: the members part was not found'; end if;
    execute d;
  end if;
end $$;

create or replace function public.platform_member_create(p_company uuid, p_name text, p_username text, p_pin text, p_role_keys text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_member uuid; v_name text := app.username_of(p_username);
begin
  perform app.require_super_admin();
  if not exists (select 1 from public.companies where id = p_company and deleted_at is null) then raise exception 'This client does not exist' using errcode = 'P0002'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Write the person''s name' using errcode = '23514'; end if;
  if cardinality(coalesce(p_role_keys, '{}')) = 0 then raise exception 'Give the person at least one role' using errcode = '23514'; end if;
  if v_name !~ '^[a-z0-9][a-z0-9._-]{2,29}$' then raise exception 'The user name is 3 to 30 letters or digits (a dot, a dash or _ also)' using errcode = '23514'; end if;
  if exists (select 1 from app.user_logins where username = v_name) then raise exception 'The user name % is taken: choose another', v_name using errcode = '23505'; end if;
  if not exists (select 1 from public.roles r where r.key = any (p_role_keys) and (r.company_id is null or r.company_id = p_company) and r.is_assignable) then
    raise exception 'Give the person at least one role' using errcode = '23514';
  end if;
  if exists (select 1 from public.roles where key = any (p_role_keys) and (company_id is null or company_id = p_company) and not is_assignable) then
    raise exception 'Role cannot be assigned within a company' using errcode = '42501';
  end if;
  perform app.check_login_pin(p_pin);
  perform app.require_seat(p_company);
  v_user := app.create_auth_user('u-' || replace(gen_random_uuid()::text, '-', '') || '@pin.dris-ks.com', encode(extensions.gen_random_bytes(24), 'hex'), btrim(p_name));
  update public.profiles set full_name = btrim(p_name), last_company_id = p_company where id = v_user;
  perform app.set_user_login(v_user, v_name, p_pin, auth.uid());
  insert into public.company_members (company_id, user_id, invited_email, status, joined_at)
  values (p_company, v_user, null, 'active', now()) returning id into v_member;
  insert into public.member_roles (company_id, member_id, role_id)
  select p_company, v_member, r.id from public.roles r where r.key = any (p_role_keys) and (r.company_id is null or r.company_id = p_company);
  perform app.platform_log('member_added', p_company, jsonb_build_object('name', btrim(p_name), 'username', v_name, 'roles', to_jsonb(p_role_keys)));
  return jsonb_build_object('member_id', v_member, 'username', v_name);
end $$;
revoke execute on function public.platform_member_create(uuid, text, text, text, text[]) from public, anon;
grant execute on function public.platform_member_create(uuid, text, text, text, text[]) to authenticated;

-- a new user name and/or PIN for a person of a client (also unlocks one locked out by wrong PINs)
create or replace function public.platform_member_login(p_member uuid, p_username text default null, p_pin text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.company_members;
begin
  perform app.require_super_admin();
  select * into m from public.company_members where id = p_member and deleted_at is null;
  if m.id is null then raise exception 'Not found' using errcode = 'P0002'; end if;
  -- invited by email and never joined: the account is made now, to sign in with the user name and the PIN
  if m.user_id is null then
    if p_pin is null or coalesce(btrim(p_username), '') = '' then raise exception 'Give a user name and a PIN' using errcode = '23514'; end if;
    perform app.require_seat(m.company_id);
    m.user_id := app.create_auth_user('u-' || replace(gen_random_uuid()::text, '-', '') || '@pin.dris-ks.com', encode(extensions.gen_random_bytes(24), 'hex'),
                                      coalesce(split_part(m.invited_email, '@', 1), 'user'));
    update public.company_members set user_id = m.user_id, status = 'active', joined_at = now() where id = m.id;
  end if;
  if coalesce((select is_super_admin from public.profiles where id = m.user_id), false) then
    raise exception 'This person is the platform administrator: they sign in with the email' using errcode = '42501';
  end if;
  perform app.set_user_login(m.user_id, coalesce(p_username, ''), nullif(p_pin, ''), auth.uid());
  perform app.platform_log('member_login_set', m.company_id, jsonb_build_object('member', m.id, 'username', app.username_of(p_username), 'pin', p_pin is not null));
  return jsonb_build_object('username', (select username from app.user_logins where user_id = m.user_id));
end $$;
revoke execute on function public.platform_member_login(uuid, text, text) from public, anon;
grant execute on function public.platform_member_login(uuid, text, text) to authenticated;

-- a demo client's owner signs in the same way: a user name and a PIN (the email may stay empty)
create or replace function public.platform_create_demo_client(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_co uuid; v_owner uuid;
begin
  perform app.require_super_admin();
  v_co := public.platform_create_client(jsonb_build_object('name', coalesce(nullif(btrim(p ->> 'name'), ''), 'Market Dardania (demo)'), 'country', 'XK',
            'owner_email', nullif(btrim(p ->> 'owner_email'), ''), 'owner_password', p ->> 'owner_password', 'owner_name', coalesce(nullif(p ->> 'owner_name', ''), 'Fatmir Krasniqi'),
            'owner_username', nullif(btrim(p ->> 'owner_username'), ''), 'owner_pin', nullif(btrim(p ->> 'owner_pin'), ''),
            'plan', 'pro', 'max_users', 10, 'valid_until', (current_date + coalesce((p ->> 'days')::int, 30))::text,
            'business_type', 'general', 'notes', 'Klient demo: supermarket në Kosovë me të dhëna shembull'));
  select user_id into v_owner from public.company_members where company_id = v_co and status = 'active' order by created_at limit 1;
  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  perform app.demo_base(v_co);
  return jsonb_build_object('company_id', v_co, 'next', 2, 'steps', 3 + 2 * app.demo_days() + 4);
end $$;
revoke execute on function public.platform_create_demo_client(jsonb) from public, anon;
grant execute on function public.platform_create_demo_client(jsonb) to authenticated;

-- ----------------------------------------------------------------------------- every unit has its kind
-- A unit made any other way (the warehouses page, a new client, an import) gets a kind from what it is.
create or replace function app.tg_unit_category()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.unit_category is null and new.warehouse_type <> 'transit' then
    new.unit_category := case new.warehouse_type when 'warehouse' then 'warehouse' when 'production' then 'production'
      else case (select business_type from public.companies where id = new.company_id)
             when 'cafe' then 'cafe' when 'restaurant' then 'restaurant' when 'wholesale' then 'wholesale' when 'hotel' then 'hotel'
             when 'services' then 'services' when 'retail' then 'market' when 'general' then 'market' else 'shop' end end;
  end if;
  return new;
end $$;
drop trigger if exists trg_02_unit_category on public.warehouses;
create trigger trg_02_unit_category before insert or update of warehouse_type on public.warehouses for each row execute function app.tg_unit_category();
update public.warehouses set unit_category = case warehouse_type when 'warehouse' then 'warehouse' when 'production' then 'production' else 'market' end
 where unit_category is null and warehouse_type <> 'transit';
