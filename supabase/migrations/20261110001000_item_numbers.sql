-- =============================================================================
-- DrisPRO · the item's number (shifra): 1, 2, 3 … in the order the items were registered (10.11.2026)
--   · every item (variant) gets the next number of its company by itself, and keeps it;
--   · it works like a barcode: typed at the till, in the scanner, in search, on documents;
--   · the stock views show it, with the barcode.
-- =============================================================================

alter table public.product_variants add column if not exists item_no bigint;

-- the numbers of the items there already, in the order they were registered
with n as (select id, row_number() over (partition by company_id order by created_at, id) as rn from public.product_variants)
update public.product_variants v set item_no = n.rn from n where n.id = v.id and v.item_no is null;

create unique index if not exists product_variants_item_no_key on public.product_variants (company_id, item_no);

-- the last number given in each company
create table if not exists app.item_no_counters (company_id uuid primary key, last_no bigint not null default 0);
insert into app.item_no_counters (company_id, last_no)
select company_id, max(item_no) from public.product_variants group by company_id
on conflict (company_id) do update set last_no = greatest(app.item_no_counters.last_no, excluded.last_no);

create or replace function app.tg_variant_item_no() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.item_no is null then
    insert into app.item_no_counters (company_id, last_no) values (new.company_id, 1)
    on conflict (company_id) do update set last_no = app.item_no_counters.last_no + 1
    returning last_no into new.item_no;
  else
    -- a number that came with the row (a copy from another server, an import): the counter goes past it
    insert into app.item_no_counters (company_id, last_no) values (new.company_id, new.item_no)
    on conflict (company_id) do update set last_no = greatest(app.item_no_counters.last_no, excluded.last_no);
  end if;
  return new;
end $$;
drop trigger if exists trg_05_item_no on public.product_variants;
create trigger trg_05_item_no before insert on public.product_variants for each row execute function app.tg_variant_item_no();

-- the number stays the item's own
create or replace function app.tg_variant_item_no_keep() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.item_no is distinct from old.item_no then new.item_no := old.item_no; end if;
  return new;
end $$;
drop trigger if exists trg_05_item_no_keep on public.product_variants;
create trigger trg_05_item_no_keep before update of item_no on public.product_variants for each row execute function app.tg_variant_item_no_keep();

CREATE OR REPLACE FUNCTION app.fuzzy_variants(p_company uuid, p_query text)
 RETURNS TABLE(variant_id uuid, score integer)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
 SET "pg_trgm.word_similarity_threshold" TO '0.4'
AS $function$
declare v_raw text := btrim(coalesce(p_query, '')); v_key text := app.fuzzy_key(p_query); v_snd text; v_norm text := app.search_norm(p_query);
begin
  if v_raw = '' then return; end if;
  v_snd := app.search_sound(v_key);
  return query
  with c as materialized (
    select v.id from public.product_variants v where v.company_id = p_company and v.deleted_at is null and upper(v.sku) = upper(v_raw)
    union select v.id from public.product_variants v where v_raw ~ '^[0-9]{1,9}$' and v.company_id = p_company and v.deleted_at is null and v.item_no = v_raw::bigint
    union select b.variant_id from public.product_barcodes b where b.company_id = p_company and b.deleted_at is null and b.barcode = v_raw
    union select vp.variant_id from public.vendor_products vp where vp.company_id = p_company and vp.deleted_at is null and upper(vp.vendor_sku) = upper(v_raw)
    union select v.id from public.product_variants v where v_key <> '' and v.company_id = p_company and v.deleted_at is null
      and (app.search_norm(v.name) like '%' || v_key || '%' or v_key operator(extensions.<%) app.search_norm(v.name) or v_snd operator(extensions.<%) app.search_sounds(v.name))
    union select v.id from public.product_variants v join public.products p on p.id = v.product_id join public.product_categories cat on cat.id = p.category_id
     where v_key <> '' and v.company_id = p_company and v.deleted_at is null and app.search_norm(cat.name) like '%' || v_key || '%'
    union select v.id from public.product_variants v where v_key = '' and v.company_id = p_company and v.deleted_at is null
      and translate(lower(v.name), ',', '.') like '%' || v_norm || '%')
  select x.id, x.sc from (
    select v.id, app.fuzzy_score(v.name || ' ' || coalesce(cat.name, ''), p_query,
             array[v.sku, v.item_no::text] || coalesce((select array_agg(b.barcode) from public.product_barcodes b where b.variant_id = v.id and b.deleted_at is null), '{}')
                          || coalesce((select array_agg(vp.vendor_sku) from public.vendor_products vp where vp.variant_id = v.id and vp.deleted_at is null and vp.vendor_sku is not null), '{}')) as sc
      from c join public.product_variants v on v.id = c.id join public.products p on p.id = v.product_id
      left join public.product_categories cat on cat.id = p.category_id
     where p.deleted_at is null offset 0) x
   where x.sc > 0;
