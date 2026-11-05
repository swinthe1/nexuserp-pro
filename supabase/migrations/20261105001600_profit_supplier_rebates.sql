-- =============================================================================
-- From the meeting with the administrative staff, #6 (answer of 5 November): the customers'
-- discounts (the loyalty card, the flyer's promotions) lower the margin; what the suppliers give
-- back afterwards (credit notes on goods, rebates, price differences on goods already sold) does
-- not: the margin of a sale stays the price less the cost the goods had when they were sold.
--
-- The books already keep it so: a supplier's credit on goods goes to 6011 (price differences), not
-- into the cost of the goods; a return to the supplier takes the goods out at the cost they came in.
-- The profit report did not show 6011 at all; it now shows it as its own line under the gross profit.
-- =============================================================================

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- the price-difference accounts: the company's, and those of the item categories
select app._patch_function('public.profit_report',
  $x$       and ((a.account_type = 'expense' and a.account_subtype in ('expense', 'depreciation', 'other_expense')) or (a.account_type = 'revenue' and a.account_subtype = 'other_income'))),$x$,
  $x$       and ((a.account_type = 'expense' and a.account_subtype in ('expense', 'depreciation', 'other_expense')) or (a.account_type = 'revenue' and a.account_subtype = 'other_income')
            or a.id = app.acct(p_company, 'purchase_price_variance'))),$x$);
select app._patch_function('public.profit_report',
  $x$           case when name ilike '%interes%' or name ilike '%interest%' then 'interest'$x$,
  $x$           case when account_subtype = 'cogs' then 'supplier'
                when name ilike '%interes%' or name ilike '%interest%' then 'interest'$x$);
select app._patch_function('public.profit_report',
  $x$ as other_income,$x$,
  $x$ as other_income,
           -coalesce((select sum(amt) from gl where gl.col = c.col and line = 'supplier'), 0)
             - case when v_split and v_by = 'unit' and c.col <> 'shared' then coalesce((select k from share where share.col = c.col), 0) * coalesce((select sum(amt) from gl where gl.col = 'shared' and line = 'supplier'), 0) else 0 end as supplier,$x$);
-- the new line in the answer, and in the profit below it
select app._patch_function('public.profit_report',
  $x$'opex', round(opex, 2),$x$,
  $x$'supplier', round(supplier, 2), 'opex', round(opex, 2),$x$);
select app._patch_function('public.profit_report',
  $x$net_sales - cogs - opex - other_expense + other_income - interest$x$,
  $x$net_sales - cogs + supplier - opex - other_expense + other_income - interest$x$);

drop function app._patch_function(text, text, text);
