-- =============================================================================
-- Chat: everyone of the company shows up, also people without a profile row yet (an account made by
-- the platform's administrator gets its profile only at the first sign-in): the name comes from the
-- profile, else from the account, else the email.
-- =============================================================================

create or replace function app.person_name(p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(u.raw_user_meta_data ->> 'full_name'), ''), u.email, p.email)
    from auth.users u full join public.profiles p on p.id = u.id
   where coalesce(u.id, p.id) = p_user
$$;

create or replace function public.chat_people(p_company uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'email', x.email) order by x.name), '[]')
    from (select m.user_id as id, coalesce(app.person_name(m.user_id), m.invited_email) as name, coalesce(u.email, m.invited_email) as email
            from public.company_members m left join auth.users u on u.id = m.user_id
           where m.company_id = p_company and m.status = 'active' and m.deleted_at is null and m.user_id is not null
             and p_company = any (app.my_company_ids())) x
$$;

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

-- the conversation list: the other person's name the same way
do $$ begin
  perform app._patch_function('public.chat_list',
    '(select coalesce(nullif(p.full_name, ''''), p.email) from public.chat_members o join public.profiles p on p.id = o.user_id
                                                            where o.conversation_id = c.id and o.user_id <> auth.uid() limit 1)',
    '(select app.person_name(o.user_id) from public.chat_members o where o.conversation_id = c.id and o.user_id <> auth.uid() limit 1)');
  perform app._patch_function('public.chat_send',
    'select coalesce(nullif(full_name, ''''), email) into v_name from public.profiles where id = auth.uid();',
    'v_name := app.person_name(auth.uid());');
end $$;

-- only active members may start or be in a conversation
create or replace function app.chat_require_people(p_company uuid, p_users uuid[])
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not (p_company = any (app.my_company_ids())) then raise exception 'Permission denied' using errcode = '42501'; end if;
  if exists (select 1 from unnest(p_users) u
              where not exists (select 1 from public.company_members m where m.company_id = p_company and m.user_id = u and m.status = 'active' and m.deleted_at is null)) then
    raise exception 'Only people of this company can be in the conversation' using errcode = '23514';
  end if;
end $$;

drop function app._patch_function(text, text, text);
