-- =============================================================================
-- DrisPRO · Albania: live fiscalization cannot be switched on before the CIS link exists (audit, wave 1)
--   In live mode every Albanian document would be refused (there is no connection to the tax office
--   yet), so the switch to live is stopped with a clear message. Test mode works as before, and
--   Kosovo is not touched.
-- =============================================================================
create or replace function app.tg_fiscal_al_live()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.fiscal_environment = 'production' and (tg_op = 'INSERT' or old.fiscal_environment is distinct from 'production')
     and (select c.country_code from public.companies c where c.id = new.company_id) = 'AL' then
    raise exception 'Live fiscalization in Albania needs the link with the tax office (CIS), which is not ready yet: keep the test mode'
      using errcode = '55000';
  end if;
  return new;
end $$;
drop trigger if exists trg_20_fiscal_al_live on public.company_settings;
create trigger trg_20_fiscal_al_live before insert or update of fiscal_environment on public.company_settings
  for each row execute function app.tg_fiscal_al_live();
