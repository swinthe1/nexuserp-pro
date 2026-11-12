-- A selling price with four decimals (ATK's technical test: "prices with two and four decimals").
-- The item keeps its price without VAT; with four decimals there, a shelf price like 0,3333 came back as 0,33.
-- The price without VAT now keeps six decimals, so the shelf price comes back exact to four, and the till gets it so.

do $$
declare
  v record;
  defs jsonb := '{}'::jsonb;
begin
  for v in select c.relname, pg_get_viewdef(c.oid, true) as def from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relname in ('v_product_stock', 'v_variant_options') loop
    defs := defs || jsonb_build_object(v.relname, v.def);
    execute format('drop view public.%I', v.relname);
  end loop;
  drop trigger trg_90_price_change on public.products;
  drop trigger trg_90_price_change on public.product_variants;
  alter table public.products alter column sales_price type numeric(18,6);
  alter table public.product_variants alter column sales_price_override type numeric(18,6);
  create trigger trg_90_price_change after update of sales_price on public.products for each row execute function app.tg_price_change();
  create trigger trg_90_price_change after update of sales_price_override on public.product_variants for each row execute function app.tg_price_change();
  for v in select key, value from jsonb_each_text(defs) loop
    execute format('create view public.%I with (security_invoker = true) as %s', v.key, v.value);
    execute format('revoke all on public.%I from public, anon', v.key);
    execute format('grant select on public.%I to authenticated', v.key);
  end loop;
end $$;

-- the till's price list: the shelf price to four decimals (it was rounded to two)
do $$
declare d text := pg_get_functiondef('public.pos_catalog_part'::regproc);
begin
  if position('* (1 + coalesce(t.rate, 0) / 100), 2)' in d) = 0 then raise exception 'pos_catalog_part: the price line was not found'; end if;
  execute replace(d, '* (1 + coalesce(t.rate, 0) / 100), 2)', '* (1 + coalesce(t.rate, 0) / 100), 4)');
end $$;
