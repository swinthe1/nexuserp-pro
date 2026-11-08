-- =============================================================================
-- DrisPRO · "See what the goods cost" (inventory.costs) holds everywhere (audit, wave 1)
--   Before, it was checked only on the stock report. Now, without it:
--     * the item costs are not readable (the stock list shows no average cost or value at cost)
--     * stock movements show no unit or total cost
--     * the levelling, expiry, thrown-away, outputs, item card and count review answers come with
--       their cost figures empty (quantities and selling prices stay)
--   Those who could see costs before still can (owners, managers, accountants, buyers).
-- =============================================================================

-- 1. the item costs themselves
drop policy if exists item_costs_select on public.item_costs;
create policy item_costs_select on public.item_costs for select to authenticated
  using (company_id = any (app.company_ids_with('inventory.costs')));

-- 2. the movements: their costs only for those who may see them
do $$
declare v text;
begin
  v := pg_get_viewdef('public.v_stock_movements'::regclass);
  v := replace(v, '    m.unit_cost,', '    case when m.company_id = any (app.company_ids_with(''inventory.costs'')) then m.unit_cost end::numeric(18,6) as unit_cost,');
  v := replace(v, '    m.total_cost,', '    case when m.company_id = any (app.company_ids_with(''inventory.costs'')) then m.total_cost end::numeric(18,4) as total_cost,');
  if position('company_ids_with' in v) = 0 then raise exception 'v_stock_movements: costs not found'; end if;
  execute 'create or replace view public.v_stock_movements with (security_invoker = true) as ' || v;
end $$;

-- 3. answers of functions: the cost figures emptied for someone without the permission
create or replace function app.scrub_costs(j jsonb, p_keys text[])
returns jsonb language plpgsql immutable set search_path = '' as $$
declare r jsonb; k text; v jsonb;
begin
  if j is null then return null; end if;
  if jsonb_typeof(j) = 'object' then
    r := '{}'::jsonb;
    for k, v in select * from jsonb_each(j) loop
      r := r || jsonb_build_object(k, case when k = any (p_keys) then 'null'::jsonb else app.scrub_costs(v, p_keys) end);
    end loop;
    return r;
  elsif jsonb_typeof(j) = 'array' then
    return coalesce((select jsonb_agg(app.scrub_costs(x, p_keys) order by i) from jsonb_array_elements(j) with ordinality a(x, i)), '[]'::jsonb);
  end if;
  return j;
end $$;

-- each function keeps its name and arguments; its body moves to app.<name>__all and the public one
-- passes the answer through, emptied of costs when the person may not see them
create or replace function app._guard_costs(p_name text, p_args text, p_call text, p_company text, p_keys text[])
returns void language plpgsql as $$
begin
  if to_regprocedure('app.' || p_name || '__all(' || p_args || ')') is null then
    execute format('alter function public.%I(%s) set schema app', p_name, p_args);
    execute format('alter function app.%I(%s) rename to %I', p_name, p_args, p_name || '__all');
    execute format('revoke all on function app.%I(%s) from public, anon, authenticated', p_name || '__all', p_args);
  end if;
  execute format($f$
    create or replace function public.%1$I(%2$s) returns jsonb language plpgsql security definer set search_path = '' as $b$
    declare v_out jsonb; v_co uuid;
    begin
      v_out := app.%3$I(%4$s);
      v_co := %5$s;
      if v_co is not null and not app.has_permission(v_co, 'inventory.costs') then v_out := app.scrub_costs(v_out, %6$L::text[]); end if;
      return v_out;
    end $b$;
    revoke all on function public.%1$I(%7$s) from public, anon;
    grant execute on function public.%1$I(%7$s) to authenticated;
  $f$, p_name, p_call, p_name || '__all',
     (select string_agg(split_part(btrim(a), ' ', 1), ', ') from unnest(string_to_array(p_call, ',')) a),
     p_company, p_keys, p_args);
end $$;

select app._guard_costs('price_level_items', 'uuid, uuid[], uuid', 'p_company uuid, p_variants uuid[], p_warehouse uuid default null', 'p_company',
  array['cost', 'avg_cost', 'last_cost', 'margin', 'margin_pct']);
select app._guard_costs('expiry_overview', 'uuid, uuid, integer', 'p_company uuid, p_warehouse uuid default null, p_days integer default 7', 'p_company',
  array['value', 'cost', 'avg_cost']);
select app._guard_costs('waste_report', 'uuid, jsonb', 'p_company uuid, p jsonb', 'p_company',
  array['in_cost', 'waste_cost', 'pct_value_in', 'cost', 'avg_cost']);
select app._guard_costs('stock_outputs', 'uuid, jsonb', 'p_company uuid, p jsonb', 'p_company',
  array['cost_gross', 'cost_net', 'cost', 'unit_cost']);
select app._guard_costs('item_card', 'uuid, uuid, date, date', 'p_variant uuid, p_warehouse uuid, p_from date, p_to date',
  '(select company_id from public.product_variants where id = p_variant)',
  array['closing_value', 'landed_cost', 'opening_value', 'unit_cost', 'value', 'value_in', 'value_out', 'avg_cost', 'cost']);
select app._guard_costs('count_review', 'uuid', 'p_id uuid', '(select company_id from public.cycle_counts where id = p_id)',
  array['gains', 'losses', 'net', 'counted_value', 'value', 'unit_cost']);
drop function app._guard_costs(text, text, text, text, text[]);
