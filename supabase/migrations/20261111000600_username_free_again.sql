-- =============================================================================
-- DrisPRO · a removed person's user name is free again (11.11.2026)
--   A person removed from the company kept their user name, so the same name could not be given again
--   ("albert.bujupi is taken"). A name held by someone who is in no company any more is let go when it is asked for.
--   A person who is only suspended keeps the name; so does the platform's administrator.
-- =============================================================================
create or replace function app.release_username(p_username text)
 returns void language sql security definer set search_path to ''
as $function$
  delete from app.user_logins l
   where l.username = app.username_of(p_username)
     and not exists (select 1 from public.company_members m where m.user_id = l.user_id and m.deleted_at is null)
     and not coalesce((select p.is_super_admin from public.profiles p where p.id = l.user_id), false);
$function$;
revoke all on function app.release_username(text) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION app.set_user_login(p_user uuid, p_username text, p_pin text, p_by uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_name text := app.username_of(p_username); v_old app.user_logins;
begin
  select * into v_old from app.user_logins where user_id = p_user for update;
  if v_name = '' then v_name := v_old.username; end if;
  if v_name is null or v_name !~ '^[a-z0-9][a-z0-9._-]{2,29}$' then
    raise exception 'The user name is 3 to 30 letters or digits (a dot, a dash or _ also)' using errcode = '23514';
  end if;
  perform app.release_username(v_name);
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
end $function$;

CREATE OR REPLACE FUNCTION public.company_user_create(p_company uuid, p_name text, p_username text, p_pin text, p_role_keys text[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_user uuid; v_member uuid; v_name text := app.username_of(p_username);
begin
  perform app.require_permission(p_company, 'admin.write');
  if coalesce(btrim(p_name), '') = '' then raise exception 'Write the person''s name' using errcode = '23514'; end if;
  if cardinality(coalesce(p_role_keys, '{}')) = 0 then raise exception 'Give the person at least one role' using errcode = '23514'; end if;
  if exists (select 1 from public.roles where key = any (p_role_keys) and (company_id is null or company_id = p_company) and not is_assignable) then
    raise exception 'Role cannot be assigned within a company' using errcode = '42501';
  end if;
  if v_name !~ '^[a-z0-9][a-z0-9._-]{2,29}$' then raise exception 'The user name is 3 to 30 letters or digits (a dot, a dash or _ also)' using errcode = '23514'; end if;
  perform app.release_username(v_name);
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
end $function$;
