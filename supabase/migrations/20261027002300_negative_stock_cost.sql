-- =============================================================================
-- Selling below zero no longer spoils the cost (feedback of accountants)
--   · An item sold before it was ever received (or with no cost yet) leaves at its best known cost:
--     the last receipt, the preferred supplier's price, the standard cost, not at zero.
--   · When the goods then arrive, the units that settle the shortage take the real incoming cost;
--     the average keeps following real costs (also while the stock is still below zero).
--   · The difference between what was charged to the sales and the real cost goes to the cost of
--     goods sold (not to an inventory adjustment), and the margin reports show it for that item.
-- =============================================================================

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- the best known cost of an item that has none on the books yet
create or replace function app.fallback_cost(p_company uuid, p_variant uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select m.unit_cost from public.stock_movements m where m.company_id = p_company and m.variant_id = p_variant
        and m.movement_type in ('receipt', 'opening') and m.unit_cost > 0 order by m.movement_date desc limit 1),
    (select vp.price from public.vendor_products vp where vp.company_id = p_company and vp.variant_id = p_variant and vp.deleted_at is null and vp.price > 0
      order by vp.is_preferred desc, vp.updated_at desc limit 1),
    (select nullif(v.standard_cost, 0) from public.product_variants v where v.id = p_variant),
    0)
$$;

do $$ begin
  -- receiving while below zero: the incoming cost is the real one, also for what is still missing
  perform app._patch_function('app.post_stock_move',
    E'      v_v1  := case when v_q1 > 0 then round(v_q1 * v_cost, 4) else round(v_q1 * ic.avg_cost, 4) end;\n      v_avg := case when v_q1 > 0 then v_cost else ic.avg_cost end;',
    E'      v_v1  := round(v_q1 * v_cost, 4);\n      v_avg := v_cost;');
  -- leaving with no cost on the books: the best known cost, never zero by accident
  perform app._patch_function('app.post_stock_move',
    E'    v_cost  := ic.avg_cost;\n    v_total := case when p_qty = ic.qty_on_hand then ic.total_value else round(p_qty * v_cost, 4) end;\n    v_q1    := ic.qty_on_hand - p_qty;\n    v_v1    := case when v_q1 = 0 then 0 else ic.total_value - v_total end;\n    v_avg   := ic.avg_cost;',
    E'    v_cost  := case when ic.avg_cost > 0 then ic.avg_cost else app.fallback_cost(p_company, p_variant) end;\n    v_total := case when p_qty = ic.qty_on_hand then ic.total_value else round(p_qty * v_cost, 4) end;\n    v_q1    := ic.qty_on_hand - p_qty;\n    v_v1    := case when v_q1 = 0 then 0 else ic.total_value - v_total end;\n    v_avg   := v_cost;');
  perform app._patch_function('app.post_stock_move',
    'if v_need > 0 then v_total := v_total + round(v_need * ic.avg_cost, 4); end if;',
    'if v_need > 0 then v_total := v_total + round(v_need * case when ic.avg_cost > 0 then ic.avg_cost else app.fallback_cost(p_company, p_variant) end, 4); end if;');
  -- the settlement of a shortage corrects the cost of what was sold
  perform app._patch_function('app.tg_stock_movement_gl',
    E'      when m.movement_type = ''purchase_return'' then app.acct(m.company_id, ''grni'')',
    E'      when m.movement_type = ''purchase_return'' then app.acct(m.company_id, ''grni'')\n      when m.movement_type = ''revaluation'' and m.notes like ''Negative stock settled%'' then app.item_acct(m.company_id, m.variant_id, ''cogs'')');
end $$;

-- the margin reports see those corrections, on the item and the day the goods arrived
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('app.sales_facts'::regproc);
  if position('cost_correction' in v_def) = 0 then
    v_def := regexp_replace(v_def, E'\\$function\\$\\s*$', '');
    v_def := regexp_replace(v_def, E'\\s+$', '');
    execute v_def || $add$
  union all
  select 'cost_correction', m.id, coalesce(m.reference, 'Kosto e rregulluar'), null, (m.movement_date at time zone co.timezone)::date,
         null, 'Cost settled when the goods arrived', null, 'direct', m.variant_id, coalesce(v.sku || ' · ' || v.name, ''), pr.category_id,
         coalesce(c.name, 'No category'), w.name, null, 0, 0, round(-m.total_cost, 2)
    from public.stock_movements m
    join public.companies co on co.id = m.company_id
    left join public.product_variants v on v.id = m.variant_id
    left join public.products pr on pr.id = v.product_id
    left join public.product_categories c on c.id = pr.category_id
    left join public.warehouses w on w.id = m.to_warehouse_id
   where m.company_id = p_company and m.movement_type = 'revaluation' and m.notes like 'Negative stock settled%'
     and (m.movement_date at time zone co.timezone)::date between p_from and p_to
$function$
$add$;
  end if;
end $$;

drop function app._patch_function(text, text, text);
