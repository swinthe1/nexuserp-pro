-- =============================================================================
-- DrisPRO Skaner (the handheld app): a new selling price scanned on the shop floor goes onto the
-- person's open "from the scanner" levelling (one per unit); a manager checks it and posts it.
-- =============================================================================
create or replace function public.level_add_line(p_company uuid, p_variant uuid, p_new_price numeric, p_warehouse uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_lv uuid; v_no int;
begin
  perform app.require_permission(p_company, 'inventory.write');
  if p_new_price is null or p_new_price < 0 then raise exception 'A price cannot be below zero' using errcode = '23514'; end if;
  if not exists (select 1 from public.product_variants where id = p_variant and company_id = p_company and deleted_at is null) then
    raise exception 'Item not found' using errcode = 'P0002';
  end if;
  perform app.check_warehouse(p_company, p_warehouse);
  select id into v_lv from public.price_levels
   where company_id = p_company and status = 'draft' and deleted_at is null and created_by = auth.uid()
     and warehouse_id is not distinct from p_warehouse and notes = 'Nga skaneri'
   order by created_at desc limit 1 for update;
  if v_lv is null then
    insert into public.price_levels (company_id, warehouse_id, notes) values (p_company, p_warehouse, 'Nga skaneri') returning id into v_lv;
  end if;
  update public.price_level_lines set new_price = round(p_new_price, 4) where level_id = v_lv and variant_id = p_variant;
  if not found then
    select coalesce(max(line_no), 0) + 1 into v_no from public.price_level_lines where level_id = v_lv;
    insert into public.price_level_lines (company_id, level_id, line_no, variant_id, new_price) values (p_company, v_lv, v_no, p_variant, round(p_new_price, 4));
  end if;
  return jsonb_build_object('id', v_lv, 'lines', (select count(*) from public.price_level_lines where level_id = v_lv));
end $$;
revoke execute on function public.level_add_line(uuid, uuid, numeric, uuid) from public, anon;
grant execute on function public.level_add_line(uuid, uuid, numeric, uuid) to authenticated;
