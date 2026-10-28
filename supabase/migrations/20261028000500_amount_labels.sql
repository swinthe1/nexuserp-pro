-- =============================================================================
-- Every amount in the reports says what it is: with or without VAT.
-- Sales and margin come from line subtotals (without VAT) and costs (without
-- VAT); purchases split the amount without VAT, the VAT and the total with VAT;
-- open receivables are what is left to pay on the invoice, with VAT.
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

do $$ begin
  -- sales and margin
  perform app._patch_function('public.run_report', $o$'label','Revenue','type'$o$, $n$'label','Revenue, without VAT','type'$n$);
  perform app._patch_function('public.run_report', $o$'label','Cost','type'$o$, $n$'label','Cost, without VAT','type'$n$);
  perform app._patch_function('public.run_report', $o$'label','Margin','type'$o$, $n$'label','Margin, without VAT','type'$n$);
  perform app._patch_function('public.run_report', $o$'label','Discounts given','type'$o$, $n$'label','Discounts given, without VAT','type'$n$);
  -- purchases
  perform app._patch_function('public.run_report', $o$'label','Net amount','type'$o$, $n$'label','Amount without VAT','type'$n$);
  perform app._patch_function('public.run_report', $o$'key','total','label','Total','type'$o$, $n$'key','total','label','Total with VAT','type'$n$);
  -- stock
  perform app._patch_function('public.run_report', $o$'label','Margin when sold','type'$o$, $n$'label','Margin when sold, without VAT','type'$n$);
  -- production: costs are without VAT
  perform app._patch_function('public.run_report', $o$'label','Planned for output','type'$o$, $n$'label','Planned for output, without VAT','type'$n$);
  perform app._patch_function('public.run_report', $o$'label','Actual cost','type'$o$, $n$'label','Actual cost, without VAT','type'$n$);
  perform app._patch_function('public.run_report', $o$'key','variance','label','Variance','type'$o$, $n$'key','variance','label','Variance, without VAT','type'$n$);
  perform app._patch_function('public.run_report', $o$'label','Unit cost','type'$o$, $n$'label','Unit cost, without VAT','type'$n$);
  -- open receivables: what is left of the invoice total
  perform app._patch_function('public.run_report', $o$'label','Open amount','type'$o$, $n$'label','Open amount, with VAT','type'$n$);
end $$;

drop function app._patch_function(text, text, text);
