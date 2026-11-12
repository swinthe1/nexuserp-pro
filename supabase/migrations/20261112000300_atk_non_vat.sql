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

-- -----------------------------------------------------------------------------
-- The unit's registration number ("Numri i njësisë", given when the unit is registered): the first part of the
-- SEF's identification number printed on the coupon, [unit number]-[NUI]-[till] (Kërkesat, neni 25.18; Shtojca F).
-- -----------------------------------------------------------------------------
alter table public.warehouses add column if not exists atk_unit_no text check (atk_unit_no is null or atk_unit_no ~ '^[0-9A-Za-z]{1,12}$');
comment on column public.warehouses.atk_unit_no is 'the unit''s registration number, printed in the SEF identification number on the fiscal coupon';

do $$
declare d text; n text;
begin
  select pg_get_functiondef('public.atk_till(uuid)'::regprocedure) into d;
  if position('unit_no' in d) = 0 then
    n := replace(d, $a$'branch_id', w.atk_branch_id,$a$, $a$'branch_id', w.atk_branch_id, 'unit_no', w.atk_unit_no,$a$);
    if n = d then raise exception 'atk_till: the place for unit_no was not found'; end if;
    execute n;
  end if;
  select pg_get_functiondef('public.atk_setup(uuid)'::regprocedure) into d;
  if position('atk_unit_no' in d) = 0 then
    n := replace(d, $a$'city', w.city, 'atk_branch_id', w.atk_branch_id,$a$, $a$'city', w.city, 'atk_branch_id', w.atk_branch_id, 'atk_unit_no', w.atk_unit_no,$a$);
    if n = d then raise exception 'atk_setup: the stores were not found'; end if;
    execute n;
  end if;
  select pg_get_functiondef('public.atk_numbers_save(uuid, jsonb, jsonb)'::regprocedure) into d;
  if position('atk_unit_no' in d) = 0 then
    n := replace(d, $a$    update public.warehouses set atk_branch_id = nullif(x ->> 'atk_branch_id', '')::smallint where id = (x ->> 'id')::uuid and company_id = p_company;$a$,
$a$    update public.warehouses set atk_branch_id = nullif(x ->> 'atk_branch_id', '')::smallint,
           atk_unit_no = case when x ? 'atk_unit_no' then nullif(btrim(x ->> 'atk_unit_no'), '') else atk_unit_no end
     where id = (x ->> 'id')::uuid and company_id = p_company;$a$);
    if n = d then raise exception 'atk_numbers_save: the stores were not found'; end if;
    execute n;
  end if;
end $$;
