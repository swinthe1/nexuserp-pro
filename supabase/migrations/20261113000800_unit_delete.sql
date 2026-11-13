-- =============================================================================
-- A client's unit deleted by the platform. Only a unit with nothing behind it: no stock, no movement, no
-- receipt, no till day, no document. One that has a history is made "not active" instead (its documents
-- stay readable and the books stay whole). Deleting takes its places and tills with it.
-- =============================================================================

-- what a unit has behind it, by kind; empty when it can go
create or replace function app.unit_history(p_unit uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb := '{}'; n bigint; t text; q text;
begin
  foreach t in array array[
    'stock_movements:from_warehouse_id = $1 or to_warehouse_id = $1',
    'stock_levels:warehouse_id = $1 and on_hand <> 0',
    'goods_receipts:warehouse_id = $1',
    'vendor_bills:warehouse_id = $1',
    'vendor_returns:warehouse_id = $1',
    'purchase_orders:warehouse_id = $1',
    'sales_orders:warehouse_id = $1',
    'deliveries:warehouse_id = $1',
    'stock_transfers:from_warehouse_id = $1 or to_warehouse_id = $1',
    'stock_adjustments:warehouse_id = $1',
    'count_sessions:warehouse_id = $1',
    'cycle_counts:warehouse_id = $1',
    'table_orders:warehouse_id = $1',
    'history_documents:warehouse_id = $1',
    'sync_till_sales:warehouse_id = $1',
    'work_orders:warehouse_id = $1',
    'pos_sessions:register_id in (select id from public.pos_registers where warehouse_id = $1)'
  ] loop
    if to_regclass('public.' || split_part(t, ':', 1)) is null then continue; end if;
    q := format('select count(*) from public.%I where %s', split_part(t, ':', 1), substr(t, position(':' in t) + 1));
    begin
      execute q into n using p_unit;
    exception when undefined_column then n := 0;
    end;
    if n > 0 then r := r || jsonb_build_object(split_part(t, ':', 1), n); end if;
  end loop;
  return r;
end $$;
revoke execute on function app.unit_history(uuid) from public, anon, authenticated;

create or replace function public.platform_unit_delete(p_unit uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare w public.warehouses; h jsonb;
begin
  perform app.require_super_admin();
  select * into w from public.warehouses where id = p_unit and deleted_at is null for update;
  if w.id is null then raise exception 'This unit does not exist' using errcode = 'P0002'; end if;
  if w.warehouse_type = 'transit' then raise exception 'The goods on the way are not a unit to delete' using errcode = '23514'; end if;
  h := app.unit_history(p_unit);
  if h <> '{}' then
    return jsonb_build_object('deleted', false, 'history', h);
  end if;
  update public.pos_registers set deleted_at = now(), is_active = false where warehouse_id = w.id and deleted_at is null;
  update public.warehouse_locations set is_active = false where warehouse_id = w.id;
  update public.warehouses set supplied_from_id = null where supplied_from_id = w.id;
  update public.company_settings set default_warehouse_id = null where default_warehouse_id = w.id;
  update public.warehouses set deleted_at = now(), is_active = false, code = left(code || '~' || to_char(now(), 'YYMMDDHH24MISS'), 40) where id = w.id;
  perform app.platform_log('unit_deleted', w.company_id, jsonb_build_object('unit', w.name, 'code', w.code));
  return jsonb_build_object('deleted', true);
end $$;
revoke execute on function public.platform_unit_delete(uuid) from public, anon;
grant execute on function public.platform_unit_delete(uuid) to authenticated;

-- the list says which units can go
create or replace function public.platform_client_units(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  return jsonb_build_object(
    'limit', (select coalesce(l.max_warehouses, app.plan_max_warehouses(l.plan)) from public.licenses l where l.company_id = p_company),
    'restaurant', app.has_feature(p_company, 'restaurant'),
    'units', coalesce((select jsonb_agg(jsonb_build_object(
        'id', w.id, 'code', w.code, 'name', w.name, 'category', w.unit_category, 'type', w.warehouse_type, 'city', w.city,
        'address', w.address_line1, 'atk_branch_id', w.atk_branch_id, 'atk_unit_no', w.atk_unit_no, 'is_active', w.is_active,
        'supplied_from_id', w.supplied_from_id,
        'tills', (select count(*) from public.pos_registers r where r.warehouse_id = w.id and r.deleted_at is null and r.is_active),
        'restaurant_tills', (select count(*) from public.pos_registers r where r.warehouse_id = w.id and r.deleted_at is null and r.is_active and r.mode = 'restaurant'),
        'can_delete', app.unit_history(w.id) = '{}')
      order by w.is_active desc, w.code)
      from public.warehouses w where w.company_id = p_company and w.deleted_at is null and w.warehouse_type <> 'transit'), '[]'));
end $$;
