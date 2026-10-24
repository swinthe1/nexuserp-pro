-- =============================================================================
-- NexusERP Pro · migration centre: warehouses and the chart of accounts
-- Clients like Lider Market (Logmicro) bring their own stores and account codes.
--   warehouses: code, name, type (store|warehouse), address, city — matched by code
--   accounts:   code, name, type (asset|liability|equity|revenue|expense, or the
--               Compiere letters A/L/O/R/E), subtype (optional) — matched by code;
--               an account with postings keeps its type
-- =============================================================================

create or replace function app.migration_master(p_company uuid, p_kind text, p_rows jsonb, p_dry_run boolean, p_file text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; i int := 0; v_errors jsonb := '[]'::jsonb; v_ok int := 0; v_created int := 0; v_updated int := 0;
  v_err text; v_field text; v_id uuid; v_type text; v_sub text; v_code text; v_name text; c public.companies; v_used boolean;
begin
  select * into c from public.companies where id = p_company;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1; v_err := null; v_field := null;
    begin
      v_field := 'code'; v_code := nullif(btrim(r ->> 'code'), '');
      if v_code is null then v_err := 'Required'; end if;
      if v_err is null then
        v_field := 'name'; v_name := nullif(btrim(r ->> 'name'), '');
        if v_name is null then v_err := 'Required'; end if;
      end if;

      if v_err is null and p_kind = 'warehouses' then
        v_type := lower(coalesce(nullif(btrim(r ->> 'type'), ''), 'store'));
        if v_type in ('dyqan', 'njesi', 'njesia', 'shop') then v_type := 'store'; elsif v_type in ('magazine', 'depo') then v_type := 'warehouse'; end if;
        if v_type not in ('warehouse', 'store', 'production', 'transit') then v_field := 'type'; v_err := 'Use store or warehouse'; end if;
        if v_err is null and not p_dry_run then
          select id into v_id from public.warehouses where company_id = p_company and upper(code) = upper(v_code) and deleted_at is null;
          if v_id is null then
            insert into public.warehouses (company_id, code, name, warehouse_type, address_line1, city, country_code)
            values (p_company, v_code, v_name, v_type, nullif(btrim(r ->> 'address'), ''), nullif(btrim(r ->> 'city'), ''), c.country_code)
            returning id into v_id;
            -- the same standard locations as the main warehouse
            insert into public.warehouse_locations (company_id, warehouse_id, code, name, location_type, is_pickable) values
              (p_company, v_id, upper(v_code) || '/RECEIVING', 'Receiving', 'receiving', false),
              (p_company, v_id, upper(v_code) || '/STOCK',     'Stock',     'internal',  true),
              (p_company, v_id, upper(v_code) || '/SHIPPING',  'Shipping',  'shipping',  false);
            v_created := v_created + 1;
          else
            update public.warehouses set name = v_name, warehouse_type = v_type,
                   address_line1 = coalesce(nullif(btrim(r ->> 'address'), ''), address_line1), city = coalesce(nullif(btrim(r ->> 'city'), ''), city)
             where id = v_id;
            v_updated := v_updated + 1;
          end if;
        end if;

      elsif v_err is null and p_kind = 'accounts' then
        v_field := 'type';
        v_type := case upper(coalesce(btrim(r ->> 'type'), ''))
                    when 'A' then 'asset' when 'L' then 'liability' when 'O' then 'equity' when 'R' then 'revenue' when 'E' then 'expense'
                    when 'AKTIV' then 'asset' when 'PASIV' then 'liability' when 'KAPITAL' then 'equity' when 'TE HYRA' then 'revenue' when 'SHPENZIM' then 'expense'
                    else lower(btrim(coalesce(r ->> 'type', ''))) end;
        if v_type not in ('asset', 'liability', 'equity', 'revenue', 'expense') then v_err := 'Use asset, liability, equity, revenue or expense'; end if;
        if v_err is null then
          v_field := 'subtype';
          v_sub := coalesce(nullif(lower(btrim(r ->> 'subtype')), ''),
                            case v_type when 'asset' then 'current_asset' when 'liability' then 'current_liability' when 'equity' then 'equity'
                                        when 'revenue' then 'revenue' else 'expense' end);
          if v_sub not in ('cash','bank','receivable','inventory','current_asset','fixed_asset','accumulated_depreciation','non_current_asset','payable','tax',
                           'current_liability','long_term_liability','equity','retained_earnings','revenue','other_income','cogs','expense','depreciation','other_expense') then
            v_err := 'Unknown account subtype';
          end if;
        end if;
        if v_err is null and not p_dry_run then
          select id into v_id from public.accounts where company_id = p_company and code = v_code and deleted_at is null;
          if v_id is null then
            insert into public.accounts (company_id, code, name, account_type, account_subtype, is_postable, is_reconcilable, description)
            values (p_company, v_code, v_name, v_type, v_sub, true, v_sub in ('receivable', 'payable', 'bank'), 'Imported from the previous program');
            v_created := v_created + 1;
          else
            v_used := exists (select 1 from public.journal_lines where account_id = v_id);
            update public.accounts set name = v_name,
                   account_type = case when v_used then account_type else v_type end,
                   account_subtype = case when v_used then account_subtype else v_sub end
             where id = v_id;
            v_updated := v_updated + 1;
          end if;
        end if;
      end if;
    exception when others then
      v_err := sqlerrm;
    end;
    if v_err is not null then v_errors := v_errors || jsonb_build_object('row', i, 'field', v_field, 'message', v_err);
    else v_ok := v_ok + 1; end if;
  end loop;

  if not p_dry_run then
    insert into public.migration_runs (company_id, kind, file_name, rows, created, updated, skipped)
    values (p_company, p_kind, p_file, i, v_created, v_updated, jsonb_array_length(v_errors));
  end if;
  return jsonb_build_object('rows', i, 'ok', v_ok, 'created', case when p_dry_run then v_ok else v_created end, 'updated', v_updated, 'errors', v_errors);
end $$;
revoke execute on function app.migration_master(uuid, text, jsonb, boolean, text) from public, anon, authenticated;

-- route the two new kinds through migration_import (same permission checks and limits)
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;
select app._patch_function('public.migration_import',
  $x$if p_kind not in ('open_receivables','open_payables','opening_balances','price_lists') then$x$,
  $x$if p_kind not in ('open_receivables','open_payables','opening_balances','price_lists','warehouses','accounts') then$x$);
select app._patch_function('public.migration_import',
  $x$if jsonb_array_length(p_rows) > 20000 then raise exception 'Import at most 20,000 rows at a time' using errcode = '54000'; end if;$x$,
  $x$if jsonb_array_length(p_rows) > 20000 then raise exception 'Import at most 20,000 rows at a time' using errcode = '54000'; end if;
  if p_kind in ('warehouses','accounts') then return app.migration_master(p_company, p_kind, p_rows, p_dry_run, p_file); end if;$x$);
-- the check counts them too
create or replace function app.migration_extra(p_company uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'warehouses', (select count(*) from public.warehouses where company_id = p_company and deleted_at is null),
    'accounts_imported', (select count(*) from public.accounts where company_id = p_company and deleted_at is null and description = 'Imported from the previous program'))
$$;
revoke execute on function app.migration_extra(uuid) from public, anon;
grant execute on function app.migration_extra(uuid) to authenticated;

select app._patch_function('public.migration_check',
  $x$return jsonb_build_object($x$, $x$return app.migration_extra(p_company) || jsonb_build_object($x$);
drop function app._patch_function(text, text, text);
