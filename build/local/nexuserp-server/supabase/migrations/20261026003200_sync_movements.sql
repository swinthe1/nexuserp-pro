-- =============================================================================
-- NexusERP Pro · live link: the old program's real stock movements
--
-- Until now the link only sent quantities, so every change showed up as an
-- "adjustment". Now the agent sends each movement of the old program (Logmicro
-- M_TRANSACTION) with its type and document, and NexusERP records it the same way:
-- sale, till sale, customer return, receipt from a supplier, return to a supplier,
-- transfer between stores, stock count, production. The quantity sync stays as a
-- safety net and only corrects what the movements did not explain.
-- Mirrored movements do not post to the books (the old program is still official).
-- =============================================================================
alter table public.stock_movements add column if not exists external_ref text;
create unique index if not exists stock_movements_external_ref_key on public.stock_movements (company_id, external_ref) where external_ref is not null;

-- movements are immutable once written, so the reference is stamped while inserting
create or replace function app.tg_stock_movement_external_ref()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.external_ref', true), '') <> '' then
    new.external_ref := current_setting('app.external_ref', true);
    new.notes := coalesce(new.notes, 'Logmicro');
  end if;
  return new;
end $$;
drop trigger if exists trg_05_external_ref on public.stock_movements;
create trigger trg_05_external_ref before insert on public.stock_movements for each row execute function app.tg_stock_movement_external_ref();

-- p_rows: [{ext_id, type (C- C+ V+ V- M- M+ I+ I- P- P+ …), warehouse, sku, qty (signed), date, reference, pos (bool), cost}]
create or replace function app.sync_movements(p_company uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; v_loc uuid; v_variant uuid; v_qty numeric; v_type text; v_kind text; v_virtual text; v_in boolean; v_mv uuid;
  v_done int := 0; v_dup int := 0; v_unknown int := 0; v_no_wh int := 0; v_skip int := 0; v_at timestamptz;
begin
  perform set_config('app.pos_allow_negative', 'on', true);   -- the old program decides; we only mirror
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    if exists (select 1 from public.stock_movements where company_id = p_company and external_ref = 'LM:' || (r ->> 'ext_id')) then
      v_dup := v_dup + 1; continue;
    end if;
    v_qty := coalesce(app.mig_num(r ->> 'qty'), 0);
    if v_qty = 0 then v_skip := v_skip + 1; continue; end if;
    select v.id into v_variant from public.product_variants v
     where v.company_id = p_company and upper(v.sku) = upper(btrim(r ->> 'sku')) and v.deleted_at is null;
    if v_variant is null then v_unknown := v_unknown + 1; continue; end if;
    if (select p.product_type from public.product_variants v join public.products p on p.id = v.product_id where v.id = v_variant) <> 'stockable' then
      v_skip := v_skip + 1; continue;
    end if;
    select l.id into v_loc from public.warehouses wh join public.warehouse_locations l on l.warehouse_id = wh.id
     where wh.company_id = p_company and upper(wh.code) = upper(btrim(r ->> 'warehouse')) and wh.deleted_at is null
       and l.location_type = 'internal' and l.deleted_at is null
     order by l.is_pickable desc, l.code limit 1;
    if v_loc is null then v_no_wh := v_no_wh + 1; continue; end if;

    v_type := upper(btrim(coalesce(r ->> 'type', '')));
    v_in := v_qty > 0;
    select kind, virt into v_kind, v_virtual from (values
      ('C-', case when coalesce((r ->> 'pos')::boolean, false) then 'pos_sale' else 'delivery' end, 'customer'),
      ('C+', case when coalesce((r ->> 'pos')::boolean, false) then 'pos_return' else 'sales_return' end, 'customer'),
      ('V+', 'receipt', 'supplier'),
      ('V-', 'purchase_return', 'supplier'),
      ('M-', 'transfer', 'transit'),
      ('M+', 'transfer', 'transit'),
      ('P-', 'production_consume', 'production'),
      ('P+', 'production_output', 'production'),
      ('W-', 'production_consume', 'production'),
      ('W+', 'production_output', 'production')
    ) x(code, kind, virt) where x.code = v_type;
    if v_kind is null then   -- I+ / I- stock counts and anything unknown
      v_kind := case when v_in then 'adjustment_in' else 'adjustment_out' end; v_virtual := 'adjustment';
    end if;
    -- a sale with a positive quantity is a return, and so on: the sign decides the direction
    if v_kind in ('delivery', 'pos_sale') and v_in then v_kind := case when v_kind = 'pos_sale' then 'pos_return' else 'sales_return' end; end if;
    if v_kind in ('receipt') and not v_in then v_kind := 'purchase_return'; end if;

    v_at := coalesce(nullif(r ->> 'date', '')::timestamptz, now());
    perform set_config('app.external_ref', 'LM:' || (r ->> 'ext_id'), true);
    if v_in then
      v_mv := app.post_stock_move(p_company, v_kind, v_variant, app.virtual_location(p_company, v_virtual), v_loc, abs(v_qty),
                                  nullif(app.mig_num(r ->> 'cost'), 0), null, null, null, null, nullif(btrim(r ->> 'reference'), ''), v_at);
    else
      v_mv := app.post_stock_move(p_company, v_kind, v_variant, v_loc, app.virtual_location(p_company, v_virtual), abs(v_qty),
                                  null, null, null, null, null, nullif(btrim(r ->> 'reference'), ''), v_at);
    end if;
    perform set_config('app.external_ref', '', true);
    v_done := v_done + 1;
  end loop;
  perform set_config('app.pos_allow_negative', 'off', true);
  return jsonb_build_object('recorded', v_done, 'already', v_dup, 'unknown_items', v_unknown, 'unknown_warehouse', v_no_wh, 'skipped', v_skip);
end $$;
revoke execute on function app.sync_movements(uuid, jsonb) from public, anon, authenticated;

-- sync_push: movements go in before quantities, so the quantity check finds nothing left to correct
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;
select app._patch_function('public.sync_push',
  $x$    if jsonb_array_length(coalesce(p_batch -> 'stock', '[]')) > 0 then$x$,
  $x$    if jsonb_array_length(coalesce(p_batch -> 'movements', '[]')) > 0 then
      v_out := v_out || jsonb_build_object('movements', app.sync_movements(c.company_id, p_batch -> 'movements'));
    end if;
    if jsonb_array_length(coalesce(p_batch -> 'stock', '[]')) > 0 then$x$);
drop function app._patch_function(text, text, text);
