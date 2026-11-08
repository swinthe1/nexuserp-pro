-- =============================================================================
-- DrisPRO · a count shows what the differences are worth at the selling price too (audit, wave 1)
--   Beside the cost, the review gives the missing and the found goods at the shelf price with VAT,
--   which is what a market owner thinks in. Costs stay for those who may see costs.
-- =============================================================================
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;
select app._patch_function('public.count_review',
  $x$           coalesce(ic.avg_cost, 0) as unit_cost
      from public.cycle_count_lines cl
      join public.product_variants v on v.id = cl.variant_id$x$,
  $x$           coalesce(ic.avg_cost, 0) as unit_cost,
           round(coalesce(v.sales_price_override, p.sales_price, 0) * (1 + coalesce(tc.rate, 0) / 100), 2) as unit_price
      from public.cycle_count_lines cl
      join public.product_variants v on v.id = cl.variant_id
      join public.products p on p.id = v.product_id
      left join public.tax_codes tc on tc.id = p.sales_tax_code_id$x$);
select app._patch_function('public.count_review',
  $x$    'counted_value', coalesce((select round(sum(counted_qty * unit_cost), 2) from x), 0)$x$,
  $x$    'counted_value', coalesce((select round(sum(counted_qty * unit_cost), 2) from x), 0),
    'gains_sale', coalesce((select round(sum(delta * unit_price), 2) from x where delta > 0), 0),
    'losses_sale', coalesce((select round(sum(delta * unit_price), 2) from x where delta < 0), 0)$x$);
drop function app._patch_function(text, text, text);
