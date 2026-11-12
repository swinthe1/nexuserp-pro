-- =============================================================================
-- A selling price with four decimals: the price without VAT keeps six, so the shelf price comes back exact. (after 152)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select t.ok((select numeric_scale from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'sales_price') = 6,
  'the price without VAT keeps six decimals');
select t.ok((select numeric_scale from information_schema.columns where table_schema = 'public' and table_name = 'product_variants' and column_name = 'sales_price_override') = 6,
  'and so does a variant''s own price');
select t.ok(round(round(0.3333 / 1.18, 6) * 1.18, 4) = 0.3333 and round(round(1.99 / 1.18, 6) * 1.18, 4) = 1.99 and round(round(0.3333 / 1.08, 6) * 1.08, 4) = 0.3333,
  'a shelf price with four decimals comes back exact from it');
select t.ok(pg_get_functiondef('public.pos_catalog_part'::regproc) like '%* (1 + coalesce(t.rate, 0) / 100), 4)%', 'the till gets the shelf price to four decimals');
select t.ok((select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('v_product_stock', 'v_variant_options')
  and reloptions @> array['security_invoker=true'] and has_table_privilege('authenticated', oid, 'select') and not has_table_privilege('anon', oid, 'select')) = 2,
  'the two views over the price are back, with the caller''s rights');
select t.ok((select count(*) from pg_trigger where tgname = 'trg_90_price_change' and not tgisinternal) = 2, 'a price change is still written down');
\set QUIET off
select count(*) as assertions_passed from t.results;
