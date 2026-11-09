-- =============================================================================
-- DrisPRO · making a computer a till at ATK, in a few clicks (10.11.2026)
--   · the store and till numbers ATK needs are given by the program: the store takes the next free store
--     number of the company, the till the next number ATK has never registered for that store; nobody types
--     them, and a number ATK already took is replaced by itself;
--   · a till can be added right there (name and store), with the store's shelf and the company's cash account.
-- =============================================================================

-- the numbers of one till, set when missing (or when ATK has taken the till's number already)
create or replace function public.atk_till_prepare(p_register uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.pos_registers; w public.warehouses; v_env text; v_branch int; v_pos int; v_changed boolean := false; v_was int;
begin
  select * into r from public.pos_registers where id = p_register and deleted_at is null for update;
  if r.id is null then raise exception 'Till not found' using errcode = 'P0002'; end if;
  if not app.atk_can(r.company_id, 'register') then raise exception 'Only a store manager registers a till with ATK' using errcode = '42501'; end if;
  select * into w from public.warehouses where id = r.warehouse_id for update;
  v_env := coalesce((select fiscal_environment from public.company_settings where company_id = r.company_id), 'test');

  v_branch := w.atk_branch_id;
  if v_branch is null then
    select min(n) into v_branch from generate_series(1, 999) n
     where not exists (select 1 from public.warehouses x where x.company_id = r.company_id and x.deleted_at is null and x.atk_branch_id = n);
    update public.warehouses set atk_branch_id = v_branch where id = w.id;
  end if;

  v_was := r.atk_pos_id;
  v_pos := r.atk_pos_id;
  if v_pos is null or app.atk_used(r.company_id, v_env, v_branch, v_pos)
     or exists (select 1 from public.pos_registers o where o.company_id = r.company_id and o.deleted_at is null and o.id <> r.id
                  and o.warehouse_id = r.warehouse_id and o.atk_pos_id = v_pos) then
    v_pos := app.atk_next_pos(r.company_id, v_env, v_branch);
    if v_pos is null then raise exception 'This store has no free till number at ATK left (1–99)' using errcode = '23514'; end if;
    update public.pos_registers set atk_pos_id = v_pos, atk_certificate = null where id = r.id;
    v_changed := v_was is not null;
  end if;

  return jsonb_build_object('branch', v_branch, 'pos', v_pos, 'env', v_env, 'replaced', case when v_changed then v_was end,
                            'missing', to_jsonb(app.atk_missing(r.id)));
end $$;

-- a new till from the ATK page: a name and a store; the rest is taken from the store and the company
create or replace function public.atk_till_new(p_warehouse uuid, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare w public.warehouses; v_loc uuid; v_cash uuid; v_code text; v_id uuid; n int := 1;
begin
  select * into w from public.warehouses where id = p_warehouse and deleted_at is null;
  if w.id is null then raise exception 'Warehouse not found' using errcode = 'P0002'; end if;
  if not app.atk_can(w.company_id, 'register') then raise exception 'Only a store manager registers a till with ATK' using errcode = '42501'; end if;
  if length(btrim(coalesce(p_name, ''))) = 0 then raise exception 'Give the till a name' using errcode = '23514'; end if;
  v_loc := app.main_location(w.id);
  if v_loc is null then raise exception 'Both units need a shelf where goods are kept' using errcode = '23514'; end if;
  v_cash := coalesce(
    (select cash_account_id from public.pos_registers where company_id = w.company_id and warehouse_id = w.id and deleted_at is null order by created_at limit 1),
    (select cash_account_id from public.pos_registers where company_id = w.company_id and deleted_at is null order by created_at limit 1),
    (select id from public.bank_accounts where company_id = w.company_id and account_kind = 'cash' and is_active and deleted_at is null order by created_at limit 1));
  if v_cash is null then raise exception 'Add a cash account first (Finance → Bank and cash)' using errcode = '23514'; end if;
  loop
    v_code := 'A' || n;
    exit when not exists (select 1 from public.pos_registers where company_id = w.company_id and code = v_code);
    n := n + 1;
  end loop;
  insert into public.pos_registers (company_id, code, name, warehouse_id, location_id, cash_account_id)
  values (w.company_id, v_code, left(btrim(p_name), 80), w.id, v_loc, v_cash)
  returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.atk_till_prepare(uuid), public.atk_till_new(uuid, text) from public, anon;
grant execute on function public.atk_till_prepare(uuid), public.atk_till_new(uuid, text) to authenticated;
