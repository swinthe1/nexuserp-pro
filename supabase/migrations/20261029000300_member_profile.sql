-- =============================================================================
-- A person's own details (first name, last name, phone) can be corrected by:
--   * the person, for themselves
--   * the company's administrator (admin.write), for the people of that company
--   * the platform's Super Admin, for anyone
-- A company administrator does not change the Super Admin's details. The email
-- stays as it is: it is the sign-in. The name goes to the profile and to the
-- sign-in account, so the menus, the till and the documents show the new name.
-- =============================================================================

create or replace function app.member_profile_allowed(p_company uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user = auth.uid()
      or app.is_super_admin()
      or (p_company is not null and app.has_permission(p_company, 'admin.write')
          and exists (select 1 from public.company_members m where m.company_id = p_company and m.user_id = p_user and m.deleted_at is null and m.status <> 'removed')
          and not coalesce((select is_super_admin from public.profiles where id = p_user), false))
$$;
revoke execute on function app.member_profile_allowed(uuid, uuid) from public, anon, authenticated;

create or replace function public.member_profile_get(p_company uuid, p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.profiles;
begin
  if not app.member_profile_allowed(p_company, p_user) then raise exception 'Not allowed to see these details' using errcode = '42501'; end if;
  select * into r from public.profiles where id = p_user;
  if r.id is null then raise exception 'Person not found' using errcode = 'P0002'; end if;
  return jsonb_build_object('full_name', r.full_name, 'phone', r.phone, 'email', r.email,
    'first_name', split_part(coalesce(r.full_name, ''), ' ', 1),
    'last_name', nullif(btrim(substr(coalesce(r.full_name, ''), length(split_part(coalesce(r.full_name, ''), ' ', 1)) + 1)), ''));
end $$;
revoke execute on function public.member_profile_get(uuid, uuid) from public, anon;
grant execute on function public.member_profile_get(uuid, uuid) to authenticated;

create or replace function public.member_profile_save(p_company uuid, p_user uuid, p_first_name text, p_last_name text, p_phone text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_name text := nullif(btrim(concat_ws(' ', nullif(btrim(p_first_name), ''), nullif(btrim(p_last_name), ''))), '');
begin
  if not app.member_profile_allowed(p_company, p_user) then raise exception 'Not allowed to change these details' using errcode = '42501'; end if;
  if v_name is null then raise exception 'Write the first name' using errcode = '23514'; end if;
  if length(v_name) > 120 then raise exception 'The name is too long' using errcode = '23514'; end if;
  update public.profiles set full_name = v_name, phone = nullif(btrim(p_phone), ''), updated_at = now() where id = p_user;
  if not found then raise exception 'Person not found' using errcode = 'P0002'; end if;
  update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('full_name', v_name) where id = p_user;
end $$;
revoke execute on function public.member_profile_save(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.member_profile_save(uuid, uuid, text, text, text) to authenticated;
