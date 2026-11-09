-- =============================================================================
-- DrisPRO · a new client's administrator gets a user name and a PIN, not a password (the owner's ask, 9.11.2026)
--   Everyone in a company signs in with a user name and a PIN; the administrator the platform makes too.
--   The email stays, for contact, and may be left empty. An owner who already signs in (a second business)
--   keeps the user name and PIN they have; platform_owner_login says which one, for the welcome note.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.platform_create_client(p jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_owner uuid; v_company uuid; v_existing boolean;
        v_email text := lower(nullif(btrim(p ->> 'owner_email'), '')); v_user text := nullif(btrim(p ->> 'owner_username'), ''); v_pin text := nullif(btrim(p ->> 'owner_pin'), '');
begin
  perform app.require_super_admin();
  -- the administrator signs in with a user name and a PIN, as everyone in the company; the email is for contact
  if v_email is null and v_user is null then raise exception 'Enter the user name of the client''s administrator' using errcode = '23514'; end if;
  v_existing := v_email is not null and exists (select 1 from auth.users where lower(email) = v_email);
  v_owner := app.create_auth_user(coalesce(v_email, 'u-' || gen_random_uuid() || '@pin.dris-ks.com'),
                                  coalesce(nullif(p ->> 'owner_password', ''), encode(extensions.gen_random_bytes(24), 'hex')), p ->> 'owner_name');
  -- a person who signs in already (an owner with a second business) keeps the user name and PIN they have
  if v_user is not null and not exists (select 1 from app.user_logins where user_id = v_owner) then
    if v_pin is null then raise exception 'Give a PIN too' using errcode = '23514'; end if;
    perform app.set_user_login(v_owner, v_user, v_pin, auth.uid());
  end if;
  if not v_existing and nullif(btrim(p ->> 'owner_name'), '') is not null then
    update public.profiles set full_name = btrim(p ->> 'owner_name') where id = v_owner;
  end if;
  v_company := app.create_company_core(v_owner, p ->> 'name', coalesce(p ->> 'country', 'XK'), null, p ->> 'tax_number', p ->> 'legal_name');
  insert into public.licenses (company_id, plan, max_users, valid_from, valid_until, notes, updated_by)
  values (v_company, coalesce(nullif(btrim(p ->> 'plan'), ''), 'pro'), coalesce((p ->> 'max_users')::int, 5),
          coalesce((p ->> 'valid_from')::date, current_date), coalesce((p ->> 'valid_until')::date, current_date + 365),
          nullif(btrim(p ->> 'notes'), ''), auth.uid());
  perform public.platform_set_business_type(v_company, coalesce(nullif(btrim(p ->> 'business_type'), ''), 'general'), true);
  -- a package: its modules and limits (the units are created after, within its limit)
  if nullif(btrim(p ->> 'package'), '') is not null then
    perform public.platform_set_package(v_company, jsonb_build_object('package', p ->> 'package', 'modules', coalesce(p -> 'modules', '[]'::jsonb),
      'max_users', p -> 'max_users', 'apply_type', false)
      || case when p ? 'max_stores' then jsonb_build_object('max_stores', p -> 'max_stores') else '{}'::jsonb end
      || case when p ? 'max_tills' then jsonb_build_object('max_tills', p -> 'max_tills') else '{}'::jsonb end);
  end if;
  perform app.client_units(v_company, p);
  return v_company;
end $function$;

create or replace function public.platform_owner_login(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid;
begin
  perform app.require_super_admin();
  select m.user_id into v_user from public.company_members m
   where m.company_id = p_company and m.status = 'active' and m.deleted_at is null and m.user_id is not null
   order by m.joined_at nulls last, m.created_at limit 1;
  return (select jsonb_build_object('username', l.username, 'set_now', l.set_by = auth.uid() and l.set_at > now() - interval '10 minutes')
            from app.user_logins l where l.user_id = v_user);
end $$;
revoke execute on function public.platform_owner_login(uuid) from public, anon;
grant execute on function public.platform_owner_login(uuid) to authenticated;
