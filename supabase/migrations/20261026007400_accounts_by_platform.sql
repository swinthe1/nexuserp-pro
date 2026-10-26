-- =============================================================================
-- DrisPRO · accounts are made only by the platform administrator
--   Nobody signs up by themselves any more (not even with an invitation). A company's
--   administrator still invites a person with their roles; the invitation waits on the Platform
--   page, where the platform administrator makes the account with a password and hands it over.
--   (Self-service, when the platform owner switches it on, still allows sign-ups.)
-- =============================================================================

create or replace function app.signup_allowed(p_email text)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.self_service()
$$;

create or replace function app.tg_signup_gate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if session_user = 'supabase_auth_admin' and not app.signup_allowed(new.email) then
    raise exception 'Accounts are made by the platform administrator' using errcode = '42501';
  end if;
  return new;
end $$;

-- the platform administrator makes the account of an invited person; the invitation is accepted
-- by itself (app.handle_new_user)
create or replace function public.platform_create_account(p_member uuid, p_password text, p_name text default null)
returns text language plpgsql security definer set search_path = '' as $$
declare m public.company_members;
begin
  perform app.require_super_admin();
  select * into m from public.company_members where id = p_member and deleted_at is null;
  if m.id is null then raise exception 'Invitation not found' using errcode = 'P0002'; end if;
  if m.user_id is not null or m.status <> 'invited' then raise exception 'This person already has an account' using errcode = '55000'; end if;
  perform app.create_auth_user(m.invited_email, p_password, p_name);
  return m.invited_email;
end $$;
revoke execute on function public.platform_create_account(uuid, text, text) from public, anon;
grant execute on function public.platform_create_account(uuid, text, text) to authenticated;

-- the platform administrator learns of a new invitation
create or replace function app.tg_member_invited()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'invited' or new.user_id is not null then return null; end if;
  insert into public.notifications (company_id, user_id, type, title, body, link)
  select new.company_id, p.id, 'approval', 'Make an account for ' || new.invited_email,
         (select name from public.companies where id = new.company_id), '/platform'
    from public.profiles p where p.is_super_admin;
  return null;
end $$;
create trigger trg_90_member_invited after insert on public.company_members
  for each row execute function app.tg_member_invited();

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;
select app._patch_function('public.platform_clients',
  $x$'last_activity', (select max(a.occurred_at)$x$,
  $x$'pending', (select coalesce(jsonb_agg(jsonb_build_object('member_id', m.id, 'email', m.invited_email, 'invited_at', m.created_at,
                                   'roles', (select coalesce(jsonb_agg(r.name order by r.name), '[]'::jsonb) from public.member_roles mr join public.roles r on r.id = mr.role_id
                                              where mr.member_id = m.id)) order by m.created_at), '[]'::jsonb)
                    from public.company_members m where m.company_id = c.id and m.status = 'invited' and m.user_id is null and m.deleted_at is null),
               'last_activity', (select max(a.occurred_at)$x$);
drop function app._patch_function(text, text, text);
