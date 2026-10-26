-- =============================================================================
-- Packaging units and labels
--   * product_packs: an item can be bought and sold by the box, the crate, the
--     pallet (box = 24 pieces). A document line may carry the pack and the
--     number of packs; the quantity in pieces follows from them, so stock,
--     costs and prices stay per piece.
--   * printed documents show the packs beside the quantity (2 Kuti × 24 + 3)
--   * label_items: what goes on shelf, price and barcode labels, from a choice
--     of items, a goods receipt, a purchase invoice or the recent price changes
-- =============================================================================

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- -----------------------------------------------------------------------------
-- 1. Packs of a product
-- -----------------------------------------------------------------------------
create table public.product_packs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id),
  product_id  uuid not null,
  name        text not null check (length(btrim(name)) between 1 and 40),
  factor      numeric(18,4) not null check (factor > 0),
  barcode     text,
  is_default  boolean not null default false,
  foreign key (company_id, product_id) references public.products(company_id, id)
);
select app.register_table('public.product_packs', 'inventory');
create unique index product_packs_name_key on public.product_packs (product_id, lower(btrim(name))) where deleted_at is null;
create unique index product_packs_one_default on public.product_packs (product_id) where is_default and deleted_at is null;
create index product_packs_company_idx on public.product_packs (company_id) where deleted_at is null;

-- the pack's own barcode is a barcode of the item that counts as `factor` pieces per scan
create or replace function app.tg_pack_barcode()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_variant uuid; v_row record; v_new text;
begin
  if tg_op <> 'INSERT' and old.barcode is not null
     and (tg_op = 'DELETE' or new.deleted_at is not null or new.barcode is distinct from old.barcode) then
    delete from public.product_barcodes b
     where b.company_id = old.company_id and b.barcode = old.barcode and b.deleted_at is null and b.quantity = old.factor;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  v_new := nullif(btrim(new.barcode), '');
  if v_new is null or new.deleted_at is not null then return new; end if;
  if tg_op = 'UPDATE' and v_new is not distinct from old.barcode and new.factor = old.factor and old.deleted_at is null then return new; end if;

  select v.id into v_variant from public.product_variants v
   where v.product_id = new.product_id and v.deleted_at is null order by v.is_default desc, v.created_at limit 1;
  select b.id, b.variant_id into v_row from public.product_barcodes b
   where b.company_id = new.company_id and b.barcode = v_new and b.deleted_at is null;
  if v_row.id is not null then
    if v_row.variant_id not in (select v.id from public.product_variants v where v.product_id = new.product_id) then
      raise exception 'Barcode % already belongs to another item', v_new using errcode = '23505';
    end if;
    update public.product_barcodes set quantity = new.factor where id = v_row.id;
  else
    insert into public.product_barcodes (company_id, variant_id, barcode, symbology, quantity)
    values (new.company_id, v_variant, v_new,
            case when v_new ~ '^[0-9]{13}$' then 'ean13' when v_new ~ '^[0-9]{8}$' then 'ean8' else 'code128' end, new.factor);
  end if;
  return new;
end $$;
create trigger trg_50_barcode after insert or update or delete on public.product_packs
  for each row execute function app.tg_pack_barcode();

-- -----------------------------------------------------------------------------
-- 2. Packs on document lines
-- -----------------------------------------------------------------------------
create or replace function app.tg_line_pack()
returns trigger language plpgsql set search_path = '' as $$
declare v_f numeric; v_prod uuid;
begin
  if new.pack_id is null then new.pack_qty := null; return new; end if;
  select k.factor, k.product_id into v_f, v_prod from public.product_packs k where k.id = new.pack_id and k.company_id = new.company_id;
  if v_f is null then raise exception 'Packaging not found' using errcode = 'P0002'; end if;
  if new.variant_id is null or not exists (select 1 from public.product_variants v where v.id = new.variant_id and v.product_id = v_prod) then
    raise exception 'This packaging belongs to another item' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.pack_qty is not distinct from old.pack_qty and new.pack_id is not distinct from old.pack_id
     and new.quantity is distinct from old.quantity then
    new.pack_qty := round(new.quantity / v_f, 4);          -- the quantity was changed in pieces
  elsif new.pack_qty is null then
    new.pack_qty := round(new.quantity / v_f, 4);
  else
    if new.pack_qty <= 0 then raise exception 'Enter the number of packs' using errcode = '23514'; end if;
    new.quantity := round(new.pack_qty * v_f, 4);
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['sales_quote_lines', 'sales_order_lines', 'sales_invoice_lines', 'purchase_order_lines', 'vendor_bill_lines'] loop
    execute format('alter table public.%I add column if not exists pack_id uuid, add column if not exists pack_qty numeric(18,4)', t);
    execute format('alter table public.%I add constraint %I foreign key (company_id, pack_id) references public.product_packs(company_id, id)', t, t || '_pack_fkey');
    execute format('create trigger trg_03_pack before insert or update of pack_id, pack_qty, quantity, variant_id on public.%I for each row execute function app.tg_line_pack()', t);
  end loop;
