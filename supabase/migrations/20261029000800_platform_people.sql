-- =============================================================================
-- The console manages a client's people without opening the company:
--   * platform_company_roles: the roles that can be given in that company
--   * platform_add_member: a new person with their roles; the account is made here
--     with the password the Super Admin gives (an existing account is just added)
--   * platform_member_roles / platform_member_status: change roles; suspend, restore, remove
-- The same rules as inside the company: a free place in the licence, never without an
-- administrator. Everything is written in the platform's diary.
-- =============================================================================

create or replace function public.platform_company_roles(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'key', r.key, 'name', r.name, 'description', r.description) order by (r.company_id is null) desc, r.name)
                     from public.roles r where r.is_assignable and (r.company_id is null or r.company_id = p_company)), '[]'::jsonb);
end $$;
revoke execute on function public.platform_company_roles(uuid) from public, anon;
grant execute on function public.platform_company_roles(uuid) to authenticated;

create or replace function public.platform_add_member(p_company uuid, p_email text, p_name text, p_password text, p_role_keys text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_user uuid; v_new boolean := false; v_member uuid;
begin
  perform app.require_super_admin();
  if not exists (select 1 from public.companies where id = p_company and deleted_at is null) then raise exception 'Client not found' using errcode = 'P0002'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address' using errcode = '23514'; end if;
  if cardinality(coalesce(p_role_keys, '{}')) = 0 then raise exception 'Give the person at least one role' using errcode = '23514'; end if;
  if exists (select 1 from public.roles where key = any (p_role_keys) and (company_id is null or company_id = p_company) and not is_assignable) then
    raise exception 'Role cannot be assigned within a company' using errcode = '42501';
  end if;
  select id into v_user from auth.users where lower(email) = v_email;
  if exists (select 1 from public.company_members m where m.company_id = p_company and m.deleted_at is null
               and (m.user_id = v_user or lower(m.invited_email) = v_email)) then
    raise exception '% is already a member', v_email using errcode = '23505';
  end if;
  perform app.require_seat(p_company);
  if v_user is null then
    v_user := app.create_auth_user(v_email, p_password, p_name);
    v_new := true;
  end if;
  -- the membership may have been made by the new account itself (an invitation by email): use it
  select id into v_member from public.company_members where company_id = p_company and deleted_at is null and (user_id = v_user or lower(invited_email) = v_email);
  if v_member is null then
    insert into public.company_members (company_id, user_id, invited_email, status, joined_at) values (p_company, v_user, v_email, 'active', now()) returning id into v_member;
  else
    update public.company_members set user_id = v_user, status = 'active', joined_at = coalesce(joined_at, now()) where id = v_member;
  end if;
  insert into public.member_roles (company_id, member_id, role_id)
  select p_company, v_member, r.id from public.roles r where r.key = any (p_role_keys) and (r.company_id is null or r.company_id = p_company)
     and not exists (select 1 from public.member_roles x where x.member_id = v_member and x.role_id = r.id);
  if nullif(btrim(p_name), '') is not null then
    update public.profiles set full_name = btrim(p_name) where id = v_user and coalesce(full_name, '') = '';
  end if;
  perform app.platform_log('member_added', p_company, jsonb_build_object('email', v_email, 'roles', to_jsonb(p_role_keys), 'new_account', v_new));
  return jsonb_build_object('member_id', v_member, 'new_account', v_new, 'email', v_email);
end $$;
revoke execute on function public.platform_add_member(uuid, text, text, text, text[]) from public, anon;
grant execute on function public.platform_add_member(uuid, text, text, text, text[]) to authenticated;

create or replace function public.platform_member_roles(p_member uuid, p_role_keys text[])
returns void language plpgsql security definer set search_path = '' as $$
declare m public.company_members; v_ids uuid[];
begin
  perform app.require_super_admin();
  select * into m from public.company_members where id = p_member and deleted_at is null;
  if m.id is null then raise exception 'Member not found' using errcode = 'P0002'; end if;
  select array_agg(r.id) into v_ids from public.roles r where r.key = any (p_role_keys) and r.is_assignable and (r.company_id is null or r.company_id = m.company_id);
  if cardinality(coalesce(v_ids, '{}')) = 0 then raise exception 'Keep at least one role; suspend the person instead' using errcode = '23514'; end if;
  if app.admins_left(m.company_id, m.id) = 0
     and not exists (select 1 from public.role_permissions where role_id = any (v_ids) and permission = '*') then
    raise exception 'This is the last company admin; make someone else admin first' using errcode = '55000';
  end if;
  delete from public.member_roles where member_id = m.id and not (role_id = any (v_ids));
  insert into public.member_roles (company_id, member_id, role_id)
  select m.company_id, m.id, x from unnest(v_ids) x where not exists (select 1 from public.member_roles where member_id = m.id and role_id = x);
  perform app.platform_log('member_roles_set', m.company_id, jsonb_build_object('email', coalesce((select email from auth.users where id = m.user_id), m.invited_email), 'roles', to_jsonb(p_role_keys)));
end $$;
revoke execute on function public.platform_member_roles(uuid, text[]) from public, anon;
grant execute on function public.platform_member_roles(uuid, text[]) to authenticated;

create or replace function public.platform_member_status(p_member uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare m public.company_members;
begin
  perform app.require_super_admin();
  select * into m from public.company_members where id = p_member and deleted_at is null;
  if m.id is null then raise exception 'Member not found' using errcode = 'P0002'; end if;
  if p_status not in ('active', 'suspended', 'removed') then raise exception 'Unknown status %', p_status using errcode = '22023'; end if;
  if p_status <> 'active' and app.admins_left(m.company_id, m.id) = 0 then raise exception 'This is the last company admin' using errcode = '55000'; end if;
  if p_status = 'active' and m.user_id is null then raise exception 'The invitation has not been accepted yet' using errcode = '55000'; end if;
  if p_status = 'active' and m.status = 'suspended' then perform app.require_seat(m.company_id); end if;
  if p_status = 'removed' then
    update public.company_members set deleted_at = now(), deleted_by = auth.uid() where id = m.id;
  else
    update public.company_members set status = p_status where id = m.id;
  end if;
  perform app.platform_log('member_' || p_status, m.company_id, jsonb_build_object('email', coalesce((select email from auth.users where id = m.user_id), m.invited_email)));
end $$;
revoke execute on function public.platform_member_status(uuid, text) from public, anon;
grant execute on function public.platform_member_status(uuid, text) to authenticated;

-- a name or phone changed from the console is written in the diary too
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;
do $$ begin
  perform app._patch_function('public.member_profile_save',
    $p$  update auth.users set raw_user_meta_data$p$,
    $p$  if app.is_super_admin() and p_user <> auth.uid() then
    perform app.platform_log('member_details_set', p_company, jsonb_build_object('email', (select email from auth.users where id = p_user), 'name', v_name));
  end if;
  update auth.users set raw_user_meta_data$p$);
end $$;
drop function app._patch_function(text, text, text);

-- the client's own details, corrected from the console (what changed is written in the diary)
create or replace function public.platform_update_company(p_company uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.companies; v_diff jsonb := '{}'; k text;
  v_keys text[] := array['name', 'legal_name', 'tax_number', 'vat_number', 'business_number', 'address_line1', 'city', 'phone', 'email', 'website'];
begin
  perform app.require_super_admin();
  select * into c from public.companies where id = p_company and deleted_at is null;
  if c.id is null then raise exception 'Client not found' using errcode = 'P0002'; end if;
  if p ? 'name' and length(btrim(coalesce(p ->> 'name', ''))) < 2 then raise exception 'Enter the company name' using errcode = '23514'; end if;
  foreach k in array v_keys loop
    if p ? k and (to_jsonb(c) ->> k) is distinct from nullif(btrim(p ->> k), '') then
      v_diff := v_diff || jsonb_build_object(k, jsonb_build_object('from', to_jsonb(c) ->> k, 'to', nullif(btrim(p ->> k), '')));
    end if;
  end loop;
  if v_diff = '{}' then return; end if;
  update public.companies set
    name = case when p ? 'name' then btrim(p ->> 'name') else name end,
    legal_name = case when p ? 'legal_name' then nullif(btrim(p ->> 'legal_name'), '') else legal_name end,
    tax_number = case when p ? 'tax_number' then nullif(btrim(p ->> 'tax_number'), '') else tax_number end,
    vat_number = case when p ? 'vat_number' then nullif(btrim(p ->> 'vat_number'), '') else vat_number end,
    business_number = case when p ? 'business_number' then nullif(btrim(p ->> 'business_number'), '') else business_number end,
    address_line1 = case when p ? 'address_line1' then nullif(btrim(p ->> 'address_line1'), '') else address_line1 end,
    city = case when p ? 'city' then nullif(btrim(p ->> 'city'), '') else city end,
    phone = case when p ? 'phone' then nullif(btrim(p ->> 'phone'), '') else phone end,
    email = case when p ? 'email' then nullif(btrim(p ->> 'email'), '') else email end,
    website = case when p ? 'website' then nullif(btrim(p ->> 'website'), '') else website end,
    updated_at = now()
  where id = c.id;
  perform app.platform_log('client_details_set', c.id, v_diff);
end $$;
revoke execute on function public.platform_update_company(uuid, jsonb) from public, anon;
grant execute on function public.platform_update_company(uuid, jsonb) to authenticated;
