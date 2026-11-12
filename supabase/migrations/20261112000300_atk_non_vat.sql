-- =============================================================================
-- DrisPRO · 20261112000300 · ATK's technical test: a taxpayer not registered for VAT
-- Its coupon carries no VAT number and no VAT: every line goes under the 0 % letter ("C"), not under the
-- exempt one ("A", for supplies the VAT law exempts). The till is told whether the company is registered.
-- =============================================================================
do $$
declare d text; n text;
begin
  select pg_get_functiondef('public.atk_till(uuid)'::regprocedure) into d;
  if position('vat_registered' in d) > 0 then return; end if;
  n := replace(d, $a$'default_type', s.atk_default_type,$a$, $a$'default_type', s.atk_default_type, 'vat_registered', app.company_vat_registered(r.company_id),$a$);
  if n = d then raise exception 'atk_till: the place for vat_registered was not found'; end if;
  execute n;
end $$;
