-- =============================================================================
-- Every stock value says its price: next to the value at cost (purchase price,
-- without VAT, as in the books) the stock overview gives the value at the
-- selling price with VAT (as on the shelf).
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

select app._patch_function('public.inventory_overview',
  $o$    'active_skus',$o$,
  $n$    'sales_value',      coalesce((select round(sum(sl.on_hand * coalesce(v.sales_price_override, p.sales_price, 0) * (1 + coalesce(tc.rate, 0) / 100)), 2)
                                   from public.stock_levels sl join public.product_variants v on v.id = sl.variant_id join public.products p on p.id = v.product_id
                                   left join public.tax_codes tc on tc.id = p.sales_tax_code_id
                                  where sl.company_id = p_company and sl.on_hand > 0), 0),
    'active_skus',$n$);

drop function app._patch_function(text, text, text);

-- the stock report says which price each value is at
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
do $$ begin
  perform app._patch_function('public.run_report',
    $o$jsonb_build_object('key','value','label','Value','type','money'), jsonb_build_object('key','unit_cost','label','Avg unit cost','type','money'),$o$,
    $n$jsonb_build_object('key','value','label','Value at cost, without VAT','type','money'), jsonb_build_object('key','unit_cost','label','Avg unit cost, without VAT','type','money'),$n$);
  perform app._patch_function('public.run_report',
    $o$'label','Value at selling prices'$o$, $n$'label','Value at selling prices, without VAT'$n$);
end $$;
drop function app._patch_function(text, text, text);
