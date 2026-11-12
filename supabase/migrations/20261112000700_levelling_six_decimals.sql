-- A price change goes through a levelling document: its prices without VAT keep six decimals too,
-- so a shelf price with four decimals (0,3333) is kept exact, and a change in the fifth decimal is not skipped.
alter table public.price_level_lines alter column old_price type numeric(18,6), alter column new_price type numeric(18,6);

do $$
declare d text;
begin
  d := pg_get_functiondef('public.price_level_post(uuid)'::regprocedure);
  if position('continue when round(v_old, 4) = round(l.new_price, 4);' in d) = 0 then raise exception 'price_level_post: the line was not found'; end if;
  execute replace(d, 'continue when round(v_old, 4) = round(l.new_price, 4);', 'continue when round(v_old, 6) = round(l.new_price, 6);');
  d := pg_get_functiondef('public.level_add_line(uuid, uuid, numeric, uuid)'::regprocedure);
  if position('round(p_new_price, 4)' in d) = 0 then raise exception 'level_add_line: the line was not found'; end if;
  execute replace(d, 'round(p_new_price, 4)', 'round(p_new_price, 6)');
  d := pg_get_functiondef('app.price_level_auto(uuid, text, text, jsonb, uuid)'::regprocedure);
  if position('round((x ->> ''price'')::numeric, 4)' in d) = 0 then raise exception 'price_level_auto: the line was not found'; end if;
  execute replace(d, 'round((x ->> ''price'')::numeric, 4)', 'round((x ->> ''price'')::numeric, 6)');
end $$;

-- the levelling writes the same price into a price list when it has one
alter table public.price_list_items alter column price type numeric(18,6);
