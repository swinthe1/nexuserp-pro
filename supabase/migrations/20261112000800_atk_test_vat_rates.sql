-- =============================================================================
-- DrisPRO · 20261112000800 · ATK's test environment: try the VAT rates in a company not registered for VAT
-- A company with no VAT number sends every line under the 0 % letter (C). To try the letters A, D and E before the
-- technical test, a switch lets its coupons carry VAT by rate: only in ATK's test environment, never in the real one.
-- The coupon still has no VAT number at its head (the company has none).
-- =============================================================================
alter table public.company_settings add column if not exists atk_test_vat boolean not null default false;
comment on column public.company_settings.atk_test_vat is 'in ATK''s test environment only: coupons carry VAT by rate though the company is not registered for VAT';

create or replace function public.atk_test_vat_set(p_company uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_env text; v_old boolean;
begin
  if not app.atk_can(p_company, 'setup') then raise exception 'Only a manager with the tax rights sets the ATK numbers' using errcode = '42501'; end if;
  select fiscal_environment, atk_test_vat into v_env, v_old from public.company_settings where company_id = p_company;
  if p_on and v_env is distinct from 'test' then raise exception 'The VAT rates can be tried only in ATK''s test environment' using errcode = '23514'; end if;
  if coalesce(p_on, false) = v_old then return; end if;
  update public.company_settings set atk_test_vat = coalesce(p_on, false) where company_id = p_company;
  perform app.atk_change(p_company, null, 'test_vat', v_old::text, coalesce(p_on, false)::text);
end $$;
revoke execute on function public.atk_test_vat_set(uuid, boolean) from public, anon;
grant execute on function public.atk_test_vat_set(uuid, boolean) to authenticated;

do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.atk_till(uuid)'::regprocedure);
  n := replace(d, $a$'vat_registered', app.company_vat_registered(r.company_id),$a$,
                  $a$'vat_registered', app.company_vat_registered(r.company_id) or (s.atk_test_vat and s.fiscal_environment = 'test'),$a$);
  if n = d then raise exception 'atk_till: vat_registered was not found'; end if;
  execute n;
  d := pg_get_functiondef('public.atk_setup(uuid)'::regprocedure);
  n := replace(d, $a$'fiscalization_no', s.atk_fiscalization_no,$a$,
                  $a$'fiscalization_no', s.atk_fiscalization_no, 'test_vat', s.atk_test_vat, 'vat_registered', app.company_vat_registered(p_company),$a$);
  if n = d then raise exception 'atk_setup: the place was not found'; end if;
  execute n;
end $$;
