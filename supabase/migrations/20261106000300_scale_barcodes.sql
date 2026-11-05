-- =============================================================================
-- The deep check, phase 2: the scale's barcodes. A scale prints a 13-digit barcode with the item's PLU
-- and the weight (or the price) inside: 2 digits of prefix, the PLU, the weight in grams, a check digit.
-- The till reads it: the item by its PLU, the quantity from the weight (or the price divided by the
-- item's price). The company sets the prefixes, the PLU's length and what the scale puts inside.
-- =============================================================================

alter table public.products add column if not exists scale_plu text check (scale_plu is null or scale_plu ~ '^[0-9]{1,6}$');
create unique index if not exists products_scale_plu_key on public.products (company_id, (ltrim(scale_plu, '0'))) where scale_plu is not null and deleted_at is null;

alter table public.company_settings add column if not exists scale_barcode jsonb not null
  default '{"on": true, "prefixes": ["21", "22", "23", "24", "25", "26", "27", "28", "29"], "plu_digits": 5, "value": "weight"}'::jsonb;

-- the till's items carry their PLU
drop function if exists public.pos_catalog(uuid);
create function public.pos_catalog(p_register uuid)
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
   where r.id = p_register
   order by v.name
$$;
revoke execute on function public.pos_catalog(uuid) from public, anon;
grant execute on function public.pos_catalog(uuid) to authenticated;

-- the till knows how this company's scales print
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
  $x$    'receipt_max', (select pos_receipt_max from public.company_settings where company_id = v_co),
    'scale', (select scale_barcode from public.company_settings where company_id = v_co),$x$);
select app._patch_function('public.automation_settings_save',
  $x$'pos_void_notify_over', 'pos_void_whatsapp', 'pos_receipt_max'] then$x$,
  $x$'pos_void_notify_over', 'pos_void_whatsapp', 'pos_receipt_max', 'scale_barcode'] then$x$);
select app._patch_function('public.automation_settings_save',
  $x$    pos_payouts = coalesce(p_patch ->> 'pos_payouts', pos_payouts),$x$,
  $x$    pos_payouts = coalesce(p_patch ->> 'pos_payouts', pos_payouts),
    scale_barcode = case when jsonb_typeof(p_patch -> 'scale_barcode') = 'object' then p_patch -> 'scale_barcode' else scale_barcode end,$x$);
drop function app._patch_function(text, text, text);