end $function$;

CREATE OR REPLACE FUNCTION public.find_variant_by_code(p_company uuid, p_code text)
 RETURNS TABLE(variant_id uuid, product_id uuid, sku text, name text, units_per_scan numeric, sales_price numeric, sales_tax_code_id uuid, tracking text, matched_by text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
  union all
  -- the item's number (shifra), typed by hand
  select v.id, v.product_id, v.sku, v.name, 1, coalesce(v.sales_price_override, p.sales_price), p.sales_tax_code_id, p.tracking, 'item_no'
    from public.product_variants v
    join public.products p on p.id = v.product_id and p.deleted_at is null
   where v.company_id = p_company and btrim(p_code) ~ '^[0-9]{1,9}$' and v.item_no = btrim(p_code)::bigint and v.deleted_at is null and v.is_active
  union all
  -- the PLU typed by hand (the number the scale knows the item by)
  select v.id, v.product_id, v.sku, v.name, 1, coalesce(v.sales_price_override, p.sales_price), p.sales_tax_code_id, p.tracking, 'plu'
    from public.products p
    join public.product_variants v on v.product_id = p.id and v.deleted_at is null and v.is_active
   where p.company_id = p_company and p.deleted_at is null and p.scale_plu is not null
     and btrim(p_code) ~ '^[0-9]{1,6}$' and ltrim(p.scale_plu, '0') = ltrim(btrim(p_code), '0')
  union all
  -- the scale's label: prefix, PLU, then the weight (or the price) inside the barcode
  select v.id, v.product_id, v.sku, v.name,
         case when s.cfg ->> 'value' = 'price'
              then round(substr(btrim(p_code), length(s.pre) + s.n + 1, 12 - length(s.pre) - s.n)::numeric / 100
                         / nullif(coalesce(v.sales_price_override, p.sales_price) * (1 + coalesce(t.rate, 0) / 100), 0), 3)
              else substr(btrim(p_code), length(s.pre) + s.n + 1, 12 - length(s.pre) - s.n)::numeric / 1000 end,
         coalesce(v.sales_price_override, p.sales_price), p.sales_tax_code_id, p.tracking, 'scale'
    from (select cs.scale_barcode as cfg, pre.pre, least(greatest(coalesce((cs.scale_barcode ->> 'plu_digits')::int, 5), 3), 6) as n
            from public.company_settings cs
            cross join lateral jsonb_array_elements_text(coalesce(cs.scale_barcode -> 'prefixes', '["21","22","23","24","25","26","27","28","29"]'::jsonb)) as pre(pre)
           where cs.company_id = p_company and coalesce((cs.scale_barcode ->> 'on')::boolean, true)
             and btrim(p_code) ~ '^[0-9]{13}$' and btrim(p_code) like pre.pre || '%') s
    join public.products p on p.company_id = p_company and p.deleted_at is null and p.scale_plu is not null
                          and ltrim(p.scale_plu, '0') = ltrim(substr(btrim(p_code), length(s.pre) + 1, s.n), '0')
    join public.product_variants v on v.product_id = p.id and v.deleted_at is null and v.is_active
    left join public.tax_codes t on t.id = p.sales_tax_code_id
  limit 5
$function$;

CREATE OR REPLACE FUNCTION public.pos_catalog_part(p_register uuid, p_ids uuid[])
 RETURNS TABLE(variant_id uuid, sku text, name text, category text, barcodes jsonb, price numeric, tax_code_id uuid, tax_rate numeric, tracking text, on_hand numeric, image_path text, product_type text, uom text, scale_plu text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select v.id, v.sku, v.name, c.name,
         coalesce((select jsonb_agg(jsonb_build_object('code', b.barcode, 'qty', b.quantity)) from public.product_barcodes b
                    where b.variant_id = v.id and b.deleted_at is null), '[]'::jsonb)
           -- the item's number (shifra) is typed at the till like a barcode
           || case when v.item_no is not null then jsonb_build_array(jsonb_build_object('code', v.item_no::text, 'qty', 1, 'shifra', true)) else '[]'::jsonb end,
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
$function$;

create or replace view public.v_product_stock with (security_invoker = true) as
 SELECT v.company_id,
    v.id AS variant_id,
    v.product_id,
    v.sku,
    v.name AS variant_name,
    v.is_active,
    p.code AS product_code,
    p.name AS product_name,
    p.product_type,
    p.tracking,
    p.category_id,
    pc.name AS category_name,
    u.code AS uom_code,
    COALESCE(v.sales_price_override, p.sales_price) AS sales_price,
    ( SELECT b.barcode
           FROM product_barcodes b
          WHERE ((b.variant_id = v.id) AND (b.deleted_at IS NULL))
          ORDER BY b.is_primary DESC, b.created_at
         LIMIT 1) AS barcode,
    COALESCE(s.on_hand, (0)::numeric) AS on_hand,
    COALESCE(s.reserved, (0)::numeric) AS reserved,
    COALESCE(s.available, (0)::numeric) AS available,
    COALESCE(( SELECT sum(i.incoming_qty) AS sum
           FROM v_incoming_stock i
          WHERE (i.variant_id = v.id)), (0)::numeric) AS incoming,
    COALESCE(ic.avg_cost, (0)::numeric) AS avg_cost,
    COALESCE(ic.total_value, (0)::numeric) AS stock_value,
    (EXISTS ( SELECT 1
           FROM stock_alerts a
          WHERE ((a.variant_id = v.id) AND (a.status = ANY (ARRAY['open'::text, 'acknowledged'::text]))))) AS is_low_stock,
    ( SELECT sum(r.min_qty) AS sum
           FROM replenishment_rules r
          WHERE ((r.variant_id = v.id) AND r.is_active AND (r.deleted_at IS NULL))) AS reorder_min,
    ( SELECT sum(r.max_qty) AS sum
           FROM replenishment_rules r
          WHERE ((r.variant_id = v.id) AND r.is_active AND (r.deleted_at IS NULL))) AS reorder_max,
    GREATEST(ia.last_movement, s.last_movement) AS last_movement,
    ia.last_sold,
    ia.last_received,
    ( SELECT string_agg(DISTINCT z.code, ' '::text) AS string_agg
           FROM ( SELECT b.barcode AS code
                   FROM product_barcodes b
                  WHERE ((b.variant_id = v.id) AND (b.deleted_at IS NULL))
                UNION
                 SELECT vp.vendor_sku
                   FROM vendor_products vp
                  WHERE ((vp.variant_id = v.id) AND (vp.deleted_at IS NULL) AND (vp.vendor_sku IS NOT NULL))
                UNION
                 SELECT (v.item_no)::text AS text) z) AS codes,
    v.item_no
   FROM ((((((product_variants v
     JOIN products p ON ((p.id = v.product_id)))
     LEFT JOIN product_categories pc ON ((pc.id = p.category_id)))
     JOIN units_of_measure u ON ((u.id = p.uom_id)))
     LEFT JOIN item_activity ia ON ((ia.variant_id = v.id)))
     LEFT JOIN item_costs ic ON (((ic.company_id = v.company_id) AND (ic.variant_id = v.id))))
     LEFT JOIN LATERAL ( SELECT sum(sl.on_hand) AS on_hand,
            sum(sl.reserved) AS reserved,
            sum(sl.available) AS available,
            (max(sl.last_movement_at))::date AS last_movement
           FROM stock_levels sl
          WHERE (sl.variant_id = v.id)) s ON (true))
  WHERE ((v.deleted_at IS NULL) AND (p.deleted_at IS NULL));

create or replace view public.v_stock_levels with (security_invoker = true) as
 SELECT sl.id,
    sl.company_id,
    sl.variant_id,
    v.product_id,
    v.sku,
    v.name AS variant_name,
    p.code AS product_code,
    p.name AS product_name,
    p.category_id,
    pc.name AS category_name,
    u.code AS uom_code,
    sl.warehouse_id,
    w.code AS warehouse_code,
    w.name AS warehouse_name,
    sl.location_id,
    l.code AS location_code,
    l.location_type,
    sl.lot_id,
    lt.lot_number,
    lt.expiry_date,
    sl.on_hand,
    sl.reserved,
    sl.available,
    COALESCE(ic.avg_cost, (0)::numeric) AS avg_cost,
    round((sl.on_hand * COALESCE(ic.avg_cost, (0)::numeric)), 2) AS stock_value,
    sl.last_movement_at,
    v.item_no,
    ( SELECT b.barcode FROM product_barcodes b WHERE ((b.variant_id = v.id) AND (b.deleted_at IS NULL)) ORDER BY b.is_primary DESC, b.created_at LIMIT 1) AS barcode
   FROM ((((((((stock_levels sl
     JOIN product_variants v ON ((v.id = sl.variant_id)))
     JOIN products p ON ((p.id = v.product_id)))
     LEFT JOIN product_categories pc ON ((pc.id = p.category_id)))
     JOIN units_of_measure u ON ((u.id = p.uom_id)))
     JOIN warehouses w ON ((w.id = sl.warehouse_id)))
     JOIN warehouse_locations l ON ((l.id = sl.location_id)))
     LEFT JOIN lots lt ON ((lt.id = sl.lot_id)))
     LEFT JOIN item_costs ic ON (((ic.company_id = sl.company_id) AND (ic.variant_id = sl.variant_id))))
  WHERE ((sl.on_hand <> (0)::numeric) OR (sl.reserved <> (0)::numeric));

create or replace view public.v_variant_options with (security_invoker = true) as
 SELECT v.company_id,
    v.id,
    v.sku,
    v.name,
    v.product_id,
    v.is_active,
    p.tracking,
    p.product_type,
    u.code AS uom_code,
    ic.avg_cost,
    COALESCE(v.sales_price_override, p.sales_price) AS sales_price,
    ( SELECT string_agg(DISTINCT z.code, ' '::text) AS string_agg
           FROM ( SELECT b.barcode AS code
                   FROM product_barcodes b
                  WHERE ((b.variant_id = v.id) AND (b.deleted_at IS NULL))
                UNION
                 SELECT vp.vendor_sku
                   FROM vendor_products vp
                  WHERE ((vp.variant_id = v.id) AND (vp.deleted_at IS NULL) AND (vp.vendor_sku IS NOT NULL))
                UNION
                 SELECT (v.item_no)::text AS text) z) AS codes,
    v.item_no
   FROM (((product_variants v
     JOIN products p ON ((p.id = v.product_id)))
     JOIN units_of_measure u ON ((u.id = p.uom_id)))
     LEFT JOIN item_costs ic ON (((ic.company_id = v.company_id) AND (ic.variant_id = v.id))))
  WHERE ((v.deleted_at IS NULL) AND (p.deleted_at IS NULL));
