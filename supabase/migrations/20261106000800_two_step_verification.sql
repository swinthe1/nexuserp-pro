-- =============================================================================
-- The deep check, phase 3: two-step verification (a code from an app on the phone after the password).
--
-- Whoever has turned it on reaches no company's data with the password alone: until the code is typed,
-- the rights of every company (and the platform owner's) are empty. The app asks the platform owners and
-- every company administrator to turn it on; anyone else may.
-- The factors themselves live in Supabase Auth (auth.mfa_factors); a server without them is not affected.
-- =============================================================================

-- the session is good enough: no verified factor, or the code was typed (aal2)
create or replace function app.mfa_ok()
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or coalesce(auth.jwt() ->> 'aal', '') = 'aal2' then return true; end if;
  if to_regclass('auth.mfa_factors') is null then return true; end if;
  return not exists (select 1 from auth.mfa_factors f where f.user_id = v_uid and f.status::text = 'verified');
end $$;

create or replace function app.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_super_admin from public.profiles p where p.id = auth.uid()), false) and app.mfa_ok()
$$;

create or replace function app.my_company_ids()
returns uuid[] language sql stable security definer set search_path = '' as $$
  select case when not app.mfa_ok() then '{}'::uuid[]
    when app.is_super_admin()
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
  select case when not app.mfa_ok() then '{}'::uuid[]
    when app.is_super_admin()
    then (select coalesce(array_agg(c.id), '{}') from public.companies c where c.deleted_at is null)
    else (
      select coalesce(array_agg(distinct m.company_id), '{}')
        from public.company_members m
        join public.companies c        on c.id = m.company_id and c.deleted_at is null
        join public.licenses l         on l.company_id = c.id and l.status = 'active'
                                      and current_date between l.valid_from and l.valid_until
                                      and app.module_allowed(l.plan, l.extra_features, split_part(p_perm, '.', 1))
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

-- what the app needs to know right after the password: is a code due, must one be set up
create or replace function public.mfa_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_has boolean := false; v_must boolean;
begin
  if v_uid is null then return null; end if;
  if to_regclass('auth.mfa_factors') is not null then
    select exists (select 1 from auth.mfa_factors f where f.user_id = v_uid and f.status::text = 'verified') into v_has;
  end if;
  -- the platform owners and the companies' administrators (or anyone holding every right)
  select coalesce((select p.is_super_admin from public.profiles p where p.id = v_uid), false)
      or exists (select 1 from public.company_members m join public.member_roles mr on mr.member_id = m.id
                   join public.roles r on r.id = mr.role_id
                  where m.user_id = v_uid and m.status = 'active' and m.deleted_at is null
                    and (r.key in ('company_admin', 'super_admin') or exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.permission = '*')))
    into v_must;
  return jsonb_build_object('enabled', v_has, 'required', v_must, 'verified', coalesce(auth.jwt() ->> 'aal', '') = 'aal2' or not v_has);
end $$;
revoke execute on function public.mfa_status() from public, anon;
grant execute on function public.mfa_status() to authenticated;

-- a phone lost: a platform owner (with their own code typed) removes someone's factors; they set it up again
create or replace function public.mfa_reset_user(p_email text)
returns int language plpgsql security definer set search_path = '' as $$
declare v_user uuid; v_n int;
begin
  if not app.is_super_admin() then raise exception 'Only the platform owner resets two-step verification' using errcode = '42501'; end if;
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null then raise exception 'No user %', p_email using errcode = 'P0002'; end if;
  if to_regclass('auth.mfa_factors') is null then return 0; end if;
  begin
    delete from auth.mfa_factors where user_id = v_user;
    get diagnostics v_n = row_count;
  exception when insufficient_privilege then
    raise exception 'The database does not allow this here: on the server run deploy/coolify/mfa-reset.sh %', p_email using errcode = '42501';
  end;
  raise log 'drispro: two-step verification reset for % by %', p_email, auth.uid();
  return v_n;
end $$;
revoke execute on function public.mfa_reset_user(text) from public, anon;
grant execute on function public.mfa_reset_user(text) to authenticated;
