-- =============================================================================
-- An item is found by any of its codes: our code, every barcode, and the article number
-- each supplier gives it (vendor_products.vendor_sku). Asked for by accountants:
-- "when items are registered, let me look them up by name, barcode and the supplier's article number".
-- =============================================================================

-- the lists behind every item picker carry all the codes (searched, not shown)
do $$
declare v_def text;
  v_codes constant text := E',\n    ( SELECT string_agg(DISTINCT z.code, '' '') FROM ( SELECT b.barcode AS code FROM product_barcodes b WHERE b.variant_id = v.id AND b.deleted_at IS NULL'
    || ' UNION SELECT vp.vendor_sku FROM vendor_products vp WHERE vp.variant_id = v.id AND vp.deleted_at IS NULL AND vp.vendor_sku IS NOT NULL) z) AS codes';
begin
  perform set_config('search_path', 'public', true);
  v_def := pg_get_viewdef('public.v_variant_options'::regclass, true);
  if position('AS codes' in v_def) = 0 then
    execute 'create or replace view public.v_variant_options with (security_invoker = true) as '
      || replace(v_def, E'\n   FROM product_variants v', v_codes || E'\n   FROM product_variants v');
  end if;
  v_def := pg_get_viewdef('public.v_product_stock'::regclass, true);
  if position('AS codes' in v_def) = 0 then
    execute 'create or replace view public.v_product_stock with (security_invoker = true) as '
      || replace(v_def, E'\n   FROM product_variants v', v_codes || E'\n   FROM product_variants v');
  end if;
end $$;

-- a scan or a typed code: the supplier's article number works too
create or replace function public.find_variant_by_code(p_company uuid, p_code text)
returns table (variant_id uuid, product_id uuid, sku text, name text, units_per_scan numeric, sales_price numeric, sales_tax_code_id uuid, tracking text, matched_by text)
language sql stable set search_path = '' as $$
  select v.id, v.product_id, v.sku, v.name, b.quantity, coalesce(v.sales_price_override, p.sales_price),
         p.sales_tax_code_id, p.tracking, 'barcode'
    from public.product_barcodes b
    join public.product_variants v on v.id = b.variant_id and v.deleted_at is null and v.is_active
    join public.products p on p.id = v.product_id and p.deleted_at is null
   where b.company_id = p_company and b.barcode = btrim(p_code) and b.deleted_at is null
  union all
  select v.id, v.product_id, v.sku, v.name, 1, coalesce(v.sales_price_override, p.sales_price),
         p.sales_tax_code_id, p.tracking, 'sku'
    from public.product_variants v
    join public.products p on p.id = v.product_id and p.deleted_at is null
   where v.company_id = p_company and upper(v.sku) = upper(btrim(p_code)) and v.deleted_at is null and v.is_active
  union all
  select distinct on (v.id) v.id, v.product_id, v.sku, v.name, 1, coalesce(v.sales_price_override, p.sales_price),
         p.sales_tax_code_id, p.tracking, 'vendor_code'
    from public.vendor_products vp
    join public.product_variants v on v.id = vp.variant_id and v.deleted_at is null and v.is_active
    join public.products p on p.id = v.product_id and p.deleted_at is null
   where vp.company_id = p_company and upper(vp.vendor_sku) = upper(btrim(p_code)) and vp.deleted_at is null
  limit 5
$$;

-- an invoice read from a photo fills in the supplier's code of an item that had none yet
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.doc_read_to_receipt'::regproc);
  if position('on conflict (vendor_id, variant_id) where deleted_at is null do nothing' in v_def) > 0 then
    execute replace(v_def, 'on conflict (vendor_id, variant_id) where deleted_at is null do nothing',
      'on conflict (vendor_id, variant_id) where deleted_at is null do update set vendor_sku = coalesce(public.vendor_products.vendor_sku, excluded.vendor_sku)');
  end if;
end $$;
