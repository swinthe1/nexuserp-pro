-- =============================================================================
-- "Njësi e re" in one step: the unit (kind, name, code, town, address, number at ATK), its places, its tills
-- (how many, retail or restaurant) and where its goods come from (it buys itself, or the central warehouse
-- supplies it). What used to be four pages is one form; the unit is ready to sell when it is saved.
-- =============================================================================

-- the unit that supplies this one (a market supplied by the central warehouse): transfers to it start there
alter table public.warehouses add column if not exists supplied_from_id uuid references public.warehouses (id);
-- like every link between the tables, checked at the end when a transaction asks (deleting a client)
do $$
declare r record;
begin
  for r in select con.conname, con.conrelid::regclass as tbl from pg_constraint con
            where con.contype = 'f' and con.connamespace = 'public'::regnamespace and not con.condeferrable loop
    execute format('alter table %s alter constraint %I deferrable initially immediate', r.tbl, r.conname);
  end loop;
end $$;

create or replace function public.unit_create(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_co uuid := (p ->> 'company_id')::uuid; v_code text := upper(btrim(coalesce(p ->> 'code', '')));
  v_kind text := coalesce(p ->> 'kind', 'store'); v_mode text; v_tills int := least(greatest(coalesce((p ->> 'tills')::int, 0), 0), 20);
  v_unit uuid; v_loc uuid; v_cash uuid; v_journal uuid; v_from uuid := nullif(p ->> 'supplied_from_id', '')::uuid; i int; v_regs jsonb := '[]';
  v_type text;
begin
  perform app.require_permission(v_co, 'inventory.write');
  if v_tills > 0 then perform app.require_permission(v_co, 'pos.write'); end if;
  if nullif(btrim(p ->> 'name'), '') is null then raise exception 'Write the name of the unit' using errcode = '23514'; end if;
  if v_code = '' then raise exception 'Write a short code for the unit' using errcode = '23514'; end if;
  if v_kind not in ('store', 'restaurant', 'warehouse', 'production') then raise exception 'Unknown kind of unit: %', v_kind using errcode = '23514'; end if;
  -- a restaurant or café is a shop with restaurant tills
  v_type := case v_kind when 'restaurant' then 'store' else v_kind end;
  v_mode := case when v_kind = 'restaurant' then 'restaurant' else 'retail' end;
  if v_kind in ('warehouse', 'production') then v_tills := 0; end if;
  if v_from is not null and not exists (select 1 from public.warehouses where id = v_from and company_id = v_co and deleted_at is null) then
    raise exception 'The supplying unit is not of this company' using errcode = '23514';
  end if;

  insert into public.warehouses (company_id, code, name, warehouse_type, city, address_line1, country_code, atk_branch_id, supplied_from_id)
  select v_co, v_code, btrim(p ->> 'name'), v_type, nullif(btrim(p ->> 'city'), ''), nullif(btrim(p ->> 'address'), ''), c.country_code,
         nullif(p ->> 'atk_branch_id', '')::int, v_from
    from public.companies c where c.id = v_co
  returning id into v_unit;
  perform app.unit_locations(v_co, v_unit, v_code);
  select id into v_loc from public.warehouse_locations where warehouse_id = v_unit and location_type = 'internal' order by code limit 1;

  if v_tills > 0 then
    -- the tills put their cash where the other tills of the company do (else the first cash box)
    select r.cash_account_id into v_cash from public.pos_registers r where r.company_id = v_co and r.deleted_at is null
     group by r.cash_account_id order by count(*) desc limit 1;
    v_cash := coalesce(v_cash, (select id from public.bank_accounts where company_id = v_co and account_kind = 'cash' and is_active and deleted_at is null order by created_at limit 1));
    if v_cash is null then raise exception 'Add a cash account first (Finance → Bank and cash)' using errcode = '23514'; end if;
    select id into v_journal from public.journals where company_id = v_co and code = 'POS';
    for i in 1 .. v_tills loop
      insert into public.pos_registers (company_id, code, name, warehouse_id, location_id, cash_account_id, journal_id, mode, price_list_id)
      values (v_co, v_code || '-' || i, 'Arka ' || i || ' – ' || btrim(p ->> 'name'), v_unit, v_loc, v_cash, v_journal, v_mode,
              nullif(p ->> 'price_list_id', '')::uuid);
      v_regs := v_regs || jsonb_build_array(v_code || '-' || i);
    end loop;
  end if;
  return jsonb_build_object('id', v_unit, 'tills', v_regs);
end $$;
revoke execute on function public.unit_create(jsonb) from public, anon;
grant execute on function public.unit_create(jsonb) to authenticated;
