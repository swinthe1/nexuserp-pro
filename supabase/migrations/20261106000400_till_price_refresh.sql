-- =============================================================================
-- The deep check, phase 2: a till open all day learns the new prices. Every few minutes it asks what
-- changed since its last look (an item's price, name, barcodes, a price-list line, a customer price,
-- the promotions) and takes only those items; when a whole list or a tax rate changed, or the day turned
-- (prices valid from today), it reads the whole catalog again. A receipt already on the screen keeps its prices.
-- =============================================================================

-- the till's items, all of them or only some
create or replace function public.pos_catalog_part(p_register uuid, p_ids uuid[])
returns table (variant_id uuid, sku text, name text, category text, barcodes jsonb, price numeric, tax_code_id uuid, tax_rate numeric,
               tracking text, on_hand numeric, image_path text, product_type text, uom text, scale_plu text)
language sql stable set search_path = '' as $$
  select v.id, v.sku, v.name, c.name,
         coalesce((select jsonb_agg(jsonb_build_object('code', b.barcode, 'qty', b.quantity)) from public.product_barcodes b
                    where b.variant_id = v.id and b.deleted_at is null), '[]'::jsonb),
         round(coalesce(gp.unit_price * (1 - coalesce(gp.discount_pct, 0) / 100), coalesce(v.sales_price_override, p.sales_price))
               * (1 + coalesce(t.rate, 0) / 100), 2),
         p.sales_tax_code_id, coalesce(t.rate, 0), p.tracking,
         coalesce((select sum(sl.on_hand) from public.stock_levels sl where sl.variant_id = v.id and sl.location_id = r.location_id), 0),
         p.image_path, p.product_type, u.code, nullif(ltrim(p.scale_plu, '0'), '')
    from public.pos_registers r
    join public.product_variants v on v.company_id = r.company_id and v.is_active and v.deleted_at is null
    join public.products p on p.id = v.product_id and p.is_active and p.is_sellable and p.deleted_at is null
    left join public.product_categories c on c.id = p.category_id
    left join public.units_of_measure u on u.id = p.uom_id
    left join public.tax_codes t on t.id = p.sales_tax_code_id
    left join lateral public.get_price(r.company_id, r.default_customer_id, v.id, 1, current_date, r.price_list_id) gp on true
   where r.id = p_register and (p_ids is null or v.id = any(p_ids))
   order by v.name
$$;
revoke execute on function public.pos_catalog_part(uuid, uuid[]) from public, anon;
grant execute on function public.pos_catalog_part(uuid, uuid[]) to authenticated;

create or replace function public.pos_catalog(p_register uuid)
returns table (variant_id uuid, sku text, name text, category text, barcodes jsonb, price numeric, tax_code_id uuid, tax_rate numeric,
               tracking text, on_hand numeric, image_path text, product_type text, uom text, scale_plu text)
language sql stable set search_path = '' as $$
  select * from public.pos_catalog_part(p_register, null)
$$;

-- what changed for this till since its last look
create or replace function public.pos_catalog_changes(p_register uuid, p_since timestamptz)
returns jsonb language plpgsql stable set search_path = '' as $$
declare r public.pos_registers; v_tz text; v_ids uuid[]; v_items jsonb; v_now timestamptz := now();
begin
  select * into r from public.pos_registers where id = p_register;
  if r.id is null then raise exception 'Register not found' using errcode = 'P0002'; end if;
  perform app.require_permission(r.company_id, 'pos.read');
  v_tz := coalesce((select timezone from public.companies where id = r.company_id), 'Europe/Tirane');
  -- a new day (prices valid from today), a list or a tax rate changed: the whole catalog again
  if p_since is null or p_since < v_now - interval '12 hours'
     or (p_since at time zone v_tz)::date <> (v_now at time zone v_tz)::date
     or exists (select 1 from public.price_lists where company_id = r.company_id and updated_at > p_since)
     or exists (select 1 from public.tax_codes where (company_id = r.company_id or company_id is null) and updated_at > p_since) then
    return jsonb_build_object('at', v_now, 'full', true);
  end if;
  select array_agg(distinct x.id) into v_ids from (
    select v.id from public.product_variants v where v.company_id = r.company_id and v.updated_at > p_since
    union all
    select v.id from public.products p join public.product_variants v on v.product_id = p.id where p.company_id = r.company_id and p.updated_at > p_since
    union all
    select b.variant_id from public.product_barcodes b where b.company_id = r.company_id and b.updated_at > p_since
    union all
    select i.variant_id from public.price_list_items i where i.company_id = r.company_id and i.updated_at > p_since
    union all
    select pp.variant_id from public.partner_prices pp where pp.company_id = r.company_id and pp.partner_id = r.default_customer_id and pp.updated_at > p_since
  ) x where x.id is not null;
  -- a list that changes a lot at once: cheaper to read it all
  if cardinality(v_ids) > 2000 then
    return jsonb_build_object('at', v_now, 'full', true);
  end if;
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_items from public.pos_catalog_part(p_register, coalesce(v_ids, '{}')) c;
  return jsonb_build_object('at', v_now, 'full', false, 'items', v_items,
    -- changed and no longer sold here (switched off, deleted, not for sale)
    'gone', coalesce((select jsonb_agg(i) from unnest(v_ids) i where not exists (select 1 from jsonb_array_elements(v_items) e where (e ->> 'variant_id')::uuid = i)), '[]'::jsonb),
    'promotions', exists (select 1 from public.promotions where company_id = r.company_id and updated_at > p_since));
end $$;
revoke execute on function public.pos_catalog_changes(uuid, timestamptz) from public, anon;
grant execute on function public.pos_catalog_changes(uuid, timestamptz) to authenticated;
