-- =============================================================================
-- DrisPRO · price history of every item
--   * from the old program: its price levelling documents (Logmicro "nivelimi i çmimeve"),
--     with the old and new price, the stock at that moment and the change in stock value
--   * here: each change of the selling price, kept by a trigger (not for a company whose
--     prices come from the old program over the live link: those arrive as levellings)
-- =============================================================================

create table public.price_changes (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id),
  variant_id    uuid not null,
  warehouse_id  uuid,
  price_list    text,
  changed_on    date not null,
  old_price     numeric(18,4),
  new_price     numeric(18,4) not null,
  quantity      numeric(18,4),
  value_change  numeric(18,2),
  doc_number    text,
  source        text not null default 'manual' check (source in ('manual', 'logmicro')),
  ext_id        text,
  changed_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (company_id, variant_id) references public.product_variants(company_id, id) on delete cascade,
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id)
);
select app.register_table('public.price_changes', 'inventory', p_soft_delete => false, p_client_write => false, p_audit => false);
create unique index price_changes_ext_idx on public.price_changes (company_id, ext_id) where ext_id is not null;
create index price_changes_variant_idx on public.price_changes (company_id, variant_id, changed_on desc);

-- a change made here: the effective selling price of the variant before and after
create or replace function app.tg_price_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_tz text; v_today date;
begin
  if exists (select 1 from public.sync_connections s where s.company_id = new.company_id and s.is_active) then return null; end if;
  select coalesce(timezone, 'Europe/Tirane') into v_tz from public.companies where id = new.company_id;
  v_today := (now() at time zone v_tz)::date;
  if tg_table_name = 'products' then
    if new.sales_price is not distinct from old.sales_price then return null; end if;
    insert into public.price_changes (company_id, variant_id, changed_on, old_price, new_price, quantity, value_change, changed_by)
    select v.company_id, v.id, v_today, old.sales_price, new.sales_price, q.qty,
           case when q.qty is not null then round(q.qty * (new.sales_price - coalesce(old.sales_price, 0)), 2) end, auth.uid()
      from public.product_variants v
      left join lateral (select sum(sl.on_hand) as qty from public.stock_levels sl where sl.variant_id = v.id) q on true
     where v.product_id = new.id and v.deleted_at is null and v.sales_price_override is null;
  else
    if new.sales_price_override is not distinct from old.sales_price_override then return null; end if;
    insert into public.price_changes (company_id, variant_id, changed_on, old_price, new_price, quantity, value_change, changed_by)
    select new.company_id, new.id, v_today, coalesce(old.sales_price_override, p.sales_price), coalesce(new.sales_price_override, p.sales_price), q.qty,
           case when q.qty is not null then round(q.qty * (coalesce(new.sales_price_override, p.sales_price) - coalesce(old.sales_price_override, p.sales_price, 0)), 2) end,
           auth.uid()
      from public.products p
      left join lateral (select sum(sl.on_hand) as qty from public.stock_levels sl where sl.variant_id = new.id) q on true
     where p.id = new.product_id
       and coalesce(new.sales_price_override, p.sales_price) is distinct from coalesce(old.sales_price_override, p.sales_price);
  end if;
  return null;
end $$;
create trigger trg_90_price_change after update of sales_price on public.products
  for each row execute function app.tg_price_change();
create trigger trg_90_price_change after update of sales_price_override on public.product_variants
  for each row execute function app.tg_price_change();

-- the old program's levellings, sent by the agent:
-- [{ext_id, sku, warehouse, price_list, date, old_price, new_price, qty, number}]
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

select app._patch_function('public.sync_history',
  $x$  else
    if p_kind <> 'activity' then$x$,
  $x$  elsif p_kind = 'price_changes' then
    with x as (
      select distinct on (btrim(e.j ->> 'ext_id')) btrim(e.j ->> 'ext_id') as ext_id, v.id as variant_id,
             (select w.id from public.warehouses w where w.company_id = v_co and upper(w.code) = upper(btrim(e.j ->> 'warehouse')) and w.deleted_at is null limit 1) as wh,
             nullif(btrim(e.j ->> 'price_list'), '') as pl, (e.j ->> 'date')::date as d,
             app.mig_num(e.j ->> 'old_price') as op, app.mig_num(e.j ->> 'new_price') as np, app.mig_num(e.j ->> 'qty') as q,
             nullif(btrim(e.j ->> 'number'), '') as num
        from jsonb_array_elements(p_rows) as e(j)
        join public.product_variants v on v.company_id = v_co and upper(v.sku) = upper(btrim(e.j ->> 'sku')) and v.deleted_at is null
       where nullif(btrim(e.j ->> 'ext_id'), '') is not null and e.j ->> 'date' is not null and app.mig_num(e.j ->> 'new_price') is not null)
    insert into public.price_changes as pc (company_id, variant_id, warehouse_id, price_list, changed_on, old_price, new_price, quantity, value_change, doc_number, source, ext_id)
    select v_co, variant_id, wh, pl, d, op, np, q, case when q is not null and op is not null then round(q * (np - op), 2) end, num, 'logmicro', ext_id from x
    on conflict (company_id, ext_id) where ext_id is not null do update
      set variant_id = excluded.variant_id, warehouse_id = excluded.warehouse_id, price_list = excluded.price_list, changed_on = excluded.changed_on,
          old_price = excluded.old_price, new_price = excluded.new_price, quantity = excluded.quantity, value_change = excluded.value_change,
          doc_number = excluded.doc_number, updated_at = now();
    get diagnostics v_n = row_count;
    v_skip := jsonb_array_length(p_rows) - v_n;
  else
    if p_kind <> 'activity' then$x$);

drop function app._patch_function(text, text, text);
