-- =============================================================================
-- DrisPRO · the till keeps the items, prices and stock in step at once (the owner's rule, 8.11.2026)
--   "The till always has all the stock, items and prices, in step in real time, so when the server
--    is down it sells freely; when the connection is back it sends the sales, the stock goes down,
--    and the coupons go to ATK."
--   · pos_catalog_pulse: one row per company, touched (at most every 2 seconds) when an item, a
--     barcode, a price, a promotion, a tax rate or the stock changes. The tills listen to it in real
--     time and fetch only what changed (pos_catalog_changes), within a few seconds.
--   · pos_ping: the tills ask every 10 seconds whether the server answers, so a till knows the server
--     is down before the next sale and never waits for it.
-- =============================================================================

create table if not exists public.pos_catalog_pulse (
  company_id uuid primary key references public.companies(id) on delete cascade deferrable initially immediate,
  changed_at timestamptz not null default now()
);
alter table public.pos_catalog_pulse enable row level security;
drop policy if exists pos_catalog_pulse_read on public.pos_catalog_pulse;
create policy pos_catalog_pulse_read on public.pos_catalog_pulse for select to authenticated
  using (company_id = any ((select app.company_ids_with('pos.read'))::uuid[]));
revoke all on public.pos_catalog_pulse from public, anon;
grant select on public.pos_catalog_pulse to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pos_catalog_pulse') then
    alter publication supabase_realtime add table public.pos_catalog_pulse;
  end if;
end $$;

-- touched after a change; a quick look first, so busy tills selling at once do not wait on one row
create or replace function app.tg_pos_pulse()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_company uuid;
begin
  v_company := case when tg_op = 'DELETE' then old.company_id else new.company_id end;
  if v_company is null then return null; end if;
  if exists (select 1 from public.pos_catalog_pulse where company_id = v_company and changed_at > now() - interval '2 seconds') then
    return null;
  end if;
  insert into public.pos_catalog_pulse (company_id, changed_at) values (v_company, now())
  on conflict (company_id) do update set changed_at = excluded.changed_at;
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['product_variants', 'products', 'product_barcodes', 'price_list_items', 'partner_prices', 'price_lists', 'promotions', 'tax_codes', 'stock_levels'] loop
    execute format('drop trigger if exists pos_pulse on public.%I', t);
    execute format('create trigger pos_pulse after insert or update or delete on public.%I for each row execute function app.tg_pos_pulse()', t);
  end loop;
end $$;

-- the till's question every few seconds: is the server there?
create or replace function public.pos_ping()
returns int language sql stable set search_path = '' as $$ select 1 $$;
revoke execute on function public.pos_ping() from public, anon;
grant execute on function public.pos_ping() to authenticated;
