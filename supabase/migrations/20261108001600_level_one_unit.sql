-- =============================================================================
-- DrisPRO · a levelling can change the price in one unit only (audit, wave 1)
--   "Only in this unit": the new prices go into the unit's own price list, which the unit's tills
--   use; the item's price elsewhere stays as it is. The unit's list is made the first time (named
--   after the unit) and given to the unit's tills that had no list of their own.
-- =============================================================================
alter table public.price_levels add column if not exists only_here boolean not null default false;
alter table public.price_levels drop constraint if exists price_levels_only_here_unit;
alter table public.price_levels add constraint price_levels_only_here_unit check (not only_here or warehouse_id is not null);

-- the price list of a unit's tills: the one they all use, or a new one named after the unit
create or replace function app.unit_price_list(p_company uuid, p_warehouse uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_list uuid; v_n int;
begin
  select count(distinct r.price_list_id), min(r.price_list_id::text)::uuid into v_n, v_list
    from public.pos_registers r where r.company_id = p_company and r.warehouse_id = p_warehouse and r.deleted_at is null and r.price_list_id is not null;
  if v_n = 1 then return v_list; end if;
  select pl.id into v_list from public.price_lists pl
   where pl.company_id = p_company and pl.deleted_at is null and pl.name = 'Çmimet e ' || (select name from public.warehouses where id = p_warehouse);
  if v_list is null then
    insert into public.price_lists (company_id, name, list_type, currency_code, prices_include_tax, is_default, is_active)
    values (p_company, 'Çmimet e ' || (select name from public.warehouses where id = p_warehouse), 'sales',
            (select base_currency from public.companies where id = p_company), false, false, true)
    returning id into v_list;
  end if;
  update public.pos_registers set price_list_id = v_list
   where company_id = p_company and warehouse_id = p_warehouse and deleted_at is null and price_list_id is null;
  return v_list;
end $$;
revoke all on function app.unit_price_list(uuid, uuid) from public, anon, authenticated;

create or replace function public.price_level_post(p_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare h public.price_levels; l record; v_single boolean; v_total numeric := 0; n int := 0; v_qty numeric; v_old numeric; v_list uuid;
begin
  select * into h from public.price_levels where id = p_id and deleted_at is null for update;
  if h.id is null then raise exception 'Price levelling not found' using errcode = 'P0002'; end if;
  perform app.require_permission(h.company_id, 'inventory.write');
  if h.status <> 'draft' then raise exception 'It is already posted' using errcode = '55000'; end if;
  if not exists (select 1 from public.price_level_lines where level_id = h.id) then raise exception 'Add at least one item' using errcode = '23514'; end if;
  perform app.check_warehouse(h.company_id, h.warehouse_id);
  if h.only_here then v_list := app.unit_price_list(h.company_id, h.warehouse_id); end if;

  for l in select pl.*, v.product_id, v.sales_price_override, p.sales_price, coalesce(tc.rate, 0) rate
             from public.price_level_lines pl join public.product_variants v on v.id = pl.variant_id join public.products p on p.id = v.product_id
             left join public.tax_codes tc on tc.id = p.sales_tax_code_id
            where pl.level_id = h.id order by pl.line_no loop
    v_old := coalesce(l.sales_price_override, l.sales_price, 0);
    if h.only_here then
      -- the unit's own price, when it has one
      v_old := coalesce((select i.price from public.price_list_items i where i.price_list_id = v_list and i.variant_id = l.variant_id and i.deleted_at is null
                           and i.min_quantity <= 1 and (i.valid_from is null or i.valid_from <= current_date) and (i.valid_to is null or i.valid_to >= current_date)
                         order by i.min_quantity desc limit 1), v_old);
    end if;
    select coalesce(sum(on_hand), 0) into v_qty from public.stock_levels where variant_id = l.variant_id and (h.warehouse_id is null or warehouse_id = h.warehouse_id);
    update public.price_level_lines set old_price = v_old, quantity = v_qty,
           value_change = round(v_qty * (l.new_price - v_old) * (1 + l.rate / 100), 2) where id = l.id;
    v_total := v_total + round(v_qty * (l.new_price - v_old) * (1 + l.rate / 100), 2);
    continue when round(v_old, 4) = round(l.new_price, 4);
    if h.only_here then
      update public.price_list_items set deleted_at = now()
       where price_list_id = v_list and variant_id = l.variant_id and min_quantity = 1 and deleted_at is null;
      insert into public.price_list_items (company_id, price_list_id, variant_id, min_quantity, price, valid_from)
      values (h.company_id, v_list, l.variant_id, 1, l.new_price, h.level_date);
    else
      -- the item's price when it has one variant (or the variant had none of its own), else the variant's
      v_single := (select count(*) from public.product_variants where product_id = l.product_id and deleted_at is null) = 1;
      if l.sales_price_override is not null and not v_single then
        update public.product_variants set sales_price_override = l.new_price where id = l.variant_id;
      else
        update public.products set sales_price = l.new_price where id = l.product_id;
        if l.sales_price_override is not null then update public.product_variants set sales_price_override = null where id = l.variant_id; end if;
      end if;
    end if;
    n := n + 1;
  end loop;
  update public.price_levels set status = 'posted', posted_at = now(), posted_by = auth.uid(), value_change = v_total where id = h.id;
  -- the price history knows which document changed them
  update public.price_changes c set doc_number = h.number, warehouse_id = coalesce(c.warehouse_id, h.warehouse_id)
   where c.company_id = h.company_id and c.created_at = now() and c.doc_number is null
     and c.variant_id in (select variant_id from public.price_level_lines where level_id = h.id);
  return jsonb_build_object('changed', n, 'value_change', v_total, 'number', h.number, 'price_list_id', v_list);
end $$;
