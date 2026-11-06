-- =============================================================================
-- #8: the prices for the scale (Rongta RLS1100 with the RTPLU program). DrisPRO does not talk to the scale:
-- it reads the PLU file of RTPLU (.TXP), puts the prices of DrisPRO in it and gives it back; RTPLU sends it
-- to the scale ("Download PLU"). The hotkeys, labels and the other settings of the file stay as they were.
-- Here: the items with a PLU and their price with VAT, setting the PLU of many items at once (the first
-- time, from the names in the file), and the price each item had in the last file.
-- =============================================================================

alter table public.products
  add column if not exists scale_sent_price numeric(18,2),
  add column if not exists scale_sent_at    timestamptz;

-- the items of the scale: PLU, name, price with VAT now and in the last file
create or replace function public.scale_items(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'inventory.read');
  return coalesce((select jsonb_agg(jsonb_build_object(
           'product_id', p.id, 'variant_id', v.id, 'sku', v.sku,
           'name', case when v.is_default or coalesce(v.name, '') = '' then p.name else v.name end,
           'plu', nullif(ltrim(p.scale_plu, '0'), ''), 'uom', u.code,
           'price', round(coalesce(v.sales_price_override, p.sales_price, 0) * (1 + coalesce(tc.rate, 0) / 100), 2),
           'sent_price', p.scale_sent_price, 'sent_at', p.scale_sent_at)
           order by ltrim(p.scale_plu, '0')::bigint)
      from public.products p
      join lateral (select * from public.product_variants x where x.product_id = p.id and x.deleted_at is null
                     order by x.is_default desc, x.created_at limit 1) v on true
      left join public.units_of_measure u on u.id = p.uom_id
      left join public.tax_codes tc on tc.id = p.sales_tax_code_id
     where p.company_id = p_company and p.deleted_at is null and p.scale_plu is not null and nullif(ltrim(p.scale_plu, '0'), '') is not null), '[]'::jsonb);
end $$;
revoke execute on function public.scale_items(uuid) from public, anon;
grant execute on function public.scale_items(uuid) to authenticated;

-- the PLU of many items at once: [{product_id or variant_id, plu}] (plu empty takes it away)
create or replace function public.scale_plu_set(p_company uuid, p jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_plu text; n int := 0; v_other text;
begin
  perform app.require_permission(p_company, 'inventory.write');
  -- an item may come as its variant: the PLU belongs to the product
  p := coalesce((select jsonb_agg(x || jsonb_build_object('product_id', coalesce(x ->> 'product_id',
                   (select product_id::text from public.product_variants where id = nullif(x ->> 'variant_id', '')::uuid and company_id = p_company))))
                   from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x), '[]'::jsonb);
  -- first free the PLUs that move, so two items can swap them
  for r in select * from jsonb_array_elements(coalesce(p, '[]'::jsonb)) loop
    update public.products set scale_plu = null
     where id = (r ->> 'product_id')::uuid and company_id = p_company;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p, '[]'::jsonb)) loop
    v_plu := nullif(ltrim(btrim(coalesce(r ->> 'plu', '')), '0'), '');
    continue when v_plu is null;
    if v_plu !~ '^[0-9]{1,6}$' then raise exception 'The PLU is a number of up to 6 digits' using errcode = '22023'; end if;
    select name into v_other from public.products
     where company_id = p_company and deleted_at is null and ltrim(scale_plu, '0') = v_plu and id <> (r ->> 'product_id')::uuid;
    if v_other is not null then raise exception 'PLU % is already on %', v_plu, v_other using errcode = '23505'; end if;
    update public.products set scale_plu = v_plu where id = (r ->> 'product_id')::uuid and company_id = p_company and deleted_at is null;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke execute on function public.scale_plu_set(uuid, jsonb) from public, anon;
grant execute on function public.scale_plu_set(uuid, jsonb) to authenticated;

-- the file was made: the price of each item in it, to see later what changed since
create or replace function public.scale_mark_sent(p_company uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'inventory.read');
  update public.products pr set scale_sent_price = (x ->> 'price')::numeric, scale_sent_at = now()
    from jsonb_array_elements(coalesce(p, '[]'::jsonb)) x
   where pr.id = (x ->> 'product_id')::uuid and pr.company_id = p_company;
end $$;
revoke execute on function public.scale_mark_sent(uuid, jsonb) from public, anon;
grant execute on function public.scale_mark_sent(uuid, jsonb) to authenticated;
