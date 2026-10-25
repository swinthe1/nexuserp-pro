-- =============================================================================
-- NexusERP Pro · simpler menu
-- * company_settings.hidden_menu_sections: parts of the menu the company does not
--   use (e.g. Manufacturing in a shop), hidden for everyone in the company.
-- * save_my_preference(): one key of profiles.preferences (favourites in the menu,
--   open menu sections) without overwriting the other keys.
-- =============================================================================

alter table public.company_settings add column if not exists hidden_menu_sections text[] not null default '{}';

create or replace function public.save_my_preference(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not authenticated' using errcode = '28000'; end if;
  if p_key !~ '^[a-z_]{1,40}$' then raise exception 'Unknown preference %', p_key using errcode = '22023'; end if;
  if pg_column_size(p_value) > 8000 then raise exception 'Preference too large' using errcode = '22023'; end if;
  update public.profiles
     set preferences = jsonb_set(coalesce(preferences, '{}'::jsonb), array[p_key], coalesce(p_value, 'null'::jsonb), true)
   where id = auth.uid();
end $$;

revoke execute on function public.save_my_preference(text, jsonb) from public, anon;
grant execute on function public.save_my_preference(text, jsonb) to authenticated;
