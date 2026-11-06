-- =============================================================================
-- Two-step verification taken out (the owner's decision): the password alone signs in, as before.
-- The rights checks go back to what they were before 20261106000800; its functions are dropped.
-- =============================================================================

create or replace function app.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select p.is_super_admin from public.profiles p where p.id = auth.uid()), false)
$$;

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

drop function if exists public.mfa_status();
drop function if exists public.mfa_reset_user(text);
drop function if exists app.mfa_ok();
