-- =============================================================================
-- NexusERP Pro · when an item last moved, sold and arrived (from the old program, every few
-- hours), so items that have not moved for months can be found and switched off
-- =============================================================================

create table public.item_activity (
  id             uuid primary key default gen_random_uuid(),
  variant_id     uuid not null unique,
  company_id     uuid not null references public.companies(id),
  last_movement  date,
  last_sold      date,
  last_received  date,
  updated_at     timestamptz not null default now(),
  foreign key (company_id, variant_id) references public.product_variants(company_id, id) on delete cascade
);
select app.register_table('public.item_activity', 'inventory', p_soft_delete => false, p_client_write => false, p_audit => false);

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
          WHERE b.variant_id = v.id AND b.deleted_at IS NULL
          ORDER BY b.is_primary DESC, b.created_at
         LIMIT 1) AS barcode,
    COALESCE(s.on_hand, 0::numeric) AS on_hand,
    COALESCE(s.reserved, 0::numeric) AS reserved,
    COALESCE(s.available, 0::numeric) AS available,
    COALESCE(( SELECT sum(i.incoming_qty) AS sum
           FROM v_incoming_stock i
          WHERE i.variant_id = v.id), 0::numeric) AS incoming,
    COALESCE(ic.avg_cost, 0::numeric) AS avg_cost,
    COALESCE(ic.total_value, 0::numeric) AS stock_value,
    (EXISTS ( SELECT 1
           FROM stock_alerts a
          WHERE a.variant_id = v.id AND (a.status = ANY (ARRAY['open'::text, 'acknowledged'::text])))) AS is_low_stock,
    ( SELECT sum(r.min_qty) AS sum
           FROM replenishment_rules r
          WHERE r.variant_id = v.id AND r.is_active AND r.deleted_at IS NULL) AS reorder_min,
    ( SELECT sum(r.max_qty) AS sum
           FROM replenishment_rules r
          WHERE r.variant_id = v.id AND r.is_active AND r.deleted_at IS NULL) AS reorder_max,
    GREATEST(ia.last_movement, s.last_movement) AS last_movement,
    ia.last_sold,
    ia.last_received
   FROM product_variants v
     JOIN products p ON p.id = v.product_id
     LEFT JOIN product_categories pc ON pc.id = p.category_id
     JOIN units_of_measure u ON u.id = p.uom_id
     LEFT JOIN item_activity ia ON ia.variant_id = v.id
     LEFT JOIN item_costs ic ON ic.company_id = v.company_id AND ic.variant_id = v.id
     LEFT JOIN LATERAL ( SELECT sum(sl.on_hand) AS on_hand,
            sum(sl.reserved) AS reserved,
            sum(sl.available) AS available, max(sl.last_movement_at)::date AS last_movement
           FROM stock_levels sl
          WHERE sl.variant_id = v.id) s ON true
  WHERE v.deleted_at IS NULL AND p.deleted_at IS NULL;

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- [{sku, last_movement, last_sold, last_received}]; an item with no movement in the window comes with nulls
select app._patch_function('public.sync_history',
  $x$    raise exception 'Unknown kind of history: %', p_kind using errcode = '22023';$x$,
  $x$    if p_kind <> 'activity' then
      raise exception 'Unknown kind of history: %', p_kind using errcode = '22023';
    end if;
    with x as (
      select v.id as variant_id, nullif(e.j ->> 'last_movement', '')::date as lm, nullif(e.j ->> 'last_sold', '')::date as ls,
             nullif(e.j ->> 'last_received', '')::date as lr
        from jsonb_array_elements(p_rows) as e(j)
        join public.product_variants v on v.company_id = v_co and upper(v.sku) = upper(btrim(e.j ->> 'sku')) and v.deleted_at is null)
    insert into public.item_activity as a (variant_id, company_id, last_movement, last_sold, last_received)
    select variant_id, v_co, lm, ls, lr from x
    on conflict (variant_id) do update set last_movement = excluded.last_movement, last_sold = excluded.last_sold,
                                           last_received = excluded.last_received, updated_at = now();
    get diagnostics v_n = row_count;
    v_skip := jsonb_array_length(p_rows) - v_n;$x$);

drop function app._patch_function(text, text, text);
