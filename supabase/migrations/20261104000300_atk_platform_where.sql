-- =============================================================================
-- DrisPRO · 20261104000300 · DrisPRO's numbers at ATK: the update names its row
-- (the API's sessions load pg_safeupdate, which refuses an UPDATE without WHERE)
-- =============================================================================
create or replace function public.atk_platform_save(p_test bigint, p_production bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_super_admin() then raise exception 'Only the platform admin sets DrisPRO''s numbers at ATK' using errcode = '42501'; end if;
  update public.platform_settings set atk_application_id_test = p_test, atk_application_id_prod = p_production where id;
end $$;
revoke execute on function public.atk_platform_save(bigint, bigint) from public, anon;
grant execute on function public.atk_platform_save(bigint, bigint) to authenticated;