end $$;

-- "2 Kuti × 24 + 3": the quantity in packs (the line's pack, or the item's main pack)
create or replace function app.pack_text(p_variant uuid, p_qty numeric, p_pack uuid)
returns text language sql stable security definer set search_path = '' as $$
  select (select case when k.factor is null or k.factor = 1 or abs(p_qty) < k.factor then null
    else trim_scale(trunc(abs(p_qty) / k.factor)) || ' ' || k.name || ' × ' || trim_scale(k.factor)
         || case when abs(p_qty) - trunc(abs(p_qty) / k.factor) * k.factor > 0
                 then ' + ' || trim_scale(abs(p_qty) - trunc(abs(p_qty) / k.factor) * k.factor) else '' end end
    from (select k.name, k.factor from public.product_packs k
           where k.deleted_at is null and (k.id = p_pack or (p_pack is null and k.is_default
                 and k.product_id = (select v.product_id from public.product_variants v where v.id = p_variant)))
           limit 1) k)
$$;

select app._patch_function('public.document_print', $o$'uom', u.code, 'qty', l.quantity, 'price'$o$,
  $n$'uom', u.code, 'qty', l.quantity, 'pack', app.pack_text(l.variant_id, l.quantity, l.pack_id), 'price'$n$);
-- a line without its own unit prints the item's unit
select app._patch_function('public.document_print', $o$left join public.units_of_measure u on u.id = l.uom_id$o$,
  $n$left join public.units_of_measure u on u.id = coalesce(l.uom_id, (select pp.uom_id from public.product_variants vv join public.products pp on pp.id = vv.product_id where vv.id = l.variant_id))$n$);
select app._patch_function('public.document_print', $o$'uom', u.code, 'qty', l.quantity, 'lot'$o$,
  $n$'uom', u.code, 'qty', l.quantity, 'pack', app.pack_text(l.variant_id, l.quantity, null), 'lot'$n$);

-- the packs of every item, for the line editors and the scanners
create or replace function public.product_packs_all(p_company uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'product_id', k.product_id, 'name', k.name, 'factor', k.factor,
           'barcode', k.barcode, 'is_default', k.is_default,
           'variants', (select coalesce(jsonb_agg(v.id), '[]'::jsonb) from public.product_variants v where v.product_id = k.product_id and v.deleted_at is null))
           order by k.product_id, k.factor), '[]'::jsonb)
    from public.product_packs k
   where k.company_id = p_company and k.deleted_at is null
     and p_company = any ((select app.company_ids_with('core.read'))::uuid[])
$$;

