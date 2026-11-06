-- =============================================================================
-- #17 again: the highest value of one till receipt, set for each unit. A unit with its own limit uses it; a
-- unit with none uses the company's limit (and with no company limit either, there is none).
-- =============================================================================

alter table public.warehouses add column if not exists pos_receipt_max numeric(18,2)
  check (pos_receipt_max is null or pos_receipt_max > 0);

-- the limit a register works with: its unit's, otherwise the company's
create or replace function app.receipt_max(p_register uuid)
returns numeric language sql stable set search_path = '' as $$
  select coalesce(w.pos_receipt_max, cs.pos_receipt_max)
    from public.pos_registers r
    join public.warehouses w on w.id = r.warehouse_id
    left join public.company_settings cs on cs.company_id = r.company_id
   where r.id = p_register
$$;

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;

select app._patch_function('public.pos_till_options',
  $x$    'receipt_max', (select pos_receipt_max from public.company_settings where company_id = v_co),$x$,
  $x$    'receipt_max', app.receipt_max(p_register),$x$);

select app._patch_function('public.pos_submit_order',
  $x$  if not v_refund and not v_offline and v_total > coalesce((select pos_receipt_max from public.company_settings where company_id = s.company_id), 'infinity'::numeric) then
    raise exception 'One receipt can be at most %; this one is %', to_char((select pos_receipt_max from public.company_settings where company_id = s.company_id), 'FM999G999G990D00'),$x$,
  $x$  if not v_refund and not v_offline and v_total > coalesce(app.receipt_max(s.register_id), 'infinity'::numeric) then
    raise exception 'One receipt can be at most %; this one is %', to_char(app.receipt_max(s.register_id), 'FM999G999G990D00'),$x$);

drop function app._patch_function(text, text, text);

-- the units that sell at a till (and any that still has a limit of its own), with their limit
create or replace function public.pos_receipt_max_units(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'pos.read');
  return coalesce((select jsonb_agg(jsonb_build_object('warehouse_id', w.id, 'code', w.code, 'name', w.name, 'receipt_max', w.pos_receipt_max,
                                                        'registers', (select count(*) from public.pos_registers r where r.warehouse_id = w.id and r.deleted_at is null))
                                    order by w.name)
                     from public.warehouses w
                    where w.company_id = p_company and w.deleted_at is null
                      and (w.pos_receipt_max is not null
                           or exists (select 1 from public.pos_registers r where r.warehouse_id = w.id and r.deleted_at is null))), '[]'::jsonb);
end $$;
revoke execute on function public.pos_receipt_max_units(uuid) from public, anon;
grant execute on function public.pos_receipt_max_units(uuid) to authenticated;

-- empty (null) = the unit follows the company's limit
create or replace function public.pos_receipt_max_unit_save(p_company uuid, p_warehouse uuid, p_value numeric)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'pos.approve');
  if p_value is not null and p_value <= 0 then raise exception 'The limit must be more than zero' using errcode = '22023'; end if;
  update public.warehouses set pos_receipt_max = p_value where id = p_warehouse and company_id = p_company and deleted_at is null;
  if not found then raise exception 'Warehouse not found' using errcode = 'P0002'; end if;
end $$;
revoke execute on function public.pos_receipt_max_unit_save(uuid, uuid, numeric) from public, anon;
grant execute on function public.pos_receipt_max_unit_save(uuid, uuid, numeric) to authenticated;
