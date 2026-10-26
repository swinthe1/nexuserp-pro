-- =============================================================================
-- DrisPRO · each person arranges the large buttons of their start screen
--   A list of buttons per person and company (null = the ones chosen by their roles). What a person
--   may not open is never shown, whatever is in the list: the app checks each button against the
--   person's permissions, as everywhere.
-- =============================================================================
alter table public.company_members add column home_tiles text[] check (home_tiles is null or cardinality(home_tiles) <= 12);

create or replace function public.my_home_tiles_save(p_company uuid, p_tiles text[])
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if p_tiles is not null and (cardinality(p_tiles) > 12 or exists (select 1 from unnest(p_tiles) x where x !~ '^[a-z]+$' and x !~ '^/[A-Za-z0-9/_?=&-]*$')) then
    raise exception 'At most 12 buttons' using errcode = '22023';
  end if;
  update public.company_members set home_tiles = p_tiles
   where company_id = p_company and user_id = auth.uid() and deleted_at is null;
  if not found then raise exception 'Not a member of this company' using errcode = '42501'; end if;
end $$;
grant execute on function public.my_home_tiles_save(uuid, text[]) to authenticated;

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;
select app._patch_function('public.get_my_context',
  $x$'simple_view', coalesce(app.member_simple(m.id), false),$x$,
  $x$'simple_view', coalesce(app.member_simple(m.id), false), 'home_tiles', to_jsonb(m.home_tiles),$x$);
drop function app._patch_function(text, text, text);