-- -----------------------------------------------------------------------------
-- 3. Labels
-- -----------------------------------------------------------------------------
-- p_source: items (variant ids) · products (product ids) · category (category ids) ·
--           receipt (goods receipt ids) · bill (vendor bill ids) · price_changes (since p_since)
-- one row per item with how many labels it needs (the quantity received, otherwise 1)
create or replace function public.label_items(p_company uuid, p_source text, p_ids uuid[] default null, p_since date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v jsonb; v_dec int; v_cur text;
begin
  perform app.require_permission(p_company, 'inventory.read');
  if p_source not in ('items', 'products', 'category', 'receipt', 'bill', 'price_changes') then
    raise exception 'Unknown source of labels' using errcode = '22023';
  end if;
  select coalesce(s.amount_decimals, 2) into v_dec from public.company_settings s where s.company_id = p_company;
  select c.base_currency into v_cur from public.companies c where c.id = p_company;

  with src as (
    select x.variant_id, 1::numeric qty, null::numeric old_net, min(x.o) o from unnest(p_ids) with ordinality x(variant_id, o)
     where p_source = 'items' group by 1
    union all
    select v.id, 1, null, row_number() over (order by p.name, v.sku) from public.product_variants v join public.products p on p.id = v.product_id
     where p_source = 'products' and v.product_id = any (p_ids) and v.deleted_at is null and v.is_active
    union all
    select v.id, 1, null, row_number() over (order by p.name, v.sku) from public.product_variants v join public.products p on p.id = v.product_id
     where p_source = 'category' and p.category_id = any (p_ids) and v.deleted_at is null and v.is_active and p.deleted_at is null and p.is_active
    union all
    select l.variant_id, sum(l.quantity), null, min(l.created_at::date - '2000-01-01'::date) from public.goods_receipt_lines l
     where p_source = 'receipt' and l.receipt_id = any (p_ids) and l.company_id = p_company group by 1
    union all
    select l.variant_id, sum(l.quantity), null, min(l.line_no) from public.vendor_bill_lines l
     where p_source = 'bill' and l.bill_id = any (p_ids) and l.company_id = p_company and l.variant_id is not null and not l.is_return group by 1
    union all
    select c.variant_id, 1, (array_agg(c.old_price order by c.changed_on, c.created_at))[1], row_number() over (order by max(c.changed_on) desc)
      from public.price_changes c
     where p_source = 'price_changes' and c.company_id = p_company and c.changed_on >= coalesce(p_since, current_date) group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'variant_id', v.id, 'product_id', p.id, 'sku', v.sku,
           'name', case when v.is_default or v.name is null or v.name = '' then p.name else v.name end,
           'barcode', b.barcode, 'symbology', b.symbology,
           'uom', u.code, 'brand', p.brand, 'category', cat.name,
           'net', coalesce(v.sales_price_override, p.sales_price, 0), 'vat_rate', coalesce(tc.rate, 0),
           'price', round(coalesce(v.sales_price_override, p.sales_price, 0) * (1 + coalesce(tc.rate, 0) / 100), v_dec),
           'old_price', case when s.old_net is not null and s.old_net <> coalesce(v.sales_price_override, p.sales_price, 0)
                             then round(s.old_net * (1 + coalesce(tc.rate, 0) / 100), v_dec) end,
           'weight_kg', nullif(coalesce(p.weight_kg, v.weight_kg), 0), 'volume_l', nullif(p.volume_m3 * 1000, 0),
           'pack', (select jsonb_build_object('name', k.name, 'factor', k.factor, 'barcode', k.barcode) from public.product_packs k
                     where k.product_id = p.id and k.is_default and k.deleted_at is null),
           'qty', greatest(1, least(500, ceil(s.qty)))::int) order by s.o), '[]'::jsonb)
    into v
    from src s
    join public.product_variants v on v.id = s.variant_id and v.company_id = p_company
    join public.products p on p.id = v.product_id
    left join public.units_of_measure u on u.id = p.uom_id
    left join public.product_categories cat on cat.id = p.category_id
    left join public.tax_codes tc on tc.id = p.sales_tax_code_id
    left join lateral (select b.barcode, b.symbology from public.product_barcodes b
                        where b.variant_id = v.id and b.deleted_at is null and b.quantity = 1   -- a piece's label, never the box code
                        order by b.is_primary desc, b.created_at limit 1) b on true;
  return jsonb_build_object('currency', v_cur, 'decimals', v_dec, 'items', v);
end $$;

-- give an internal EAN-13 (200…) to every chosen item that has no barcode of its own (a box code does not count)
create or replace function public.labels_assign_barcodes(p_company uuid, p_variants uuid[])
returns int language plpgsql security definer set search_path = '' as $$
declare r record; n int := 0;
begin
  perform app.require_permission(p_company, 'inventory.write');
  for r in select v.id from public.product_variants v
            where v.company_id = p_company and v.id = any (p_variants) and v.deleted_at is null
              and not exists (select 1 from public.product_barcodes b where b.variant_id = v.id and b.deleted_at is null and b.quantity = 1) loop
    insert into public.product_barcodes (company_id, variant_id, barcode, symbology, is_primary)
    values (p_company, r.id, public.generate_internal_barcode(p_company), 'ean13', true);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.product_packs_all(uuid), public.label_items(uuid, text, uuid[], date),
  public.labels_assign_barcodes(uuid, uuid[]) from public, anon;
grant execute on function public.product_packs_all(uuid), public.label_items(uuid, text, uuid[], date),
  public.labels_assign_barcodes(uuid, uuid[]) to authenticated;

drop function app._patch_function(text, text, text);
